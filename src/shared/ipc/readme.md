# Electron IPC Type-Safe Framework

## Problem Statement

Electron's IPC communication is inherently **weakly-typed, string-channel-based invocation**. In the original codebase, communication between the main process and the renderer process relied entirely on hand-written strings and `any` types, leading to the following issues:

1. **Misspelled channel names go undetected**: Typos like `ipcRenderer.invoke('screenshot:caputre')` can only be caught at runtime
2. **No parameter type constraints**: Callers can pass arbitrary arguments, and handler-side parameter types are manually declared — the two sides easily fall out of sync
3. **Lost return types**: `invoke` returns `Promise<any>`, so callers get no correct return type information
4. **Preload whitelist disconnected from interface definitions**: The whitelist is a separately maintained string array; when adding new IPC methods, it's easy to forget entries, and omissions produce no compile-time warnings
5. **Scattered type definitions**: The preload script contains one set of hand-written interface types, while the main process independently declares its own parameter types — no single source of truth

## Design

A TypeScript generics + Proxy based IPC type-bridging framework under `src/shared/ipc/`, with a core principle:

**Define once, automatically align types across all three layers (main / preload / renderer).**

### Architecture Diagram

```
src/shared/ipc/screenshot.ts     ← Single source of truth: defines parameter and return types for all channels
         │
         ├─→ Main process:     renderToMain.bindMain(ipcMain)            → Type-safe handle object
         ├─→ Preload script:   renderToMain.provideInvokeForPreload(ipc) → Whitelist-validated invoke function
         └─→ Renderer process: renderToMain.bindRender(invoke)           → Type-safe API object
```

### Two Core Connectors

| Connector | Direction | Purpose |
|-----------|-----------|---------|
| `connectRenderToMain<RM>()` | Renderer → Main | Renderer invokes main process (invoke/handle pattern) |
| `connectMainToRender<MR>()` | Main → Renderer | Main process pushes messages to renderer (send/on pattern) |

## Before & After Comparison (Using the Screenshot Module as an Example)

### 1. Defining IPC Interfaces

**Before**: No centralized definition; types scattered across preload and main.

```typescript
// preload.screenshot.ts — hand-written interface
export interface ScreenshotElectronAPI {
  screenshot: {
    selectionStart: (displayId: number) => Promise<void>;
    saveToFile: (displayId: number, rect: SelectionRect) => Promise<{ success: boolean; filePath?: string }>;
    // ...other methods
  };
}
```

**After**: Centralized definition in the shared layer, serving as the single source of truth.

```typescript
// shared/ipc/screenshot.ts
type RenderToMain = {
  selectionStart: {
    call: [displayId: number];
    return: void;
  };
  saveToFile: {
    call: [displayId: number, rect: SelectionRect];
    return: { success: boolean; filePath?: string; error?: string };
  };
  // ...other methods
};

export const renderToMain = connectRenderToMain<RenderToMain>('screenshot');
```

### 2. Registering Handlers in the Main Process

**Before**: Hand-written string channels with manually annotated parameter types.

```typescript
// ScreenshotIPC.ts
ipcMain.handle('screenshot:capture', async () => {
  return await screenshotManager.capture();
});

ipcMain.handle('screenshot:selectionStart', async (_event, displayId: number) => {
  screenshotManager.onSelectionStart(displayId);
});

ipcMain.handle('screenshot:saveToFile', async (_event, displayId: number, rect: SelectionRect) => {
  return await screenshotManager.saveToFile(displayId, rect);
});
```

**After**: Channels are automatically mapped via Proxy; parameter and return types are inferred from generics.

```typescript
// ScreenshotIPC.ts
const handle = renderToMain.bindMain(ipcMain);

handle.capture(async () => {
  return await screenshotManager.capture();
});

handle.selectionStart(async (_event, displayId) => {  // displayId automatically inferred as number
  screenshotManager.onSelectionStart(displayId);
});

handle.saveToFile(async (_event, displayId, rect) => {  // rect automatically inferred as SelectionRect
  return await screenshotManager.saveToFile(displayId, rect);
});
```

### 3. Preload Whitelist

**Before**: The whitelist was completely disconnected from type definitions; missing channels could only be discovered at runtime.

```typescript
// preload.screenshot.ts
const screenshotAPI = {
  selectionStart: (displayId: number) =>
    ipcRenderer.invoke('screenshot:selectionStart', displayId),
  saveToFile: (displayId: number, rect: SelectionRect) =>
    ipcRenderer.invoke('screenshot:saveToFile', displayId, rect),
  // Every method requires a hand-written invoke forwarding...
};
contextBridge.exposeInMainWorld('electronScreenshot', screenshotAPI);
```

**After**: The whitelist is enforced by the type system — if any key is missing, TypeScript will report a compile-time error.

```typescript
// preload.screenshot.ts
const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'capture',
    'selectionStart',
    'saveToFile',
    'copyToClipboard',
    'sendToMain',
    'close',
    'getInitData',
    // If any key is missing here, TS will report a type error:
    // "Missing key, you should provide all keys"
  ],
);
contextBridge.exposeInMainWorld('electronScreenshot', { invoke });
```

The type signature of `provideInvokeForPreload` uses conditional types for compile-time completeness checking:

```typescript
function provideInvokeForPreload<T extends Keys[]>(
  ipc: IpcRenderer,
  args: [Keys] extends [T[number]]
    ? T  // All keys provided — type check passes
    : ["Missing key, you should provide all keys", Exclude<Keys, T[number]>]
)
```

### 4. Renderer-Side Invocation

**Before**: Types obtained from the preload-exposed interface, hand-written and unrelated to the main process side.

```typescript
// renderer/screenshot/api.ts
import type { ScreenshotElectronAPI } from '../../main/preload.screenshot';
export const screenshotApi = (window as any).electronScreenshot as ScreenshotElectronAPI;

// Usage
screenshotApi.saveToFile(displayId, rect);  // Types from hand-written ScreenshotElectronAPI
```

**After**: Types are inferred directly from the shared definition, fully consistent with the main process side.

```typescript
// renderer/screenshot/api.ts
import { renderToMain } from '@shared/ipc/screenshot';
const bridge = (window as any).electronScreenshot;
export const screenshotApi = renderToMain.bindRender(bridge.invoke);

// Usage
screenshotApi.saveToFile(displayId, rect);  // Types from the unified definition in shared/ipc/screenshot.ts
```

## Summary of Benefits

| Dimension | Before | After |
|-----------|--------|-------|
| Channel names | Hand-written strings, typos go undetected | Proxy auto-mapping, typos are impossible |
| Parameter types | Manually annotated, duplicated in main/renderer | Single source, automatically inferred via generics |
| Return types | `Promise<any>` | Precisely inferred (e.g., `Promise<CaptureResult>`) |
| Preload whitelist | Disconnected from interface definitions, omissions go undetected | Compile-time completeness enforcement, omissions cause errors |
| Adding new IPC methods | Requires synchronized changes in 4 places (definition, main handle, preload forwarding, renderer interface) | Only add to the shared type definition; all other layers auto-align |
| Code volume | Preload requires hand-written invoke forwarding for each method | Preload only needs a whitelist array |

## How to Add a New IPC Method

Using `screenshot:resize` as an example:

```typescript
// 1. Add to the RenderToMain type in shared/ipc/screenshot.ts
type RenderToMain = {
  // ...existing methods
  resize: {
    call: [width: number, height: number];
    return: void;
  };
};

// 2. Register the handler in the main process (parameter types are automatically inferred)
handle.resize(async (_event, width, height) => {
  screenshotManager.resize(width, height);
});

// 3. Add 'resize' to the preload whitelist (omitting it will cause a TS compile error)

// 4. No changes needed on the renderer side — just call it directly
screenshotApi.resize(800, 600);  // Parameter types are automatically checked
```
