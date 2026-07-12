import type { ProfileV2 } from './types/profile';

export function findAgentlessActiveChatIds(profile: ProfileV2): string[] {
  const chats = Array.isArray(profile.chats) ? profile.chats : [];
  return chats
    .filter((chat) => {
      const hasAgentIds = Array.isArray(chat.agent_ids) && chat.agent_ids.length > 0;
      const hasInlineAgent = Boolean(chat.agent);
      const hasInlineAgents = Array.isArray(chat.agents) && chat.agents.length > 0;
      return !hasAgentIds && !hasInlineAgent && !hasInlineAgents;
    })
    .map((chat) => chat.chat_id || '<missing-chat-id>');
}
