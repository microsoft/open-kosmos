# Tool Search: Deferred Tool Loading Design

## Problem

When Agency CLI and many MCP servers are connected, every LLM request includes all tool definitions. With 30–50+ tools this leads to:
- Token overhead from tool schemas in every request
- Degraded model tool-selection quality (too many choices)
- Risk of hitting the 128-tool API limit

## Solution

Replicate Claude Code's **Tool Search** pattern: external MCP tools are **deferred by default** — not sent to the LLM. A `tool_search` meta-tool lets the model discover tools on-demand. Discovered tools are included in subsequent turns.

## Architecture

### Request Flow

```
User message
    ↓
callWithToolsStreaming()
    ↓
getCurrentAvailableTools() → ALL tools (builtin + MCP)
    ↓
shouldEnableToolSearch(allTools, maxContextLength)
  - feature flag ON?
  - tool_search in tool list?
  - external tool tokens > 10% of context window?
  - No external MCP tools → disabled, all tools sent as before
    ↓
filterToolsForRequest(allTools, messageHistory)
  - Inline:   builtin tools (serverName === 'builtin-tools') + tool_search
  - Deferred: all external MCP tools (unless alwaysLoad === true)
  - Discovered: deferred tools found in previous tool_search results
  → filteredTools = inline + discovered
  → deferredTools = all deferred (for tool_search to search against)
    ↓
setDeferredToolsContext(chatSessionId, deferredTools)
  → stored in BuiltinToolsManager.deferredToolsContextMap
    ↓
Inject <available-deferred-tools> index into messages
  (one tool name per line, no descriptions)
    ↓
convertMcpToolsToOpenAiFormat(filteredTools) → API request
    ↓
LLM sees: builtin tools + tool_search + index of deferred tools
    ↓
LLM calls tool_search → ToolSearchTool returns matched schemas as JSON
    ↓
Next turn: extractDiscoveredToolNames(messages) recovers tool names
  → those tools now included inline in filteredTools
    ↓
LLM can call the discovered tools directly
```

### Tool Filtering Detail

```
getCurrentAvailableTools() for Agent A (ADO + Slack + Kusto)
    │
    ▼
┌──────────────────┬──────────────────────────────┐
│   Inline (sent)  │   Deferred (NOT sent)        │
├──────────────────┼──────────────────────────────┤
│ read_file        │ ado_query                    │
│ write_file       │ ado_create_work_item         │
│ execute_command  │ slack_send_message            │
│ tool_search      │ slack_list_channels           │
│ ...builtin       │ kusto_query                  │
│ + discovered*    │ (alwaysLoad → stays inline)  │
└──────────────────┴──────────────────────────────┘
  * = tools found by tool_search in earlier turns
```

### Discovery Round-Trip

```
┌───────────────────────────────────────────────────────────┐
│ LLM                                                       │
│                                                           │
│ Sees: tool_search + <available-deferred-tools> list      │
│ Wants to query ADO                                        │
│ → calls tool_search({ query: "ado work item" })          │
└───────────────────────┬───────────────────────────────────┘
                        ▼
┌───────────────────────────────────────────────────────────┐
│ ToolSearchTool.execute()                                  │
│                                                           │
│ 1. sessionId ← executionContext.chatSessionId            │
│ 2. deferredTools ← getDeferredToolsContext(sessionId)    │
│ 3. Match query:                                           │
│    ┌───────────────────┬────────────────────────────┐    │
│    │ "select:a,b"      │ Exact name match           │    │
│    │ "ado_query"       │ Fast path: exact name      │    │
│    │ "ado work item"   │ Keyword scored search      │    │
│    │ "+ado query"      │ Require server prefix      │    │
│    └───────────────────┴────────────────────────────┘    │
│ 4. Return full schemas as JSON                            │
│    { matches: [{ name, description, inputSchema }] }     │
└───────────────────────┬───────────────────────────────────┘
                        ▼
┌───────────────────────────────────────────────────────────┐
│ Next Turn                                                 │
│                                                           │
│ extractDiscoveredToolNames(messages)                      │
│   → scans tool_search results in history                 │
│   → returns Set { "ado_query", "ado_create_work_item" }  │
│                                                           │
│ filterToolsForRequest includes discovered tools inline   │
│ → LLM can now call ado_query directly                    │
└───────────────────────────────────────────────────────────┘
```

### Context Compaction Protection

```
Before compress:
  extractDiscoveredToolNames() → { "ado_query", "slack_send" }

After compress (injected into summary message):
  <discovered-tools>ado_query,slack_send</discovered-tools>

Next turn: extractDiscoveredToolNames reads BOTH sources:
  1. tool_search result messages (if still in history)
  2. <discovered-tools> tags (survives compaction)
  → discovered tools are never lost
```

### Per-Session Isolation

```
BuiltinToolsManager.deferredToolsContextMap:
  ┌────────────────┬──────────────────────────────┐
  │ chatSessionId  │ McpTool[]                    │
  ├────────────────┼──────────────────────────────┤
  │ session-abc    │ [ado_query, slack_send, ...]  │  ← Agent A
  │ session-xyz    │ [github_pr, github_issue]     │  ← Agent B
  └────────────────┴──────────────────────────────┘

Lifecycle:
  SET   → agentChatStreamingService, each turn start
  READ  → ToolSearchTool.execute (via executionContext.chatSessionId)
  CLEAR → agentChatManager.disposeManagedInstance()
```

## Key Files

| File | Role |
|------|------|
| `src/main/lib/chat/toolSearchFilter.ts` | Core filtering logic: `isDeferredTool`, `filterToolsForRequest`, `extractDiscoveredToolNames`, `shouldEnableToolSearch`, `buildDiscoveredToolsTag` |
| `src/main/lib/mcpRuntime/builtinTools/toolSearchTool.ts` | ToolSearchTool definition and execution: `select:` exact match + keyword search with scoring |
| `src/main/lib/chat/agentChatStreamingService.ts` | Integration point: filters tools before API call, injects deferred index, sets deferred tools context |
| `src/main/lib/mcpRuntime/builtinTools/builtinToolsManager.ts` | Registers `tool_search`, manages per-session `deferredToolsContextMap` for ToolSearchTool execution |
| `src/main/lib/chat/agentChatContextService.ts` | Token estimation with tool search awareness; context compaction protection via `<discovered-tools>` tag |
| `src/main/lib/chat/agentChatManager.ts` | Clears `deferredToolsContextMap` entry on session disposal |
| `src/main/lib/featureFlags/types.ts` | `openkosmosFeatureToolSearch` flag (dev-only default) |

## MCP Metadata Support

Aligned with Claude Code's conventions for MCP tool metadata:

| MCP `_meta` key | Mapped to | Effect |
|-----------------|-----------|--------|
| `anthropic/alwaysLoad` | `tool.alwaysLoad: boolean` | Tool is never deferred — always sent inline |
| `anthropic/searchHint` | `tool.searchHint: string` | Extra keywords for tool_search matching |

These are **MCP protocol extensions** (not Anthropic-model-specific). The `anthropic/` prefix is a namespace indicating who defined the key. Any MCP server can set them; any MCP client should read them.

Parsed at the MCP client layer (`vscMcpClient.ts` via `mapMcpTool` helper) and stored as flat fields — raw `_meta` is not forwarded.

## Context Compaction Protection

When context is compressed, tool_search result messages get discarded. Without protection, previously discovered tools would be lost.

**Mechanism:**
1. Before compression: `extractDiscoveredToolNames()` extracts all discovered tool names from message history
2. After compression: embed `<discovered-tools>tool1,tool2</discovered-tools>` into the summary message
3. On subsequent turns: `extractDiscoveredToolNames()` scans both tool_search results AND `<discovered-tools>` tags

## ToolSearchTool Query Forms

| Query | Behavior | Example |
|-------|----------|---------|
| `select:name1,name2` | Exact name match (comma-separated) | `select:ado_query,ado_create_work_item` |
| Exact tool name | Fast path: if query matches a tool name (case-insensitive), return immediately | `ListCalendarView` |
| `keywords` | Fuzzy search by name/description/serverName/searchHint | `github issue query` |
| `+prefix keywords` | Require server name match, rank by remaining terms | `+ado query` |

Scoring: name exact match (10) > name contains (5) > server contains (3) > description/searchHint contains (2) > all-terms bonus (5).

When no matches found and MCP servers are still connecting, `pending_mcp_servers` is included in the result.

## Comparison with Claude Code

### Identical

| Aspect | Detail |
|--------|--------|
| Core pattern | MCP tools deferred by default, discovered on-demand via meta-tool |
| `isDeferredTool` logic | builtin → inline, MCP → deferred, `alwaysLoad` opt-out |
| `extractDiscoveredToolNames` | Scan message history for previously discovered tools |
| `<available-deferred-tools>` format | Name-only, one tool per line (no descriptions) |
| Prompt cache stability | Sort builtin first (stable prefix), then MCP tools |
| Auto-enable threshold | Token-based: deferred tool tokens > 10% of context window |
| `alwaysLoad` / `searchHint` | Same `_meta` keys, same semantics |
| Compaction protection | Preserve discovered tools across context compression |
| tool_search prompt | Aligned description and query form documentation |
| Exact name fast path | Query matching a tool name returns immediately |
| Pending MCP servers hint | No-match results include connecting server names |
| Token estimation | Accounts for filtered tools + deferred index text (not full schemas) |

### Different (API limitation)

| Aspect | Claude Code | OpenKosmos | Impact |
|--------|------------|--------|--------|
| `defer_loading: true` | Anthropic API native — deferred tools sent as name-only stubs | Tools fully filtered out of request | Equivalent token savings; we just remove rather than stub |
| `tool_reference` blocks | ToolSearchTool returns `{ type: 'tool_reference', tool_name }`, API auto-expands schema | Returns JSON text with full schema; `extractDiscoveredToolNames` parses from message history | Equivalent behavior; we parse ourselves instead of relying on API |
| Beta header | Sends `advanced-tool-use-2025-11-20` | Not needed | No impact |

These are Anthropic API features unavailable through the OpenAI-compatible GitHub Copilot API. Our application-layer approach achieves the same end result.

### Different (not yet implemented)

| Aspect | Claude Code | OpenKosmos | Priority |
|--------|------------|--------|----------|
| Deferred Tools Delta | Tracks tool list changes, notifies model of diff only | Resends full `<available-deferred-tools>` each turn | Low — optimization for frequent MCP server connect/disconnect |
| Multi-mode switch | `tst` / `tst-auto` / `standard` via env var | Feature flag on/off + `shouldEnableToolSearch()` auto | Low — our approach is sufficient |
| Agent-type tool filtering | Coordinator mode (4 tools), async agent allowlist | Sub-agent filtering exists but not integrated with tool search | Low — revisit when sub-agent usage grows |
