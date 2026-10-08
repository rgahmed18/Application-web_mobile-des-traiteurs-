import { getTestDatabaseUrl } from './test-database-url';

// Chaque worker Jest utilise la base de test.
process.env.DATABASE_URL = getTestDatabaseUrl();
