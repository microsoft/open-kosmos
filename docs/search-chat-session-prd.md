# Search Chat Session PRD

## 1. Background

Kosmos already supports multiple agents and multiple chat sessions per agent. Sessions are surfaced in the left sidebar as a second-level list under each agent, ordered by `last_updated`.

As the number of sessions grows, users have to expand agents one by one and visually scan titles. This is workable for a small number of sessions, but it breaks down when users:

- switch frequently between multiple agents
- revisit old sessions after days or weeks
- maintain parallel branches of the same topic
- need to find an unread or remotely synced session quickly

Current architecture is favorable for a first version of session search:

- session metadata already exists independently from `profile.json`
- session metadata is indexed by chat and month
- renderer already receives session projections and keeps a local session list for navigation

This means Kosmos can deliver a strong first version with metadata search before investing in full-text search over message history.

## 2. Problem Statement

Users cannot quickly locate a historical conversation when they only remember part of the session title, the agent name, or an approximate time window.

The current navigation model is browse-first, not find-first.

## 3. Goals

### 3.1 Product Goals

- Let users find a chat session within seconds instead of manually expanding agents.
- Preserve the existing mental model of `Agent -> Sessions` while adding a faster retrieval path.
- Make search feel lightweight and instant for the common case.

### 3.2 User Goals

- "I remember the conversation title roughly, help me jump back to it."
- "I know which agent it belonged to, but not which session."
- "Show me the most relevant recent session matching this keyword."
- "Help me find the unread session I missed."

### 3.3 Non-Goals for MVP

- Full-text search across all message bodies
- Semantic search over conversation meaning
- Search across files attached inside a session
- Search across tool-call payload bodies
- Unified search across sessions, skills, MCP servers, and files in one box

## 4. Users and Scenarios

### 4.1 Primary Users

- Heavy daily users with tens to hundreds of sessions
- Users who split work by topic or branch
- Users revisiting earlier research, debugging, or planning threads

### 4.2 Core Scenarios

1. Resume previous work
User types part of a title and jumps directly back into the correct session.

2. Find by agent context
User remembers the agent, but not the exact title. Search should expose the agent name in results.

3. Recover unread work
User wants to locate unread sessions without browsing every expanded agent.

4. Distinguish similar sessions
User has many sessions with similar titles like "Fix auth", "Fix auth v2", "Fix auth retry". Search must show enough metadata to differentiate them.

## 5. Design Principles

1. Search should feel like navigation, not like a heavyweight database query.
2. Result quality matters more than filter richness in v1.
3. Reuse the left-sidebar mental model instead of creating a disconnected page.
4. Default to metadata search first; only add content search when performance and result explainability are acceptable.
5. The first result should often be actionable without extra clicks.

## 6. Proposed Experience

### 6.1 Entry Point

Add a search input at the top of the left sidebar agent area.

Suggested placeholder:

`Search conversations`

Behavior:

- Empty state: sidebar behaves exactly as today.
- On focus: show recent hint text or recent matches if desired.
- On typing: sidebar enters `search mode`.

Optional shortcut:

- Recommend adding a keyboard shortcut after hotkey audit.
- Preferred interaction is "focus conversation search" rather than opening a separate modal.

### 6.2 Search Scope

Default scope: all non-scheduled chat sessions across all agents.

Rationale:

- The current pain is cross-agent retrieval.
- Searching only within the expanded agent is too narrow for the primary use case.

Secondary scope options:

- `All conversations` default
- `Current agent only` quick filter

MVP can ship with only:

- `All conversations`
- `Current agent only`

### 6.3 Matching Logic

MVP matches against metadata only:

- session title
- agent name
- optional source badge metadata such as remote/local

Recommended ranking order:

1. Exact title prefix match
2. Title token match
3. Title substring match
4. Agent name match
5. More recent sessions rank higher when textual relevance is similar
6. Unread sessions get a small boost, but do not override obviously better matches

### 6.4 Result Presentation

When search mode is active, replace the expanded browse tree with a flat results list.

Each result item should show:

- session title
- agent avatar + agent name
- last updated time, formatted relatively when recent
- unread state
- remote badge if applicable

Recommended row structure:

- Primary line: session title with highlight
- Secondary line: agent name + last updated
- Right side: unread dot or badge

Why flat list instead of grouped tree in MVP:

- Faster scanning
- Less vertical nesting
- Better for keyboard navigation
- Simpler ranking model

If needed, a lightweight grouped variant can be introduced later for long result sets.

### 6.5 Interaction Model

Typing:

- Debounce input by 100 to 150 ms
- Results update instantly in place

Selecting a result:

- Navigate directly to `/agent/chat/:chatId/:sessionId`
- Keep the query in the box until navigation completes
- After navigation, clear search mode and restore normal sidebar

Keyboard behavior:

- `Up/Down` moves active result
- `Enter` opens active result
- `Esc` clears query if not empty; exits search mode if already empty

Mouse behavior:

- Hover reveals active row state
- Click opens result

### 6.6 Empty, Loading, and Edge States

No query:

- Show the normal agent/session navigation

No results:

- Empty state copy: `No conversations found`
- Secondary hint: `Try title keywords or switch scope`

Short query:

- Allow 1-character search, but ranking quality may be noisy
- Optional optimization: do not show full-result mode until 2 characters; not required for MVP

Many results:

- Cap initial render to top 50 results
- Show `Showing top 50 results` if total exceeds cap

Loading:

- For metadata-only MVP, loading should be effectively instant and can avoid spinner-heavy UX

### 6.7 Recommended UX Copy

- Search box placeholder: `Search conversations`
- Scope chip: `All conversations`
- Scope chip: `Current agent`
- Empty state: `No conversations found`
- Helper text: `Search by title or agent name`

## 7. Information Architecture

### 7.1 Browse Mode

- Agent list
- Expand agent
- Session list

### 7.2 Search Mode

- Search input
- Scope control
- Flat result list
- Return to browse mode on clear

This keeps a single navigation surface instead of introducing a dedicated search page.

## 8. Functional Requirements

### 8.1 Must Have

1. User can search chat sessions by session title.
2. User can search across all agents.
3. User can limit search to current agent.
4. Search results show agent identity and last updated time.
5. User can open a result directly.
6. Search respects unread state display.
7. Scheduled sessions are excluded from default search results and remain available via the dedicated schedules surface.
8. Search works with existing session creation, rename, delete, and fork flows.

### 8.2 Should Have

1. Keyboard navigation for results.
2. Highlight matched title fragments.
3. Reasonable recency-aware ranking.
4. Search result updates immediately after session metadata changes, including removal when a session becomes scheduled.

### 8.3 Could Have

1. Recent searches
2. Suggested recent sessions on focus
3. Search by date range
4. Search by unread only
5. Search by remote/local source

## 9. Data and Technical Strategy

### 9.1 MVP Strategy

Use renderer-side metadata search.

Why this is the right first step:

- Kosmos already surfaces session metadata in the sidebar flow.
- Session title, `last_updated`, `readStatus`, and agent relationship are enough for the primary job-to-be-done.
- This avoids scanning every chat session file on each keystroke.
- It fits the current architecture where session metadata is already separated from full chat history.

### 9.2 Suggested Data Model for Search Index in Renderer

Flatten all visible session metadata into a local search collection:

- `chatId`
- `chatSessionId`
- `sessionTitle`
- `agentName`
- `agentAvatar/emoji` for display only
- `lastUpdated`
- `readStatus`
- `isScheduled`
- `sourceType`

### 9.3 Index Update Triggers

Update search collection when:

- profile data loads
- session created
- session metadata patched
- session deleted
- session forked
- agent renamed or removed

### 9.4 Why Not Full-Text Search in MVP

Full-text search would require one of the following:

- scanning session files on demand
- building a persistent inverted index
- keeping an in-memory content index in sync with session file changes

All three add complexity, cost, and ranking ambiguity.

This should be a separate phase.

## 10. Detailed UX Spec

### 10.1 Search Input State Machine

State A: idle

- query is empty
- normal sidebar shown

State B: searching

- query is non-empty
- search results shown
- browse tree hidden

State C: no results

- query is non-empty
- zero results found
- empty state shown

### 10.2 Result Ordering Example

For query `auth`:

- `Auth token refresh failure`
- `Auth retry design`
- `Fix browser auth window`
- `M365 Agent` sessions if title is weak but agent name matches

### 10.3 Highlighting

Highlight the matched substring in title.

Do not highlight aggressively across every metadata field in MVP. Keep the row visually calm.

### 10.4 Restoring Context

After a result is opened:

- restore normal browse mode
- auto-expand the target agent in the sidebar
- ensure the selected session is visibly active

## 11. Success Metrics

### 11.1 Primary Metrics

- Session open success rate after search
- Median time from first keystroke to session open
- Search usage rate among users with more than 20 sessions

### 11.2 Secondary Metrics

- Zero-result rate
- Query abandonment rate
- Average results clicked position
- Repeat search frequency within the same day

## 12. Rollout Plan

### Phase 1: Metadata Search MVP

- Search by session title and agent name
- Search across all agents
- Current-agent-only filter
- Flat result list in sidebar
- Keyboard navigation

### Phase 2: Power Filters

- Unread only
- Remote/local filter
- Optional scheduled-only filter or grouped result presentation if default mixed results become noisy
- Recent searches or recent sessions on focus

### Phase 3: Content Search

- Search within message bodies
- Return matched snippet preview
- Add explicit label such as `Matched in message content`

Phase 3 should only start after validating that title-level search solves a meaningful share of retrieval tasks.

## 13. Risks and Tradeoffs

### 13.1 Risk: Users expect full-text search immediately

Mitigation:

- Set expectation in helper copy: `Search by title or agent name`
- Avoid implying full conversation content search in v1

### 13.2 Risk: Result quality is poor for generic titles

Mitigation:

- Show agent name and recency prominently
- Improve title generation quality separately if needed
- Add content search in later phase

### 13.3 Risk: Search result list diverges from paginated sidebar state

Mitigation:

- Build search from the authoritative session metadata projection, not only from currently paginated visible rows

### 13.4 Risk: Scheduled sessions dominate generic search queries

Mitigation:

- Rely on title relevance and recency ranking so scheduled runs compete fairly with normal sessions
- Revisit separate result grouping only if user feedback shows scheduled-heavy agents becoming noisy

## 14. Open Questions

1. Should scheduled sessions appear in a separate result section when included?
2. Should remote sessions support extra source labels beyond the current `remote` badge?
3. Is a global shortcut needed in v1, or is sidebar entry enough?
4. Should search preserve the query after opening a result so users can jump through multiple matches?

## 15. Recommendation

Ship a focused MVP that solves the real retrieval problem with minimal architectural risk:

- Sidebar search input
- Metadata-only search
- Cross-agent results
- Current-agent filter
- Flat ranked results
- Direct navigation on selection

Do not start with full-text search. The product problem is currently navigation friction, not deep knowledge retrieval.
