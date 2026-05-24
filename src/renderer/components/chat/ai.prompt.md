<!-- Last verified: 2026-05-17 -->
# Chat UI

> The largest UI module (~84 files, ~32K LOC) providing the full chat interface: message rendering, rich input, agent selection, agent editing, tool call visualization, and workspace file browsing.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `ChatView.tsx` | Main chat view container; owns route↔session sync, session fork/select, edit-agent navigation, schedule sidepane trigger | ~420 LOC |
| `ChatViewContent.tsx` | Scrollable message list area with replay logic; owns isEmpty/zeroStates decisions, delegates rendering to `ChatContainer` and input to `ChatInput` | ~300 LOC |
| `ChatViewHeader.tsx` | Header bar with agent name, session controls, and workspace toggle | — |
| `ChatRenderItem.tsx` | Unified render-item type system and `ChatRenderItemComponent` — transforms flat message arrays into typed render items (system, say-hi, user, assistant, tool-calls-section, activity-loading, activity-placeholder, interactive-request, interactive-auth) and renders each type | ~530 LOC |
| `ChatContainer.tsx` | Scroll container for the message list; owns auto-scroll logic (follow-latest, session-switch reset, jump-to-latest button), message editing entry, and delegates per-item rendering to `ChatRenderItemComponent` | ~590 LOC |
| `InteractiveRequestCard.tsx` | Timeline-native renderer for pending `approval`, `choice`, and `form` interactions | — |
| `InteractiveAuthCard.tsx` | Timeline-native renderer for interactive CLI auth prompts (device code, link, countdown) using the same card styling system | — |
| `Message.tsx` | Renders a single completed message: markdown (remark-gfm + rehype-raw), syntax highlighting, Mermaid diagrams, say-hi cards, generated file cards, schedule cards inferred from referenced scheduler job IDs, and streaming via `StreamingV2Message` | ~1.1K LOC |
| `ChatInput.tsx` | Rich textarea with file/image/office attachments, voice input, screenshot attach, context @-mentions, skill @-mentions, `/buddy` slash commands, model selector, reasoning-effort selector, keyboard shortcuts, and inline retry state | ~920 LOC |
| `chat-input/ReasoningEffortSelector.tsx` | Per-chat reasoning effort picker; renders only when the active model advertises ≥2 effort tiers; persists the choice to `chat.agent.reasoningEffort` via `useAgentConfig().updateConfig`; marks one tier `(default)` using a vendor-aware heuristic (Claude → `high`, GPT/others → `medium`) | small |
| `ToolCallItem.tsx` / `ToolCallsSection.tsx` | Accordion wrappers that select the correct `toolCallViews/` component per tool type | — |
| `toolCallDisplayConfig.ts` | Static map of tool name → display label/icon | — |
| `ErrorBar.tsx` | Inline error display within the chat | — |
| `ChatSide.tsx` | Right sidepane container for schedules and inline preview | — |
| `chat-side.atom.ts` | Atoms for `ScheduleSidepaneAtom` and `InlinePreviewAtom` | — |
| `edit-message.atom.ts` | Atom for inline user-message editing state | — |
| `agent-area/AgentList.tsx` | Left-sidebar agent list with search, pinning, and creation entry points | ~2.3K LOC |
| `agent-area/AddFromAgentLibraryViewContent.tsx` | CDN agent library browser with install flow | ~2K LOC |
| `agent-editor/AgentBasicTab.tsx` … `AgentSystemPromptTab.tsx` | Agent settings tabs for a single agent (basic info, context enhance, knowledge base, MCP servers, skills, sub-agents, schedules, system prompt) | — |
| `agent-editor/AddScheduleOverlay.tsx` | Shared schedule create/edit dialog; owns briefing-source selection UI and legacy-briefing edit compatibility | — |
| `agent-editor/scheduleTemplates.ts` | Built-in schedule templates, including the briefing template | — |
| `toolCallViews/ExecuteCommandToolCallView.tsx` | Shell command result display with exit code, stdout/stderr | — |
| `toolCallViews/WebFetchToolCallView.tsx` | Fetched page content display | — |
| `toolCallViews/WebSearchToolCallView.tsx` | Search result cards | — |
| `toolCallViews/WriteFileToolCallView.tsx` | Written file path and diff summary | — |
| `toolCallViews/SubAgentToolCallView.tsx` | Sub-agent task progress and result display | — |
| `workspace/FileTreeExplorer.tsx` | Expandable file tree for the active workspace | — |
| `workspace/PasteToWorkspaceDialog.tsx` | Dialog to save AI-generated content into a workspace file | — |
| `pm-project-agent-creation/` | Multi-step wizard for creating project agents; includes a subtle Agent Library link that navigates to `AddFromAgentLibraryView` with `location.state.backTo` so back returns here | — |
| `MermaidDiagram.tsx` | Lazy-loaded Mermaid diagram renderer with fullscreen support | — |
| `chat-input/ContextMenu.tsx` | @-mention dropdown for files, skills, and workspace items | — |

## Architecture

### Component Hierarchy
```
ChatView (route sync, session operations)
  └─ ChatViewContent (message filtering, isEmpty/zeroStates, replay)
       ├─ ChatContainer (scroll management, render-item iteration)
       │    └─ ChatRenderItemComponent (per-item type dispatch)
       │         ├─ MessageComponent (completed messages)
       │         ├─ ToolCallsSection (tool call accordions)
       │         ├─ InteractiveRequestCard
       │         ├─ InteractiveAuthCard
       │         └─ ChatInput (inline edit mode)
       ├─ ChatZeroStates (quick-start prompts)
       ├─ ChatInput (main composer)
       └─ ChatSide (schedule sidepane, inline preview)
```

`ChatView` sits under the `/agent/chat/:chatId/:sessionId` route. It synchronizes the route with the backend session state via `agentChatSessionCacheManager`, handles session fork/select, and dispatches navigation events for agent editing.

### Message Rendering Pipeline
Messages flow through a clear pipeline:
1. `ChatView` reads session status via `CurrentSessionStatus.use()`
2. `ChatViewContent` receives messages via `useMessagesWithStream()`, filters out say-hi messages, determines `isEmpty`/`showZeroStates`, and optionally wraps messages through the replay system
3. `ChatContainer` receives the final message list as props, converts them to `ChatRenderItem[]` via `useRenderItems()` from `ChatRenderItem.tsx`, manages auto-scroll
4. `ChatRenderItemComponent` dispatches each item to the appropriate renderer by type

Completed messages go through `Message.tsx` (static markdown pipeline), in-progress messages go through `StreamingV2Message` (RAF typewriter). Tool calls within a message are rendered inline via `ToolCallsSection` → per-type view components in `toolCallViews/`.

### Render Item System
`ChatRenderItem.tsx` owns the transformation from flat `Message[]` to a typed discriminated union of render items. This centralizes the logic for:
- Grouping consecutive tool-result messages into `tool-calls-section` items
- Detecting in-progress `execute_command` tool calls for activity indicators
- Extracting interactive auth hints from tool results
- Surfacing `pendingInteractiveRequest` as a timeline item

### Scroll Management
`ChatContainer` separates scroll ownership from reverse message layout: the outer `.chat-container-reverse` element is the scroll container, while an inner reverse-flow wrapper handles `column-reverse`. Initial latest-position resets track `chatSessionId` and appended message count; `chatId` must not drive those resets because session history switches can happen under the same chat identity. Session-switch latest-scroll performs deferred follow-up passes (`requestAnimationFrame` + short timeout) and temporarily watches message-flow resizes. Streaming and resize-driven latest-scroll respect manual scroll-away via a threshold check.

### Session Switching
`ChatView` and `ChatViewContent` treat session switching as an explicit transient UI state. While a route-targeted `chatSessionId` is active but its cache snapshot is not ready yet, the message list is replaced with a neutral "Opening chat history..." placeholder and the composer is locked.

### Interactive Requests
Interactive requests are chat-session-native. Pending requests are rendered inline in the timeline via `InteractiveRequestCard` and are dismissed from the UI after submission or resolution. Approval requests auto-submit as soon as every item has an approve/reject decision. Choice requests and form select-like controls render as responsive wrapped option grids with an `Other` fallback card for custom text input.

### User Message Editing
Inline user-message editing is managed via `editMessageAtom`. `ChatContainer` renders an inline `ChatInput` in edit mode for the message being edited. The edit confirmation dialog is owned by `AppLayout` via a window-event bridge; its suppression preference is persisted in `profile.json` under `confirmationSettings.inlineEditRegenerate.skipConfirmation`.

### Sidebar and Editor
The agent sidebar (`agent-area/`) is a sibling panel in `AgentPage`, not a child of `ChatView`. The agent editor (`agent-editor/`) appears when navigating to `/agent/chat/:chatId/settings/*`. Scheduled chat sessions live in the dedicated `SchedulesSidepane` (accessed via `ChatSide`); conversation search excludes scheduled sessions.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new tool call display | `toolCallViews/<NewTool>ToolCallView.tsx`, `toolCallViews/index.ts`, `toolCallDisplayConfig.ts`, `ToolCallItem.tsx` | Follow the existing view component pattern; register in `index.ts` and the display config map |
| Add a new render item type | `ChatRenderItem.tsx` (add to `ChatRenderItem` union + `useRenderItems` + `ChatRenderItemComponent`) | Centralized — no need to touch `ChatContainer` |
| Modify chat input behavior | `ChatInput.tsx` | Locate the relevant handler section before editing |
| Change approval / choice / form interactions | `InteractiveRequestCard.tsx`, `ChatRenderItem.tsx`, `agentChatSessionCacheManager.ts` | Pending requests surface via `useRenderItems` |
| Change message rendering (markdown, code blocks) | `Message.tsx` — `sharedMarkdownComponents` object | Affects all completed (non-streaming) messages |
| Add an agent editor tab | `agent-editor/Agent<Name>Tab.tsx`, routing in `AppRoutes.tsx`, tab navigation in the editor shell | Follow the existing tab shell pattern |
| Modify scroll behavior | `ChatContainer.tsx` — `useAutoScroll` hook | Always verify `chatSessionId`-keyed resets |

## Co-Change Map
| Change | Also touch |
|--------|-----------|
| New tool call type | `toolCallViews/<New>ToolCallView.tsx` + `toolCallViews/index.ts` + `toolCallDisplayConfig.ts` + `ToolCallItem.tsx` |
| New render item type | `ChatRenderItem.tsx` (type union + `useRenderItems` + `ChatRenderItemComponent`) |
| New attachment type in `ChatInput` | `contentUtils.ts` (`ContentPartFactory`) + `@shared/types/chatTypes` (`UnifiedContentPart`) + `FILE_ATTACHMENT_LIMITS` in shared constants |
| New interactive request control type | `InteractiveRequestCard.tsx` + `@shared/types/interactiveRequestTypes` + `agentChatSessionCacheManager.ts` |
| New agent editor tab | `agent-editor/Agent<Name>Tab.tsx` + `AppRoutes.tsx` (nested route) + editor shell nav |
| Session scroll / layout changes | `ChatContainer.tsx` + `ChatContainer.css` — always verify `chatSessionId`-keyed resets, not `chatId`-keyed |
| Streaming rendering changes | `src/renderer/components/streaming/StreamingV2Message.tsx` (never `Message.tsx`) |
| Send-gate logic | `ChatInput.tsx` (explicit `chatStatus === 'idle'` guard) + renderer send entry point cache status re-check |
| Agent Library back navigation | `agent-area/AddFromAgentLibraryView.tsx` reads `location.state.backTo`; any new caller must pass `{ state: { backTo } }` |

## Anti-Patterns
- **Reading `useMessages()` inside `ChatContainer`**: causes session-switch stale renders. Message list must be owned by `ChatViewContent` and passed as props.
- **Driving scroll resets from `chatId`**: history switches can swap sessions under the same chat identity. Always key scroll resets to `chatSessionId`.
- **Treating `null`/`undefined` chatStatus as idle**: reopens the race where the composer fires before session state hydrates.
- **Showing zero-state before session cache is ready**: use the "Opening chat history…" placeholder gate in `ChatViewContent`.
- **Adding streaming logic to `Message.tsx`**: `Message.tsx` is for completed messages only. In-flight state belongs in `StreamingV2Message`.
- **Adding render-item logic to `ChatContainer`**: item type definition and rendering dispatch belong in `ChatRenderItem.tsx`.
- **Importing `mermaid` directly in chat files**: `MermaidDiagram` is a lazy async webpack chunk; a synchronous import breaks code splitting.
- **Bypassing `installAndActivateSkill` for new skill flows**: all install paths must funnel through the single authoritative entry point.

## Verification Steps
After modifying components in this directory:
1. Send a message and confirm streaming renders progressively (no flash to completed state).
2. Switch chat sessions mid-stream and verify the previous session's messages are not briefly shown.
3. Trigger an `approval` interactive request and confirm it auto-submits once every item is decided.
4. Open an agent with a workspace; confirm `@`-mention context menu populates file results.
5. Attach an image and an Office file; confirm both appear in the composer preview and are included in the sent message payload.
6. For tool call changes: expand the tool call accordion and verify the correct view renders with no console errors.
7. Run `npm test` — the `__tests__/` suite covers interactive request card behavior and message rendering edge cases.

## Gotchas

- `ChatInput.tsx` is large (~920 LOC). Read and understand the full component structure before making localized edits — state is densely threaded.
- `StreamingV2Message` (in `src/renderer/components/streaming/`) handles in-flight messages; `Message.tsx` only renders completed messages. Do not add streaming-specific logic to `Message.tsx`.
- Tool result messages are not always final. A `tool` message with `streamingComplete === false` is an in-progress snapshot and should still render as executing.
- Interactive auth cards are intentionally ephemeral. Once the command ends, times out, or the user cancels it, the timeline card should disappear.
- `ChatContainer` is not the source of truth for session messages. Message selection lives in `ChatViewContent` (or replay state); the active list is passed down as props.
- Session switching is not the same as an empty chat. Do not show empty-state or zero-state UI until the target session cache is ready.
- `ChatInput` send availability must be based on explicit `chatStatus === 'idle'`. Treating missing status as idle reopens a race where the composer can submit before the session state hydrates.
- Inline edit submission failures are recoverable chat errors. If `onSubmitEditedMessage` rejects, capture the message in the chat-session cache so `ErrorBar` can render it.
- Timeline auto-scroll is not driven solely by message-count changes. If a pending interactive request or similar non-message timeline item is inserted, `ChatContainer` still needs an explicit latest-scroll trigger.
- Agent editor tab routes use nested React Router `<Outlet>` — adding a tab requires touching both the component tree and `AppRoutes.tsx`.
- Mermaid diagrams are lazy-loaded as an async webpack chunk; avoid importing `mermaid` directly in synchronously loaded chat files.

## Related

- Depends on [IPC](../../../shared/ipc/ai.prompt.md) for all main-process communication
- Depends on [Streaming lib](../../lib/streaming/ai.prompt.md) for config/monitoring of the typewriter renderer
- Rendering counterpart for streaming: `src/renderer/components/streaming/` (`StreamingV2Message`, `StreamingScrollManager`)
- Communicates with [Chat Engine](../../../main/lib/chat/ai.prompt.md) via IPC channels
- Agent/profile state is sourced from renderer user-data providers plus `agentChatSessionCacheManager`
