# Postmortem: correctionRatio collapse after compression causes context overflow

<!-- Last verified: 2026-05-27 -->

**Date:** 2026-05-26 | **Severity:** P1 (agent unavailable, no recovery) | **Affected:** Any agent using API-anchored token estimation (Pillar 2) that triggers context compression mid-conversation.

## Symptom

Agent "Kobi" (claude-opus-4.7-1m-internal, 48 tools, 6 skills) received error: `prompt token count of 1163946 exceeds the limit of 936000`. The local estimator reported only 40,610 tokens (4.4% of context window), so compression was not triggered. Retry also failed with identical error.

## Root Cause

**`lastLocalEstimate` was stale (pre-compression) when `anchorTokenEstimate` computed the correction ratio, producing a ratio of 0.0289 instead of ~0.94.**

### The Bug

In `AgentChatContextService.checkAndCompress()`:

1. `calculateThreeComponentTokens()` is called to check if compression is needed → sets `lastLocalEstimate = 1,631,853` (the 15-message pre-compression estimate).
2. Compression runs, replacing context_history with 1 summary message.
3. The post-compression API call succeeds, API returns `usage.prompt_tokens = 47,097`.
4. `anchorTokenEstimate(47097)` computes: `correctionRatio = 47,097 / 1,631,853 = 0.0289`.

**The denominator is wrong.** `lastLocalEstimate` reflects the pre-compression context (15 messages), but `apiPromptTokens` reflects the post-compression context (1 summary). The ratio should compare apples-to-apples: post-compression local estimate vs post-compression API value.

### Consequence

With `correctionRatio = 0.0289`, all subsequent estimates are divided by ~34:
- After 4 Bing searches add ~290K chars of HTML to context
- Raw local estimate ≈ 1.4M tokens
- Corrected estimate = 1.4M × 0.0289 = **40,610** (reported as 4.4% usage)
- Actual API-side tokens = **1,163,946** (124% of limit)
- Compression threshold (40%) never triggered
- API rejects with 400

## Timeline (UTC 2026-05-26)

| Time | Event |
|------|-------|
| 14:24:12 | `checkCompressionNeeds`: totalTokens=2,177,560 (238%), triggers compression |
| 14:25:12 | Compression succeeds: 15 messages → 1 summary |
| 14:25:12 | Post-compression API call sent |
| 14:25:27 | API returns prompt_tokens=47,097; `anchorTokenEstimate` sets ratio=0.0289 |
| 14:25:27–14:26:19 | 4 Bing search tool calls execute, results written to context |
| 14:26:21 | `checkCompressionNeeds`: totalTokens=40,610 (4.4%) → no compression |
| 14:26:33 | API rejects: 1,163,946 > 936,000 |
| 14:26:33 | Overflow recovery triggers forced compaction retry |
| 14:26:59 | Retry: same estimate (40,610), same rejection (1,163,946) |

## Fix

**Refresh `lastLocalEstimate` after compression succeeds** by calling `calculateThreeComponentTokens()` immediately after `setContextHistory(compressedMessages)`:

```typescript
// agentChatContextService.ts, after line 488
this.deps.setContextHistory(compressionResult.compressedMessages);
this.deps.setLastUpdated(new Date().toISOString());

// Fix: recalculate so next anchorTokenEstimate compares apples-to-apples
await this.calculateThreeComponentTokens();

if (emitStatus) { ... }
```

This ensures `lastLocalEstimate` reflects the compressed context when the API response anchors the ratio, producing a sensible value (~0.94 instead of 0.03).

## Lessons

1. **Anchoring requires temporal alignment.** Any calibration mechanism that compares a local estimate against an external ground truth must ensure both values describe the same state. If state changes between estimation and anchoring, the calibration is meaningless.

2. **Scalar correction ratios are fragile.** A single ratio derived from one data point can be wildly wrong when content characteristics change (summary text vs raw HTML). Consider: decaying the ratio toward 1.0 over time, clamping to [0.3, 3.0], or re-anchoring after every API call.

3. **Safety bounds on correctionRatio would have prevented this.** If ratio were clamped to minimum 0.3, the estimate would have been 1.4M × 0.3 = 420K — still above the 40% threshold, triggering compression.

4. **Tool results should be token-budgeted.** 4 Bing searches returning full cleaned HTML (290K chars) is excessive. A per-tool-result truncation limit (e.g., 20K tokens) would reduce the blast radius of estimation errors.

## Related

- [Postmortem: Token estimation 42% undercount](postmortem-token-estimation-overflow.md) — the original Pillar 2 mechanism was introduced as a fix for that incident
- `src/main/lib/chat/agentChatContextService.ts` — `anchorTokenEstimate()`, `calculateThreeComponentTokens()`, `checkAndCompress()`
