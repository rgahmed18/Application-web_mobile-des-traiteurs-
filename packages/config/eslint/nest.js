import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { createBaseConfig } from './base.js';

/**
 * Configuration ESLint pour l'API NestJS.
 * @param {string} tsconfigRootDir dossier du projet (import.meta.dirname)
 */
export function createNestConfig(tsconfigRootDir) {
  return defineConfig([
    createBaseConfig(tsconfigRootDir),
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.jest },
      },
      rules: {
        // Les modules NestJS sont des classes vides décorées
        '@typescript-eslint/no-extraneous-class': 'off',
      },
    },
  ]);
}
