// Démonstration sur le réseau local, en version de production, en une commande :
// `pnpm demo:start` (adresse imposée : `pnpm demo:start --ip 192.168.1.20` ou DEMO_IP).
//
//  1. Docker : PostgreSQL, Redis et stockage démarrés et prêts (Docker Desktop lancé au besoin).
//  2. Adresse IP du PC sur le Wi-Fi : les .env de démonstration (API et web) sont mis à jour si
//     elle a changé ; règle du pare-feu Windows ajoutée si elle manque (demande d'élévation).
//  3. Anciens serveurs de démonstration arrêtés, build (Turborepo : rien n'est refait si rien n'a
//     changé), migrations en attente appliquées (`migrate deploy`, jamais de remise à zéro).
//  4. API, worker et web (`next start`) lancés, page de connexion vérifiée, adresses affichées.
//
// Les serveurs tournent tant que la commande tourne (Ctrl+C les arrête) ; journaux dans
// .demo/logs. La base de démonstration n'est jamais réinitialisée.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiDir = join(root, 'apps', 'api');
const webDir = join(root, 'apps', 'web');
const logDir = join(root, '.demo', 'logs');
const isWindows = process.platform === 'win32';

const API_PORT = 3000;
const WEB_PORT = 3001;
const STORAGE_PORT = 9000;
const FIREWALL_RULE = 'Gestion Traiteurs - recette locale (dev)';
const DEMO_SLUG = 'dar-diafa';

const step = (text) => console.log(`\n▸ ${text}`);
const ok = (text) => console.log(`  ✓ ${text}`);
const warn = (text) => console.log(`  ! ${text}`);

function fail(text) {
  console.error(`\n✗ ${text}`);
  process.exit(1);
}

/** Commande affichée dans le terminal ; sous Windows via le shell (pnpm est un script .cmd). */
function run(command, args) {
  const result = isWindows
    ? spawnSync([command, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  return result.status === 0;
}

function output(command, args) {
  try {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/** Commande encodée : aucun problème de guillemets entre Node, Windows et PowerShell. */
const encoded = (script) => Buffer.from(script, 'utf16le').toString('base64');

function powershell(script) {
  return output('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded(script),
  ]);
}

/** Statut HTTP d'une adresse (Host imposé : vérification sans dépendre du DNS de nip.io). */
function httpStatus(url, host) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: host ? { host } : {},
        timeout: 5000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function waitFor(check, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(2000);
  }
  return false;
}

// ─────────────────────────── Adresse IP ───────────────────────────

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VIRTUAL_ADAPTER = /vethernet|wsl|virtualbox|vmware|hyper-v|docker|bluetooth|loopback/i;
const WIFI_ADAPTER = /wi-?fi|wlan|wireless|sans fil/i;

function requestedIp() {
  const index = process.argv.indexOf('--ip');
  const ip = index >= 0 ? process.argv[index + 1] : process.env.DEMO_IP;
  if (ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) fail(`Adresse IP invalide : ${ip}`);
  return ip;
}

/** Cartes réseau actives : sous Windows, seules celles qui ont une passerelle (réseau réel). */
function candidateAddresses() {
  if (isWindows) {
    const json = powershell(
      'Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | ' +
        'ForEach-Object { [pscustomobject]@{ name = $_.InterfaceAlias; ip = $_.IPv4Address.IPAddress } } | ' +
        'ConvertTo-Json -Compress',
    );
    if (json) {
      return [JSON.parse(json)]
        .flat()
        .flatMap(({ name, ip }) => [ip].flat().map((address) => ({ name, ip: address })));
    }
  }
  return Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => ({ name, ip: entry.address })),
  );
}

function detectIp() {
  const forced = requestedIp();
  if (forced) return { ip: forced, name: 'imposée' };
  const candidates = candidateAddresses().filter(
    ({ name, ip }) => PRIVATE_IPV4.test(ip) && !VIRTUAL_ADAPTER.test(name),
  );
  const chosen = candidates.find(({ name }) => WIFI_ADAPTER.test(name)) ?? candidates[0];
  if (!chosen) {
    fail(
      'Aucune adresse IP sur un réseau local : connectez le PC au Wi-Fi, ou imposez-la ' +
        '(pnpm demo:start --ip 192.168.1.20).',
    );
  }
  return chosen;
}

// ─────────────────────────── Fichiers .env ───────────────────────────

function readEnv(file) {
  if (!existsSync(file)) fail(`${file} introuvable : voir « Installation » dans le README.`);
  return readFileSync(file, 'utf8');
}

function envValue(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
}

function setEnvValue(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

/** Même adresse avec un autre hôte (chemin et port conservés), ou la valeur par défaut. */
function withHost(current, host, fallback) {
  try {
    const url = new URL(current);
    url.hostname = host;
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

/** Origines du web sur cette IP ; celles d'une ancienne IP sont retirées, les autres gardées. */
function demoCorsOrigins(current, ip) {
  const fromIp = /^https?:\/\/(\*\.)?\d{1,3}(\.\d{1,3}){3}(\.nip\.io)?(:\d+)?$/;
  const kept = (current ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && !fromIp.test(origin));
  const demo = [
    `http://${ip}:${WEB_PORT}`,
    `http://${ip}.nip.io:${WEB_PORT}`,
    `http://*.${ip}.nip.io:${WEB_PORT}`,
  ];
  return [...kept, ...demo].join(',');
}

function updateEnvFiles(ip) {
  const domain = `${ip}.nip.io`;
  const files = [
    {
      path: join(apiDir, '.env'),
      values: (text) => ({
        CORS_ORIGINS: demoCorsOrigins(envValue(text, 'CORS_ORIGINS'), ip),
        PUBLIC_WEB_URL: `http://${domain}:${WEB_PORT}`,
        TENANT_BASE_DOMAIN: domain,
        PLATFORM_HOSTNAMES: `${domain},${ip},localhost`,
        TENANT_URL_TEMPLATE: `http://{slug}.${domain}:${WEB_PORT}`,
        S3_PUBLIC_URL: withHost(
          envValue(text, 'S3_PUBLIC_URL'),
          ip,
          `http://${ip}:${STORAGE_PORT}/traiteur-media`,
        ),
      }),
    },
    {
      path: join(webDir, '.env'),
      values: (text) => ({
        PUBLIC_API_URL: withHost(
          envValue(text, 'PUBLIC_API_URL'),
          ip,
          `http://${ip}:${API_PORT}/api/v1`,
        ),
        PUBLIC_MEDIA_URL: withHost(
          envValue(text, 'PUBLIC_MEDIA_URL'),
          ip,
          `http://${ip}:${STORAGE_PORT}/traiteur-media`,
        ),
      }),
    },
  ];
  for (const file of files) {
    const before = readEnv(file.path);
    let after = before;
    const changed = [];
    for (const [key, value] of Object.entries(file.values(before))) {
      if (envValue(after, key) === value) continue;
      after = setEnvValue(after, key, value);
      changed.push(key);
    }
    const name = file.path.slice(root.length).replaceAll('\\', '/');
    if (changed.length === 0) {
      ok(`${name} : déjà à jour`);
      continue;
    }
    writeFileSync(file.path, after);
    ok(`${name} : ${changed.join(', ')} mis à jour`);
  }
}

// ─────────────────────────── Docker ───────────────────────────

async function startDocker() {
  if (output('docker', ['info', '--format', '{{.ServerVersion}}']) === null) {
    const desktop = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
    if (!isWindows || !existsSync(desktop)) fail('Docker ne répond pas : démarrez Docker.');
    console.log('  Lancement de Docker Desktop…');
    spawn(desktop, [], { detached: true, stdio: 'ignore' }).unref();
    const ready = await waitFor(
      () => output('docker', ['info', '--format', '{{.ServerVersion}}']) !== null,
      180_000,
    );
    if (!ready) fail('Docker Desktop ne répond toujours pas après 3 minutes.');
  }
  // --wait : attend que PostgreSQL et Redis soient « healthy »
  if (!run('docker', ['compose', 'up', '-d', '--wait'])) fail('docker compose up a échoué.');
  const storage = await waitFor(
    async () => (await httpStatus(`http://127.0.0.1:${STORAGE_PORT}/health`)) === 200,
    60_000,
  );
  if (!storage) fail(`Le stockage (port ${STORAGE_PORT}) ne répond pas.`);
  ok('PostgreSQL et Redis « healthy », stockage prêt');
}

// ─────────────────────────── Pare-feu ───────────────────────────

function ensureFirewall() {
  if (!isWindows) return;
  const exists = () =>
    output('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`]) !== null;
  if (exists()) {
    ok(`règle « ${FIREWALL_RULE} » présente`);
    return;
  }
  console.log('  Règle absente : ajout (Windows demande l’autorisation d’administrateur)…');
  const rule =
    `New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Action Allow ` +
    `-Protocol TCP -LocalPort ${API_PORT},${WEB_PORT},${STORAGE_PORT} -RemoteAddress LocalSubnet -Profile Any`;
  powershell(
    `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-EncodedCommand','${encoded(rule)}'`,
  );
  if (exists()) ok('règle du pare-feu ajoutée');
  else warn('règle non ajoutée : le téléphone ne pourra pas joindre le PC (voir README).');
}

// ─────────────────────────── Serveurs ───────────────────────────

/** Processus Node de la démo encore en marche (lancement précédent, terminal fermé…). */
function stopPreviousServers() {
  if (!isWindows) {
    run('sh', ['-c', `pkill -f "${apiDir}/dist/(main|worker)" ; true`]);
    return;
  }
  const apiDist = join(apiDir, 'dist').replaceAll('\\', '\\\\');
  const stopped = powershell(
    `$ports = Get-NetTCPConnection -LocalPort ${API_PORT},${WEB_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess; ` +
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { ` +
      `($ports -contains $_.ProcessId) -or ($_.CommandLine -match '${apiDist}\\\\(main|worker)') -or ($_.CommandLine -match 'node(\\.exe)?"?\\s+dist[\\\\/](main|worker)') } | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`,
  );
  const count = stopped ? stopped.split(/\s+/).filter(Boolean).length : 0;
  ok(count ? `${count} ancien(s) processus arrêté(s)` : 'aucun serveur de démonstration en marche');
  const busy = powershell(
    `Get-NetTCPConnection -LocalPort ${API_PORT},${WEB_PORT} -State Listen -ErrorAction SilentlyContinue | ` +
      `ForEach-Object { "$($_.LocalPort) : $((Get-Process -Id $_.OwningProcess).ProcessName)" }`,
  );
  if (busy) fail(`Ports occupés par un autre programme :\n${busy}`);
}

const children = [];

function startServer(name, cwd, args) {
  mkdirSync(logDir, { recursive: true });
  const log = openSync(join(logDir, `${name}.log`), 'w');
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', log, log] });
  child.name = name;
  child.on('exit', (code) => {
    // Ctrl+C atteint aussi les serveurs (même console) : arrêt voulu, pas une panne
    setTimeout(() => {
      if (stopping) return;
      console.error(`\n✗ ${name} s’est arrêté (code ${code}) : voir .demo/logs/${name}.log`);
      stopAll(1);
    }, 500);
  });
  children.push(child);
  return child;
}

let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  console.log('\nServeurs de démonstration arrêtés.');
  process.exit(code);
}

function logTail(name, lines = 15) {
  try {
    return readFileSync(join(logDir, `${name}.log`), 'utf8')
      .trimEnd()
      .split('\n')
      .slice(-lines)
      .join('\n');
  } catch {
    return '';
  }
}

/** Espaces des traiteurs actifs, lus dans la base de démonstration (lecture seule). */
function traiteurSlugs() {
  const url = envValue(readEnv(join(apiDir, '.env')), 'DATABASE_URL');
  let user = 'traiteur';
  let database = 'gestion_traiteurs';
  try {
    const parsed = new URL(url);
    user = decodeURIComponent(parsed.username) || user;
    database = parsed.pathname.slice(1) || database;
  } catch {
    // valeurs par défaut de docker-compose.yml
  }
  const slugs = output('docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    user,
    '-d',
    database,
    '-Atc',
    `select slug from "Traiteur" where status in ('TRIAL', 'ACTIVE') order by slug`,
  ]);
  return slugs ? slugs.split(/\r?\n/).filter(Boolean) : [DEMO_SLUG];
}

// ─────────────────────────── Lancement ───────────────────────────

console.log('Démonstration Gestion Traiteurs (version de production)');

step('Docker');
await startDocker();

step('Adresse IP');
const { ip, name: adapter } = detectIp();
ok(`${ip} (${adapter})`);
updateEnvFiles(ip);
ensureFirewall();

step('Arrêt des anciens serveurs');
stopPreviousServers();

step('Build (Turborepo : seul ce qui a changé est reconstruit)');
if (
  !run('pnpm', [
    'turbo',
    'run',
    'build',
    '--filter=@traiteur/api',
    '--filter=@traiteur/web',
    '--output-logs=errors-only',
  ])
) {
  fail('Le build a échoué.');
}

step('Migrations en attente et permissions (jamais de remise à zéro)');
if (!run('pnpm', ['--filter', '@traiteur/api', 'db:deploy'])) fail('migrate deploy a échoué.');
// Nouvelles permissions du catalogue (comme au déploiement) ; les réglages des traiteurs restent
if (!run('pnpm', ['--filter', '@traiteur/api', 'exec', 'node', 'dist/cli/sync-permissions.js'])) {
  fail('la synchronisation des permissions a échoué.');
}

step('Démarrage de l’API, du worker et du web');
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
startServer('api', apiDir, [join(apiDir, 'dist', 'main.js')]);
startServer('worker', apiDir, [join(apiDir, 'dist', 'worker.js')]);
startServer('web', webDir, [
  join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next'),
  'start',
  '-p',
  String(WEB_PORT),
  '-H',
  '0.0.0.0',
]);

const loginUrl = `http://${DEMO_SLUG}.${ip}.nip.io:${WEB_PORT}/admin/login`;
const apiReady = await waitFor(
  async () => (await httpStatus(`http://${ip}:${API_PORT}/api/v1/health`)) === 200,
  120_000,
);
if (!apiReady) {
  console.error(logTail('api'));
  console.error('\n✗ L’API ne répond pas.');
  stopAll(1);
}
ok('API prête');
const webReady = await waitFor(
  async () =>
    (await httpStatus(
      `http://${ip}:${WEB_PORT}/admin/login`,
      `${DEMO_SLUG}.${ip}.nip.io:${WEB_PORT}`,
    )) === 200,
  120_000,
);
if (!webReady) {
  console.error(logTail('web'));
  console.error('\n✗ La page de connexion de Dar Diafa ne répond pas.');
  stopAll(1);
}
ok('page de connexion de Dar Diafa : 200');
if (!(await waitFor(async () => logTail('worker', 50).includes('Worker démarré'), 60_000))) {
  warn('le worker n’a pas encore confirmé son démarrage : voir .demo/logs/worker.log');
} else {
  ok('worker démarré');
}
// Adresses en *.nip.io : il faut un accès Internet pour la résolution DNS
if ((await httpStatus(loginUrl)) !== 200) {
  warn(`${DEMO_SLUG}.${ip}.nip.io ne se résout pas : vérifiez l’accès Internet (DNS de nip.io).`);
}

const pad = (text) => text.padEnd(18);
console.log(`
Démonstration prête (PC et téléphone sur le même Wi-Fi, mêmes adresses) :

  ${pad('Console')}http://${ip}.nip.io:${WEB_PORT}/admin/login
${traiteurSlugs()
  .map((slug) => `  ${pad(slug)}http://${slug}.${ip}.nip.io:${WEB_PORT}/admin/login`)
  .join('\n')}
  ${pad('API')}http://${ip}:${API_PORT}/api/v1

Journaux : .demo/logs (api, worker, web). Ctrl+C arrête les serveurs.`);
