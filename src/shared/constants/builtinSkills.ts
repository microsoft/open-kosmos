/**
 * Built-in skills configuration
 * Shared between main process and renderer process
 */

/**
 * Built-in skill names that are pre-installed and cannot be deleted.
 * These skills are automatically installed during FRE and startup updates.
 */
export const BUILTIN_SKILL_NAMES: string[] = [
  'skill-creator',
];

/**
 * Check if a skill is a built-in skill
 * @param skillName The skill name to check
 * @returns true if the skill is built-in
 */
export function isBuiltinSkill(skillName: string): boolean {
  return BUILTIN_SKILL_NAMES.includes(skillName);
}
