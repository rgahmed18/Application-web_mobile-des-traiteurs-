// Importé EN PREMIER par worker.ts : Sentry doit être initialisé avant les autres modules.
import { initSentry, sentrySettingsFromEnv } from './sentry';

initSentry('worker', sentrySettingsFromEnv());
