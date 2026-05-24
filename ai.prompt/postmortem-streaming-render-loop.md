# Postmortem: Tool Args Streaming Render Loop & Preview Failure (v2.8.3)

<!-- Last verified: 2026-05-20 -->

## Incident Summary

Two related issues appeared in v2.8.3:
1. **"Maximum update depth exceeded"** — tool_call args streaming triggered a React render loop
2. **WriteFileToolCallView no streaming preview** — even when content chunks arrived, the preview never rendered

## Root Cause Chain

```
PR #663 (immer refactor) deleted adaptive batching
  → each IPC chunk synchronously triggered sessionListeners → React re-render
  → high tool_call chunk frequency + useSyncExternalStore synchronous scheduling = render loop
  → 26fd5040 restored batching via setTimeout(0), fixing issue 1
  → Issue 2 existed independently: JSON key order (content before filePath) + strict guard
```

## Lessons Learned

### 1. Implicit Performance Contracts Ignored During Refactoring

PR #663's immer refactor focused on "data immutability" but deleted seemingly unrelated adaptive batching logic. That batching was not an explicit interface but an implicit performance contract — the code had no comments explaining why it existed, so the refactorer treated it as dead code.

**Lesson:** Performance-critical code must have `// PERF:` comments explaining why it exists and what breaks if removed.

### 2. Insufficient Defensive Programming for Streaming Scenarios

`WriteFileToolCallView` assumed `filePath` always arrives before `content`. This holds for complete JSON, but in streaming partial JSON the key order depends on LLM output order, which is uncontrollable.

**Lesson:** Any component consuming streaming partial data must assume fields arrive in arbitrary order. Guard conditions should distinguish "data not yet ready" from "data will never arrive."

### 3. Asymmetric Protection Between Content and Tool Call Streaming

Content chunks have `StreamingV2Message`'s RAF throttle protection, naturally preventing loops. Tool call chunks had no equivalent protection and went through `useSyncExternalStore`'s synchronous path. This robustness gap between the two paths was not recognized.

**Lesson:** Different branches of the same data pipeline should have consistent throttling strategies. When adding a new streaming data type, the checklist should include "does it have render throttling?"

### 4. Hypothesis-Driven vs. Evidence-Driven Investigation

The initial investigation spent time theorizing "why the render loop happens" from first principles, rather than directly diffing v2.8.2 and v2.8.3. Once the user pointed out the version difference, the problem was located within minutes.

**Lesson:** For regression bugs, prefer `git bisect` / version comparison over first-principles reasoning. Ask "when did it start breaking?" before "why does it break?"

### 5. No Automated Tests for Streaming Intermediate States

No test verified "when tool_call args arrive as chunks, UI components render intermediate states correctly." Such scenarios are hard to cover with unit tests alone but can be tested with integration tests that mock IPC event sequences.

**Lesson:** For streaming UI components, at least one test case should simulate "fields arriving in batches."

## Checklist for Future Work

| # | Rule | Applies To |
|---|------|------------|
| 1 | Refactoring PRs must check whether deleted code serves a performance/throttling role | Any state management refactor |
| 2 | Streaming component guards must distinguish executing vs completed state | All ToolCallView components |
| 3 | When adding new streaming data paths, confirm render throttling exists | IPC → store → React chain |
| 4 | For regression bugs, bisect first — do not reason from scratch | Any "it worked before, now it doesn't" |
| 5 | Implicit performance contracts need `// PERF:` comments | batching, debounce, throttle code |
| 6 | Partial JSON consumers must assume arbitrary key order | All code using `parseStreamingJson` |
