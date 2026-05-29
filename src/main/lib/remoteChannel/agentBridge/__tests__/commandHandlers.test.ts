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

import { profileCacheManager } from '../../../userDataADO/profileCacheManager';
import { chatSessionManager } from '../../../userDataADO/chatSessionManager';
import { chatSessionStore } from '../../../chat/chatSessionStore';
import {
  handleNewCommand,
  handleAgentCommand,
  handleSkillListCommand,
  getAgentSkills,
  parseSkillMessage,
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

describe('handleNewCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns SESSION_DIVIDER text', async () => {
    const ctx = makeBridgeContext();
    const result = await handleNewCommand(ctx, 'teams:user1', 'conv-1');
    expect(result.text).toBe('__SESSION_DIVIDER__');
    expect(result.replyToConversationId).toBe('conv-1');
  });

  it('deletes existing session from sessionMap', async () => {
    // chatSessionStore is imported at top
    (chatSessionStore.patchMetadata as any).mockResolvedValue(null);

    const sessionMap = new Map([
      ['teams:user1', { chatId: 'chat-1', chatSessionId: 'sess-1', lastActiveAt: Date.now() }],
    ]);
    const ctx = makeBridgeContext({ sessionMap });
    await handleNewCommand(ctx, 'teams:user1', 'conv-1');
    expect(sessionMap.has('teams:user1')).toBe(false);
    expect(ctx.schedulePersist).toHaveBeenCalled();
  });

  it('handles no existing session', async () => {
    const ctx = makeBridgeContext();
    await expect(handleNewCommand(ctx, 'teams:user2', 'conv-1')).resolves.toBeDefined();
  });
});

describe('handleAgentCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no agents message when profile has no chats', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [] });
    const ctx = makeBridgeContext();
    const result = await handleAgentCommand(ctx, '.agent', 'teams', 'conv-1');
    expect(result.text).toContain('No agents available');
  });

  it('returns agent list in list mode (no index)', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [
        { chat_id: 'c1', agent: { name: 'BotA', emoji: '🤖' } },
        { chat_id: 'c2', agent: { name: 'BotB', emoji: '' } },
      ],
    });
    const ctx = makeBridgeContext();
    const result = await handleAgentCommand(ctx, '.agent', 'teams', 'conv-1');
    expect(result.text).toContain('Available Agents');
    expect(result.text).toContain('BotA');
    expect(result.text).toContain('BotB');
  });

  it('returns invalid number message for out-of-range index', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'BotA' } }],
    });
    const ctx = makeBridgeContext();
    const result = await handleAgentCommand(ctx, '.agent 99', 'teams', 'conv-1');
    expect(result.text).toContain('Invalid number');
  });

  it('returns "already using" when current agent is selected', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'BotA' } }],
      remoteChannels: { teams: { boundChatId: 'c1' } },
    });
    const ctx = makeBridgeContext();
    const result = await handleAgentCommand(ctx, '.agent 1', 'teams', 'conv-1');
    expect(result.text).toContain('Already using agent');
  });

  it('switches agent and returns success message', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [
        { chat_id: 'c1', agent: { name: 'BotA' } },
        { chat_id: 'c2', agent: { name: 'BotB' } },
      ],
      remoteChannels: { teams: { boundChatId: 'c1' } },
    });
    const ctx = makeBridgeContext();
    const result = await handleAgentCommand(ctx, '.agent 2', 'teams', 'conv-1');
    expect(result.text).toContain('BotB');
  });

  it('uses chat_id as fallback name when agent name missing', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1' }],
      remoteChannels: { teams: { boundChatId: 'c1' } },
    });
    const ctx = makeBridgeContext();
    const result = await handleAgentCommand(ctx, '.agent 1', 'teams', 'conv-1');
    expect(result.text).toContain('Already using agent');
  });
});

describe('handleSkillListCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no skills message when profile has no skills', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [], skills: [] });
    const ctx = makeBridgeContext();
    const result = handleSkillListCommand(ctx, 'teams', 'conv-1');
    expect(result.text).toContain('No skills configured');
  });

  it('returns skills list', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot', skills: ['skill1'] } }],
      skills: [{ name: 'skill1', description: 'desc1' }],
      remoteChannels: { teams: { boundChatId: 'c1' } },
    });
    const ctx = makeBridgeContext();
    const result = handleSkillListCommand(ctx, 'teams', 'conv-1');
    expect(result.text).toContain('skill1');
    expect(result.text).toContain('desc1');
  });
});

describe('getAgentSkills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty when no profile', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue(undefined);
    expect(getAgentSkills('user1', 'c1')).toEqual([]);
  });

  it('returns empty when chat not found in profile', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [], skills: [] });
    expect(getAgentSkills('user1', 'unknown')).toEqual([]);
  });

  it('returns skills matching chat agent.skills', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { skills: ['s1', 's2'] } }],
      skills: [
        { name: 's1', description: 'Skill One' },
        { name: 's2', description: 'Skill Two' },
        { name: 's3', description: 'Skill Three' },
      ],
    });
    const result = getAgentSkills('user1', 'c1');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ index: 1, name: 's1', description: 'Skill One' });
    expect(result[1]).toEqual({ index: 2, name: 's2', description: 'Skill Two' });
  });

  it('only includes skills present in profile.skills', () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { skills: ['missing', 's1'] } }],
      skills: [{ name: 's1', description: 'Skill One' }],
    });
    const result = getAgentSkills('user1', 'c1');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('s1');
  });
});

describe('parseSkillMessage', () => {
  const skills = [
    { index: 1, name: 'review', description: 'Code review' },
    { index: 2, name: 'optimize', description: 'Optimize' },
    { index: 3, name: 'test', description: 'Testing' },
  ];

  it('parses paren format: .skill(1) message', () => {
    const result = parseSkillMessage('.skill(1) check this code', skills);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain('[#skill:review]');
  });

  it('parses paren format with spaces: .skill( 2 ) message', () => {
    const result = parseSkillMessage('.skill( 2 ) optimize this', skills);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain('[#skill:optimize]');
  });

  it('parses space format: .skill 1 message', () => {
    const result = parseSkillMessage('.skill 1 do this', skills);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain('[#skill:review]');
  });

  it('parses multiple skills: .skill(1,2) message', () => {
    const result = parseSkillMessage('.skill(1,2) do both', skills);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('[#skill:review]');
      expect(result.text).toContain('[#skill:optimize]');
    }
  });

  it('deduplicates repeated skill indices', () => {
    const result = parseSkillMessage('.skill(1,1) do this', skills);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const count = (result.text.match(/\[#skill:review\]/g) || []).length;
      expect(count).toBe(1);
    }
  });

  it('normalizes full-width parentheses', () => {
    const result = parseSkillMessage('.skill（1） check this', skills);
    expect(result.ok).toBe(true);
  });

  it('returns error when no body after skill selection', () => {
    const result = parseSkillMessage('.skill(1)', skills);
    expect(result.ok).toBe(false);
  });

  it('returns error when skill index is out of range', () => {
    const result = parseSkillMessage('.skill(99) message', skills);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Skill #99');
  });

  it('returns error when skill index is not a number', () => {
    const result = parseSkillMessage('.skill(abc) message', skills);
    expect(result.ok).toBe(false);
  });

  it('returns error when no skill index provided in paren', () => {
    const result = parseSkillMessage('.skill() message', skills);
    expect(result.ok).toBe(false);
  });

  it('includes the body after skill tags', () => {
    const result = parseSkillMessage('.skill(1) hello world', skills);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain('hello world');
  });
});

describe('handleSwitchCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no conversations when no sessions found', async () => {
    (profileCacheManager.getCachedProfile as any).mockReturnValue({ chats: [] });
    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('No conversations available');
  });

  it('shows list when no index provided', async () => {
    // chatSessionManager is imported at top
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 's1', title: 'Session 1', last_updated: new Date().toISOString() },
      ],
    });
    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('Recent Conversations');
    expect(result.text).toContain('Session 1');
  });

  it('returns invalid number for out-of-range index', async () => {
    // chatSessionManager is imported at top
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 's1', title: 'Session 1', last_updated: new Date().toISOString() },
      ],
    });
    const ctx = makeBridgeContext();
    const result = await handleSwitchCommand(ctx, '.switch 99', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('Invalid number');
  });

  it('returns already in conversation when selecting current', async () => {
    // chatSessionManager is imported at top
    (profileCacheManager.getCachedProfile as any).mockReturnValue({
      chats: [{ chat_id: 'c1', agent: { name: 'Bot' } }],
    });
    (chatSessionManager.getChatSessions as any).mockResolvedValue({
      sessions: [
        { chatSession_id: 'current-sess', title: 'Current', last_updated: new Date().toISOString() },
      ],
    });
    const sessionMap = new Map([['teams:user1', { chatId: 'c1', chatSessionId: 'current-sess', lastActiveAt: Date.now() }]]);
    const ctx = makeBridgeContext({ sessionMap });
    const result = await handleSwitchCommand(ctx, '.switch 1', 'teams', 'teams:user1', 'conv-1');
    expect(result.text).toContain('Already in conversation');
  });
});
