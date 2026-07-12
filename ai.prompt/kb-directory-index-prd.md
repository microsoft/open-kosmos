# PRD: Knowledge Base / Deliverables Directory Index Injection (Phase 1.5)

<!-- Last verified: 2026-07-11 -->

## 1. Background & Problem Statement

OpenKosmos agents can be configured with two filesystem knowledge sources:

- **Knowledge Base (KB)** — a user-curated directory of files ("what is in the agent's brain by default").
- **Current Chat Session Deliverables** — a per-session directory of files produced/used in this conversation ("what is in the brain for this session").

The intended retrieval behavior, by the user's own mental model, is: **for every user message, the agent should first check the KB and the session deliverables; only if those are insufficient should it fall back to general knowledge → web search → the wider file system.**

In practice, agents do **not** do this. They answer from memory, jump straight to execution or agent tools, or ask the user — even when the answer literally lives in the KB.

### 1.1 Evidence (diagnosed real sessions)

| Session | What the KB contained | What the agent did | Searches of KB |
|---|---|---|---|
| `yanhu-claw-2 online` | `Azure-VM-for-VPN-and-Copilot-API/yanhu-claw-2-key.pem` | Ran execution and agent-search tools, then asked the user | **0** until user demanded it twice |
| VPN question | VPN config files in KB | Did not consult KB first | 0 |

In the `yanhu-claw-2` session the agent **confessed** the failure mode: the keyword "online status" triggered a learned behavioral shortcut toward agent tools, which bypassed the soft "retrieval-first" instruction shipped in Phase 1.

### 1.2 Root Cause (two gaps)

| # | Gap | Consequence |
|---|---|---|
| 1 | The system prompt injects only the KB/deliverables **paths**, never **what is inside them**. | The model cannot associate a named entity (`yanhu-claw-2`) with a KB file it has never seen listed. It does not know the file exists, so it never reads it. |
| 2 | Phase 1's retrieval-priority rule is **soft wording**. | Keyword-triggered tool shortcuts out-compete it. Soft instructions lose to learned reflexes. |

### 1.3 Benchmark: how Claude Code avoids this

Deep investigation of the leaked Claude Code source established the design that makes "default to memory" actually work:

1. **Injects memory content/index every turn**, not just paths — via a synthetic `<system-reminder>` message (`prependUserContext`, `api.ts:449`). The model never has to "decide" to look; the content is already in context.
2. **Override-priority header** (`claudemd.ts:89`): *"IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written."* — specifically counters keyword-triggered shortcuts.
3. **"Read before you suggest; ask the user last"** as a first-class static instruction (`prompts.ts:230`).
4. **No persistent index, no embeddings.** The per-turn relevance ranker (`findRelevantMemories`, `attachments.ts:2200`) is a pure LLM-prompt selector over a `readdir`-built filename+`description` manifest, hard-capped at top-5 files / 200 candidates / 4KB per file / 60KB per session.

### 1.4 Why this PRD is "Phase 1.5"

| Phase | Scope | Status |
|---|---|---|
| Phase 1 | Soft retrieval-priority section + file-type routing in prompts | ✅ Shipped (PR #741). Proven **insufficient** by the two sessions above. |
| **Phase 1.5 (this PRD)** | **Mechanism 1** (inject bounded relative-path directory index) + **Mechanism 2** (override-priority wording). No extra LLM calls. | 🔲 This phase |
| Phase 2/3 (future) | Per-turn top-K LLM relevance ranker over a filename manifest (Claude Code style); optional frontmatter `description` extraction; two-level lazy injection. | 🔲 Deferred |

---

## 2. Goals & Non-Goals

### 2.1 Goals

- G1. The model can **see what files exist** in the KB and the session deliverables directory, as a bounded list of **relative paths**, injected into the agent-specific system prompt every turn.
- G2. Named-entity questions (device / service / VM / person / file / project) gain a correct anchor (e.g. `yanhu-claw-2-key.pem` is visible), so keyword association points at the KB instead of at execution tools.
- G3. An **override-priority instruction** explicitly orders the model to consult these directories **before** invoking execution / agent / ask-the-user tools.
- G4. Injection is **size-bounded** and **never throws** — it cannot bloat the prompt without limit and cannot break prompt assembly on a filesystem error.
- G5. 100% test coverage of the new behavior.

### 2.2 Non-Goals

- N1. No per-turn LLM relevance ranker (top-K selection). Deferred to Phase 2.
- N2. No file **content** injection — paths only.
- N3. No embeddings / vector search / persistent index / SQLite manifest.
- N4. No new builtin tool. Retrieval still happens through the existing `read_file` / `search_files` / `search_file_contents` / `read_office_file` / `read_html` tools.
- N5. No change to how KB/deliverables paths are configured or resolved.

---

## 3. Design Principles

1. **Index, not content.** Inject relative paths (~50–100 bytes each), not file bodies. This is already 1–2 orders of magnitude lighter than Claude Code's full-CLAUDE.md injection.
2. **Flat relative paths, not a tree.** Each line is a complete, directly-usable relative path the model can hand to `read_file` with zero cross-line reassembly. Flat paths keep named entities contiguous (better keyword association) and cost fewer tokens. (Tree indentation forces the model to mentally re-join parent dirs to filenames — error-prone — and wastes tokens on pure-directory lines.)
3. **Bounded by construction.** Hard caps on file count and walk depth, with an explicit truncation note that points to the search tools for the remainder.
4. **Fail-open, never throw.** Any fs error degrades to "index unavailable"; prompt assembly must never break.
5. **Synchronous.** `getAgentSpecificSystemPrompt()` is synchronous; the index walk reuses the existing synchronous `fs.readdirSync` pattern (already used by the skills scan). No async leakage.
6. **Single source of truth for retrieval priority.** The override wording lives only in `globalSystemPrompt.ts`'s existing `INFORMATION RETRIEVAL PRIORITY` section.

---

## 4. Functional Requirements

### 4.1 Mechanism 1 — Directory Index Injection

**Location:** `src/main/lib/chat/agentChatPromptService.ts`, function `getAgentSpecificSystemPrompt()`.

- FR1. After the existing KB path lines (inside `if (hasKnowledgeBase)`), inject a relative-path index of the KB directory.
- FR2. After the existing deliverables path lines (inside `if (hasChatSessionFiles)`), inject a relative-path index of the deliverables directory.
- FR3. The deliverables directory may not yet exist for a new session. Guard with `fs.existsSync`; if absent, emit a short "no deliverables yet" line instead of an index (no crash).
- FR4. Index format (flat, POSIX `/` separators), example:
  ```
  - Knowledge Base contents (relative paths under the path above):
    - Azure-VM-for-VPN/yanhu-claw-2-key.pem
    - Azure-VM-for-VPN/setup-notes.md
    - vpn/openvpn.conf
    ... and 3 more file(s) (use search_files / search_file_contents to explore)
  ```

#### 4.1.1 Size-control bounds

| Bound | Value | Behavior on hit |
|---|---|---|
| `MAX_INDEX_FILES` | 100 per directory | Append `... and N more file(s) (use search_files / search_file_contents to explore)` |
| `MAX_INDEX_DEPTH` | 3 levels | Deeper paths are not walked; covered by the truncation note |
| `SCAN_LIMIT` | 5000 entries visited | Walk stops early; emit an **honest** `... directory too large to list fully (showing first N; use search_files / search_file_contents to explore the rest)` note instead of the exact `N more` count (which would understate the true total once the walk is truncated). **If zero files were collected before the limit was hit** (e.g. thousands of directories/skipped entries sorted ahead of any file), still emit the header + a too-large note rather than treating the directory as empty — otherwise a large deliverables root would falsely render `No deliverables have been produced in this session yet.` and a large KB would omit the index entirely |
| Noise-name skip | dirs `.git`, `node_modules`, `dist`, `build`, `.claude`; file `.DS_Store` | Skipped. `.git`/`node_modules`/`dist`/`build`/`.claude` are directory-name skips (`.claude` skills are surfaced by the existing skills scan); `.DS_Store` is a **file-name** skip handled before the dir/file branch |
| Sort | path-sorted | Deterministic, stable output |
| Error handling | try/catch around each `readdirSync` + outer guard | A failed sub-directory read is skipped (partial index kept); a failed root read omits the index; never throws |

### 4.2 Mechanism 2 — Override-Priority Wording

**Location:** `src/main/lib/chat/globalSystemPrompt.ts`, existing `INFORMATION RETRIEVAL PRIORITY` section (after the GOLDEN RULE).

- FR5. Add one override-priority sentence, semantically:
  > These two directories OVERRIDE your default behavior and prior assumptions. When a question or task references a named entity (a device, service, VM, person, file, or project), you MUST check the Knowledge Base and Current Chat Session Deliverables listings/contents BEFORE invoking any execution, agent, or ask-the-user tool. Asking the user is a last resort, not a first response.
- FR6. Wording-only addition; no structural change to the section ordering established in Phase 1 (retrieval priority still precedes file-operation rules).

---

## 5. Implementation Outline

| File | Change |
|---|---|
| `src/main/lib/chat/agentChatPromptService.ts` | Add synchronous `buildDirectoryIndex(rootPath)` helper (bounded `fs.readdirSync` walk). Call it after KB path lines (line ~154) and deliverables path lines (line ~161), guarded by `fs.existsSync`, inside the existing `try/catch`. |
| `src/main/lib/chat/globalSystemPrompt.ts` | Add the override sentence (FR5) to `INFORMATION RETRIEVAL PRIORITY`. |
| `src/main/lib/chat/ai.prompt.md` | Document the index injection; bump `Last verified`; update `agentChatPromptService.ts` LOC. |

**Reuse:** the synchronous `fs.readdirSync(dir, { withFileTypes: true })` pattern already present in the skills scan (`agentChatPromptService.ts` lines 174–176). Do **not** use the async `SearchFilesTool.execute()` (would force the synchronous prompt path async).

---

## 6. Test Plan (100% coverage of new behavior — required)

### 6.1 `src/main/lib/chat/__tests__/agentChatPromptService.test.ts`

Existing tests mock `fs.existsSync → false` and `fs.readdirSync → []`. Add cases with a populated `agent.knowledge.knowledgeBase` and mocked `fs` entries:

| # | Case | Assertion |
|---|---|---|
| T1 | KB has files | Index block with relative paths present |
| T2 | File count > `MAX_INDEX_FILES` | `... and N more` truncation note present |
| T3 | Files deeper than `MAX_INDEX_DEPTH` | Deep files not listed |
| T4 | Noise dirs present | `.git` / `node_modules` / `.claude` entries skipped |
| T5 | Deliverables dir exists with files | Deliverables index present |
| T6 | Deliverables dir does not exist | "no deliverables yet" line; no crash |
| T7 | Root `fs.readdirSync` throws | No throw; index omitted gracefully |
| T8 | Empty KB (regression) | No index block (existing behavior preserved) |
| T9 | Entries > `SCAN_LIMIT` (5000) | Honest "directory too large" note; exact `N more` note absent |
| T10 | Deliverables dir exists but empty | "no deliverables yet" line; no deliverables index |
| T11 | Sub-directory readdir throws (root OK) | Partial index: root files kept, bad branch skipped; no throw |
| T12 | `dist` / `build` dirs present | Skipped |
| T13 | Dirent neither file nor directory (symlink/socket) | Skipped |
| T14 | `SCAN_LIMIT` hit with **zero** files collected (KB root is thousands of dirs) | Header + "directory too large" note still emitted; KB not reported empty |
| T15 | `SCAN_LIMIT` hit with **zero** files collected (deliverables root is thousands of dirs) | Header + "directory too large" note emitted; false "no deliverables yet" line absent |

### 6.2 `src/main/lib/chat/__tests__/globalSystemPrompt.test.ts`

| # | Case | Assertion |
|---|---|---|
| T16 | Override sentence present | Contains `OVERRIDE`, `last resort`, tool categories (e.g. `remote` / `ask`); ordered before file-ops section |

---

## 7. Verification

1. `npm run typecheck` — sync helper compiles; no async leakage into `getAgentSpecificSystemPrompt`.
2. `npm test -- agentChatPromptService globalSystemPrompt` — all new + existing tests green.
3. `npm run build:vite` — full compile/bundle passes.
4. `npm run check:impact -- src/main/lib/chat/agentChatPromptService.ts src/main/lib/chat/globalSystemPrompt.ts` — read any flagged `ai.prompt.md` for missed co-changes.
5. Manual (optional): `npm run dev`, open an agent with a populated KB, inspect the assembled system prompt via the dev log harness — confirm the relative-path index and override sentence appear, and a large KB shows the truncation note rather than an unbounded list.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Very large KB bloats the prompt | `MAX_INDEX_FILES` + `MAX_INDEX_DEPTH` + truncation note; relative paths are tiny |
| fs error breaks prompt assembly | Whole walk wrapped in try/catch; fail-open to "index unavailable" |
| Index still ignored (soft signal) | Paired with Mechanism 2 override wording targeting the exact confessed shortcut |
| Stale index within a turn | Acceptable — walk runs per prompt build; KB rarely changes mid-turn |
| Model mis-reassembles paths | Avoided by flat relative paths (no tree reassembly) |

---

## 9. Future Work (out of scope here)

- Per-turn top-K LLM relevance ranker over a filename + frontmatter-`description` manifest (Claude Code `findRelevantMemories` analog), for KBs too large to fully index.
- Optional injection of file `description`/first-line summary alongside paths.
- Two-level injection: lightweight index always loaded + on-demand content fetch.
