<!-- Last verified: 2026-03-25 -->
# Startup Update Service

> Runs a sequential pipeline on every app launch to install and merge MCP servers, Skills, Agents, and Sub-Agents into the user's profile.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `startupUpdateService.ts` | `StartupUpdateService` — full 9-step pipeline, merge logic, semver comparison, progress reporting | large |
| `index.ts` | Re-exports `StartupUpdateService` and related types | tiny |

## Architecture
- **Pipeline steps** (sequential, each step must complete before the next starts):
  1. `install-mcp` — for each MCP where local version is outdated: merge env vars (local values preserved, remote defaults fill gaps)
  2. `install-skills` — direct overwrite (skills are prompt-only, no user-editable settings)
  3. `install-agents` — remote-first for display fields (`name`, `emoji`, `description`, `system_prompt`); local-first for user settings (`model`, `workspace`, `knowledgeBase`, `mcp_servers` selections, `skills` selections)
  4. `install-sub-agents` — same remote-first/local-first merge as agents
  5. `complete`
- Progress is reported via `StartupUpdateProgress` callbacks (0–100 `progress` value, one per step).
- **Semver comparison** uses a simple `major.minor.patch` integer tuple comparison, not the `semver` npm package — keep this in mind for edge cases like pre-release suffixes.
- **Environment variable merge rule** (MCP servers): for each env key, if a local value exists it is preserved; remote value is used only as a default for missing keys. This protects API keys the user has set locally.
- Runs only after FRE (First Run Experience) is completed — gated by a profile flag checked at startup in `main.ts`.
- Errors in any individual item update are logged and collected into `StartupUpdateResult.errors`; the pipeline continues (non-fatal strategy).
- CDN fetch URLs use `appendCacheBustingTimestamp()` from `urlUtils.ts` to prevent stale CDN responses.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new asset type to update | `startupUpdateService.ts` — add `check-X` and `install-X` steps, update `StartupUpdateStep` type | Mirror the existing MCP/Skill/Agent pattern |
| Change merge strategy for agents | `startupUpdateService.ts` install-agents section | Currently: remote-first for display, local-first for settings |
| Change which fields are "user settings" vs "display" | `startupUpdateService.ts` per-type merge block | No central config; logic is inline in each install step |
| Disable startup updates temporarily | Feature flag or the FRE-completion guard in `main.ts` | Do not remove steps from the pipeline |
| Add progress UI steps | `StartupUpdateStep` union type + renderer `StartupUpdateProgress` handler | Renderer listens via IPC for progress events |

## Gotchas
- ⚠️ Semver comparison is hand-rolled (not using the `semver` package). Pre-release tags (e.g., `1.0.0-beta`) will compare incorrectly — strip suffixes before comparing if needed.
- ⚠️ Sub-Agent updates use `subAgentFileManager.ts` for AGENT.md serialisation — changes to the sub-agent file format must be coordinated with the update merge logic here.
- ⚠️ The service is a plain class instance, not a strict singleton — instantiation is controlled from `main.ts`. Do not instantiate it elsewhere.

## Related
- Depends on: [Skill](../skill/ai.prompt.md), [UserDataADO](../userDataADO/ai.prompt.md) (`ProfileCacheManager`), [Sub-Agent](../subAgent/ai.prompt.md), URL utilities
- Depended by: `main.ts` startup sequence (called after FRE gate)
