import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-vite/**',
      'build/**',
      'release/**',
      'scripts/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      '.babelrc.js',
      'webpack.*.config.js',
      'tailwind.config.js',
      'postcss.config.js',
      'electron-builder.config.js',
      'test-mcp-fetcher.js',
      'updater/**',
    ],
  },

  // Base recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // React + JSX configuration
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React rules
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Allow require() for Electron/Node.js patterns
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
