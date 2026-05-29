import { createLogger } from '../../unifiedLogger';
import { chatSessionManager } from '../../userDataADO/chatSessionManager';
import { profileCacheManager } from '../../userDataADO/profileCacheManager';
import { agentChatManager } from '../../chat/agentChatManager';
import { BRAND_NAME } from '../../../../shared/constants/branding';
import type { Message } from '../../../../shared/types/chatTypes';
import type { ProfileV2, ChatConfig, SkillConfig } from '../../userDataADO/types/profile';
import type { OutboundMessage } from '../types';
import type { SessionEntry } from './types';
import { demoteSession, markSessionAsRemote, resolveChatId } from './sessionLifecycle';

const logger = createLogger();

// ── Context type for functions that need AgentBridge state ──

export interface BridgeContext {
  alias: string;
  sessionMap: Map<string, SessionEntry>;
  schedulePersist: () => void;
}

/**
 * Filter chats — returns all chats (no brand-specific exclusions).
 */
function filterChatsByBrand(chats: ChatConfig[]): ChatConfig[] {
  return chats;
}

// ── .switch command ──

export async function handleSwitchCommand(
  ctx: BridgeContext,
  trimmedText: string,
  channelId: string,
  sessionKey: string,
  conversationId: string,
): Promise<OutboundMessage> {
  const currentEntry = ctx.sessionMap.get(sessionKey);
  const currentChatSessionId = currentEntry?.chatSessionId;

  const recentSessions = await getAllRecentSessions(ctx.alias);

  if (recentSessions.length === 0) {
    return { text: 'No conversations available to switch to.', replyToConversationId: conversationId };
  }

  const parts = trimmedText.split(/\s+/);
  const indexArg = parts.length > 1 ? parseInt(parts[1], 10) : NaN;

  // Show multiple agents only when there are sessions from more than one agent
  const hasMultipleAgents = new Set(recentSessions.map(s => s.chatId)).size > 1;

  if (isNaN(indexArg)) {
    const lines = recentSessions.map((s, i) => {
      const time = new Date(s.last_updated).toLocaleString('en-US', { hour12: false });
      const current = s.chatSession_id === currentChatSessionId ? ' ✅' : '';
      const agentTag = hasMultipleAgents ? ` [${s.agentName}]` : '';
      return `${i + 1}. **${s.title}**${agentTag}${current}  \n    _${time}_`;
    });
    return {
      text:
        '**Recent Conversations**\n\n' +
        lines.join('\n\n') +
        '\n\n---\n\nReply `.switch <number>` to switch, e.g. `.switch 1`',
      replyToConversationId: conversationId,
    };
  }

  if (indexArg < 1 || indexArg > recentSessions.length) {
    return {
      text: `⚠️ Invalid number. Please enter a number between 1 and ${recentSessions.length}.`,
      replyToConversationId: conversationId,
    };
  }

  const targetSession = recentSessions[indexArg - 1];

  if (targetSession.chatSession_id === currentChatSessionId) {
    return {
      text: `Already in conversation "${targetSession.title}". No switch needed.`,
      replyToConversationId: conversationId,
    };
  }

  return switchToSession(ctx, targetSession.chatId, channelId, sessionKey, targetSession, conversationId);
}

// ── .agent command ──

export async function handleAgentCommand(
  ctx: BridgeContext,
  trimmedText: string,
  channelId: string,
  conversationId: string,
): Promise<OutboundMessage> {
  const profile = profileCacheManager.getCachedProfile(ctx.alias) as ProfileV2 | undefined;
  const allChats = filterChatsByBrand(profile?.chats || []);

  if (allChats.length === 0) {
    return { text: 'No agents available.', replyToConversationId: conversationId };
  }

  const currentBoundChatId = resolveChatId(ctx.alias, channelId);

  const parts = trimmedText.split(/\s+/);
  const indexArg = parts.length > 1 ? parseInt(parts[1], 10) : NaN;

  if (isNaN(indexArg)) {
    // LIST MODE: show all agents
    const lines = allChats.map((chat, i) => {
      const emoji = chat.agent?.emoji || '';
      const name = chat.agent?.name || chat.chat_id;
      const current = chat.chat_id === currentBoundChatId ? ' ✅' : '';
      return `${i + 1}. ${emoji} **${name}**${current}`;
    });
    return {
      text:
        '**Available Agents**\n\n' +
        lines.join('\n\n') +
        '\n\n---\n\nReply `.agent <number>` to select, e.g. `.agent 1`',
      replyToConversationId: conversationId,
    };
  }

  // SELECT MODE
  if (indexArg < 1 || indexArg > allChats.length) {
    return {
      text: `⚠️ Invalid number. Please enter a number between 1 and ${allChats.length}.`,
      replyToConversationId: conversationId,
    };
  }

  const targetChat = allChats[indexArg - 1];

  if (targetChat.chat_id === currentBoundChatId) {
    const name = targetChat.agent?.name || targetChat.chat_id;
    return {
      text: `Already using agent "${name}". No change needed.`,
      replyToConversationId: conversationId,
    };
  }

  // Update boundChatId via ProfileCacheManager (triggers frontend sync)
  await profileCacheManager.updateRemoteChannelsConfig(ctx.alias, {
    [channelId]: { boundChatId: targetChat.chat_id },
  });

  const emoji = targetChat.agent?.emoji || '';
  const name = targetChat.agent?.name || targetChat.chat_id;

  logger.info(`[AgentBridge] Agent switched: ${channelId} -> ${targetChat.chat_id} (${name})`);

  return {
    text:
      `Agent switched to ${emoji} **${name}**.\n\n` +
      '⚠️ This change will take effect when you start a new conversation with `.new`.\n' +
      'Your current conversation is not affected.',
    replyToConversationId: conversationId,
  };
}

// ── Helpers ──

interface SwitchableSession {
  chatId: string;
  chatSession_id: string;
  title: string;
  last_updated: string;
  agentName: string;
}

async function getAllRecentSessions(
  alias: string,
  limit: number = 10,
): Promise<SwitchableSession[]> {
  const profile = profileCacheManager.getCachedProfile(alias) as ProfileV2 | undefined;
  const allChats = filterChatsByBrand(profile?.chats || []);
  if (allChats.length === 0) return [];

  const results = await Promise.all(
    allChats.map(async (chat) => {
      const agentName = chat.agent?.name || chat.chat_id;
      const result = await chatSessionManager.getChatSessions(alias, chat.chat_id, limit);
      return result.sessions.map((s): SwitchableSession => ({
        chatId: chat.chat_id,
        chatSession_id: s.chatSession_id,
        title: s.title,
        last_updated: s.last_updated,
        agentName,
      }));
    }),
  );
  const all = results.flat();

  all.sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime());
  return all.slice(0, limit);
}

async function switchToSession(
  ctx: BridgeContext,
  chatId: string,
  channelId: string,
  sessionKey: string,
  targetSession: SwitchableSession,
  conversationId: string,
): Promise<OutboundMessage> {
  const existing = ctx.sessionMap.get(sessionKey);

  if (existing) {
    await demoteSession(ctx.alias, existing.chatId, existing.chatSessionId);
  }

  ctx.sessionMap.set(sessionKey, {
    chatId,
    chatSessionId: targetSession.chatSession_id,
    lastActiveAt: Date.now(),
  });
  ctx.schedulePersist();

  await markSessionAsRemote(ctx.alias, chatId, targetSession.chatSession_id, channelId);

  await agentChatManager.switchToChatSession(chatId, targetSession.chatSession_id);

  const preview = await getLastConversationPreview(ctx.alias, chatId, targetSession.chatSession_id);

  logger.info(`[AgentBridge] Switched session: ${sessionKey} -> ${targetSession.chatSession_id}`);

  let text = `Switched to **"${targetSession.title}"**`;
  if (preview) {
    text += `\n\n---\n\n🧑 **User:**\n\n${preview.userText}\n\n🤖 **${BRAND_NAME}:**\n\n${preview.assistantText}`;
  }

  return { text, replyToConversationId: conversationId };
}

async function getLastConversationPreview(
  alias: string,
  chatId: string,
  chatSessionId: string,
): Promise<{ userText: string; assistantText: string } | null> {
  const sessionFile = await chatSessionManager.getChatSessionFile(alias, chatId, chatSessionId);
  if (!sessionFile?.chat_history?.length) return null;

  const history = sessionFile.chat_history;
  const lastUser = [...history].reverse().find((m: Message) => m.role === 'user');
  const lastAssistant = [...history].reverse().find((m: Message) => m.role === 'assistant');

  if (!lastUser && !lastAssistant) return null;

  const extractText = (msg: Message | undefined): string => {
    if (!msg) return '(none)';
    const texts: string[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && (part as any).text) {
        texts.push((part as any).text);
      }
    }
    const full = texts.join('\n') || '(none)';
    return full.length > 500 ? full.substring(0, 500) + '...' : full;
  };

  return {
    userText: extractText(lastUser),
    assistantText: extractText(lastAssistant),
  };
}

// ── .skill command ──

export interface SkillInfo {
  index: number;
  name: string;
  description: string;
}

export function getAgentSkills(alias: string, chatId: string): SkillInfo[] {
  const profile = profileCacheManager.getCachedProfile(alias) as ProfileV2 | undefined;
  if (!profile) return [];

  const chat = profile.chats.find(c => c.chat_id === chatId);
  const skillNames: string[] = chat?.agent?.skills ?? [];
  const profileSkills: SkillConfig[] = profile.skills ?? [];

  const results: SkillInfo[] = [];
  let index = 1;
  for (const name of skillNames) {
    const config = profileSkills.find(s => s.name === name);
    if (config) {
      results.push({ index: index++, name: config.name, description: config.description });
    }
  }
  return results;
}

export function parseSkillMessage(
  rawText: string,
  skills: SkillInfo[],
): { ok: true; text: string } | { ok: false; error: string } {
  // Normalize full-width parentheses
  const normalized = rawText.replace(/（/g, '(').replace(/）/g, ')');

  let indicesStr: string | undefined;
  let body: string | undefined;

  const parenMatch = normalized.match(/^\.skill\s*\(\s*([^)]*)\s*\)\s*(.+)$/is);
  if (parenMatch) {
    indicesStr = parenMatch[1];
    body = parenMatch[2].trim();
  } else {
    const spaceMatch = normalized.match(/^\.skill\s+([\d,][\d,\s]*)\s+(.+)$/is);
    if (spaceMatch) {
      indicesStr = spaceMatch[1];
      body = spaceMatch[2].trim();
    }
  }

  if (!body) {
    return { ok: false, error: 'Please enter a message after skill selection. Example: `.skill(1) your message`' };
  }

  const rawParts = (indicesStr ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (rawParts.length === 0) {
    return { ok: false, error: 'Please specify a skill number. Example: `.skill(1) your message`' };
  }

  // Parse, validate, deduplicate
  const seen = new Set<number>();
  const chosen: SkillInfo[] = [];
  for (const part of rawParts) {
    if (!/^\d+$/.test(part)) {
      return { ok: false, error: 'Invalid skill number. Please use a number, e.g. `.skill(1) your message`' };
    }
    const n = parseInt(part, 10);
    if (n < 1 || n > skills.length) {
      return { ok: false, error: `Skill #${n} does not exist. Type \`.skill\` to see available skills.` };
    }
    if (!seen.has(n)) {
      seen.add(n);
      chosen.push(skills[n - 1]);
    }
  }

  const tags = chosen.map(s => `[#skill:${s.name}]`).join(' ');
  return { ok: true, text: `${tags} ${body}` };
}

export function handleSkillListCommand(
  ctx: BridgeContext,
  channelId: string,
  conversationId: string,
): OutboundMessage {
  const chatId = resolveChatId(ctx.alias, channelId);
  const skills = getAgentSkills(ctx.alias, chatId);

  if (skills.length === 0) {
    return { text: 'No skills configured for the current agent.', replyToConversationId: conversationId };
  }

  const lines = skills.map(s => `${s.index}. **${s.name}** — ${s.description}`);
  const text =
    '📋 **Available Skills**\n\n' +
    lines.join('\n\n') +
    '\n\n---\n\n' +
    'Usage: `.skill(number) your message`\n' +
    'Example: `.skill(1) help me review this code`\n' +
    'Multi-select: `.skill(1,3) help me review and optimize this SQL`';

  return { text, replyToConversationId: conversationId };
}

// ── .new command ──

export async function handleNewCommand(
  ctx: BridgeContext,
  sessionKey: string,
  conversationId: string,
): Promise<OutboundMessage> {
  const existing = ctx.sessionMap.get(sessionKey);
  if (existing) {
    await demoteSession(ctx.alias, existing.chatId, existing.chatSessionId);
  }
  ctx.sessionMap.delete(sessionKey);
  ctx.schedulePersist();
  logger.info(`[AgentBridge] Session reset by .new command: ${sessionKey}`);
  return {
    text: '__SESSION_DIVIDER__',
    replyToConversationId: conversationId,
  };
}
