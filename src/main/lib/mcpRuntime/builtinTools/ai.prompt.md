<!-- Last verified: 2026-05-22 -->
# Built-in Tools

> Central registry and dispatcher for all 50+ built-in MCP tools, organized into eager (lightweight) and lazy (heavy-dependency) loading tiers.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `builtinToolsManager.ts` | Singleton registry + dispatcher. Registers tool metadata at init; dispatches calls via a large if-else chain. Lazy-imports heavy modules at call time. | ~1.1K LOC |
| `facades/` | Unified facade tools (`manage_mcp`, `search_mcp`, `manage_agents`, `search_agents`, `manage_skills`) that provide AI-friendly flat interfaces; internally delegate to legacy tool modules. | ~1.3K LOC total |
| `types.ts` | Shared interfaces: `BuiltinToolDefinition` (name, description, inputSchema) and `ToolExecutionResult` (success, data, error). | tiny |
| `executeCommandTool.ts` | Shell command execution via `TerminalManager`; supports background mode, interactive auth detection, partial `tool_result` streaming. | large |
| `azureCliExecuteTool.ts` | Unified Azure tool surface. `mode="cli"` executes Azure CLI subcommands through `azureCli`; `mode="ado_work_items"` delegates work item `operation="get"` / `operation="query"` requests to browser-auth REST without Azure CLI login/device-code auth. | small |
| `azureDevOpsWorkItemsTool.ts` | Internal Azure DevOps work item get/WIQL query implementation using browser-auth bearer tokens; invoked by `azure_cli_execute` ADO modes. | small |
| `azureDevOpsWorkItemLinks.ts` | Shared deterministic ADO work item link enrichment for browser-auth results and Azure CLI JSON output. | small |
| `azureToolDefinitions.ts` | Single source for Azure CLI and Azure DevOps tool metadata shared by registration and tool classes. | small |
| `readFileTool.ts` | Stream-based file reading with triple safety limits (128KB / 500 lines / 8KB per line); two-phase probe + targeted scan. | medium |
| `subAgentTool.ts` | `SubAgentTool` — unified sub-agent tool (named + ad-hoc + background). Consumes `BuiltinToolsManager.currentExecutionContext`. | medium |
| `requestInteractiveInputTool.ts` | Validates model-supplied JSON schema; returns normalized `choice`/`form` cards to `AgentChat`. | small |
| `updateAgentTool.ts` | Persists agent config including knowledge sources; mirrors deprecated top-level fields for compat. | medium |
| `bingWebSearchTool.ts` | Bing web search — **lazy**, depends on Playwright. | medium |
| `fetchWebContentTool.ts` | Full-page web fetch — **lazy**, depends on Playwright. | medium |
| `readOfficeFileTool.ts` | DOCX/XLSX/PPTX/PDF reading via mammoth/jszip/pdfreader — **lazy**. IRM-encrypted fallback uses AppleScript/PowerShell. | medium |
| `listTeamsChatsTool.ts` / `readTeamsChatTool.ts` etc. | Microsoft Graph tools (Teams, Outlook, Calendar, SharePoint) — **all lazy**. | small each |
| `toolSearchTool.ts` | `tool_search` meta-tool — lets the LLM discover deferred MCP tools on-demand. Accepts keyword or `select:` queries; scores matches against name, description, serverName, and `searchHint`. Gated by `openkosmosFeatureToolSearch`. | small |
| `createUserTaskTool.ts` / `updateUserTaskTool.ts` / `listUserTasksTool.ts` / `deleteUserTaskTool.ts` | Personal user task CRUD tools — **eager**, **PM Studio only** (gated by `BRAND_NAME === 'pm-studio'`). Delegate to `UserTaskManager` singleton. | small each |

## Architecture

**Registration vs. Execution split:** `initialize()` populates a `Map<string, BuiltinToolDefinition>` with tool *metadata only*. Heavy tools store their `inputSchema` inline at registration time or in a lightweight definition module, but do not import the implementation module. `executeTool()` is where modules are actually imported.

**Two loading tiers:**
- **Eager** (top-level imports): `read_file`, `write_file`, `search_file_contents`, `search_files`, `execute_command`, `get_current_datetime`, `request_interactive_input`, `search_skills`, facade tools (`manage_mcp`, `search_mcp`, `manage_agents`, `search_agents`, `manage_skills`), scheduler tools, user task tools (**PM Studio only**).
- **Lazy** (`await import(...)` inside `executeTool`): `azure_cli_execute`, `bing_web_search`, `bing_image_search`, `fetch_web_content`, `read_office_file`, `download_file`, `manage_process`, all SharePoint tools, all Microsoft Graph tools, sub-agent tools, `manage_remote_channel`.

**Execution context (sub-agent tools):** `AgentChat` calls `BuiltinToolsManager.setExecutionContext()` before `executeTool()` and clears it after. The sub-agent tools `sub_agent`, `get_subagent_status`, `notify_parent`, and `send_to_subagent` all read this context during execution. The static field is safe in Electron's single-threaded event loop.

**`tool_search` session-bound context:** `tool_search` receives its `chatSessionId` as an explicit parameter threaded from `builtinMcpClient.executeTool()` (captured before the `await getToolsManager()` async boundary) through `builtinToolsManager.executeTool()` into `ToolSearchTool.execute()`. This avoids reading the mutable static `currentExecutionContext` after an async gap where a concurrent session could overwrite it. The deferred tools list is stored in a per-session `deferredToolsContextMap` keyed by `chatSessionId`, set/cleared by `agentChatStreamingService`. `getDeferredToolsContext(sessionId)` is fail-closed: returns `null` when `sessionId` is absent (no fallback). Cleanup happens in `agentChatManager` when a session is disposed via `BuiltinToolsManager.clearDeferredToolsContext(chatSessionId)`.

**Feature-flag guards:** Some tools are only registered/executed when a flag is enabled — `move_file` (`browserControl`), `create_schedule` and related (`openkosmosFeatureScheduler`), `manage_remote_channel` (`openkosmosFeatureRemoteChannel`). `sub_agent` is always registered; ad-hoc spawning is available by default, but named sub-agent spawning via `subagent_type` is gated by `openkosmosFeatureSubAgent` at execution time. `get_subagent_status`, `notify_parent`, and `send_to_subagent` are context/role-gated, not feature-flag gated. User task tools (`create_user_task`, `update_user_task`, `list_user_tasks`, `delete_user_task`) are brand-gated: only registered when `BRAND_NAME === 'pm-studio'`. `azure_cli_execute` is always registered; CLI commands are parsed into argv, reject shell operators / the leading `az` prefix, and execute with `shell: false` through `AzureCliManager`.

**Azure CLI install/auth path:** `azure_cli_execute` remains lazy. On first use it asks the Azure CLI manager to detect `az`; if missing, the tool returns Runtime Settings/manual-install guidance and does not launch an installer itself. Explicit installation lives under Runtime Settings via `runtime:install-azure-cli`; clicking Install is the consent, and the manager runs a supported Windows/macOS package-manager installer before rechecking state. Linux auto-install returns manual instructions. If installed but not logged in, the tool starts browser-based `az login` (no `--use-device-code`), waits for completion, and then executes or retries the requested command once.

**Azure DevOps browser-auth path:** `azure_cli_execute` exposes `mode="ado_work_items"` for work item flows that should not require Azure CLI login. Within that mode, `operation="get"` fetches one work item by id and `operation="query"` runs WIQL before fetching returned work item details. These operations delegate to `AzureDevOpsWorkItemsTool`, acquire an Azure DevOps bearer token through `BrowserAuthOrchestrator.acquireAzureDevOpsToken({ signal })`, and call ADO REST APIs directly. The signal must cover both token acquisition and the final ADO fetches so canceled chat turns do not keep the shared browser-auth gate occupied. Each returned work item includes deterministic `webUrl` and `markdownLink` fields.

**ADO link enrichment:** Work item links are generated in the tool layer, not prompt-only. `azure_cli_execute` with `mode="ado_work_items"` adds top-level `webUrl` / `markdownLink` because organization and project are explicit tool args. `azure_cli_execute` CLI mode recursively enriches work item-shaped JSON objects with `_kosmos.webUrl` / `_kosmos.markdownLink` when it can resolve organization/project from the work item REST URL, `_links.html.href`, or an ADO work-item/query command's `--org` + `--project` args. Recursion has depth/node/cycle guards so malformed or unexpectedly large JSON cannot blow the stack. If context cannot be resolved, the original JSON shape is preserved without link fields.

**Return format:** `executeTool()` always returns `ToolExecutionResult`. On success `data` is `JSON.stringify(result)`. Errors are caught and returned as `{ success: false, error: message }` — they do NOT throw.

### Cancellation / AbortSignal Contract

All built-in tools that perform network I/O **must** honor an `AbortSignal`. When the user cancels a chat session, the agent framework terminates the executing tool via `AbortController.abort()`.

**1. Tool handler signature convention:**
```typescript
// Network I/O tools — must accept signal
static async execute(args: MyToolArgs, options?: { signal?: AbortSignal }): Promise<Result>

// Pure local tools (read_file, write_file, etc.) — no signal required
static async execute(args: MyToolArgs): Promise<Result>
```

**2. Signal propagation chain (every layer must pass it through; no gaps):**
```
AgentChatToolExecutor (creates AbortController, listens to CancellationToken)
  → mcpClientManager.executeTool({ signal })
    → BuiltinMcpClient.executeTool({ signal })
      → BuiltinToolsManager.executeTool(name, args, signal)
        → Tool.execute(args, { signal })
          → GraphApiClient.graphGet(..., signal) / fetch(url, { signal })
```

**3. Merging signal with an internal timeout:**
When a method already has an internal timeout `AbortController`, merge it with the external signal:
```typescript
const timeoutController = new AbortController();
const timeoutId = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);
const mergedSignal = signal
  ? AbortSignal.any([signal, timeoutController.signal])
  : timeoutController.signal;
const response = await fetch(url, { signal: mergedSignal });
clearTimeout(timeoutId);
```
In the `AbortError` catch, use `signal?.aborted` to distinguish external cancellation from an internal timeout.

**4. Playwright tools — special handling:**
Playwright does not support `AbortSignal`. Use a signal listener + `page.close()` to implement cancellation:
```typescript
const onAbort = () => page?.close().catch(() => {});
signal?.addEventListener('abort', onAbort, { once: true });
try { /* page operations */ }
finally { signal?.removeEventListener('abort', onAbort); }
```

**5. New tool development checklist:**
- [ ] Does the tool perform network I/O? → Must accept `{ signal?: AbortSignal }`
- [ ] Is the signal passed all the way down to the final `fetch` / HTTP call?
- [ ] Does the `if-else` branch in `builtinToolsManager.executeTool` pass `{ signal }`?
- [ ] For multiple network calls (loops, `Promise.all`), is the signal passed to each call?

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new lightweight tool | New `*Tool.ts`, add eager import + `this.tools.set(...)` in `initialize()`, add `else if` branch in `executeTool()` | Keep the `inputSchema` and args interface in sync — mismatches cause silent runtime errors |
| Add a new heavy/lazy tool | New `*Tool.ts`, add inline metadata block in `initialize()` (heavy section), add `await import(...)` branch in `executeTool()` | See the CRITICAL CHECKLIST comment near line 292 in the manager |
| Gate a tool behind a feature flag | Check flag in both `initialize()` (skip `this.tools.set`) and in `executeTool()` (return disabled error) | Both guards are required — the tool list is used for LLM context |
| Change tool_search filtering or scoring | `toolSearchTool.ts`, `src/main/lib/chat/toolSearchFilter.ts` | `toolSearchFilter` controls which tools are deferred; `toolSearchTool` controls how they're searched. Both have independent test suites |
| Extend `update_agent` with new config fields | `updateAgentTool.ts` | Mirror deprecated top-level fields for compatibility with older readers |
| Add a Microsoft Graph tool | New tool file + lazy branch in `executeTool()` + metadata in the Graph section of `initialize()` | Graph tools are all lazy; requires Graph auth token from `microsoftGraph` module |
| Add or change Azure CLI behavior | `azureCliExecuteTool.ts`, `azureToolDefinitions.ts`, `azureDevOpsWorkItemLinks.ts`, `../../azureCli/`, routing tests | Keep raw commands parsed to args and spawned with `shell: false`. Update Azure tool metadata and tests together. |
| Add or change Azure DevOps work item behavior | `azureDevOpsWorkItemsTool.ts`, `azureDevOpsWorkItemLinks.ts` + `../../microsoftGraph/` token facade + routing tests | Do not fall back to device-code auth; return browser-auth errors directly. |
| Change Teams chat listing behavior for selector/search flows | `listTeamsChatsTool.ts` + relevant tests | Keep `chatTypeFilter: 'all'` aligned with selector-supported chat types only: `group`, `meeting`, `oneOnOne`; search should resolve metadata by hit `chatId` instead of narrowing results through a recent-chat window |

## Co-Change Map
| When you change | Also check/update |
|----------------|-------------------|
| Add/rename a tool | `builtinToolsManager.ts` (both `initialize` and `executeTool`); `mcpRuntime/ai.prompt.md` Built-in Tools by Category table |
| Modify tool `inputSchema` | Matching args interface in the tool's `.ts` file — schema is what the LLM sees, interface is what the code executes |
| Change feature flags controlling tools | `src/main/lib/featureFlags/` flag definitions |
| Change Azure CLI execution/auth | `src/main/lib/azureCli/` and `src/main/lib/mcpRuntime/ai.prompt.md` |
| Change Azure DevOps browser-auth tool or link enrichment | `src/main/lib/microsoftGraph/` token acquisition docs/tests when auth changes; `src/main/lib/mcpRuntime/ai.prompt.md` for runtime-facing behavior |
| Sub-agent tool changes | `src/main/lib/subAgent/` (`SubAgentManager`, `types.ts`) |
| `tool_search` context or filtering | `toolSearchTool.ts`, `builtinToolsManager.ts` (executeTool + deferredToolsContextMap), `src/main/lib/chat/toolSearchFilter.ts`, `agentChatStreamingService.ts` |
| Graph/Teams/Outlook tools | `src/main/lib/microsoftGraph/` |

## Anti-Patterns
- Do NOT add a new tool only in `initialize()` and forget the `else if` branch in `executeTool()` — it will silently throw "Execution not implemented".
- Do NOT import Playwright, mammoth, or other heavy modules at the top of the file — use lazy `await import()` inside the `executeTool` branch.
- Do NOT call `executeTool()` and assume a thrown exception — it always returns `ToolExecutionResult`; check `result.success` instead.
- Do NOT reuse `currentExecutionContext` for new tools that are not sub-agent spawners — it is an intentionally narrow contract.
- Do NOT let `inputSchema` and the tool's TypeScript args interface drift — the LLM sends args matching the schema but the implementation reads them by interface field names.
- Do NOT route `azure_cli_execute` through `execute_command` or shell strings — it must use the `azureCli` manager's parsed args and `spawn(..., { shell: false })` path.
- Do NOT swallow `AbortSignal`. `BuiltinMcpClient.executeTool` passes `signal` through `BuiltinToolsManager` to each tool handler. All network-IO tools **must** propagate it to their final `fetch()` / HTTP calls. Missing signal causes cancel to hang for the full request timeout (30-60s), blocking the user from sending new messages. (See: v2.7.x cancel-blocks-send bug.)

## Verification Steps
1. After adding a tool, run `npm test` — unit tests in `__tests__/` cover registration and execution.
2. Confirm tool appears in `getOpenAIToolDefinitions()` output (check `BuiltinMcpClient.listTools()` via the MCP inspector or a chat session).
3. If feature-flag-gated, test with flag both enabled and disabled.

## Gotchas
- ⚠️ **Schema/interface mismatch is silent.** The CRITICAL CHECKLIST comment at line ~292 of the manager is there for this reason — always verify param names, types, and required fields match between the inline `inputSchema` and the tool's TypeScript interface.
- ⚠️ **Lazy tools have first-call latency.** Playwright-dependent tools import the entire browser automation stack on first call; this can take 1–2 s on a cold start.
- ⚠️ **`list_teams_chats` intentionally excludes unsupported chat types.** Even with `chatTypeFilter: 'all'`, selector/search-oriented consumers should only receive `group`, `meeting`, and `oneOnOne`; do not reintroduce `unknownFutureValue` into user-facing chat pickers.
- ⚠️ **`list_teams_chats` search must not depend on recent chat enumeration breadth.** Preserve Graph search hit breadth by resolving supported metadata per hit `chatId`, and keep `hit.chatDisplay` as the preferred label when it is present.
- ⚠️ **`manage_process` is eager in registration but lazy in execution** (to avoid `ipcMain` side effects in Jest). This is an exception to the normal pattern.
- ⚠️ **`read_file` silently tracks skill invocations.** If a `read_file` call targets a `SKILL.md` inside the user's skills directory, it fires an analytics event. This side effect is intentional but invisible from the tool's public API.
- ⚠️ **`resetInstance()` exists for tests only.** Do not call it in production code — it destroys the singleton and all registered tool metadata.
- ⚠️ **`send_teams_message` requires `browser-teams` auth mode (or `azure-ad-app` for Graph path).** Routes to either `TeamsGraphClient` or `TeamsInternalClient` based on `authMode`. Gated by the `openkosmosFeatureSendTeamsMessage` flag.
- ⚠️ **`send_teams_message` image mode always uses Graph hostedContents.** The `imagePath` parameter forces the request through `TeamsGraphClient.sendMessageWithImage` regardless of `authMode` because chatsvc has no public hostedContents protocol. Browser Auth's Graph token works for this endpoint (Teams Web itself uses it). Hard cap is 4 MB; supported types are PNG/JPG/GIF/WEBP. Caption HTML may include `<img src="../hostedContents/1/$value">` to position the image; if absent the image is appended.
- ⚠️ **`send_outlook_email` blocks external recipients by default.** Recipients outside the signed-in user's UPN domain are rejected unless the agent explicitly passes `allowExternal: true`. The domain is resolved live via `UserGraphClient.getCurrentUser()` — if that call fails the tool refuses to send rather than guessing. Gated by `openkosmosFeatureSendOutlookEmail` (separate flag from Teams writes).
- ⚠️ **`read_teams_channel_messages` uses the Graph beta endpoint.** v1.0 channel-message reads require admin-consented `ChannelMessage.Read.All`; the beta endpoint accepts the user-delegated `.default` scope that Browser Auth produces. If Graph returns 403 the error is surfaced verbatim — investigate token scope rather than swallowing the failure. `list_teams_channels` uses v1.0 (broad permissions). `includeReplies` defaults to **true**: each top-level message with `replyCount > 0` triggers an extra `/messages/{id}/replies` call and replies are inlined under their parent (`isReply=true`, `parentId` set).
- ⚠️ **`read_teams_chat` auto-downloads inline images to a session-associated directory.** When a message contains `<img>` tags, the tool automatically extracts refs, downloads the images (via Graph hostedContents under `azure-ad-app`, or chatsvc absolute-URL fetch under `browser-teams`), and saves them to `{workspace}/{yyyymm}/{chatSessionId}/`. The `src` field in `imageRefs[]` is replaced with a `file://` URL pointing to the local file. This requires `ToolExecutionContext` to be set (it always is during normal tool dispatch). If context is unavailable (e.g. tests), image download is silently skipped.

## Related
- Depended on by: [MCP Runtime](../ai.prompt.md) — `BuiltinMcpClient` wraps this manager under the reserved `builtin` server name
- Depends on: [Terminal Manager](../../terminalManager/) — `execute_command` and `manage_process`
- Depends on: [Security](../../security/) — `SecurityValidator` gates file-path tools
- Depends on: [Sub-Agent](../../subAgent/) — `sub_agent`, `get_subagent_status`, `notify_parent`, `send_to_subagent`
- Depends on: [Microsoft Graph](../../microsoftGraph/) — Teams/Outlook/SharePoint tools
- Depends on: [Skill System](../../skill/ai.prompt.md) — skill management tools
- Depends on: [Feature Flags](../../featureFlags/) — tool registration guards
- Depends on: [Azure CLI](../../azureCli/ai.prompt.md) — `azure_cli_execute` manager and command runner
