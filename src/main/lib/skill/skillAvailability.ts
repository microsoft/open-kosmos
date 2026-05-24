import { profileCacheManager } from '../userDataADO';

interface AgentLike {
  name: string;
  skills?: string[];
}

interface ChatLike {
  chat_type: 'single_agent' | 'multi_agent';
  agent?: AgentLike;
  agents?: AgentLike[];
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

function resolveAgent(chat: ChatLike | undefined, preferredAgentName?: string): AgentLike | undefined {
  if (!chat) {
    return undefined;
  }

  if (chat.chat_type === 'single_agent') {
    return chat.agent;
  }

  if (!preferredAgentName) {
    return undefined;
  }

  return chat.agents?.find(agent => agent.name === preferredAgentName);
}

export function getSkillAvailability(args: SkillAvailabilityArgs): SkillAvailabilityResult {
  const skillName = args.skillName.trim();
  const profile = profileCacheManager.getCachedProfile(args.userAlias);
  const installed = !!profile?.skills?.some(skill => skill.name === skillName);

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

  const resolvedAgent = resolveAgent(chatConfig as ChatLike, args.agentName);
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