import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { isBuiltinSkill } from '../../../shared/constants/builtinSkills';
import { isPluginSkill } from '../plugin/bridges/skillBridge';
import { profileCacheManager } from '../userDataADO';

export interface DeleteInstalledSkillResult {
  success: boolean;
  skillName: string;
  skillPath?: string;
  removedFromDisk: boolean;
  error?: 'BUILTIN_SKILL' | 'PLUGIN_SKILL' | 'DELETE_PROFILE_FAILED' | 'DELETE_FILES_FAILED';
}

export async function deleteInstalledSkill(
  userAlias: string,
  skillName: string,
  options?: { pluginBypass?: boolean },
): Promise<DeleteInstalledSkillResult> {
  const normalizedSkillName = skillName.trim();

  if (isBuiltinSkill(normalizedSkillName)) {
    return {
      success: false,
      skillName: normalizedSkillName,
      removedFromDisk: false,
      error: 'BUILTIN_SKILL',
    };
  }

  // 🔌 Protect plugin skills: cannot be deleted by user — uninstall the plugin instead
  if (!options?.pluginBypass && isPluginSkill(normalizedSkillName)) {
    return {
      success: false,
      skillName: normalizedSkillName,
      removedFromDisk: false,
      error: 'PLUGIN_SKILL',
    };
  }

  const deletedFromProfile = await profileCacheManager.deleteSkill(userAlias, normalizedSkillName);
  if (!deletedFromProfile) {
    return {
      success: false,
      skillName: normalizedSkillName,
      removedFromDisk: false,
      error: 'DELETE_PROFILE_FAILED',
    };
  }

  const skillPath = path.join(
    app.getPath('userData'),
    'profiles',
    userAlias,
    'skills',
    normalizedSkillName,
  );

  try {
    const existedOnDisk = fs.existsSync(skillPath);
    if (existedOnDisk) {
      // Symlink/junction safety: on Windows, rmSync({ recursive: true }) traverses
      // junctions and deletes the target's actual files. Use unlinkSync for links.
      const stat = fs.lstatSync(skillPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(skillPath);
      } else {
        fs.rmSync(skillPath, { recursive: true, force: true });
      }
    }

    return {
      success: true,
      skillName: normalizedSkillName,
      skillPath,
      removedFromDisk: existedOnDisk,
    };
  } catch {
    return {
      success: false,
      skillName: normalizedSkillName,
      skillPath,
      removedFromDisk: false,
      error: 'DELETE_FILES_FAILED',
    };
  }
}