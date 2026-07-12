# Postmortem: empty `mcp_servers` leaked ALL tools instead of none

<!-- Last verified: 2026-07-06 -->

**Date:** 2026-07-01 | **Severity:** P1 (agent tool boundary is a trust/permission boundary) | **Affected:** Any main agent (ChatAgent) whose `mcp_servers` is an empty array `[]` — most reachably, an agent whose MCP servers the user cleared in the Agent editor.

## Symptom

A user opened the Agent editor (`AgentEditingView` → MCP servers tab), **unselected every MCP server including built-in tools**, saved, then chatted with the agent. The agent still called tools (`bing_web_search`, `fetch_web_content`, `read_file`, `search_files`). Inspecting the agent's `agents/{id}/agent.json` showed `mcp_servers: []` — no servers configured — yet every built-in and connected MCP tool was still exposed to the model.

## The authoritative data model

The agent tool-selection contract (confirmed by the product owner; also documented in `DEFAULT_CHAT_AGENT`'s inline comment):

| Config shape | Meaning |
|---|---|
| `{ name: S, tools: [] }` | Use **ALL** of server `S`'s tools |
| `{ name: S, tools: [t1, t2] }` | Use **only** `t1`, `t2` from `S` |
| `S` **absent** from `mcp_servers` | `S` is **not used at all** |
| `mcp_servers: []` (no entries) | **No servers → no tools** |

`builtin-tools` is a normal server governed by these same rules. Crucially, deselecting every tool of a server **removes that server's entry** from the array (the editor does this) — it is *not* kept as `{ name: S, tools: [] }`, because an empty `tools` array is the "all tools" sentinel, the exact opposite. So clearing everything in the editor yields `mcp_servers: []`, which must mean **zero tools**.

## Root cause

`AgentChatPromptService.getCurrentAvailableTools()` inverted the empty-array case:

```ts
// BEFORE (agentChatPromptService.ts)
if (latestConfig.mcp_servers.length > 0) {
  const filteredTools: any[] = [];
  for (const serverConfig of latestConfig.mcp_servers) {
    // ...correct per-server filtering: tools:[] -> all of that server,
    //    tools:[a,b] -> only those; skip servers globally in_use:false
  }
  return filteredTools;
}
return allTools;   // ← BUG: empty mcp_servers falls back to EVERY tool
```

The per-server filter loop was correct. The bug was the `if (length > 0)` gate plus the `return allTools` fallback: an empty `mcp_servers` skipped the loop entirely and returned **all** tools. That treats "no servers configured" as "all servers configured" — a maximal privilege escalation of the agent's tool surface, and the precise inverse of the data model.

The likely origin of the mistake: conflating the two different empty arrays. Inside one entry, `tools: []` legitimately means "all tools of this server". Someone extended that "empty means all" intuition up one level to the whole `mcp_servers: []` array, where it means the opposite.

## Why it surfaced now (honest attribution)

**The buggy line is not new — it exists verbatim on `origin/main` and at this PR's merge-base.** This PR (`separate-agent-chat-data-model`) did **not** modify `agentChatPromptService.ts`, `agentChat.ts`, or the editor's selection/serialization logic (`AgentMcpServersTab.tsx` changed only a cosmetic `agentId`→`chatId` prop rename). So the fallback is a **long-standing latent bug**.

What made it reachable during this PR's testing was an **earlier fix in this same PR**: the "Agent editor Save no-op" fix (commit `5014452cd`). Before that fix, saving the editor routed through the profile-only `updateChatConfig`, which stripped inline agent edits on write — so unselecting-all was silently a no-op and `mcp_servers` never actually became `[]`. Once Save was correctly routed through the store-aware `updateChatAgent` path, unselecting every server finally **persisted** `mcp_servers: []` into the standalone agent store — and the model read that state and hit the dormant `return allTools`.

There is also a **latent coupling** worth recording: `createAgentFromConfigTool.buildChatAgent()` used to default OpenKosmos-brand agents created *without* an explicit `mcp_servers` argument to `[]`, while openkosmos defaulted to `[{ name: 'builtin-tools', tools: [] }]`. The OpenKosmos `[]` default was implicitly relying on the same `return allTools` bug to give the agent tools, and the openkosmos branch silently granted an all-tools surface the caller never requested. Both are addressed here — see "Resolved coupling" below: the default is now `[]` for **all** brands. The interactive "New Agent" UI is unaffected — it seeds `[{ name: 'builtin-tools', tools: [] }]` as a visible, user-adjustable pre-selection (see `CreateCustomAgentViewContent.tsx` and `DEFAULT_CHAT_AGENT`).

## Fix

Always run the per-server filter loop; never fall back to all tools. An empty (or undefined) `mcp_servers` naturally yields `[]`.

```ts
// AFTER
const configuredServers = latestConfig.mcp_servers ?? [];
const filteredTools: any[] = [];
for (const serverConfig of configuredServers) {
  const serverName = serverConfig.name;
  const selectedTools = serverConfig.tools || [];
  const globalServer = globalMcpServers.find((s) => s.name === serverName);
  if (globalServer && globalServer.in_use === false) continue;
  const serverTools = allTools.filter((t) => t.serverName === serverName);
  if (selectedTools.length === 0) filteredTools.push(...serverTools);          // {tools:[]} -> all of this server
  else filteredTools.push(...serverTools.filter((t) => selectedTools.includes(t.name)));
}
return filteredTools;   // empty mcp_servers -> [] -> no tools
```

Tests (`agentChatPromptService.test.ts`): the prior test *"returns all tools when agent config has no mcp_servers"* codified the bug and was inverted to *"returns no tools when agent config has an empty mcp_servers array"*. Added regression tests: undefined `mcp_servers` → `[]` (covers the `?? []` guard); a `{ name: 'builtin-tools', tools: [] }` entry → all builtin tools while a non-listed server is excluded.

## Resolved coupling: agent-creation default is now empty for all brands

`createAgentFromConfigTool.buildChatAgent()` previously defaulted `mcp_servers` to `[{ name: 'builtin-tools', tools: [] }]` for openkosmos and `[]` for OpenKosmos when the caller specified no servers. That openkosmos default silently granted an all-tools surface the caller never asked for, and it relied on nothing but convention. It has been changed so **both brands default to `[]`** (no servers → no tools), consistent with the runtime data model and with each other. An agent that was never granted any servers must start with zero tools; defaulting to builtin-tools is counter-intuitive and wrong. (`isOpenKosmos` is still used for the separate builtin-*skills* default, which is a distinct feature and unchanged.)

The interactive "New Agent" UI is unaffected and legitimately different: it seeds `[{ name: 'builtin-tools', tools: [] }]` for on-device agents as a **visible, user-adjustable** pre-selection in the editor's MCP tab (see `CreateCustomAgentViewContent.tsx` and `DEFAULT_CHAT_AGENT`), not a silent programmatic default.

## Third layer: the model still hallucinated tool use after the leak was fixed

After the two fixes above, live testing (agent "ABC", `mcp_servers: []`) confirmed **zero tools reached the API** — the decisive evidence being the session file: the assistant emitted `<function_calls><invoke name="bing_web_search">…</invoke></function_calls>` **as plain-text content** with `toolcalls=False`, no structured `tool_calls`, and no tool-result messages, then fabricated a plausible "based on the web search results, …" answer. Had a real tool been passed to the model, the SDK would have parsed a structured `tool_use` and the tool would have actually executed. Plain-text XML + invented results = the provisioning fix works, but the model still *believed* it had tools.

**Root cause of this layer:** `getGlobalSystemPrompt()` (`globalSystemPrompt.ts`) is fully static and takes no arguments. Every turn it unconditionally documents the entire builtin tool suite — `bing_web_search`, the `read_file`/`read_html`/`read_office_file` routing table, `execute_command`, `get_current_datetime`, etc. So even when the agent's real tool surface is empty, the prompt hands the model a detailed manual of tools it does not have, and the model dutifully "uses" them by imitation.

**Fix:** thread the actual available-tool count into the per-turn prompt assembly. `getCombinedSystemPromptForCurrentTurn()` now computes `getCurrentAvailableTools()` once and passes its length to `getCombinedSystemPromptForContext(availableToolCount?)`; when the count is exactly `0`, an authoritative `wrapInSystemReminder(NO_TOOLS_AVAILABLE_REMINDER)` is appended stating that no tools are available, that the tool descriptions elsewhere in the prompt do not apply, and that the model must not claim, emit, or fabricate tool use. `undefined` (non-send callers such as some token-estimation paths) preserves the prior behavior. This keeps the *estimated* and *sent* prompts in agreement because both flow through the async per-turn wrapper.

**Follow-up (known debt, out of scope here):** this reminder only covers the **zero-tools** case. The **partial** case — the agent has *some* tools but not the ones the static manual describes — is the same class of bug and can still cause the model to attempt an unavailable tool. Properly fixing it means making the 800+-line static tool manual in `globalSystemPrompt.ts` **dynamic** (render only the sections for tools actually available this turn). That is a larger, riskier change and is deliberately deferred; the zero-tools reminder addresses the reported, most common symptom (an agent deliberately stripped of all tools).

## Prevention / Lessons

- **`mcp_servers: []` is "no tools", not "all tools". Never `return allTools` on an empty allowlist.** An allowlist that is empty grants nothing. Treating empty as "everything" turns a security/permission boundary inside out. If you ever want a real "all tools" default, it must be represented *explicitly* as a `builtin-tools` (and/or per-server) entry, never inferred from emptiness.
- **Don't conflate the inner `tools: []` with the outer `mcp_servers: []`.** They are both empty arrays one nesting level apart and mean opposite things ("all of this server" vs "no servers"). Any code that reads either must be commented with which one it is.
- **A "fix" that restores a previously-broken write path can expose latent read-path bugs.** The editor Save no-op fix was correct, but by making saves actually persist it un-hid a dormant tool-leak. When you repair a persistence path, re-test the *consumers* of the newly-persisted state (here: what the model is actually handed), not just that the bytes landed on disk.
- **Test the empty/zero case of every allowlist explicitly.** The original test asserted the *wrong* behavior for the empty case and passed for years. An allowlist's "empty → nothing" invariant deserves a first-class test, not an incidental one.
- **A static system prompt that documents capabilities is itself a source of hallucination.** Correctly withholding a tool from the API is necessary but not sufficient: if the prompt still *describes* the tool, the model will imitate calling it (emitting tool-call syntax as text and inventing results). Keep the prompt's claimed capabilities in sync with the turn's actual tool surface — at minimum, tell the model when it has none.

## Related

- [Chat Engine](../src/main/lib/chat/ai.prompt.md) — `getCurrentAvailableTools` Gotcha
- `src/main/lib/chat/agentChatPromptService.ts` — the fix site (both the `getCurrentAvailableTools` provisioning fix and the zero-tools `NO_TOOLS_AVAILABLE_REMINDER` prompt fix)
- `src/main/lib/chat/globalSystemPrompt.ts` — the static tool manual that causes hallucination when tools are absent (partial-tools follow-up lives here)
- `src/main/lib/userDataADO/types/profile.ts` — `DEFAULT_CHAT_AGENT` (`tools: []` = all-tools sentinel comment)
- `src/renderer/components/chat/agent-editor/AgentMcpServersTab.tsx` — editor serialization (clearing a server removes its entry)
