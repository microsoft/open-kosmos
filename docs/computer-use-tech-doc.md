# Computer Use Tech Doc

> Version: 1.0.0 | Date: 2026-06-20
> Companion to [computer-use-prd.md](./computer-use-prd.md)

## 1. Overview

Computer Use lets a OpenKosmos agent operate the user's **real native desktop**: capture the screen,
enumerate/focus windows, and dispatch synthetic mouse/keyboard input to any application. It is a
profile-gated, off-by-default built-in tool (`computer_use`) backed by a new main-process
`ComputerUseManager`. It deliberately reuses the architecture already proven by the embedded
browser feature (single multi-action tool, vision-injected screenshots, settings gating at both
advertise and execute time, interactive-request confirmation, `AbortSignal` cancellation).

Browser automation is out of scope -- that is the existing `browser` tool. Computer Use targets
native, non-browser apps.

### 1.1 Design Principles

1. **Real machine, layered authorization.** Run on the user's machine (a sandbox cannot reach the
   user's apps/data). Safety comes from default-off, OS permissions, default confirmation, a
   per-app allowlist, and prompt-injection isolation -- not from environment isolation.
2. **Reuse, don't re-invent.** Reuse `desktopCapturer`/`NativeImage` capture, the built-in tool
   gating pattern, the `request_interactive_input` HITL tool, and the vision-injection transcript
   contract.
3. **Provider-agnostic.** Define our own `computer_use` tool with an action enum and feed
   screenshots as vision. Any vision-capable model can drive it through normal tool calling; we do
   not depend on a single vendor's proprietary computer-use endpoint.
4. **Never throw across the tool boundary.** Every failure (disabled, permission missing, blocked
   high-impact action, bad coordinates) returns a structured, recoverable result so the agent can
   adapt -- matching `embeddedBrowserTool`.
5. **Deterministic coordinate mapping.** The model reasons in screenshot-image space; the manager
   owns the math that maps image coordinates to physical screen points (scale factor + display
   origin), so grounding stays correct on HiDPI/multi-display setups.

## 2. Architecture

```
Renderer (Settings -> Computer Use)
  \- ComputerUseSettingsView / ...HeaderView / ...ContentView
        | IPC: profile:updateComputerUseSettings, computerUse:getPermissionStatus
        v
Main: startup/ipc/profile.ts -- profileSettingsCrud.updateComputerUseSettings()
        |                              \- writes profile.json { computerUse: {...} }
        v on toggle
   profileDataManager -> mcpClientManager.refreshBuiltinTools()  (live tool-list refresh)

Agent turn -> McpClientManager -> BuiltinToolsManager
   shouldExposeTool('computer_use')   -> advertise gate (computerUse.enabled)
   executeTool('computer_use', args)  -> run gate + dynamic import
        v
   computerUseTool.ts (ComputerUseTool.execute)
        +- perception:  ComputerUseManager.captureScreenshot() -> vision payload
        +- targeting:   listDisplays / listWindows / focusWindow
        +- confirmation: blocked-envelope { requiresConfirmation, confirmationId, confirmationRequest }
        |                 -> agent runs request_interactive_input with exact trusted request,
        |                    user selects the preset approve option, retries with approved id
        \- execution:   ComputerUseManager.dispatch(action)  -> nut.js native input
```

### 2.1 New Module Layout

```
src/main/lib/computerUse/
  ComputerUseManager.ts        # singleton: permissions, capture, mapping, input, app focus
  permissions.ts               # macOS Accessibility + Screen Recording checks/prompts
  coordinateMapping.ts         # image-space <-> physical-screen mapping (scale factor, origins)
  desktopControl.ts            # the only module that touches Electron screen/desktopCapturer
  cursorOverlay.ts             # on-screen "AI cursor" overlay window that visualizes pointer actions
  cursorRenderer.ts            # pure, electron-free render layer (BOOTSTRAP_SCRIPT + payload helpers)
  inputDriver.ts               # thin wrapper over the native input dependency (nut.js)
  inputDriverTypes.ts          # InputDriver interface (kept separate from the nut.js adapter)
  actionAudit.ts               # per-session action/audit trail
  types.ts                     # ComputerUseAction, results, settings shapes
  ai.prompt.md                 # module doc (required by repo conventions)
  __tests__/                   # unit tests (>=90% on changed files)

src/main/lib/mcpRuntime/builtinTools/
  computerUseToolDefinition.ts # static tool metadata (name + action enum input schema)
  computerUseTool.ts           # agent-facing ComputerUseTool execute() + confirmation gate
```

## 3. Files and Responsibilities

| File | Responsibility |
|------|----------------|
| `src/main/lib/computerUse/ComputerUseManager.ts` | Singleton orchestrator: lazy-init native input driver, run permission checks, capture screenshots, keep screenshot/foreground grounding state **per chat session**, refresh the OS frontmost app immediately before allowlist-sensitive dispatch, ground coordinates (`groundPoint` → logical **and** driver point), enumerate/focus windows, dispatch input, emit on-screen cursor signals, write audit entries. |
| `src/main/lib/computerUse/permissions.ts` | macOS `systemPreferences.getMediaAccessStatus('screen')` (Screen Recording) and `systemPreferences.isTrustedAccessibilityClient(prompt)` (Accessibility); Windows no-op/true. Returns a typed permission status. |
| `src/main/lib/computerUse/coordinateMapping.ts` | Pure functions mapping screenshot-image `(x,y)` to physical screen points using captured image dims, `display.scaleFactor`, and `display.bounds` origin; multi-display aware. Pure -> easy to unit test. |
| `src/main/lib/computerUse/desktopControl.ts` | The only module that touches Electron `screen`/`desktopCapturer` (static imports). Provides display enumeration, screenshot capture (`selectCaptureSource` resolves the source by `display_id`, then by positional **index** so Windows multi-monitor — where `display_id` is usually empty — captures the right screen instead of falling back to primary), window enumeration with a real `focused` marker (Windows compares each top-level `MainWindowHandle` to `GetForegroundWindow`), PID-based `focusWindow`, and the frontmost-app query (`getFrontmostApp` → `{name, candidates}` — AppleScript on macOS; on Windows a **cached probe assembly** resolves the foreground PID and reports the friendly name + process name) behind a `DesktopControl` interface so the manager stays testable. Its default command runner hides Windows child-process windows so PowerShell probes cannot steal focus from screenshots or allowlist checks. |
| `src/main/lib/computerUse/cursorOverlay.ts` | The dedicated on-screen **"AI cursor"** (section 8.3): a transparent, click-through, non-focusable, always-on-top Electron `BrowserWindow` per target display that paints a distinct animated pointer following the action trajectory. Stays solid while active (no inter-action fade) and is kept alive across think-time by `ping()` on each screenshot; re-asserts always-on-top + `moveTop()` on every show so a foreground app can't occlude it. **Deliberately does not use `setContentProtection`** (invisible on Windows under transparency); the manager hides it during capture to keep it out of model screenshots. Driven from main via `executeJavaScript` on `about:blank` (no preload/IPC/HTML entry). Owns only the window lifecycle — the pure render code lives in `cursorRenderer.ts` and is re-exported here. Exposed through a `CursorIndicator` seam (`NoopCursorIndicator` default) so the manager stays fakeable. |
| `src/main/lib/computerUse/cursorRenderer.ts` | The **pure, electron-free render layer** for the AI cursor (section 8.3): `CursorSignal`/`CursorPayload` shapes, the `toLocalCss`/`buildPayload`/`cursorInvocation` projection helpers, and `BOOTSTRAP_SCRIPT` (the self-contained in-page DOM/animation script defining `window.__cu`). Imports nothing from electron (only `import type` from `./types`) so the exact shipped render code can be rasterized by the render smoke test (`tests/e2e/cursor-overlay.e2e.ts`) in a plain Chromium page; `cursorOverlay.ts` re-exports every symbol so importers are unaffected. |
| `src/main/lib/computerUse/inputDriver.ts` | Thin adapter over `@nut-tree-fork/nut-js`: `moveMouse`, `click`, `doubleClick`, `rightClick`, `drag`, `scroll`, `typeText`, `pressKey`, `hotkey`. Isolates the native dep behind an interface so it can be faked in tests and swapped if the dep changes. Every pointer action runs inside `preservingCursor` (read `mouse.getPosition` → act → restore in `finally`) so the user's **real** cursor is never hijacked (section 8.3). |
| `src/main/lib/computerUse/inputDriverTypes.ts` | The `InputDriver` interface (plus `NoopInputDriver`), kept separate from the nut.js adapter so the manager and tests depend on the interface, not the native module. |
| `src/main/lib/computerUse/actionAudit.ts` | Append-only in-memory + log trail of `{chatSessionId, action, target, timestamp, confirmed}` for observability and post-hoc review. |
| `src/main/lib/computerUse/confirmationGate.ts` | Server-side one-time approval store for Computer Use HITL. Creates a per-action `confirmationId`, builds the locked `request_interactive_input` approval payload, marks it approved only after the submitted choice request exactly matches that trusted payload and the user selects approve, and consumes it on the matching `computer_use` retry. |
| `src/main/lib/computerUse/platformSupport.ts` | Platform support gate for the native input layer. Windows ARM64 is explicitly unsupported until `@nut-tree-fork/nut-js` ships a compatible addon; Settings, tool inventory, and stale execution all surface the same recoverable unsupported reason. |
| `src/main/lib/computerUse/types.ts` | `ComputerUseAction` union, action args, `ComputerUseResult`, and re-export of `ComputerUseSettings`. |
| `src/main/lib/mcpRuntime/builtinTools/computerUseToolDefinition.ts` | Static tool metadata (`name: 'computer_use'` + action-enum input schema) registered eagerly so the Settings toggle can advertise/refresh it without importing the native input stack. |
| `src/main/lib/mcpRuntime/builtinTools/computerUseTool.ts` | `ComputerUseTool.getDefinition()` (single tool + action enum) and `ComputerUseTool.execute(args, ctx)`; the only place the agent reaches the manager. Owns the confirmation gate. Never throws. |
| `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts` | Register the tool; gate it in `shouldExposeTool` and `executeTool` (see section 5). Blocks `computer_use` when the execution context is missing, a sub-agent, or any runtime whose interaction policy is not `allow-ui` (scheduled-silent and background sub-agent auto-wake parent turns use `forbid`). |
| `src/main/lib/userDataADO/profileSettingsCrud.ts` | Add `getComputerUseSettings` / `updateComputerUseSettings` mirroring `getBrowserSettings`/`updateBrowserSettings` (lines 282/294). |
| `src/main/startup/ipc/profile.ts` | Add the `profile:updateComputerUseSettings` IPC handler; trigger MCP refresh on change. |
| `src/main/lib/mcpRuntime/mcpClientManager.ts` | `refreshBuiltinTools()` (line 1658) already rebuilds the advertised list; ensure the toggle path calls it. Add `'computer_use'` to the builtin special-case at line 665 so a stale call still resolves to the builtin (and hits the disabled branch). `getToolsForSubAgent()` filters it out so sub-agents cannot inherit real-desktop control. |
| `src/shared/types/*` | Add `ComputerUseSettings` and `DEFAULT_COMPUTER_USE_SETTINGS` next to `BrowserSettings`/`MemexSettings`; extend the preload/IPC contract types. |
| `src/renderer/components/settings/ComputerUseSettingsView.tsx` (+ `...HeaderView.tsx`, `...ContentView.tsx`) | Settings surface: master switch, permission status + "Open Settings" prompts, always-allowed apps list. Mirrors the `BrowserSettings*`/`ScreenshotSettings*` triad. |
| `src/renderer/components/settings/SettingsNavigation.tsx` | Add the Computer Use nav entry. |

## 4. Settings Gate (master switch + control layering)

`profile.json` gains a nested object, defaulting to disabled, following the `browser`/`memex`
pattern (never the flat `hooksEnabled` style):

```jsonc
// profile.json
"computerUse": {
  "enabled": false,            // Any App master switch (default OFF)
  "alwaysAllowedApps": [],     // app / process names that skip per-action confirm
  "requireConfirmation": true  // default HITL; whitelist narrows, never disables high-impact
}
```

`ComputerUseSettings` shape and `DEFAULT_COMPUTER_USE_SETTINGS = { enabled: false, alwaysAllowedApps: [], requireConfirmation: true }` live beside `BrowserSettings`. The legacy
`profile:updateComputerUseSettings` IPC rejects alias mismatches against `ctx.currentUserAlias` and
malformed patches before persistence; CRUD repeats the same shape validation so non-IPC callers
cannot merge arbitrary fields into the desktop-control gate. CRUD mirrors the existing functions:

```ts
// profileSettingsCrud.ts  (mirror of getBrowserSettings @282 / updateBrowserSettings @294)
export function getComputerUseSettings(ctx: SettingsCrudContext, alias: string): ComputerUseSettings {
  const profile = ctx.cache.get(alias);
  return { ...DEFAULT_COMPUTER_USE_SETTINGS, ...(profile?.computerUse ?? {}),
           enabled: profile?.computerUse?.enabled === true };  // default-OFF coercion
}
export async function updateComputerUseSettings(
  ctx: SettingsCrudContext, alias: string, settings: Partial<ComputerUseSettings>,
): Promise<boolean> { /* withProfileWriteLock + validate, like updateBrowserSettings */ }
```

**Live refresh on toggle.** The IPC update handler in `startup/ipc/profile.ts` calls
`mcpClientManager.refreshBuiltinTools()` after persisting so the **main-process** advertised tool list
changes without a chat switch -- identical to the browser toggle. The **renderer** side must refresh
too: `ComputerUseSettingsView` calls `mcpClientCacheManager.refresh()` after a successful enable/disable
(mirroring `CodingCliSettingsView`), and `ProfileDataManager.handleProfileCacheUpdate` also refreshes
when the pushed `computerUse.enabled` value changes. The central cache-update path is required because
settings writes are not the only way the profile cache changes; without it, a profile sync/update
outside the local Settings handler would leave the Agent page advertising stale tools until another
refresh event. `shouldExposeTool('computer_use')` is gated on `computerUse.enabled`, so disabling removes
`computer_use` from inventory immediately on both sides.

**Allowlist edits build on a ref, not the render snapshot.** `updateComputerUseSettings` replaces the
whole `alwaysAllowedApps` array, and the renderer derives it from the async profile cache (which only
re-renders a tick **after** the IPC write resolves). Add/remove therefore compute the next array from a
`useRef` mirror of the list that the handlers update **synchronously**, not from the `alwaysAllowedApps`
render value — otherwise two quick edits would both start from the same stale snapshot and the second
would overwrite the first (add Chrome then Firefox would persist only Firefox). A content-signature
guard re-syncs the ref only when the persisted list's *contents* change (a fresh `[]` snapshot on an
unrelated re-render must not reset an in-flight edit, but an async profile load or external edit must).

**Permission status surface.** The `computerUse:getPermissionStatus` IPC (in `startup/ipc/profile.ts`)
returns `{ screenRecording, accessibility }` from `computerUse/permissions.ts`. The Settings view reads
it passively on mount to render status, and the "Open System Settings to grant" button calls it with
`prompt: true`, which triggers the macOS Accessibility system dialog and deep-links to the Screen
Recording pane (`x-apple.systempreferences:...Privacy_ScreenCapture`) since Screen Recording has no
programmatic prompt. The card only renders while a permission is still missing.

**Write-time persistence (do not skip).** `userDataADO/profileSanitizer.ts` `sanitizeProfileV2` is
the single source of truth that **rebuilds the profile object field-by-field at write time**, so it
must emit a `computerUse` block (mirroring `browser`/`memex`/`codingAgentSettings`) — normalizing
`enabled` (`=== true`), `requireConfirmation` (`!== false`), and pruning `alwaysAllowedApps` to
non-empty strings. If the block is omitted, `updateComputerUseSettings` still updates the in-memory
cache (so the UI looks correct for the current session), but **every disk write strips
`computerUse`**, so the settings silently reset on the next launch and the always-allowed list
appears to do nothing. Covered by `profileSanitizer.test.ts`.

## 5. Built-in Tool Wiring

### 5.1 Registration

In `BuiltinToolsManager.initialize()`, alongside `this.tools.set('browser', ...)` (~line 334) and
`this.tools.set('memex_memory', ...)` (line 341):

```ts
this.tools.set('computer_use', ComputerUseTool.getDefinition());
```

Metadata is always registered; visibility is gated dynamically (same as browser/memex).

### 5.2 Advertise gate -- `shouldExposeTool(name)` (line 1261)

```ts
if (name === 'computer_use') {
  const alias = this.profileCacheManager.getCurrentUserAlias();
  return alias ? this.profileCacheManager.getComputerUseSettings(alias).enabled === true : false;
}
```

(`profileCacheManager.getComputerUseSettings` is the cache-level accessor delegating to the CRUD
function, mirroring `getBrowserSettings`.)

### 5.3 Run gate + dispatch -- `executeTool(...)` (line 784)

Mirror the browser branch (lines 896-903). Because `hasTool` (line 1192) deliberately skips
visibility gates, a stale call still lands here and gets a recoverable error rather than a crash:

```ts
} else if (name === 'computer_use') {
  if (!executionContext) {
    return { ok: false, error: 'computer_use requires an active main-agent execution context.' };
  }
  if (executionContext.isSubAgent) {
    return { ok: false, error: 'computer_use is unavailable to sub-agents; real desktop control is main-agent only.' };
  }
  if (executionContext.interactionPolicy !== 'allow-ui') {
    return { ok: false, error: 'computer_use is unavailable in non-interactive runs; real desktop control requires the local app UI.' };
  }
  const alias = executionContext.userAlias;
  const enabled = alias
    ? this.profileCacheManager.getComputerUseSettings(alias).enabled === true
    : false;
  if (!enabled) {
    return { ok: false, error: 'computer_use tool is disabled (enable it in Settings -> Computer Use)' };
  }
  const { ComputerUseTool } = await import('./computerUseTool');
  return await ComputerUseTool.execute(args, { signal, chatSessionId, workspaceRoot });
}
```

The `executionContext` must be the captured main-agent context passed by `BuiltinMcpClient`; renderer
IPC/direct `BuiltinToolsManager.executeTool` calls without that captured context fail closed before
checking profile settings or importing `computerUseTool.ts`. The context must also carry
`interactionPolicy: 'allow-ui'`; scheduled-silent (`forbid`), background sub-agent auto-wake parent
turns (`forbid`), and other non-UI runtimes fail closed before permission/settings checks or the
lazy `computerUseTool.ts` import.

### 5.4 Tool definition (single tool + action enum)

One tool, an `action` discriminator, and per-action optional args -- same ergonomics as `browser`:

| action | args | result |
|--------|------|--------|
| `screenshot` | `display?` | vision image payload + capture dims + multi-display layout + foreground app id |
| `list_displays` | -- | `[{id, bounds, scaleFactor, primary}]` |
| `list_windows` | -- | `[{appId, title, focused}]` |
| `focus_window` | `appId` \| `title` | `{ok}` |
| `move_mouse` | `x`, `y` | `{ok}` |
| `click` / `double_click` / `right_click` | `x`, `y`, `button?` | `{ok}` (confirm-gated) |
| `drag` | `from{x,y}`, `to{x,y}` | `{ok}` (confirm-gated) |
| `scroll` | `x`, `y`, `dx`, `dy` | `{ok}` |
| `type_text` | `text` | `{ok}` (confirm-gated) |
| `press_key` | `key` | `{ok}` (ungated only for true navigation keys; text/activation/destructive keys flow through confirmation) |
| `hotkey` | `keys[]` | `{ok}` (confirm-gated; single activation/destructive keys follow the same high-impact rule as `press_key`) |
| `wait` | `ms` | `{ok}` |
| `read_accessibility_tree` *(v2)* | `appId?` | structured node tree |

Coordinates in args are **screenshot-image-space**; the manager maps them (section 7) before dispatch.

### 5.5 Vision return shape

`screenshot` returns the `{ type: 'image', data, mimeType }` shape the turn runner already
understands (embeddedBrowserTool.ts line 368), plus the capture's pixel **dimensions** and a
human-readable **description**:

```ts
return {
  type: 'image',
  data: <raw base64, NO "data:" prefix>,
  mimeType: 'image/jpeg',
  width: <captured px>,
  height: <captured px>,
  description: 'Screenshot of display #2 (1280x800px). Frontmost app: Freeform. ' +
    'Displays: #1 1920x1080@(-1920,0) secondary; #2 2056x1329@(0,0) primary [captured]. ...',
};
```

The `data:` prefix must be omitted -- it breaks the runner's transcript-dedup hashing and the
base64-scrubbing that keeps the persisted transcript small. `desktopControl.defaultCapture`
produces a **downscaled JPEG** buffer (section 6.1) via `NativeImage.toJPEG(quality)`, then
base64-encodes it; the manager forwards `frame.mimeType` unchanged.

Two fields beyond the image are load-bearing:

- **`width`/`height`** are threaded by `agentChatTurnRunner.persistToolResult` into the injected
  vision message's `metadata`. Without them `ImageTokenCalculator` throws *"Width and height are
  required for auto/high detail calculation"* on every screenshot turn, which aborts the
  compression check and (per the token-estimation postmortems) silently risks context overflow in
  an inherently screenshot-heavy session.
- **`description`** (built by `ComputerUseTool.describeShot`) becomes the tool's **text** result so
  the model keeps situational context after the raw bytes are scrubbed: the captured display id,
  the full multi-display layout (each display's bounds + primary/secondary role, with the captured
  one tagged), the **OS frontmost app**, and a hint to `focus_window` / re-screenshot another
  display when the intended target is not frontmost or not on the captured screen. This is the
  primary guard against the model clicking on the wrong app/display when its target is unfocused
  or off-screen.

## 6. Perception

### 6.1 Screen capture (reuse existing)

Reuse the screenshot module's approach: `desktopCapturer.getSources({ types: ['screen'],
thumbnailSize: { width, height } })` -> `NativeImage[]` (ScreenshotManager.ts `captureAllDisplays`
line 214). The manager:

1. picks the requested/primary display (or composites all) — `selectCaptureSource` matches the
   `desktopCapturer` source by `display_id`, then by the display's positional **index** (Windows
   commonly returns an empty `display_id`, so id-only matching silently fell back to the primary
   monitor on multi-monitor setups), then `sources[0]`;
2. **downscales and JPEG-encodes** the frame so it fits the model's request-body budget
   (see 6.1.1) and records the **actual encoded pixel dimensions**, returning them with the image
   so the model grounds coordinates against a known frame;
3. attaches the foreground app identity (the OS frontmost app via `DesktopControl.getFrontmostApp()`,
   captured in parallel with the frame) for model situational context. The allowlist gate does **not**
   rely on this potentially stale screenshot cache; it refreshes the OS foreground app immediately before
   ordinary mutating dispatch. On Windows this identity is the process's
   **friendly name** (`FileVersionInfo.FileDescription`, e.g. `Microsoft Edge`) plus the raw process
   name (`msedge`) as allowlist candidates; the friendly name is resolved through a **cached probe
   assembly** (compiled once into `os.tmpdir()`, reloaded ~0.5s thereafter) rather than recompiling
   inline C# (~1.2s) on every screenshot, with an inline `Add-Type` fallback if the cache is
   unavailable.

macOS Screen Recording is checked first via `systemPreferences.getMediaAccessStatus('screen')`
(line 102). On macOS 15+, `desktopCapturer` returns empty until the app is **restarted** after the
grant; surface this in the result and Settings (the screenshot module already retries 3x).

### 6.1.1 Downscale + JPEG (request-size budget)

A full Retina / 4K display captured losslessly is multiple megapixels; encoded as PNG it is a
**~3 MB base64 payload per screenshot**. Computer Use is inherently multi-screenshot, and the turn
runner injects each distinct frame as a persistent vision message, so a few full-resolution PNGs
accumulating in one conversation overflow the model endpoint's request-body limit and the request
fails with **HTTP 413 "Request Entity Too Large"** (observed against the `gpt-5.5` `/responses`
endpoint). `desktopControl.defaultCapture` therefore:

- requests a `thumbnailSize` scaled so the **long edge is at most `MAX_SCREENSHOT_LONG_EDGE`
  (1280px)** -- the resolution vision computer-use models are tuned for; larger images get
  downscaled server-side anyway, wasting tokens and hurting coordinate accuracy;
- encodes the frame as **JPEG** at `SCREENSHOT_JPEG_QUALITY` (80) instead of lossless PNG.

Together these cut a single screenshot from ~3 MB to a few hundred KB (~10x), giving ample headroom
for a multi-step session. Coordinate mapping is **unaffected**: it is fraction-based
(`imagePoint / imageDims * bounds`, section 7), and the **downscaled** dimensions are what is
emitted to the model and stored in `lastFrame`, so image-space and grounding stay consistent.

### 6.2 Accessibility (new)

For app targeting and (v2) tree reading, add Accessibility handling -- **not present anywhere
today**:

```ts
// permissions.ts (macOS)
const trusted = systemPreferences.isTrustedAccessibilityClient(/* prompt */ false);
// pass prompt=true from the Settings "Grant" button to open the system prompt
```

v1 ships **screenshot + coordinate grounding** (Accessibility still required for synthetic input
to reach other apps and for window focus). v2 adds `read_accessibility_tree` (macOS AX API /
Windows UIAutomation) to enrich targeting; this is isolated behind the optional action so v1 does
not block on it.

## 7. Coordinate Mapping

`coordinateMapping.ts` is pure and fully unit-testable. Mapping is two steps:

```
// 1. mapImagePointToScreen -> a LOGICAL screen point (DIP)
logicalPoint = display.bounds.origin
             + (imagePoint / captureDims) * (display.bounds.size)
// 2. DesktopControl.toDriverPoint -> the coordinate space the input driver expects
driverPoint  = platform === 'darwin'
             ? logicalPoint                       // nut.js uses logical points on macOS
             : screen.dipToScreenPoint(logicalPoint) // native pixels on Windows/Linux
```

`ComputerUseManager.groundPoint` runs both: it maps the model's point against the last captured
frame for the current chat session, then calls `desktop.toDriverPoint(point, frame.scaleFactor)`. The real Electron-backed
`DesktopControl` keeps macOS points logical and uses `screen.dipToScreenPoint` on Windows/Linux, so
Electron performs the DIP -> native-pixel conversion with the correct physical origin for mixed-DPI
multi-display layouts. The pure `coordinateMapping.toDriverPoint` helper remains as a fallback for
non-Electron seams and tests where only `scaleFactor` is available. `groundPoint` returns **both** the
logical point (used to position the on-screen cursor overlay, section 8.3) and the driver point
(handed to nut.js). Step 2 is mandatory on Windows — Electron is per-monitor DPI-aware, so libnut's
`SetCursorPos`/`SendInput` operate in physical pixels; feeding logical points makes every click land
short by the scale factor on scaled displays (125%/150% are Windows defaults), while multiplying an
absolute DIP coordinate by a single display's scale factor can misplace secondary mixed-DPI displays
whose physical origin differs from `logicalOrigin * scaleFactor`. Inputs: captured image dimensions
(from section 6.1), the chosen `display.bounds` + `scaleFactor` (Electron `screen.getAllDisplays()`),
the model's image-space point, and the desktop conversion seam. Output: a screen point the input driver
accepts. Multi-display is handled by selecting the display whose bounds the screenshot came from,
adding its logical origin, then converting the resulting DIP point through Electron. Out-of-range
points return a recoverable error rather than clamping silently.

## 8. Execution (synthetic input)

### 8.1 Why a new native dependency

The repo has `node-screenshots`, `sharp`, `playwright(-core)` -- **no OS-level input library**
(`nut.js`/`robotjs` absent). Electron `webContents.sendInputEvent` injects only into the app's own
`BrowserWindow`s, not other applications, so it cannot drive native apps. OS-wide synthetic input
requires a native module.

**Recommendation:** `@nut-tree-fork/nut-js` (`^4.2.6`) -- the maintained community fork; the
original `@nut-tree/nut-js` is no longer published (404). Fallback: `@computer-use/nut-js`
(`^4.2.0`). Both ship prebuilt native binaries (`libnut`) and require `node >= 16`.

**Packaging (critical):** runtime native deps for the main process must go in `dependencies` (or
`optionalDependencies`), **never** `devDependencies` -- otherwise they are stripped from the
packaged app. Computer Use is opt-in and platform-sensitive, so `optionalDependencies` is the
right bucket: a machine/build without the binary still launches; the manager detects the missing
driver and returns a structured "input driver unavailable" error. Verify asar/native handling and
prebuild inclusion in the build pipeline.

```jsonc
// package.json
"optionalDependencies": {
  "@nut-tree-fork/nut-js": "^4.2.6"
}
```

#### 8.1.1 Bundler externalization (the "Input driver unavailable" trap)

Putting the dep in `optionalDependencies` is necessary but **not sufficient**. The main process is
bundled (electron-vite / webpack), and both bundlers auto-externalize only `dependencies` --
**`optionalDependencies` are bundled by default**. If `@nut-tree-fork/nut-js` is bundled, its native
loader `libnut-darwin/permissionCheck.js` (`require("bindings")("libnut")`) is inlined into the main
chunk; the `bindings` package then resolves the addon **relative to the app/bundle root instead of
the `libnut-darwin` package dir** and cannot find `libnut.node`, so every pointer/keyboard action
fails at runtime with:

> `Input driver unavailable: Could not locate the bindings file. Tried: <appRoot>/build/Release/libnut.node ...`

The screenshot path still works (it uses Electron `desktopCapturer`, not nut.js), which makes this
look like a partial outage: the agent can *see* the screen but cannot *act*. To prevent it,
`@nut-tree-fork/*` must be kept **external in every bundler** and **unpacked from asar**:

| Path | File | Entry |
|------|------|-------|
| Vite main build (dev + Vite packaging) | `electron.vite.config.ts` | `rolldownOptions.external` includes `/^@nut-tree-fork\//` |
| Webpack main build (release `npm run build`) | `webpack.main.config.js` | `nativeModules` list includes `@nut-tree-fork/nut-js` |
| Packaging (asar) | `electron-builder.config.js` | `asarUnpack` includes `node_modules/@nut-tree-fork/**` |

Externalizing the top-level package is enough -- once it is external the bundler stops at that
boundary, so the transitive `libnut-*` / `node-mac-permissions` / `bindings` requires all resolve
from `node_modules` at runtime with the correct module root. Verify a build with
`grep -r 'require("@nut-tree-fork/nut-js")' dist-vite/main` (should be an external require, not the
inlined `permissionCheck`/`highlight` source).

#### 8.1.2 Jimp override for dependency-review safety

`@nut-tree-fork/nut-js@4.2.6` depends on `jimp@0.22.10`, whose `@jimp/core -> file-type@16.5.4`
chain is covered by GHSA-5v7r-6r5c-r473 (`file-type >=13 <21.3.1`). `package.json` therefore pins
an npm override `jimp: 1.6.1`, which brings `@jimp/core@1.6.1` and `file-type@21.3.x` (Node >=18) while
keeping the `@nut-tree-fork/nut-js` top-level module loadable. OpenKosmos uses only the nut keyboard/mouse
APIs through `inputDriver.ts`; do not start using nut's optional image-resource helpers without
revalidating this override, because those helpers are outside the Computer Use integration surface.

#### 8.1.3 Windows ARM64 support gate

`@nut-tree-fork/nut-js@4.2.6` does not ship a Windows ARM64 native input addon. A Windows ARM64
Electron build cannot load the x64 `libnut.node`, so Computer Use must fail closed before the
native module is imported:

- `computerUse/platformSupport.ts` is the single source of truth. It returns an unsupported reason
  for `process.platform === 'win32' && process.arch === 'arm64'`.
- `BuiltinToolsManager.shouldExposeTool('computer_use')` hides the tool on unsupported platforms
  even if the shared profile has `computerUse.enabled: true`.
- `BuiltinToolsManager.executeTool('computer_use', ...)` returns the same recoverable unsupported
  error for stale calls and does not dynamic-import `computerUseTool.ts`.
- `profile:updateComputerUseSettings` rejects attempts to enable the feature locally, while
  `computerUse:getPermissionStatus` includes `{ platformSupported, unsupportedReason }` so Settings
  can render a disabled unavailable card.

Do not remove this gate when changing packaging. It should only be relaxed after the selected input
driver is verified to ship and load a real Windows ARM64 addon in the packaged app.

### 8.2 Input driver wrapper

`inputDriver.ts` exposes a small interface and lazy-loads the native module so the rest of the code
(and tests) never imports it directly:

```ts
export interface InputDriver {
  moveMouse(p: Point): Promise<void>;
  click(p: Point, button?: 'left'|'right'|'middle'): Promise<void>;
  doubleClick(p: Point): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;
  scroll(p: Point, dx: number, dy: number): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  hotkey(keys: string[]): Promise<void>;
}
```

A `NoopInputDriver` (used when the optional dep is missing) makes the unavailable path testable and
keeps the manager honest about returning errors instead of throwing.

The nut.js adapter additionally wraps every pointer method in a `preservingCursor` helper so the
user's real hardware cursor is restored after each action (the mechanism and rationale are covered in
section 8.3).

**Key chords (`hotkey`/`pressKey`) release in the same order as the press, inside a `finally`.**
nut.js's `pressKey`/`releaseKey` each reverse their arguments internally and treat the **last** code as
the key with the rest as **modifier flags**, so the press and the matching release must be called with
**identical** ordering — never a pre-reversed array. The adapter's `releaseChord(codes)` attempts the
chord release once and, if it fails, releases each code individually so a held modifier (e.g. `Cmd`)
can never remain stuck down. See section 8.2.1 for the regression this guards.

#### 8.2.1 Regression: reversed chord release left `Cmd` stuck down

`hotkey` originally released with `releaseKey(...[...codes].reverse())`. Because nut.js reverses
**again** internally and treats the last code as the key + the rest as modifier flags (filtering
modifiers to native strings of length > 1), the reversed release made nut.js interpret the chord's
**key** as a modifier flag:

- `cmd+c` → release tried to use `"c"` as a modifier; length 1 → filtered out → **silently "worked"**,
  which is why the bug stayed hidden in tests/usage for letter chords.
- `cmd+space` → release tried to use `"space"` (length 5) as a modifier flag → libnut rejected it with
  **`"[nut.js] - Error: Invalid key flag specified."`** → `releaseKey` threw → **`Cmd` was never
  released**. With `Cmd` stuck down, every subsequent `type_text`/`press_key` became a `Cmd+<key>`
  shortcut (closing/minimizing windows via Cmd+W/Cmd+M), Spotlight could not receive text, and clicks
  became Cmd+clicks — matching the field report (Spotlight unusable, windows closing, erratic pointer).

Fix: release with the **same** order as the press, in a `finally` (so a throwing press still releases),
with a per-key fallback in `releaseChord`. A faithful nut.js keyboard simulator in
`inputDriver.test.ts` reproduces the original failure and asserts no key remains held after `cmd+space`.

### 8.3 On-screen cursor overlay + real-cursor preservation (action feedback)

Computer Use moves the OS pointer and clicks with **synthetic** input. On its own, nut.js's
`setPosition` moves the user's **real** hardware cursor, so the pointer would fly to every target — the
opposite of the desired "my mouse sits still while something else clicks." Two cooperating pieces give
the user **two visibly independent cursors**:

1. **The real cursor is preserved.** `inputDriver.ts` wraps every pointer action (`moveMouse`/`click`/
   `doubleClick`/`drag`/`scroll`) in `preservingCursor`: it reads the OS cursor (`mouse.getPosition`),
   runs the action at the target, then snaps the real cursor back to where the user left it — in a
   `finally`, so the cursor is restored even if the action throws, and best-effort, so a missing
   `getPosition` (older nut.js) degrades to simply leaving the cursor at the target. The click/scroll/
   drag event still fires at the target (the cursor is there for the OS event) before the restore.
2. **The AI cursor visualizes the action.** `cursorOverlay.ts` paints a dedicated, visually distinct
   **"AI cursor"** (a glowing pointer with an "AI" label) that follows the action trajectory so the user
   can watch the agent in real time.

Mechanism: the manager emits a `CursorSignal` (`{ kind, point (logical DIP), to?, button?, display }`)
from every pointer method (`move`/`click`/`double`/`drag`/`scroll`). Each pointer method signals the
overlay **before** it `await`s the synthetic input (nut.js), so the AI cursor starts moving toward — and
renders at — the target *ahead of* the real action, instead of appearing only after the app has already
reacted (grounding still runs first, so an out-of-range point never shows a cursor). For `click`/`double`/`scroll` the manager goes one step further and `await`s `cursor.settle()` **between** the signal and the synthetic input, and `drag` first emits a `move` signal + `settle()`s onto the grab point before pressing: `settle()` resolves when the in-page glide actually lands on the target (an awaitable `window.__cuSettle` resolved by the glide's arrival callback, with a ~1s in-page safety cap so it can never block the action), so the real input only fires **once the AI cursor has visibly arrived** — i.e. every mouse op "moves there, *then* acts", not "acts, then the cursor catches up". The overlay positions a borderless
`BrowserWindow` over the target display and injects a tweened cursor with **lifelike interaction
effects**. A click fires the instant the cursor **arrives** at the target — the spring `moveTo` takes an
`onArrive` callback that runs when the glide settles, so the click stamp is co-located in space *and*
time instead of fading out mid-glide: a spring "tap" (the ring snaps in then overshoots back), a bright
core flash, and a bold expanding **"sonar" ring** that radiates outward past the cursor's own glow so the
click reads clearly on both light and dark app backgrounds (right-click styled in pink; double-click
pulses twice). A drag holds a sustained **"button held down"** state for the whole duration of the drag
(the ring stays contracted, the core swells, and a halo breathes outward) along the drag trail with a
release ripple, and scroll gets a gentler tap pulse. The cursor **stays solid while the agent is active**
(no inter-action fade)
so it reads as a persistent second cursor. It is kept alive by `cursor.ping()` on **every** `screenshot()`
**and every keyboard/focus action** (`type_text`/`press_key`/`hotkey`/`focus_window`), so keyboard-heavy
stretches don't make it vanish. During capture the manager `cursor.hide()`s the overlay just before
`desktop.capture()` (so the AI cursor never paints into the model frame) and `cursor.ping()`s it back the
instant the frame returns — re-showing it **before** awaiting the slower frontmost-app probe, so it's
hidden only for the capture itself. The window self-hides only after `IDLE_HIDE_MS` (20 s) without any
signal or ping — sized to bridge the model's per-step think-time so the cursor stays continuously visible
throughout an operation and only disappears once the agent has truly stopped. Tradeoff: because
`move_mouse` also restores the real cursor, a pure hover does not persist for the next screenshot — the
agent should prefer clicks over hover-reveal UIs.

**Self-destruct on app shutdown (so the process can exit).** The overlay is a process-wide singleton
window that, between actions and after the idle timeout, is only **hidden** — never closed. A hidden
window still counts in `BrowserWindow.getAllWindows()`, so a lingering hidden overlay would keep Electron's
`window-all-closed` event from firing; on Windows/Linux `app.quit()` (in `main.ts`) would then never run and
the process would **stay alive after the user closes the main window** (the window disappears but the
process lingers). To prevent this, the overlay arms `watchHostWindowsForShutdown` the first time it creates
its window (once per process): the watcher attaches a `once('closed')` listener to every real (non-overlay)
window — those open now and any opened later, via `app.on('browser-window-created')` — and disposes the
overlay (destroying its window) once none remain, so `window-all-closed` fires and the normal quit path
runs. Overlay windows are excluded from the watch via a `__cuCursorOverlay` tag stamped on the window in
`createOverlayWindow`. On **macOS** the main window only hides (never closes) on the red-button close, so the
watcher never fires there and the Dock-resident app lifetime is unchanged. `dispose()` is idempotent and
post-dispose signals early-return, so a late in-flight action cannot respawn the window and re-block quit.
This teardown lives entirely in `cursorOverlay.ts` (not `main.ts`) because the overlay singleton is the only
component that knows it created an otherwise-uncloseable window.

Three window properties are **load-bearing** — get any one wrong and the feature breaks something else:

| Property | API | Why it is required |
|----------|-----|--------------------|
| Click-through | `setIgnoreMouseEvents(true)` | The overlay sits above the target app. If it were not click-through it would intercept the synthetic click (and the user's real clicks). |
| Never focuses | `focusable:false` + `showInactive()` + `setAlwaysOnTop(true,'screen-saver')` + `skipTaskbar:true` | A window that grabbed foreground would (a) become the frontmost app and corrupt the allowlist gate's `getFrontmostApp()` on the next screenshot, and (b) misdirect nut.js, which targets the active window. |
| No animation throttle | `webPreferences.backgroundThrottling:false` | The window is permanently non-focused; Chromium would otherwise throttle rAF/timers to ~1 fps and kill the animation. |

> ⚠️ **Do NOT use `setContentProtection(true)` on this window.** It would keep the AI cursor out of the
> `desktopCapturer` frames, but on Windows `transparent:true` + content protection renders the window
> **completely invisible to the user** (a known Electron/Chromium limitation — Windows forces
> DirectComposition overlays for protected content, which Chromium disables under transparency). The AI
> cursor is instead kept out of model screenshots by `ComputerUseManager.screenshot()`, which calls
> `cursor.hide()` before `desktop.capture()` and `cursor.ping()` after — so the overlay is hidden only
> for the brief capture window. This is a best-effort race rather than an OS-level guarantee, which is an
> acceptable tradeoff against an invisible cursor.

The page is `about:blank`; all DOM and animation are injected from the main process via
`webContents.executeJavaScript`, which runs in the page main world and bypasses any page CSP — so the
overlay needs **no** preload script, IPC channel, HTML entry, or bundler change (unlike the screenshot
selection overlay, which is interactive and needs a real renderer). A one-time bootstrap defines
`window.__cu(payload)`; each action calls it with window-local CSS coordinates. Because the window loads
asynchronously, a signal arriving before `did-finish-load` is stashed (latest-wins) and flushed once the
bootstrap resolves. The whole surface is **fire-and-forget**: `CursorIndicator.signal/hide/dispose` never
throw, so a visualization failure can never break an agent action. It is injected into the manager via a
`CursorIndicator` seam (default `NoopCursorIndicator`), keeping the manager and its tests free of
Electron. Shipped **on by default** in v1 with no settings toggle (a possible follow-up).

Every show — `signal()` (a new action) and `ping()` (keep-alive) — goes through a private `raise(win)`
helper that calls `showInactive()` and then **re-asserts** `setAlwaysOnTop(true,'screen-saver')` and
`moveTop()`. Re-raising on every show (not only at window creation) is load-bearing on Windows: once the
agent activates a real foreground app — e.g. a **maximized** Paint/editor it is driving — a window whose
always-on-top level was stamped only at creation can silently fall **behind** that newly-active app, so the
AI cursor paints under the target and the user sees nothing (it looks like the cursor "disappeared" even
though it is mechanically healthy and renders correctly in isolation). `showInactive()` re-shows the window
but does not re-raise it past a foreground app. `raise()` additionally logs each hidden→visible transition
(`[ComputerUse] cursor overlay shown (ready=… bounds=…)`) at low frequency, so a "cursor not visible"
report is diagnosable straight from the dev harness: a `shown ready=true` line with no on-screen cursor
indicates a compositing/z-order problem rather than a signal/disposal problem.

On **macOS**, `raise()` additionally calls `ensureDockIconVisible()` — a darwin-only, idempotent helper
that re-asserts `app.dock?.show()` (wrapped in try/catch; Dock restore is best-effort and must never break
the cursor). Putting this `transparent` + `frame:false` + `skipTaskbar:true` window on screen makes macOS
drop the app to an "accessory" activation policy and **hide OpenKosmos's Dock icon** as a side effect — the same
reason `ScreenshotManager.cleanup()` calls `app.dock?.show()` around its region-capture overlay. Without the
restore, the Dock icon vanishes the moment the first pointer action shows the overlay; combined with the
occlusion of the main window by the app being driven, the user is left with **no window and no Dock icon**
and believes OpenKosmos was closed and unrecoverable. Because `raise()` runs on every show, the icon is
re-asserted on each action and recovers within one action cycle. It is a no-op off macOS.

## 9. Human-in-the-loop Confirmation

Computer Use does **not** call `AgentChatInteractionService` directly. Instead it follows the same
recoverable, agent-driven pattern the rest of the tool surface uses: when an action needs approval,
`execute` returns a blocked envelope with a server-issued `confirmationId` and a server-generated
`confirmationRequest`; the agent is responsible for collecting consent via the
`request_interactive_input` built-in tool using that exact request and retrying with that id. This
keeps the tool boundary throw-free while preventing the model from fabricating approval or spoofing a
misleading approval card.

- **Blocked envelope.** `ComputerUseTool.maybeBlockForConfirmation(...)` (computerUseTool.ts)
  returns `{ ok: false, requiresConfirmation: true, confirmationId, confirmationRequest, error:
  '...Call request_interactive_input with exactly the provided confirmationRequest payload, then
  retry this action with confirmed:true and this confirmationId.' }`. No native input is dispatched.
- **Server-bound retry.** A subsequent `computer_use` call dispatches only when all of these are true:
  `confirmed === true`, `confirmationId` exists, that id was approved by a real
  `request_interactive_input` submit for the same chat session, and the retried action fingerprint
  matches the originally blocked action. The approved id is consumed once, so each high-impact action
  is approved on its own.
- **Trusted interactive request linkage.** The agent must pass the blocked envelope's
  `confirmationRequest` to `request_interactive_input` unchanged. The request includes
  `metadata: { computerUseConfirmationId: confirmationId }`, a runtime-generated action
  description, and the locked single-choice approve/cancel schema. The post-processor marks the
  confirmation approved only when the submitted request payload exactly matches the trusted stored
  payload and the user selected the preset approve option (`selectedPresetValues`, not free-form
  `customValues`); cancel, skip, timeout, an arbitrary model-supplied card, a custom "Other" value
  equal to `approve`, or arbitrary model-supplied `confirmed:true` do not unlock the retry.
- **Approval descriptions escape model-provided values.** `request_interactive_input` descriptions are
  rendered as HTML by the shared interactive card, so every dynamic value in the Computer Use
  confirmation description (`text`, `key`, `keys`, coordinates, button/action names) is HTML-escaped
  before it is stored in the trusted request. A malicious `type_text` payload must display as text,
  not execute while the approval card is rendered.
- **High-impact verb/shortcut guard.** `highImpactReason(action, args)` matches risky patterns
  (`RISKY_PATTERNS`: publish/post/delete/remove/pay/purchase/authorize/grant access/submit/
  confirm/save/merge/approve). It also
  structurally recognizes app/window-closing chords (`cmd+q`, `cmd+w`, `cmd+m`, `ctrl+q`, `ctrl+w`,
  `alt+f4`, `ctrl+f4`) even when the intent text is harmless, because those shortcuts can
  quit/minimize/close the active app or the OpenKosmos app itself (`alt+f4` is the Windows app-quit
  analog of `cmd+q`; `ctrl+f4` closes the active document/tab like `ctrl+w`). A high-impact reason
  **always** forces confirmation, even for always-allowed apps.
- **Allowlist scope.** `alwaysAllowedApps` suppresses confirmation **only** for ordinary mutating
  actions whose **current OS frontmost app** is in the list; `requireConfirmation:false` globally
  suppresses ordinary-action confirmation when no high-impact guard applies. Matching is
  **candidate-based**: `ComputerUseManager.refreshForegroundAppCandidates(chatSessionId)` re-probes
  `DesktopControl.getFrontmostApp()` immediately before the gate can bypass confirmation, updates the
  per-session foreground cache, and returns every identifier the frontmost app is known by — on Windows
  the **friendly name** (`Microsoft Edge`) *and* the raw **process name** (`msedge`); on macOS just the
  one app name. An action is allowlisted if any candidate matches any allowlist entry. A successful
  `focus_window` also refreshes this identity from the OS immediately after focusing. If the OS
  foreground cannot be resolved after focus or before dispatch, the foreground app stays unknown and
  ordinary mutating actions confirm. The gate never trusts the model-supplied `focus_window`
  query/title as an allowlist identity, and it never relies on the potentially stale foreground app
  captured with the previous screenshot. Both sides are normalized with
  `trim().toLowerCase().replace(/\.exe$/,'')`, so `Microsoft Edge`, `msedge`, and `msedge.exe` all
  match (the Settings field is free-text "App name or process name"). Earlier the gate compared only the
  win32 `ProcessName`, so allowlisting the app's real/friendly name never worked on Windows. It never
  bypasses the high-impact guard.
- **Coordinate pointer actions require explicit confirmation.** `click`, `double_click`,
  `right_click`, and `drag` always require confirmation unless the call is a confirmed retry. v1 has
  screenshot-only coordinate grounding and cannot prove whether a coordinate targets a benign control
  or a high-impact control such as Send, Delete, Submit, Pay, or Approve. Allowlisted apps and
  `requireConfirmation:false` still cover ordinary text/keyboard actions, but they do not bypass this
  coordinate-target uncertainty.
- **Keyboard gating.** Only true `press_key` navigation keys (`tab`, `esc`/`escape`, arrows, `home`, `end`,
  `pageup`, `pagedown`) bypass confirmation. Letters and digits can type into the focused app, so they
  flow through the normal gate (allowlist + `requireConfirmation`) like `type_text`. Activation keys
  (`enter`/`return`/`numenter`/`space`, which submit or confirm a focused control) and destructive keys
  (`delete`/`backspace`/`del`, which delete selected content) are treated as high-impact for both
  `press_key` and single-key `hotkey` calls and **always** confirm, even for always-allowed apps or
  `requireConfirmation:false`. Keep the key sets
  in `computerUseTool.ts` in sync with `inputDriver.ts`
  `nutKeyName`: a gated key missing from the alias map gets approved, then fails dispatch with
  `Unsupported key` (`numenter` maps to nut.js `Enter`, which has no distinct `NumPadEnter` member).
  There is no literal `' '` activation entry — the lookup trims input to `''`, so a space is matched
  only as `space`. Structural high-impact shortcuts also confirm without relying on model-supplied
  intent text: `cmd/ctrl+s` saves content, and `cmd/ctrl+enter` submits or sends content.
- **Non-mutating actions never gate.** `screenshot`, `list_displays`, `list_windows`, `focus_window`,
  and `wait` dispatch without confirmation, and so do `move_mouse` and `scroll`: moving the pointer or
  scrolling a view is non-destructive, and gating them would make the feature unusable. Only
  `click`/`double_click`/`right_click`/`drag`/`type_text`/`hotkey` (and every non-navigation
  `press_key`) reach the confirmation gate. Note `focus_window` itself changes the foreground app, so
  it clears the cached screenshot frontmost — see the allowlist bullet above. Because `scroll` is
  ungated, its `dx`/`dy` are **clamped to ±`MAX_SCROLL_DELTA` (100 nut.js clicks)** in
  `ComputerUseManager.scroll` (non-finite → 0) so an oversized model delta can't flood the native
  driver with thousands of scroll events; the agent issues another `scroll` to go further.

Decision flow per action:

```
enabled? --no--> disabled error
   |yes
permission ok? --no--> permission-required error (+ Settings hint)
   |yes
mutating action? --no--> dispatch (read-only)
   |yes
confirmed + approved matching confirmationId? --yes--> dispatch + consume approval
   |no
high-impact verb? --yes--> requiresConfirmation envelope
   |no
refresh OS foreground; foreground app in alwaysAllowedApps && requireConfirmation!==false? --yes--> dispatch
   |no
requireConfirmation? --yes--> requiresConfirmation envelope
   |                            (agent: request_interactive_input metadata -> retry with id)
   \--> dispatch + audit
```

**Residual risks (known, accepted for v1; tracked as follow-ups).**

- *Foreground vs. exact target mismatch.* The allowlist/confirmation decision re-probes the **system
  frontmost app** immediately before ordinary keyboard/text dispatch, so a stale screenshot or earlier
  focus event cannot bypass confirmation. It still does not inspect the exact focused control inside the
  allowlisted app, and coordinate pointer actions cannot prove what control sits under a pixel. Mitigations:
  pointer actions always confirm, app/window-closing chords always confirm, and the situational
  `describeShot` text surfaces both the captured display and the frontmost app so the agent can recover
  from display/focus mismatch. A future accessibility-tree layer can tighten the per-control target check.

## 10. Cancellation, Audit, Isolation

- **Cancellation.** `execute` receives the chat `AbortSignal`; the manager checks it before each
  step and between confirmation and dispatch, returning an `aborted` result promptly.
- **Audit.** Every dispatched action appends to `actionAudit.ts` (`{chatSessionId, action, target,
  ts, confirmed}`) for observability and post-hoc review.
- **Prompt-injection isolation.** All screen content (OCR'd text, button labels, image content) is
  untrusted input, never instructions. Defenses: default-off, OS permissions, default confirmation,
  high-impact guard, per-app allowlist, and the audit trail. The tool never elevates on-screen text
  into tool calls automatically.

## 11. Testing Strategy

CI enforces >=90% lines/functions/branches/statements on every changed `src/**/*.{ts,tsx}` file.
Plan:

| Area | Tests |
|------|-------|
| `coordinateMapping.ts` | Pure-function tests: `mapImagePointToScreen` (1x display, HiDPI capture larger than bounds, secondary display with non-zero origin, rounding, out-of-range -> error) + `toDriverPoint` (darwin passthrough, win32/linux `×scaleFactor`, scaleFactor=1 no-op, rounding). Every branch. |
| `permissions.ts` | Mock `systemPreferences`: screen granted/denied, accessibility trusted/untrusted, Windows no-op true. |
| `inputDriver.ts` | Drive the real adapter against a faked native module (inject the module), plus the `NoopInputDriver` unavailable path. Includes a **cursor-preservation** suite: every pointer action restores the real cursor to its start (`getPosition` → act → `setPosition(home)`), restore still runs when the action throws, it degrades when `getPosition` is unavailable, and the restore never throws when `setPosition` fails. Plus a **key-chord** suite: press/release use identical order, the chord still releases when the press throws, the per-key fallback runs when the chord release fails, and a **faithful nut.js simulator** (internal reverse + length>1 modifier filter + flag validation) reproduces the `cmd+space` "Invalid key flag" / stuck-`Cmd` regression and proves no key remains held. |
| `ComputerUseManager.ts` | Capture (mock `desktopCapturer`/`NativeImage`), frontmost-app capture at screenshot + precedence over `focus_window` + fallback, foreground-app **candidates** plumbing, live foreground refresh before allowlist bypass, enumerate/focus, dispatch ordering, **cursor signals (logical point) per pointer action**, abort between confirm and dispatch, audit writes. |
| `desktopControl.ts` | Display enumeration, `selectCaptureSource` (by id / by index / empty-id fallback / out-of-range) + Windows multi-monitor index capture, window listing + frontmost marking, `getFrontmostApp` (macOS/Windows parse via `parseWinForeground` — friendly name + process-name candidates, empty/error -> undefined, unsupported platform -> undefined), PID-based `focusWindow` (OK/NONE result mapping + `psQuote` single-quote escaping). |
| `cursorOverlay.ts` | `CursorOverlay` lifecycle against a fake window factory (lazy create + click-through/non-focusable wiring, ready-gating with stash-then-flush, window reuse + recreate-on-destroy, idle-hide via fake timers, `ping()` refreshing the idle timer + its no-op/guarded paths, re-raise-on-show, `settle()`, dispose, the shutdown watcher/self-destruct, and swallowed load/bootstrap/invoke/hide/destroy failures); `createOverlayWindow` options + the `__cuCursorOverlay` tag via a mocked `BrowserWindow`; `NoopCursorIndicator` + the singleton factory. The pure render helpers it re-exports are defined in (and their coverage attributed to) `cursorRenderer.ts`. |
| `cursorRenderer.ts` | The pure render helpers (`toLocalCss`/`buildPayload`/`cursorInvocation`, every branch) are driven through the `cursorOverlay` re-export. **Render smoke test** (`tests/e2e/cursor-overlay.e2e.ts`, Playwright Chromium): injects the REAL `BOOTSTRAP_SCRIPT` into a white page, drives `window.__cu` with a `buildPayload` click, screenshots, and `sharp`-decodes to assert the cursor paints a substantial violet footprint **at the click point** (with a near-zero negative control captured before the action) — gating the invisible-cursor class (opacity / transparent colour / broken payload mapping / white-on-white) that the fake-window unit tests cannot catch. |
| `computerUseTool.ts` | Disabled-settings error, permission-required error, vision payload shape (no `data:` prefix), high-impact confirm gate (approve/reject/timeout), live-refresh candidate-based allowlist (friendly-name match, process-name match, `.exe` strip, blank-entry rejection), every action branch, never-throws contract. |
| `profileSettingsCrud.ts` | `getComputerUseSettings` default-off coercion + `updateComputerUseSettings` validation/persistence. |
| `profileSanitizer.ts` | `sanitizeProfileV2` emits a normalized `computerUse` block (persisted, defaulted when absent, junk allowlist entries pruned) — guards the "settings reset on relaunch" regression. |
| Settings views | Render, toggle dispatches IPC, permission-state rendering, allowlist add/remove. |

Prefer integration-style tests that drive the real code with injected fakes over mock-only tests,
per repo guidance. Do **not** add coverage/file-length allowlist entries to pass gates -- split
files (each renderer component < 500 lines) and add real tests instead.

## 12. Known Tradeoffs

1. **Pixel grounding fragility.** v1 relies on the model's coordinate accuracy; mitigated by
   dimension annotation, deterministic scale-factor mapping, and the v2 accessibility-tree option.
2. **Native dep maintenance.** `nut.js` forks add platform/build surface; isolated behind
   `inputDriver.ts` and shipped as `optionalDependency` with a graceful unavailable path.
3. **macOS restart-after-grant.** Screen Recording needs an app restart on macOS 15+; unavoidable,
   surfaced in results and Settings.
4. **Real-machine risk.** Bounded by default-off, permissions, confirmation, allowlist scoping,
   audit, and cancellation rather than sandboxing.
5. **Linux.** Best-effort in v1; `nut.js` works under X11 but Wayland synthetic input is limited.
6. **Windows foreground first-call cost.** The friendly-name foreground probe compiles a tiny C#
   assembly the **first** time it runs in a process (~0.8–1.2s); it is cached on disk and reloaded
   (~0.5s) thereafter, and the probe runs in parallel with frame capture, so steady-state screenshot
   latency is unaffected. The probe is freshness-required (it feeds the allowlist relaxation), so the
   result is not cached across screenshots.
7. **AI cursor overlay is display-only, on by default.** It never blocks or alters input
   (click-through + fire-and-forget) and is hidden during each capture (rather than using
   `setContentProtection`, which is invisible on Windows under transparency — see section 8.3), so any
   failure degrades to "no visual indicator" rather than a broken action. v1 ships with no settings
   toggle, and the in-page animation is injected as a string whose rendering is gated by a **render
   smoke test** (`tests/e2e/cursor-overlay.e2e.ts`) that rasterizes the real bootstrap in a Chromium
   page and asserts the cursor paints visible pixels at the click point (plus `node --check` on the
   bootstrap + manual eyeballing in the running app); the
   coordinate/payload helpers around it are pure and fully tested. The companion piece — restoring the
   user's **real** cursor after every action (`preservingCursor` in `inputDriver.ts`, section 8.3) — is
   best-effort and wrapped in a `finally`, so if `mouse.getPosition` is unavailable it degrades to
   leaving the cursor at the target (old behavior) rather than failing the action. Tradeoff: this restore
   also fires for `move_mouse`, so a pure hover does not persist into the next screenshot; the agent
   should prefer clicks.

## 13. Documentation & Co-Change

When implementing, update together (per repo conventions):

- Create `src/main/lib/computerUse/ai.prompt.md` (Key Files, Architecture, Common Changes,
  Gotchas, Related) and add the module to the `arch-main.md` module table.
- Keep this Tech Doc and the [PRD](./computer-use-prd.md) in sync with the implementation.
- IPC changes: update `src/shared/ipc/` contracts and the IPC `ai.prompt.md`.
- Any new `computerUse` settings field must be added to `profileSanitizer.ts` `sanitizeProfileV2`
  (write-time normalization) or it will not persist — see section 4.
- `builtinToolsManager` change must keep advertise/execute/`hasTool` consistent (see section 5).
