# UI Internationalization Tech Doc

## Overview

Renderer UI internationalization is implemented with a typed locale catalog and an app-level language preference. English is the schema source and default fallback. Simplified Chinese is a parity-checked catalog. Components read translations through `useI18n()` and persist changes through the existing app config data path.

## Data Model

`AppConfig` includes:

```ts
uiLanguage?: 'en' | 'zh-CN'
```

The value is stored in `{userData}/app.json` because UI language must be available before profile hydration and must not change when switching profiles. Unsupported or missing values resolve to English.

## Renderer Architecture

Key files:

| File | Responsibility |
|------|----------------|
| `src/renderer/lib/i18n/index.ts` | Supported language list, `translate()`, fallback behavior, interpolation, and exported types. |
| `src/renderer/lib/i18n/useI18n.ts` | React hook exposing the active language, `setLanguage`, and `t()`. |
| `src/renderer/lib/i18n/locales/en.ts` | English catalog entry point and `TranslationKey` source. |
| `src/renderer/lib/i18n/locales/zh-CN.ts` | Simplified Chinese catalog entry point using `satisfies LocaleCatalog` for key parity. |
| `src/renderer/states/i18n.atom.ts` | App-wide atom that initializes from `appDataManager`, listens for config updates, and persists user changes. |
| `src/renderer/components/settings/LanguageSettingsView.tsx` | Settings UI for selecting the active UI language. |

Locale catalogs are split into shard files so each file stays below the renderer file-length limit. New UI copy must be added to English first, then to the corresponding Simplified Chinese shard.

## Main/Renderer Flow

1. Main process loads `app.json` through the app data manager and validates `uiLanguage`.
2. Renderer startup reads cached app config through `appDataManager.getConfig()`.
3. `UiLanguageAtom` normalizes the value to a supported language and exposes it to React components.
4. `useI18n()` returns a memoized `t(key, params)` function for the active language.
5. Updating language calls `appDataManager.updateConfig({ uiLanguage })`; main-process app-config writes are serialized, then `app:configUpdated` synchronizes all renderer entries.

## Translation Rules

Translate renderer-authored UI copy including visible labels, aria labels, titles, placeholders, dialog text, empty states, and toasts. Do not translate:

1. Brand names such as OpenKosmos, GitHub, Bing, and Edge.
2. Protocol/tool identifiers such as MCP, memex_memory, profile-memory, HTTP, JSON, YAML, and file extensions.
3. User-provided content, model output, file contents, command output, logs, URLs, or code identifiers.
4. Runtime values that are passed through from tools or remote services.

## Development Rules

1. Add English catalog keys first. English remains the schema source for `TranslationKey`; every locale must satisfy the same key set.
2. Add the Simplified Chinese value in the matching shard before wiring the UI. Do not leave placeholder English in the Chinese catalog.
3. Use `useI18n()` in React components and `t(key, params)` for visible copy. Non-React helpers should receive translated strings or an explicit active-language translator from their caller.
4. Never call `translate(DEFAULT_UI_LANGUAGE, ...)` for renderer UI. Use the active language from `useI18n()`, `UiLanguageAtom`, `appDataManager.getConfig().uiLanguage`, or another current-language source.
5. Keep language changes independent from data-loading effects. Effects that load files, conversations, remote data, streaming/background work, or unsaved editor state must not depend on `t`; use a ref for translated error messages when the effect should not rerun on language change. Manual language changes must ignore stale save completions and stale config notifications so only the latest user-selected language can persist.
6. Localize auxiliary renderer entries, not only the main React tree. This includes the screenshot window, startup/root fallback UI, overlays, context menus, toasts, dialogs, tooltips, and accessibility labels.
7. Keep technical identifiers as literals or dynamic values when translation would change their meaning. If a scanner exclusion is required, document the reason near the literal with `i18n-check-ignore`.

## CI I18n Audit

`npm run check:i18n` runs `scripts/check-i18n.js`, a diff-aware gate that scans full changed renderer source files. The PR workflow `PR I18n Check` invokes it with the pull request base and head refs and writes an `i18n-report.md` job summary.

The gate fails on unlocalized renderer-owned copy in changed files:

1. Hardcoded JSX text in renderer UI.
2. Hardcoded user-facing string attributes such as `title`, `aria-label`, `placeholder`, `alt`, `label`, and `description`.
3. Hardcoded toast, alert, confirmation, and renderer error messages.
4. `translate(DEFAULT_UI_LANGUAGE, ...)` in renderer code.

The gate excludes locale catalogs, tests, TypeScript declaration files, technical code tags, URLs, i18n keys, protocol identifiers, and runtime/user content. It supports a frozen hardcoded-copy baseline for known legacy or technical false positives, and rejects new baseline entries once the baseline exists on the target branch. It is intentionally conservative and diff-aware: reviewers still own broader semantic checks such as multi-line JSX, dynamic message composition, and whether a literal is truly technical.

## PR Review Checklist

Reviewers should block a PR when it adds renderer-owned UI text without catalog entries, fixes the language to English, omits the Simplified Chinese catalog value, leaves a secondary renderer entry untranslated, or causes language switching to reload data, drop unsaved state, or disrupt active streaming/background work. Review should also confirm docs stay accurate when i18n behavior or governance changes.

## Testing and Verification

Relevant verification includes:

1. TypeScript type checking for catalog parity and translation key usage.
2. Unit tests for supported-language validation, `translate()` fallback/interpolation, and `UiLanguageAtom` persistence.
3. Renderer tests for the Language settings page.
4. `npm run check:i18n` for hardcoded renderer-owned UI strings in changed files, with exclusions for technical identifiers and runtime/user-provided values.
