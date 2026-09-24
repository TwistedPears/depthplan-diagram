import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y-x';
import globals from 'globals';

export default [
  {
    ignores: [
      'out/**',
      'coverage/**',
      '.tmp/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'src-tauri/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  { languageOptions: { globals: { ...globals.node } } },
  {
    files: ['src/renderer/**/*', 'src/__tests__/**/*'],
    languageOptions: { globals: { ...globals.browser, ...globals.jest } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Existing canvas attribute maps are gradually typed at their boundaries.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  { files: ['src/**/*.tsx'], ...a11y.configs.recommended },
];
