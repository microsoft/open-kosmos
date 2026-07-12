# Memex Memory Instructions Integration Plan

## Goal

Integrate the useful operating lessons from `llm-wiki` into OpenKosmos Memex Memory without copying the `raw/` source model or building a large memory-management framework.

OpenKosmos is a local Electron client app. All validation and trusted path resolution happen in the Electron main process, not on a remote server. Memex cards should store distilled long-term memory only, with local main-process-validated provenance pointing back to existing OpenKosmos surfaces:

- chat sessions
- agent knowledge files
- session deliverables

V1 should solve one problem well: let the agent safely capture durable, locally sourced knowledge into Memex through a high-level operation.

## V1 Cutline

Keep V1 small.

### In scope

- Add a high-level `capture` action/operation to the existing Manage-Memory / `memex_memory` tool.
- Support `remember`, `update`, and `correct`.
- Support `current-agent` memory by default.
- Optionally support tightly gated `profile-memory` writes for explicit user preferences, constraints, and corrections.
- Validate source paths and chat-session anchors in the Electron main process.
- Reject sub-agent memory mutations (`capture` and `archive`); sub-agents may use read-only memory operations.
- Inject Memex instructions dynamically only when `memex_memory` is available.
- Make `capture` the only V1 memory-write action exposed through Manage-Memory.

### Not planned

- Structured conflict database.
- `mark-conflict` / `resolve-conflict` modes.
- Conflict truth tables, `conflict_blocks_current_answer`, and `hasNewDurableEvidence`.
- Symmetric multi-card conflict mutation.
- Capture-ready home markers.
- `repair-needed`, `repair-reserved-metadata`, and `rebuild-capture-marker` operations.
- Legacy home migration tools.
- Graph relation ownership / relation trust framework.
- Append provenance ledgers.
- Public `message:user:{id}` anchor authoring by the model.
- File content hashing as the default freshness proof.
- Multi-file transaction semantics.
- Raw `write` / `retro` memory-write actions.

If the agent detects conflicting memories in V1, it should not write a structured conflict. It should report the conflict candidate with citations and ask the user when the answer depends on it. After the user decides, the agent can use `correct` or `update` to record the chosen memory.

### Keep but simplify

| Area | V1 handling |
|---|---|
| Source freshness | Recheck that the resolved source still exists, is still a regular file, and is still under the allowed root immediately before writing. Do not add default content hashing or size-threshold streaming logic. |
| Cancellation | Support only the important boundary: cancellation before the card write starts returns cancelled; once the write starts, a successful write returns success. Do not design custom abortable lock queues unless existing infrastructure requires it. |
| Current user message id | Pass the persisted initiating user message id as immutable per-call context when it is clearly available. Other retry/regeneration/steering cases fail closed instead of inventing anchors. |
| Profile-memory | Keep optional and narrow. If implemented, accept only explicit user preference/constraint/correction from chat-session evidence with `profile_intent_quote`; otherwise do not implement profile-memory writes. |
| Malformed cards | Do not append to malformed cards. Read paths may warn and explicit read may show raw content. Do not build a full repair framework. |
| Logical provenance fields | Store best-effort fields such as `source_relpath`, `source_chat_id`, `source_chat_session_id`, `source_agent_id`, and `source_agent_name` when cheaply derivable. They are metadata, not a migration/revalidation system. |

## Design Principles

1. **No raw source layer.** Do not create or maintain a separate `raw/` tree. Existing OpenKosmos files are the source of truth.
2. **Capture distilled memory only.** Cards should store durable decisions, constraints, preferences, corrections, concepts, and useful project context.
3. **Main process owns provenance.** The model may describe a source, but Electron main-process code resolves and validates local paths.
4. **Current-agent by default.** Current-agent memory belongs to the memory owner agent bound to the chat.
5. **Profile-memory is a scope, not a source.** Use it only for stable cross-agent user preferences, constraints, and corrections backed by explicit user chat evidence.
6. **Query before capture.** Agents should recall/search memory before answering when prior context may matter.
7. **Capture through an explicit Manage-Memory action.** V1 `capture` is an action/operation inside the existing parent-chat Manage-Memory / `memex_memory` tool call, not a separate tool and not a post-stream background extractor. It writes only from evidence that already exists when the tool call runs.
8. **Append, do not rewrite.** `update` and `correct` append deterministic sections. The service must not ask an LLM to rewrite card bodies.

## Source Model

Use only these source types in V1:

| `source_type` | Caller input | Stored source | Notes |
|---|---|---|---|
| `chat-session` | Omit `source` for the current chat session. | Canonical persisted chat session JSON path. | V1 supports the current initiating persisted user message as the anchor. |
| `knowledge-file` | Absolute path under the memory owner agent's configured knowledge root, or `@knowledge-base:{relative_path}`. | Canonical absolute path. | Current-agent only in V1. |
| `session-deliverable` | Absolute path under the current chat session deliverables/workspace directory, or `@chat-session:{relative_path}`. | Canonical absolute path. | Use for PRDs, tech docs, plans, reports, or other files already saved in the session workspace. |

Do not expose these as source types in V1:

- `agent-output`
- `user-correction`
- `profile-memory`
- `manual`

Corrections are capture modes, not source types. A correction should cite the chat session, knowledge file, or session deliverable that contains the corrective evidence.

## Capture Operation

Add:

```ts
operation: "capture"
```

This is an action/operation inside the existing Manage-Memory / `memex_memory` tool. Do not register a separate `capture_memory` / `memex_capture` tool in V1.

Recommended logical input:

```ts
{
  operation: "capture";
  description: string;
  scope?: "current-agent" | "profile-memory";
  mode?: "remember" | "update" | "correct";
  title?: string;
  body?: string;
  slug?: string;
  category: "decision" | "constraint" | "preference" | "correction" | "concept" | "entity" | "deliverable" | "process" | "project-context";
  tags?: string[];
  source_type: "chat-session" | "knowledge-file" | "session-deliverable";
  source?: string;
  source_anchor?: "message:user:latest";
  profile_intent_quote?: string;
  related_slugs?: string[];
}
```

Keep the public shared tool JSON schema backward-compatible: top-level `required` should remain `["operation", "description"]`. Capture-specific fields are runtime-required only when `operation === "capture"` and should fail with structured hints.

### Execution model

V1 `capture` is a Manage-Memory / `memex_memory` tool action, not a local background job and not a separate tool.

Architectural choice:

- Use the existing Manage-Memory tool for V1 because the model can decide what is worth remembering while it is reasoning about the user's request, and one memory tool surface avoids duplicating permissions, prompt guidance, and dispatch code.
- Tool execution already has the right lifecycle, permissions, cancellation, and error reporting.
- The Electron main process can validate provenance at the Manage-Memory dispatch boundary before writing memory.
- Do not add a local background extractor. It would need another selection policy, duplicate-control loop, and user-intent heuristic, and it is more likely to over-capture.

The tool call can cite only evidence that exists when the call executes:

- the current persisted user message in the current chat session
- an existing knowledge file
- an existing session deliverable

It does not capture streaming assistant text or the final assistant response directly. If generated output should later become memory, persist that output through an explicit existing flow first, such as saving a normal session deliverable, then a later `capture` call may cite that file.

### Mode behavior

| `mode` | Required fields | Behavior |
|---|---|---|
| `remember` | `title`, `body`, `category`, `source_type`; `source` required for file-backed sources | Create a new active card. Reject existing slug/title unless this is an idempotent retry of the same capture. |
| `update` | `body`, `category`, `source_type`, plus `slug` or unique title match | Append a dated `## Updates` entry to an existing active/legacy card. |
| `correct` | `body`, `category`, `source_type`, plus `slug` or unique title match | Append a dated `## Corrections` entry to an existing active/legacy card. |

V1 does not support relation mutation through updates/corrections. `related_slugs` is allowed only when creating a new card.

## Main-Process Capture Context

`capture` must run only through the internal detailed execution path. The string-returning compatibility API must reject `operation: "capture"` before source resolution or mutation because it cannot preserve successful-write metadata.

Use an immutable per-call context:

```ts
interface MemexCaptureSourceContext {
  userAlias: string;
  chatId: string;
  chatSessionId?: string;
  isSubAgent?: boolean;
  canAskUser?: boolean;
  chatSessionFilePath?: string;
  chatSessionFilesPath?: string;
  chatHistory?: ChatSessionFile["chat_history"];
  currentUserMessageId?: string;
  ensureChatSessionSaved?: () => Promise<void>;
  abortSignal?: AbortSignal;
  reportActivity?: () => void;
  skipPersistence?: boolean;
  knowledgeBasePath?: string;
  sourceAgentId?: string;
  sourceAgentName?: string;
}
```

Rules:

- Do not use process-global mutable "current tool context" state for Memex capture.
- Resolve this context lazily for `capture` only; read-only memory operations do not need chat-session provenance fields.
- Reject `capture` and `archive` when `isSubAgent === true`.
- For current-agent memory, resolve one memory owner agent id and use it consistently for memory home, knowledge root validation, prompt guidance, and provenance fields.
- If the chat has no resolvable current-agent memory owner, current-agent `capture` should fail with a structured hint.
- For profile-memory, key the home by `userAlias`, not by agent id.

## Source Validation

### Shared validation

Before writing:

1. Resolve the source in the Electron main process.
2. Canonicalize allowed roots and candidate source paths.
3. Require file-backed sources to be regular files under their allowed roots.
4. Reject missing roots, relative roots, directories, special files, and paths outside the allowed root.
5. Store the canonical absolute path in frontmatter field `source`.

Use canonical path containment checks after resolution; do not trust raw string prefix checks.

### `chat-session`

V1 supports only the current initiating persisted user message:

- Omitted `source` resolves to `chatSessionFilePath`.
- Omitted `source_anchor` or explicit `message:user:latest` resolves to `currentUserMessageId`.
- If `currentUserMessageId` is missing, reject with a hint to cite a knowledge file or session deliverable.
- `ensureChatSessionSaved()` must complete before writing a chat-session-backed card.
- After the save barrier, parse the persisted chat JSON and confirm the user message id still exists with role `user`.

Do not expose arbitrary `message:user:{id}` authoring to the model in V1. Internal code may store the resolved canonical anchor as `message:user:{id}`.

### `knowledge-file`

Resolve against the memory owner agent's configured knowledge root:

```ts
agent.knowledge?.knowledgeBase ?? agent.knowledgeBase
```

Do not silently substitute another standardized knowledge path unless that is the configured path.

### `session-deliverable`

Resolve against the current chat session deliverables/workspace directory. Build this from the actual chat session id, not the current calendar month.

`capture` does not require creating a raw source file first. It can write a Memex card directly when the source evidence already exists in the current chat session, a knowledge file, or an existing session deliverable. This is provenance, not a separate `raw/` source layer. V1 does not run a background job to extract memory from assistant streaming output.

## Profile Memory Gate

`profile-memory` writes are optional in V1. If included, keep them narrow:

- `source_type` must be `chat-session`.
- Category must be `preference`, `constraint`, or `correction`.
- The anchored user message must contain explicit user intent for profile-level memory.
- The caller must provide `profile_intent_quote`.
- The quote is used only for validation and must not be persisted as raw input.

Reject profile-memory captures from `knowledge-file` and `session-deliverable` in V1.

## Card Shape

Recommended frontmatter for capture-created cards:

```yaml
---
title: Example Decision
created: 2026-07-07
modified: 2026-07-07
source_type: chat-session
source: /absolute/path/to/chat-session.json
source_anchor: "message:user:abc123"
source_anchor_validation: validated
source_chat_id: chat-id
source_chat_session_id: chatSession_20260707120000_device_random
source_relpath: chat-id/202607/chatSession_20260707120000_device_random.json
source_agent_id: agent-id
source_agent_name: Agent Name
provenance: validated
capture_validation: memex-capture-v1
capture_key: "sha256(...)"
category: decision
tags:
  - memory
status: active
---
```

Field rules:

- `title`, `created`, and `source` remain compatible with the existing Memex writer.
- `source_type`, `provenance: validated`, and `capture_validation: memex-capture-v1` are written only by `capture`.
- `status` defaults to `active`.
- Legacy cards with missing status are current-compatible.
- `resolved`, `superseded`, and `archived` are read as historical/inactive when present, but this plan does not add a conflict lifecycle.
- `capture_key` supports idempotent retry for `remember` and append operations.

## Text Guardrails

Required text fields must be non-empty. Reject raw `[[wikilinks]]` and `<!-- capture-key:` in model-authored persisted text. Generate wikilinks only from validated structured fields such as `related_slugs` on new cards.

Use simple V1 length limits:

| Field | Limit |
|---|---:|
| title | 160 chars |
| tag | 64 chars |
| tags | 16 |
| profile_intent_quote | 256 chars |
| body | 12,000 chars |
| update/correction append text | 4,000 chars |

## Append Format

For `update`:

```markdown
## Updates

- 2026-07-07: New durable fact. Source: `/absolute/path` (`message:user:abc123`). <!-- capture-key:{sha256(...)} -->
```

For `correct`:

```markdown
## Corrections

- 2026-07-07: Correction text. Source: `/absolute/path` (`message:user:abc123`). <!-- capture-key:{sha256(...)} -->
```

The generated capture-key comment is service-authored. Model-authored input must not contain it.

## Retrieval Behavior

V1 retrieval only needs basic status awareness:

- Default read/search/recall/list returns `active`, `conflict`, and legacy missing/unknown-status cards.
- Default read/search/recall/list excludes `resolved`, `superseded`, and `archived`.
- Returned cards should include `status` when available.
- `conflict` cards should include a warning that the memory is disputed.
- Malformed frontmatter should not be promoted as current truth; explicit `read` may return raw content with a repair warning.

Do not build graph relation trust or inbound conflict warning systems.

## Dynamic Prompt Injection

Inject Memex guidance dynamically only when program code has already determined that `memex_memory` is available for the current turn.

Prompt behavior:

- Do not modify the saved agent system prompt.
- Do not put Memex guidance in a static global prompt.
- Do not inject the tool list into the prompt and ask the model to decide. The application already has the available tool list; use a normal code check such as `availableTools.some(tool => tool.name === "memex_memory")` and inject only the Memex guidance when that check passes.
- For sub-agents, inject read-only guidance only: use `recall`, `search`, and `read`; do not call `capture` or `archive`.
- For ordinary parent-chat turns, tell the model to use `capture` for durable memory writes and to prefer `remember`, `update`, and `correct`.
- Do not describe `capture` as a background process or separate tool. The model calls Manage-Memory / `memex_memory` with `operation: "capture"` when it has something durable to remember.
- If a conflict is detected, ask/report instead of writing structured conflict metadata.

Execution-time authorization must still verify that `memex_memory` is available before dispatch. Prompt filtering is not an authorization boundary.

## Capture Result Transport

`capture` needs a detailed internal result path so successful card writes are not lost behind a string-only API.

Recommended result shape:

```ts
interface MemexCaptureResult {
  status: "created" | "updated" | "corrected" | "already-captured" | "unchanged" | "cancelled" | "error";
  changed: boolean;
  output: string;
  metadata?: {
    writeSucceeded?: boolean;
    cancelledBeforeWrite?: boolean;
    cardPath?: string;
    slug?: string;
  };
}
```

Rules:

- `changed: true` means a durable card write succeeded.
- Before the card write starts, cancellation may return `cancelled`.
- After the card write starts, a successful write must return success even if cancellation fires later.
- `cardsChanged` should be emitted once, after a successful capture write, by the detailed builtin dispatch layer.
- Compatibility string APIs unwrap `.output` only for non-capture operations.

## Recommended Implementation Plan

1. Add `src/main/lib/memex/memexMemoryPrompt.ts`.
2. Add `src/main/lib/memex/memexCaptureSourceResolver.ts`.
3. Extend `MemexMemoryToolArgs`.
4. Add detailed tool execution for `capture`.
5. Extend per-call tool context.
6. Implement `MemexService.capture(...)`.
7. Update dynamic prompt injection.
8. Update read/list status output.
9. Update docs and tests.

## Tests

Add focused tests only for V1 behavior:

- `capture` schema/runtime validation.
- source resolver validation.
- chat-session capture.
- file source validation.
- profile-memory gate.
- card writes for remember/update/correct.
- result transport.
- prompt injection.
- retrieval status behavior.

## Non-Goals

- Remote service design.
- HMAC/signature schemes.
- Data redaction pipelines.
- Multi-tenant trust boundaries.
- Structured conflict database.
- Local migration framework for old memory homes.
- Graph relation trust framework.
- Full provenance repair tooling.
- Direct background memory extraction from assistant streaming/final text.

## Final Recommendation

Ship V1 as a lean `capture` pipeline:

1. Resolve local source context in the Electron main process.
2. Validate that the evidence already exists in chat/session/knowledge files.
3. Write distilled memory through `remember`, `update`, or `correct`.
4. Stamp capture-created provenance so raw writes cannot impersonate it.
5. Keep sub-agents read-only.
