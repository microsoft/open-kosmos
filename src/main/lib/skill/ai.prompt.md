<!-- Last verified: 2026-05-29 -->
# Skills System

> Manages installation, versioning, and activation of packaged AI prompt templates delivered as `.zip`/`.skill` archives.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `skillManager.ts` | `SkillManager` singleton — validates archives, parses SKILL.md YAML front-matter, extracts to profile skills directory, version comparison, CRUD | medium |
| `installAndActivateSkill.ts` | `installAndActivateSkill()` — unified entry point: installs from device path or library name, then applies to agents per activation mode (`current-agent`, `all-agents`, `install-only`, etc.) | medium |
| `skillLibraryFetcher.ts` | `SkillLibraryFetcher` singleton — fetches `skills_lib.json` from CDN (dev/prod URL based on `NODE_ENV`), downloads `.skill` archive, delegates extraction to `SkillManager` | medium |
| `skillDeviceImporter.ts` | `addSkillFromDevice()` / `updateSkillFromDevice()` — imports or updates a skill from a `.zip`, `.skill`, or skill folder path | small |
| `skillAvailability.ts` | `getSkillAvailability()` — checks whether a skill is installed and callable for a given agent | small |
| `applySkillToAgents.ts` | Applies an installed skill to one or more agent configurations in `ProfileCacheManager` | small |
| `deleteInstalledSkill.ts` | Shared delete path used by UI and built-in tools: removes the global skill config and deletes the local skill directory from disk | small |
| `removeSkillsFromAgents.ts` | Removes one or more skill names from one or more agent configurations without uninstalling the underlying local skill package | small |

## Architecture
- **Skill package format**: a `.zip` or `.skill` archive, or an unpacked skill folder, containing at minimum a `SKILL.md` file with YAML front-matter fields: `name`, `description`, `version`. Additional assets (prompt files, images) are co-located in the archive/folder.
- Storage path: `{userData}/profiles/{userAlias}/skills/{skill-name}/`. The directory name equals the skill `name` field from YAML.
- **Source taxonomy**: `source: 'ON-DEVICE'` (imported from filesystem, no `remoteVersion`) vs `source: 'IN-LIBRARY'` (downloaded from CDN, has `remoteVersion` for update comparison).
- `installAndActivateSkill.ts` is the **single authoritative flow** for all install paths — the built-in MCP tool, the library browser UI, and the device importer all funnel through it. Do not bypass it for new install flows.
- Renderer install entry points may request an explicit device selection mode (`artifact` for `.zip/.skill`, `folder` for directories) so menu actions can skip the extra native mode picker on Windows while keeping file pickers hard-limited to `.zip/.skill`.
- Local uninstall and agent-level unbind are intentionally separate flows: uninstall removes the global skill config plus local package files, but does not touch `chat.agent.skills`; removing from agents only edits agent config and does not uninstall the local package.
- **Built-in skills** (`docx`, `frontend-design`, `pptx`, `skill-creator`) are auto-installed during FRE via `BUILTIN_SKILL_NAMES` in `src/shared/constants/builtinSkills.ts`. They cannot be deleted by the user.
- CDN URL pattern: `${baseCdnUrl}/skills/skills_lib.json` (catalog) and `${baseCdnUrl}/skills/{name}.skill` (individual archives). Cache-busting timestamp is appended via `appendCacheBustingTimestamp()`.
- `js-yaml` is used for YAML parsing (consistent with `SubAgentFileManager`).

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new built-in skill | `src/shared/constants/builtinSkills.ts` + FRE install logic in `main.ts` | Name must match CDN archive filename |
| Change SKILL.md required fields | `skillManager.ts` (`SkillMetadata` interface + validation) | Update CDN skill packages accordingly |
| Add a new activation mode | `installAndActivateSkill.ts` (`ActivationMode` type + switch) | Renderer must also pass the new mode via IPC |
| Change skills CDN base URL | `skillLibraryFetcher.ts` constructor | Resolves via `getCdnBaseUrl()` from `@shared/utils/cdn` (no built-in default) |
| Change skill storage directory layout | `skillManager.ts` + `SecurityValidator` skills path whitelist | Path is whitelisted in `securityValidator.ts` |

## Gotchas
- ⚠️ The skills directory is **always approved** by `SecurityValidator` regardless of workspace scope. Changing its path requires updating the whitelist in `securityValidator.ts`.
- ⚠️ `remoteVersion` is an empty string (`''`) for ON-DEVICE skills — code that compares versions must guard for this to avoid false update triggers.
- ⚠️ Skill names are used as directory names; names with spaces or uppercase letters will cause cross-platform path inconsistencies. The CDN and FRE always use lowercase-hyphenated names.
- ⚠️ `overwrite` flag in `InstallAndActivateSkillArgs` controls whether an existing skill directory is replaced. The optional `confirmOverwrite` async callback allows the UI to prompt the user before proceeding.

- ⚠️ The CDN is **optional**: when no base URL is configured (`getCdnBaseUrl()` returns `''`), `fetchFromRemote()`/`downloadFile()` reject early and the Skill Library feature stays disabled — there is no hardcoded fallback URL. Core functionality is unaffected.

## Related
- Depends on: [UserDataADO](../userDataADO/ai.prompt.md) (`ProfileCacheManager`), [Analytics](../analytics/), CDN asset fetcher utilities
- Depended by: [Startup Update](../startupUpdate/ai.prompt.md), MCP built-in `add_skill_from_library` tool, renderer Skills settings UI, FRE flow
