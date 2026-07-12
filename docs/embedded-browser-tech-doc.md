# Embedded Browser Technical Design

> Version: 1.0.0 | Date: 2026-06-10

## 1. Overview

This document describes the embedded browser implementation for OpenKosmos. The feature adds an opt-in in-app browser side panel and an agent-facing `browser` built-in tool, both gated by the profile-level `browser.enabled` setting.

The implementation spans:

1. renderer settings, header, chat markdown, and panel state
2. typed IPC and preload whitelisting
3. main-process `WebContentsView` lifecycle management
4. built-in tool inventory and execution gating
5. documentation and tests

## 2. Design Principles

1. Keep native web contents in the main process.
2. Keep the renderer sandbox-safe and limited to IPC calls.
3. Use one browser side panel state per chat session.
4. Default the feature off and gate every user-visible and agent-visible entry point.
5. Treat URL scheme validation as a security boundary.
6. Return structured tool errors rather than throwing through the agent loop.

## 3. High-Level Architecture

```text
Settings -> profile.updateBrowserSettings(alias, { enabled })
        -> profile.json browser.enabled
        -> profileDataManager hooks hide/show UI and refresh MCP cache
        -> main profileCacheManager gates built-in tool inventory and execution

Chat markdown link click
        -> useEmbeddedBrowserEnabled + current session id
        -> EmbeddedBrowserAtom.open(sessionId, url)
        -> embeddedBrowser IPC open(sessionId, url)
        -> EmbeddedBrowserManager.open()
        -> WebContentsView.loadURL()

Agent browser tool
        -> BuiltinMcpClient captures chatSessionId + workspaceRoot before async dispatch
        -> BuiltinToolsManager.executeTool(..., chatSessionId, workspaceRoot)
        -> EmbeddedBrowserTool.execute()
        -> captured chatSessionId/workspaceRoot options
        -> EmbeddedBrowserManager automation API
```

## 4. Files and Responsibilities

| File | Responsibility |
|------|----------------|
| `src/main/lib/embeddedBrowser/EmbeddedBrowserManager.ts` | Owns per-session `WebContentsView` instances, URL validation, navigation, lifecycle, idle reclaim, screenshot, JavaScript execution, and CDP input. |
| `src/main/lib/embeddedBrowser/embeddedBrowserIPC.ts` | Registers typed renderer-to-main browser IPC handlers. |
| `src/shared/ipc/embeddedBrowser.ts` | Defines embedded browser IPC channels and payload types. |
| `src/preload/embeddedBrowser/invoke.ts` | Whitelists renderer invoke calls for the preload bridge. |
| `src/renderer/components/browser/embeddedBrowser.atom.ts` | Stores per-session browser panel state and dispatches renderer-side browser actions. |
| `src/renderer/components/browser/EmbeddedBrowserPanel.tsx` | Renders toolbar chrome, address input, resize/bounds reporting, and mount/unmount show/hide calls. |
| `src/renderer/components/chat/ChatViewHeader.tsx` | Shows the browser entry when `browser.enabled` is true and a chat session is active. |
| `src/renderer/components/chat/ChatSide.tsx` | Mounts the side panel for the active chat session. |
| `src/renderer/components/streaming/StreamingV2Message.tsx` | Routes http/https markdown links into the embedded browser when enabled. |
| `src/renderer/components/streaming/IncrementalMarkdownRenderer.tsx` | Routes incremental markdown links through the same setting gate. |
| `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts` | Registers browser metadata and dynamically gates public inventory and execution using `browser.enabled`. |
| `src/main/lib/mcpRuntime/builtinTools/embeddedBrowserTool.ts` | Implements the agent-facing browser actions. |
| `src/main/lib/mcpRuntime/mcpClientManager.ts` | Refreshes the built-in tools runtime snapshot when the browser setting changes. |
| `src/main/lib/userDataADO/profileSettingsCrud.ts` | Persists the per-profile browser setting in `profile.json`. |
| `src/main/startup/ipc/profile.ts` | Handles profile browser setting updates and tears down native views when disabled. |
| `src/renderer/lib/userData/profileDataManager.ts` | Updates renderer profile data, refreshes MCP cache, and dispatches browser-disable cleanup events. |

## 5. Settings Gate

The setting is stored as `browser.enabled` in `profile.json` and defaults to `false`.

When the setting is disabled:

1. `useEmbeddedBrowserEnabled()` hides the ChatView header entry.
2. Streaming markdown links render as safe external anchors with `target="_blank"` and `rel="noopener noreferrer"`.
3. Built-in tool inventory accessors omit the `browser` tool.
4. Direct execution of the `browser` tool returns a disabled-settings error.
5. Renderer state calls `closeAllAndDestroy()`.
6. Main-process state calls `EmbeddedBrowserManager.destroyAll()`.
7. Main-process IPC rejects view-control calls such as `open`, `navigate`, `show`, and `setBounds`; only `destroyAll` and `setActiveSession` remain callable for cleanup/bookkeeping.

The browser is not gated by a feature flag.

## 6. Main-Process Browser Manager

`EmbeddedBrowserManager` stores a `SessionView` per chat session and tracks the current foreground session.

Each `WebContentsView` uses:

1. `partition: 'persist:openkosmos-embedded-browser'`
2. `contextIsolation: true`
3. `sandbox: true`
4. `nodeIntegration: false`
5. no app preload

The manager supports three lifecycle states:

1. foreground: attached to `mainWindow.contentView`
2. background: detached and waiting for idle reclaim
3. destroyed: web contents closed and removed from the live view map

`lastUrls` is retained only for idle-reclaimed views so the page can be restored when the user or agent returns to the session. `destroyAll()` is stronger: it closes live views and clears remembered URLs/bounds so disabling the feature cannot resurrect prior pages after re-enable.

## 7. URL and Popup Security

All main-process navigation entry points validate that the final URL protocol is `http:` or `https:`, with one narrow exception: the agent tool `navigate` and the manager's `assertWebNavigationUrl` also accept `about:blank` as a bootstrap target so a view can be created and rendered before its first real navigation.

The following schemes are intentionally rejected:

1. `file:`
2. `data:`
3. `javascript:`
4. `ftp:`
5. custom OS protocol handlers

Renderer address-bar input keeps the strict web-only rule at the IPC boundary, so `about:blank` cannot be entered manually. Agent tool URL normalization applies the same web-only rule, except it maps `about:blank` to the empty bootstrap page before calling manager APIs. Popup creation, the `will-navigate` guard, and page-initiated navigation remain strictly `http:`/`https:` and never accept `about:blank`.

Popup handling denies creation of nested embedded browser windows. Only `http:` and `https:` popup URLs are forwarded to `shell.openExternal`; all other popup schemes are denied without invoking an OS protocol handler.

The `WebContentsView` also installs a `will-navigate` guard for page-initiated main-frame navigations. This prevents an already-loaded http/https page from moving the embedded browser to `file:`, `data:`, `javascript:`, `ftp:`, or custom protocol URLs through anchors, forms, scripts, redirects, or meta refresh.

## 8. Agent Tool Design

The built-in `browser` tool supports:

1. `navigate`
2. `get_state`, `back`, `forward`, `reload`, `stop`
3. `screenshot` with optional `viewport`, `width`, `height`, `fullPage`, and selector crop; `capture_visual_baseline` and `compare_visual_baseline`
4. `read_page`
5. `inspect`
6. `diagnostics`
7. `click`, `double_click`, `right_click`
8. `type`
9. `wait_for`, `wait_for_url`
10. `scroll`, `press_key`, `hover`, `clear`, `select_option`, `upload_file`, `paste`, `drag`, `set_slider`
11. `assert_visible`, `assert_text`, `assert_clickable`, `assert_enabled`, `assert_disabled`, `assert_url`, `assert_not_blank`, `assert_images_loaded`, `assert_media_rendered`, `assert_dialog_open`, `assert_toast`, `assert_table_rows`, `assert_form_validity`, `assert_menu_open`, `assert_tooltip`, `assert_drawer_open`, `assert_list_items`, `assert_card_visible`, `assert_no_console_errors`, `assert_no_network_errors`, `accessibility_snapshot`, `network_diagnostics`, `download_diagnostics`, `assert_downloaded`, `inspect_frames`, and `layout_audit`
12. `set_date` and `multi_select`

The tool receives the chat session and explicit trusted workspace root captured by `BuiltinMcpClient` before async dispatch boundaries. Single-agent chats resolve the root from `ChatConfig.agent.workspace`; multi-agent chats resolve it from the currently executing agent name in `ChatConfig.agents[].workspace`. It does not re-read the mutable static execution context after the lazy import path, so concurrent tool calls cannot retarget the browser to another session or validate local file actions against another chat's workspace.

Before creating or foregrounding a native view, `EmbeddedBrowserManager.ensureViewForAutomation()` verifies that the target session matches the renderer-reported active chat session. Background or scheduled sessions therefore fail with a structured error instead of driving an invisible or stale-bounds browser panel. For automation navigations, it best-effort enables the CDP Network domain before `loadURL()` so initial page-load traffic is captured for `network_diagnostics` and `assert_no_network_errors`; if DevTools or another debugger already owns CDP, navigation still proceeds and diagnostics report a warning instead of failing the browser action. Both navigation loads and non-navigation readiness waits honor the tool `AbortSignal`, remove listeners on cleanup, and stop the webContents when the chat turn is canceled.

The active-session check is repeated after navigation/readiness awaits and before screenshot, JavaScript execution, debugger attach, and CDP command dispatch. If the user switches chats or leaves the chat route while an action is in flight, the follow-on primitive fails instead of continuing trusted browser automation in a non-visible session.

For page-dependent actions, the tool first checks whether there is a live view or remembered URL. If no page exists, it returns a clean error telling the agent to navigate first. This avoids creating an empty browser panel just to fail.

`screenshot` returns a vision-compatible image payload. The turn runner removes raw base64 from the transcript and injects the image into the model request. For responsive validation, `screenshot` can first apply a standard `desktop` or `mobile` viewport, explicit bounded `width`/`height` values, `fullPage=true` to resize to the scrollable document bounds, or a locator to capture an element rectangle. Temporary viewport changes are restored after the capture. `capture_visual_baseline` and `compare_visual_baseline` store per-chat in-memory screenshot hashes and bounded raw screenshot baselines (32 entries / 25 MiB, cleared on browser session teardown) for quick visual regression checks; when dimensions match, the comparison also reports changed pixels, total pixels, changed ratio, changed bounds, the per-channel threshold used, and optional diff-image metadata. Raw diff PNG base64 is intentionally not nested in the JSON result because only top-level image tool results are vision-injected and transcript-scrubbed.

## 9. CDP and JavaScript Execution

`click`, `double_click`, `right_click`, `type`, `press_key`, and `hover` use Chrome DevTools Protocol trusted input where user-event fidelity matters:

1. resolve an element by selector or text using `executeJavaScript`
2. compute coordinates or focus target
3. send CDP `Input.dispatchMouseEvent`, `Input.insertText`, and `Input.dispatchKeyEvent`

`inspect`, `read_page`, `scroll`, `clear`, `select_option`, `paste`, and `diagnostics` use `executeJavaScript` for structured page state, DOM manipulation that mirrors browser QA workflows, and diagnostics. `inspect` includes accessibility-like names, ARIA state, focusability, dialogs, form controls, and validation messages. `diagnostics` combines manager-captured console/load/render failures with document readiness, resource timing summaries, image load state, canvas non-empty sampling, and video readiness metadata. `scroll` can target the window or a selector-scoped scroll container. Locator-based actions support CSS selectors, visible text where semantically unambiguous, ARIA role, accessible name, label, placeholder, test id, one same-origin iframe selector, and one open shadow-root host selector. Frame and shadow-scoped locators fail closed if the requested frame is absent/cross-origin or the requested host has no open shadow root; they do not fall back to the top-level document.

`open_local_file` provides Codex-style local HTML/report/demo preview without relaxing the navigation allowlist. The tool validates that the requested file's real path is inside the explicit trusted workspace root from tool execution context, serves that registered file plus explicitly referenced same-directory relative assets through a session-bound tokenized `http://127.0.0.1:<port>/preview/...` URL, and lets the embedded browser continue using only http/https navigation. Preview tokens are invalidated on chat-session browser cleanup (`destroySession`) and full browser teardown (`destroyAll`) rather than remaining readable until TTL expiry; full teardown also closes the localhost preview listener. Asset requests are allowlisted from `src`/`href`/`poster`/inline CSS `url(...)` references plus `url(...)` dependencies inside linked same-directory CSS files, and realpath-confined to both the opened file's directory and the trusted workspace root, so unreferenced sibling files, parent-directory paths, and symlink escapes are rejected.

`upload_file` uses the Chrome DevTools Protocol `DOM.setFileInputFiles` command so file inputs receive real local file paths. `drag` uses trusted CDP mouse events from source center to target center; `paste` uses `Input.insertText` after optionally focusing a resolved field. `set_slider` supports native range inputs and ARIA slider widgets by percentage. `set_date` handles native date/time-like inputs, and `multi_select` handles multiple-selection `<select>` elements. `scroll` can target a locator, move by pixels, jump to an edge, or scroll to a percentage. `wait_for_url` polls route transitions without requiring a follow-up read. Lightweight assertion actions let the agent check visibility, clickability, enabled/disabled state, URL transitions, non-blank rendering, image load state, canvas/video/SVG rendering, dialog/toast presence, menu/tooltip/drawer/card presence, table row counts, list item counts, form validity, text presence, console/load/render failures, resource timing HTTP failures, and captured CDP network failures without relying only on prose interpretation. `accessibility_snapshot` calls Chrome DevTools Protocol `Accessibility.getFullAXTree` for a browser-computed accessibility tree snapshot, caps it to 200 returned nodes, truncates long strings, and includes truncation metadata. `network_diagnostics` enables the CDP Network domain and combines captured response/failure events, redacted request/response headers, response timing metadata, and resource timing failures. Headers whose names indicate credentials or session state (`auth`, `cookie`, `csrf`, `xsrf`, `key`, `secret`, `session`, or `token`) are replaced with `[redacted]`; diagnostic URLs redact sensitive query parameters/fragments, and download diagnostics omit local save paths before tool results enter chat transcripts. `download_diagnostics` and `assert_downloaded` expose browser download lifecycle events for generated reports or exported files. `inspect_frames` reports frame URLs and same-origin accessibility; `layout_audit` detects horizontal overflow, offscreen elements, clipped scroll containers, overlapping controls, and distorted images.

Caller-provided selectors and text are embedded in page scripts only through `JSON.stringify(...)`.

Click and hover locators accept CSS `selector`, visible `text`, ARIA-like `role`, and accessible `name`, with optional `exact=true`. Before dispatching a click, drag, keyboard activation, or submit, the tool applies a conservative high-impact text guard for publish/post/delete/pay/purchase/authorize-style targets and returns a confirmation-required error instead of sending input.

The debugger is attached per view and detached when the view is destroyed.

## 10. Renderer State Flow

`EmbeddedBrowserAtom` stores session-keyed browser state:

1. `isOpen`
2. `url`
3. `title`
4. `canGoBack`
5. `canGoForward`
6. `isLoading`
7. global panel width and resizing state

`ChatSide` only renders the browser panel for the active chat session. Switching sessions unmounts the old panel and mounts the new one, which pairs `hide(oldSessionId)` and `show(newSessionId)`.

## 11. Disable Cleanup Flow

Disabling the setting runs cleanup on both sides of the process boundary:

1. renderer config update dispatches an `embedded-browser:disable` DOM event
2. root App listener calls `EmbeddedBrowserAtom.closeAllAndDestroy()`
3. preload invokes `embeddedBrowser:destroyAll`
4. main IPC calls `EmbeddedBrowserManager.destroyAll()`, which closes views and clears remembered URLs/bounds
5. main config persistence also calls `destroyAll()` on a true-to-false setting transition

This makes renderer state cleanup and native view cleanup defensive against missed events.

## 12. Build Packaging Note

The Vite main-process output uses stable dynamic chunk names for main chunks. Electron's main process is long-lived; after a rebuild, a lazy dynamic import must not point at an obsolete content-hashed chunk filename.

## 13. Testing Strategy

Coverage includes:

1. manager URL validation, lifecycle, identity, idle restore, and cancellation tests
2. built-in tool inventory and execution gating tests
3. embedded browser tool action tests
4. renderer atom and IPC tests
5. streaming markdown link routing tests for enabled and disabled states
6. manual Electron primitives probe for real `WebContentsView` and CDP behavior

Post-change verification uses:

1. relevant `npm test` suites
2. `npm run typecheck`
3. `npm run build:vite`

## 14. Known Tradeoffs

1. Browser storage is shared across sessions for convenience, so authenticated page state can be reused.
2. High-impact page actions use conservative text guards before trusted input dispatch; unknown localized or icon-only irreversible controls still rely on the agent's instruction to request confirmation, mitigated by the default-off switch and visible browser surface.
3. Background session automation can request panel reveal, but the renderer only mounts a panel for the active chat session.
4. Some native Electron behavior remains better covered by the manual primitives probe than by unit tests.
5. Direct `file://` navigation remains intentionally unsupported. Local HTML/report/demo preview is available through `open_local_file`, which uses a workspace-confined localhost server instead of relaxing the http/https navigation boundary. The only non-http(s) target the tool and main-process navigation guard accept is `about:blank` — a safe empty page agents can use to bootstrap a view; `file:`, `data:`, `javascript:`, `ftp:`, `mailto:`, and other schemes stay blocked.
6. Selector screenshots use the element's current viewport rectangle; cross-frame and shadow-DOM element screenshots are not yet implemented.
