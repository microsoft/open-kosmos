<!-- Last verified: 2026-04-09 -->
# Screenshot Module

> Capture-first-then-select screenshot system: spawns per-display overlay windows, captures native images, and resolves a promise when the user completes or cancels.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `ScreenshotManager.ts` | Singleton — overlay window lifecycle, parallel capture, crop, clipboard/file/sendToMain actions, custom `screenshot://` protocol | large |
| `ScreenshotIPC.ts` | Registers all `ipcMain` handlers via `renderToMain.bindMain()`; bridges overlay ↔ main process; reads/writes settings | medium |
| `screenshotShortcut.ts` | Registers/unregisters global shortcut; re-registers whenever settings change | small |
| `windowFrames.ts` | Uses `node-screenshots` to enumerate system windows grouped by display; returns physical-pixel coords for window-snap highlighting | small |
| `index.ts` | Re-exports `registerScreenshotIPC`, `registerScreenshotShortcut`, `unregisterScreenshotShortcut` | tiny |

## Architecture

### Capture Flow
1. `ScreenshotManager.capture()` → permission check → `cleanup()` → create `ResolveablePromise<CaptureResult>`.
2. **Parallel**: `createDisplayWindowForParallel()` (per display, `show: false`) + `captureAllDisplays()` (via `desktopCapturer`).
3. `initializeWindowsWithScreenshots()` attaches screenshots, caches JPEG, sets `alwaysOnTop: screen-saver`, shows windows.
4. Overlay JS calls back via IPC. `selectionStart` closes all non-active display windows. `sendToMain` / `copyToClipboard` / `saveToFile` resolve `capturePromise`.
5. `cleanup()` closes all overlay windows, resets state.

### Custom Protocol
`screenshot://image/<displayId>` serves the pre-cached JPEG to the overlay renderer. Must register scheme via `protocol.registerSchemesAsPrivileged` **before** `app.ready` in `main.ts` (not in this module).

### IPC Contract
All channels are namespaced under `screenshot:*` via `connectRenderToMain('screenshot')` in `src/shared/ipc/screenshot.ts`. Types: `CaptureResult`, `SaveToFileResult`, `DisplayInfo`, `WindowFrame`, `ScreenshotSettings`.

### Settings
Stored in `appCacheManager` (UserDataADO). Feature flag `openkosmosFeatureScreenshot` can force `enabled: false` at runtime.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new IPC channel | `src/shared/ipc/screenshot.ts` (type) + `ScreenshotIPC.ts` (handler) | Renderer calls `renderToMain.bindRenderer()` counterpart |
| Change default shortcut | `screenshotShortcut.ts` fallback string | Also update ScreenshotSettings default in UserDataADO |
| Add a new capture action (e.g. OCR) | `ScreenshotManager.ts` (method) + `ScreenshotIPC.ts` (handler) + `src/shared/ipc/screenshot.ts` (type) | Resolve `capturePromise` with a new `CaptureResult` variant |
| Add a new setting field | `src/shared/ipc/screenshot.ts` (`ScreenshotSettings`) + UserDataADO schema | Keep defaults backward-compatible |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| `CaptureResult` union type | All callers that `switch` on `type` in renderer and main |
| `registerCustomProtocol()` | `protocol.registerSchemesAsPrivileged` call in `main.ts` (must stay before `app.ready`) |
| `cleanup()` | Verify macOS Dock icon restore (`app.dock?.show()`) stays before window close |
| Shortcut registration | `registerScreenshotShortcut` called from both `main.ts` startup and `updateSettings` IPC handler |

## Anti-Patterns
- Do NOT call `protocol.registerSchemesAsPrivileged` inside this module — it must run before `app.ready` in `main.ts`.
- Do NOT append query params directly to a file path in `loadFile()` — Electron encodes `?` as `%3F`. Use the `query` option of `loadFile`.
- Do NOT bypass `capture()` to show overlay windows; always go through the full flow so `capturePromise` is properly initialized.
- Do NOT call `registerScreenshotIPC` more than once — it guards with `isRegistered` but double-registration is still a logic error.

## Verification Steps
1. Trigger screenshot (shortcut or IPC `capture`); confirm overlay windows appear on every connected display.
2. Drag-select a region; confirm other display windows close on `selectionStart`.
3. Test copy, save, and send-to-chat flows — each should resolve `capturePromise` exactly once.
4. On macOS: revoke Screen Recording permission and verify the permission dialog appears with a link to System Settings.
5. Verify `screenshot://image/<id>` serves the correct JPEG in dev and production builds.

## Gotchas
- ⚠️ macOS 15+ requires an app restart after Screen Recording permission is granted; `desktopCapturer` returns empty images otherwise. The module retries 3× with 500 ms delay and shows a restart dialog.
- ⚠️ `windowFrames.ts` converts window coordinates to **physical pixels** (multiplied by `scaleFactor`). The overlay renderer must account for this when drawing snap highlights.
- ⚠️ On macOS, `app.dock?.show()` must be called in `cleanup()` **before** closing overlay windows, otherwise the Dock icon may disappear.
- ⚠️ Zoom factor is force-reset to 1 after `did-finish-load` to prevent Chromium's inherited per-origin zoom from distorting the overlay.
- ⚠️ `captureReadyPromise` starts as a pre-rejected `Promise`; `getInitData` awaits it, so calling it before `capture()` will throw.

## Related
- Depends on: [UserDataADO](../userDataADO/ai.prompt.md) (`appCacheManager` for settings), [featureFlags](../featureFlags/ai.prompt.md) (`openkosmosFeatureScreenshot`), `src/shared/ipc/screenshot.ts` (IPC type contract), `node-screenshots` (window enumeration)
- Depended by: `src/main/main.ts` (registers IPC + shortcut at startup), renderer screenshot overlay UI (`src/renderer/screenshot/`)
