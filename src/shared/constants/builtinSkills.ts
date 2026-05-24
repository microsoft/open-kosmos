/**
 * Built-in skills configuration
 * Shared between main process and renderer process
 *
 * ══════════════════════════════════════════════════════════════
 *  HOW TO ADD A NEW BUILT-IN SKILL
 * ══════════════════════════════════════════════════════════════
 *
 *  1. Add the skill name to BUILTIN_SKILL_NAMES array.
 *
 *  2. Add a NEW entry to BUILTIN_SKILL_CHANGELOG:
 *       N+1: ['new-skill-name'],
 *     where N is the current BUILTIN_DEFAULTS_VERSION.
 *     ⚠️  NEVER modify existing entries — they represent historical migrations
 *         that have already been applied to user profiles.
 *
 *  3. Bump BUILTIN_DEFAULTS_VERSION to N+1.
 *
 *  4. Update the profile template:
 *       resources/examples/profiles/profile.json
 *     set "builtinDefaultsVersion" to the new version number.
 *
 *  Example — adding a skill called "excel" as version 2:
 *
 *     BUILTIN_SKILL_NAMES = ['docx', 'frontend-design', 'pptx', 'skill-creator', 'excel'];
 *
 *     BUILTIN_SKILL_CHANGELOG = {
 *       1: ['docx', 'frontend-design', 'pptx', 'skill-creator'],
 *       2: ['excel'],                          // ← new entry
 *     };
 *
 *     BUILTIN_DEFAULTS_VERSION = 2;            // ← bumped
 *
 *  Migration behaviour:
 *  - New agents: automatically get ALL skills from BUILTIN_SKILL_NAMES
 *    and the builtin-tools MCP server (tools: [] = all tools enabled).
 *  - Existing agents (skills): on profile load, ensureV2ProfileIntegrity()
 *    walks versions (storedVersion+1 → BUILTIN_DEFAULTS_VERSION) and adds
 *    only the skills from each changelog entry that the agent doesn't
 *    already have, preserving any user removals from prior versions.
 *  - Existing agents (tools): the builtin-tools MCP server is only touched
 *    during the initial migration (version 0 → 1). At that point:
 *      • If the server is missing → added with tools: []
 *      • If the server exists but tools were selectively picked → reset to []
 *    After migration, the user's subsequent changes are permanent — later
 *    version bumps will NOT re-add or reset the builtin-tools server.
 *    tools: [] means "all tools enabled", so new tools added to the
 *    builtin-tools server are automatically available without migration.
 * ══════════════════════════════════════════════════════════════
 */

/**
 * Built-in skill names that are pre-installed and cannot be deleted.
 * These skills are automatically installed during FRE and startup updates.
 */
export const BUILTIN_SKILL_NAMES: string[] = [
  'docx',
  'frontend-design',
  'pptx',
  'skill-creator',
];

/** Incremental changelog for existing-agent migration. See top-of-file guide before editing. */
export const BUILTIN_SKILL_CHANGELOG: Record<number, string[]> = {
  1: ['docx', 'frontend-design', 'pptx', 'skill-creator'],
};

/** Current migration version — must equal the highest key in BUILTIN_SKILL_CHANGELOG. */
export const BUILTIN_DEFAULTS_VERSION = 1;

/**
 * Check if a skill is a built-in skill
 * @param skillName The skill name to check
 * @returns true if the skill is built-in
 */
export function isBuiltinSkill(skillName: string): boolean {
  return BUILTIN_SKILL_NAMES.includes(skillName);
}
