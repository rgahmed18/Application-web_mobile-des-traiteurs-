import { getTestDatabaseUrl } from './test-database-url';

// Chaque worker Jest utilise la base de test.
process.env.DATABASE_URL = getTestDatabaseUrl();

// Photos publiques servies par le stockage local : jamais l'adresse réseau de recette
// (S3_PUBLIC_URL peut pointer sur l'IP Wi-Fi du PC, injoignable après un changement de réseau).
if (process.env.S3_ENDPOINT && process.env.S3_BUCKET) {
  process.env.S3_PUBLIC_URL = `${process.env.S3_ENDPOINT.replace(/\/+$/, '')}/${process.env.S3_BUCKET}`;
}

// Espaces : choix du traiteur (démonstration) et back-office des traiteurs sur leurs sous-domaines
// (*.localhost) autorisés à appeler l'API, comme en développement.
process.env.DEMO_SPACE_SELECTION = 'true';
process.env.CORS_ORIGINS = [process.env.CORS_ORIGINS, 'http://*.localhost:3001']
  .filter(Boolean)
  .join(',');

// Espaces : toujours les valeurs de développement (localhost), jamais celles de la démo sur le
// réseau local (TENANT_BASE_DOMAIN=<IP>.nip.io dans .env) dont les tests ne doivent pas dépendre.
process.env.TENANT_BASE_DOMAIN = 'localhost';
process.env.PLATFORM_HOSTNAMES = 'localhost';
process.env.TENANT_URL_TEMPLATE = 'http://{slug}.localhost:3001';
process.env.PUBLIC_WEB_URL = 'http://localhost:3001';
