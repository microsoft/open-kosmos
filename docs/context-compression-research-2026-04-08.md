# OpenKosmos Context Compression Research

Date: 2026-04-08

> Status note (2026-04-09): This document is historical design research, not the source of truth for current runtime behavior. The current implementation explicitly forbids standalone initialization-time compression. Compression must stay inside the active send / start-chat loop plus bounded overflow recovery inside that loop.

## Goal

This report answers three immediate questions:

1. Why did the oversized OpenKosmos session not trigger compression early enough and still overflow the API limit?
2. Why is the current `context_history` effectively uncompressed and unsafe to send to a compression LLM once it already exceeds the target model's context window?
3. What compression strategy should OpenKosmos adopt after studying Claude Code and OpenClaw?

It also includes a recommended OpenKosmos design for:

- proactive pre-overflow compression,
- safe send-path handling for already-oversized histories,
- multi-stage compression that does not depend on one all-or-nothing summarization call.

## Executive Summary

OpenKosmos currently has three structural problems:

1. Compression gating is based on OpenKosmos-side token estimation of raw `context_history`, system prompt, and tool schemas, but not the fully formatted API payload. This can miss real overflows, especially on edit/replay turns and tool-heavy sessions.
2. OpenKosmos compresses too late and too monolithically. Once a loaded history is already far beyond the model window, the compressor tries to summarize a huge middle segment in one LLM call, which can itself exceed the summary model's context limit.
3. Compression state/reporting is too optimistic. The runtime can enter a `compressing_context` or even `compressed_context` path without proving that a shorter, safe, replayable `context_history` was actually installed and is below a target budget.

The main design recommendation is:

- separate `chat_history` from `context_history` semantically,
- introduce a derived runtime-only `runtime_context_view` for API calls,
- compact by stages before overflow rather than after overflow,
- add a non-LLM emergency pruning layer before any LLM summarization,
- support loop-scoped compaction for oversized sessions before or during the next send attempt,
- budget against formatted API payload tokens, not only raw message objects.

## Part 1: OpenKosmos Current Behavior and Root Causes

### 1.1 Why the session did not trigger early enough

OpenKosmos currently documents compression at 85% of the context window, not 90%. The current logic lives in the chat engine path around:

- `src/main/lib/chat/agentChatContextService.ts`
- `src/main/lib/chat/agentChatUtilities.ts`
- `src/main/lib/compression/fullModeCompressor.ts`

The practical issue is not only the threshold value. The real problem is that the trigger signal is based on an internal token estimate that does not reliably match the final API payload size.

Observed issues:

1. The gate is computed from raw `Message[]` structures and auxiliary counts, not from the exact replay payload after formatting and sanitization.
2. Tool-heavy sessions can expand dramatically at API formatting time.
3. Edit-message replay is especially risky because the reconstructed replay payload can be much larger than the raw in-memory estimate.
4. Large tool outputs dominate token usage, but the compressor treats history structurally first and semantically second, so trigger timing can still be too late.

This means OpenKosmos can believe it is below threshold while the actual `/chat/completions` request is already unsafe.

### 1.2 Why `context_history === chat_history` is a problem

For the problematic session, `context_history` and `chat_history` are effectively the same large transcript. That implies OpenKosmos has not materialized a compacted runtime view yet. As a result:

1. The compressor receives the full oversized history.
2. `FullModeCompressor.generateSummary()` builds a single huge prompt by concatenating the middle messages into one `conversationText` string.
3. That summary prompt is then sent to `claude-haiku-4.5` without a pre-check that the summarization request itself fits the summary model context window.
4. If that call fails or becomes ineffective, OpenKosmos has no strong multi-stage fallback that guarantees a smaller usable runtime history.

So the user concern is correct: once the loaded history is already much larger than the target model limit, sending that same oversized history to a compression LLM is unsafe and can fail before compression can help.

### 1.3 Why the current compression architecture is brittle

OpenKosmos compression today has these characteristics:

1. One-shot summary generation over a large middle span.
2. Preservation rules based on message position and special tool-call patterns.
3. Tool-pair integrity repair after compression.
4. No true emergency prune-first stage.
5. No explicit distinction between archival history and runtime-send history.

That architecture breaks down on pathological sessions with:

- very large tool results,
- long imported histories,
- replay after user edit,
- repeated tool chains,
- tool results that should never be replayed verbatim once they have been semantically consumed.

## Part 2: Claude Code Research

Reference studied:

- `/Users/pumpedgechina/Downloads/claude-code-main (1).zip`

Key files examined:

- `src/query/tokenBudget.ts`
- `src/services/tokenEstimation.ts`
- `src/utils/conversationRecovery.ts`
- `src/commands/context/context.tsx`
- `src/types/logs.ts`
- `src/utils/collapseReadSearch.ts`

### 2.1 What Claude Code does well

Claude Code does not appear to rely on a single hidden automatic LLM summary pass over the whole prior conversation in the same way OpenKosmos currently does. Instead it uses a layered approach.

#### A. Accurate-or-better token accounting mindset

`src/services/tokenEstimation.ts` shows a strong bias toward counting against the actual provider API where possible:

- It calls Anthropic count-tokens APIs when available.
- It uses provider-specific handling.
- It adds conservative fallback heuristics for file types such as JSON.
- It explicitly documents that underestimation is dangerous.

This is materially better than relying only on generic local estimates.

#### B. Recovery-time transcript sanitation

`src/utils/conversationRecovery.ts` shows that on resume, Claude Code first repairs history before trying to continue:

- filters unresolved tool uses,
- filters orphaned thinking-only assistant messages,
- filters whitespace-only assistant messages,
- injects synthetic continuation or sentinel messages when needed.

This is important because it treats resume as a transformation step, not just a blind transcript reload.

#### C. Context collapse as a first-class concept

`src/types/logs.ts` contains persisted context-collapse commit and snapshot structures:

- `ContextCollapseCommitEntry`
- `ContextCollapseSnapshotEntry`

That means collapse is modeled as an explicit, restorable transformation over conversation history rather than an invisible mutation of the transcript.

#### D. API-view vs raw-view distinction

`src/commands/context/context.tsx` explicitly computes the context as seen by the API:

- applies compact boundary transforms,
- applies context-collapse projection,
- applies `microcompactMessages()` before analysis.

This is a critical design principle OpenKosmos should copy: the model-facing context must be inspectable and analyzable separately from raw history.

#### E. Collapse noisy read/search operations

`src/utils/collapseReadSearch.ts` shows a very practical policy: many read/search/memory operations are collapsed into concise groups instead of being preserved verbatim in history presentation.

That is especially relevant to OpenKosmos because giant tool outputs such as `fetch_web_content` or `read_file` results are exactly the kind of content that should often be compacted structurally before any semantic summarization step.

### 2.2 Limits of Claude Code for OpenKosmos reuse

Claude Code is not a drop-in blueprint for OpenKosmos.

Reasons:

1. It is optimized around Anthropic-style message flows and internal feature flags.
2. It relies heavily on explicit context-collapse/project-view machinery not currently present in OpenKosmos.
3. Its strongest contribution is architectural separation, not a ready-made OpenKosmos compaction algorithm.

### 2.3 Main lessons OpenKosmos should borrow from Claude Code

1. Separate raw transcript from API-view context.
2. Make collapse/compaction a persisted, inspectable transformation.
3. Sanitize and repair history before resume/start-chat.
4. Collapse noisy read/search/tool-output history structurally before invoking any summarization model.
5. Count tokens against the real provider payload whenever possible.

## Part 3: OpenClaw Research

Reference studied:

- `/Users/pumpedgechina/repos/OpenClaw`

Key files examined:

- `src/config/types.agent-defaults.ts`
- `src/agents/compaction.ts`
- `src/agents/compaction.test.ts`
- `src/agents/pi-extensions/compaction-safeguard.ts`
- `src/agents/pi-embedded-runner/compact.ts`
- `src/agents/pi-embedded-runner/run.ts`
- `src/agents/pi-embedded-runner/compaction-runtime-context.ts`

### 3.1 OpenClaw has a much more mature compaction pipeline

OpenClaw clearly treats compaction as a formal subsystem, not a helper.

The config surface alone is much richer:

- compaction mode,
- reserve tokens,
- keep recent tokens,
- reserve floor,
- max history share,
- recent turns preserve,
- identifier preservation policy,
- quality guard retries,
- model override,
- timeout,
- truncate-after-compaction,
- memory flush before compaction.

This is much closer to what OpenKosmos needs for long-running sessions.

### 3.2 Key OpenClaw design ideas

#### A. Compaction is budget-driven, not only threshold-driven

OpenClaw reasons in terms of:

- context window,
- reserved generation headroom,
- maximum share of context allowed for retained history,
- minimum recent-context preservation.

This is superior to a single percent threshold because it optimizes for a safe send budget instead of just asking whether history is "large".

#### B. Non-LLM pruning comes before or alongside summarization

In `src/agents/compaction.ts`, OpenClaw has:

- `pruneHistoryForContextShare()`
- `splitMessagesByTokenShare()`
- `chunkMessagesByMaxTokens()`
- `summarizeWithFallback()`
- `summarizeInStages()`

Important consequence:

OpenClaw can drop older chunks until retained history fits a bounded share of the context window, and only then summarize what was dropped.

That is exactly the opposite of OpenKosmos's current failure mode.

#### C. Staged summarization rather than one huge summary call

`summarizeInStages()` splits history into token-bounded chunks, summarizes each chunk, then merges partial summaries.

This avoids the fundamental OpenKosmos issue where a single giant summary prompt can itself overflow the summary model.

#### D. Conservative safety margin

OpenClaw explicitly uses a `SAFETY_MARGIN = 1.2` to compensate for token estimation inaccuracy.

OpenKosmos currently lacks a similar strong guard.

#### E. Oversized-message fallback

OpenClaw has `isOversizedForSummary()` and fallback logic in `summarizeWithFallback()` for cases where individual messages are too large to summarize safely.

That is highly relevant to giant tool results like the 335k-character `fetch_web_content` block found in the problematic OpenKosmos session.

#### F. Tool-pair integrity is preserved during pruning

OpenClaw tests explicitly cover orphaned tool-result removal when the matching tool-use gets dropped. This is not treated as an incidental cleanup; it is a core correctness invariant.

This is directly aligned with OpenKosmos needs.

#### G. Overflow recovery compaction exists

In `src/agents/pi-embedded-runner/run.ts`, OpenClaw detects context-overflow errors from the provider and can run explicit overflow compaction with diagnostics and attempt limits.

That gives it a second line of defense even if pre-send compaction missed something.

### 3.3 Why OpenClaw is the stronger reference for OpenKosmos

Compared with Claude Code, OpenClaw is much closer to the exact OpenKosmos problem:

- long-running agent sessions,
- tool-heavy transcripts,
- actual automatic compaction,
- overflow-trigger recovery,
- configuration for different budgets and retention policies,
- staged summarization with pruning fallback.

## Part 4: Recommended OpenKosmos Compression Strategy

## 4.1 Design Principles

OpenKosmos should adopt five principles.

### Principle 1: `chat_history` is archive, `runtime_context_view` is sendable context

Do not treat `context_history` as just a second mutable copy of `chat_history`.

Instead define three layers:

1. `chat_history`
   Full persisted transcript.
2. `context_history`
   Current working context state for the session, may include compaction markers or summaries.
3. `runtime_context_view`
   A runtime-only derived final-send view built from `context_history` after replay sanitization, collapse projection, tool-pair repair, and emergency pruning. It should not be persisted as a second context state.

Compression decisions must be made against `runtime_context_view`, not raw transcript objects.

### Principle 2: Pre-send compaction must have two phases

Every send should run:

1. Structural reduction phase, non-LLM
2. Semantic summary phase, LLM

Structural reduction should be able to reduce token load even if the summarizer is unavailable or the summary prompt would overflow.

### Principle 3: Resume/start-chat must support "cold compaction"

When loading a session whose history already exceeds safe budget, OpenKosmos must compact before the first new user turn is sent.

This should happen during session load or at latest before `start chat` issues the next API call.

### Principle 4: Budget against the target payload and the summary payload separately

OpenKosmos needs two independent budgets:

1. send budget for the main model,
2. summary budget for the compaction model.

A history can be too large for the summary model even before it is sent to the main model. That must be checked explicitly.

### Principle 5: Compression success means "new safe context installed"

Compression should only be considered successful if all of the following are true:

1. the resulting runtime history is shorter or otherwise cheaper,
2. tool pairing remains valid,
3. the estimated formatted payload is below target budget,
4. the compacted view is actually installed and used for the next API call.

## 4.2 Proposed OpenKosmos Pipeline

### Stage 0: Build exact replay payload and token stats

Before any send:

1. Build the exact formatted API payload candidate.
2. Count or estimate tokens on that payload.
3. Include system prompt, injected knowledge, tool schemas, attachments, and formatted tool results.
4. Record the top N largest contributors by message and by tool result.

Output:

- `payloadTokens`
- `historyTokens`
- `systemTokens`
- `toolSchemaTokens`
- `largestMessages[]`

This must replace the current raw-only gating logic.

### Stage 1: Structural emergency pruning, non-LLM

If payload exceeds soft threshold, run a deterministic reducer before any summary LLM call.

Reducer rules:

1. Collapse old read/search/file-fetch/web-fetch outputs into compact placeholders plus metadata.
2. Drop or truncate obsolete giant tool results that are already followed by assistant synthesis.
3. Preserve only a bounded recent suffix of verbatim turns.
4. Preserve the latest unresolved task chain.
5. Preserve tool-use/tool-result integrity.
6. Remove orphaned or replay-invalid tool blocks.

This phase should be enough to prevent the compaction LLM from receiving a hopelessly oversized prompt.

### Stage 2: Chunked semantic summarization

For remaining old history that is still expensive:

1. Split summarizable messages by token-bounded chunks.
2. Summarize each chunk individually with a dedicated summary model budget.
3. Merge chunk summaries into a final compact summary.
4. Inject explicit sections such as:
   - Current goal
   - Decisions made
   - Important constraints
   - Open TODOs
   - Exact identifiers
   - Recent active thread

Do not concatenate the entire middle history into one summary prompt.

### Stage 3: Post-summary safety check

After compaction:

1. rebuild the formatted API payload,
2. recount tokens,
3. if still above budget, run an additional prune pass,
4. if still above hard budget, block the send and show a specific user-visible error with actionable options.

### Stage 4: Persist compaction metadata if needed

Persist compaction metadata separately from transcript messages.

This recommendation applies to optional compaction artifacts only. It does not mean `runtime_context_view` itself should be stored.

Suggested structure:

- compaction id
- source message boundaries
- summary text
- preserved recent range
- top dropped message ids
- reason (`soft-threshold`, `resume-load`, `overflow-recovery`, `manual`)
- tokens before/after

This lets OpenKosmos:

- debug compaction,
- inspect the compacted view,
- recover or replay safely,
- avoid repeated re-compaction of the same span.

## 4.3 Trigger Strategy for OpenKosmos

Use multiple triggers instead of a single 85% or 90% threshold.

### Trigger A: soft pre-compaction

Trigger when formatted payload reaches 70% to 75% of safe budget.

Purpose:

- reduce early,
- avoid giant one-shot compaction,
- keep the summary input small enough for the compaction model.

### Trigger B: aggressive pre-send compaction

Trigger when formatted payload reaches 82% to 85% of safe budget.

Purpose:

- enforce structural pruning and staged summarization,
- ensure the next API call has meaningful headroom.

### Trigger C: loop-entry compaction

Historical note: the original research proposed cold-load compaction on session open. The current implementation deliberately does not do this because initialization-time compression can block session hydration and leave the renderer stuck behind hidden LLM work.

Current direction:

- do not compact during session initialization,
- compact only when entering the active send / start-chat loop,
- if the next send detects an oversized payload, handle it inside the loop before the provider call or via bounded overflow recovery.

### Trigger D: overflow recovery compaction

If the provider still returns a context overflow error:

1. parse observed token count if available,
2. log diagnostics,
3. run one explicit overflow-recovery compaction attempt,
4. retry once with the compacted runtime view.

This should be bounded and visible in logs.

## 4.4 What to preserve verbatim

Recommended OpenKosmos preservation policy:

1. system prompt and active tool schema context,
2. last 2 to 4 user/assistant turns verbatim,
3. latest unresolved tool chain verbatim,
4. exact identifiers:
   file paths, ids, hashes, URLs, ports, timestamps, branch names,
5. user-edited message and all descendant turns in the current replay branch.

Do not preserve giant old tool outputs verbatim just because they were once important.

## 4.5 What to collapse aggressively

Recommended collapse candidates:

1. `fetch_web_content` raw page dumps,
2. repeated `read_file` outputs for large files,
3. large search result JSON payloads,
4. old successful shell output that has already been summarized by the assistant,
5. duplicate tool results replayed only for transcript continuity.

For these, OpenKosmos should store a compact artifact like:

- tool name,
- source reference,
- checksum or size,
- one-paragraph semantic summary,
- optional extracted identifiers.

## 4.6 Proposed fallback ladder

OpenKosmos should use this strict ladder.

1. Measure exact formatted payload.
2. If above soft budget, run structural collapse.
3. If still above soft budget, run chunked semantic compaction.
4. If any chunk is too large for summary, split again.
5. If single messages are still too large, replace them with bounded placeholders plus extracted metadata.
6. Rebuild payload and remeasure.
7. If still above hard budget, reject send with a clear message instead of making a doomed API call.

## Part 5: Concrete Recommendations for the Three User Questions

### Question 1

Why did this huge token session not trigger earlier compaction?

Answer:

Because OpenKosmos currently gates compression on internal token estimation of raw message structures instead of the exact API payload, and it only checks close to send time. In tool-heavy or replay-heavy sessions, that can underestimate the real prompt size and delay compaction until the history is already unsafe.

### Question 2

Why is it a problem that `context_history` and `chat_history` are the same and then compaction is attempted?

Answer:

Because OpenKosmos ends up asking the summary LLM to process essentially the same oversized transcript that already broke the main-model budget. Without pre-pruning and chunking, the compaction request itself can exceed the summary model's context limit and fail before it can reduce anything.

### Question 3

How should 90%-style trigger compaction and start-chat loading be optimized?

Answer:

Do not rely on a single high threshold. Introduce:

1. soft pre-compaction at 70% to 75%,
2. aggressive pre-send compaction at 82% to 85%,
3. loop-entry compaction for oversized sessions when the next send begins,
4. overflow-recovery compaction after provider rejection,
5. staged chunk summarization with non-LLM pruning first.

## Part 6: Suggested OpenKosmos Implementation Plan

### Phase 1: correctness and observability

1. Build token accounting against formatted API payload.
2. Add diagnostics for largest payload contributors.
3. Add explicit distinction between archive history and runtime API view.
4. Make compression success depend on installed safe output.

### Phase 2: safe deterministic reduction

1. Add structural collapse rules for giant tool results.
2. Keep compression out of session initialization and perform it only inside the active send path before first send or via bounded overflow recovery.
3. Add emergency prune path before LLM summarization.
4. Add oversize-single-message fallback placeholders.

### Phase 3: staged semantic compaction

1. Replace one-shot middle-history summarization with chunked summarization.
2. Merge partial summaries.
3. Preserve exact identifiers and recent unresolved task chain.
4. Add quality validation for summaries if needed.

### Phase 4: persistence and UX

1. Persist compaction metadata separately.
2. Add a context-inspect view for "raw history vs runtime compressed view".
3. Add user-visible reasons for compaction: load, pre-send, overflow recovery, manual.
4. Optionally support manual "compact now".

## Final Recommendation

If OpenKosmos only takes one idea from this research, it should be this:

Never let a full oversized transcript be the direct input to the compaction LLM.

The correct sequence is:

1. build exact runtime payload,
2. structurally prune first,
3. summarize in bounded chunks,
4. validate the compacted runtime view,
5. only then send to the main model.

Claude Code contributes the architectural lesson of separating raw history from API-visible context and making collapse inspectable. OpenClaw contributes the stronger operational blueprint: budget-driven compaction, staged summarization, deterministic pruning, overflow recovery, and configuration-rich safeguards.

OpenKosmos should combine those two ideas into a dedicated context-management subsystem instead of continuing with a single mutable `context_history` plus one-shot summary compression.
