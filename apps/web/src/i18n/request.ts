import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_UI_LOCALE, isUiLocale, LOCALE_COOKIE } from './config';

/** Langue de la requête : cookie de préférence, sinon français. */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isUiLocale(stored) ? stored : DEFAULT_UI_LOCALE;

  return {
    locale,
    messages: (
      (await import(`../../messages/${locale}.json`)) as { default: Record<string, unknown> }
    ).default,
    // Fuseau par défaut ; les dates métier utilisent celui du traiteur (lib/format/date.ts)
    timeZone: 'Africa/Casablanca',
  };
});
