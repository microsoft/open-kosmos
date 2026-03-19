/**
 * Check Skill Status Tool
 * Check the status of a Skill by its name
 * 
 * Status types:
 * - NotAdded: Skill not added to profile's global skill list
 * - Added: Skill has been added to profile's global skill list
 */

import { BuiltinToolDefinition } from './types';
import { profileCacheManager } from '../../userDataADO';

/**
 * Skill status type
 */
export type SkillStatus = 'NotAdded' | 'Added';

/**
 * Tool input arguments interface
 */
interface CheckSkillStatusArgs {
  /** Skill name */
  skill_name: string;
}

/**
 * Tool execution result interface
 */
interface CheckSkillStatusResult {
  success: boolean;
  skill_name: string;
  status: SkillStatus;
  message: string;
  details?: {
    /** Skill version (if added) */
    version?: string;
    /** Skill description (if added) */
    description?: string;
  };
}

/**
 * Check Skill Status Tool Implementation
 */
export class CheckSkillStatusTool {
  /**
   * Get tool definition (MCP compatible format)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'check_skill_status',
      description: 'Check the status of a skill by its name. Returns one of the following statuses: NotAdded (skill not added to profile\'s global skill list), or Added (skill has been added to profile\'s global skill list).',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'The name of the skill to check status for'
          }
        },
        required: ['skill_name']
      }
    };
  }

  /**
   * Execute the tool
   * 
   * @param args Tool arguments
   * @returns Execution result
   */
  static async execute(args: CheckSkillStatusArgs): Promise<CheckSkillStatusResult> {
    try {
      // Validate input parameters
      if (!args.skill_name|| typeof args.skill_name !== 'string' || !args.skill_name.trim()) {
        return {
          success: false,
          skill_name: args.skill_name || '',
          status: 'NotAdded',
          message: 'Invalid input: skill_name is required and must be a non-empty string'
        };
      }

      const skillName = args.skill_name.trim();

      // Get the current user alias
      const currentUserAlias = (profileCacheManager as any).currentUserAlias;
      if (!currentUserAlias) {
        return {
          success: false,
          skill_name: skillName,
          status: 'NotAdded',
          message: 'No active user session found. Please sign in first.'
        };
      }

      // Get the user's profile
      const profile = profileCacheManager.getCachedProfile(currentUserAlias);
      if (!profile) {
        return {
          success: false,
          skill_name: skillName,
          status: 'NotAdded',
          message: 'User profile not found.'
        };
      }

      // Check if the profile contains the skills field (V2 profile)
      if (!('skills' in profile) || !Array.isArray((profile as any).skills)) {
        return {
          success: true,
          skill_name: skillName,
          status: 'NotAdded',
          message: `Skill "${skillName}" is not added. Profile does not support skills feature.`
        };
      }

      const skills = (profile as any).skills as Array<{
        name: string;
        description: string;
        version: string;
      }>;

      // Find the skill with the specified name in the skills list
      const foundSkill = skills.find(skill => skill.name === skillName);

      if (foundSkill) {
        // Skill is added
        return {
          success: true,
          skill_name: skillName,
          status: 'Added',
          message: `Skill "${skillName}" is added to the profile's global skill list.`,
          details: {
            version: foundSkill.version,
            description: foundSkill.description
          }
        };
      } else {
        // Skill is not added
        return {
          success: true,
          skill_name: skillName,
          status: 'NotAdded',
          message: `Skill "${skillName}" is not added to the profile's global skill list.`
        };
      }

    } catch (error) {
      return {
        success: false,
        skill_name: args.skill_name || '',
        status: 'NotAdded',
        message: `Error checking skill status: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}