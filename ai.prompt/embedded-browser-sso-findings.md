<!-- Last verified: 2026-07-06 -->
# Findings: Microsoft SSO extension cannot work in the embedded browser (removed)

> **TL;DR** — The embedded browser (`src/main/lib/embeddedBrowser/`) briefly bundled the
> **Microsoft Single Sign On** Chrome extension to enable silent work/school-account SSO on
> the sites a user browses. Investigation of the extension's actual source showed its core
> mechanism is **Chrome native messaging**, which **Electron does not support**. The extension
> can be *loaded*, but its SSO flow fails on the first call. The extension and all of its
> wiring were removed; this document records why so nobody re-adds it.

## What was removed

The following were reverted out of PR #764 (`feat(browser): add embedded browser for chat links`):

- `EmbeddedBrowserExtensionInstaller.ts` — downloaded the CRX from the Chrome Web Store, stripped
  the CRX header, unpacked it into `{userData}/embedded-browser/extensions/`, loaded it via
  `session.extensions.loadExtension()`, and served a local `embedded-browser://extensions/`
  management page.
- `EmbeddedBrowserManager` extension hooks — `ensureExtensionsLoaded()`, `listExtensions()`,
  `openExtensionsPage()`, and the `registerEmbeddedBrowserProtocol()` constructor call.
- IPC surface — `listExtensions` / `openExtensionsPage` contract methods, the
  `EmbeddedBrowserExtensionInfo` type, preload whitelist entries, and the manager IPC bindings.
- Renderer — the toolbar extension icon strip in `EmbeddedBrowserPanel.tsx` and the
  `embedded-browser-extension-*` CSS rules.
- `main.ts` — the privileged `embedded-browser` custom scheme registration.
- The `protocol: { handle }` mocks added to the three `startup/ipc/__tests__/index.coverage*.test.ts`.

The **core embedded browser is kept**: per-session `WebContentsView`s, the shared cookie
partition, Chrome user-agent / UA Client Hints spoofing, bounds handshake, navigation state, and
the idle-reclaim lifecycle are all unchanged.

## How the extension actually works (from its real source)

The Web Store CRX (`ppnbnpeolgkicgegkbkbjmhlideopiji`, v1.0.11) was downloaded and unpacked. It is a
Manifest V3 extension whose entire job is to bridge web pages to an OS-level Microsoft identity
broker via native messaging:

```
web page → content.js → chrome.runtime.sendMessage
        → background.js (MV3 service worker)
        → chrome.runtime.sendNativeMessage("com.microsoft.browsercore", request)
        → OS native host (installed by Edge / Company Portal / WAM)
        → returns the SSO ticket, relayed back to the page
```

`manifest.json` essentials:

| Field | Value |
|-------|-------|
| `manifest_version` | `3` |
| `permissions` | `["nativeMessaging"]` |
| `background` | `{ "service_worker": "background.js" }` |
| `action` | toolbar button (`default_icon`, `default_title`) |
| `content_scripts` | `content.js` injected into `https://*/*`, `all_frames`, `document_start` |

`background.js` calls **`chrome.runtime.sendNativeMessage("com.microsoft.browsercore", …)`** for
every request and `chrome.action.onClicked` → `chrome.tabs.create(...)`. **Remove native
messaging and the extension is an empty shell** — there is no fallback path.

## API support check against Electron 41 (this repo: `electron@41.5.2`, Chromium ~138)

| API the extension uses | File | Supported by Electron? |
|------------------------|------|------------------------|
| `chrome.runtime.sendNativeMessage` + `permissions:["nativeMessaging"]` | `background.js` | ❌ **No — fatal.** Native messaging is not implemented. |
| `background.service_worker` (MV3) | `manifest.json` | ⚠️ Not in the documented "Supported Manifest Keys" (only MV2 `background` is listed); loading/persistence not guaranteed. |
| `chrome.action` / `chrome.action.onClicked` | `manifest.json` + `background.js` | ❌ Not listed as supported. |
| `chrome.tabs.create` | `background.js` | ❌ Electron's `tabs` subset is only `sendMessage`/`reload`/`executeScript`/`query`/`update`. |
| `chrome.runtime.onMessage` / `sendMessage` / `lastError` / `getManifest` / `id` | both scripts | ✅ Supported. |
| `content_scripts` (`https://*/*`, `document_start`) | `manifest.json` | ✅ Supported. |

### Why "not supported" is definitive for native messaging

- Electron's extensions doc lists the supported `chrome.runtime` members; `sendNativeMessage` /
  `connectNative` are **not** among them.
- Electron issue **#40380 (`chrome.runtime.connectNative`)** was closed **"Not planned."** Related
  requests (#8692, #7681, #14438) were likewise closed without implementation.
- At runtime the extension's own code funnels the failure into
  `{ status: "Fail", code: "NoSupport", description: chrome.runtime.lastError.message }` — i.e. the
  SSO flow dies at its first step, silently.

Even if native messaging *were* supported, it would additionally require the OS host
`com.microsoft.browsercore` to be installed **and** to whitelist this extension's ID in its
allowed-origins manifest — conditions a typical Electron app does not meet.

## Recommendation if SSO is needed later

Do **not** reach for a Chrome store extension. Implement auth at the Electron `session` layer
instead:

- Share the authenticated cookie partition (`persist:openkosmos-embedded-browser`) so a one-time
  interactive login carries across sessions/tabs (already how the browser shares cookies).
- Use platform auth where appropriate (WAM on Windows or `app.on('login')` for HTTP auth challenges)
  or an application-owned standards-based flow.

## Sources

- Electron — Supported Chrome Extension APIs: https://www.electronjs.org/docs/latest/api/extensions
- electron/electron #40380 — `chrome.runtime.connectNative` (closed, Not planned): https://github.com/electron/electron/issues/40380
