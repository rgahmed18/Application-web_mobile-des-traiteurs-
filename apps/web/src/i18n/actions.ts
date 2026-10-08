'use server';

import { cookies } from 'next/headers';

import { isUiLocale, LOCALE_COOKIE, type UiLocale } from './config';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Enregistre la langue choisie ; la page est ensuite rafraîchie par l'appelant. */
export async function setLocale(locale: UiLocale): Promise<void> {
  if (!isUiLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
  });
}
