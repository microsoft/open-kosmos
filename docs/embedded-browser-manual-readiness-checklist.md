# Embedded Browser Agent Control — Manual Readiness Checklist

<!-- Last verified: 2026-06-07 -->
<!-- Branch: yanhu/shaded-switch -->

A line-by-line, tick-as-you-go checklist to confirm the agent-driven `browser`
built-in tool is ready. Companion to the broader
[test plan](embedded-browser-agent-control-test-plan.md) (which records automated
coverage + the MV-1…MV-8 scenarios). This file is the **hands-on confirmation
sheet**: drive each check from a real dev app and mark the Result column.

Every expected value below is quoted verbatim from the implementation
(`embeddedBrowserTool.ts`, `EmbeddedBrowserManager.ts`,
`builtinToolsManager.ts`, `toolCallDisplayConfig.ts`,
`embeddedBrowser.atom.ts`), so a mismatch is a real regression — not a doc drift.

## Legend

| Symbol | Meaning |
|--------|---------|
| ⬜ | Not yet checked |
| ✅ | Verified working |
| ❌ | Failed (file a bug, note the # below) |
| ⏭️ | Skipped (note why) |

**Source tags** in the Pass-criteria column tell you how much each check is
already de-risked, so you can spend time where it matters:
- `[manual]` — only a live agent + human eyes can confirm this; **focus here**.
- `[probe]` — the underlying Electron/CDP mechanic is already proven by
  `tests/manual/embedded-browser-primitives.e2e.mjs` (8/8). A spot-check is enough.
- `[unit]` — fully covered by `embeddedBrowserTool.test.ts` (100%). Eyeball only if convenient.

---

## 0. Preconditions (do these first)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| P1 | Dev app runs with Browser enabled | `npm run dev` (OpenKosmos), then enable Settings → Browser | App boots and `browser.enabled` is true in profile.json. `[manual]` | ✅ dev app ran, browser tool available throughout testing |
| P2 | Test fixture reachable | Save the [Appendix A](#appendix-a--local-test-fixture) HTML as `fixture.html`, then `python3 -m http.server 8000` in that folder | `http://localhost:8000/fixture.html` opens in a normal browser and shows the form/button/link. `[manual]` | ✅ served on :8000; read_page returned its content |
| P3 | Two chat sessions available | Open chat session **A** and chat session **B** (for isolation, §12) | Both sessions exist and are switchable. `[manual]` | ✅ multiple sessions used (`lrqlomsf0`, `vhhja401p`, isolation pair) |
| P4 | (Optional) live logs | `bun scripts/log-query.ts --today --tail 50` while testing | Tool calls + `[EmbeddedBrowser]` lines visible for cross-checking. `[manual]` | ✅ chat-session JSON + dev logs used for cross-checking |

> The fixture is served over **http** on `localhost`, which the tool normalizes to
> `http://` (not `https://`). A public site works for navigate/screenshot/read_page,
> but click/type/wait_for need the fixture's known elements.

---

## 1. navigate

| # | Check | Steps (say to the agent) | Pass criteria | Result |
|---|-------|--------------------------|---------------|--------|
| N1 | Basic navigate + panel auto-opens | "Open localhost:8000/fixture.html" | Panel **auto-opens** in the UI; address shows the page; tool returns `{ ok:true, url, title, isLoading, canGoBack, canGoForward }` (agent can state the title "Probe Fixture"). `[manual]` | ✅ 2026-06-07 panel auto-opened, page loaded |
| N2 | loopback → **http** | "Open localhost:8000/fixture.html" | Resolved URL is `http://localhost:8000/...` (NOT https). `[unit]` | ✅ 2026-06-07 address bar shows http:// |
| N3 | bare domain → **https** | "Open example.com" | Resolved URL is `https://example.com/`. `[unit]` | ✅ 2026-06-07 |
| N4 | already-schemed passes through | "Open http://example.com" | Stays `http://example.com` (no forced https). `[unit]` | ✅ 2026-06-07 |
| N5 | missing url → error | (hard to force via NL; observe a malformed call if it happens) | Returns `{ ok:false, error:'navigate requires a "url".' }`. `[unit]` | ⏭️ covered by unit test (hard to force via NL) |
| N6 | revisit / refresh | After N1: "Reload that page" or "Open it again" | Reloads same URL; no crash; nav state refreshed. `[manual]` | ✅ 2026-06-07 |

---

## 2. screenshot (→ vision injection)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| S1 | Screenshot feeds the agent's vision | After N1: "Take a screenshot and describe what you see on the page." | Agent's **next message describes on-screen content** (proves the `{type:'image',data,mimeType:'image/png'}` shape was turned into a vision message; base64 stripped from transcript). `[manual]` | ✅ 2026-06-07 agent described Hello Probe / links / Submit+Publish / idle+success verbatim |
| S2 | Screenshot with no page → clean error, no view/panel created | In a **fresh** session: "Screenshot the browser." | The `screenshot` action checks `hasNavigablePage` first; with no live view and no remembered URL it returns a soft error `{ok:false,error:"…navigate first."}` and deliberately does **not** call `ensureViewForAutomation`, so no blank `about:blank` view is made and the browser panel does NOT auto-open (see K3). Once the session has navigated at least once, screenshot ensures/reveals the view normally. `[probe]` | ✅ 2026-06-07 screenshot-first surfaces the "navigate first" guard with no view created and no panel flash; post-navigate screenshot works (S1) |
| S3 | Raw base64, no `data:` prefix | (cross-check via logs/result if visible) | `data` is raw base64 with no `data:image/png;base64,` prefix. `[probe]` `[unit]` | ✅ tool result `{"type":"image","data":"…","mimeType":"image/png"}` has no `data:` prefix (probe+unit covered) |

---

## 3. read_page

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| R1 | Structured page read | After N1: "Read the page and list its links." | Agent answers from JSON `{ title, url, text, headings, links[] }` **without** taking a screenshot; the fixture's "Example Link" appears. `[manual]` | ✅ 2026-06-07 listed Example Link + Open external with hrefs, no screenshot |
| R2 | Result caps | On a very large page: "Read the page." | No context flood: text ≤ 20000 chars, headings ≤ 50, links ≤ 100. `[manual]` (cap lives in the in-page expression) | ⏭️ caps live in the in-page expression; fixture too small to trigger — skipped |

---

## 4. click (CDP trusted mouse)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| C1 | Click **by visible text** | After N1: "Click the Submit button." | Fixture's `#status` flips to `clicked` (3-step `Input.dispatchMouseEvent` at element center); tool returns `{ ok:true, matched, tag:'BUTTON' }`. Confirm via a follow-up screenshot or read_page. `[probe]` | ✅ 2026-06-07 status flipped idle → clicked |
| C2 | Click **by CSS selector** | "Click the element with selector #btn." | Same `clicked` result via selector arm. `[manual]` | ✅ 2026-06-07 `{action:click,selector:#btn}` → `{ok:true,matched:1,tag:BUTTON}` |
| C3 | No match → clean failure | "Click the Nonexistent button." | Returns `{ ok:false, matched:0, error:'No element matched the given selector/text.' }`; agent reports it couldn't find it (no crash). `[unit]` | ✅ 2026-06-07 returned exact error envelope; agent reported not found, no crash |
| C4 | Missing both selector & text | (observe malformed call) | Returns `{ ok:false, error:'click requires a "selector" or "text".' }`. `[unit]` | ⏭️ covered by unit test (hard to force via NL) |

---

## 5. type (CDP insertText into a controlled input)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| T1 | Type into a controlled input | After N1: "Type 'hello' into the #field input." | The input shows `hello`; the fixture mirrors it to `data-mirror="hello"` — proving a **real `input` event** fired (not just `.value=`), so React-controlled inputs would update. Returns `{ ok:true, submitted:false }`. `[probe]` | ✅ 2026-06-07 `{action:type,selector:#field,text:hello}` → `{ok:true,submitted:false}`; screenshot shows input value `hello` + focus ring (real-input-event/mirror already probe-verified) |
| T2 | Type + submit (Enter) | "Type 'world' into #field and submit." | `Input.insertText` then 2 `Input.dispatchKeyEvent` (Enter, vk 13); returns `{ ok:true, submitted:true }`. `[unit]` for key shape; `[manual]` for the form reaction | ✅ 2026-06-07 `{action:type,selector:#field,text:world,submit:true}` → `{ok:true,submitted:true}` |
| T3 | Missing selector | (observe) | `{ ok:false, error:'type requires a "selector".' }`. `[unit]` | ⏭️ covered by unit test (hard to force via NL) |
| T4 | Non-string text | (observe) | `{ ok:false, error:'type requires "text".' }`. `[unit]` | ⏭️ covered by unit test (hard to force via NL) |
| T5 | Selector matches no input | "Type 'x' into #nope." | `{ ok:false, error:'No input matched the given selector.' }`. `[unit]` | ✅ 2026-06-07 `{action:type,selector:#nope,text:x}` → exact error envelope; agent reported not found, no crash |

---

## 6. wait_for (poll until present / timeout)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| W1 | Resolve on appearance | Immediately after N1: "Wait for the text 'success' to appear." | Fixture adds `#toast` (text `success`) after ~400ms; returns `{ ok:true, found:true, waitedMs }` (small waitedMs). `[probe]` | ✅ `{"ok":true,"found":true,"waitedMs":3}` (toast already present, instant resolve) |
| W2 | Clean timeout | "Wait for selector #never with a 3 second timeout." | Returns `{ ok:true, found:false, waitedMs≈3000 }` — **no hang, no throw**. `[unit]` | ✅ `{"ok":true,"found":false,"waitedMs":3025}` (clean timeout, no throw) |
| W3 | timeout clamp | "Wait for #never for 99 seconds." | Caps at 30000ms (`MAX_WAIT_MS`); default when omitted is 10000ms. `[unit]` | ⏭️ unit-covered (clamp not observable from return value) |
| W4 | Missing both selector & text | (observe) | `{ ok:false, error:'wait_for requires a "selector" or "text".' }`. `[unit]` | ⏭️ unit-covered |

---

## 7. Auto-open panel behavior

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| A1 | Panel reveals on first agent action | Fresh session, panel closed: "Open example.com." | Panel flips open by itself (via `panelOpenRequested` → `revealForAutomation`). `[manual]` | ✅ panel auto-opened |
| A2 | No double-navigate | Watch the page during A1 (and logs) | Page loads **once** — `revealForAutomation` only flips `isOpen` + mirrors URL; it must NOT re-issue `open`/re-navigate. `[manual]` | ✅ single load, no re-navigate flicker |
| A3 | Mutual exclusion with file preview and singleton sidepanes | Open an inline file preview or singleton sidepane, then open the browser; with the browser open, toggle Schedules / Workspace / Sub-Agent Tasks. | Only one side panel is visible/active at a time. `[manual]` | ✅ found-then-fixed: browser open/toggle/reveal closes singleton sidepanes, and singleton sidepane entry points close the active session's browser panel before taking over. |

---

## 8. Tool-call display labels (renderer)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| U1 | Per-action labels render | Trigger each action once and read the tool-call chips in chat | navigate → `Opened http://localhost:8000/...`; screenshot → `Took a screenshot`; read_page → `Read the page`; click → `Clicked Submit`; type → `Typed into #field`; wait_for → `Waited for success`. `[manual]` | ✅ all 6 actions present in session `lrqlomsf0`; labels derived from logged args via pure `getBrowserDisplayText`: navigate→`Opened localhost:8000/fixture.html`, screenshot→`Took a screenshot`, read_page→`Read the page`, click→`Clicked Submit` / `Clicked #btn`, type→`Typed into #field`, wait_for→`Waited for success` / `Waited for #never` |

---

## 9. Cross-action error handling

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| E1 | Missing action | (observe malformed call) | `{ ok:false, error:'Missing required "action".' }`. `[unit]` | ⏭️ unit-covered (guard at tool L90; hard to elicit a no-action call from the model) |
| E2 | Unknown action | (observe) | `{ ok:false, error:'Unknown action "…".' }`. `[unit]` | ⏭️ unit-covered (default branch at tool L116) |
| E3 | No browser for session before navigate | In a fresh session: "Click the Submit button" (before any navigate) | Manager throws → tool returns `{ ok:false, error:'No embedded browser for this session. Call the navigate action first.' }`; agent recovers by navigating first. `[manual]` | ✅ session `vhhja401p`: click before navigate returned exactly `{"ok":false,"error":"No embedded browser for this session. Call the navigate action first."}`; agent did not crash, explained the situation and asked the user how to proceed (respected the "don't open any page" constraint) |
| E4 | Never throws out of execute | Any failing action | Agent always receives a readable `{ ok:false, error }` (turn does not crash). `[unit]` | ✅ two real failure paths in session `lrqlomsf0` returned clean errors, turn continued: click→`{"ok":false,"matched":0,"error":"No element matched the given selector/text."}`, type→`{"ok":false,"error":"No input matched the given selector."}` |

---

## 10. High-impact safety gate

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| G1 | Stop before irreversible action | On a page with a destructive control: "Publish the post" (or delete/pay) | Agent does **not** click it directly; it first calls `request_interactive_input` (blocking confirmation card) and waits for approval. `[manual]` | ✅ session `lrqlomsf0`: ordering verified from log — `request_interactive_input` (confirmation card "Confirm publish post", L1965) fired **before** `{"action":"click","text":"Publish"}` (L2006); the click only ran after the user approved. Agent never clicked Publish without confirmation. |

---

## 11. Idle reclaim & recovery (>5 min)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| I1 | View recreated from remembered URL | Navigate, then leave the session idle > 5 min (`IDLE_MS`), then: "Screenshot the page again." | View was reclaimed but is recreated and **reloads the remembered URL** (`lastUrls`); action completes — no "No embedded browser for this session" hard failure. `[manual]` | ✅ session `lrqlomsf0`: idle gaps of ~19.4 min then ~13.2 min (both ≫ 5-min `IDLE_MS`, so the view was reclaimed); both post-idle `read_page` calls returned full content `{"ok":true,"title":"Probe Fixture","url":"http://localhost:8000/fixture.html",...}` — view recreated from `lastUrls`, no hard failure. Control: session `vhhja401p` (never tool-navigated, no `lastUrls` entry) correctly returned "No embedded browser…", confirming recreation depends on a remembered URL. |

---

## 12. Per-session isolation

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| X1 | Two sessions, two independent views | In **A**: "Open example.com." In **B**: "Open localhost:8000/fixture.html." Then "Read the page" in each. | A reads example.com; B reads the fixture. Each action targets its own session's view — never a shared "current" view. `[probe]` | ✅ confirmed by manual two-session test — each session read its own page, no cross-talk |

---

## 13. Browser setting OFF

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| F1 | Tool gated when Browser is off | Toggle Settings → Browser off, then ask the agent to use the browser | `browser` absent from the tool list; if reached via a stale path, returns `{ ok:false, error:'browser tool is disabled (enable it in Settings → Browser)' }`. `[manual]` | ⏭️ skipped by tester. Code path confirmed: `builtinToolsManager` gates inventory/execution on `browser.enabled`. |
| F2 | Runtime state destroyed when Browser is off | With sidepanes open, toggle Settings → Browser off | Header entry disappears, chat-link embedded routing is disabled, renderer sidepane state is cleared, and all native `WebContentsView` instances are destroyed immediately. `[manual]` | ⏭️ skipped by tester. Covered by renderer/main unit tests. |

---

## 14. Known limitations to confirm (expected behavior, not bugs)

| # | Check | Steps | Pass criteria | Result |
|---|-------|-------|---------------|--------|
| K1 | Non-web URLs are rejected | "Open data:text/html,<h1>hi</h1>" and "Open file:///tmp/test.html" | `normalizeUrl` rejects non-http(s) schemes and returns `{ ok:false, error }`; the current page is not navigated. `[unit]` | ✅ unit-covered: `data:`, `file:`, `javascript:`, `ftp:`, and other non-web schemes are rejected before IPC/main-process navigation. |
| K2 | In-page popups go to the system browser | On the fixture, "Click the 'Open external' link" (target=_blank) | Opens in the OS default browser via `shell.openExternal` — it does NOT spawn another embedded panel. `[manual]` | ✅ session `lrqlomsf0`: `click text:"Open external"` (target=_blank) succeeded; no example.com appeared in the embedded panel (read_page still showed fixture) — popup routed to OS browser via `shell.openExternal`, no second embedded panel |
| K3 | Screenshot before the panel has bounds → empty image | In a **brand-new** session (panel never shown, never navigated): "Screenshot the browser." | **Fixed 2026-06-07 (clean gate, no side effects).** Previously returned `{type:'image',data:"",mimeType:'image/png'}` — an **empty** PNG — because a fresh `WebContentsView` is 0×0 and the real bounds arrive asynchronously via the `panelOpenRequested` → renderer round-trip, which had not completed by the time `captureScreenshot` ran. A first attempt to *synthesize* a default viewport + double-rAF paint did **not** work (verified against a live run: the rAF never fires on a non-compositing fresh view, so it hit the 500ms timeout and still captured 0 bytes). Final fix: the `screenshot` action checks `manager.hasNavigablePage(sessionId)` **first** — when the session has no live view and no remembered URL it returns `{ok:false,error:"…navigate first."}` **without** calling `ensureViewForAutomation`, so it does NOT create a blank view or auto-open the browser panel just to error. `captureScreenshot` keeps a defensive 0×0-bounds throw behind that. Consistent with `read_page`/`click`, which already require a live page. The normal `navigate`→`screenshot` flow (S1, view already sized) is unchanged. `[manual]` | ✅ 2026-06-07 fixed (screenshot-first returns a clear "navigate first" error and does not flash an empty panel open) |

---

## Finding A3 — mutual exclusion between the browser panel and singleton sidepanes

**Found 2026-06-07 (A3). Severity: medium (UX/state-consistency bug, not a crash). Status: fixed.**

The original readiness pass found a two-directional mutual-exclusion gap between the embedded browser and the Schedules / Workspace / Sub-Agent Tasks sidepanes. That gap is now fixed by coordinating the shared right-side slot in both directions: browser open/toggle/reveal closes singleton sidepanes, and singleton sidepane entry points close the active session's browser panel before rendering their own content. A3 is retained here as historical readiness evidence, not as an open issue.

---


| Field | Value |
|-------|-------|
| Build / commit | `c957cb28b` (feature commit on PR #764) |
| Brand | openkosmos |
| OS | macOS |
| Tester | yanhu (human-in-the-loop) + Claude (evidence cross-check) |
| Date | 2026-06-07 |
| Result | ⬜ All pass · ✅ **Pass with notes** · ⬜ Blocked |
| Bugs filed | **A3** (sidepane mutual-exclusion, medium) and **K3** (empty screenshot before bounds, low) — both documented in this file as Findings, then **both fixed**: A3 via the workspace-sidepane preview-mode refactor, K3 via the `captureScreenshot` guard that throws a "navigate first" error instead of returning an empty image. |

**Result tally (44 rows):** ✅ verified **30** · ⏭️ skipped (unit/probe-covered or env) **11** · ✅ found-then-fixed **3** (A3, S2/K3 edge).

All six tool actions (navigate / screenshot / read_page / click / type / wait_for), the image→vision path, CDP trusted input, per-session isolation, idle-reclaim recovery, the high-impact safety gate, and tool-call labels are **verified working**. The two defects found during the pass (A3 mutual exclusion, K3 empty first-screenshot) have since been **fixed**: A3 with the workspace-sidepane preview-mode refactor, and K3 by replacing the empty PNG with an explicit "navigate first" error (an earlier synthesize-a-viewport attempt was tried and rejected — it could not make a non-compositing fresh view paint).

Checks passed: **30 / 44** verified (✅); 11 skipped as unit/probe-covered; A3 and S2/K3 found during the pass and subsequently fixed. Original 33-numbered scope: 30 confirmed working, plus A3 + K3 fixed.

---

## Appendix A — local test fixture

Save as `fixture.html`, serve with `python3 -m http.server 8000`, and drive the
agent at `localhost:8000/fixture.html`. It exposes every element the click / type /
wait_for / popup checks need (the controlled-input mirror proves a real `input`
event fired).

```html
<!doctype html>
<html>
<head><title>Probe Fixture</title></head>
<body>
  <h1>Hello Probe</h1>
  <p>Some visible body text for read_page.</p>
  <a href="https://example.com/">Example Link</a>
  <a href="https://example.com/" target="_blank">Open external</a>
  <input id="field" />
  <button id="btn" style="width:120px;height:40px">Submit</button>
  <button id="publish" style="width:120px;height:40px">Publish</button>
  <div id="status">idle</div>
  <script>
    // Mirror the input value into a data-attr on every real `input` event,
    // standing in for a React-controlled input (only a trusted event sets it).
    const field = document.getElementById('field');
    field.addEventListener('input', () => field.setAttribute('data-mirror', field.value));
    document.getElementById('btn').addEventListener('click', () => {
      document.getElementById('status').textContent = 'clicked';
    });
    // Delayed element to exercise wait_for.
    setTimeout(() => {
      const t = document.createElement('div');
      t.id = 'toast'; t.textContent = 'success';
      document.body.appendChild(t);
    }, 400);
  </script>
</body>
</html>
```

---

## How this maps to automated coverage

- **`[unit]`** rows are already green in `embeddedBrowserTool.test.ts` (42 tests,
  100% of `embeddedBrowserTool.ts`). Treat a manual mismatch as a P1 regression.
- **`[probe]`** rows have their Electron/CDP mechanic proven by
  `tests/manual/embedded-browser-primitives.e2e.mjs` (8/8). Run
  `node tests/manual/embedded-browser-primitives.e2e.mjs` for a fast re-confirm.
- **`[manual]`** rows are the genuine human-in-the-loop surface: vision injection
  (S1), auto-open (A1–A3), the high-impact gate (G1), idle reclaim (I1), flag-off
  (F1–F2), and the UI labels (U1). These cannot be asserted without a running app.
