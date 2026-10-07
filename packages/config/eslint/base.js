import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** Dossiers jamais analysés, quel que soit le projet. */
export const ignores = globalIgnores([
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/.next/**',
  '**/.expo/**',
  '**/generated/**',
  '**/next-env.d.ts',
  '**/expo-env.d.ts',
]);

/** Règles TypeScript strictes communes (analyse typée : interdit "any" et ses usages implicites). */
export const strictTypeScriptRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  eqeqeq: ['error', 'always'],
  'no-console': ['warn', { allow: ['warn', 'error'] }],
};

/**
 * Configuration de base pour les paquets TypeScript (bibliothèques, API).
 * @param {string} tsconfigRootDir dossier du projet (import.meta.dirname)
 */
export function createBaseConfig(tsconfigRootDir) {
  return defineConfig([
    ignores,
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: strictTypeScriptRules,
    },
    {
      // Fichiers JS de configuration : hors projet TypeScript
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  ]);
}
