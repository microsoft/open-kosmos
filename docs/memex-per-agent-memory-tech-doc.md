# Per-Agent Memex Memory Technical Design

> Version: 1.0.0 | Date: 2026-04-10

## 1. Overview

This feature gives each Kosmos agent its own persistent [Zettelkasten](https://en.wikipedia.org/wiki/Zettelkasten)-style memory powered by the `@touchskyer/memex` CLI (v0.1.27). Memory is implemented as **hidden, system-managed MCP servers** — one per agent — that are transparent to the user yet accessible to the agent during conversation via standard MCP tool calls.

Design goals:

1. **Per-agent isolation** — agent A cannot read or write agent B's memory
2. **Transparent lifecycle** — memex servers are created/destroyed automatically as agents are created/deleted
3. **User-invisible plumbing** — memex servers are hidden from MCP settings, agent editor, and sub-agent selector
4. **Feature-flagged rollout** — gated behind `kosmosFeatureMemexMemory` (dev-only by default)

## 2. Architecture

### 2.1 High-Level Flow

```
User toggles "Enable Memex Memory" in Settings
  → MemexManager.enable()
    → ensureMemexInstalled()          (check CLI, install via npm if missing)
    → for each agent chat:
        → create hidden McpServerConfig  (memex-{chatId})
        → bind to agent's mcp_servers
        → mcpManager.connect()         (stdio → memex mcp)

Agent sends a message
  → agentChatToolExecutor.executeToolCall()
    → mcpClientManager.executeTool({ agentMcpServerNames })
      → agent-scoped server lookup (prefer agent's own memex server)
      → fallback to global toolToServerMap (only for non-agent-bound servers like built-in tools)
      → execute tool on correct memex server (MEMEX_HOME = per-agent dir)
```

### 2.2 Component Map

| Layer | File(s) | Responsibility |
|-------|---------|---------------|
| **Main — Manager** | [src/main/lib/memex/MemexManager.ts](../src/main/lib/memex/MemexManager.ts) | Core lifecycle: enable, disable, getStatus, onAgentCreated, onAgentDeleted |
| **Main — IPC Bridge** | [src/main/lib/memex/memexIPC.ts](../src/main/lib/memex/memexIPC.ts) | Creates MemexManager, registers IPC handlers, keeps index.ts thin |
| **Main — IPC Registration** | [src/main/startup/ipc/index.ts](../src/main/startup/ipc/index.ts) | Calls `setupMemex(ctx, getProfileCacheManager)` at startup |
| **Main — Agent Hooks** | [src/main/startup/ipc/profile.ts](../src/main/startup/ipc/profile.ts) | Fire-and-forget `onAgentCreated` / `onAgentDeleted` calls |
| **Main — Context** | [src/main/startup/ipc/shared.ts](../src/main/startup/ipc/shared.ts) | `_memexManager?: MemexManager` on Context interface |
| **Main — Tool Routing** | [src/main/lib/mcpRuntime/mcpClientManager.ts](../src/main/lib/mcpRuntime/mcpClientManager.ts) | Agent-scoped `executeTool()` with safe fallback |
| **Main — Tool Executor** | [src/main/lib/chat/agentChatToolExecutor.ts](../src/main/lib/chat/agentChatToolExecutor.ts) | Passes `agentMcpServerNames` from agent config |
| **Main — Agent Chat** | [src/main/lib/chat/agentChat.ts](../src/main/lib/chat/agentChat.ts) | Provides `getAgentMcpServerNames()` dependency |
| **Main — Sub-Agent** | [src/main/lib/subAgent/subAgentChat.ts](../src/main/lib/subAgent/subAgentChat.ts) | Passes resolved MCP server names for sub-agent routing |
| **Main — Profile Type** | [src/main/lib/userDataADO/types/profile.ts](../src/main/lib/userDataADO/types/profile.ts) | `hidden?: boolean` on `McpServerConfig` |
| **Main — Profile Sanitizer** | [src/main/lib/userDataADO/profileSanitizer.ts](../src/main/lib/userDataADO/profileSanitizer.ts) | Preserves `hidden` field during profile write |
| **Main — Feature Flag** | [src/main/lib/featureFlags/featureFlagDefinitions.ts](../src/main/lib/featureFlags/featureFlagDefinitions.ts), [types.ts](../src/main/lib/featureFlags/types.ts) | `kosmosFeatureMemexMemory` definition |
| **Main — Preload** | [src/preload/main.ts](../src/preload/main.ts) | Always exposes `electronAPI.memex`; renderer visibility is gated elsewhere |
| **Preload — Bridge** | [src/preload/memex/api.ts](../src/preload/memex/api.ts) | Builds the stable preload bridge (`invoke` + `onPhaseChange`) |
| **Preload — Invoke** | [src/preload/memex/invoke.ts](../src/preload/memex/invoke.ts) | Type-safe preload invoke registration |
| **Shared — IPC Types** | [src/shared/ipc/memex.ts](../src/shared/ipc/memex.ts) | `MemexResult<T>` type, `RenderToMain` channel definition |
| **Renderer — API** | [src/renderer/ipc/memex.ts](../src/renderer/ipc/memex.ts) | `memexApi` bound to the stable preload bridge |
| **Renderer — Settings UI** | [src/renderer/components/settings/MemexView.tsx](../src/renderer/components/settings/MemexView.tsx) | Toggle switch with phase-aware progress bar |
| **Renderer — Navigation** | [src/renderer/components/settings/SettingsNavigation.tsx](../src/renderer/components/settings/SettingsNavigation.tsx) | Feature-flagged nav item |
| **Renderer — Routes** | [src/renderer/routes/AppRoutes.tsx](../src/renderer/routes/AppRoutes.tsx) | Feature-flagged `/settings/memex` route |
| **Renderer — Hidden Filter** | [AgentMcpServersTab.tsx](../src/renderer/components/chat/agent-editor/AgentMcpServersTab.tsx), [McpServerListView.tsx](../src/renderer/components/mcp/McpServerListView.tsx), [SubAgentForm.tsx](../src/renderer/components/subAgents/SubAgentForm.tsx), [SubAgentsView.tsx](../src/renderer/components/subAgents/SubAgentsView.tsx) | `.filter(s => !s.hidden)` on all user-facing server lists |
| **Renderer — Cache** | [src/renderer/lib/mcp/mcpClientCacheManager.ts](../src/renderer/lib/mcp/mcpClientCacheManager.ts), [src/renderer/lib/userData/types/index.ts](../src/renderer/lib/userData/types/index.ts) | `hidden` field plumbed through MCPServerExtended |

## 3. Data Model

### 3.1 McpServerConfig (profile.ts)

```typescript
export interface McpServerConfig {
  name: string;                   // "memex-{chatId}"
  transport: 'stdio' | ...;      // always 'stdio' for memex
  command: string;                // 'memex'
  args: string[];                 // ['mcp']
  env: Record<string, string>;   // { MEMEX_HOME: '<userData>/profiles/<alias>/memex_memory/<chatId>' }
  url: string;                   // '' (unused for stdio)
  in_use: boolean;               // true
  hidden?: boolean;              // true — hides from all user-facing UI
  source?: 'ON-DEVICE';          // always ON-DEVICE
}
```

### 3.2 Memory Storage Layout

```
<userData>/profiles/<alias>/memex_memory/
  ├── <chatId_1>/              ← Agent 1's MEMEX_HOME
  │   └── (memex internal files)
  ├── <chatId_2>/              ← Agent 2's MEMEX_HOME
  └── ...
```

Each agent's memory is fully isolated at the filesystem level via separate `MEMEX_HOME` directories.

### 3.3 IPC Channels

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `memex:enable` | Renderer → Main | (none) | `MemexResult` |
| `memex:disable` | Renderer → Main | (none) | `MemexResult` |
| `memex:getStatus` | Renderer → Main | (none) | `MemexResult<{ enabled: boolean }>` |
| `memex:phaseChange` | Main → Renderer | `phase: string` | (event, no response) |

Phase values: `installing`, `configuring`, `completed`, `error`, `idle`

## 4. Tool Routing — Agent Scoping

### 4.1 Problem

All memex servers expose identical tool names (e.g., `memex_recall`, `memex_retro`). Without scoping, the global `toolToServerMap` (tool name → server name, one-to-one) would route all agents' memex calls to whichever server was last registered.

### 4.2 Solution

`executeTool()` in `mcpClientManager.ts` accepts an optional `agentMcpServerNames` parameter:

1. **Agent-scoped lookup** — iterate the agent's bound servers, find one that currently exposes the requested tool
2. **Guarded fallback** — if scoped lookup misses, check whether the global `toolToServerMap` target is also in the agent's binding list:
   - **Yes** → skip fallback (the agent's own server is likely disconnected; routing to another agent's server would break isolation)
   - **No** → allow fallback (the tool belongs to a non-agent server like built-in tools)

This ensures:
- Built-in tools (`read_file`, `fetch_web_content`, etc.) always work via global fallback
- Memex tools are never cross-routed between agents

### 4.3 Callers

| Caller | File | How `agentMcpServerNames` is provided |
|--------|------|--------------------------------------|
| AgentChat | [agentChatToolExecutor.ts](../src/main/lib/chat/agentChatToolExecutor.ts) | `this.deps.getAgentMcpServerNames()` → reads from `agentChat.getLatestAgentConfig().mcp_servers` |
| SubAgentChat | [subAgentChat.ts](../src/main/lib/subAgent/subAgentChat.ts) | `subAgent.resolvedMcpServers` or `subAgent.config.mcp_servers` |

## 5. Hidden Server Mechanism

### 5.1 Profile Layer

`McpServerConfig.hidden` is an optional boolean field. When `true`:
- Profile sanitizer preserves it during write (conditional spread to avoid adding to non-hidden servers)
- All renderer-side server lists filter it out

### 5.2 UI Filtering Points

All four user-facing server listing components filter `hidden` servers:

- **MCP Settings** → `McpServerListView.tsx`: `servers.filter(s => !s.hidden)`
- **Agent Editor MCP Tab** → `AgentMcpServersTab.tsx`: `servers.filter(s => !server.hidden)`
- **Sub-Agent Form** → `SubAgentForm.tsx`: `mcpServersList.filter(s => !s.hidden)`
- **Sub-Agents Count** → `SubAgentsView.tsx`: `mcpServers.filter(s => !s.hidden).length`

## 6. Feature Flag

| Property | Value |
|----------|-------|
| Name | `kosmosFeatureMemexMemory` |
| Default (dev) | `true` |
| Default (prod) | `false` |
| Gates | Settings nav item, `/settings/memex` route |

The feature flag gates the renderer settings entry, main-process MemexManager startup, and memex IPC authorization. The preload bridge remains stable regardless of flag state so renderer/main do not drift during startup.

## 7. Lifecycle

### 7.1 Enable Flow

```
User clicks toggle ON
  → memexApi.enable()
  → MemexManager.enable()
    1. ensureMemexInstalled()
       a. Run `memex --version`
       b. If missing: `npm install -g @touchskyer/memex@0.1.27`
       c. Verify with `memex --version` again
       d. Throw with actionable message if any step fails
    2. For each chat with an agent:
       a. Build server config (name: memex-{chatId}, hidden: true, env.MEMEX_HOME: ...)
       b. addMcpServerConfig() → persisted to profile
       c. Bind server to agent's mcp_servers array
       d. mcpManager.connect() (async, non-blocking)
    3. Return { success: true }
  → UI shows "Memex Memory enabled"
```

### 7.2 Disable Flow

```
User clicks toggle OFF
  → memexApi.disable()
  → MemexManager.disable()
    1. Unbind memex servers from all agents' mcp_servers arrays
    2. Disconnect and delete all memex-* MCP servers
    3. Return { success: true }
```

### 7.3 Agent Created

```
profile.ts IPC handler → ctx._memexManager.onAgentCreated(chatId)
  1. Check if memex is enabled (any memex-* server exists)
  2. If yes: create config, bind to agent, connect
```

### 7.4 Agent Deleted

```
profile.ts IPC handler → ctx._memexManager.onAgentDeleted(chatId)
  1. Disconnect memex-{chatId}
  2. Delete memex-{chatId} from profile
```

## 8. Memex CLI & Tools

The `@touchskyer/memex` package (v0.1.27) runs as a stdio MCP server exposing Zettelkasten memory operations. The agent can use these tools transparently during conversation.

**Dependency**: Global npm install of `@touchskyer/memex@0.1.27`. The version is pinned to prevent supply-chain drift.

## 9. Error Handling

| Scenario | Handling |
|----------|---------|
| CLI not found, npm unavailable | `ensureMemexInstalled()` throws with actionable error message → `enable()` returns `{ success: false, error }` → UI shows toast |
| CLI installed but not on PATH | Post-install verification throws → same as above |
| Individual server connection failure | Logged as warning, does not fail entire enable flow. Tool execution will fail gracefully at `executeTool()` level. |
| setupMemex() skipped or fails at startup | When the flag is disabled, startup intentionally skips MemexManager setup. If setup throws while enabled, it returns `undefined`, IPC is unavailable, and memex features are disabled for that session. |
| Renderer calls memex while flag is off | Preload bridge still exists, but main-process handlers reject `enable()` / `disable()` and report `getStatus().data.enabled = false` |

## 10. Files Changed

### New Files (5)

| File | Purpose |
|------|---------|
| `src/main/lib/memex/MemexManager.ts` | Core memex manager class |
| `src/main/lib/memex/memexIPC.ts` | IPC bridge and setup factory |
| `src/preload/memex/api.ts` | Stable preload bridge for memex |
| `src/preload/memex/invoke.ts` | Preload invoke registration |
| `src/renderer/components/settings/MemexView.tsx` | Settings UI |
| `src/renderer/ipc/memex.ts` | Renderer API binding |
| `src/shared/ipc/memex.ts` | Shared IPC type definitions |

### Modified Files (21)

| File | What changed |
|------|-------------|
| `src/main/lib/chat/agentChat.ts` | Added `getAgentMcpServerNames()` dependency |
| `src/main/lib/chat/agentChatToolExecutor.ts` | Added `getAgentMcpServerNames` to deps, passes to `executeTool()` |
| `src/main/lib/chat/__tests__/agentChatToolExecutor.test.ts` | Added `getAgentMcpServerNames: () => []` mock |
| `src/main/lib/featureFlags/featureFlagDefinitions.ts` | Registered `kosmosFeatureMemexMemory` (dev-only) |
| `src/main/lib/featureFlags/types.ts` | Added `kosmosFeatureMemexMemory` to `FeatureFlagName` union |
| `src/main/lib/mcpRuntime/mcpClientManager.ts` | Agent-scoped `executeTool()` with guarded fallback |
| `src/main/lib/subAgent/subAgentChat.ts` | Passes `agentMcpServerNames` for sub-agent tool routing |
| `src/main/lib/userDataADO/types/profile.ts` | Added `hidden?: boolean` to `McpServerConfig` |
| `src/main/lib/userDataADO/profileSanitizer.ts` | Preserves `hidden` field during profile sanitization |
| `src/main/main.ts` | Initializes feature flags synchronously before feature-gated startup wiring |
| `src/preload/main.ts` | Exposes the stable `electronAPI.memex` bridge |
| `src/main/startup/ipc/index.ts` | Calls `setupMemex()` only when the feature flag is enabled |
| `src/main/startup/ipc/profile.ts` | Agent created/deleted hooks for memex manager |
| `src/main/startup/ipc/shared.ts` | `_memexManager?: MemexManager` on Context |
| `src/renderer/components/chat/agent-editor/AgentMcpServersTab.tsx` | Filter hidden servers |
| `src/renderer/components/mcp/McpServerListView.tsx` | Filter hidden servers |
| `src/renderer/components/settings/BrowserControlView.tsx` | Removed stale `setIsInstalling`/`setPhase` from disable path (timing bug fix) |
| `src/renderer/components/settings/SettingsNavigation.tsx` | Feature-flagged nav item |
| `src/renderer/components/subAgents/SubAgentForm.tsx` | Filter hidden servers |
| `src/renderer/components/subAgents/SubAgentsView.tsx` | Filter hidden servers from count |
| `src/renderer/lib/mcp/mcpClientCacheManager.ts` | Plumb `hidden` field through MCPServerExtended |
| `src/renderer/lib/userData/types/index.ts` | `hidden?: boolean` on MCPServerExtended |
| `src/renderer/routes/AppRoutes.tsx` | Feature-flagged `/settings/memex` route |

## 11. Known Limitations & Future Work

1. **CLI installation via global npm** — fragile in locked-down environments. Future: bundle memex binary or use a local npm prefix.
2. **Connection failure is fire-and-forget** — tool execution will fail at runtime rather than at enable time. The `executeTool()` error path ensures no silent cross-agent routing.
3. **Coverage is still partial** — dedicated tests now cover memex IPC gating and preload bridge exposure, but end-to-end settings flow coverage is still a follow-up.
4. **Memory data not cleaned up on disable** — `disable()` removes MCP configs and connections but preserves memory files on disk. This is intentional to allow re-enabling without data loss.
