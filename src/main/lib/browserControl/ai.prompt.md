<!-- Last verified: 2026-04-09 -->
# Browser Control

> Manages browser installation, Chrome extension registration, Native Server lifecycle, and MCP connectivity for browser automation; also exposes a secondary CDP (DevTools) MCP path.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `BrowserControlManager.ts` | Core business logic — enable/disable/launch, browser install, extension registration, Native Server download, confirm dialogs, CDP enable/disable | large |
| `browserControlIPC.ts` | Thin IPC bridge; binds all `renderToMain` handlers and raw CDP `ipcMain` handlers to `BrowserControlManager` | small |
| `browserControlHttpServer.ts` | Singleton HTTP server (port 8000, localhost) — serves `update.xml` + `.crx` to browser, receives `/api/server-up` and `/api/server-down` lifecycle POSTs from Native Server | medium |
| `browserControlStatus.ts` | Pure status helpers — `checkBrowserInstalled`, `checkBrowserControlEnabled`, `checkBrowserControlStatus` (all four conditions) | small |
| `browserConfig.ts` | Static `BROWSER_CONFIG` map for Chrome/Edge per-platform keys, paths, scripts, registry paths, and bundle IDs; `COMBINED_SCRIPTS` for multi-browser PowerShell/bash scripts | small |
| `nativeServerFetcher.ts` | Downloads, version-checks, and extracts the `chromium-mcp-native-server` binary from CDN into `userData/assets/native-server/` | medium |

## Architecture

**Enable flow (sequential, all steps must succeed):**
1. `ensureBrowserInstalled` — check registry/`.app`; auto-download installer (MSI on Windows, DMG on macOS) with user confirmation dialog via `pendingBrowserInstallConfirm` promise-map.
2. `browserControlHttpServer.ensureStarted()` — start local HTTP server *before* extension registration so browser can immediately fetch `update.xml` and the `.crx`.
3. `registerExtensions` — run `register-all.ps1` (Windows, via `sudo-prompt`) or `register-all-mac.sh` (macOS) to write extension policy registry keys / manifests.
4. `ensureNativeServer` — check local binary; prompt user then download from CDN via `NativeServerFetcher` if missing.
5. `registerNativeServer` — write `com.chromemcp.nativehost.json` NativeMessagingHost manifest (macOS: written directly; Windows: PowerShell script).
6. `addMcpConfig` — add `openkosmos-chrome-extension` MCP server entry (`StreamableHttp`, `http://127.0.0.1:12306/mcp`) to profile if not present.
7. `checkAndRestartBrowser` — detect if browser is running and optionally restart it so new policies take effect.
8. `launchBrowserWithSnap` — open browser and snap to the right half of screen via platform script.

**Native Server ↔ HTTP server signaling:**
- Native Server POSTs to `/api/server-up` when it starts → `handleServerUp` triggers `mcpClientManager.connect('openkosmos-chrome-extension')`.
- Native Server POSTs to `/api/server-down` when it stops → `handleServerDown` triggers `mcpClientManager.disconnect`.

**Confirmation dialog pattern:** Async user confirmations (browser install, native server download, browser restart) use a `Map<requestId, resolve>`. The manager sends a renderer event, then awaits a promise; the IPC handler for `respondXxxConfirm` resolves the promise.

**CDP path:** A separate, lighter flow (`cdpEnable`/`cdpDisable`) adds/removes a `chrome-devtools-mcp` MCP server entry pointing to a local CDP-over-HTTP endpoint. Does not depend on the extension or Native Server.

**Status check — four conditions must all pass:** browser installed + NativeMessagingHost manifest present + MCP profile has config + native server binary exists locally.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new supported browser | `browserConfig.ts` (new entry) + `browserControlStatus.ts` + scripts in `resources/browser-control/` | `BrowserType` is derived from `BROWSER_CONFIG` keys |
| Change Native Server CDN URL | `nativeServerFetcher.ts` constructor | Reads `DEVELOPMENT_BASE_CDN_URL` / `PRODUCTION_BASE_CDN_URL` env vars |
| Add a new enable sub-step | `BrowserControlManager.ts` `enable()` + add a `sendPhaseChange` call | Renderer `browserControl:phaseChange` events drive the UI progress stepper |
| Change NativeMessagingHost name or extension ID | `browserControlStatus.ts` (`NATIVE_HOST_NAME`) + `BrowserControlManager.ts` `registerNativeServer` + PowerShell/bash scripts | Must stay in sync across all four locations |
| Change HTTP server port | `browserControlHttpServer.ts` (`HTTP_PORT`) + Native Server config | Native Server hardcodes the callback URL on its side |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `BROWSER_CONFIG` keys | `browserControlStatus.ts`, `BrowserControlManager.ts`, `resources/browser-control/` scripts |
| MCP server name (`openkosmos-chrome-extension`) | `browserControlStatus.ts` (`MCP_SERVER_NAME`), `browserControlHttpServer.ts` (`MCP_SERVER_NAME`), `addMcpConfig()` |
| Extension ID (`oopmjmifghgbliienphmofbfffhhgcjl`) | `registerNativeServer` in `BrowserControlManager.ts`, all PowerShell/bash registration scripts |
| `renderToMain` IPC contract (`@shared/ipc/browserControl`) | `browserControlIPC.ts` handler list |

## Anti-Patterns
- Do NOT skip `browserControlHttpServer.ensureStarted()` before `registerExtensions` — the browser may immediately poll `update.xml` upon receiving the new policy, causing a 404 and silent extension install failure.
- Do NOT call `mcpClientManager.connect` directly from enable flow — let the Native Server's `/api/server-up` POST trigger it; premature connection will fail because the server is not yet listening.
- Do NOT add new IPC channels as raw `ipcMain.handle` calls (except CDP which predates the typed bridge) — use `renderToMain.bindMain` for type safety.

## Verification Steps
1. Toggle Browser Control on in Settings → verify phase events appear in sequence: `preparing → downloading → installing → connecting → completed`.
2. Kill the Native Server process → HTTP server should receive `/api/server-down` → MCP disconnects.
3. Restart Native Server → `/api/server-up` → MCP reconnects without app restart.
4. `checkBrowserControlStatus` with one condition false (e.g. delete manifest file) → `getStatus` returns `{ enabled: false }`.

## Gotchas
- ⚠️ `sudo-prompt` is used for extension registration and browser install — it spawns a UAC/polkit dialog. If the user cancels, the sub-step throws and sets phase to `error`; subsequent `enable()` calls must restart from scratch.
- ⚠️ On macOS, `checkBrowserInstalled` only checks for `/Applications/{AppName}.app`; non-standard install paths return `false` and trigger re-download.
- ⚠️ The HTTP server guards against double-start but does not guard against port 8000 conflicts. If port is in use, `server.on('error')` fires and `start()` returns `false` silently — browser extension will fail to update.
- ⚠️ `selectedBrowser.json` is written to `userData/assets/native-server/` and read by the Native Server process directly; this file and the profile setting must stay in sync (`updateSettings` writes both).
- ⚠️ The CDP feature flag check (`isFeatureEnabled('browserControl')`) gates `enable()` but not `cdpEnable()` — CDP is independently controlled.

## Related
- Depends on: [mcpRuntime/mcpClientManager](../mcpRuntime/), [userDataADO/profileCacheManager](../userDataADO/ai.prompt.md), [featureFlags](../featureFlags/ai.prompt.md), `@shared/ipc/browserControl`
- Depended by: `main.ts` (registers IPC, starts HTTP server on login), Settings UI renderer (`browserControl` settings page)
