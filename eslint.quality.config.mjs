// The package's own rules: SOLID, DRY and KISS, set to warn or error accordingly.
//
// They live outside `eslint.config.mjs` because that file has to stay byte-for-byte
// the one `@n8n/node-cli` ships — `n8n-node lint` compares it and refuses to run on
// a modified config while `"strict": true` is set in package.json, which is what
// keeps the package eligible for n8n cloud support. n8n's own node standards come
// from that default config; everything here is on top of it.
//
// Run with `npm run lint:quality` (ESLint only auto-loads `eslint.config.*`, so this
// file is never picked up by `npm run lint`).
//
// It layers on top of n8n's config rather than standing beside it: the code carries
// `eslint-disable` comments for n8n's own rules, and ESLint fails on a directive that
// names a rule it cannot resolve — so the plugins have to be loaded here too.
import { config as n8nConfig } from '@n8n/node-cli/eslint';
import tseslint from 'typescript-eslint';

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
  // No `no-await-in-loop`: n8n's own config does not ask for it, and every loop here
  // that awaits does so deliberately (pagination, retries, one write at a time), so
  // the rule only ever produced directives to suppress it.
  'no-return-await': 'warn',
  'prefer-promise-reject-errors': 'error',
};

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '**/__tests__/**',
      '**/*.test.ts',
      '*.js',
      '*.cjs',
      '*.mjs',
      'coverage/**',
      // n8n's config parses package.json with the TypeScript parser to run its own
      // package rules over it; `npm run lint` is where that check belongs, and the
      // TypeScript rules layered on below have nothing to say about a JSON file
      'package.json',
    ],
  },
  ...n8nConfig,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: productionRules },
  {
    // n8n's convention is one flat resource/operation switch inside
    // `execute`/`poll`, so those methods are long by design.
    files: ['**/*.node.ts'],
    rules: { 'max-lines-per-function': 'off', complexity: 'off' },
  },
];
