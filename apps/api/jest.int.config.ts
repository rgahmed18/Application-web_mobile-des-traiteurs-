import type { Config } from 'jest';

/**
 * Tests d'intégration : base PostgreSQL réelle (TEST_DATABASE_URL), recréée à chaque exécution.
 * Lancement : pnpm --filter @traiteur/api test:int (docker compose up requis).
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/integration/.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  setupFiles: ['<rootDir>/test/integration/load-env.ts'],
  testEnvironment: 'node',
  testTimeout: 60_000,
};

export default config;
