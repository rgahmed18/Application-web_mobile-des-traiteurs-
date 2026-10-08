import type messages from '../../messages/fr.json';
import type { UiLocale } from './config';

// Clés de traduction typées : une clé absente de fr.json est une erreur de compilation.
// La parité fr / ar est vérifiée par src/i18n/messages.spec.ts.
declare module 'next-intl' {
  interface AppConfig {
    Locale: UiLocale;
    Messages: typeof messages;
  }
}
