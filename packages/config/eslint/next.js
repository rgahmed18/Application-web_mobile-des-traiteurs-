import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

import { ignores, strictTypeScriptRules } from './base.js';

/**
 * Configuration ESLint pour l'application web Next.js.
 * @param {string} tsconfigRootDir dossier du projet (import.meta.dirname)
 */
export function createNextConfig(tsconfigRootDir) {
  return defineConfig([
    ignores,
    ...nextVitals,
    ...nextTs,
    {
      files: ['**/*.{ts,tsx}'],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: strictTypeScriptRules,
    },
    prettier,
  ]);
}
