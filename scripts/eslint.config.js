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
      'no-restricted-globals': ['error', 'parent', 'event', 'name'],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='waitForFunction'] > ArrowFunctionExpression[async=true]",
          message: 'Use waitForAsync so the resolved condition is polled.',
        },
      ],
      'no-unreachable': 'error',
      'no-duplicate-case': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'valid-typeof': 'error',
    },
  },
];
