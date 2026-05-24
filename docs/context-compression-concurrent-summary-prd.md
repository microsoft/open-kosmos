# Context Compression Concurrent Summary PRD

> Version: 1.0.0 | Date: 2026-04-09

## 1. Background

OpenKosmos currently compresses oversized chat context by splitting the summarizable middle history into token-bounded chunks and summarizing them through a dedicated LLM helper. This protects correctness and prompt-budget safety, but the current implementation executes every chunk summary sequentially.

For large sessions with many chunks, total compression latency scales almost linearly with the number of LLM calls. That is especially visible on oversized tool-heavy sessions where compression already sits on the active send path.

## 2. Problem Statement

We need to reduce end-to-end compression latency without weakening the existing correctness guarantees:

1. Each chunk must still remain within the configured prompt budget.
2. Merge summarization must remain bounded and deterministic.
3. Compression must still preserve stable output ordering and replay safety.
4. The optimization must not introduce unbounded provider fan-out or retry storms.

## 3. Goals

### 3.1 Primary Goals

1. Reduce wall-clock latency for large chunked compression workloads.
2. Preserve the exact chunk ordering semantics used by recursive merge.
3. Keep merge summarization behavior unchanged for the first rollout.
4. Bound concurrency so provider pressure remains controlled.

### 3.2 Secondary Goals

1. Make concurrency explicit and testable instead of relying on implicit scheduling behavior.
2. Keep the implementation local to `FullModeCompressor` without redesigning the helper contract.

## 4. Non-Goals

1. No change to compression trigger timing.
2. No change to initialization behavior.
3. No change to merge-stage recursion strategy in this iteration.
4. No redesign of the compression prompt template or helper retry policy.

## 5. Product Decision

OpenKosmos will use limited concurrency for the first-layer conversation chunk summaries only.

Specifically:

1. `conversation` stage chunk summaries may run concurrently.
2. `merge` stage summaries remain sequential.
3. Results must be reassembled in original chunk order before merge.
4. Concurrency must be bounded by configuration, with a conservative default.

## 6. Requirements

1. The compressor must never exceed the configured per-chunk prompt budget.
2. The compressor must preserve chunk result order exactly.
3. The compressor must cap active chunk summaries to a bounded concurrency limit.
4. The compressor must keep merge-stage recursion sequential in this rollout.
5. Existing fallback behavior must remain intact when any chunk fails.

## 7. Validation

The rollout is complete when:

1. Unit tests prove that multiple conversation chunks can be in flight concurrently.
2. Unit tests prove that merge-stage chunk summaries remain sequential.
3. Existing prompt-budget and recursion-depth tests continue to pass.
4. Chat-path regression tests still pass.
