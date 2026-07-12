<!-- Last verified: 2026-07-11 -->
# Coding CLI

> Main-process Settings IPC for the profile-level Coding CLI configuration used by the `coding_agent` built-in tool.

## Key Files
| File | Responsibility | Size |
|------|----------------|------|
| `codingCliIPC.ts` | Type-safe IPC handlers for `getSettings`, `updateSettings`, and `detectAvailability`; validates renderer-provided settings patches before writing profile data. | small |
| `__tests__/codingCliIPC.test.ts` | Unit coverage for handler registration, signed-in/default settings reads, update validation, persistence failures, and availability responses. | small |

## Architecture

This module is the main-process boundary for Settings -> Coding CLI. It does not execute coding-agent tasks; execution lives in `../mcpRuntime/builtinTools/codingAgentTool.ts`, and CLI metadata/availability lives in `../mcpRuntime/builtinTools/codingCli/`.

`registerCodingCliIPC({ getAlias })` binds the shared `@shared/ipc/codingCli` contract with `renderToMain.bindMain`. The active profile alias is injected from startup IPC context so handlers do not read mutable global state directly.

Settings storage is profile-level:

1. `getSettings` returns `DEFAULT_CODING_AGENT_SETTINGS` when no user is signed in, otherwise `profileCacheManager.getCodingAgentSettings(alias)`.
2. `updateSettings` requires an active alias, validates that only `enabled` and `cli` are present, then calls `profileCacheManager.updateCodingAgentSettings(alias, patch)`.
3. `detectAvailability` returns `detectAllAvailability()` from the coding-agent adapter registry. OpenKosmos only detects CLIs on PATH; it never installs or updates them.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new supported CLI | `@shared/types/codingCli.ts`, `../mcpRuntime/builtinTools/codingCli/adapters.ts`, `../mcpRuntime/builtinTools/codingCli/registry.ts`, renderer Settings UI/tests | Keep the allowed `cli` validation list in this module backed by `CODING_CLI_IDS`. |
| Add a new Coding CLI setting | `@shared/ipc/codingCli.ts`, `codingCliIPC.ts`, `../userDataADO/types/profile.ts`, profile CRUD/sanitizer/cache tests, renderer Settings UI/tests | Reject unknown keys at the IPC boundary until every consumer supports the field. |
| Change availability detection | `../mcpRuntime/builtinTools/codingCli/registry.ts` and its tests | Keep command execution async, bounded, and shell-free (`execFile(command, [binaryName], ...)`). |

## Co-Change Map
| When you change | Also check/update |
|-----------------|-------------------|
| `CodingCliSettings` shape | `@shared/ipc/codingCli.ts`, `@shared/types/codingCli.ts`, `../userDataADO/types/profile.ts`, renderer `CodingCliSettings*View.tsx`, tests |
| `detectAvailability` response shape | Shared IPC contract, renderer availability rendering, `../mcpRuntime/builtinTools/codingCli/registry.ts` |
| Active profile alias behavior | `src/main/startup/ipc/index.ts` registration and signed-in/no-alias IPC tests |

## Anti-Patterns
- Do NOT run installation or update commands from this module. Users manage CLI installation/auth/update outside OpenKosmos.
- Do NOT accept arbitrary settings keys from the renderer. Unknown keys should fail fast so profile data stays schema-safe.
- Do NOT let tool input override the selected CLI. The CLI is an operator-controlled profile preference, not a model-controlled tool argument.
- Do NOT use shell-interpolated command strings for PATH detection.

## Verification Steps
1. `npm run test -- --run src/main/lib/codingCli/__tests__/codingCliIPC.test.ts`
2. `npm run test -- --run src/main/lib/mcpRuntime/builtinTools/codingCli/__tests__/registry.test.ts`
3. Toggle Settings -> Coding CLI and confirm the renderer refreshes the MCP client cache after successful updates.

## Gotchas
- `getSettings` deliberately succeeds without an active profile by returning defaults; `updateSettings` deliberately fails without an active profile to avoid writing to an implicit location.
- Availability detection is async and bounded because it probes local PATH with `which`/`where`. Keep it cheap, shell-free, and off the main-process blocking path.
- `detectCliPath` (in `../mcpRuntime/builtinTools/codingCli/registry.ts`) must NOT return the first `where` line on Windows. `where` lists every PATH match regardless of launchability, so it can surface an extension-less POSIX wrapper (not spawnable -> `spawn ENOENT`) or an editor-bundled copy (e.g. the VS Code Copilot Chat extension ships `copilot` under `globalStorage\github.copilot-chat\copilotCli` and injects it into the integrated-terminal PATH) ahead of the real npm-global shim. It filters candidates instead: any `\globalStorage\` (editor-bundled) path is **excluded outright** — it is private to the VS Code extension and must never be driven by OpenKosmos — and only paths with a launchable executable extension (`.exe`/`.cmd`/`.bat`/`.com`) are kept. The first survivor in PATH order wins; when none survive it returns `null` so the tool reports the CLI unavailable and surfaces the install hint instead of failing mid-spawn.
- The profile master switch defaults off, so `coding_agent` is hidden from the advertised tool inventory until Settings -> Coding CLI enables it.
- On Windows, a resolved `.cmd`/`.bat` npm shim is **not** spawned through `cmd.exe`. `codingAgentTool.ts` parses the npm-generated shim, extracts the underlying `%dp0%\...` target, and spawns either `node <js-entrypoint> ...args` (`.js`/`.mjs`/`.cjs`) or the executable target directly (`.exe`) with `shell: false`. This keeps model/user-controlled `task` text (including spaces, `&`, `|`, `<`, `>`, and `%VAR%`) as argv data instead of shell syntax. If the shim is not a recognizable npm-generated shim, the tool reports an unsupported-shim error instead of falling back to `shell: true`. Direct executables (`.exe`) also spawn with `shell: false`.

## Related
- Depends on: [userDataADO](../userDataADO/ai.prompt.md), [mcpRuntime/builtinTools](../mcpRuntime/builtinTools/ai.prompt.md), `@shared/ipc/codingCli`, `@shared/types/codingCli`
- Depended by: `src/main/startup/ipc/index.ts`, Settings -> Coding CLI renderer page, `coding_agent` tool availability UX
