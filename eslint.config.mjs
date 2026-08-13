// Flat ESLint config: framework presets first, then the package's own rules.
// The project should follow SOLID, DRY, and KISS principles, and the rules should be set to warn or error accordingly.
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import * as jsoncParser from 'jsonc-eslint-parser';
import tseslint from 'typescript-eslint';

// `eslint-plugin-n8n-nodes-base` ships eslintrc-style presets, so they are pulled
// into this flat config through the compatibility layer.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const productionRules = {
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-unused-vars': [
    'error',
    { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
  ],
  complexity: ['warn', { max: 15 }],
  'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
  'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
  'max-params': ['warn', { max: 5 }],
  'max-depth': ['warn', { max: 4 }],
  'max-nested-callbacks': ['warn', { max: 3 }],
  'prefer-const': 'error',
  'no-var': 'error',
  eqeqeq: ['error', 'always'],
  'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
  'no-debugger': 'error',
  'no-duplicate-imports': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  curly: ['error', 'all'],
  'default-case': 'warn',
  'no-else-return': ['warn', { allowElseIf: false }],
  'prefer-template': 'warn',
  'object-shorthand': ['warn', 'always'],
  'arrow-body-style': ['warn', 'as-needed'],
  'prefer-arrow-callback': 'warn',
  'no-useless-return': 'warn',
  'no-useless-concat': 'warn',
  'prefer-destructuring': ['warn', { array: false, object: true }],
  'no-unreachable': 'error',
  'no-constant-condition': 'error',
  'no-duplicate-case': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-extra-semi': 'error',
  'no-irregular-whitespace': 'error',
  'valid-typeof': 'error',
  'no-cond-assign': ['error', 'always'],
  'no-await-in-loop': 'warn',
  'no-return-await': 'warn',
  'prefer-promise-reject-errors': 'error',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', '**/__tests__/**', '**/*.test.ts', '*.js', '*.cjs', '*.mjs', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: productionRules },
  {
    // n8n's convention is one flat resource/operation switch inside
    // `execute`/`poll`, so those methods are long by design.
    files: ['**/*.node.ts'],
    rules: { 'max-lines-per-function': 'off', complexity: 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
    },
  },

  /*
   * n8n's own node standards — the same presets n8n runs when a community node is
   * submitted for verification, so `npm run lint` is that check rather than an
   * approximation of it. A rule this package deliberately disagrees with is turned
   * off here, with the reason; anything else it reports is a real finding.
   */
  ...compat.extends('plugin:n8n-nodes-base/community').map((config) => ({
    ...config,
    files: ['package.json'],
    languageOptions: { parser: jsoncParser },
  })),
  ...compat.extends('plugin:n8n-nodes-base/credentials').map((config) => ({
    ...config,
    files: ['credentials/**/*.ts'],
    rules: {
      ...config.rules,
      // Both expect the slug a node in n8n's own repository uses, which resolves
      // against their docs site. A community credential documents itself, so the
      // field holds the URL that actually helps the reader.
      'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
      'n8n-nodes-base/cred-class-field-documentation-url-missing': 'off',
    },
  })),
  ...compat.extends('plugin:n8n-nodes-base/nodes').map((config) => ({
    ...config,
    files: ['nodes/**/*.ts'],
  })),
];
