import { removeSkillsFromAgents } from '../../skill/removeSkillsFromAgents';
import { profileCacheManager } from '../../userDataADO';
import { BuiltinToolDefinition } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';

interface RemoveSkillsFromAgentsArgs {
  skill_names?: string[];
  agent_chat_ids?: string[];
  agent_names?: string[];
  remove_from_all?: boolean;
}

function normalizeSkillNames(skillNames?: string[]): string[] {
  return Array.from(new Set((skillNames || []).map(skill => skill?.trim()).filter((skill): skill is string => !!skill)));
}

/** @deprecated Use manage_skills instead. */
export class RemoveSkillsFromAgentsTool {
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'remove_skills_from_agents',
      description:
        'Remove one or more skills from agent configurations. ' +
        'By default it targets the current agent in the active single-agent chat. ' +
        'Use agent_chat_ids, agent_names, or remove_from_all to target other agents. ' +
        'This does not uninstall the skills from the device.',
      inputSchema: {
        type: 'object',
        properties: {
          skill_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of the skills to remove from the resolved agent configurations.',
          },
          agent_chat_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional chat IDs whose agents should be targeted.',
          },
          agent_names: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional agent names to target.',
          },
          remove_from_all: {
            type: 'boolean',
            description: 'Remove the skills from every agent in the profile.',
          },
        },
        required: ['skill_names'],
      },
    };
  }

  static async execute(args: RemoveSkillsFromAgentsArgs): Promise<Record<string, unknown>> {
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

    const hasExplicitTargets = !!args.remove_from_all
      || !!(args.agent_chat_ids && args.agent_chat_ids.length > 0)
      || !!(args.agent_names && args.agent_names.length > 0);

    if (!hasExplicitTargets) {
      const ctx = BuiltinToolsManager.getExecutionContext();
      if (!ctx?.chatId) {
        return {
          success: false,
          message: 'No active chat context. Specify agent_chat_ids, agent_names, or remove_from_all.',
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

      if (chatConfig.chat_type !== 'single_agent' || !chatConfig.agent?.name) {
        return {
          success: false,
          message: 'The current chat does not resolve to a single current agent. Specify agent_names to remove skills from a multi-agent chat.',
          error: 'AMBIGUOUS_CURRENT_AGENT',
        };
      }

      const result = await removeSkillsFromAgents(currentUserAlias, {
        skillNames,
        targets: [{ chatId: ctx.chatId, agentName: chatConfig.agent.name }],
      });

      return formatResult(result);
    }

    const result = await removeSkillsFromAgents(currentUserAlias, {
      skillNames,
      agentChatIds: args.agent_chat_ids,
      agentNames: args.agent_names,
      removeFromAll: args.remove_from_all,
    });

    return formatResult(result);
  }
}

function formatResult(
  result: Awaited<ReturnType<typeof removeSkillsFromAgents>>,
): Record<string, unknown> {
  return {
    success: result.success,
    message: result.message,
    skill_names: result.skillNames,
    updated_agent_count: result.updatedAgentCount,
    removed_binding_count: result.removedBindingCount,
    unchanged_target_count: result.unchangedTargetCount,
    failed_count: result.failedCount,
    updated_targets: result.updatedTargets,
    skipped_targets: result.skippedTargets,
    error: result.error,
  };
}