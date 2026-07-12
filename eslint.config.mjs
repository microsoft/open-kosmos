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

  // Design-system guard: forbid raw hex color literals in renderer source.
  // This mirrors the whole-tree gate in scripts/check-design-tokens.js
  // (`hardcodedHexLiterals`, hard-zero): every renderer color must flow through a
  // design token -- a Tailwind palette utility (e.g. text-primary-600) or a
  // var(--color-*) defined in globals.css -- never a raw #rgb/#rgba/#rrggbb/#rrggbbaa
  // literal. The rule gives developers an inline editor error the moment a raw hex
  // is typed, before CI runs.
  //
  // The `ignores` below must stay in sync with SANCTIONED_TSX_REGIONS in
  // scripts/check-design-tokens.js: the screenshot BrowserWindow (separate
  // window, no globals.css), the index.tsx fatal-error fallback (must render
  // without any CSS), and the content-excluded Memex part are the gate's
  // physically/policy-forced carve-outs (counted under sanctionedTsxHexLiterals,
  // not hardcodedHexLiterals). Test files are excluded too -- they legitimately
  // assert token hex values -- exactly as the gate skips *.test/*.spec/__tests__.
  // The `(?<!&)` lookbehind excludes HTML numeric entities (e.g. &#039;), matching
  // the gate's countHexInText regex byte-for-byte.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ignores: [
      '**/*.{test,spec}.{ts,tsx}',
      '**/__tests__/**',
      'src/renderer/screenshot/**',
      'src/renderer/index.tsx',
      'src/renderer/components/chat/MemexMemorySidepaneParts.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\\b/]",
          message:
            'Raw hex color literal is forbidden in renderer source. Use a design token instead: a Tailwind palette utility (e.g. text-primary-600) or var(--color-*) from globals.css. See ai.prompt/design-system.md. (Also enforced whole-tree by scripts/check-design-tokens.js.)',
        },
        {
          selector:
            "TemplateElement[value.cooked=/(?<!&)#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\\b/]",
          message:
            'Raw hex color literal is forbidden in renderer source. Use a design token instead: a Tailwind palette utility (e.g. text-primary-600) or var(--color-*) from globals.css. See ai.prompt/design-system.md. (Also enforced whole-tree by scripts/check-design-tokens.js.)',
        },
      ],
    },
  },
);
