<!-- Last verified: 2026-05-17 -->
# IPC Framework (`src/shared/ipc/`)

> TypeScript generics + Proxy based framework that enforces type-safe, compile-time-checked IPC across all three Electron layers (main / preload / renderer) from a single shared definition file.

## Why This Framework Exists

Electron's native IPC is weakly-typed and string-based. Before this framework, the codebase suffered from:

1. **Misspelled channel names go undetected** — `ipcRenderer.invoke('screenshot:caputre')` only fails at runtime.
2. **No parameter type constraints** — caller and handler signatures drift apart.
3. **Lost return types** — `invoke` returns `Promise<any>`.
4. **Preload whitelist disconnected from interface definitions** — forgotten entries cause silent runtime failures.
5. **Scattered type definitions** — preload, main, and renderer each declare their own copy.

The framework's core principle: **define once in `shared/ipc/`, automatically align types across all three layers (main / preload / renderer)**.

## Architecture

### Two Core Connectors (both in `base.ts`)

| Connector | Direction | Pattern |
|-----------|-----------|---------|
| `connectRenderToMain<RM>(prefix?)` | Renderer → Main | invoke / handle |
| `connectMainToRender<MR>(prefix?)` | Main → Renderer | send / on |

**`connectRenderToMain<RM>(prefix?)`**:
- `bindMain(ipcMain)` — returns a Proxy that calls `ipcMain.handle('{prefix}:{method}', fn)` lazily on first access; automatically removes any previous handler to prevent double-registration.
- `bindRender(invokeFn)` — returns a Proxy that prepends `{prefix}:` and calls `invokeFn(channel, ...args)`.
- `provideInvokeForPreload(ipcRenderer, whitelist[])` — creates a channel-filtered invoke function for the preload script. Uses conditional types: if any key in `RM` is missing from the array, TypeScript emits a compile error (`"Missing key, you should provide all keys"`).

**`connectMainToRender<MR>(prefix?)`**:
- `bindWebContents(wc)` — returns a per-`WebContents` send Proxy; cached in a `WeakMap<WebContents>` so the same window always gets the same proxy.
- `bindRender(on, off)` — returns a Proxy that registers `ipcRenderer.on(channel, fn)` and returns an unsubscribe function.

### Channel Format
`{prefix}:{methodName}` — e.g., `screenshot:saveToFile`. Without a prefix, the channel equals `methodName`.

### Data Flow
```
src/shared/ipc/screenshot.ts                ← single source of truth
         │
         ├─→ Main:     renderToMain.bindMain(ipcMain)            → type-safe handle object
         ├─→ Preload:  renderToMain.provideInvokeForPreload(ipc) → whitelist-validated invoke
         └─→ Renderer: renderToMain.bindRender(invoke)           → type-safe API object
```

## Standard Usage (Renderer → Main)

A complete contract spans four files. Below is the actual `screenshot` channel wired end-to-end (see real code in `src/shared/ipc/screenshot.ts`, `src/main/lib/screenshot/ScreenshotIPC.ts`, `src/preload/screenshot/invoke.ts`, `src/renderer/ipc/screenshot-overlay.ts`).

### 1. Define the contract — `src/shared/ipc/<name>.ts`

This is the single source of truth. Every method declares its `call` tuple and `return` type; the framework derives main/preload/renderer types from this.

```typescript
import { connectRenderToMain } from './base';

type RenderToMain = {
  capture: {
    call: [callback?: boolean];
    return: CaptureResult;
  };
  saveToFile: {
    call: [displayId: number, rect: SelectionRect, imageData?: Buffer];
    return: SaveToFileResult;
  };
  // ...other methods
};

export const renderToMain = connectRenderToMain<RenderToMain>('screenshot');
```

### 2. Register handlers in main — e.g. `ScreenshotIPC.ts`

`bindMain(ipcMain)` returns a Proxy whose property names are the contract method names. Each call registers `ipcMain.handle('screenshot:<method>', fn)`. Parameter types of `_event, ...args` are inferred from the contract — no manual annotations.

```typescript
import { renderToMain } from '@shared/ipc/screenshot';
const handle = renderToMain.bindMain(ipcMain);

handle.capture(async (_event, callback = true) => {
  return screenshotManager.capture(callback);
});

handle.saveToFile(async (_event, displayId, rect, imageData) => {
  return screenshotManager.saveToFile(displayId, rect, imageData);
});
```

### 3. Expose to renderer in preload — `src/preload/<name>/invoke.ts`

`provideInvokeForPreload` builds a channel-filtered invoke function. The whitelist array is type-checked: **every key in the contract must appear**, otherwise TS reports `"Missing key, you should provide all keys"`. Extra/stale keys are NOT caught.

```typescript
import { ipcRenderer, contextBridge } from 'electron';
import { renderToMain } from '@shared/ipc/screenshot';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, ['capture', 'saveToFile']);

contextBridge.exposeInMainWorld('electronAPI', {
  screenshot: { invoke },
});
```

The preload entry point (`src/preload/main.ts` or a dedicated overlay preload) then exposes this invoke function, e.g. via `contextBridge.exposeInMainWorld('electronScreenshot', { invoke })` or as a property under the unified `electronAPI` object (`screenshot: { invoke }`).

### 4. Call from renderer — `src/renderer/ipc/<name>*.ts`

`bindRender` takes any function with the `(channel, ...args) => Promise<any>` signature and returns a typed proxy. Method names, parameters, and return types all come from the shared contract.

```typescript
import { renderToMain } from '@shared/ipc/screenshot';

// exposed under unified electronAPI:
export const screenshotApi = renderToMain.bindRender(window.electronAPI.screenshot.invoke);

// Usage — fully typed
const result = await screenshotApi.saveToFile(displayId, rect, imageData);
```

## Standard Usage (Main → Renderer)

For push-style events use `connectMainToRender<MR>(prefix?)` (see `buddy.ts` for a live example).

- Main: `mainToRender.bindWebContents(wc).<event>(payload)` — sends to one window. There is no broadcast helper; iterate over active `WebContents` if multiple windows need the event.
- Renderer: `mainToRender.bindRender(on, off).<event>(handler)` — registers a listener and returns its unsubscribe function.
- Preload: no whitelist required for the inbound direction; just expose `on` / `off` wrappers around `ipcRenderer.on` / `ipcRenderer.off` on the bridge.

## Adding a New Contract

Create a new file under `src/shared/ipc/`, instantiate `connectRenderToMain` (and/or `connectMainToRender`) with a unique prefix string, then follow the four-step pattern above. Each new contract requires its own preload `invoke.ts` and a main-process `*IPC.ts` registrar.

## Gotchas
- ⚠️ `bindMain` re-uses a single proxy instance across calls due to the `if (!main_handle)` guard. Call it once per `ipcMain` in `main.ts`; calling it after hot-reload in dev may silently reuse a stale proxy. In dev, restart the main process.
- ⚠️ `WeakMap<WebContents>` cache in `connectMainToRender` means a destroyed `WebContents` (closed window) is garbage collected automatically — no manual cleanup needed.
- ⚠️ The compile-time whitelist check in `provideInvokeForPreload` only catches **missing** keys, not **extra** ones. Stale entries in the whitelist do not cause errors but allow the preload to call undefined methods.
- ⚠️ NOT all IPC in the codebase uses this framework. Older handlers in `main.ts` still use raw `ipcMain.handle()` string channels. New code should use the typed framework; do not assume framework guarantees apply to legacy channels.

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| Any type in `src/shared/ipc/*.ts` | Corresponding `src/preload/*` whitelist, corresponding handler in `src/main/startup/ipc/` |
| `base.ts` framework | All files importing from `base.ts` — run `npm run check:impact -- src/shared/ipc/base.ts` |
| Add a new IPC contract file | Must also create preload invoke entry and main-side handler file |

## Anti-Patterns
- For new IPC, do NOT use raw `ipcMain.handle()` — use `connectRenderToMain<T>()` from `base.ts`.
- Do NOT forget the preload whitelist — channels without preload entries silently fail in renderer.
- Do NOT use the same prefix string for two different contract files — prefixes must be unique.

## Verification Steps
1. `npm run build` — TypeScript catches type mismatches in IPC contracts.
2. `npm run check:impact -- <changed-files>` — find affected modules.

## Related
- Used by: every main and renderer module that communicates across processes (typed) plus all legacy string-channel handlers (untyped).
- Defines contracts for: screenshot overlay, browser control extension, scheduler, plugin, buddy, memex.
- Foundation consumed by: `src/preload/main.ts`, `src/preload/screenshot.ts`, IPC handler files under `src/main/`.
- See also: [data-flow.md](../../../ai.prompt/data-flow.md) for the broader IPC and chat-message data flow context.
