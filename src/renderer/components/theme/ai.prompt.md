<!-- Last verified: 2026-07-11 -->
# Theme Provider

> App-wide appearance bridge for the main renderer window. It resolves the persisted app-level
> appearance preference (`light` / `dark` / `system`) into the effective DOM theme and applies it
> before routed UI and provider children render.

## Key Files
| File | Responsibility | Size |
|------|----------------|------|
| `ThemeProvider.tsx` | Reads the synchronous startup seed from `appDataManager`, listens for app-config updates, follows `prefers-color-scheme` when `themeSource` is `system`, and writes `document.documentElement.dataset.theme` + `style.colorScheme` with a layout effect. | ~75 LOC |
| `__tests__/ThemeProvider.test.tsx` | Happy DOM coverage for default light mode, explicit dark mode, app-config subscription updates, system media-query changes, missing `matchMedia`, cleanup, and resolver internals. | ~165 LOC |

## Architecture
- **Provider position matters.** `ThemeProvider` is the outermost main-window provider in `App.tsx`, wrapping `ToastProvider`, update/auth/profile providers, and routed content. This ensures toast chrome and all downstream UI see `html[data-theme]` before they render.
- **Light is the default and baseline.** Missing `AppConfig.appearance` resolves to `DEFAULT_THEME_SOURCE = 'light'`; Light mode must remain the pre-dark-mode visual baseline.
- **Startup seed prevents first-frame flash.** `main.ts` reads persisted `appearance.themeSource` through `AppCacheManager.readStartupThemeSourceSync()` before the async AppCacheManager initialization path, passes that source into preload via `BrowserWindow.webPreferences.additionalArguments`, preload exposes it through `appConfig.getInitialAppConfig()`, and `AppDataManager` seeds its cache before React renders. `ThemeProvider` then writes the effective DOM theme in a layout effect, while the main window background color is already set from the same persisted source through the shared main-process `windowTheme` helper.
- **Two inputs, one DOM output.** The persisted `appearance.themeSource` comes from `appDataManager.getConfig()` / `appDataManager.subscribe()`. The OS preference comes from `window.matchMedia('(prefers-color-scheme: dark)')` only when the source is `system`. The only side effects are `data-theme` and CSS `color-scheme` on `document.documentElement`.
- **Persistence is owned outside this module.** The Appearance settings page writes `appearance.themeSource` through `appDataManager.updateConfig()`, and the main-process `AppCacheManager` sanitizes/persists it in `app.json` while syncing Electron `nativeTheme`.
- **CSS is token-driven.** ThemeProvider never toggles classes on individual components. Dark rendering depends on semantic/component tokens and `[data-theme="dark"]` rules in `src/renderer/styles/globals.css` and feature CSS.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|-----------------|-------|
| Add a new theme source | `ThemeProvider.tsx`, `src/main/lib/userDataADO/types/app.ts`, `AppearanceSettingsView.tsx`, `AppCacheManager`, tests | Update validation/defaulting, renderer resolution, settings UI, nativeTheme sync, and persistence sanitizer together. |
| Change effective theme resolution | `ThemeProvider.tsx`, `__tests__/ThemeProvider.test.tsx`, `src/main/lib/userDataADO/appCacheManager.ts` | Keep renderer DOM theme and Electron `nativeTheme` behavior aligned, especially for `system`. |
| Change startup theme seeding | `src/shared/constants/startupTheme.ts`, `src/main/main.ts`, `src/main/lib/userDataADO/appCacheManager.ts`, `src/main/lib/windowTheme.ts`, `src/preload/main.ts`, `src/renderer/lib/userData/appDataManager.ts`, `ThemeProvider.tsx`, tests | Keep the BrowserWindow background, preload seed, and renderer first render aligned so persisted dark/system mode does not flash light on cold start. |
| Add/rename theme DOM attributes | `ThemeProvider.tsx`, `globals.css`, feature CSS, `ai.prompt/design-system.md`, real dark audit script | `data-theme` is the selector contract used across renderer CSS and audits. |
| Change Appearance settings behavior | `AppearanceSettingsView.tsx`, `ThemeProvider.tsx`, `AppCacheManager` tests | Settings writes should update the provider through app-config push events; do not add a separate renderer-only theme store. |

## Co-Change Map
| When you change | Also check/update |
|-----------------|-------------------|
| `ThemeProvider` provider order in `App.tsx` | `ai.prompt/arch-render.md`, this file, and smoke tests that render `App` readiness/main provider paths |
| `appearance.themeSource` type/default | `src/main/lib/userDataADO/types/app.ts`, `appCacheManager.ts`, `AppearanceSettingsView.tsx`, `ThemeProvider.test.tsx`, `AppearanceSettingsView.test.tsx` |
| DOM theme selector (`data-theme`) | `src/renderer/styles/globals.css`, feature CSS dark overrides, `scripts/check-design-tokens.js`, dark visual audit artifacts/scripts |
| App-config subscription behavior | `appDataManager.ts`, `ThemeProvider.test.tsx`, any main-process `app:configUpdated` contract changes |
| System theme handling | `ThemeProvider.tsx`, `src/main/lib/windowTheme.ts`, Electron `nativeTheme` handling in `AppCacheManager`, tests for media-query/nativeTheme branch parity |

## Gotchas
- Do not move `ThemeProvider` inside `ToastProvider`; toasts and dialogs need the effective theme before they render.
- Do not make the initial theme depend only on the async `app:configUpdated` push. The renderer must have the preload seed before first render, and ThemeProvider must apply it before paint.
- Do not duplicate the startup theme process argument string. `src/shared/constants/startupTheme.ts` is the contract shared by main, preload, and tests.
- Do not read profile-scoped settings here. Appearance is app-level (`app.json`), not profile-level.
- Do not use OS `prefers-color-scheme` CSS branches directly in component CSS. The app controls theme through `data-theme`, and `system` mode is resolved centrally here.
- Do not invent fallback-free CSS token names while adding theme rules. `check:design` now fails unresolved `var(--token)` references because Chromium drops the whole declaration when a token is missing.

## Related
- Depends on: `src/renderer/lib/userData/appDataManager.ts`, `src/renderer/lib/userData/types`, `src/shared/constants/startupTheme.ts`, `src/main/lib/userDataADO/types/app.ts`, `src/main/lib/userDataADO/appCacheManager.ts`, `src/main/lib/windowTheme.ts`.
- Depended by: `src/renderer/App.tsx`, `src/renderer/components/settings/AppearanceSettingsView.tsx`, renderer CSS dark-mode selectors in `src/renderer/styles/`, and the real dark visual audit script.
