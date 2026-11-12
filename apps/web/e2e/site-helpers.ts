import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { expect, type Page } from '@playwright/test';

/**
 * Site client : codes reçus par SMS ou par e-mail, lus dans la boîte d'envoi de l'API des
 * parcours (SMS_PROVIDER=outbox, voir playwright.config.ts).
 */
const OUTBOX = process.env.E2E_OUTBOX_DIR ?? path.join(__dirname, '..', '.e2e-outbox');

function outboxFile(to: string): string {
  return to.includes('@')
    ? path.join(OUTBOX, `email-${to.replace(/[^a-z0-9@.-]/gi, '_')}.txt`)
    : path.join(OUTBOX, `sms-${to.replace(/\D/g, '')}.txt`);
}

/** Dernier code reçu (attend qu'il arrive), puis message effacé pour le prochain. */
export async function receivedCode(to: string): Promise<string> {
  const file = outboxFile(to);
  let code = '';
  await expect
    .poll(() => {
      code = existsSync(file) ? (/(\d{6})/.exec(readFileSync(file, 'utf8'))?.[1] ?? '') : '';
      return code;
    })
    .not.toBe('');
  rmSync(file, { force: true });
  return code;
}

/** Numéro marocain unique (E.164) pour une inscription, et sa saisie nationale. */
export function newMoroccanPhone(): { e164: string; typed: string } {
  const digits = `6${String(Date.now()).slice(-8)}`;
  return { e164: `+212${digits}`, typed: `0${digits}` };
}

/**
 * Demande le code du numéro (et de l'adresse, numéro étranger) : « Trop de tentatives » (limite
 * par adresse IP, vite atteinte quand les parcours s'enchaînent), attente puis nouvel essai.
 */
export async function requestSiteCode(page: Page, phone: string, email?: string): Promise<void> {
  const form = page.getByTestId('client-login-phone');
  await form.getByLabel('Numéro de téléphone').fill(phone);
  if (email) {
    await form.getByRole('button', { name: 'Recevoir le code' }).click();
    await form.getByLabel('Adresse e-mail').fill(email);
  }
  for (let attempt = 1; ; attempt += 1) {
    await form.getByRole('button', { name: 'Recevoir le code' }).click();
    const sent = page.getByTestId('client-login-code');
    const throttled = page.getByText(/Trop de (tentatives|codes)/);
    await expect(sent.or(throttled).first()).toBeVisible();
    if ((await sent.isVisible()) || attempt === 4) break;
    await page.waitForTimeout(20_000);
  }
  await expect(page.getByTestId('client-login-code')).toBeVisible();
}

/** Saisie du code à 6 chiffres (validé dès le dernier chiffre). */
export async function typeSiteCode(page: Page, code: string): Promise<void> {
  await page
    .getByTestId('client-login-code')
    .getByLabel('Code à 6 chiffres')
    .pressSequentially(code);
}

/** Inscription complète d'un nouveau client sur le site (français). */
export async function signUpOnSite(
  page: Page,
  person: { firstName: string; lastName: string },
): Promise<{ e164: string }> {
  const phone = newMoroccanPhone();
  await page.goto('/connexion');
  await requestSiteCode(page, phone.typed);
  await typeSiteCode(page, await receivedCode(phone.e164));
  const signup = page.getByTestId('client-signup');
  await signup.getByLabel('Prénom').fill(person.firstName);
  await signup.getByLabel('Nom', { exact: true }).fill(person.lastName);
  await signup.getByTestId('privacy-consent').click();
  await signup.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page.getByTestId('client-account')).toBeVisible();
  return { e164: phone.e164 };
}

/**
 * Chargement d'une page du site par un client connecté : attend la reprise de la session (bouton
 * « Mon espace ») avant de continuer. Enchaîner deux chargements interromprait la rotation du
 * jeton de session, aussitôt prise pour une réutilisation (session fermée, par sécurité).
 */
export async function gotoSignedIn(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId('site-account-link')).toBeVisible();
}
