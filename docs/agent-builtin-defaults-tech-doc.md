# Agent Built-in Defaults Technical Design

> Version: 1.0.0 | Date: 2026-04-05

## 1. Overview

This document describes the implementation of the Agent Built-in Defaults feature:

1. New custom Agents are initialized with `builtin-tools` server and all `BUILTIN_SKILL_NAMES`.
2. Existing Agents receive a one-time migration to add missing built-in defaults.
3. A version-controlled incremental migration framework ensures future built-in Skill additions respect user removals.

## 2. Current State

### 2.1 New Agent Creation

[CreateCustomAgentViewContent.tsx](../src/renderer/components/chat/agent-area/CreateCustomAgentViewContent.tsx) creates Agents with:

```typescript
agent: {
  mcp_servers: [{ name: 'builtin-tools', tools: [] }],
  skills: [...BUILTIN_SKILL_NAMES],
}
```

**Status: Already implemented** in the first commit.

### 2.2 Built-in Agent Enforcement (Kobi)

[profileCacheManager.ts](../src/main/lib/userDataADO/profileCacheManager.ts) enforces built-in Skills for Kobi via `isBuiltinAgent()` checks in two places:

- `sanitizeProfileV2()` — on every profile write
- `ensureV2ProfileIntegrity()` Step 4.5 — on every profile load

This is a **persistent enforcement** model (always re-adds). Custom Agents need a different model.

### 2.3 Builtin-tools Server Enforcement

`ensureV2ProfileIntegrity()` Step 3 adds `builtin-tools` only when `agent.role === 'Default Assistant'`. Custom Agents typically have `role: ''`, so they are skipped.

## 3. Design

### 3.1 Shared Constants

**File:** `src/shared/constants/builtinSkills.ts`

Add two new exports:

```typescript
// Incremental changelog for existing agent migration.
// Each key is a migration version; value is the list of skills added in that version.
// When adding new built-in skills, append a new entry and bump BUILTIN_DEFAULTS_VERSION.
export const BUILTIN_SKILL_CHANGELOG: Record<number, string[]> = {
  1: ['docx', 'frontend-design', 'pptx', 'skill-creator'],
};

// Current migration version. Bump when BUILTIN_SKILL_CHANGELOG gets a new entry.
export const BUILTIN_DEFAULTS_VERSION = 1;
```

### 3.2 Profile Type Extension

**File:** `src/main/lib/userDataADO/types/profile.ts`

Add field to `ProfileV2` interface:

```typescript
interface ProfileV2 {
  // ... existing fields
  builtinDefaultsVersion?: number;
}
```

### 3.3 Migration Logic

**File:** `src/main/lib/userDataADO/profileCacheManager.ts`

**Location:** `ensureV2ProfileIntegrity()`, after existing field migration checks (before chat iteration), insert a new migration block:

```typescript
// ─── Built-in Defaults Migration (version-controlled) ───
const storedVersion = profileCopy.builtinDefaultsVersion ?? 0;
if (storedVersion < BUILTIN_DEFAULTS_VERSION) {
  const BUILTIN_SERVER = 'builtin-tools';

  for (const chat of profileCopy.chats) {
    if (!chat.agent) continue;

    // Skip built-in agents (already handled by Step 4.5)
    if (isBuiltinAgent(chat.agent.name, BRAND_NAME)) continue;

    // 1. Ensure builtin-tools server with all tools enabled (initial migration only).
    //    Only runs on first migration (version 0 → 1). If the user later removes
    //    the server or customises tools, subsequent version bumps won't touch it.
    if (storedVersion === 0) {
      const mcpServers = chat.agent.mcp_servers || [];
      const builtinIdx = mcpServers.findIndex(s => s.name === BUILTIN_SERVER);
      if (builtinIdx === -1) {
        // Server missing → prepend with all tools enabled
        chat.agent.mcp_servers = [
          { name: BUILTIN_SERVER, tools: [] },
          ...mcpServers,
        ];
      } else if (mcpServers[builtinIdx].tools && mcpServers[builtinIdx].tools.length > 0) {
        // Server exists but tools were selectively picked → reset to all enabled
        mcpServers[builtinIdx].tools = [];
      }
    }

    // 2. Add incremental skills from new versions only
    const currentSkills = chat.agent.skills || [];
    for (let v = storedVersion + 1; v <= BUILTIN_DEFAULTS_VERSION; v++) {
      const newSkills = BUILTIN_SKILL_CHANGELOG[v] || [];
      for (const skill of newSkills) {
        if (!currentSkills.includes(skill)) {
          currentSkills.push(skill);
        }
      }
    }
    chat.agent.skills = currentSkills;
  }

  profileCopy.builtinDefaultsVersion = BUILTIN_DEFAULTS_VERSION;
  needsSave = true;
}
```

### 3.4 Sanitization Pass-through

**File:** `src/main/lib/userDataADO/profileCacheManager.ts`

In `sanitizeProfileV2()`, ensure the new field is preserved:

```typescript
builtinDefaultsVersion: profile.builtinDefaultsVersion,
```

## 4. File Change Summary

| File | Change | Type |
|------|--------|------|
| `src/shared/constants/builtinSkills.ts` | Add `BUILTIN_SKILL_CHANGELOG`, `BUILTIN_DEFAULTS_VERSION` | New exports |
| `src/main/lib/userDataADO/types/profile.ts` | Add `builtinDefaultsVersion?` to `ProfileV2` | Type extension |
| `src/main/lib/userDataADO/profileCacheManager.ts` | Add migration block in `ensureV2ProfileIntegrity()` | Migration logic |
| `src/main/lib/userDataADO/profileCacheManager.ts` | Preserve field in `sanitizeProfileV2()` | Pass-through |

## 5. Migration Behavior Matrix

| Profile State | Stored Version | Action |
|---------------|---------------|--------|
| Brand new profile (never had agents) | `undefined` → 0 | Full v1 migration for all agents |
| Existing profile, never migrated | `undefined` → 0 | Full v1 migration for all agents |
| Previously migrated to v1 | 1 | No-op (1 = 1) |
| v1 migrated, new v2 skill added | 1 | Only v2 changelog skills added |
| Built-in agent (Kobi) | any | Skipped (handled by existing Step 4.5) |
| Archived agents | N/A | Not in `profile.chats`, naturally excluded |

## 6. Incremental Skill Addition Workflow

When adding a new built-in Skill in the future, developers must:

1. **`src/shared/constants/builtinSkills.ts`**:
   - Add the skill name to `BUILTIN_SKILL_NAMES` array.
   - Add a new entry to `BUILTIN_SKILL_CHANGELOG`: `{ N: ['new-skill-name'] }`.
   - Bump `BUILTIN_DEFAULTS_VERSION` to `N`.

2. **Update the profile template** (`resources/examples/profiles/profile.json`): set `"builtinDefaultsVersion"` to the new version number. `DEFAULT_PROFILE_V2` and `createDefaultProfile()` already reference `BUILTIN_DEFAULTS_VERSION` dynamically, so no source code changes are needed beyond `builtinSkills.ts`.

Example — adding `xlsx` as a built-in Skill:

```diff
  export const BUILTIN_SKILL_NAMES: string[] = [
    'docx', 'frontend-design', 'pptx', 'skill-creator',
+   'xlsx',
  ];

  export const BUILTIN_SKILL_CHANGELOG: Record<number, string[]> = {
    1: ['docx', 'frontend-design', 'pptx', 'skill-creator'],
+   2: ['xlsx'],
  };

- export const BUILTIN_DEFAULTS_VERSION = 1;
+ export const BUILTIN_DEFAULTS_VERSION = 2;
```

## 7. User Removal Preservation

The incremental changelog ensures user removals from earlier versions are preserved:

```
Timeline:
  v1 migration → Agent gets: [docx, pptx, frontend-design, skill-creator]
  User removes docx → Agent has: [pptx, frontend-design, skill-creator]
  v2 migration → only CHANGELOG[2]=['xlsx'] is applied
  Result: Agent has: [pptx, frontend-design, skill-creator, xlsx]
  docx is NOT re-added ✓
```

The key insight: migration iterates from `storedVersion + 1` to `BUILTIN_DEFAULTS_VERSION`, so only new version entries are processed. Previously applied (and then removed) skills are invisible to the migration.

## 8. Edge Cases

### 8.1 Agent already has builtin-tools with partial tool selection

If an Agent has `{ name: 'builtin-tools', tools: ['read_file', 'write_file'] }`, the initial migration (`storedVersion === 0`) resets `tools` to `[]` (all enabled). This ensures every agent starts with full built-in tool access. After migration, if the user customises tools again, subsequent version bumps will NOT touch the tools setting.

### 8.2 Agent has a skill from a future version already

If a user manually added a skill that later becomes built-in, the `includes()` check prevents duplicate addition. No-op.

### 8.3 Profile corrupted — builtinDefaultsVersion is NaN or negative

`?? 0` fallback ensures a non-number value triggers full migration. `< BUILTIN_DEFAULTS_VERSION` comparison treats NaN as false, but the `??` handles this before the comparison.

### 8.4 Two app instances running concurrently

The migration is idempotent — running it twice produces the same result. The version stamp prevents redundant re-runs on subsequent launches.

## 9. Testing Strategy

### 9.1 Unit Tests

Add tests in `src/main/lib/userDataADO/__tests__/`:

1. **New profile migration**: Profile with no `builtinDefaultsVersion` → all agents get v1 skills and builtin-tools.
2. **Incremental migration**: Profile with `builtinDefaultsVersion=1` and `BUILTIN_DEFAULTS_VERSION=2` → only v2 skills added.
3. **User removal preservation**: Agent missing a v1 skill after v1 migration → v2 migration does not re-add it.
4. **Built-in agent skip**: Kobi is not processed by this migration (handled by existing logic).
5. **Idempotency**: Running migration twice produces same result.
6. **Builtin-tools dedup**: Agent already has builtin-tools → not added again.
