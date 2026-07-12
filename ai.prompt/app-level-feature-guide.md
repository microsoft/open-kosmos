<!-- Last verified: 2026-06-09 -->
# App-Level Feature Guide — Master Switch in app.json (NOT a feature flag)

> How to add a global, user-toggleable feature gated by a master switch in `app.json`
> (Settings → *Feature*, default **off**), instead of a developer feature flag.
> Reference implementations: **embedded browser** (`browser.enabled`) and **memex memory** (`memex.enabled`).

## When to use this pattern (vs. a feature flag)
- **Master switch (this guide):** a finished feature the *user* turns on/off from Settings, persisted in `app.json`, surviving restarts. Use for shippable capabilities you want off-by-default but discoverable.
- **Feature flag (`openkosmosFeature*`):** a *developer* gate for in-progress / experimental code, resolved from build/env, not user-facing. Use while a feature is incomplete. Do **not** ship a user feature behind a dev flag — migrate it to a master switch (this is exactly what memex did; see PR #776).

## The data model: one boolean in `app.json`
The switch lives on `AppConfig` as a small settings object (room to grow), managed by `AppCacheManager` (`src/main/lib/userDataADO/appCacheManager.ts`) which reads/writes `{userData}/app.json` and fires `app:configUpdated` to the renderer.

## End-to-end wiring chain (toggle → tool list updates)
```
Settings toggle (MemexSettingsView)
  → appDataManager.updateConfig({ memex: { enabled } })            [renderer]
  → IPC appConfig:updateAppConfig
  → AppCacheManager.updateConfig()                                  [main]
        · deep-merge the field, write app.json
        · (optional) run teardown on disable (e.g. destroyAll())
        · scheduleNotifyFrontend()  →  app:configUpdated  (debounced)
  → AppDataManager.handleConfigUpdate(config)                       [renderer]
        · update cache + scheduleNotify() → React subscribers (UI visibility hooks)
        · IF enabled changed → void mcpClientCacheManager.refresh()  ★ EASILY MISSED
  → mcpClientCacheManager.refresh()
        → IPC mcp:getServerStatus
        → mcpClientManager.refreshBuiltinTools() → getAllTools()
              → BuiltinToolsManager.shouldExposeTool() reads the LIVE switch
        → server states (with updated tool inventory) flow back
        → handleServerStatesUpdate() → notifyListeners()
        → userDataProvider.setMcpServers() → Agent page re-renders with the new tool list
```

## Implementation checklist

### Main process
1. **Define the settings type** in `src/main/lib/userDataADO/types/app.ts`:
   - `interface XSettings { enabled: boolean }`, `const DEFAULT_X_SETTINGS = { enabled: false }`.
   - Add `x?: XSettings` to `AppConfig`, and `x: { ...DEFAULT_X_SETTINGS }` to `DEFAULT_APP_CONFIG`.
   - Update the `isAppConfig` type-guard if it enumerates fields.
2. **Wire `AppCacheManager` (`appCacheManager.ts`) at all THREE per-field sites** — skipping any one silently drops writes or leaves stale data:
   - `integrityEnsure`: fill if missing, merge sub-fields to add new keys (`result.x = { ...DEFAULT, ...result.x }`).
   - `appConfigSanitize`: coerce sub-fields (e.g. `enabled: !!ms.enabled`).
   - `updateConfig` deep-merge block: `x: updates.x || this.cache.x ? { ...(cache.x ?? DEFAULT), ...(updates.x ?? {}) } : undefined`.
   - Add a public getter `getXSettings(): XSettings` returning a copy (consumed by the tool gate + IPC).
   - **(Optional) teardown on disable:** in `updateConfig`, when `previousEnabled && !nextEnabled`, run cleanup (browser calls `getEmbeddedBrowserManager()?.destroyAll()`). Memex needs none (memory dirs are lazy).
3. **Gate the built-in tool** in `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts`:
   - **Always register** the tool metadata in `initialize()` (never conditionally). The inventory is recomputed live — there is no inventory cache to invalidate.
   - In `shouldExposeTool(name)`, add `if (name === 'x') return appCacheManager.getXSettings().enabled === true;`. This is read live on every `getAllTools()`, so the advertised inventory always reflects the current switch.
   - In `executeTool()`, return a clear disabled message when the switch is off (defense-in-depth, in case a stale advertisement is executed): e.g. `'x tool is disabled (enable it in Settings → X)'`.

### Renderer
4. **★ Refresh the MCP cache on toggle** — `src/renderer/lib/userData/appDataManager.ts`, `handleConfigUpdate`:
   ```ts
   const previousXEnabled = this.cache.x?.enabled === true;
   const nextXEnabled = config.x?.enabled === true;
   // ...after this.cache = { ...config }...
   if (previousXEnabled !== nextXEnabled) {
     void mcpClientCacheManager.refresh();
   }
   ```
   **This is the step that prevents the stale-tool-list bug** (see Gotchas). Without it the Agent page tool list does not update on a Settings toggle — only on the next chat switch (which happens to call `getAllTools()` for its own reasons).
5. **UI visibility hook** — `src/renderer/lib/userData/useXEnabled.ts`: `useState` seeded from `appDataManager.getConfig().x?.enabled`, then `appDataManager.subscribe(cfg => setEnabled(cfg.x?.enabled === true))`. Use it to show/hide header entries, sidepanes, etc. (Mirror `useMemexMemoryEnabled.ts` / `useEmbeddedBrowserEnabled.ts`.)
6. **Settings view** — `src/renderer/components/settings/XSettingsView.tsx`: a single toggle that calls `appDataManager.updateConfig({ x: { enabled: value } })` with optimistic UI + success/error toast (mirror `MemexSettingsView.tsx` / `BrowserSettingsView.tsx`).
7. **Settings navigation + route**:
   - `SettingsNavigation.tsx`: add the nav item (`onClick={() => navigate('/settings/x')}`) and active detection (`if (path.includes('/settings/x')) return 'x'`).
   - `AppRoutes`: register the `/settings/x` route **unconditionally** (the view itself reads the switch; the route should always resolve).

### Tests + docs
8. Add to `appDataManager.test.ts`: "refreshes MCP cache when x.enabled changes" and "does not refresh when unchanged" (mirror the browser tests). Add `appCacheManager.test.ts` parallels for integrity/sanitize/merge + `getXSettings`. Add `SettingsNavigation` + `XSettingsView` coverage tests.
9. Update the module `ai.prompt.md` (the feature's own + this guide), bump `Last verified`.

## Gotchas
- **★ The stale-tool-list trap (the whole reason this guide exists).** The built-in tool inventory has **no cache** — `shouldExposeTool()` is evaluated live on every `getAllTools()`. But the renderer's Agent-page tool list is driven by `mcpClientCacheManager`'s cache, which only refreshes when explicitly told. A **chat switch** happens to trigger `getAgentInfo() → getCurrentAvailableTools() → getAllTools() → refreshBuiltinTools()`, so the list looks correct after switching chats — masking the bug. A **Settings toggle** does none of that. The fix is the single `mcpClientCacheManager.refresh()` call in `appDataManager.handleConfigUpdate` (step 4). Both `browser` and `memex_memory` rely on it; any new master-switch-gated tool must add its own enabled-change branch there.
- **Compare booleans with `=== true`, not truthiness**, and detect change as `previous !== next`. Re-firing `refresh()` on every unrelated config push is wasteful (and breaks the "does not refresh when unchanged" test).
- **`updateConfig` deep-merge is per-field hardcoded.** Forgetting the merge block (step 2) means the renderer's `updateConfig({ x: { enabled } })` write is silently dropped. See `userDataADO/ai.prompt.md` → "Adding a New App-Level Config Field".
- **Always register the tool metadata; never gate registration.** Conditionally registering on the switch means enabling mid-session won't expose the tool until a restart. Gate at `shouldExposeTool` (advertise) + `executeTool` (run), not at `initialize` (register).
- **Default off.** `DEFAULT_X_SETTINGS.enabled = false` and the `DEFAULT_APP_CONFIG` entry must agree. Adding a field to `app.json` is migration-safe (back-filled by `integrityEnsure`); renaming/removing is not.
- **The teardown event is feature-specific.** Browser dispatches `embedded-browser:disable` + calls `destroyAll()` on disable; memex has no runtime state to tear down. Only add a teardown path if your feature owns live resources (native views, child processes, timers).

## Related
- [userDataADO/ai.prompt.md](../src/main/lib/userDataADO/ai.prompt.md) — `AppCacheManager` / `app.json`, "Adding a New App-Level Config Field".
- [embeddedBrowser/ai.prompt.md](../src/main/lib/embeddedBrowser/ai.prompt.md) — reference master-switch feature (`browser.enabled`), Gotchas → "gated by an app-level switch".
- [memex/ai.prompt.md](../src/main/lib/memex/ai.prompt.md) — reference master-switch feature (`memex.enabled`).
- [builtinTools/ai.prompt.md](../src/main/lib/mcpRuntime/builtinTools/ai.prompt.md) — `shouldExposeTool` / `executeTool` gating.
- [data-flow.md](data-flow.md) — IPC + streaming overview.
