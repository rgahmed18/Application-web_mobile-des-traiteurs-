// Importé EN PREMIER par main.ts : Sentry doit être initialisé avant les autres modules.
import { initSentry, sentrySettingsFromEnv } from './sentry';

initSentry('api', sentrySettingsFromEnv());
