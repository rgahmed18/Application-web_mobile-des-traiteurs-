import expoConfig from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

import { ignores, strictTypeScriptRules } from './base.js';

/**
 * Configuration ESLint pour les applications Expo et la bibliothèque mobile-ui.
 * @param {string} tsconfigRootDir dossier du projet (import.meta.dirname)
 */
export function createExpoConfig(tsconfigRootDir) {
  return defineConfig([
    ignores,
    expoConfig,
    {
      files: ['**/*.{ts,tsx}'],
      extends: [tseslint.configs.recommendedTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        ...strictTypeScriptRules,
        // Les gestionnaires React (onPress) peuvent être asynchrones
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
      },
    },
    prettier,
  ]);
}
