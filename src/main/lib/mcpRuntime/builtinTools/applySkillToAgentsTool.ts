import { applySkillToAgents } from '../../skill/applySkillToAgents';
import { installAndActivateSkill } from '../../skill/installAndActivateSkill';
import { profileCacheManager } from '../../userDataADO';
import { BuiltinToolDefinition } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';

interface ApplySkillToAgentsArgs {
  skill_name?: string;
  path?: string;
  source?: 'device';
  agent_chat_ids?: string[];
  agent_names?: string[];
  apply_to_all?: boolean;
}

/** @deprecated Use manage_skills instead. */
export class ApplySkillToAgentsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'apply_skill_to_agents',
      description:
        'Apply a skill to one or more agents. ' +
        'If the skill is already globally installed, it is applied directly. ' +
        'If not installed, provide path (source=device) to install it first, then apply. ' +
        'When no agent targeting is specified, defaults to the current agent in the active chat.',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: 'Skill name. Used as the installed-skill identifier.',
          },
          path: {
            type: 'string',
            description: 'Absolute path to a local skill artifact (folder, .zip, or .skill). Required when source=device for uninstalled skills.',
          },
          source: {
            type: 'string',
            enum: ['device'],
            description: 'Installation source for uninstalled skills. Requires path to be provided.',
          },
          agent_chat_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional chat IDs to target.',
          },
          agent_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional agent names to target.',
          },
          apply_to_all: {
            type: 'boolean',
            description: 'Apply the skill to every agent in the profile.',
          },
        },
        required: ['skill_name'],
      },
    };
  }

  static async execute(args: ApplySkillToAgentsArgs): Promise<Record<string, unknown>> {
    if (!args.skill_name || typeof args.skill_name !== 'string' || !args.skill_name.trim()) {
      return {
        success: false,
        message: 'Invalid input: skill_name is required and must be a non-empty string.',
        error: 'INVALID_INPUT',
      };
    }

    const skillName = args.skill_name.trim();

    const currentUserAlias = (profileCacheManager as any).currentUserAlias as string | null;
    if (!currentUserAlias) {
      return {
        success: false,
        message: 'No current user session found. Please ensure you are logged in.',
        error: 'NO_USER_SESSION',
      };
    }

    // ---------- Check if skill is globally installed ----------
    const profile = profileCacheManager.getCachedProfile(currentUserAlias);
    const isInstalled = profile && Array.isArray(profile.skills) &&
      profile.skills.some(s => s.name === skillName);

    // ---------- If not installed, install first ----------
    if (!isInstalled) {
      if (!args.path || !args.path.trim()) {
        return {
          success: false,
          message: `Skill "${skillName}" is not installed. Provide a path to install from a local artifact.`,
          error: 'SKILL_NOT_INSTALLED',
        };
      }

      const installResult = await installAndActivateSkill({
        userAlias: currentUserAlias,
        source: { type: 'device-path', value: args.path!.trim() },
        requestSource: 'chat-tool',
        activation: { mode: 'install-only' },
      });

      if (!installResult.success) {
        return {
          success: false,
          message: installResult.message || `Failed to install skill "${skillName}".`,
          error: installResult.error || 'INSTALL_FAILED',
          install_attempted: true,
        };
      }
    }

    // ---------- Determine targeting ----------
    const hasExplicitTargets = args.agent_chat_ids || args.agent_names || args.apply_to_all;

    if (!hasExplicitTargets) {
      // Default: current agent in current chat
      const ctx = BuiltinToolsManager.getExecutionContext();
      if (!ctx?.chatId) {
        return {
          success: false,
          message: 'No active chat context. Specify agent_chat_ids, agent_names, or apply_to_all.',
          error: 'NO_CONTEXT',
        };
      }

      const chatConfig = profileCacheManager.getChatConfig(currentUserAlias, ctx.chatId);
      if (!chatConfig) {
        return {
          success: false,
          message: 'Current chat not found.',
          error: 'CHAT_NOT_FOUND',
        };
      }

      const agentName = chatConfig.chat_type === 'single_agent'
        ? chatConfig.agent?.name
        : undefined;

      const result = await applySkillToAgents(currentUserAlias, {
        skillName,
        agentChatIds: [ctx.chatId],
        agentNames: agentName ? [agentName] : undefined,
        requestSource: 'chat-tool',
      });

      return formatResult(result, !isInstalled);
    }

    // ---------- Apply with explicit targeting ----------
    const result = await applySkillToAgents(currentUserAlias, {
      skillName,
      agentChatIds: args.agent_chat_ids,
      agentNames: args.agent_names,
      applyToAll: args.apply_to_all,
      requestSource: 'chat-tool',
    });

    return formatResult(result, !isInstalled);
  }
}

function formatResult(
  result: Awaited<ReturnType<typeof applySkillToAgents>>,
  wasInstalled: boolean,
): Record<string, unknown> {
  return {
    success: result.success,
    message: result.message,
    skill_name: result.skillName,
    installed_in_this_call: wasInstalled,
    applied_count: result.appliedCount,
    already_applied_count: result.alreadyAppliedCount,
    failed_count: result.failedCount,
    applied_targets: result.appliedTargets,
    skipped_targets: result.skippedTargets,
    error: result.error,
  };
}