# Postmortem: sub-agent fails on 2nd turn with 400 "Unknown parameter: 'input[N].tool_calls'"

<!-- Last verified: 2026-06-23 -->

**Date:** 2026-06-23 | **Severity:** P1 (every tool-using sub-agent on a `/responses` model fails) | **Affected:** Any sub-agent whose inherited model routes to the `/responses` endpoint — i.e. the GPT-5.x family — that makes at least one tool call.

## Symptom

User asked the parent agent "Kobi" (model `gpt-5.5`) to dispatch a sub-agent to research the latest trends in AI agents. The sub-agent launched, ran its first tool (`get_current_datetime`) successfully, then died on its second LLM turn. The task notification surfaced:

```
### adhoc-sa_178218465 (❌ Failed)
Duration: 4.6s | Turns: 1
Error: LLM API error (400): {"error":{"message":"Unknown parameter: 'input[2].tool_calls'.","code":"invalid_request_body"}}
```

This reproduced on every retry, for both ad-hoc spawns observed in the session (`sa_1782184376673_pgm69o`, `sa_1782184653654_efebtg`). The failure happened **before** any web search ran, so it was not a Bing / network / tool-permission problem.

## Evidence (dev log `openkosmos-dev-2026-06-23-11-16-52.log`)

| Line | Entry |
|------|-------|
| 2034 | `[SubAgentManager] Spawning ad-hoc sub-agent {"taskId":"sa_1782184653654_efebtg",...,"requestedTools":6}` |
| 2035 | `[SubAgentChat] Turn 1: calling LLM (model=gpt-5.5, contextMsgs=1, tools=6)` |
| 2074 | `[SubAgentLLMClient] Parsed tool call: id=call_…, name=get_current_datetime, argsValidJson=true` |
| 2076-2077 | `Tool 'get_current_datetime' executed successfully` |
| 2078 | `[SubAgentChat] Turn 2: calling LLM (model=gpt-5.5, contextMsgs=3, tools=6)` |
| 2079 | `ERROR [SubAgentLLMClient] LLM API error (400): … Unknown parameter: 'input[2].tool_calls'.` |
| 2081 | `Request context: model=gpt-5.5, endpoint=/responses, messageCount=4 … Last 3 messages roles: [user, assistant(+tool_calls:1), tool]` |

Line 2081 is the smoking gun: `endpoint=/responses` with an `assistant(+tool_calls:1)` message in the payload. `input[2]` is that assistant message.

## Root Cause

**`SubAgentLLMClient.callLLM()` sent `/chat/completions`-shaped messages to the `/responses` endpoint.**

The two GHC endpoints have incompatible wire formats for tool calls:

| | `/chat/completions` | `/responses` |
|---|---|---|
| Assistant tool call | `assistant` message with a `tool_calls[]` field | standalone `{ type: 'function_call', call_id, name, arguments }` item |
| Tool result | `{ role: 'tool', tool_call_id, content }` | `{ type: 'function_call_output', call_id, output }` item |

The sub-agent's `formatMessageForAPI()` always emits the `/chat/completions` shape (`assistant.tool_calls`, `role:'tool'`). For `/responses` it stuffed that array straight into `requestBody.input` with **no conversion**:

```ts
// BEFORE (subAgentLLMClient.ts)
if (endpoint === '/responses') {
  requestBody = { model, input: formattedMessages, ... }; // ← assistant.tool_calls leaks through
}
```

On turn 1 the context is a single `user` message, so the bug is invisible. The moment the sub-agent makes **any** tool call, turn 2's context contains an `assistant`+`tool_calls` message, and `/responses` rejects the unknown `tool_calls` parameter with 400.

### The deeper cause: forked wire-format logic

The main AgentChat transport already solved this. `agentChatUtilities.formatMessagesForApi()` calls `convertMessagesToResponseInput()` when `endpoint === '/responses'`, turning tool history into `function_call` / `function_call_output` items. The sub-agent transport (`SubAgentLLMClient`) is an **independent, lighter-weight reimplementation** that paralleled `formatMessagesForApi` but never ported the `/responses` conversion branch. Two copies of "format messages for the API", one missing a case = guaranteed drift.

### Why it surfaced now, not earlier

- Sub-agents **default to the parent's model**. "Kobi" runs `gpt-5.5`, which `getEndpointForModel()` routes to `/responses`.
- Sub-agents on `/chat/completions` models (e.g. older GPT-4-class / Claude-via-completions) never hit the bug, so it stayed latent.
- A sub-agent that returned a pure-text answer with no tool call also never hit it.
- The combination "(`/responses` model) x (>=1 tool call)" makes failure deterministic, which is exactly the common case for a research sub-agent told to call `get_current_datetime` first.

## Fix

1. New canonical module `src/main/lib/chat/responsesInputConverter.ts` owning `convertMessagesToResponseInput()` + `convertResponseMessageContent()` as the **single source of truth** for the `/responses` input shape. It accepts a minimal structural message type so both transports can feed it without coupling.
2. `SubAgentLLMClient.callLLM()` now converts for `/responses`:

```ts
// AFTER
if (endpoint === '/responses') {
  const responseInput = convertMessagesToResponseInput(
    formattedMessages as unknown as ResponsesConvertibleMessage[],
  );
  requestBody = { model, input: responseInput, ... };
}
```

3. Tests: `responsesInputConverter.test.ts` (all branches) and a regression test in `subAgentLLMClient.test.ts` asserting the `/responses` body contains `function_call` / `function_call_output` items and **no** item with a `tool_calls` field.

## Follow-up (known debt)

`agentChatUtilities.ts` still keeps its own private `convertMessagesToResponseInput`. It should be migrated onto the shared module so the two transports provably cannot diverge again. This was deliberately **not** done in the fix PR: `agentChatUtilities.ts` is a large file whose scoped branch coverage measured only ~85.5%, and the diff-aware per-file coverage gate (90% on all four metrics, empty allowlist) would have failed the moment the file was touched. Migrate it in a dedicated PR that also lifts that file's branch coverage to ≥90%.

## Prevention / Lessons

- **Do not fork API wire-format logic per transport.** A sub-agent transport that re-implements message formatting must reuse the same endpoint-conversion code as the main transport, or it will silently miss cases. One converter, two callers.
- **Test the multi-turn-with-tools path, not just turn 1.** Turn-1-only tests pass while a tool-call replay bug hides on turn 2. Any transport test must include an `assistant(+tool_calls)` + `tool` history against **both** endpoints.
- **`endpoint=/responses` + `assistant(+tool_calls)` in a 400 log = format-conversion bug**, not a model/tool/auth problem. The request-context error log (`Last 3 messages roles: […]`) is the fastest triage signal.

## Related

- [Sub-Agent System](../src/main/lib/subAgent/ai.prompt.md)
- [Chat Engine](../src/main/lib/chat/ai.prompt.md)
