// Flat ESLint config: framework presets first, then the package's own rules.
// The project should follow SOLID, DRY, and KISS principles, and the rules should be set to warn or error accordingly.
import js from '@eslint/js';
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
  'no-await-in-loop': 'warn',
  'no-return-await': 'warn',
  'prefer-promise-reject-errors': 'error',
};

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/__tests__/**', '**/*.test.ts', '*.js', '*.cjs', '*.mjs', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: productionRules },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'max-lines-per-function': 'off',
      'max-lines': 'off',
    },
  },
];
