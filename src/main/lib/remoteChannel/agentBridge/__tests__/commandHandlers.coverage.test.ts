/**
 * commandHandlers coverage supplement — targets switchToSession and
 * getLastConversationPreview code paths not reached by the base test file.
 */

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
  APP_NAME: 'OpenKosmos',
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCachedProfile: vi.fn(),
    syncStarredChatSessionIndex: vi.fn().mockResolvedValue(undefined),
    updateRemoteChannelsConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    patchMetadata: vi.fn(),
    renameSession: vi.fn(),
    ensureLoaded: vi.fn(),
    getAllSessions: vi.fn(),
    createSession: vi.fn(),
  },
}));

vi.mock('../../../chat/agentChatManager', () => ({
  AgentChatManager: {
    getInstance: vi.fn(() => ({
      updateSessionTitle: vi.fn(),
    })),
  },
  agentChatManager: {
    switchToChatSession: vi.fn().mockResolvedValue(undefined),
    generateChatSessionId: vi.fn(() => 'new-session-id'),
    getInstanceByChatSessionId: vi.fn(() => null),
    streamMessage: vi.fn().mockResolvedValue({ success: true, data: [] }),
  },
}));

vi.mock('../../../userDataADO/types/profile', () => ({
  isBuiltinAgent: vi.fn(() => false),
}));

vi.mock('../../../userDataADO/chatSessionManager', () => ({
  chatSessionManager: {
    getChatSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    getChatSessionFile: vi.fn().mockResolvedValue(null),
  },
}));

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { profileCacheManager } from '../../../userDataADO/profileCacheManager';
import { chatSessionManager } from '../../../userDataADO/chatSessionManager';
import { chatSessionStore } from '../../../chat/chatSessionStore';
import {
  handleSwitchCommand,
  type BridgeContext,
} from '../commandHandlers';

function makeBridgeContext(overrides: Partial<BridgeContext> = {}): BridgeContext {
  return {
    alias: 'user1',
    sessionMap: new Map(),
    schedulePersist: vi.fn(),
    ...overrides,
  };
}

describe('handleSwitchCommand — switchToSession coverage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('switches to a different session and returns preview when available', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'New Session', last_updated: new Date().toISOString() },
      ],
    });
    // Provide a chat history with user + assistant messages
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue({
      chat_history: [
        { role: 'user', content: [{ type: 'text', text: 'Hello world' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
      ],
    });
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    // sessionMap has an existing session (so demoteSession runs)
    const sessionMap = new Map([
      ['teams:user1', { chatId: 'c1', chatSessionId: 'old-sess', lastActiveAt: Date.now() }],
    ]);
    const ctx = makeBridgeContext({ sessionMap });

    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('Switched to');
    expect(result.text).toContain('New Session');
    expect(result.text).toContain('Hello world');
    expect(result.text).toContain('Hi there!');
    expect(result.replyToConversationId).toBe('conv-1');
  });

  it('switches without preview when getChatSessionFile returns null', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'My Chat', last_updated: new Date().toISOString() },
      ],
    });
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue(null);
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('My Chat');
    expect(result.text).not.toContain('User:');
  });

  it('switches without preview when chat_history is empty', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'Empty Chat', last_updated: new Date().toISOString() },
      ],
    });
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue({ chat_history: [] });
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('Empty Chat');
    expect(result.text).not.toContain('User:');
  });

  it('truncates long preview text at 500 chars', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'Long Chat', last_updated: new Date().toISOString() },
      ],
    });
    const longText = 'A'.repeat(600);
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue({
      chat_history: [
        { role: 'user', content: [{ type: 'text', text: longText }] },
        { role: 'assistant', content: [{ type: 'text', text: 'short reply' }] },
      ],
    });
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('...');
    // The truncated portion should be 500 chars + '...'
    const aaCount = (result.text.match(/A+/)?.[0].length ?? 0);
    expect(aaCount).toBe(500);
  });

  it('shows "(none)" when user message has no text parts', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'No-Text Chat', last_updated: new Date().toISOString() },
      ],
    });
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue({
      chat_history: [
        { role: 'user', content: [{ type: 'image', imageUrl: 'x' }] },
        { role: 'assistant', content: [{ type: 'tool_call', id: 'x' }] },
      ],
    });
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('(none)');
  });

  it('shows "(none)" for missing assistant when only user message in history', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'Partial Chat', last_updated: new Date().toISOString() },
      ],
    });
    // Only user message — assistant is undefined
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue({
      chat_history: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('Hello');
    expect(result.text).toContain('(none)');
  });

  it('returns null preview when history has no user or assistant messages', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'sess-new', title: 'Tool Chat', last_updated: new Date().toISOString() },
      ],
    });
    // history has only system messages — no user or assistant
    (chatSessionManager.getChatSessionFile as any).mockResolvedValue({
      chat_history: [
        { role: 'system', content: [{ type: 'text', text: 'system prompt' }] },
      ],
    });
    (chatSessionStore.patchMetadata as any).mockResolvedValue({ metadata: {} });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    // No preview when neither user nor assistant message found
    expect(result.text).not.toContain('User:');
    expect(result.text).toContain('Tool Chat');
  });

  it('shows multiple agents tag in session list when sessions span multiple chats', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [
        { chat_id: 'c1', agent: { name: 'BotA' } },
        { chat_id: 'c2', agent: { name: 'BotB' } },
      ],
    });
    (chatSessionManager.getChatSessions as any).mockImplementation(
      (_alias: string, chatId: string) => Promise.resolve({
        sessions: [
          { chatSession_id: `${chatId}-s1`, title: `${chatId} title`, last_updated: new Date().toISOString() },
        ],
      }),
    );

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('[BotA]');
    expect(result.text).toContain('[BotB]');
  });

  it('no agent tag when all sessions belong to single chat', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 's1', title: 'Session A', last_updated: new Date().toISOString() },
        { chatSession_id: 's2', title: 'Session B', last_updated: new Date(Date.now() - 1000).toISOString() },
      ],
    });

    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).not.toContain('[Bot]');
    expect(result.text).toContain('Session A');
  });
});
