<!-- Last verified: 2026-07-13 -->
# Skills System

> Manages installation, versioning, and activation of packaged AI prompt templates delivered as `.zip`/`.skill` archives.

## Key Files
| File | Responsibility | Size |
|------|---------------|------|
| `skillManager.ts` | `SkillManager` singleton — validates archives, parses SKILL.md YAML front-matter, extracts to profile skills directory, version comparison, CRUD | medium |
| `installAndActivateSkill.ts` | `installAndActivateSkill()` — unified entry point: installs from a local device path, then applies to agents per activation mode (`current-agent`, `all-agents`, `install-only`, etc.) | medium |
| `skillDeviceImporter.ts` | `addSkillFromDevice()` / `updateSkillFromDevice()` — imports or updates a skill from a `.zip`, `.skill`, or skill folder path | small |
| `skillAvailability.ts` | `getSkillAvailability()` — checks whether a skill is installed and callable for a given agent | small |
| `applySkillToAgents.ts` | Applies an installed skill to one or more agent configurations in `ProfileCacheManager` | small |
| `deleteInstalledSkill.ts` | Shared delete path used by UI and built-in tools: removes the global skill config and deletes the local skill directory from disk | small |
| `removeSkillsFromAgents.ts` | Removes one or more skill names from one or more agent configurations without uninstalling the underlying local skill package | small |

## Architecture
- **Skill package format**: a `.zip` or `.skill` archive, or an unpacked skill folder, containing at minimum a `SKILL.md` file with YAML front-matter fields: `name`, `description`, `version`. Additional assets (prompt files, images) are co-located in the archive/folder.
- Storage path: `{userData}/profiles/{userAlias}/skills/{skill-name}/`. The directory name equals the skill `name` field from YAML.
- **Source metadata compatibility**: new imports persist `source: 'ON-DEVICE'`. Existing `source: 'IN-LIBRARY'` and `remoteVersion` fields are retained as inert legacy metadata only; they never trigger a fetch or update check.
- `installAndActivateSkill.ts` is the **single authoritative flow** for local install paths. The built-in MCP tool and device importer both funnel through it. Do not bypass it for new install flows.
- Renderer install entry points may request an explicit device selection mode (`artifact` for `.zip/.skill`, `folder` for directories) so menu actions can skip the extra native mode picker on Windows while keeping file pickers hard-limited to `.zip/.skill`.
- Local uninstall and agent-level unbind are intentionally separate flows: uninstall removes the global skill config plus local package files, but does not touch `chat.agent.skills`; removing from agents only edits agent config and does not uninstall the local package.
- **Global skill registry is owned by `SkillsConfigManager`, persisted in `skills.json`, not `profile.json`.** The dedicated subsystem `userDataADO/skillsConfigManager.ts` holds the registry as an in-memory `Map<alias, SkillConfig[]>`, persists it to `{userData}/profiles/{userAlias}/skills.json` via `userDataADO/skillsFileStore.ts`, and exposes `getSkills` / `getSkill` / `hasSkill` for all main-process reads (legacy inline `profile.skills` is migrated into `skills.json` on first profile load, then stripped). `skillManager.ts` still writes package directories under `{userAlias}/skills/` and notifies `ProfileCacheManager` through `addSkill` / `updateSkill` / `deleteSkill`; those delegates route through `profileEntityCrud` to `SkillsConfigManager`. `applySkillToAgents`, `removeSkillsFromAgents`, and `skillAvailability` use `skillsConfigManager` for registry reads and clear `chatSkillSnapshotStore` entries after binding changes instead of writing `skill_snapshot` into `profile.json`. See [UserDataADO › Skills subsystem](../userDataADO/ai.prompt.md).
- **Built-in skills** (`docx`, `frontend-design`, `pptx`, `skill-creator`) are auto-installed during FRE via `BUILTIN_SKILL_NAMES` in `src/shared/constants/builtinSkills.ts`. They cannot be deleted by the user.
- `js-yaml` is used for YAML parsing.

## Common Changes
| Scenario | Files to Modify | Notes |
|----------|----------------|-------|
| Add a new built-in skill | `src/shared/constants/builtinSkills.ts` + FRE install logic in `main.ts` | Keep the bundled package name aligned with the constant |
| Change SKILL.md required fields | `skillManager.ts` (`SkillMetadata` interface + validation) | Update local package fixtures accordingly |
| Add a new activation mode | `installAndActivateSkill.ts` (`ActivationMode` type + switch) | Renderer must also pass the new mode via IPC |
| Change skill storage directory layout | `skillManager.ts` + `SecurityValidator` skills path whitelist | Path is whitelisted in `securityValidator.ts` |

## Gotchas
- ⚠️ The skills directory is **always approved** by `SecurityValidator` regardless of workspace scope. Changing its path requires updating the whitelist in `securityValidator.ts`.
- ⚠️ `remoteVersion` may remain on migrated entries for schema compatibility. Do not interpret it as an update source.
- ⚠️ Skill names are used as directory names; names with spaces or uppercase letters will cause cross-platform path inconsistencies. Bundled skills use lowercase-hyphenated names.
- ⚠️ `overwrite` flag in `InstallAndActivateSkillArgs` controls whether an existing skill directory is replaced. The optional `confirmOverwrite` async callback allows the UI to prompt the user before proceeding.

## Related
- Depends on: [UserDataADO](../userDataADO/ai.prompt.md) (`ProfileCacheManager`, `SkillsConfigManager`)
- Depended by: local skill management tools, renderer Skills settings UI, and FRE
