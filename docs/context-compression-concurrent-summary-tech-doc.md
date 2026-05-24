# Context Compression Concurrent Summary Technical Design

> Version: 1.0.0 | Date: 2026-04-09

## 1. Overview

This document defines a performance-focused enhancement to the existing context compression flow.

The current compressor already provides:

1. token-bounded chunking,
2. structural pre-trimming,
3. recursive merge summarization,
4. bounded overflow fallback.

The enhancement in this document is intentionally narrow: add bounded concurrency to the first-layer conversation chunk summaries while preserving merge-stage sequential behavior.

## 2. Current State

`FullModeCompressor.summarizeMessagesRecursively(...)` currently performs:

1. chunk computation,
2. per-chunk summary calls in a sequential `for ... of` loop,
3. merge-message creation,
4. recursive merge summarization.

This means wall-clock latency is roughly the sum of all chunk summary latencies for the conversation stage.

## 3. Design Principles

### 3.1 Concurrency Must Be Bounded

The implementation must not use unbounded `Promise.all(...)` over all chunks. It must cap active work using a small worker pool.

### 3.2 Ordering Must Remain Stable

Merge summarization depends on a deterministic partial-summary order. The implementation must store results by original chunk index and reconstruct `partialSummaries` in-order.

### 3.3 Merge Remains Sequential

This rollout optimizes the largest latency source first. Merge-stage recursion remains sequential to avoid coupling performance work with a larger change in recursive execution semantics.

## 4. Proposed Changes

## 4.1 Configuration

Add `maxConcurrentChunkSummaries` to `FullModeCompressionConfig`.

Default: `3`

Semantics:

1. Applies only to `conversation` stage chunk summaries.
2. Ignored for `merge` stage summaries.
3. Clamped to at least `1`.

## 4.2 Execution Model

When `stage === 'conversation'` and there are multiple chunks:

1. Pre-allocate a results array sized to `chunks.length`.
2. Launch up to `maxConcurrentChunkSummaries` workers.
3. Each worker claims the next chunk index, builds conversation text, calls the summary API, and stores the result at the same index.
4. After all workers finish, create merge messages from the in-order results array.

When `stage === 'merge'`:

1. Keep the existing sequential loop.
2. Preserve the current recursion behavior unchanged.

## 4.3 Failure Behavior

If any worker fails, `Promise.all(workers)` rejects and the existing compressor-level fallback path remains responsible for degraded output.

No attempt is made in this change to cancel sibling in-flight chunk requests after the first failure. That is acceptable for the first rollout because:

1. concurrency is bounded,
2. helper retries remain local,
3. the compressor already treats any failed summary path as fallback-eligible.

## 5. Test Plan

Add tests that prove:

1. multiple conversation chunks can be active concurrently,
2. merge summaries remain sequential,
3. configured concurrency is respected as an upper bound,
4. existing token-budget and recursion tests still pass.
