import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_UI_LOCALE, isUiLocale, LOCALE_COOKIE } from './config';

/**
 * Langue de la requête : celle demandée explicitement (page publique d'un devis, dans la langue
 * du client), sinon le cookie de préférence, sinon le français.
 */
export default getRequestConfig(async ({ locale: requested }) => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isUiLocale(requested)
    ? requested
    : isUiLocale(stored)
      ? stored
      : DEFAULT_UI_LOCALE;

  return {
    locale,
    messages: (
      (await import(`../../messages/${locale}.json`)) as { default: Record<string, unknown> }
    ).default,
    // Fuseau par défaut ; les dates métier utilisent celui du traiteur (lib/format/date.ts)
    timeZone: 'Africa/Casablanca',
  };
});
