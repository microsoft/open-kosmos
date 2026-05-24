import { deleteInstalledSkill } from '../../skill/deleteInstalledSkill';
import { profileCacheManager } from '../../userDataADO';
import { BuiltinToolDefinition } from './types';

interface UninstallSkillsArgs {
  skill_names?: string[];
}

function normalizeSkillNames(skillNames?: string[]): string[] {
  return Array.from(new Set((skillNames || []).map(skill => skill?.trim()).filter((skill): skill is string => !!skill)));
}

/** @deprecated Use manage_skills instead. */
export class UninstallSkillsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'uninstall_skills',
      description:
        'Uninstall one or more locally installed skills from the current profile. ' +
        'This removes the global skill configuration and the local skill directory from disk, and does not remove the skill name from any agent configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          skill_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of the locally installed skills to uninstall.',
          },
        },
        required: ['skill_names'],
      },
    };
  }

  static async execute(args: UninstallSkillsArgs): Promise<Record<string, unknown>> {
    const skillNames = normalizeSkillNames(args.skill_names);
    if (skillNames.length === 0) {
      return {
        success: false,
        message: 'Invalid input: skill_names must contain at least one non-empty string.',
        error: 'INVALID_INPUT',
      };
    }

    const currentUserAlias = (profileCacheManager as any).currentUserAlias as string | null;
    if (!currentUserAlias) {
      return {
        success: false,
        message: 'No current user session found. Please ensure you are logged in.',
        error: 'NO_USER_SESSION',
      };
    }

    const profile = profileCacheManager.getCachedProfile(currentUserAlias);
    if (!profile || !Array.isArray(profile.skills)) {
      return {
        success: false,
        message: 'Current profile does not have a skill registry.',
        error: 'PROFILE_NOT_FOUND',
      };
    }

    const installedSkillNames = new Set(profile.skills.map(skill => skill.name));
    const uninstalledSkills: string[] = [];
    const skippedSkills: Array<{ skill_name: string; reason: string }> = [];

    for (const skillName of skillNames) {
      if (!installedSkillNames.has(skillName)) {
        skippedSkills.push({ skill_name: skillName, reason: 'NOT_INSTALLED' });
        continue;
      }

      const deleteResult = await deleteInstalledSkill(currentUserAlias, skillName);
      if (deleteResult.success) {
        uninstalledSkills.push(skillName);
        installedSkillNames.delete(skillName);
      } else {
        skippedSkills.push({
          skill_name: skillName,
          reason: deleteResult.error === 'BUILTIN_SKILL' ? 'BUILTIN_SKILL' : 'DELETE_FAILED',
        });
      }
    }

    const success = skippedSkills.every(item => item.reason !== 'DELETE_FAILED') && uninstalledSkills.length > 0;
    const message = uninstalledSkills.length > 0
      ? `Uninstalled ${uninstalledSkills.length} skill${uninstalledSkills.length === 1 ? '' : 's'} from the current profile. Agent skill references were not changed.`
      : 'No skills were uninstalled from the current profile.';

    return {
      success,
      message,
      uninstalled_count: uninstalledSkills.length,
      uninstalled_skills: uninstalledSkills,
      skipped_skills: skippedSkills,
      error: success ? undefined : (uninstalledSkills.length === 0 ? 'NO_SKILLS_UNINSTALLED' : 'PARTIAL_FAILURE'),
    };
  }
}