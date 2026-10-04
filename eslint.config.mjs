import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
export default defineConfig([
  globalIgnores([
    '.next/**',
    '.next-operations/**',
    '.tools/**',
    'windows/**/bin/**',
    'windows/**/obj/**',
    'windows/artifacts/**',
    'node_modules/**',
    'data/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'public/sw.js',
  ]),
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': hooks, 'jsx-a11y': a11y },
    rules: { ...hooks.configs.recommended.rules, ...a11y.configs.recommended.rules },
  },
]);
