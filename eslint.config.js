import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // We picked JS, no runtime prop checks
      'react/prop-types': 'off',
      // Vite + automatic JSX runtime
      'react/react-in-jsx-scope': 'off',
      // Allow unused args and caught errors prefixed with _
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // The morph/playback effects intentionally don't list every closure dep
      'react-hooks/exhaustive-deps': 'warn',
      // TweaksPanel reads ref.current in render to position the dragged panel —
      // works because state changes drive re-renders. This rule is React-19-era;
      // we're on 18.
      'react-hooks/refs': 'off',
    },
    settings: { react: { version: '18.3.1' } },
  },
  {
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, vi: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' },
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
