<!-- Last verified: 2026-04-29 -->
# Feature Flags

> Main-process singleton that defines, resolves, and serves feature flag values to both the main process and renderer via IPC.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `types.ts` | `FeatureFlagName` union type, `FeatureFlagConfig`, `FeatureFlagState`, `FeatureFlagsMap`, `FeatureFlagsValues`, `FeatureFlagContext` | small |
| `featureFlagDefinitions.ts` | `FEATURE_FLAG_DEFINITIONS` array — all flag configs with static or context-derived defaults; helper functions `resolveDefaultValue`, `getFeatureFlagConfig`, `getAllFeatureFlagNames` | medium |
| `featureFlagManager.ts` | `FeatureFlagManager` singleton — initializes context (`isDev`, `brandName`, `platform`, `arch`), resolves defaults, parses `--enable-features`/`--disable-features` CLI args; exports `featureFlagManager`, `isFeatureEnabled`, `getAllFeatureFlags` | medium |
| `index.ts` | Re-exports all public types, configs, and manager helpers | small |

## Architecture

**Single source of truth in main process.** At startup, `featureFlagManager.initialize()` is called once in `main.ts`. It:
1. Detects `isDev` from `NODE_ENV === 'development'` or `--dev` argv.
2. Resolves each flag's `defaultValue` — static `boolean` or `(ctx: FeatureFlagContext) => boolean`.
3. Overrides resolved values with any `--enable-features=a,b` / `--disable-features=c` CLI args (`source: 'cli'`).

**IPC bridge.** `preload.ts` exposes `window.electronAPI.featureFlags.getAllFlags()` and `featureFlags.isEnabled(name)` — backed by `featureFlags:getAllFlags` / `featureFlags:isEnabled` IPC channels registered in `main.ts`.

**Renderer cache.** `src/renderer/lib/featureFlags/featureFlagCacheManager.ts` fetches all flags once on renderer init (called from `src/renderer/index.tsx`), stores them in `localStorage` as a version-gated fallback, and provides synchronous `isFeatureEnabled(name)` + `useFeatureFlag(name)` React hook for components.

**Flag lifecycle:** define → resolve at boot → serve via IPC → cache in renderer → consume synchronously. Flags are read-only at runtime; there is no live reload.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new flag | 1. `types.ts` (`FeatureFlagName` union) → 2. `featureFlagDefinitions.ts` (add `FeatureFlagConfig` entry) | Naming convention: `openkosmosFeatureXXXXX`; exception: `browserControl` (legacy) |
| Change a flag's default logic | `featureFlagDefinitions.ts` — edit `defaultValue` | Use `(ctx) => ...` for env/brand/platform conditions |
| Enable a flag for testing | Launch with `--enable-features=flagName`; no code change needed | CLI source overrides any `defaultValue` |
| Consume a flag in main process | `import { isFeatureEnabled } from './lib/featureFlags'` | Manager must be initialized first |
| Consume a flag in renderer | `import { useFeatureFlag } from '../../lib/featureFlags'` (React hook) or `isFeatureEnabled(name)` (non-hook) | Both read from `featureFlagCacheManager` |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `FeatureFlagName` in `types.ts` | `featureFlagDefinitions.ts` — add matching `FeatureFlagConfig` entry |
| `featureFlagDefinitions.ts` | Renderer cache invalidates automatically (version key `1.0` is static); no manual cache bump needed unless you change `FeatureFlagsValues` shape |
| IPC channel names in `main.ts` | `preload.ts` `featureFlags` API surface |

## Anti-Patterns
- Do NOT read `process.env.NODE_ENV` directly in feature-gated code — use `isFeatureEnabled()` so the flag can be overridden via CLI.
- Do NOT add flags to the renderer-side `featureFlagCacheManager` type — it deliberately uses `string` keys to stay decoupled from the main-process `FeatureFlagName` type.
- Do NOT call `featureFlagManager.initialize()` more than once — it is idempotent but logs a warning on repeat calls.
- Do NOT mutate flags after initialization — there is no setter; runtime toggling is unsupported.

## Verification Steps
1. Add flag name to `FeatureFlagName` in `types.ts` and entry to `FEATURE_FLAG_DEFINITIONS` in `featureFlagDefinitions.ts`.
2. Run `npm test` — `featureFlagDefinitions.test.ts` validates that every `FeatureFlagName` has a matching definition and that `resolveDefaultValue` works for both static and dynamic defaults.
3. Launch in dev mode; check the console for `[FeatureFlags] Current state:` log output confirming the new flag appears.
4. Verify renderer consumption: open DevTools → Application → Local Storage → look for `openkosmos_feature_flags_cache` key and confirm the new flag is present.

## Gotchas
- ⚠️ `isDev` is resolved once at `initialize()` time. If `--dev` is not in `process.argv` and `NODE_ENV` is not `'development'`, all `(ctx) => ctx.isDev` flags default to `false` in production builds.
- ⚠️ `browserControl` does not follow the `openkosmosFeature` naming convention — it is a legacy name; do not use it as a template.
- ⚠️ If the renderer's IPC call fails (e.g., during cold start), `featureFlagCacheManager` silently falls back to `localStorage`. A stale cache could serve outdated values until the next successful sync.
- ⚠️ `CURRENT_CACHE_VERSION` in the renderer cache manager is hardcoded to `'1.0'`. If you add flags that change the shape of `FeatureFlagsValues`, bump this constant to force a cache refresh.

## Related
- Depends on: `@shared/constants/branding` (`BRAND_NAME`), `src/main/lib/unifiedLogger` (logging)
- Depended by: `src/main/main.ts` (init + IPC handlers), `src/preload/main.ts` (IPC bridge), `src/renderer/lib/featureFlags/` (renderer cache + hooks), virtually every feature module that gates UI or tools behind a flag
