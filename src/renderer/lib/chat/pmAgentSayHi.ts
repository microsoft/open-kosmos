import { BRAND_NAME } from '@shared/constants/branding';
import {
  PM_AGENT_CANONICAL_NAME,
  generatePmAgentSayHiMessage,
} from '../../config/pmAgentSayHiConfig';
import { profileDataManager } from '../userData';
import { isBuiltinAgent } from '../userData/types';
import type { SayHiMessageConfig } from './startNewChatFor';

/**
 * Return the hardcoded say-hi config for the built-in PM Agent.
 * Returns undefined for all other agents.
 */
export function getPmAgentSayHiMessageConfig(
  chatId: string,
): SayHiMessageConfig | undefined {
  const chats = profileDataManager.getChatConfigs();
  const chat = chats.find(c => c.chat_id === chatId);
  const agentName = chat?.agent?.name;

  if (!agentName || agentName !== PM_AGENT_CANONICAL_NAME) return undefined;
  if (!isBuiltinAgent(agentName, BRAND_NAME)) return undefined;

  const userName = profileDataManager.getCurrentUserAlias() ?? 'there';
  return {
    markdownContent: generatePmAgentSayHiMessage(userName),
  };
}

/** @deprecated Use getPmAgentSayHiMessageConfig() + startNewChatFor() instead. */
export function trySetPmAgentSayHi(): void {
  // no-op compatibility shim during migration
}
