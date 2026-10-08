import 'dotenv/config';

/**
 * URL de la base de test. Garde-fou : le nom de la base doit se terminer par « _test »,
 * pour qu'une erreur de configuration ne puisse jamais effacer une base de développement.
 */
export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL est requis pour les tests d’intégration');
  const databaseName = new URL(url).pathname.replace('/', '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Refus d'utiliser la base « ${databaseName} » : son nom doit finir par _test`);
  }
  return url;
}
