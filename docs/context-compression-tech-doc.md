# OpenKosmos Context Compression Technical Design

> Version: 0.1 | Date: 2026-04-08

> Status note (2026-04-09): This document includes earlier design exploration that predates the current session-open behavior change. Current runtime behavior is stricter than some sections below originally proposed: compression must not run during standalone session initialization. It only runs inside the active send / start-chat loop and via bounded overflow recovery within that loop.

## 1. Overview

This document defines a replacement direction for OpenKosmos chat-context compression.

The goal is to make long-running and imported chat sessions safe under model context limits without relying on a single monolithic LLM summary pass.

This design addresses four concrete failures in the current implementation:

1. Compression trigger decisions are based on internal token estimates of raw history instead of the fully formatted API payload.
2. Compression runs too late and too close to the target model limit.
3. Compression uses a one-shot summarization pass over an oversized middle segment, which can exceed the compression model's own context window.
4. Compression status can advance even when no shorter runtime context has actually been installed.

## 2. Non-Goals

This design does not attempt to:

1. change the persisted transcript format of every existing chat session immediately,
2. redesign the entire `AgentChat` architecture,
3. solve image storage compression or file attachment storage size,
4. introduce user-facing manual controls in the first implementation phase.

## 3. Current State

Current compression behavior is centered around:

- `src/main/lib/chat/agentChatContextService.ts`
- `src/main/lib/chat/agentChatUtilities.ts`
- `src/main/lib/compression/fullModeCompressor.ts`

### 3.1 Current Flow

1. `checkAndCompress()` runs before the main API call.
2. Compression need is determined from `calculateThreeComponentTokens()`.
3. If over threshold, `compressContextHistoryWithFullMode()` calls `FullModeCompressor.compressMessages()`.
4. `FullModeCompressor` now defaults to preserving recent messages plus tool replay integrity, applies structural trimming to oversized historical payloads, and only preserves first-message / first-skill anchors when explicitly enabled.
5. The resulting `context_history` is reused for subsequent API calls.

### 3.2 Current Problems

1. The threshold is computed from raw `Message[]` token counting, not the final replay payload.
2. `context_history` can still remain effectively identical to `chat_history` in sessions that have not yet crossed compaction thresholds, meaning no distinct compacted runtime view exists until compaction is applied.
3. Summary generation builds one huge concatenated prompt from the middle history.
4. Giant tool results can dominate token usage and make the summary prompt itself unsafe.
5. The runtime state machine currently allows `COMPRESSED_CONTEXT` to be emitted based on the branch taken, not on verified payload reduction.

## 4. Design Principles

### 4.1 Raw Transcript and Runtime Context Must Be Separate

OpenKosmos must stop treating the sendable model context as equivalent to persisted chat transcript.

The system will distinguish:

1. `chat_history`
   The authoritative persisted transcript.
2. `context_history`
   The session's current working context representation, which may contain compaction summaries and retained verbatim spans.
3. `runtime_context_view`
  A runtime-only derived final-send view rebuilt from `context_history` immediately before send. It is the exact message array that will be formatted and sent to the model after sanitization, collapse, pruning, and tool-pair repair. It is not a second persisted context state and must not be written to disk.

Only `runtime_context_view` should be used for payload budgeting.

### 4.2 Compression Must Be Multi-Stage

Compaction is not a single LLM action.

It must be a pipeline:

1. payload measurement,
2. deterministic structural reduction,
3. chunked semantic summarization,
4. post-compaction validation,
5. persistence of compaction metadata.

### 4.3 Pre-Overflow Compaction Is Mandatory

OpenKosmos should compact before reaching the hard model ceiling.

If the system waits until the session is already near or above the model limit, the compression request itself becomes unsafe and unreliable.

### 4.4 Start-Chat and Send Need Their Own Compaction Path

Oversized imported or resumed sessions must be evaluated before the next user turn is sent, but that work must happen inside the active start-chat / send loop rather than during standalone session initialization.

This is a separate workflow from in-turn pre-send compaction.

### 4.5 Compression Success Must Be Verified

A compaction attempt is only successful when:

1. a shorter or cheaper runtime context was produced,
2. tool-use/tool-result replay integrity remains valid,
3. the compacted runtime payload is within budget,
4. the compacted context is actually installed for the next request.

## 5. Target Architecture

## 5.1 New Concepts

### Runtime Context Snapshot

Introduce a derived runtime object produced on demand:

```ts
interface RuntimeContextSnapshot {
  sourceHistoryKind: 'chat_history' | 'context_history';
  messageCountBeforeFormatting: number;
  messageCountAfterSanitization: number;
  formattedPayload: any[];
  payloadTokens: number | null;
  estimatedPayloadTokens: number;
  largestContributors: RuntimeContextContributor[];
  issues: RuntimeContextIssue[];
}
```

This snapshot is runtime-only and must not be persisted. It is primarily used for decision-making, diagnostics, and exact payload budgeting.

### Compaction Artifact

Introduce explicit compaction metadata for persistence and debugging:

```ts
interface ContextCompactionArtifact {
  id: string;
  reason: 'soft-threshold' | 'pre-send' | 'cold-load' | 'overflow-recovery' | 'manual';
  createdAt: string;
  sourceMessageRange: {
    firstMessageId: string;
    lastMessageId: string;
  };
  summaryMessageId?: string;
  tokensBefore: number | null;
  tokensAfter: number | null;
  preservedRecentMessageIds: string[];
  droppedMessageIds: string[];
  strategy: 'structural-only' | 'chunked-summary' | 'hybrid';
}
```

This should not replace `chat_history`. If OpenKosmos later chooses to persist compaction artifacts for diagnostics, that metadata is separate from `runtime_context_view`, which remains runtime-only.

## 5.2 New Main Pipeline

### Step 1: Build Runtime Context View

Before every send:

1. sanitize incomplete or invalid tool-call history,
2. repair tool-use/tool-result adjacency,
3. collapse old replay-invalid noise,
4. build the formatted API payload,
5. count or estimate payload tokens.

This step should be reusable by:

- send-time preflight,
- loop-entry preflight for the next send,
- overflow recovery,
- diagnostics and future UI inspection.

`runtime_context_view` is a transient product of this step. It should be rebuilt from `context_history` when needed rather than stored as a persisted sibling field.

### Step 2: Decide Whether Compaction Is Needed

The decision must use payload-budget policy rather than raw-history thresholds.

Inputs:

- model max prompt tokens,
- reserved reply headroom,
- safety margin,
- payload tokens,
- current trigger reason.

Outputs:

- `none`,
- `soft_compaction`,
- `aggressive_compaction`,
- `hard_block`.

### Step 3: Deterministic Structural Reduction

This is the first actual reduction stage and must not depend on any LLM.

Operations:

1. collapse giant historic tool results,
2. replace old bulky `fetch_web_content`, `read_file`, search JSON, and shell output with bounded placeholders,
3. preserve recent verbatim turns,
4. preserve exact identifiers,
5. preserve the latest unresolved tool chain,
6. drop replay-invalid orphan tool results.

Expected output:

- a smaller `context_history` candidate,
- explicit dropped/preserved message lists for diagnostics.

### Step 4: Chunked Semantic Summarization

If the structural reducer alone is insufficient:

1. split summarizable history into bounded chunks,
2. summarize each chunk independently,
3. merge chunk summaries,
4. inject a synthetic summary message into the compacted history.

Required sections in the summary message:

1. Current user objective
2. Decisions made
3. Open TODOs
4. Constraints and rules
5. Exact identifiers
6. Recent active thread

This summary format should prioritize execution continuity over narrative completeness.

### Step 5: Validate Compacted Context

After compaction:

1. rebuild `runtime_context_view`,
2. recount payload tokens,
3. confirm replay validity,
4. compare before/after cost,
5. install only if the result is actually cheaper and valid.

If validation fails:

1. retry with a more aggressive prune policy,
2. if still unsafe, stop before the main API call and surface a specific chat error.

## 6. Trigger Design

## 6.1 Soft Trigger

Target: 70% to 75% of safe payload budget.

Purpose:

1. compact early while the compression model still has room,
2. keep long-running sessions healthy incrementally,
3. reduce the chance of giant one-shot compaction.

Action:

- structural reduction first,
- semantic compaction optional if still expensive.

## 6.2 Aggressive Pre-Send Trigger

Target: 82% to 85% of safe payload budget.

Purpose:

1. force compaction before the next call becomes dangerous,
2. guarantee reply headroom for tool-heavy turns.

Action:

- structural reduction,
- chunked summary if needed,
- validation required before send proceeds.

## 6.3 Loop-Entry Trigger

Historical note: an earlier version of this design proposed cold-load compaction on session open. That is no longer the desired runtime behavior because initialization-time compression can block renderer cache hydration behind hidden LLM work.

Trigger when the active `startChat` / send loop begins and the reconstructed payload is already above the soft threshold.

Purpose:

1. avoid immediate first-turn overflow,
2. keep session open fast while still protecting the next provider call.

Action:

- build runtime context snapshot,
- compact inside the active send path before the provider request,
- if needed, fall back to bounded overflow recovery after a provider rejection.

## 6.4 Overflow-Recovery Trigger

Trigger when the provider still rejects the payload with a prompt token overflow error.

Purpose:

1. serve as a bounded recovery path,
2. avoid infinite retry loops.

Action:

1. parse observed token counts from the provider error when available,
2. log top payload contributors,
3. run one explicit overflow-recovery compaction attempt,
4. retry the API call once.

## 7. Preservation Policy

## 7.1 Always Preserve Verbatim

1. current system prompt and tool schema context,
2. the last 2 to 4 user/assistant turns,
3. current replay branch after a user edit,
4. active unresolved tool chain,
5. exact identifiers such as file paths, URLs, ports, hashes, ids, timestamps.

## 7.2 Prefer Structural Collapse

1. `fetch_web_content` raw dumps,
2. large `read_file` outputs from older turns,
3. large search payloads,
4. old shell output already semantically consumed by later assistant summaries,
5. duplicate or stale tool outputs kept only for transcript continuity.

## 7.3 Never Leave Orphan Tool Results

If a tool-use message is removed from the runtime context, any dependent tool-result messages that become orphaned must also be removed or replaced in a replay-safe way.

This is a hard correctness requirement.

## 8. State Machine Changes

The chat status flow must become outcome-based.

Current problematic pattern:

```text
COMPRESSING_CONTEXT -> COMPRESSED_CONTEXT
```

This transition is currently branch-based.

New rule:

- `COMPRESSING_CONTEXT` means a compaction attempt is in progress.
- `COMPRESSED_CONTEXT` is emitted only after validated compacted context is installed.
- introduce `COMPACTION_SKIPPED` or internal diagnostics when a compaction attempt produces no installable result.

User-visible states can remain simple, but internal logging should distinguish:

1. attempted and applied,
2. attempted but ineffective,
3. attempted and failed,
4. skipped because no compaction needed.

## 9. Proposed Module Ownership

### `agentChatContextService.ts`

Will own:

1. orchestration of context preflight,
2. trigger evaluation,
3. compaction invocation,
4. validated installation of compacted context,
5. rebuilding the runtime-only final-send view from `context_history` before token gating and API dispatch.

Will no longer own only raw three-part token counting as the primary decision input.

### `agentChatUtilities.ts`

Will own reusable pure helpers for:

1. formatting exact runtime payload,
2. measuring payload tokens,
3. structural collapse helpers,
4. repair and validation utilities.

### `fullModeCompressor.ts`

Should either be replaced or refactored into a chunk-aware semantic summarizer.

Responsibilities after refactor:

1. summarize bounded message chunks,
2. merge summaries,
3. preserve required identifiers and recent context,
4. avoid building one giant summary prompt.

### New helper modules

Likely additions:

1. `agentChatRuntimeContextBuilder.ts`
2. `agentChatStructuralCompactor.ts`
3. `agentChatCompactionPolicy.ts`
4. `agentChatCompactionArtifacts.ts`

These names are suggestions, not strict requirements.

## 10. Rollout Plan

## Phase 1: Observability and Correctness

1. Add runtime payload token estimation based on formatted API messages.
2. Log largest payload contributors.
3. Make `COMPRESSED_CONTEXT` emission conditional on successful installation.
4. Add loop-entry preflight checks inside the active send path rather than during standalone initialization.

## Phase 2: Deterministic Reduction

1. Add structural reducer for oversized historical tool results.
2. Add giant-message placeholder replacement.
3. Add replay-safe orphan tool-result cleanup in the compaction path.
4. Add tests for oversized imported sessions.

## Phase 3: Chunked Semantic Compaction

1. Replace one-shot middle-history summary generation.
2. Add chunk split and merge pipeline.
3. Add summary validation and identifier preservation tests.
4. Add failure-mode fallback when chunk summaries still exceed budget.

## Phase 4: Persistence and UX

1. Persist compaction artifacts.
2. Add developer/debug inspect view for raw vs compacted runtime context.
3. Consider exposing manual compaction controls if needed.

## 11. Test Plan

Required tests:

1. payload token gating uses formatted API payload, not only raw history,
2. oversized loaded sessions do not compact during initialization; compaction starts only when the next send loop begins,
3. a giant historic tool result does not get sent verbatim after structural compaction,
4. chunked semantic compaction never builds a summary request above the configured summary budget,
5. tool-use/tool-result replay remains valid after compaction,
6. `COMPRESSED_CONTEXT` is only emitted after compacted context is applied,
7. overflow recovery retries at most once with explicit diagnostics.

## 12. Risks

1. More aggressive structural collapse can hide detail needed for niche follow-up turns.
2. Persisted compaction artifacts add complexity to session storage and migration.
3. Payload token counting may require provider-specific fallback logic.
4. Chunked summary quality may vary by model and prompt discipline.

These are acceptable tradeoffs because the current system fails catastrophically on oversized sessions, while the new system degrades more safely and observably.

## 13. Final Recommendation

The first implementation step should not be to improve the existing one-shot summary prompt.

The first implementation step should be to make OpenKosmos decide against the exact formatted runtime payload and introduce a deterministic structural reduction layer before any LLM-based compaction.

That change provides the highest leverage because it fixes both classes of failure:

1. missed trigger before overflow,
2. compaction LLM failure on already-oversized histories.
