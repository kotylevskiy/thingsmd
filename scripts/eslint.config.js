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
      'no-async-promise-executor': 'error',
      'no-constant-binary-expression': 'error',
      'no-unsafe-finally': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: [
      'plugin/model.cjs',
      'plugin/task-status.cjs',
      'plugin/task-reference-deletion.cjs',
      'plugin/settings-model.cjs',
      'plugin/markdown-document.cjs',
      'plugin/lists.cjs',
      'plugin/local-date.cjs',
      'plugin/vault-time.cjs',
      'plugin/date-picker-model.cjs',
      'plugin/task-schedule.cjs',
      'plugin/archive-policy.cjs',
      'plugin/repeat-model.cjs',
      'plugin/search-model.cjs',
      'plugin/list-order.cjs',
    ],
    rules: {
      // Policies remain usable and testable without an Obsidian renderer.
      'no-restricted-modules': [
        'error',
        {
          paths: ['obsidian', 'electron', '@electron/remote'],
          patterns: ['@codemirror/*'],
        },
      ],
    },
  },
];
