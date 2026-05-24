/**
 * manage_skills facade — unified skill management tool.
 *
 * Merges the legacy tools:
 *   apply_skill_to_agents, uninstall_skills, remove_skills_from_agents
 * into a single action-based interface.
 */

import {
  BuiltinToolDefinition,
  ManageSkillsInput,
  FacadeResult,
  errorResult,
  normalizeStringArray,
} from './types';
import { installAndActivateSkill } from '../../../skill/installAndActivateSkill';
import { ApplySkillToAgentsTool } from '../applySkillToAgentsTool';
import { UninstallSkillsTool } from '../uninstallSkillsTool';
import { RemoveSkillsFromAgentsTool } from '../removeSkillsFromAgentsTool';
import { profileCacheManager } from '../../../userDataADO';

const VALID_ACTIONS = ['install', 'uninstall', 'bind', 'unbind'] as const;

export class ManageSkillsFacade {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'manage_skills',
      description:
        'Install, uninstall, bind, or unbind skills. ' +
        '"install" downloads a skill to the device from the local device. ' +
        '"uninstall" removes a skill from the device. ' +
        '"bind" attaches an installed skill to one or more agents. ' +
        '"unbind" detaches a skill from agents without uninstalling it. ' +
        'When no agent targeting is specified for bind/unbind, defaults to the current agent.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: VALID_ACTIONS as unknown as string[],
            description:
              'install=download to device; uninstall=remove from device; bind=attach to agent(s); unbind=detach from agent(s)',
          },
          skill_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Target skill name(s)',
          },
          source: {
            type: 'string',
            enum: ['device'],
            description: 'Install source (only for action=install, default=device)',
          },
          path: {
            type: 'string',
            description:
              'Local absolute path to skill artifact (required when source=device)',
          },
          agent_names: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Target agent(s) for bind/unbind. Omit = current agent in active chat.',
          },
          all_agents: {
            type: 'boolean',
            description: 'Apply bind/unbind to all agents in profile',
          },
        },
        required: ['action', 'skill_names'],
      },
    };
  }

  static async execute(args: ManageSkillsInput): Promise<FacadeResult> {
    // --- Validate ---
    if (!args.action || !(VALID_ACTIONS as readonly string[]).includes(args.action)) {
      return errorResult(
        `Invalid action "${args.action}".`,
        `Valid actions: ${VALID_ACTIONS.join(', ')}`,
      );
    }

    const skillNames = normalizeStringArray(args.skill_names);
    if (skillNames.length === 0) {
      return errorResult(
        'skill_names is required and must contain at least one non-empty string.',
      );
    }

    // --- Route ---
    switch (args.action) {
      case 'install':
        return ManageSkillsFacade.handleInstall(skillNames, args);
      case 'uninstall':
        return ManageSkillsFacade.handleUninstall(skillNames);
      case 'bind':
        return ManageSkillsFacade.handleBind(skillNames, args);
      case 'unbind':
        return ManageSkillsFacade.handleUnbind(skillNames, args);
    }
  }

  // ---- Private action handlers ----

  private static async handleInstall(
    skillNames: string[],
    args: ManageSkillsInput,
  ): Promise<FacadeResult> {
    const source = args.source || 'device';

    if (!args.path || !args.path.trim()) {
      return errorResult(
        `"path" is required to install skills from device.`,
        'Provide the local absolute path to the skill artifact.',
      );
    }

    const results: Array<{ skill: string; success: boolean; message: string }> = [];

    for (const skillName of skillNames) {
      try {
        const installSource = { type: 'device-path' as const, value: args.path!.trim() };

        const result = await installAndActivateSkill({
          userAlias: ManageSkillsFacade.getCurrentUserAlias(),
          source: installSource,
          requestSource: 'chat-tool',
          activation: { mode: 'install-only' },
        });

        results.push({
          skill: skillName,
          success: result.success,
          message: result.message || (result.success ? 'Installed' : 'Failed'),
        });
      } catch (err) {
        results.push({
          skill: skillName,
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return {
      success: successCount > 0,
      message: `Installed ${successCount}/${skillNames.length} skill(s).`,
      results,
    };
  }

  private static async handleUninstall(skillNames: string[]): Promise<FacadeResult> {
    const result = await UninstallSkillsTool.execute({ skill_names: skillNames });
    return result as unknown as FacadeResult;
  }

  private static async handleBind(
    skillNames: string[],
    args: ManageSkillsInput,
  ): Promise<FacadeResult> {
    const results: Array<{ skill: string; success: boolean; message: string }> = [];

    for (const skillName of skillNames) {
      try {
        const legacyArgs: Record<string, unknown> = { skill_name: skillName };
        if (args.agent_names && args.agent_names.length > 0) {
          legacyArgs.agent_names = args.agent_names;
        }
        if (args.all_agents) {
          legacyArgs.apply_to_all = true;
        }

        const result = await ApplySkillToAgentsTool.execute(
          legacyArgs as any,
        );
        results.push({
          skill: skillName,
          success: (result as any).success ?? false,
          message: (result as any).message || '',
        });
      } catch (err) {
        results.push({
          skill: skillName,
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return {
      success: successCount > 0,
      message: `Bound ${successCount}/${skillNames.length} skill(s) to agent(s).`,
      results,
    };
  }

  private static async handleUnbind(
    skillNames: string[],
    args: ManageSkillsInput,
  ): Promise<FacadeResult> {
    const legacyArgs: Record<string, unknown> = { skill_names: skillNames };
    if (args.agent_names && args.agent_names.length > 0) {
      legacyArgs.agent_names = args.agent_names;
    }
    if (args.all_agents) {
      legacyArgs.remove_from_all = true;
    }

    const result = await RemoveSkillsFromAgentsTool.execute(legacyArgs as any);
    return result as unknown as FacadeResult;
  }

  // ---- Helpers ----

  private static getCurrentUserAlias(): string {
    const alias = (profileCacheManager as any).currentUserAlias as string | null;
    if (!alias) throw new Error('No current user session found. Please ensure you are logged in.');
    return alias;
  }
}
