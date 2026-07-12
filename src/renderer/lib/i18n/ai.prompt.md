<!-- Last verified: 2026-07-11 (GitHub Copilot device-auth copy is public-account appropriate and the retained Azure CLI runtime copy is service-neutral in both locales. Renderer i18n coverage spans core UI, settings, chat, agent editor, MCP/skills, overlays, toasts, dialogs, sidepanes, shared file viewers, Profile Memory UI, and error surfaces. Locale catalogs are split into sub-1000-line shards while preserving typed English/Simplified Chinese key parity, `translate()` interpolation/fallback, `useI18n()`, UiLanguageAtom, immediate app-config hydration, stale-update guards, and the diff-aware `npm run check:i18n` gate.) -->

# Renderer I18n

## Key Files

| File | Responsibility | Size |
|------|----------------|------|
| `index.ts` | Exposes `translate(language, key, params)` and translation key/param types. Owns catalog selection, default-language fallback, and `{param}` interpolation. | ~25 lines |
| `useI18n.ts` | React hook that reads `UiLanguageAtom`, exposes `setLanguage`, and returns a memoized `t()` for the active language. | ~20 lines |
| `locales/en.ts` | English catalog entry point. Imports `locales/en/enPart*.ts`, spreads them into `en`, and remains the type source for `TranslationKey`, `LocaleCatalog`, and `TranslationParams`. | ~15 lines |
| `locales/en/enPart*.ts` | English catalog shards. New English keys must be added to the appropriate shard first; keep each shard under the file-length limit. | ~552-660 lines each |
| `locales/zh-CN.ts` | Simplified Chinese catalog entry point. Imports `locales/zh-CN/zhCNPart*.ts` and applies `satisfies LocaleCatalog` so key coverage matches English without requiring identical literal values. | ~13 lines |
| `locales/zh-CN/zhCNPart*.ts` | Simplified Chinese catalog shards corresponding to the English shard layout. | ~552-660 lines each |
| `../../states/i18n.atom.ts` | App-wide UI language atom. Initializes from `appDataManager.getConfig()`, immediately hydrates from a read-only `appDataManager.fetchLatestConfig({ cache: false })` to cover missed startup pushes without emitting stale app-config notifications, subscribes to `app:configUpdated`, orders coalesced cross-window updates with `appDataManager.getConfigRevision()`, and saves changes through `appDataManager.updateConfig({ uiLanguage })`. | ~125 lines |

## Architecture

UI language is an app-level device preference, not a profile preference. Startup, sign-in, loading, settings, screenshot, and error surfaces can render before a profile exists, so the source of truth is `{userData}/app.json.uiLanguage` rather than `profile.json`.

The main process validates and persists the language via `AppConfig.uiLanguage`; the renderer consumes it through the existing `appDataManager` cache and `app:configUpdated` subscription. `UiLanguageAtom` also kicks off an immediate read-only `appDataManager.fetchLatestConfig({ cache: false })` hydration so startup does not wait for the manager's slow fallback if the initial main-process push was missed. Keeping that fetch read-only prevents a stale startup response from updating the shared cache or notifying subscribers after the user manually changes language. The startup fetch is additionally guarded by both the manual-change version and a config-subscription version, so a fetch response cannot overwrite a newer subscription update that arrived while the fetch was in flight. `UiLanguageAtom` is optimistic on save and rolls back if the latest `appDataManager.updateConfig()` returns `{ success: false }`; stale startup fetches, stale subscription pushes, and stale save completions must not override an in-flight or newer manual language change. While a manual language change is pending, mismatched subscription updates are ignored only while they are not known to be newer than the saved manual write. `AppCacheManager` supplies a non-persisted app-config revision through `app:updateAppConfig` and `app:configUpdated`, and `UiLanguageAtom` applies a coalesced subscription with a revision greater than the pending manual write so another window's newer persisted language cannot be ignored forever.

The English catalog is the schema source. `TranslationKey` is derived from `keyof typeof en`; `LocaleCatalog` is `Record<TranslationKey, string>` so TypeScript enforces key parity for every locale. `translate()` falls back to the default English catalog when a language catalog or key is missing, and falls back to the raw key only as a last resort.

## Common Changes

### Adding or moving UI copy

1. Add the English key/value to the appropriate `locales/en/enPart*.ts` shard.
2. Add the matching Simplified Chinese value to the corresponding `locales/zh-CN/zhCNPart*.ts` shard.
3. Replace hardcoded JSX text with `const { t } = useI18n()` and `t('key.path')`.
4. For dynamic values, use `{placeholder}` syntax in the catalog and pass params to `t(key, params)`.
5. Keep technical names, commands, product names, URLs, and user-provided text as dynamic values or literal technical strings when they should not be translated.
6. Run `npm run check:i18n` before review. The gate scans full changed renderer files, not only added lines. If it flags a deliberate technical literal, keep it as a literal only with a nearby `i18n-check-ignore` reason.

### Adding a new language

1. Add the language code to `SUPPORTED_UI_LANGUAGES` and the `UiLanguage` type in `src/main/lib/userDataADO/types/app.ts`.
2. Add locale catalog shard files under `locales/<language>/` and an entry-point file under `locales/` that `satisfies LocaleCatalog`.
3. Register the catalog in `index.ts`.
4. Add label/description keys for the new language in the Language settings page.
5. Update tests that assert supported-language coverage.

### Translating settings pages

Use `useI18n()` inside each view component rather than threading translated strings through unrelated parent props. Settings panels are route-mounted under the main app provider stack, and the screenshot entry also wraps in `<WithStore>` so app-wide atoms are available in both renderer entries.

### Translating non-component utilities

Pure utilities and atom actions cannot call `useI18n()`. Prefer passing a small translated-message callback from the React caller. If the utility is also used directly in tests or non-React contexts, keep an English fallback that preserves existing behavior.

## Gotchas

- `UiLanguageAtom` intentionally uses local supported-language constants instead of value-importing the main-process guard. Some renderer unit tests partially mock `@/lib/userData/types`; value imports from that module can collapse under those mocks.
- Success toasts after changing languages should use the target language, not the stale `t()` closure from the previous render. Use `translate(nextLanguage, key)` when the message is caused by the language change itself.
- Do not store language in `profile.json`. Profile switches must not change the global UI language, and pre-profile screens need the preference before profile hydration.
- Catalog values are the only normal place for Simplified Chinese text in source files. Code, comments, docs, test names, and commit/PR text should remain English unless they are explicit locale fixtures.
- Keep existing English copy stable when migrating strings. Many tests assert user-visible English text, punctuation, ellipses, arrows, and capitalization.
- Remaining literal UI-looking strings from hardcoded scans are expected to be technical placeholders, product names, protocol labels, sample docs, or user-provided/runtime values. Do not translate identifiers such as `HTTP`, `Git`, `Bun`, `uv`, `Python`, URLs, or binding-code placeholders.
- Never use `translate(DEFAULT_UI_LANGUAGE, ...)` for renderer UI. It pins text to English and bypasses the active app language. Startup/root fallback UI should read `appDataManager.getConfig().uiLanguage ?? DEFAULT_UI_LANGUAGE`.
- Do not add `t` to data-loading, active listener, or subscription effect dependencies unless changing language should genuinely rerun the effect. For file previews, editors with unsaved state, update listeners, download listeners, or streaming voice listeners, keep refs for localized async messages and latest callbacks/state so switching language does not reload data, discard dirty edits, or interrupt background work.
- `npm run check:i18n` is diff-aware and conservative. It scans full changed renderer files for hardcoded renderer UI literals, but it does not replace reviewer judgment for dynamic strings, multi-line JSX, secondary renderer entries, or product semantics.

## Related

- [Renderer architecture](../../../../ai.prompt/arch-render.md)
- [User data ADO](../../../main/lib/userDataADO/ai.prompt.md)
- [Atom state library](../../atom/ai.prompt.md)
