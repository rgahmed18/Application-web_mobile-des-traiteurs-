import { getTestDatabaseUrl } from './test-database-url';

// Chaque worker Jest utilise la base de test.
process.env.DATABASE_URL = getTestDatabaseUrl();

// Photos publiques servies par le stockage local : jamais l'adresse réseau de recette
// (S3_PUBLIC_URL peut pointer sur l'IP Wi-Fi du PC, injoignable après un changement de réseau).
if (process.env.S3_ENDPOINT && process.env.S3_BUCKET) {
  process.env.S3_PUBLIC_URL = `${process.env.S3_ENDPOINT.replace(/\/+$/, '')}/${process.env.S3_BUCKET}`;
}
