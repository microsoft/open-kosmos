import { profileCacheManager } from '../userDataADO';
import { skillsConfigManager } from '../userDataADO/skillsConfigManager';
import { getChatAgents, getChatPrimaryAgent } from '../userDataADO/agentAccessor';
import type { ChatConfig } from '../userDataADO/types/profile';

interface AgentLike {
  name: string;
  skills?: string[];
}

export interface SkillAvailabilityArgs {
  userAlias: string;
  skillName: string;
  chatId?: string;
  agentName?: string;
}

export interface SkillAvailabilityResult {
  skillName: string;
  installed: boolean;
  appliedToCurrentAgent: boolean;
  callableInCurrentChat: boolean;
  currentAgentName?: string;
  reason?: 'CHAT_NOT_FOUND' | 'AGENT_NOT_RESOLVED';
}

function resolveAgent(chat: ChatConfig | undefined, preferredAgentName?: string): AgentLike | undefined {
  /* v8 ignore next 3 -- defensive guard: the sole caller (getSkillAvailability) already returns CHAT_NOT_FOUND before invoking resolveAgent, so chat is never undefined here */
  if (!chat) {
    return undefined;
  }

  if (chat.chat_type === 'single_agent') {
    return getChatPrimaryAgent(chat);
  }

  if (!preferredAgentName) {
    return undefined;
  }

  return getChatAgents(chat).find(agent => agent.name === preferredAgentName);
}

export function getSkillAvailability(args: SkillAvailabilityArgs): SkillAvailabilityResult {
  const skillName = args.skillName.trim();
  const installed = skillsConfigManager.hasSkill(args.userAlias, skillName);

  if (!args.chatId) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
    };
  }

  const chatConfig = profileCacheManager.getChatConfig(args.userAlias, args.chatId);
  if (!chatConfig) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
      reason: 'CHAT_NOT_FOUND',
    };
  }

  const resolvedAgent = resolveAgent(chatConfig, args.agentName);
  if (!resolvedAgent) {
    return {
      skillName,
      installed,
      appliedToCurrentAgent: false,
      callableInCurrentChat: false,
      reason: 'AGENT_NOT_RESOLVED',
    };
  }

  const appliedToCurrentAgent = (resolvedAgent.skills || []).includes(skillName);
  return {
    skillName,
    installed,
    appliedToCurrentAgent,
    callableInCurrentChat: installed && appliedToCurrentAgent,
    currentAgentName: resolvedAgent.name,
  };
}