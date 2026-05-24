/**
 * Skill Bridge — injects / removes plugin skills via the existing SkillManager.
 *
 * Plugin skills are installed with `source: 'PLUGIN'` so they can be
 * distinguished from user-managed skills.  They are read-only from the
 * user's perspective.
 *
 * Instead of copying files, we create a directory junction (Windows) or
 * symlink (macOS/Linux) from the userData skills directory pointing back
 * to the plugin's original skill folder.  This is zero-copy and always
 * in sync with the plugin source.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../../unifiedLogger';
import { skillManager } from '../../skill/skillManager';
import type { SkillConfig } from '../../skill/skillManager';
import type { LoadedPlugin } from '../types';
import { profileCacheManager } from "../../userDataADO/profileCacheManager";
import { deleteInstalledSkill } from "../../skill/deleteInstalledSkill";

const logger = createLogger();

/**
 * Create a directory junction (Windows) or symlink (others) from linkPath → target.
 * On Windows, junctions don't require elevated privileges (unlike symlinks).
 */
function ensureDirectoryLink(linkPath: string, target: string): void {
  // Remove stale link or directory if it exists
  if (fs.existsSync(linkPath)) {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      // Re-create if pointing somewhere else
      const existing = fs.readlinkSync(linkPath);
      if (path.resolve(existing) === path.resolve(target)) return; // already correct
      fs.unlinkSync(linkPath);
    } else {
      // Real directory — remove it (leftover from old copy-based approach)
      fs.rmSync(linkPath, { recursive: true, force: true });
    }
  }

  // Ensure parent exists
  const parent = path.dirname(linkPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  // 'junction' works on Windows without admin; on POSIX it falls back to 'dir' symlink
  fs.symlinkSync(target, linkPath, 'junction');
}

/**
 * Install all skills declared by a plugin into the current user profile.
 *
 * Creates directory junctions instead of copying files, so the plugin's
 * original skill directories stay intact and changes are always in sync.
 *
 * @returns List of skill names that were successfully injected.
 */
export async function injectPluginSkills(
  plugin: LoadedPlugin,
  userAlias: string,
): Promise<string[]> {
  const injected: string[] = [];
  // Dynamic import to avoid circular dependency

  const userSkillsDir = path.join(
    app.getPath('userData'), 'profiles', userAlias, 'skills',
  );
  if (!fs.existsSync(userSkillsDir)) {
    fs.mkdirSync(userSkillsDir, { recursive: true });
  }

  for (const skillDir of plugin.resolvedSkillPaths) {
    if (!fs.existsSync(skillDir)) {
      logger.warn(`[SkillBridge] Skill path not found for plugin "${plugin.id}": ${skillDir}`);
      continue;
    }

    const skillName = path.basename(skillDir);
    const scopedName = `plugin--${plugin.id}--${skillName}`;
    const linkPath = path.join(userSkillsDir, scopedName);

    try {
      // Create junction/symlink → plugin's original skill directory
      ensureDirectoryLink(linkPath, skillDir);

      // Register in profile (addSkill is an upsert)
      const skillConfig: SkillConfig = {
        name: scopedName,
        description: `Provided by plugin "${plugin.id}"`,
        version: plugin.manifest.version,
        source: 'PLUGIN' as const,
      };
      await profileCacheManager.addSkill(userAlias, skillConfig);

      injected.push(scopedName);
      logger.info(`[SkillBridge] Linked skill "${scopedName}" → ${skillDir}`);
    } catch (e) {
      logger.error(`[SkillBridge] Error injecting skill "${scopedName}": ${e}`);
    }
  }

  return injected;
}

/**
 * Remove all skills that were injected by a plugin.
 */
export async function removePluginSkills(
  plugin: LoadedPlugin,
  userAlias: string,
): Promise<void> {
  // Dynamic import to avoid circular dependency

  for (const skillName of plugin.injectedSkills) {
    try {
      const result = await deleteInstalledSkill(userAlias, skillName, { pluginBypass: true });
      if (result.success) {
        logger.info(`[SkillBridge] Removed plugin skill "${skillName}"`);
      } else {
        logger.warn(`[SkillBridge] Could not remove skill "${skillName}": ${result.error}`);
      }
    } catch (e) {
      logger.error(`[SkillBridge] Error removing skill "${skillName}": ${e}`);
    }
  }
}

/**
 * Check if a skill name belongs to a plugin (uses naming convention).
 */
export function isPluginSkill(skillName: string): boolean {
  return skillName.startsWith('plugin--');
}
