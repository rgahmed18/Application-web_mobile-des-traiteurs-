import type { Config } from 'jest';

/** Tests unitaires : rapides, sans base de données ni Redis. */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // Le client Prisma généré importe ses modules avec l'extension .js (résolution nodenext)
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
};

export default config;
