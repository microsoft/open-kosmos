<!-- Last verified: 2026-05-18 -->
# MCP Runtime

> Manages MCP server connections and tool execution — routing LLM tool calls to either built-in handlers or external MCP servers via a unified VSCode-compatible client.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `mcpClientManager.ts` | Singleton. Manages client instances, tool-to-server routing, connection lifecycle, and runtime state. | ~1.6K LOC |
| `builtinTools/builtinToolsManager.ts` | Singleton. Central registry and dispatcher for all 37+ built-in tools. Eager + lazy loading. Per-session `deferredToolsContextMap` for tool search. | ~1.1K LOC |
| `builtinMcpClient.ts` | Wraps BuiltinToolsManager as an MCP-compatible client under the reserved server name `builtin`. | — |
| `vscMcpClient.ts` | Thin adapter delegating to `vscodeMcpClient/VscodeMcpClient.ts`. Forwards the original `McpServerConfig` (including any `oauth.*` hints) through to the HTTP transport so the OAuth layer can construct a `OpenKosmosOAuthProvider`. | — |
| `vscodeMcpClient/VscodeMcpClient.ts` | VSCode-compatible MCP client implementation; supports stdio, SSE, and HTTP transports. | ~585 LOC |
| `auth/McpAuthService.ts` | MCP online auth facade using generic OAuth (`OpenKosmosOAuthProvider` + `performOAuthFlow`). All issuers go through this path. | — |
| `auth/McpAuthMetadataService.ts` | Parses `WWW-Authenticate` and discovers OAuth resource/server metadata for online MCP servers. Recognizes 8 common providers (GitHub, GitLab, Slack, Google, Atlassian, Notion, Discord, Microsoft) for friendly labels. | — |
| `auth/OpenKosmosOAuthProvider.ts` | Implements the MCP SDK's `OAuthClientProvider` interface against OpenKosmos's secure token cache. Used for all OAuth flows. | ~280 LOC |
| `auth/CallbackServer.ts` | Local OAuth 2.0 redirect server. **Per-port singleton** (default 33420) — different MCP servers can pin different `oauth.callbackPort` values via their OAuth-app registrations, so we keep one instance per port via an internal `Map<port, CallbackServer>`. Routes by `state` to support concurrent flows on the same port. | ~280 LOC |
| `auth/performOAuthFlow.ts` | Drives the SDK's two-call `auth()` pattern: discovery + DCR + browser redirect, then code → tokens. Surfaces `MCP_DCR_REQUIRES_USER_CLIENT_ID` so the renderer can prompt the user. | — |
| `auth/serverKey.ts` | `name + sha256(transport+url+headers+oauth.clientId+callbackPort).slice(0,16)` keying for OAuth credential slots in `OpenKosmosTokenCache.mcpOAuth`. | — |
| `auth/dcrFallbackInstructions.ts` | Provider help catalog for the DCR-fallback dialog. Priority: plugin author override (`cfg.oauth.setupUrl/setupInstructions`) → built-in catalog → generic guidance. | — |
| `auth/errors.ts` | Shared MCP auth error markers used to distinguish recoverable user-interaction states from generic connection failures. | — |
| `vscodeMcpClient/tools/ToolManager.ts` | Per-connection tool schema cache and call dispatcher inside VscodeMcpClient. | ~773 LOC |
| `mcpClient.ts` | Original SDK-based client — **disabled**, kept for reference only. | — |

## Architecture

```
AgentChat.executeToolCall()
        │
        ▼
MCPClientManager.executeTool(toolName, toolArgs)
        │
        ├─ toolToServerMap lookup
        │
        ├─── serverName == "builtin" ──► BuiltinMcpClient ──► BuiltinToolsManager
        │                                                           │
        │                                                  (eager) lightweight tools
        │                                                  (lazy)  playwright / mammoth / azure-cli / ADO tools
        │
        └─── serverName == external ──► VscMcpClient
                                              │
                                    ┌─────────┼─────────┐
                                  stdio      SSE       HTTP
                               (child proc) (remote) (streamable)
```

**Tool routing:** On server connect, `MCPClientManager` fetches the tool list and populates `toolToServerMap` (`Map<toolName, serverName>`). At call time, it looks up the server, finds the right client instance, and delegates.

**All transports use VscMcpClient.** The original `MCPClient` (MCP SDK) is disabled (`// 🚫 MCPClient (SDK) disabled` at line 1 of `mcpClientManager.ts`). `defaultImplementation` is hardcoded to `'vscodeMcpClient'`.

**Online auth retry:** HTTP/SSE transports include a first-phase OAuth bridge for protected online MCP servers. On `401/403`, the transport parses `WWW-Authenticate`, discovers OAuth metadata via `McpAuthMetadataService`, and asks `McpAuthService.getTokenForServer` for a Bearer token before retrying. The auth service routes by issuer:

- **Microsoft authorities** (`login.microsoftonline.com` et al.) flow through the existing MSAL path: prefers any `VSCODE_CLIENT_ID:` scope hint, falls back to a built-in Microsoft public client, never reuses `microsoft.graphClientId`. Interactive sign-in goes through the external browser loopback flow. Short-lived in-memory token cache and concurrent-acquisition de-duplication per `(clientId, authority, scopes)` tuple to avoid repeated consent dialogs.

- **All other issuers** (GitHub, Atlassian, Slack, Google, …) flow through `OpenKosmosOAuthProvider`, which implements the MCP SDK's `OAuthClientProvider` against `OpenKosmosTokenCache.mcpOAuth`. The flow uses standard PKCE Authorization-Code grant, supports Dynamic Client Registration (RFC 7591), and persists tokens encrypted in the same profile-scoped cache used by Microsoft Graph. A local HTTP server (`CallbackServer`) listens on a per-server port (default `33420`, configurable via `cfg.oauth.callbackPort`); each port gets its own `CallbackServer` instance so two MCP servers with different OAuth-app redirect URIs can authenticate without restart. Token refresh and proactive 5-minute refresh-window detection are handled inside the provider so the SDK's `auth()` machinery does the right thing automatically. **Concurrent calls for the same server are deduplicated** by `getMcpOAuthServerKey` in `McpAuthService.genericTokenRequests` (mirrors the MSAL path) so two parallel transports never pop two consent dialogs or open two browser tabs. **Proactive refresh actually fires**: when the cached `expires_in <= 300s` and a refresh token exists, `getTokenForGenericOAuth` drives `performOAuthFlow` inline (no consent prompt — user already authorized) so the SDK switches to refresh-token grant before the next request fails. Token-response handling: when `expires_in` is missing AND no `refresh_token` is issued (typical of GitHub OAuth Apps which mint non-expiring tokens), the persisted `expiresAt` is set to a ~100-year sentinel so a perfectly valid token is not silently dropped after 1 hour, forcing a pointless interactive re-auth on every restart. When `expires_in` is missing but a refresh token exists, a conservative 1-hour fallback applies. Force-refresh (after the server returns 401 with a previously-cached token) goes through `OpenKosmosOAuthProvider.markAccessTokenExpired()`, which zeroes `expiresAt` while preserving the access + refresh tokens so the SDK's `auth()` switches to refresh-token grant; it explicitly does NOT use `invalidateCredentials('tokens')`, which would also wipe the refresh token (per the SDK contract for that scope).

Renderer-side prompts (`requestConsent`, `requestClientIdFromUser`) are bounded by `MCP_AUTH_PROMPT_TIMEOUT_MS` (5 min, matching `CallbackServer.waitForCode`) and honor the caller's `AbortSignal` — without these the promise can hang forever if the renderer crashes, the user closes the window, or the upstream auth flow is cancelled. Timeout/abort resolves as `cancel`/`{ cancelled: true }` and propagates through the standard `MCP_AUTH_CANCELLED` path.

When an authorization server does not support DCR and the user has not pre-configured `oauth.clientId` in `.mcp.json`, `performOAuthFlow` throws `MCP_DCR_REQUIRES_USER_CLIENT_ID`. The auth service catches this, sends `mcpAuth:requestClientId` to the renderer, and the user is shown a dialog (`RequestOAuthClientIdDialog.tsx`) with provider-specific guidance (8 built-in catalog entries; plugin authors can override via `cfg.oauth.setupUrl/setupInstructions`). The supplied `clientId` (and optional secret) are persisted via the provider's `saveClientInformation` and the flow retries once.

**OAuth credential storage:** `OpenKosmosTokenCache.mcpOAuth` (extension to the existing browser-auth cache) keys entries by `getMcpOAuthServerKey(name, cfg)` — a stable hash of name + transport + url + headers + oauth.clientId + callbackPort. Renaming a server, changing its URL, or adjusting auth-relevant headers automatically invalidates the slot. Token entries store accessToken/refreshToken/expiresAt/scope plus the (optional) clientId/clientSecret so DCR-issued credentials survive across sessions. Cache file is profile-scoped under `{profile}/credentials/browserAuthTokenCache(.enc)` — switching profiles yields a clean cache. Deleting an MCP server (or uninstalling a plugin that injected one) calls `McpAuthService.clearOAuthForServer(name, cfg, 'all')` from `mcpClientManager.delete()`, which wipes the entire slot (tokens + DCR client info) so re-adding the same server later starts a clean OAuth flow rather than reusing stale credentials. Mirrors Claude Code's `mcp remove` handler (`clearServerTokensFromLocalStorage` + `clearMcpClientConfig`).

**Runtime state** (`MCPServerRuntimeState`: status, tools, lastError) is managed in-memory by MCPClientManager and pushed to the renderer via IPC on every change. It is never persisted to disk. During MCP consent dispatch, the server temporarily enters `needs-user-interaction` so the renderer can show a sign-in-needed state while the consent dialog is open. If the user dismisses that dialog, the subsequent auth cancellation maps to `error` so the server does not remain stuck in a pending sign-in state.

**Execution context injection:** Before dispatching a built-in tool call, `AgentChat` calls `BuiltinToolsManager.setExecutionContext()` (cleared after). This is only consumed by sub-agent spawn tools; all other tools ignore it.

**Live command output:** `execute_command` can emit partial `tool_result` chunks while the process is still running. The final `tool_result` still represents command completion, but intermediate chunks can surface prompts such as device-login codes and URLs before the command exits.

**Interactive auth timeout:** `gh auth login`, `gh auth refresh`, `az login`, `npm login`, `npm adduser`, `pnpm login`, and `yarn npm login` are treated as interactive auth commands and get a 15-minute timeout floor. If the model omits `timeoutSeconds`, they use 15 minutes by default; if it supplies a shorter timeout, it is raised to 15 minutes so browser/device login is not cut off by the ordinary 60-second command default.

**Interactive auth hints:** `execute_command` attaches structured auth metadata to partial/final tool results whenever one of the known interactive auth commands is running. The renderer uses that metadata to show a timeline-native auth card with verification link, copyable device code, a cancel action, and a live timeout countdown while still keeping raw terminal output visible below.

**Interactive auth interruption handling:** If an interactive auth command is canceled by the user or times out, `execute_command` sanitizes the terminal tool result before completion. Final results replace the stale device code / verification URL with a short restart-required message so ended auth sessions do not keep exposing expired credentials in the timeline.

**Agent knowledge persistence through built-in tools:** `update_agent` persists `agent_config.knowledge.knowledgeBase` as the renderer/main-process source of truth for profile-level knowledge settings. Teams/Outlook briefing sources are no longer part of the persisted agent knowledge contract and must not be written through `update_agent`.

## Built-in Tools by Category
| Category | Tools |
|----------|-------|
| Web Search | Bing web search, Bing image search |
| Web Fetch | Fetch web content, read HTML, Playwright browser automation |
| File Operations | Read file, write file, create file, append to file, move file, download & save |
| File Search | Search files (by name), search text in files (ripgrep) |
| Office / Docs | Read Office files (docx, xlsx, pptx, pdf via mammoth/jszip/pdfreader); IRM-encrypted files use native Office extraction (AppleScript on macOS, PowerShell COM on Windows). Shared XML parsing in `OfficeXmlParsers.ts`. |
| Command Execution | Execute shell commands via TerminalManager |
| Azure / Azure DevOps | `azure_cli_execute` supports `mode="cli"` for safe Azure CLI subcommands through a shell-free runner, returns Runtime Settings guidance when Azure CLI is missing, supports Runtime Settings-triggered Windows/macOS Azure CLI installation, and uses browser-based `az login` when auth is needed; the same tool supports `mode="ado_work_items"` with `operation="get"` / `operation="query"` for browser-auth REST work item flows without Azure CLI login; returns deterministic ADO work item web links when organization/project can be resolved |
| MCP Management | `manage_mcp` (create/update/remove/connect/disconnect/reconnect/status), `search_mcp` (library search + installed listing) |
| Skill Management | `search_skills` (4-source parallel search), `manage_skills` (install/uninstall/bind/unbind) |
| Agent Management | `manage_agents` (create/update/remove/list/set_primary/status), `search_agents` (library search) |
| Sub-Agent | Spawn single sub-agent, spawn multiple sub-agents in parallel |
| Utilities | Get current date/time, present deliverables |
| Interactive Requests | Request interactive input via validated JSON schema |
| Schedule | Create, get, edit, run schedule |
| User Tasks | Create, update, list, delete personal user tasks (**PM Studio only**) |
| Tool Discovery | `tool_search` — deferred tool loading meta-tool; LLM discovers MCP tools on-demand (see `ai.prompt/tool-search-design.md`) |

> Playwright-dependent tools (web search, fetch, office), SharePoint tools, and `azure_cli_execute` are **lazy-loaded** — dynamically imported only when first executed, to reduce startup time.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new built-in tool | New `*Tool.ts` in `builtinTools/`, register in `builtinToolsManager.ts` | Add to eager or lazy section based on dependencies |
| Extend `update_agent` with new persisted config | `builtinTools/updateAgentTool.ts`, corresponding tests, and any affected profile docs | Keep `chat.agent.knowledge` as source of truth; mirror deprecated top-level fields only for compatibility |
| Add a new MCP transport type | `vscodeMcpClient/transport/`, update `VscodeMcpClient.ts` | All transports must implement `IUnifiedMcpClient` |
| Extend online MCP auth support | `auth/`, `vscodeMcpClient/transport/VscodeHttpTransport.ts`, `main.ts`, `preload.ts`, renderer auth dialog | All issuers go through the generic OAuth path |
| Change tool routing logic | `mcpClientManager.ts` (`executeTool`, `toolToServerMap`) | Mind concurrent connection locks (`operationLocks`) |
| Expose MCP server status to UI | `mcpClientManager.ts` IPC notification call | Runtime state shape defined by `MCPServerRuntimeState` |
| Import MCP configs from VSCode | `mcpClientManager.ts` VSCode import helper | Configs forwarded to ProfileCacheManager for persistence |

## Gotchas

- **SDK client is permanently disabled.** Do not re-enable `mcpClient.ts` (MCPClient/SDK approach) without understanding why it was disabled — HTTP transport had a memory leak, and the VSCode client is now the sole implementation.
- **`builtin` is a reserved server name.** `BuiltinMcpClient` registers under the constant `BUILTIN_SERVER_NAME = 'builtin'`. Never use this name for a user-configured MCP server.
- **Tool name collisions.** `toolToServerMap` is a flat `Map<toolName, serverName>`. If two servers expose identically named tools, the second connection silently overwrites the mapping. Ensure external server tool names do not clash with built-in tool names.
- **Lazy-loaded tools have first-call latency.** Built-in tools with heavy dependencies (Playwright, mammoth) are only imported on first use. The first call after app start will be slower.
- **Execution context is not thread-safe across sub-agents.** The static `BuiltinToolsManager.currentExecutionContext` is safe only within Electron's single-threaded event loop. Sub-agents run sequentially per loop tick; parallel sub-agent spawning is coordinated by `SubAgentManager`, not here.
- **`tool_result` is not always terminal.** Some built-in tools, notably `execute_command`, may emit in-progress `tool_result` chunks with `isPartial`; downstream consumers must not treat every tool-result chunk as a completed execution.
- **`request_interactive_input` does not render arbitrary UI.** It only validates model-supplied JSON schema and hands it back to `AgentChat` for conversion into existing `choice` / `form` cards. Supported form controls include `time`, which renders a native `HH:MM` picker in the renderer for schedule-style run-time input.
- **The tool now tolerates common LLM near-misses.** Form fields may arrive as `id`, `fieldName`, or `name` instead of `key`; choice payloads may omit `mode`, which defaults to `single`; choice payloads may put the prompt text in `schema.question`, which is lifted into the request description; select options may arrive as `string[]`; and option objects may omit either `label` or `value`. These variants are normalized before strict validation so real chat turns do not fail on trivial shape mismatches.
- **Runtime state is memory-only.** `MCPServerRuntimeState` is never written to `profile.json`. On app restart all servers are in `disconnected` state regardless of prior sessions.
- **Online MCP auth is only partially generalized.** The current bridge is metadata-driven for challenge parsing, but token acquisition currently only supports Microsoft-backed authorization servers. Non-Microsoft OAuth servers still fall back to ordinary transport failure until provider support is added.
- **Graph and MCP client IDs are intentionally separate.** `microsoft.graphClientId` remains reserved for Graph-backed Microsoft 365 features. Protected MCP servers may supply an internal `VSCODE_CLIENT_ID:` scope hint or fall back to the built-in Microsoft public client; the runtime never falls back to the Graph client ID because that caused cross-resource admin-consent mismatches.
- **The external browser success page is now the primary path.** Interactive MCP sign-in should always open the external browser loopback flow rather than relying on native broker UX.

## Related

- Depends on [Terminal Manager](../terminalManager/) — stdio MCP servers are spawned as managed terminal processes
- Depends on [Security](../security/) — `SecurityValidator` gates file-path tool calls to workspace boundaries
- Depended on by [Chat Engine](../chat/ai.prompt.md) — `AgentChat` calls `MCPClientManager.executeTool()` and `getTools()` for LLM context
