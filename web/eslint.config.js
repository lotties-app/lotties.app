import js from '@eslint/js';
import globals from 'globals';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Every user-visible string goes through t() (docs/DESIGN.md section 9): JSX text and the
    // attributes that carry text must not be literals. Technical props (variant, sx, role, ...)
    // are not checked.
    ...i18next.configs['flat/recommended'],
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx', 'src/test/**'],
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            // Only attributes that carry text a user can read or hear are checked.
            include: [
              'aria-label',
              'aria-description',
              'label',
              'placeholder',
              'title',
              'alt',
              'helperText',
              'message',
              'primary',
              'secondary',
              'titleAccess',
            ],
            exclude: [],
          },
        },
      ],
    },
  },
  prettier,
);
