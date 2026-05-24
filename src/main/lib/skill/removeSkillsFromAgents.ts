import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from '../userDataADO';
import type { ChatAgent, ChatConfig } from '../userDataADO/types/profile';

const logger = createLogger();

export interface SkillAgentTarget {
  chatId: string;
  agentName: string;
}

export interface RemoveSkillsFromAgentsOptions {
  skillNames: string[];
  targets?: SkillAgentTarget[];
  agentChatIds?: string[];
  agentNames?: string[];
  removeFromAll?: boolean;
}

export interface RemoveSkillsFromAgentsResult {
  success: boolean;
  skillNames: string[];
  message: string;
  updatedAgentCount: number;
  removedBindingCount: number;
  unchangedTargetCount: number;
  failedCount: number;
  updatedTargets: Array<SkillAgentTarget & { removedSkills: string[] }>;
  skippedTargets: Array<SkillAgentTarget & { reason: string }>;
  error?: string;
}

function normalizeStringArray(values?: string[]): string[] {
  return Array.from(new Set((values || []).map(value => value?.trim()).filter((value): value is string => !!value)));
}

function getChatAgents(chat: ChatConfig): ChatAgent[] {
  if (chat.chat_type === 'single_agent') {
    return chat.agent ? [chat.agent] : [];
  }

  return chat.agents || [];
}

function targetKey(target: SkillAgentTarget): string {
  return `${target.chatId}::${target.agentName}`;
}

function resolveTargets(chats: ChatConfig[], options: RemoveSkillsFromAgentsOptions): SkillAgentTarget[] {
  if (options.targets && options.targets.length > 0) {
    return Array.from(
      new Map(
        options.targets
          .filter(target => target.chatId?.trim() && target.agentName?.trim())
          .map(target => [targetKey({ chatId: target.chatId.trim(), agentName: target.agentName.trim() }), {
            chatId: target.chatId.trim(),
            agentName: target.agentName.trim(),
          }]),
      ).values(),
    );
  }

  const chatIds = new Set(normalizeStringArray(options.agentChatIds));
  const agentNames = new Set(normalizeStringArray(options.agentNames));
  const shouldRemoveFromAll = options.removeFromAll === true;

  if (!shouldRemoveFromAll && chatIds.size === 0 && agentNames.size === 0) {
    return [];
  }

  const resolved: SkillAgentTarget[] = [];
  for (const chat of chats) {
    if (!shouldRemoveFromAll && chatIds.size > 0 && !chatIds.has(chat.chat_id)) {
      continue;
    }

    for (const agent of getChatAgents(chat)) {
      if (!shouldRemoveFromAll && agentNames.size > 0 && !agentNames.has(agent.name)) {
        continue;
      }

      resolved.push({
        chatId: chat.chat_id,
        agentName: agent.name,
      });
    }
  }

  return Array.from(new Map(resolved.map(target => [targetKey(target), target])).values());
}

export async function removeSkillsFromAgents(
  userAlias: string,
  options: RemoveSkillsFromAgentsOptions,
): Promise<RemoveSkillsFromAgentsResult> {
  const skillNames = normalizeStringArray(options.skillNames);
  if (skillNames.length === 0) {
    return {
      success: false,
      skillNames: [],
      message: 'skillNames is required',
      updatedAgentCount: 0,
      removedBindingCount: 0,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [],
      skippedTargets: [],
      error: 'INVALID_INPUT',
    };
  }

  const profile = profileCacheManager.getCachedProfile(userAlias);
  if (!profile || !Array.isArray(profile.chats)) {
    return {
      success: false,
      skillNames,
      message: 'User profile not found or does not support chats',
      updatedAgentCount: 0,
      removedBindingCount: 0,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [],
      skippedTargets: [],
      error: 'PROFILE_NOT_FOUND',
    };
  }

  const resolvedTargets = resolveTargets(profile.chats, {
    ...options,
    skillNames,
  });

  if (resolvedTargets.length === 0) {
    return {
      success: false,
      skillNames,
      message: 'No target agents resolved for skill removal.',
      updatedAgentCount: 0,
      removedBindingCount: 0,
      unchangedTargetCount: 0,
      failedCount: 0,
      updatedTargets: [],
      skippedTargets: [],
      error: 'NO_TARGETS',
    };
  }

  const skillNameSet = new Set(skillNames);
  const skippedTargets: Array<SkillAgentTarget & { reason: string }> = [];
  const updatedTargets: Array<SkillAgentTarget & { removedSkills: string[] }> = [];
  let unchangedTargetCount = 0;
  let failedCount = 0;
  let removedBindingCount = 0;

  const chatMap = new Map(profile.chats.map(chat => [chat.chat_id, chat]));
  const targetsByChat = new Map<string, Set<string>>();

  for (const target of resolvedTargets) {
    const chat = chatMap.get(target.chatId);
    if (!chat) {
      skippedTargets.push({ ...target, reason: 'CHAT_NOT_FOUND' });
      continue;
    }

    const availableNames = new Set(getChatAgents(chat).map(agent => agent.name));
    if (!availableNames.has(target.agentName)) {
      skippedTargets.push({ ...target, reason: 'AGENT_NOT_FOUND' });
      continue;
    }

    const targetNames = targetsByChat.get(target.chatId) || new Set<string>();
    targetNames.add(target.agentName);
    targetsByChat.set(target.chatId, targetNames);
  }

  for (const [chatId, agentNames] of targetsByChat.entries()) {
    const chat = chatMap.get(chatId);
    if (!chat) {
      continue;
    }

    if (chat.chat_type === 'single_agent') {
      const agent = chat.agent;
      if (!agent || !agentNames.has(agent.name)) {
        continue;
      }

      const currentSkills = agent.skills || [];
      const removedSkills = currentSkills.filter(skill => skillNameSet.has(skill));

      if (removedSkills.length === 0) {
        unchangedTargetCount += 1;
        skippedTargets.push({ chatId, agentName: agent.name, reason: 'SKILLS_NOT_APPLIED' });
        continue;
      }

      const updatedAgent: ChatAgent = {
        ...agent,
        skills: currentSkills.filter(skill => !skillNameSet.has(skill)),
      };

      const success = await profileCacheManager.updateChatConfig(userAlias, chatId, {
        agent: updatedAgent,
        skill_snapshot: undefined,
      });

      if (success) {
        updatedTargets.push({ chatId, agentName: agent.name, removedSkills });
        removedBindingCount += removedSkills.length;
      } else {
        failedCount += 1;
        skippedTargets.push({ chatId, agentName: agent.name, reason: 'UPDATE_FAILED' });
      }

      continue;
    }

    const currentAgents = chat.agents || [];
    const removedByAgent = new Map<string, string[]>();
    let didChange = false;

    const updatedAgents = currentAgents.map(agent => {
      if (!agentNames.has(agent.name)) {
        return agent;
      }

      const currentSkills = agent.skills || [];
      const removedSkills = currentSkills.filter(skill => skillNameSet.has(skill));
      if (removedSkills.length === 0) {
        unchangedTargetCount += 1;
        skippedTargets.push({ chatId, agentName: agent.name, reason: 'SKILLS_NOT_APPLIED' });
        return agent;
      }

      didChange = true;
      removedByAgent.set(agent.name, removedSkills);
      return {
        ...agent,
        skills: currentSkills.filter(skill => !skillNameSet.has(skill)),
      };
    });

    if (!didChange) {
      continue;
    }

    const success = await profileCacheManager.updateChatConfig(userAlias, chatId, {
      agents: updatedAgents,
      skill_snapshot: undefined,
    });

    for (const agentName of agentNames) {
      const removedSkills = removedByAgent.get(agentName);
      if (!removedSkills) {
        continue;
      }

      if (success) {
        updatedTargets.push({ chatId, agentName, removedSkills });
        removedBindingCount += removedSkills.length;
      } else {
        failedCount += 1;
        skippedTargets.push({ chatId, agentName, reason: 'UPDATE_FAILED' });
      }
    }
  }

  logger.info('[removeSkillsFromAgents] Completed skill removal from agents', 'removeSkillsFromAgents', {
    skillNames,
    updatedAgentCount: updatedTargets.length,
    removedBindingCount,
    unchangedTargetCount,
    failedCount,
    skippedCount: skippedTargets.length,
  });

  const success = updatedTargets.length > 0 && failedCount === 0;
  const message = updatedTargets.length > 0
    ? `Removed ${removedBindingCount} skill binding${removedBindingCount === 1 ? '' : 's'} from ${updatedTargets.length} agent${updatedTargets.length === 1 ? '' : 's'}.`
    : skippedTargets.length > 0 && failedCount === 0
      ? 'The requested skills were not applied to any resolved target agents.'
      : 'Failed to remove the requested skills from the target agents.';

  return {
    success,
    skillNames,
    message,
    updatedAgentCount: updatedTargets.length,
    removedBindingCount,
    unchangedTargetCount,
    failedCount,
    updatedTargets,
    skippedTargets,
    error: success ? undefined : (updatedTargets.length === 0 ? 'NO_AGENT_UPDATES' : 'PARTIAL_FAILURE'),
  };
}