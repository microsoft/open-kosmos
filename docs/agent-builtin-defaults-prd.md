# Agent Built-in Defaults PRD

## 1. Background

Kosmos has two types of built-in capabilities available to every Agent:

1. **Built-in Tools** — a set of ~40 core tools (file ops, shell, web search, agent management, etc.) exposed through the `builtin-tools` MCP server.
2. **Built-in Skills** — 4 pre-installed Skills (`docx`, `frontend-design`, `pptx`, `skill-creator`) that provide prompt-level domain expertise.

Currently, only the default **Kobi** Agent receives these capabilities automatically. Custom Agents created by users start with empty `mcp_servers: []` and `skills: []`, making them significantly less capable out of the box. Users often do not understand why their new Agent cannot execute commands or produce documents until they manually enable these settings.

## 2. Problem Statement

Three distinct problems exist today:

1. **New custom Agents lack built-in capabilities.** A freshly created Agent has no tools and no skills. Users must manually navigate to MCP Servers and Skills tabs to enable them. This is a poor first-run experience.

2. **Existing custom Agents also lack built-in capabilities.** All previously created custom Agents suffer from the same gap. Users who created Agents before this feature was available will not benefit unless their Agents are migrated.

3. **No forward-compatible mechanism for new built-in Skills.** When the product adds a new built-in Skill in a future release, there is no mechanism to automatically enable it for existing Agents without re-adding Skills the user previously removed.

## 3. Product Decision

### 3.1 New Agent Defaults

When a user creates a new custom Agent, the Agent will be initialized with:

- `mcp_servers: [{ name: 'builtin-tools', tools: [] }]` (all built-in tools enabled)
- `skills: [...BUILTIN_SKILL_NAMES]` (all current built-in skills enabled)

Users can freely modify these selections after creation.

### 3.2 Existing Agent One-time Migration

All existing non-archived Agents will receive a one-time migration to add missing built-in defaults. This migration:

- Adds `builtin-tools` server if the Agent does not have it; resets `tools` to `[]` (all enabled) if the server exists but tools were selectively picked.
- Adds any missing built-in Skills to the Agent's skill list.
- Runs once per migration version. Users can freely remove these after migration.

### 3.3 Version-controlled Incremental Migration

Migrations are tracked at the profile level using a version number (`builtinDefaultsVersion`). This supports future scenarios:

- When a new built-in Skill is added, the version is bumped.
- Migration only applies the incremental additions from new versions.
- Skills that users previously removed (from older versions) are NOT re-added.

## 4. Scope

### 4.1 In Scope

1. Set built-in tools and skills as defaults when creating new custom Agents.
2. One-time migration for all existing non-archived Agents.
3. Version-controlled incremental migration framework for future built-in Skill additions.
4. Profile-level `builtinDefaultsVersion` field for migration tracking.
5. `BUILTIN_SKILL_CHANGELOG` data structure for incremental version tracking.

### 4.2 Out of Scope

1. Archived Agents — stored in separate `archived_agents.json`, excluded from migration.
2. Kobi and other built-in Agents — already handled by existing `isBuiltinAgent` logic.
3. Built-in tool granularity — all tools in `builtin-tools` server are enabled as a group (existing behavior).
4. UI changes — no new UI elements needed; existing MCP Servers tab and Skills tab already support editing.

## 5. User Scenarios

### 5.1 New User Creates Custom Agent

1. User clicks "New Agent" → "Custom Agent".
2. Fills in name, emoji, model → clicks "Create and Continue Configuration".
3. Agent is created with built-in tools and all built-in skills already enabled.
4. User can immediately start chatting — Agent can execute commands, search the web, create documents.
5. User can navigate to MCP Servers or Skills tab to customize selections.

### 5.2 Existing User Upgrades to New Version

1. User launches the updated OpenKosmos app.
2. Profile integrity check detects `builtinDefaultsVersion` is missing or lower than current.
3. For each Agent in `profile.chats`:
   - If `builtin-tools` server is missing → add it with `tools: []`.
   - If `builtin-tools` server exists but tools were selectively picked → reset to `tools: []`.
   - For each Skill in the current version's changelog → if missing, add it.
4. `builtinDefaultsVersion` is set to the current version.
5. User opens an existing Agent and finds built-in tools and skills now available.
6. User can remove any of them if not needed.

### 5.3 Future: New Built-in Skill Added

1. Developer adds `'xlsx'` to `BUILTIN_SKILL_NAMES` and adds `{ 3: ['xlsx'] }` to `BUILTIN_SKILL_CHANGELOG`, bumps `BUILTIN_DEFAULTS_VERSION` to `3`.
2. Users upgrade app. Profile integrity detects version `2 < 3`.
3. Only `xlsx` is added to existing Agents (versions 1-2 changelog entries are skipped).
4. Users who previously removed `docx` (a v1 skill) are NOT affected — `docx` is NOT re-added.

### 5.4 User Removes a Built-in Skill

1. User opens Agent settings → Skills tab.
2. Unchecks `frontend-design`.
3. Skill is removed from `agent.skills`.
4. On next app launch, migration version has not changed → no migration runs → removal is preserved.
5. If a future version bumps the migration, only NEW skills from the new version are added.

## 6. Data Model Changes

### 6.1 Profile Level

```typescript
interface ProfileV2 {
  // ... existing fields
  builtinDefaultsVersion?: number;  // NEW: tracks applied migration version
}
```

### 6.2 Shared Constants

```typescript
// src/shared/constants/builtinSkills.ts

// Full list — used for new Agent defaults and isBuiltinSkill()
export const BUILTIN_SKILL_NAMES: string[] = [
  'docx', 'frontend-design', 'pptx', 'skill-creator',
];

// Incremental changelog — used for existing agent migration
export const BUILTIN_SKILL_CHANGELOG: Record<number, string[]> = {
  1: ['docx', 'frontend-design', 'pptx', 'skill-creator'],
};

// Current version
export const BUILTIN_DEFAULTS_VERSION = 1;
```

## 7. Success Criteria

1. New custom Agents have built-in tools and skills enabled by default.
2. Existing Agents receive built-in tools and skills after one-time migration.
3. Users can freely remove any built-in tool/skill selection, and removals are preserved across app restarts.
4. Future built-in Skill additions only add new Skills to existing Agents without re-adding previously removed ones.
5. Archived Agents are not affected.

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Migration modifies existing Agents silently | Migration is additive-only, never removes. Users see new capabilities, not lost ones. |
| User confusion about suddenly available tools | Built-in tools/skills are clearly labeled with "Built-in" badges in the UI. |
| CHANGELOG grows over time | Each entry is just a version number → skill names array. Growth rate is very low (a few entries per year). |
| Profile version field missing | Defaults to `0`, triggering full v1 migration. Safe for all existing profiles. |
