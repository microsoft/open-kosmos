# Postmortem: Claude model token estimation 42% undercount causing context overflow

**Date:** 2026-05-10 | **Severity:** P1 (agent unavailable) | **Affected:** Agents using Claude Opus 4.7 1M with many tools (e.g. OPE Agent: 62 tools, 9 skills)

## Symptom
Users received the error "prompt is too long: 1,005,438 tokens > 1,000,000 maximum" when sending messages. The frontend context panel showed 708.6k/936k (75.7%), well below the 85% compression threshold, so compression never triggered.

## Root Cause

**Two failures compounded:**

1. **Token estimation systematically undercounts by 42%**: The local GPT tokenizer (cl100k_base/o200k_base) was used to estimate token counts for Claude models, but Claude's server-side tokenizer fundamentally differs from GPT's (708k × 1.42 = 1,005k). This is not an encoder-selection issue (cl100k vs o200k only differ by ~2%); the BPE vocabulary itself is different.

2. **Overflow recovery regex did not match**: `OVERFLOW_ERROR_PATTERNS` did not include Claude's API error format `"prompt is too long: N tokens > M maximum"`, so the overflow recovery branch never triggered and the error was surfaced directly to users.

**Why the estimation is 42% too low:**

| Factor | Bias Contribution | Notes |
|--------|------------------|-------|
| Claude vs GPT tokenizer difference | ~35% | Claude tokenizer produces more tokens for the same text; local BPE cannot simulate this |
| Missing VS Code Copilot overhead constants | ~5% | +3 per message, +3 completion, +8/+16 per tool, ×1.1/×1.5 safety factors |
| No output token reservation | ~2% | 85% threshold based on context_window rather than context_window − max_output |

**Why compression didn't trigger:**
```
Local estimate:    708,600 tokens
Context window:    936,000 (max_prompt_tokens)
Local ratio:       708,600 / 936,000 = 75.7% < 85% → no compression
Actual ratio:    1,005,438 / 936,000 = 107%   → overflow
```

## Timeline

| Date | Event |
|------|-------|
| Initial | Token calculation module created; `cl100k_base` hardcoded; no per-model handling. Primarily GPT models at the time; estimates were reasonably accurate. |
| Later | Claude model support introduced. Token calculation logic was not updated; it defaulted to reusing the GPT calculation path. |
| 2026-05-10 | User reports context overflow on OPE Agent (Claude Opus 4.7 1M, 62 tools). |

## Why It Happened

1. **Implicit assumption**: The token calculation module implicitly assumed all models share the same tokenizer characteristics. This holds for GPT models; for Claude models the error is 42%.
2. **No closed-loop validation**: The `usage.prompt_tokens` returned by every API call was never fed back into the estimation system. The longer the system ran, the larger the accumulated drift — but no alerting mechanism existed.
3. **Large context windows amplify the problem**: A 42% undercount on GPT-4 128k might not overflow (smaller absolute token counts, fewer conversation turns). Claude Opus 1M's enormous context window encourages long conversations to accumulate, which eventually triggers overflow.
4. **Overflow recovery was the last line of defense — and also failed**: Even with underestimation, overflow recovery was supposed to catch it. But the regex patterns were incomplete; Claude's specific error format slipped through.

## Why It Wasn't Caught

1. **No impact on GPT models**: The GPT tokenizer aligns with local estimates; error <5%; 85% threshold works correctly.
2. **Small Claude user base**: Most users used GPT models; test coverage for extreme Claude 1M scenarios was insufficient.
3. **No automated validation of token estimation accuracy**: No E2E tests compared local estimates against actual token counts returned by the API.
4. **Frontend display created false confidence**: Users saw 75.7% < 85% and believed there was room remaining, while the actual count was already overflowing.

## Fix

### P0: Overflow Recovery Regex (completed)
Added `/prompt is too long/i` to `OVERFLOW_ERROR_PATTERNS`. Ensures that even with underestimation, API overflow errors trigger forced compression and retry.

### P1: Three-Pillar Token Estimation Fix (completed)

| Pillar | Change | Effect |
|--------|--------|--------|
| **VS Code Copilot alignment** | Message overhead constants (+3/msg, +3 completion, +1 name), tool overhead (+16 base, +8/tool, ×1.1), tool_calls ×1.5, encoder read from CAPI | Estimate increases ~8.7% |
| **API Usage anchoring** | After each API response returns `usage.prompt_tokens`, compute `correctionRatio` and apply to subsequent estimates | Gap → ~0% after first API call |
| **Per-model correction factor** | Claude ×1.4, Gemini ×1.1 (preset used before first API call; overridden by anchoring afterwards) | Claude pre-first-call gap improves from −42% to +7% (conservatively high) |

### Output Token Reservation
`checkCompressionNeeds` now subtracts `min(maxOutputLength, 20000)` from context_window before computing the ratio, triggering compression earlier.

## Fix Effectiveness (Benchmarks)

OPE-scale scenario (100 turns, 62 tools, Claude Opus 4.7):

| Metric | Old Algorithm | New Algorithm (pre-first-call) | New Algorithm (post-anchoring) |
|--------|--------------|-------------------------------|-------------------------------|
| Local estimate | 74,516 | 113,412 | ≈ API value |
| vs API gap | **−42%** | **+7.2%** | **~0%** |
| Compression triggered | ❌ No | ✅ Conservatively | ✅ Accurately |

## Lessons Learned

### 1. Multi-model systems require per-model validation
> Supporting a new model is more than changing the API endpoint. Any logic involving token counting, context management, or rate limiting must validate whether the model's actual behavior matches existing assumptions.

### 2. Estimation systems must have closed-loop calibration
> Every API call returns a precise `usage.prompt_tokens`, but this signal was discarded. Any estimation system should close the loop with the authoritative data source: estimate → execute → compare actual → calibrate. Estimation without a feedback loop drifts silently.

### 3. Defense layers must not share the same assumption
> Both compression triggering (85% threshold) and overflow recovery (regex matching) depended on the same assumption — that local estimates are accurate. When that assumption failed, both layers of defense failed simultaneously. Correct approach: at least one defensive layer should rely on an independent signal (e.g., API error format matching).

### 4. Large context windows are a new risk surface
> A 1M context window is not just "a larger buffer." It changes user behavior (longer conversations, more tool calls), amplifies the absolute magnitude of estimation errors, and turns previously harmless bias into fatal overflow.

### 5. Frontend display should reflect uncertainty
> Showing "75.7% used" implies high precision. For estimates subject to model-specific bias, display an uncertainty range (e.g., "75–107%"), or add a warning indicator on models known to have significant bias.

## Regression Prevention

- [ ] Add CI tests: compare token estimation against known reference values for different models; assert deviation is within acceptable range
- [ ] Monitor `correctionRatio`: if a model's anchored ratio consistently deviates from the preset by >20%, trigger an alert to update the preset factor
- [ ] Overflow recovery regex: each time a new model provider is added, verify its error format is covered by `OVERFLOW_ERROR_PATTERNS`

## Changed Files

| File | Change |
|------|--------|
| `src/main/lib/chat/agentChatTurnRunner.ts` | P0 regex + usage passback |
| `src/main/lib/chat/agentChatContextService.ts` | Message overhead + anchoring + correction factor + output token reservation |
| `src/main/lib/chat/agentChatUtilities.ts` | `checkCompressionNeeds` adds `outputTokenReserve` |
| `src/main/lib/chat/agentChat.ts` | Per-model encoder selection + anchoring wiring |
| `src/main/lib/token/TokenCounter.ts` | VS Code Copilot overhead constants |
| `src/main/lib/token/calculators/ToolsTokenCalculator.ts` | +16/+8/×1.1 + key token recursion |
| `src/shared/types/ghcChatTypes.ts` | `GhcModelCapabilities` adds `tokenizer` |
| `src/main/lib/llm/ghcModelsManager.ts` | `getModelCapabilities` exposes `tokenizer` |
| `src/main/lib/chat/ai.prompt.md` | Design doc updated |
| Various `__tests__/` | 22 new tests added |
