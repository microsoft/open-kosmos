# Embedded Browser PRD

## 1. Background

OpenKosmos users often need to inspect web pages, documentation, dashboards, and local development servers while chatting with an agent. Before this feature, chat links opened in the system browser and agents had no built-in browser surface they could use for page inspection or assisted interaction.

This split the workflow across applications and prevented the user from seeing or supervising an agent's browser context inside OpenKosmos.

## 2. Problem Statement

OpenKosmos needs an in-app browser that can serve two related needs:

1. let users open chat links without leaving the chat workspace
2. let agents inspect and interact with web pages through a controlled, visible, user-supervised tool

The browser must not become an unrestricted filesystem or operating-system protocol surface, and it must remain off by default until the user enables it.

## 3. Product Decision

OpenKosmos will add an embedded browser side panel scoped to the current chat session and controlled by an app-level Settings -> Browser switch.

When enabled, the feature provides:

1. a ChatView header entry for opening the browser panel
2. in-chat http/https link routing into the panel
3. an agent-facing built-in `browser` tool for navigate, screenshot, read, click, type, and wait actions

When disabled, the header entry is hidden, chat links use safe external-link fallback behavior, the built-in tool is hidden from the advertised inventory, and any existing embedded browser views are destroyed.

## 4. Goals

### 4.1 Product Goals

1. Keep web browsing inside the chat workspace when the user opts in.
2. Give agents a browser tool that can inspect and interact with web pages while remaining visible to the user.
3. Scope browser panel state per chat session so different conversations do not overwrite each other's current page.
4. Keep the feature secure-by-default with an explicit off switch and a web-URL allowlist.
5. Preserve normal external-browser behavior when the feature is disabled.

### 4.2 User Goals

1. As a user, I can enable or disable the embedded browser from Settings -> Browser.
2. As a user, I can open a browser panel from the chat header.
3. As a user, clicking an http/https link in chat opens it in the in-app browser when the feature is enabled.
4. As a user, I can watch an agent-driven browser action instead of having it happen invisibly.
5. As a user, disabling the feature immediately removes the browser UI and agent tool.

## 5. Non-Goals

1. Supporting arbitrary URL schemes such as `file:`, `data:`, `javascript:`, or custom OS protocol handlers.
2. Replacing the system browser for application-level OAuth or protocol-specific links.
3. Supporting Chrome Web Store extensions or Microsoft SSO extensions inside Electron.
4. Providing a general-purpose unattended browser automation platform for irreversible authenticated actions.
5. Persisting a separate browser profile per chat session.

## 6. Scope

### 6.1 In Scope

1. Settings -> Browser app-level toggle persisted in app config.
2. Per-session embedded browser side panel.
3. Typed renderer-to-main IPC for browser navigation, bounds, and lifecycle control.
4. Main-process `WebContentsView` ownership and lifecycle management.
5. Chat markdown http/https link routing when enabled.
6. Agent `browser` built-in tool gated by the same setting.
7. Immediate teardown of renderer and main-process browser state when disabled.
8. Documentation and tests for the new behavior.

### 6.2 Out of Scope

1. Automated login or SSO extension support.
2. Non-web local file browsing.
3. A full tab strip or multi-tab browser UI.
4. Cross-device browser state sync.
5. CI promotion of the manual Electron primitives probe.

## 7. Functional Requirements

### 7.1 Must Have

1. The browser setting must default to disabled.
2. When disabled, the ChatView header browser entry must be hidden.
3. When disabled, the built-in `browser` tool must be absent from advertised tool inventories and direct execution must return a disabled-settings error.
4. When disabled, chat markdown links must keep safe external-link attributes instead of routing into the embedded browser.
5. When toggled off, all open renderer browser panels and main-process `WebContentsView` instances must be destroyed.
6. When enabled, the user must be able to open a per-session browser panel from the ChatView header.
7. When enabled, http/https chat links must route into the active session's embedded browser.
8. The agent `browser` tool must support navigate, screenshot, read_page, click, type, and wait_for actions.
9. Main-process navigation entry points must reject non-http/https schemes, except the safe empty page `about:blank`, which is allowed as a blank bootstrap target.
10. Agent-facing browser actions must return structured JSON success or error values instead of throwing out of tool execution.

### 7.2 Should Have

1. Reclaimed browser views should restore the last remembered URL when an agent action resumes after idle cleanup.
2. Agent-driven browser use should reveal the panel so the user can observe it.
3. Browser display labels should summarize each action in the chat transcript.
4. The embedded browser should present a normal desktop Chrome identity based on Electron's Chromium runtime.

## 8. Acceptance Criteria

The feature is accepted when all of the following are true:

1. Settings -> Browser governs the header entry, chat link routing, tool inventory, direct tool execution, renderer panels, and native views consistently.
2. Browser navigation accepts http/https URLs at the renderer, tool, and main-process boundaries; the tool and main-process boundaries additionally allow `about:blank` as a safe blank bootstrap page (the renderer IPC boundary stays http/https-only).
3. Per-session browser state survives panel hide/show and can be reclaimed after idle.
4. Existing chat markdown rendering continues to support normal external links when the feature is disabled.
5. Tests cover setting-gated inventory, execution, link routing, IPC, and embedded-browser lifecycle behavior.
6. Type checking and the Vite build pass.

## 9. Risks

1. Shared browser cookies make authenticated pages convenient but increase the impact of agent-driven clicks.
2. Native `WebContentsView` compositing can cover renderer DOM if bounds or foreground state drift.
3. Manual Electron behavior is harder to fully cover in unit tests than pure TypeScript logic.
4. Future support for additional schemes could accidentally weaken the security boundary.

## 10. Final Product Statement

OpenKosmos will ship an opt-in embedded browser that keeps web exploration inside the chat workspace and gives agents a visible, gated browser tool for web-page interaction. The feature remains disabled by default, uses http/https navigation (plus `about:blank` as a safe blank bootstrap page), and tears down all browser state immediately when the user turns it off.
