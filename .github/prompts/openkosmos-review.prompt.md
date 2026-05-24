# OpenKosmos Strict Code Review

## Task

Perform a strict professional code review of the current changes in this repository.

## Review Scope

Review the active diff, pull request changes, or user-specified files.
Use the repository's review instruction and project architecture context.
Do **not** review only the textual diff. Build enough repository context to understand why the change exists, which product or technical problem it is trying to solve, and how it fits into the existing OpenKosmos architecture.

## Global Review Mindset

Review with a whole-project perspective, not a patch-local perspective:

1. **Understand intent before judging implementation.** Infer the change motivation from the PR description, linked issue, commit messages, surrounding code, PRD / Tech Doc, module `ai.prompt.md`, architecture docs, tests, and historical postmortems. If the intent is still unclear and it affects the verdict, raise an Open Question instead of guessing.
2. **Trace the architectural fit.** Check whether the implementation follows the established process boundaries, module ownership, state flow, IPC contracts, persistence model, security boundaries, brand model, and runtime packaging rules. A change that "works" locally but conflicts with the architecture is a review concern.
3. **Look beyond directly edited lines.** Inspect relevant callers, consumers, sibling implementations, shared utilities, persistence readers/writers, IPC definitions, preload bridges, renderer clients, tests, docs, and module co-change maps. Verify that all affected surfaces changed together.
4. **Compare against project norms and past incidents.** Use `ai.prompt/arch-main.md`, `ai.prompt/arch-render.md`, module-level `ai.prompt.md` files, Gotchas sections, and postmortems as review evidence. Flag changes that reintroduce known failure patterns, violate documented constraints, or ignore historical lessons.
5. **Assess risk introduction, not just current breakage.** Consider data migration safety, rollback behavior, partial failure modes, race conditions, startup/sign-in critical paths, cancellation, offline behavior, packaging, CI coverage, cross-platform behavior, and multi-brand parity.
6. **Evaluate consistency with existing design choices.** If the PR introduces a new pattern where an established helper, abstraction, IPC channel shape, state management approach, or error-handling convention already exists, require justification or alignment.
7. **Review completeness.** A comprehensive review should cover implementation, tests, documentation, contracts, architecture fit, operational risk, and maintainability. Avoid approving a change solely because the diff itself appears correct in isolation.

## Review Objectives

Focus on:

1. Correctness and behavioral regression risk
2. PRD / Tech Doc / implementation consistency
3. Cross-process safety across main, preload, renderer, IPC, persistence, MCP, and runtime boundaries
4. Missing tests, weak verification, and rollback risk
5. Security, auth, secret handling, and permission boundaries
6. Packaging and runtime dependency mistakes that may fail only in production
7. OpenKosmos-specific prohibited patterns (see below)
8. IPC critical-path discipline
9. Co-change completeness
10. Cross-platform compatibility (Win x64, Win ARM64, macOS x64, macOS ARM64)
12. System-wide impact of changed APIs, contracts, behavior, state, and data shape
13. Test coverage for changed code: 90% minimum, 100% preferred

## Severity Definitions

- **Blocking**: Must fix before merge. Causes correctness failure, data loss, security vulnerability, or production break.
- **Warning**: Should fix before merge. Causes performance degradation, maintainability risk, or violates project conventions.
- **Note**: Nice to have. Minor improvements, style suggestions, or observations for future work.

## OpenKosmos-Specific Checks

### IPC Critical-Path Discipline

Flag any `await` added to IPC handlers that gate UI transitions (`auth:setCurrentSession`, navigation, window lifecycle). Background work (scheduler, buddy, plugins, sync) must use fire-and-forget (`.then().catch()`) — never `await` on the critical path. Reference: v2.7.10 postmortem where `await schedulerManager.initialize()` blocked sign-in for 12+ minutes.

### Prohibited Patterns

1. **Non-English text in any file.** This is a global open-source project. All code, comments, documentation, commit messages, scripts, config files, log messages, error strings, CSS comments, JSDoc, README files, and `ai.prompt.md` files must be written entirely in English. Flag any Chinese (or other non-English) text as **Blocking**. The only exceptions are: (a) functional code that must contain non-English text for correctness (e.g., Whisper model language prompts, language-detection regex patterns, i18n/l10n string values); (b) test fixtures that validate non-English text handling.
2. **Unbounded sequential `await` loops over network/LLM calls.** `for...of` with `await` over N items hitting the network is O(N × latency) with no upper bound. Must use `Promise.allSettled` with per-item timeouts, or fire-and-forget.
2. **Renderer component files > 500 lines.** Flag and require split into smaller components, extracted hooks, or state lifted into atoms.
3. **Schema-breaking changes to JSON persistence** under `{userData}/profiles/`. Adding fields is safe; renaming or removing fields requires a migration path in code.
4. **New npm dependencies without justification.** Check existing `package.json` for similar functionality already installed.

### Co-Change Map Verification

For each changed file, check whether its module has an `ai.prompt.md` with a Co-Change Map. If a listed co-change file was not modified in this PR, flag it as a potential missed update.

### System-Wide Impact and Consumer Adaptation Gate

When a PR changes any function signature, exported type, shared utility, IPC contract, persisted data shape, event payload, hook return value, component prop contract, runtime behavior, or documented workflow, review every relevant caller and consumer across the repository. Do not assume TypeScript, tests, or the diff view found all required adaptations.

The reviewer must verify:

- Direct and indirect callers still pass the right inputs and handle the new outputs, errors, ordering, cancellation, and partial-success states.
- Renderer, preload, main-process, IPC, persistence, MCP, runtime, and test surfaces remain contract-compatible when the changed code crosses process or module boundaries.
- Sibling features and alternate entry points, including screenshot window, startup, auth, chat, background jobs, and offline flows, are not left on stale assumptions.
- Shared abstractions are updated consistently: types, adapters, mocks, fixtures, tests, documentation, analytics/logging, feature flags, migrations, and fallback paths.
- The PR includes either the necessary consumer adaptations or clear evidence that existing consumers are unaffected.

If a changed surface is used elsewhere and the PR does not adapt or prove compatibility for those usages, flag it as **Blocking**. A PR must not merge when it can make another part of the system fail because related callers, consumers, or contracts were not reviewed and updated.

### Test Coverage Gate

The test coverage for code changed by the PR must be at least **90%**. This is the minimum merge bar, not an aspirational target. Prefer **100%** coverage for changed logic whenever practical, especially for new features, bug fixes, shared utilities, IPC contracts, persistence, migrations, auth, chat, MCP, runtime, and cross-process behavior.

During review, verify that the PR includes meaningful tests for the changed behavior, not only snapshot or superficial line coverage. Coverage should include success paths, edge cases, error paths, cancellation, partial-success states, migration/backward-compatibility cases, and cross-process contract behavior when relevant.

If changed code coverage is below 90%, or if the PR does not provide enough evidence to determine coverage for the changed code, flag it as **Blocking**. If coverage is 90% or higher but important behavior remains untested, flag the missing behavior as **Blocking** when it can cause correctness, data, security, or regression risk; otherwise flag it as **Warning**.

### Documentation Sync

Documentation and implementation must stay consistent. During review, compare the changed behavior against PRD, Tech Doc, architecture docs, module `ai.prompt.md`, public README / usage docs, and in-code comments that describe contracts or behavior.

If documentation says the system behaves one way but the implementation behaves another way, flag it as **Blocking**, not Warning. This applies in both directions:

- Code changed but the corresponding docs still describe the old behavior.
- Docs changed but the implementation does not match the new documented behavior.
- PRD / Tech Doc requirements are not implemented, or implementation adds behavior that contradicts them.
- Architecture or module docs describe ownership, data flow, IPC contracts, persistence shape, or safety rules that the code violates.

Also verify:

- The module's `ai.prompt.md` was updated when module behavior, gotchas, co-change rules, or architecture changed.
- The `<!-- Last verified: YYYY-MM-DD -->` date is current when an `ai.prompt.md` file is modified.
- If a new module was created, check whether an `ai.prompt.md` should be added and whether `arch-main.md` or `arch-render.md` module tables need updating.

### Multi-Brand Awareness

Flag changes that assume a single brand without checking all brand code paths. Brand-specific behavior must be gated on the brand config, not hardcoded.

### Historical Issue and Postmortem Regression Check

Review the `ai.prompt.md` Gotchas section of each changed module and the postmortem / retrospective documents under `ai.prompt/` and `docs/`. Also use linked issues, PR history, and commit history when the current change touches an area with known incidents.

The reviewer must ask whether the current implementation has the same shape as a previously analyzed failure, even if the exact files or feature names differ. Look for recurring patterns such as critical-path blocking, stale cross-process contracts, incomplete persistence migrations, partial writes, missing cancellation propagation, unbounded sequential work, renderer/main boundary leaks, packaging-only failures, brand drift, platform assumptions, weak rollback behavior, or callers left on stale assumptions.

If the PR reintroduces a failure pattern already documented in an issue, postmortem, Gotchas section, or previous PR discussion, flag it as **Blocking** unless the PR explicitly explains why the historical risk no longer applies and includes adequate safeguards or tests. A review should not approve code that repeats a known class of production incident just because the new diff looks different.

### CI Status Verification

Before concluding the review, check whether all CI/GitHub Actions checks have passed on this PR. If any check is failing or pending:
- Flag it as a **Blocking** finding if the failure is related to the changed code (test failures, type errors, lint errors, build failures).
- Flag it as a **Warning** if the failure appears unrelated (flaky test, infra issue) — but note it and require the author to confirm.
- Never approve a PR with unexplained CI failures.

### Main Process Logging

All logging in the main process must use `unifiedLogger` (from the unified logging module). Flag any use of raw `console.log`, `console.warn`, `console.error`, or other ad-hoc logging in main-process code as a **Warning**. The unified logger provides structured output, log-level control, and file rotation — bypassing it loses observability.

### Cross-Platform Compatibility

KOSMOS is a cross-platform desktop app that must support **Win x64, Win ARM64, macOS x64, macOS ARM64** unless the code or PR description explicitly states a platform-specific scope. Review all changes for platform assumptions:

- **Native modules and binaries**: Ensure any native dependency (`.node`, `.dll`, `.dylib`) ships platform-specific builds for all four targets, or is conditionally loaded.
- **File paths**: Flag hardcoded path separators (`\\` or `/`), drive letters (`C:\`), or platform-specific directories (`/usr/`, `%APPDATA%`). Use `path.join`, `path.resolve`, or Electron's `app.getPath()`.
- **Shell and process spawning**: `child_process.spawn`/`exec` calls must account for differences in shell (`cmd.exe` vs `/bin/sh`), executable extensions (`.exe`), and environment variable syntax (`%VAR%` vs `$VAR`).
- **Architecture-sensitive code**: Code that checks `process.arch` or `os.arch()` must handle both `x64` and `arm64`. Watch for assumptions that x64 is the only architecture.
- **Platform-specific APIs**: Node.js or Electron APIs that behave differently across platforms (e.g., `app.setLoginItemSettings`, `Tray`, `systemPreferences`, `shell.openPath`) must be verified or gated.
- **Line endings and encoding**: File I/O that reads or writes user-facing text should not assume `\n`; consider `\r\n` on Windows.

Flag platform-blind code as **Warning** by default. If the code would crash or silently fail on a supported platform, escalate to **Blocking**.

### Electron Security

- No `nodeIntegration: true` or `contextIsolation: false` in new windows.
- Preload scripts must not expose raw Node.js APIs to the renderer.
- IPC inputs from the renderer must be validated/sanitized before use in main process.
- MCP tool shell commands must guard against command injection.

## Expected Output

The response must use the following section structure:

1. `## Review Comments` — required
2. `## Open Questions` — optional, only when needed (see below)
3. `## Review Conclusion` — required

Do not add any other top-level sections before, between, or after these.

### Review Comments

List findings first, ordered by severity (Blocking → Warning → Note).
For each finding, include:

- **Severity**: Blocking / Warning / Note
- **Title**: Short description
- **File**: File path and line reference
- **Issue**: Why it is a real issue
- **Impact**: What scenario breaks, regresses, or becomes unsafe

Do not add separate subsections such as `Assumptions`, `Verification Gaps`, `Residual Risks`, or similar. If uncertainty is important, include it inside the relevant finding's `Issue` / `Impact`, or summarize it briefly in `## Review Conclusion`.

If no findings are discovered, say so explicitly inside `## Review Comments`, and still call out any residual risks or verification gaps.

### Open Questions (optional)

If during review you encounter implementation choices whose rationale is **not obvious from the code, comments, commit messages, or `ai.prompt.md` docs**, you may include an `## Open Questions` section between `## Review Comments` and `## Review Conclusion`.

Questions can be **clarifications** (you genuinely don't know the intent) or **challenges** (you suspect the implementation is suboptimal or incorrect, and want the author to justify it). Both are valid — a good reviewer doesn't just ask politely, they push back when something smells off.

Rules:

- **Only raise when it materially affects your verdict.** If you cannot determine whether something is a bug or an intentional design choice, and that ambiguity would change the finding's severity — ask. If an implementation looks questionable and a better alternative exists — challenge. Do not question stylistic preferences or things you can verify yourself by reading more code.
- **Show your homework.** Each item must state what you already checked (code, git history, docs) and why the answer is still unclear or the approach still looks wrong.
- **Be specific.** Reference the exact file, line, and the two (or more) interpretations you see. For challenges, state the concern concretely and suggest what you'd expect instead. Vague pushback like "why is this done this way?" is not acceptable.
- **Back challenges with evidence, not taste.** A challenge must cite a concrete risk (correctness, performance, maintainability, security) or a violation of project conventions. "I would have done it differently" is not a challenge — it's a preference.
- **Keep it short.** Maximum 3 items per review. If you have more, prioritize by impact on correctness and safety.

When Open Questions are present:

- The `## Review Conclusion` verdict must be `Pending — awaiting author clarification` instead of a final approve/reject.
- After the author responds, re-evaluate the open questions, update findings if needed, and issue a final verdict in a follow-up comment.

### Review Conclusion

The response must end with a dedicated `## Review Conclusion` section.

That section must include:

- A clear verdict: `Approve`, `Approve with risks`, `Request changes`, or `Pending — awaiting author clarification`
- A short reason for the verdict tied to the findings
- A brief statement of merge readiness

If findings include any Blocking issue, the conclusion must be `Request changes`.
If there are unresolved Open Questions that affect the verdict, the conclusion must be `Pending — awaiting author clarification`.
If there are no findings but verification is incomplete, use `Approve with risks` instead of `Approve`.

## Post-Review Action

After generating the review, post it to the PR **exactly once** via `gh` CLI. Do NOT post both a comment and a review — pick one:

1. Detect the PR number from the current branch: `gh pr view --json number -q .number`
2. Combine `## Review Comments`, `## Open Questions` (if any), and `## Review Conclusion` into a single body.
3. Submit as a **formal review** (this posts the body as a review comment automatically — no separate `gh pr comment` needed):
   - If the conclusion is `Request changes`: `gh pr review <PR_NUMBER> --request-changes --body "<full review body>"`
   - If the conclusion is `Approve` or `Approve with risks`: `gh pr review <PR_NUMBER> --approve --body "<full review body>"`
   - If the conclusion is `Pending — awaiting author clarification`: `gh pr review <PR_NUMBER> --comment --body "<full review body>"`

## Review Rules

- Do not prioritize style nits over correctness
- Do not speculate without evidence
- Do not rewrite the patch unless explicitly asked to fix it
- Treat missing docs, missing tests, migration risk, and cross-process contract drift as review concerns
- Apply OpenKosmos-specific checks with the same rigor as correctness checks — these patterns are the project's most common sources of production incidents
