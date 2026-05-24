# Data Flow

Reference: `src/shared/ipc/base.ts`, `src/main/lib/chat/agentChat.ts`, `src/main/lib/mcpRuntime/mcpClientManager.ts`, `src/renderer/lib/streaming/`

---

## IPC: Two Coexisting Implementations

The codebase currently uses **two IPC styles in parallel**. New code should use the type-safe framework; the legacy string-based style remains in most existing handlers and is being migrated incrementally.

### 1. Legacy: String-Convention IPC (majority of code)

- Direct use of `ipcMain.handle('channel:name', handler)` in main and `ipcRenderer.invoke('channel:name', ...)` in renderer.
- Channel names, parameter types, and return types are **hand-written and duplicated** across main, preload, and renderer.
- Preload whitelist is a separately maintained string array — missing entries fail silently at runtime.
- Found throughout `src/main/startup/ipc/` and most older handlers registered in `main.ts`.

### 2. New: Type-Safe IPC Framework (minority, preferred for new code)

See [ai.prompt.md](../src/shared/ipc/ai.prompt.md). Two factory functions cover cross-process communication from a single shared type definition.

**`connectRenderToMain<RM>(prefix?)`** — Renderer → Main (invoke/handle pattern)
- Generates `ipcMain.handle()` bindings from a TypeScript interface via Proxy
- Preload whitelist enforced at compile time: missing keys produce a TS error
- Channel naming: `"{prefix}:{methodName}"`

**`connectMainToRender<MR>(prefix?)`** — Main → Renderer (send/on pattern)
- Uses a `WeakMap<WebContents>` cache to create per-window proxies
- Main side pushes via `webContents.send()`; renderer subscribes via `ipcRenderer.on()`
- Main process also emits `navigate:to` to trigger renderer-side route changes

Currently adopted by: screenshot overlay, browser control, scheduler, plugin, buddy, memex.

See [IPC Framework details](../src/shared/ipc/ai.prompt.md)

---

## Chat Message Flow

Seven-step pipeline from user input to persisted message.

1. User sends message → Renderer calls `sendChatMessage` IPC
2. Main `AgentChat` formats prompt with agent config, system prompt, and MCP tool definitions
3. Main calls LLM API with streaming enabled via Vercel AI SDK 5.x
4. Streaming chunks forwarded to renderer via `onStreamingChunk` IPC events
5. `AgentChatIpc` → `AgentChatSessionCacheManager` → direct callback → `AgentPage` state update
6. `StreamingV2Message` renders with RAF-based typewriter animation
7. Completed message saved to `{userData}/profiles/{userAlias}/chatSessions/{sessionId}.json`

Chat status transitions: `IDLE → SENDING_RESPONSE → COMPRESSING_CONTEXT → COMPRESSED_CONTEXT → RECEIVED_RESPONSE`

See [Chat Engine](../src/main/lib/chat/ai.prompt.md)

---

## Profile Update Flow

Dual-debounce design keeps disk I/O and React renders decoupled from user actions.

1. User action in renderer → IPC call to main
2. `ProfileCacheManager` updates in-memory cache and writes to disk
3. `ProfileCacheManager` batches frontend notification — 500ms debounce
4. Renderer `ProfileDataManager` receives update → 200ms debounce → React components re-render

Total end-to-end lag: up to 700ms between user action and React component update.

---

## MCP Tool Execution Flow

1. LLM requests a tool call during chat generation
2. `AgentChat` routes the request to `MCPClientManager`
3. `MCPClientManager` resolves the target client:
   - Built-in tool → dispatched through `BuiltinToolsManager` to specific handler
   - External server → executed via `VscMcpClient` (stdio / SSE / HTTP transport)
4. Tool result returned to LLM for continued generation
5. File/command tools requiring path access pass through `SecurityValidator` for user approval

See [MCP Runtime](../src/main/lib/mcpRuntime/ai.prompt.md)

---

## Sub-Agent Execution Flow

1. Parent agent's LLM requests `spawn_subagent` or `spawn_multiple_subagents` tool call
2. `BuiltinToolsManager` dispatches to `SubAgentManager`
3. `SubAgentManager` validates resource limits (max 5 parallel, max 20 per session) and creates sub-agent instance
4. `SubAgentChat` runs a non-streaming conversation loop (≤25 turns, 30s timeout) with the inherited parent model
5. Sub-agent executes tools via `MCPClientManager`; recursive sub-agent spawning is blocked
6. Final result extracted and returned to parent agent's conversation
7. Sub-agent instance cleaned up — no session persistence

---

## Streaming Rendering Pipeline

The pipeline is optimized to bypass React's rendering scheduler entirely during active streaming.

- Main process streams LLM chunks via IPC
- `AgentChatIpc` receives chunks → `AgentChatSessionCacheManager` stores via direct callback (bypasses React rendering pipeline)
- `AgentPage` registers direct callbacks for immediate state mutation without triggering reconciliation
- `StreamingV2Message`: `requestAnimationFrame`-based typewriter effect — 8 chars/frame for text, 1 char/frame for punctuation
- `StreamingScrollManager`: VSCode-style smart auto-scroll — auto-scroll disabled when user scrolls more than 150px from bottom
- Metrics tracked per message: words/second, time-to-first-content, latency
- Mermaid diagrams and Monaco editor are lazy-loaded as separate async webpack chunks to avoid blocking initial render

See [Streaming](../src/renderer/lib/streaming/ai.prompt.md)
