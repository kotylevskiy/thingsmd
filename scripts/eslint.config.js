import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'vaults/**', 'artifacts/**'] },
  {
    files: ['plugin/**/*.cjs', 'plugin/**/*.js', 'tests/**/*.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
        app: 'readonly',
        createDiv: 'readonly',
        createEl: 'readonly',
        createSpan: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-duplicate-case': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'valid-typeof': 'error',
    },
  },
];
