import { createLogger } from '../unifiedLogger';
import { profileCacheManager } from '../userDataADO';
import type { ChatAgent, ChatConfig } from '../userDataADO/types/profile';

const logger = createLogger();

export interface SkillAgentTarget {
  chatId: string;
  agentName: string;
}

export interface ApplySkillToAgentsOptions {
  skillName: string;
  targets?: SkillAgentTarget[];
  agentChatIds?: string[];
  agentNames?: string[];
  applyToAll?: boolean;
  requestSource?: string;
}

export interface ApplySkillToAgentsResult {
  success: boolean;
  skillName: string;
  message: string;
  appliedCount: number;
  alreadyAppliedCount: number;
  failedCount: number;
  appliedTargets: SkillAgentTarget[];
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

function resolveTargets(chats: ChatConfig[], options: ApplySkillToAgentsOptions): SkillAgentTarget[] {
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
  const shouldApplyToAll = options.applyToAll === true;

  if (!shouldApplyToAll && chatIds.size === 0 && agentNames.size === 0) {
    return [];
  }

  const resolved: SkillAgentTarget[] = [];
  for (const chat of chats) {
    if (!shouldApplyToAll && chatIds.size > 0 && !chatIds.has(chat.chat_id)) {
      continue;
    }

    for (const agent of getChatAgents(chat)) {
      if (!shouldApplyToAll && agentNames.size > 0 && !agentNames.has(agent.name)) {
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

export async function applySkillToAgents(
  userAlias: string,
  options: ApplySkillToAgentsOptions,
): Promise<ApplySkillToAgentsResult> {
  const skillName = options.skillName?.trim();
  if (!skillName) {
    return {
      success: false,
      skillName: options.skillName || '',
      message: 'skillName is required',
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'INVALID_INPUT',
    };
  }

  const profile = profileCacheManager.getCachedProfile(userAlias);
  if (!profile || !Array.isArray(profile.skills)) {
    return {
      success: false,
      skillName,
      message: 'User profile not found or does not support skills',
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'PROFILE_NOT_FOUND',
    };
  }

  const installedSkill = profile.skills.find(skill => skill.name === skillName);
  if (!installedSkill) {
    return {
      success: false,
      skillName,
      message: `Skill "${skillName}" is not added to the profile's global skill list.`,
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'SKILL_NOT_INSTALLED',
    };
  }

  const resolvedTargets = resolveTargets(profile.chats || [], options);
  if (resolvedTargets.length === 0) {
    return {
      success: false,
      skillName,
      message: 'No target agents resolved for skill application.',
      appliedCount: 0,
      alreadyAppliedCount: 0,
      failedCount: 0,
      appliedTargets: [],
      skippedTargets: [],
      error: 'NO_TARGETS',
    };
  }

  const skippedTargets: Array<SkillAgentTarget & { reason: string }> = [];
  const appliedTargets: SkillAgentTarget[] = [];
  let alreadyAppliedCount = 0;
  let failedCount = 0;

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
      if (currentSkills.includes(skillName)) {
        alreadyAppliedCount += 1;
        skippedTargets.push({ chatId, agentName: agent.name, reason: 'ALREADY_APPLIED' });
        continue;
      }

      const updatedAgent: ChatAgent = {
        ...agent,
        skills: [...currentSkills, skillName],
      };

      const success = await profileCacheManager.updateChatConfig(userAlias, chatId, {
        agent: updatedAgent,
        skill_snapshot: undefined,
      });

      if (success) {
        appliedTargets.push({ chatId, agentName: agent.name });
      } else {
        failedCount += 1;
        skippedTargets.push({ chatId, agentName: agent.name, reason: 'UPDATE_FAILED' });
      }

      continue;
    }

    const currentAgents = chat.agents || [];
    let didChange = false;
    const updatedAgents = currentAgents.map(agent => {
      if (!agentNames.has(agent.name)) {
        return agent;
      }

      const currentSkills = agent.skills || [];
      if (currentSkills.includes(skillName)) {
        alreadyAppliedCount += 1;
        skippedTargets.push({ chatId, agentName: agent.name, reason: 'ALREADY_APPLIED' });
        return agent;
      }

      didChange = true;
      return {
        ...agent,
        skills: [...currentSkills, skillName],
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
      const alreadyTracked = skippedTargets.some(target => target.chatId === chatId && target.agentName === agentName && target.reason === 'ALREADY_APPLIED');
      if (alreadyTracked) {
        continue;
      }

      if (success) {
        appliedTargets.push({ chatId, agentName });
      } else {
        failedCount += 1;
        skippedTargets.push({ chatId, agentName, reason: 'UPDATE_FAILED' });
      }
    }
  }

  logger.info('[applySkillToAgents] Completed skill application', 'applySkillToAgents', {
    skillName,
    appliedCount: appliedTargets.length,
    alreadyAppliedCount,
    failedCount,
    skippedCount: skippedTargets.length,
  });

  const success = appliedTargets.length > 0 && failedCount === 0;
  const message = appliedTargets.length > 0
    ? `Applied skill "${skillName}" to ${appliedTargets.length} agent${appliedTargets.length === 1 ? '' : 's'}.`
    : skippedTargets.length > 0 && failedCount === 0
      ? `Skill "${skillName}" was already applied to all resolved target agents.`
      : `Failed to apply skill "${skillName}" to the requested agents.`;

  return {
    success,
    skillName,
    message,
    appliedCount: appliedTargets.length,
    alreadyAppliedCount,
    failedCount,
    appliedTargets,
    skippedTargets,
    error: success ? undefined : (appliedTargets.length === 0 ? 'NO_AGENT_UPDATES' : 'PARTIAL_FAILURE'),
  };
}