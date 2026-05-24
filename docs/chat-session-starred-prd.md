# Chat Session Starred PRD

## 1. Background

Users have requested support for a `star chat session` capability in Kosmos similar to Claude Desktop, for long-term retention of high-value sessions and quick re-access later.

Kosmos already has the following base capabilities:

- Chat Session-level menu actions: Rename, Fork, Download, Delete
- Ability to update Chat Session metadata individually
- Real-time push of session metadata patches from main process to renderer
- Chat Session list and session-switching logic in the left-hand navigation

What is currently missing is the ability to "promote important sessions into a long-term favorites entry." Users can only rely on the most-recently-updated sort order or search to retrieve historical sessions, which is inefficient.

## 2. Problem Definition

### 2.1 Current Problems

1. Important but inactive sessions quickly sink to the bottom.
2. Users have no way to explicitly express "I want to refer back to this session repeatedly."
3. Search relies on the user remembering the title or keywords, which is unsuitable for "I know it's important but I don't remember the name" scenarios.

### 2.2 Existing Information Architecture Constraints

Kosmos's current left-hand navigation follows an "Agent first, Chat Session second" structure, whereas Claude Desktop is more of a "Session first" structure.

Therefore, this requirement does not recommend directly copying Claude Desktop's full navigation model. Instead, star/favorite capabilities in the Claude style should be introduced while preserving Kosmos's existing information architecture.

## 3. Product Goals

### 3.1 Goals

1. Allow users to `Star` / `Unstar` a Chat Session.
2. Provide an independent `Starred` quick-access area on the left.
3. Support opening a starred session directly from the `Starred` area.
4. Starred state is persistent and survives restarts.
5. Reuse the existing session metadata, IPC, and profile cache update pipeline as much as possible to avoid creating a second state system.

### 3.2 Non-Goals

1. No folder, tag, or bulk management in V1.
2. No refactoring to a "Session-first" navigation in V1.
3. No Agent-level starring in V1 — only Session-level starring.
4. No smart recommendation or auto-starring rules in V1.

## 4. User Stories

1. As a user, I want to star the current conversation in one click from the session's overflow menu.
2. As a user, I want to see a `Starred` area on the left so I can reopen important sessions without remembering the agent or title.
3. As a user, after un-starring a session, I want it removed from `Starred` but still available in the original agent's session list.
4. As a user, I want my starred state to persist after the app restarts.

## 5. Solution Summary

### 5.1 Recommended Approach

A "Claude-style capability + Kosmos-style placement" design:

1. Add a `starred` state to `ChatSession` metadata.
2. Add a `Star` / `Unstar` action to the session overflow menu.
3. Add a profile-level `starred-chat-sessions` index section in `profile.json`.
4. Add a global `Starred` section at the top of the left-side Chats area, rendered directly from that index.
5. The `Starred` section displays all starred sessions in reverse chronological order by last-updated time.
6. The existing agent groupings remain unchanged; sessions are still available in their respective agent's list.

### 5.2 Approach Not Recommended

Directly refactoring into a Claude Desktop-style "global session-first navigation" is not recommended for V1.

Reasons:

1. The current system's core interaction is centered around agents.
2. Existing components and data flows rely heavily on the agent → session hierarchy.
3. Switching the information architecture directly would expand the scope of the requirement, significantly increasing implementation cost and regression risk.

## 6. Interaction Design

### 6.1 Menu Entry

Add a new item to the Chat Session overflow menu:

- When not starred: show `Star`
- When starred: show `Unstar`

This item should be placed at the top of the menu, with higher priority than Rename / Fork / Download / Delete.

### 6.2 Left-Side Display

Add a `Starred` section in the left-side Chats area:

- Position: below the search box, above the agent list
- Shown only when at least one starred session exists
- Expanded by default

### 6.3 Information Displayed per Starred Item

Each item displays:

1. Session title
2. Parent agent name
3. Agent avatar / emoji
4. Relative time, e.g. `Just now`, `2h ago`
5. Unread badge
6. Remote session indicator (if applicable)

### 6.4 Click Behavior

Clicking any session in `Starred`:

1. Navigates to `/agent/chat/:chatId/:sessionId`
2. Updates the currently selected session
3. Keeps the existing ChatView loading logic unchanged

### 6.5 Relationship with the Original List

A starred session:

1. Appears in the `Starred` section
2. Is still retained in the original agent's Chat Session list
3. Its sort order within the original list is unchanged

## 7. Sort and Display Rules

### 7.1 Starred Section Sort Order

Sorted by `last_updated desc`.

### 7.2 Agent-internal Session Sort Order

Existing logic is unchanged; continues to sort by `last_updated desc`.

### 7.3 Search Results

V1 rules:

1. Search logic is unchanged
2. When a starred session is found, a star indicator may be shown
3. No additional search ranking weight for starred sessions

## 8. Data Model Design

### 8.1 New Fields

Proposed additions to `ChatSession` metadata:

```ts
starred?: boolean;
starredAt?: string;
```

And add to the top level of `profile.json`:

```ts
'starred-chat-sessions'?: StarredChatSessionIndexItem[];
```

### 8.2 Field Descriptions

- `starred`: whether the session is currently starred
- `starredAt`: time of most recent starring; cleared when un-starred
- `starred-chat-sessions`: a lightweight index dedicated to the left-side `Starred` area, avoiding full session scanning in `AgentList` on every render

### 8.3 Default Values

- `starred` is unset by default
- `starredAt` is treated as unset when absent
- `starred-chat-sessions` defaults to an empty array

### 8.4 Compatibility Requirements

This is an unreleased new feature; no migration of existing live data is required.

The following type definitions must be updated in sync to avoid struct drift between main / renderer / shared:

1. `src/shared/types/chatSessionTypes.ts`
2. `src/main/lib/userDataADO/types/profile.ts`
3. Renderer-side `userData` type exports

## 9. Technical Implementation Plan

### 9.1 Overall Approach

Reuse the existing pipeline:

`Renderer Menu Event -> AppLayout Handler -> IPC -> chatSessionStore.setStarred -> ProfileCacheManager syncs starred index -> profile cache / metadata patched event -> AgentList rerender`

This pipeline has already been proven viable by Rename, ReadStatus, Delete, and other capabilities.

### 9.2 Main Process

Proposed new semantic method in `chatSessionStore`:

```ts
setStarred(
  alias: string,
  chatId: string,
  chatSessionId: string,
  starred: boolean
): Promise<ChatSessionAggregate | null>
```

Internal logic:

1. Read the current aggregate
2. Update `starred` and `starredAt` in metadata
3. Flush session metadata
4. Trigger `metadataPatched`

Although the underlying implementation can directly reuse `patchMetadata`, it is recommended to keep a standalone semantic method to facilitate:

1. Analytics instrumentation
2. Permission checks
3. Limit control
4. Behavior extension

### 9.3 IPC

Add profile-level IPC:

```ts
profile:setChatSessionStarred(alias, chatId, sessionId, starred)
```

Returns:

```ts
{ success: boolean; error?: string }
```

Must also add:

1. `ipcMain.handle` in `main.ts`
2. API exposure in `preload.ts`
3. Type declaration on the renderer side

### 9.4 Renderer Menu Layer

Add `starred` input to `ChatSessionDropdownMenu` and add menu items:

- `Star`
- `Unstar`

On click, dispatch:

```ts
window.dispatchEvent(new CustomEvent('chatSession:toggleStar', {
  detail: { chatId, sessionId, starred }
}))
```

### 9.5 AppLayout Unified Handling

Following the existing Rename / Delete event-handling pattern, add to `AppLayout`:

1. Listen for `chatSession:toggleStar`
2. Call `window.electronAPI.profile.setChatSessionStarred(...)`
3. Show toast on success

Recommended toast copy:

- `Session starred`
- `Session unstarred`

### 9.6 Left-Side Navigation Display Layer

Add a `Starred` section in `AgentList`.

#### Data Source Recommendation

Recommend rendering directly from `profile['starred-chat-sessions']` already synced to the renderer by `profileDataManager`, without depending on local pagination state or scanning `chats[].chatSessions`.

Reasons:

1. Starred is an aggregated cross-agent view
2. A profile-level index is better suited for a persistent quick-access area
3. AgentList's local pagination state is not fully equivalent to the actual profile push, so depending on pagination state is higher-risk
4. Avoids flattening the full session list on every render

#### Computation Logic Recommendation

1. Read `profile['starred-chat-sessions']`
2. Deduplicate and filter invalid entries
3. Sort by `lastUpdated desc`
4. Use `chatId + chatSessionId` to navigate to the target session on click

## 10. Affected Modules

### 10.1 Data and Types

- `src/shared/types/chatSessionTypes.ts`
- `src/main/lib/userDataADO/types/profile.ts`
- `src/renderer/lib/userData/types/index.ts`

### 10.2 Main Process

- `src/main/lib/chat/chatSessionStore.ts`
- `src/main/main.ts`
- `src/preload/main.ts`

### 10.3 Renderer Process

- `src/renderer/components/menu/ChatSessionDropdownMenu.tsx`
- `src/renderer/components/layout/AppLayout.tsx`
- `src/renderer/components/chat/agent-area/AgentList.tsx`
- `src/renderer/lib/userData/profileDataManager.ts`

## 11. Acceptance Criteria

### 11.1 Functional Acceptance

1. Users can `Star` / `Unstar` from the session menu
2. After starring, the `Starred` section on the left immediately appears or updates
3. After un-starring, the session is immediately removed from the `Starred` section
4. Starred state persists after app restart
5. After deleting a starred session, it disappears from the `Starred` section in sync
6. After renaming a starred session, the title in `Starred` updates in sync
7. Clicking a `Starred` item correctly opens the target session

### 11.2 Compatibility Acceptance

1. The star feature does not affect existing Rename / Fork / Download / Delete
2. Does not affect current session switching and unread status updates
3. No errors when `starred-chat-sessions` in `profile.json` is empty

## 12. Analytics Instrumentation Recommendations

Recommended new events:

1. `chat_session_starred`
2. `chat_session_unstarred`
3. `chat_session_opened_from_starred`
4. `starred_section_impression`

Recommended fields:

1. `chatId`
2. `sessionId`
3. `agentName`
4. `brand`
5. `source` (`menu` / `quick-action`)
6. `isRemote`

## 13. Risks and Considerations

### 13.1 Information Architecture Risk

If `Starred` grows significantly in the future, users may mistakenly perceive it as the new primary navigation structure.

V1 should explicitly define it as a "quick access area," not a replacement for the existing agent-first navigation.

### 13.2 Data Flow Risk

AgentList currently has local pagination state and profile pushes coexisting in parallel. `Starred` must not depend on paginated load results — it should depend on the profile-level `starred-chat-sessions` index.

### 13.3 Type Sync Risk

The `ChatSession` type is defined in both shared and main profile types. When adding new fields, both must be updated in sync; otherwise, main / renderer struct mismatches can easily occur.

### 13.4 V1 Complexity Control

V1 should only implement the menu entry; do not add hover quick-star buttons, bulk management, or filters. This keeps the requirement boundary clear.

## 14. Phased Implementation Plan

### Phase 1: Data and IPC

1. Add `starred` / `starredAt` fields
2. Add `chatSessionStore.setStarred()`
3. Add `starred-chat-sessions` to `profile.json`
4. Add IPC exposure and renderer call interface
5. Add unit tests covering metadata patch and index sync behavior

### Phase 2: Menu Interaction

1. Add `Star` / `Unstar` to `ChatSessionDropdownMenu`
2. Add toggle handling logic to `AppLayout`
3. Add success / failure toast

### Phase 3: Left-Side Display

1. Add `Starred` section to `AgentList`
2. Support click navigation and overflow menu
3. Support unread / remote / agent information display

### Phase 4: Polish

1. Add star indicator to search results
2. Add analytics instrumentation
3. Evaluate hover quick-star button

## 15. Recommended Conclusion

This is an incremental requirement that fits well with the current Kosmos architecture:

1. Clear user value
2. Clear technical path
3. Can extensively reuse existing metadata patch pipeline
4. Does not require dismantling the current agent-first navigation structure

Recommended to proceed with V1 implementation following this document's plan.
