# Embedded Browser Agent Control — Test Plan

<!-- Last verified: 2026-06-07 -->
<!-- Branch: yanhu/shaded-switch -->

Agent-facing control of the in-app embedded browser via the consolidated `browser`
built-in tool (`action`: navigate / screenshot / read_page / click / type / wait_for).
Backed by `EmbeddedBrowserManager` (one `WebContentsView` per chat session) with CDP
(`webContents.debugger`) trusted-input dispatch, and gated by the profile-level
`browser.enabled` switch in profile.json (Settings → Browser, default off).

**Automated status:** `embeddedBrowserTool.test.ts` (42 tests) gives the tool **100%
coverage**; the broader builtinTools suite (75 files / 1643 tests) stays green. A
standalone **real-Electron primitives probe**
(`tests/manual/embedded-browser-primitives.e2e.mjs`, **8/8 PASS**) exercises the live
`WebContentsView` + CDP mechanics the mocked unit suite cannot. The 8 manual
scenarios (MV-1…MV-8) below still require a running dev app + a live agent; several of
their underlying mechanics are now probe-verified (see the 🔬 annotations).

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Covered by automated unit tests |
| 🔬 | Mechanics verified in real Electron by the autonomous primitives probe |
| 🔧 | Can be supplemented with automated tests (not yet written) |
| 👤 | Requires manual verification (running app + a live page) |
| ⬜ | Not started |
| ✔️ | Manual verification passed |
| ❌ | Manual verification failed |

---

## Implementation Status Overview

| Area | Component | Status |
|------|-----------|--------|
| Tool | `embeddedBrowserTool.ts` — consolidated `browser` tool, 6 actions | ✅ Done |
| Tool | Registration in `builtinToolsManager` (lazy, app-switch-gated) | ✅ Done |
| Tool | Execute routing (`browser` → `EmbeddedBrowserTool.execute`) | ✅ Done |
| Manager | `ensureViewForAutomation` / `captureScreenshot` / `executeJs` | ✅ Done |
| Manager | `ensureDebugger` / `sendCdpCommand` / `detachDebugger` (CDP input) | ✅ Done |
| Manager | Singleton accessors `initEmbeddedBrowserManager` / `getEmbeddedBrowserManager` | ✅ Done |
| Wiring | `initEmbeddedBrowserManager(...)` replaces block-scoped `new` in startup IPC | ✅ Done |
| Auto-open | `panelOpenRequested` event → `revealForAutomation` atom action | ✅ Done |
| Renderer | `browser` entry in `toolCallDisplayConfig` (per-action labels) | ✅ Done |
| Setting | `browser.enabled` app-level switch (Settings → Browser) | ✅ Done |
| Docs | `embeddedBrowser/ai.prompt.md` + arch-main + builtin-tools docs | ✅ Done |
| Test | Dedicated `embeddedBrowserTool.test.ts` (42 tests, 100% coverage) | ✅ Done |

---

## Current Automated Coverage

The `browser` tool is covered by a dedicated unit suite plus the two manager
inventory-snapshot suites. `embeddedBrowserTool.test.ts` mocks
`getEmbeddedBrowserManager()` and the logger, while passing an explicit captured
`chatSessionId` option into `EmbeddedBrowserTool.execute()`, so every per-action branch
(arg validation, error envelopes, `normalizeUrl`, CDP dispatch shapes, `wait_for`
abort/timeout, the vision-image shape) is exercised with **no Electron
`WebContentsView`**. Verified at **100% coverage** of
`embeddedBrowserTool.ts` (statements 104/104, branches 56/56, functions 17/17, lines
99/99 — gate is 90%).

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | `browser` is registered in the built-in tool inventory (`browser.enabled` on) | ✅ | Pass | `builtinToolsManager-capability-parity.test.ts` — capability group "Embedded browser automation (navigate/screenshot/read/click/type/wait)" |
| 2 | `browser` dispatches to `EmbeddedBrowserTool.execute` | ✅ | Pass | `builtinToolsManager-execute-routing.test.ts` — routing case `{ action: 'read_page' }` |
| 3 | Per-action unit suite (42 tests, 100% coverage) | ✅ | Pass | `embeddedBrowserTool.test.ts` |

---

## Real-Electron Primitives Probe (autonomous)

The mocked unit suite proves the tool's *orchestration* (which string expressions and
CDP command names it emits) but, by design, never touches Electron. To close that gap
without a human in the loop, `tests/manual/embedded-browser-primitives.e2e.mjs`
launches the **actual built app** via `playwright-core`'s `_electron`, and inside the
real main process (`app.evaluate`) drives a live `WebContentsView` through the **exact
same Electron calls `EmbeddedBrowserManager` uses**. It is a probe of the platform
primitives the `browser` tool depends on — not the tool wiring itself.

Run: `node tests/manual/embedded-browser-primitives.e2e.mjs` → **8/8 PASS** (last run
2026-06-07, this host/Electron 35 build).

| # | Probe Check | Primitive proven | Underpins | Status |
|---|-------------|------------------|-----------|--------|
| 1 | Electron app launches + first window | real app boots under automation | harness | 🔬 Pass |
| 2 | `executeJavaScript(expr, true)` reads title/text/links | `read_page` / `wait_for` / resolver | MV-2, MV-4 | 🔬 Pass |
| 3 | `capturePage().toPNG().toString('base64')` → PNG magic bytes, no `data:` prefix | `screenshot` vision shape | MV-1 | 🔬 Pass |
| 4 | `debugger.attach('1.3')` + `Input.insertText` fires a **real** input event (mirror attr set) | `type` (CDP trusted typing) | MV-3 | 🔬 Pass |
| 5 | 3-step `Input.dispatchMouseEvent` (moved/pressed/released) triggers the click handler | `click` (CDP trusted mouse) | MV-3 | 🔬 Pass |
| 6 | Poll `executeJavaScript` until a delayed element appears | `wait_for` resolve loop | MV-4 | 🔬 Pass |
| 7 | Unguarded `attach` throws when already attached; `isAttached()` guard is a no-op | `ensureDebugger` re-attach guard | gotcha | 🔬 Pass |
| 8 | Two independent views hold separate DOM (`SESSION_A` / `SESSION_B`) | per-session view isolation | MV-7 | 🔬 Pass |

These checks verify the mechanics; they are **not** end-to-end agent runs. They do not
exercise the agent loop, the auto-open panel, vision-message injection into the
transcript, the feature flag, or the 5-min idle reclaim — those remain in the manual
checklist below (annotated 🔬 where the probe has de-risked the core mechanic).

---

## navigate

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Missing `url` returns `{ ok:false, error:'navigate requires a "url".' }` | ✅ | Pass | also whitespace-only `url` treated as missing |
| 2 | `normalizeUrl`: `localhost:3000` → `http://localhost:3000` | ✅ | Pass | loopback → http |
| 3 | `normalizeUrl`: `127.0.0.1` / `0.0.0.0` / `[::1]` → `http://…` | ✅ | Pass | loopback variants (incl. ports) |
| 4 | `normalizeUrl`: bare `example.com` → `https://example.com` | ✅ | Pass | default https |
| 5 | `normalizeUrl`: already-schemed `http://` / `https://` passes validation; non-web schemes (`file:`, `data:`, `javascript:`, `ftp:`) are rejected | ✅ | Pass | http/https allowlist |
| 6 | Calls `ensureViewForAutomation(sessionId, normalizedUrl)` and maps nav state → `{ ok, url, title, isLoading, canGoBack, canGoForward }` | ✅ | Pass | |
| 7 | Real environment: "open localhost:3000 and screenshot it" → panel auto-opens, navigates | 👤 | ⬜ | MV-1 |

## screenshot

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Returns a "navigate action first" error when no navigable page exists, without calling `ensureViewForAutomation(sessionId)` or revealing a blank view | ✅ | Pass | K3 regression guard |
| 2 | Returns the exact vision shape `{ type:'image', data, mimeType }` | ✅ | Pass | turn runner relies on this shape |
| 3 | `data` is raw base64 with NO `data:` prefix | ✅ | Pass | prefix breaks dedup hashing |
| 4 | Real environment: agent's next message references on-screen content (vision injected) | 👤 | ⬜ | MV-1 |

## read_page

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Calls `executeJs(readPageExpression())` and returns `{ ok:true, …page }` | ✅ | Pass | |
| 2 | Result caps: text ≤ 20000 chars, headings ≤ 50, links ≤ 100 | 🔧 | ⬜ | expression-level cap; not asserted in unit suite (would need a real DOM) |
| 3 | Real environment: agent gets title / url / visible text / links as JSON | 👤 | ⬜ | MV-2 |

## click

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Missing both `selector` and `text` returns `{ ok:false, error:… }` | ✅ | Pass | |
| 2 | Resolver returns `found:false` (or null) → `{ ok:false, matched:0, error:'No element matched…' }` | ✅ | Pass | both not-found arms |
| 3 | `found:true` dispatches 3 CDP `Input.dispatchMouseEvent` (mouseMoved / mousePressed / mouseReleased) at center x/y | ✅ | Pass | trusted click, asserted in order |
| 4 | Returns `{ ok:true, matched, tag }` on success | ✅ | Pass | |
| 5 | `text` selector arm embeds the visible-text needle in the in-page resolver | ✅ | Pass | `resolveTargetExpression` text arm |
| 6 | Real environment: "Click the Submit button" (by text) updates page | 👤 | ⬜ | MV-3 |

## type

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Missing `selector` returns `{ ok:false, error:'type requires a "selector".' }` | ✅ | Pass | |
| 2 | Non-string `text` returns `{ ok:false, error:'type requires "text".' }` | ✅ | Pass | |
| 3 | Focus resolver `found:false` → `{ ok:false, error:'No input matched…' }` | ✅ | Pass | |
| 4 | Dispatches `Input.insertText` with `text` (real `input` event → React updates) | ✅ | Pass | |
| 5 | `submit:true` dispatches 2 `Input.dispatchKeyEvent` (keyDown/keyUp Enter, vk 13) | ✅ | Pass | |
| 6 | `submit` omitted/false → no key events; returns `{ ok:true, submitted:false }` | ✅ | Pass | |
| 7 | Real environment: type into a React-controlled input → value updates | 👤 | ⬜ | MV-3 |

## wait_for

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Missing both `selector` and `text` returns `{ ok:false, error:… }` | ✅ | Pass | |
| 2 | Target present immediately → `{ ok:true, found:true, waitedMs }` | ✅ | Pass | first poll (selector + text arms) |
| 3 | Target never appears → resolves `{ ok:true, found:false, waitedMs }` at timeout | ✅ | Pass | fake-timer timeout, no throw |
| 4 | `signal.aborted` (pre-loop) → `{ ok:false, found:false, error:'aborted' }` | ✅ | Pass | executeJs never called |
| 5 | Abort mid-sleep during a poll wait → aborted envelope | ✅ | Pass | onAbort clears timer |
| 6 | Re-poll after sleeping resolves on later appearance | ✅ | Pass | exercises non-aborting signal listener add/remove |
| 7 | `timeoutMs` clamped: `>30000` → 30000, zero → immediate | ✅ | Pass | `Math.min/max` |
| 8 | Real environment: "wait for the success toast" resolves on appearance | 👤 | ⬜ | MV-4 |

## Error & context handling (cross-action)

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Missing `action` (and `undefined` args) returns `{ ok:false, error:'Missing required "action".' }` | ✅ | Pass | both optional-chain arms |
| 2 | No `chatSessionId` (undefined context or `{}`) → `{ ok:false, error:'No chat session context…' }` | ✅ | Pass | per-session targeting |
| 3 | `getEmbeddedBrowserManager()` null → `{ ok:false, error:'Embedded browser is not available…' }` | ✅ | Pass | |
| 4 | Unknown action → `{ ok:false, error:'Unknown action "…".' }` | ✅ | Pass | |
| 5 | A manager method that throws is caught → `{ ok:false, error:<message> }`, never throws out of `execute` | ✅ | Pass | Error + non-Error throws |

## Tool Registration & Routing

| # | Test Case | Type | Status | Notes |
|---|-----------|------|--------|-------|
| 1 | Capability parity: `browser` present in the full inventory (`browser.enabled` on) | ✅ | Pass | capability-parity |
| 2 | Execute routing: `browser` → `EmbeddedBrowserTool.execute` | ✅ | Pass | execute-routing |
| 3 | `browser.enabled` off: `browser` inventory + execution gated; execute returns disabled error | ✅ | Pass | manager-level gating covered by builtinToolsManager suites; the tool itself is unconditional |

---

## Summary

| Category | Count |
|----------|-------|
| ✅ Automated (passing) | 44 cases — `embeddedBrowserTool.test.ts` (42 tests, 100% coverage of `embeddedBrowserTool.ts`) + registration + routing |
| 🔬 Real-Electron probe (autonomous, passing) | 8 checks — `tests/manual/embedded-browser-primitives.e2e.mjs` (live `WebContentsView` + CDP primitives) |
| 🔧 Can add automation | 1 case — `read_page` in-page result caps need a real DOM rather than the tool unit |
| 👤 Requires manual verification | 8 scenarios (MV-1 … MV-8); MV-1/2/3/4/7 core mechanics de-risked by the probe |

The dedicated unit suite gives `embeddedBrowserTool.ts` **100% coverage** (statements
104/104, branches 56/56, functions 17/17, lines 99/99). It mocks
`getEmbeddedBrowserManager()` and passes a captured `chatSessionId`, so it
needs no Electron `WebContentsView` — the tool only orchestrates string expressions
and CDP command names. The remaining 🔧 row is deliberately out of unit scope:
the `read_page` caps live inside an in-page expression string (need a live DOM).

---

## Manual Verification Checklist

Requires a running app in dev (`npm run dev`), Browser enabled in Settings, and a
live page to drive (a local dev server on `localhost`, or any public site).

| # | Scenario | Verification Steps | Status |
|---|----------|-------------------|--------|
| MV-1 | Navigate + screenshot + vision injection | Ask the agent: "open localhost:3000 and screenshot it" → panel **auto-opens**, navigates, and the agent's next message references what's on screen | ⬜ (🔬 capturePage→PNG base64 probe-verified; auto-open + vision injection still need a live agent) |
| MV-2 | read_page | "Read the page" → agent receives title / URL / visible text / links as JSON | ⬜ (🔬 `executeJavaScript` read of title/text/links probe-verified) |
| MV-3 | CDP click + type into a React-controlled input | "Click the Submit button" (by text) and "type 'hello' into the search box" → real focus/typing; a React-controlled input visibly updates | ⬜ (🔬 CDP `Input.insertText` real-input-event + 3-step trusted mouse probe-verified) |
| MV-4 | wait_for resolve & timeout | "Wait for the success toast" → resolves on appearance; on a non-existent target it times out cleanly (no hang/throw) | ⬜ (🔬 poll-until-appears resolve probe-verified; timeout path covered by unit suite) |
| MV-5 | High-impact gate | Trigger a high-impact step (e.g. "publish") → agent first calls `request_interactive_input` and blocks for confirmation before acting | ⬜ |
| MV-6 | Idle-reclaim recovery | Leave the browser idle > 5 min, then drive it again → view is recreated from the remembered URL, not a hard failure | ⬜ |
| MV-7 | Two-session isolation | Open a browser in two chat sessions → actions stay isolated to the right session's view | ⬜ (🔬 two-view separate-DOM isolation probe-verified) |
| MV-8 | Browser setting off | Toggle Settings → Browser off → `browser` tool is absent / returns a disabled error; all embedded sidepanes and native views are destroyed | ⬜ |

---

## Detailed Manual Test Cases

### MV-1: Navigate, screenshot, and vision injection
**Precondition**: A local dev server (or any reachable site) is running.
**Instruction**: "Open localhost:3000 and take a screenshot, then tell me what you see."

**Expected**:
- The embedded browser panel **auto-opens** in the UI (via `panelOpenRequested` → `revealForAutomation`).
- The view navigates to `http://localhost:3000` (loopback → `http`).
- `navigate` returns `{ ok:true, url, title, isLoading, canGoBack, canGoForward }`.
- `screenshot` returns the vision-image shape; the agent's follow-up message describes on-screen content (vision message was injected, base64 stripped from transcript).

**Status**: ⬜ Pending

---

### MV-2: read_page structure
**Instruction**: "Read the current page and summarize its main links."

**Expected**:
- `read_page` returns `{ ok:true, title, url, text, headings, links }` (text ≤ 20000 chars, headings ≤ 50, links ≤ 100).
- The agent summarizes from the returned JSON without needing a screenshot.

**Status**: ⬜ Pending

---

### MV-3: CDP click + type (React-controlled)
**Precondition**: Page has a text input bound to React state and a Submit button.
**Instruction**: "Type 'hello' into the search box, then click the Submit button."

**Expected**:
- `type` focuses the field and dispatches `Input.insertText`; the React-controlled input's displayed value becomes `hello` (proves a real `input` event, not just `.value =`).
- `click` (by visible text "Submit") dispatches the 3-step trusted mouse sequence at the button center; the button's handler fires.

**Status**: ⬜ Pending

---

### MV-4: wait_for resolve and timeout
**Instruction (resolve)**: After an action that triggers a delayed toast: "Wait for the success toast."
**Instruction (timeout)**: "Wait for an element that will never appear, with a 3s timeout."

**Expected**:
- Resolve: returns `{ ok:true, found:true, waitedMs }` shortly after the element/text appears.
- Timeout: returns `{ ok:true, found:false, waitedMs≈3000 }` — no hang, no throw.

**Status**: ⬜ Pending

---

### MV-5: High-impact action gate
**Instruction**: "Publish the post." (or any irreversible action on the page)

**Expected**:
- The agent does **not** click publish directly. It first calls `request_interactive_input` (a blocking confirmation card) and waits for user approval, per the "stop before high-impact action" rule documented in the tool description.

**Status**: ⬜ Pending

---

### MV-6: Idle-reclaim recovery (> 5 min)
**Steps**:
1. Drive the browser to a URL, then leave the conversation idle for > 5 minutes (past `IDLE_MS`), so the view is reclaimed.
2. Ask the agent to screenshot or read the page again.

**Expected**:
- `ensureViewForAutomation` recreates the view and reloads the remembered URL (`lastUrls`), then completes the action. No "no browser for session" hard failure.

**Status**: ⬜ Pending

---

### MV-7: Per-session isolation
**Steps**:
1. In chat session A, navigate the browser to page X.
2. In chat session B, navigate the browser to page Y.
3. Run `read_page` in each session.

**Expected**:
- Session A reads page X; session B reads page Y. Each action targets the `chatSessionId` captured by `BuiltinMcpClient` and threaded through `BuiltinToolsManager.executeTool(..., chatSessionId)` — never a shared "current" view or a post-await mutable static context read.

**Status**: ⬜ Pending

---

### MV-8: Browser setting off
**Steps**: Toggle Settings → Browser off, then ask the agent to use the browser.

**Expected**:
- The `browser` tool is absent from the agent's tool list; if invoked through a stale path, `executeTool` returns the disabled error.
- The header entry, chat-link embedded routing, renderer sidepane state, and native `WebContentsView` instances are all disabled/destroyed immediately.

**Status**: ⬜ Pending
