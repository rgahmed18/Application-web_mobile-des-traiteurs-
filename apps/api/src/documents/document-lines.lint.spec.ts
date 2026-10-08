import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Vérifie que la règle ESLint réservant l'écriture des lignes à DocumentLinesService
 * fonctionne : chaque contournement du fichier témoin est signalé, et le module autorisé
 * n'est pas signalé.
 */
interface LintMessage {
  ruleId: string | null;
  line: number;
}
interface LintResult {
  filePath: string;
  messages: LintMessage[];
}

const API_ROOT = join(__dirname, '..', '..');
const ESLINT_BIN = join(API_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

function lint(file: string): LintResult {
  let output: string;
  try {
    output = execFileSync(process.execPath, [ESLINT_BIN, '--no-ignore', '--format', 'json', file], {
      cwd: API_ROOT,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    // ESLint sort en erreur (code 1) quand il trouve des problèmes : la sortie JSON reste valide
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout !== 'string' || stdout.length === 0) throw error;
    output = stdout;
  }
  const [result] = JSON.parse(output) as LintResult[];
  if (!result) throw new Error(`Aucun résultat ESLint pour ${file}`);
  return result;
}

const restrictedLines = (result: LintResult) =>
  result.messages
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.line);

describe('règle ESLint : écriture des lignes réservée à DocumentLinesService', () => {
  it('signale chaque écriture directe ou imbriquée hors du module autorisé', () => {
    const lines = restrictedLines(lint('test/lint-fixtures/forbidden-line-writes.ts'));
    // 3 appels directs + 2 écritures imbriquées ; aucune lecture signalée
    expect(lines).toHaveLength(5);
  }, 120_000);

  it('ne signale pas le module autorisé', () => {
    expect(restrictedLines(lint('src/documents/document-lines.ts'))).toEqual([]);
  }, 120_000);
});
