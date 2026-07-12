// @ts-nocheck
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

import {
  sanitizeProfileV2,
  sanitizeStarredChatSessions,
  buildStarredChatSessionIndexItem,
  normalizeAgentSkillNames,
  createDefaultChat,
  generateChatId,
} from '../profileSanitizer';
import { DEFAULT_CHAT_AGENT } from '../types/profile';
import { setAccessorAgentResolver } from '../agentAccessor';
import type { ProfileV2, ChatConfig, ChatSession } from '../types/profile';

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias: 'alice',
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ProfileV2;
}

function makeChat(overrides: Partial<ChatConfig> = {}): ChatConfig {
  return {
    chat_id: 'chat_001',
    chat_type: 'single_agent',
    agent: {
      name: 'Test Agent',
      model: 'gpt-4o',
      system_prompt: 'Hi',
      source: 'ON-DEVICE',
      version: '1.0.0',
      workspace: '/workspace',
      knowledge: { knowledgeBase: '/workspace/knowledge' },
      mcp_servers: [],
      skills: [],
    },
    ...overrides,
  };
}

describe('generateChatId', () => {
  it('returns a string', () => {
    expect(typeof generateChatId()).toBe('string');
    expect(generateChatId().length).toBeGreaterThan(0);
  });
});

describe('createDefaultChat', () => {
  it('creates a chat with single_agent type', () => {
    const chat = createDefaultChat();
    expect(chat.chat_type).toBe('single_agent');
    expect(typeof chat.chat_id).toBe('string');
    expect(chat.workspace).toBeUndefined();
  });
});

describe('normalizeAgentSkillNames', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeAgentSkillNames(undefined)).toEqual([]);
    expect(normalizeAgentSkillNames(null as any)).toEqual([]);
  });

  it('deduplicates skill names', () => {
    expect(normalizeAgentSkillNames(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('trims whitespace from skill names', () => {
    expect(normalizeAgentSkillNames(['  skill-a  '])).toEqual(['skill-a']);
  });

  it('filters out empty strings and non-strings', () => {
    expect(normalizeAgentSkillNames(['', 123 as any, 'valid'])).toEqual(['valid']);
  });
});

describe('sanitizeStarredChatSessions', () => {
  it('returns empty array when starred-chat-sessions is not array', () => {
    const profile = makeProfile({ 'starred-chat-sessions': null as any });
    expect(sanitizeStarredChatSessions(profile, [])).toEqual([]);
  });

  it('filters out entries for non-existent chats', () => {
    const profile = makeProfile({
      'starred-chat-sessions': [
        { chatId: 'ghost_chat', chatSessionId: 'chatSession_20260101010101_dev_abc', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' }
      ] as any,
    });
    expect(sanitizeStarredChatSessions(profile, [])).toEqual([]);
  });

  it('keeps entries for valid chats', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'chatSession_20260101010101_dev_abc', title: 'Session', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' }
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result).toHaveLength(1);
    expect(result[0].chatId).toBe('chat_001');
  });

  it('deduplicates by chatSessionId', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'chatSession_20260101010101_dev_abc', title: 'A', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
        { chatId: 'chat_001', chatSessionId: 'chatSession_20260101010101_dev_abc', title: 'B', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result).toHaveLength(1);
  });

  it('filters out null/non-object items', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [null, undefined, 42] as any,
    });
    expect(sanitizeStarredChatSessions(profile, [chat])).toEqual([]);
  });
});

describe('buildStarredChatSessionIndexItem', () => {
  it('returns null when chat not found', () => {
    const profile = makeProfile({ chats: [] });
    const session: Partial<ChatSession> = {
      chatSession_id: 'chatSession_20260101010101_dev_abc',
      title: 'T',
      last_updated: '2026-01-01T00:00:00Z',
    };
    expect(buildStarredChatSessionIndexItem(profile, 'no_chat', session)).toBeNull();
  });

  it('returns null when required session fields are missing', () => {
    const chat = makeChat();
    const profile = makeProfile({ chats: [chat] });
    expect(buildStarredChatSessionIndexItem(profile, 'chat_001', {})).toBeNull();
  });

  it('builds a valid index item', () => {
    const chat = makeChat();
    const profile = makeProfile({ chats: [chat] });
    const session: Partial<ChatSession> = {
      chatSession_id: 'chatSession_20260101010101_dev_abc',
      title: 'My Session',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result).not.toBeNull();
    expect(result!.chatId).toBe('chat_001');
    expect(result!.title).toBe('My Session');
    expect(result!.agentName).toBe('Test Agent');
  });

  it('uses fallbackStarredAt when session has no starredAt', () => {
    const chat = makeChat();
    const profile = makeProfile({ chats: [chat] });
    const session: Partial<ChatSession> = {
      chatSession_id: 'chatSession_20260101010101_dev_abc',
      title: 'T',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session, '2025-06-01T00:00:00Z');
    expect(result!.starredAt).toBe('2025-06-01T00:00:00Z');
  });
});

describe('buildStarredChatSessionIndexItem — separated (agent_ids-only) chats', () => {
  afterEach(() => setAccessorAgentResolver(null));

  const session: Partial<ChatSession> = {
    chatSession_id: 'chatSession_20260101010101_dev_abc',
    title: 'My Session',
    last_updated: '2026-01-01T00:00:00Z',
  };

  it('resolves agent metadata from the registry when the chat carries only agent_ids', () => {
    const resolved = {
      name: 'OpenKosmos',
      emoji: 'e1',
      avatar: 'av1',
      source: 'ON-DEVICE',
      version: '2.0.0',
      model: 'gpt-4o',
      system_prompt: '',
      workspace: '',
      knowledge: { knowledgeBase: '' },
      mcp_servers: [],
      skills: [],
    };
    setAccessorAgentResolver((ids) => (ids.includes('agent-openkosmos-on-device') ? [resolved] : []));
    const chat = { chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['agent-openkosmos-on-device'] };
    const profile = makeProfile({ chats: [chat] });

    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);

    expect(result!.agentName).toBe('OpenKosmos');
    expect(result!.agentEmoji).toBe('e1');
    expect(result!.agentAvatar).toBe('av1');
    expect(result!.agentSource).toBe('ON-DEVICE');
    expect(result!.agentVersion).toBe('2.0.0');
  });

  it('falls back to "Unnamed Agent" with empty metadata when agent_ids resolve to nothing', () => {
    setAccessorAgentResolver(() => []);
    const chat = { chat_id: 'chat_001', chat_type: 'single_agent', agent_ids: ['ghost'] };
    const profile = makeProfile({ chats: [chat] });

    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);

    expect(result!.agentName).toBe('Unnamed Agent');
    expect(result!.agentEmoji).toBeUndefined();
    expect(result!.agentAvatar).toBeUndefined();
    expect(result!.agentSource).toBeUndefined();
    expect(result!.agentVersion).toBeUndefined();
  });
});

describe('sanitizeProfileV2 — inline agent id preservation', () => {
  it('preserves a chat agent stable id so a durability-gated inline agent reloads under the same id', () => {
    const chat = makeChat();
    chat.agent.id = 'agent-uuid-123';
    const profile = makeProfile({ chats: [chat] });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0].agent!.id).toBe('agent-uuid-123');
  });

  it('omits the id field when the chat agent carries none', () => {
    const profile = makeProfile({ chats: [makeChat()] });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0].agent!.id).toBeUndefined();
  });

  it('preserves agent_ids-only chat relationships', () => {
    const profile = makeProfile({
      chats: [
        {
          chat_id: 'chat_ids_only',
          chat_type: 'single_agent',
          agent_ids: ['agent-existing'],
        } as any,
      ],
    });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0]).toMatchObject({
      chat_id: 'chat_ids_only',
      chat_type: 'single_agent',
      agent_ids: ['agent-existing'],
    });
    expect(result.chats[0].agent).toBeUndefined();
  });

  it('derives agent_ids from inline agents when the mapping is missing', () => {
    const chat = makeChat();
    chat.agent!.id = 'agent-inline-id';
    const profile = makeProfile({ chats: [chat] });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0].agent_ids).toEqual(['agent-inline-id']);
  });
});

describe('sanitizeProfileV2', () => {
  it('fills in default fields for minimal profile', () => {
    const profile = makeProfile({ chats: [] });
    const result = sanitizeProfileV2(profile);
    expect(result.version).toBe('2.0.0');
    expect(result.chats.length).toBeGreaterThan(0);
    expect(result.mcp_servers).toEqual([]);
  });

  it('normalizes mcp servers', () => {
    const profile = makeProfile({
      chats: [makeChat()],
      mcp_servers: [
        { name: 'server1', transport: 'stdio', command: 'cmd', args: [], env: {}, url: '', in_use: true, version: '1.0.0', source: 'ON-DEVICE' },
      ],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.mcp_servers[0].name).toBe('server1');
    expect(result.mcp_servers[0].in_use).toBe(true);
  });

  it('normalizes agent mcp_servers with string entries', () => {
    const chat = makeChat();
    chat.agent!.mcp_servers = ['server-as-string'] as any;
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.mcp_servers[0]).toEqual({ name: 'server-as-string', tools: [] });
  });

  it('normalizes primitive chat agent values without resetting the profile', () => {
    const profile = makeProfile({
      chats: [{
        chat_id: 'chat_primitive_agent',
        chat_type: 'single_agent',
        agent: 'corrupt-agent-value',
      } as any],
    });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0].chat_id).toBe('chat_primitive_agent');
    expect(result.chats[0].agent!.name).toBe(DEFAULT_CHAT_AGENT.name);
  });

  it('strips workspace from the chat and legacy agent.workspace', () => {
    const chat = makeChat({ workspace: '/chat-workspace' });
    chat.agent!.workspace = '/legacy-agent-workspace';
    const profile = makeProfile({ chats: [chat] });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0].workspace).toBeUndefined();
    expect(result.chats[0].agent!.workspace).toBeUndefined();
  });

  it('strips legacy agent.workspace when the chat field is absent', () => {
    const chat = makeChat();
    delete (chat as any).workspace;
    chat.agent!.workspace = '/legacy-agent-workspace';
    const profile = makeProfile({ chats: [chat] });

    const result = sanitizeProfileV2(profile);

    expect(result.chats[0].workspace).toBeUndefined();
    expect(result.chats[0].agent!.workspace).toBeUndefined();
  });

  it('adds builtin skills to builtin agent', () => {
    const chat = makeChat();
    chat.agent!.name = 'Kobi';
    chat.agent!.skills = [];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.skills).toContain('skill-creator');
  });

  it('handles error gracefully and returns minimal safe config', () => {
    // A profile with chats that throw during sanitization — use profile with required alias
    const broken: ProfileV2 = { alias: '', chats: null as any } as any;
    const result = sanitizeProfileV2(broken);
    expect(result.version).toBe('2.0.0');
    expect(result.chats.length).toBeGreaterThan(0);
  });

  it('strips legacy workspace field on chat', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      workspace: '/legacy/workspace',
      agent: {
        name: 'Agent',
        model: 'gpt-4o',
        system_prompt: '',
        source: 'ON-DEVICE',
        version: '1.0.0',
        mcp_servers: [],
        skills: [],
      },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].workspace).toBeUndefined();
    expect(result.chats[0].agent!.workspace).toBeUndefined();
  });

  it('normalizes skills array in profile', () => {
    const profile = makeProfile({
      chats: [makeChat()],
      skills: [{ name: 'my-skill', description: 'desc', version: '1.0.0', source: 'ON-DEVICE' }],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.skills[0].name).toBe('my-skill');
  });

  it('normalizes coding agent settings to a known-good shape', () => {
    const profile = makeProfile({
      codingAgentSettings: { enabled: true, cli: 'gemini' } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.codingAgentSettings).toEqual({ enabled: true, cli: 'gemini' });
  });

  it('defaults invalid coding agent settings fields', () => {
    const profile = makeProfile({
      codingAgentSettings: { enabled: 'true', cli: 'vim' } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.codingAgentSettings).toEqual({ enabled: false, cli: 'claude' });
  });

  it('persists computer use settings instead of stripping them', () => {
    const profile = makeProfile({
      computerUse: { enabled: true, requireConfirmation: false, alwaysAllowedApps: ['WeChat'] } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.computerUse).toEqual({
      enabled: true,
      requireConfirmation: false,
      alwaysAllowedApps: ['WeChat'],
    });
  });

  it('fills default computer use settings when the block is absent', () => {
    const result = sanitizeProfileV2(makeProfile());
    expect(result.computerUse).toEqual({
      enabled: false,
      requireConfirmation: true,
      alwaysAllowedApps: [],
    });
  });

  it('normalizes invalid computer use fields and prunes junk allowlist entries', () => {
    const profile = makeProfile({
      computerUse: {
        enabled: 'yes',
        requireConfirmation: 'maybe',
        alwaysAllowedApps: ['Safari', '', '   ', 42, null],
      } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.computerUse).toEqual({
      enabled: false,
      requireConfirmation: true,
      alwaysAllowedApps: ['Safari'],
    });
  });

  it('resets a non-array computer use allowlist to empty', () => {
    const profile = makeProfile({
      computerUse: { enabled: true, requireConfirmation: true, alwaysAllowedApps: 'WeChat' } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.computerUse?.alwaysAllowedApps).toEqual([]);
  });
});

// ── Additional coverage for uncovered branches ───────────────────────────────
describe('sanitizeStarredChatSessions — additional branches', () => {
  it('applies readStatus = read', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [{
        chatId: 'chat_001',
        chatSessionId: 'chatSession_20260101010101_dev_abc',
        title: 'T',
        lastUpdated: '2026-01-01T00:00:00Z',
        starredAt: '2026-01-01T00:00:00Z',
        readStatus: 'read',
      }] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].readStatus).toBe('read');
  });

  it('applies readStatus = unread', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [{
        chatId: 'chat_001',
        chatSessionId: 'chatSession_20260101010101_dev_xyz',
        title: 'T',
        lastUpdated: '2026-01-01T00:00:00Z',
        starredAt: '2026-01-01T00:00:00Z',
        readStatus: 'unread',
      }] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].readStatus).toBe('unread');
  });

  it('uses defaults for missing title, lastUpdated, starredAt', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [{
        chatId: 'chat_001',
        chatSessionId: 'chatSession_20260101010101_dev_def',
        // title missing → 'Untitled Session'
        // lastUpdated missing → new Date()
        // starredAt missing → lastUpdated
      }] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].title).toBe('Untitled Session');
    expect(typeof result[0].lastUpdated).toBe('string');
  });

  it('includes agentName from chat agent when available', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [{
        chatId: 'chat_001',
        chatSessionId: 'chatSession_20260201010101_dev_abc',
        title: 'S',
        lastUpdated: '2026-02-01T00:00:00Z',
        starredAt: '2026-02-01T00:00:00Z',
      }] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].agentName).toBe('Test Agent');
  });

  it('sorts by lastUpdated descending', () => {
    const chat1 = makeChat();
    const chat2 = { ...makeChat(), chat_id: 'chat_002' };
    const profile = makeProfile({
      chats: [chat1, chat2],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'chatSession_20260101010101_dev_a1', title: 'A', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
        { chatId: 'chat_002', chatSessionId: 'chatSession_20260201010101_dev_b1', title: 'B', lastUpdated: '2026-02-01T00:00:00Z', starredAt: '2026-02-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat1, chat2]);
    expect(result[0].chatSessionId).toBe('chatSession_20260201010101_dev_b1');
  });
});

describe('sanitizeProfileV2 — additional branches', () => {
  it('handles agent with null mcp_servers entry (null filtered out)', () => {
    const chat = makeChat();
    chat.agent!.mcp_servers = [null as any];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.mcp_servers).toEqual([]);
  });

  it('handles agent with object mcp_servers entry missing name', () => {
    const chat = makeChat();
    chat.agent!.mcp_servers = [{ name: '', tools: [] } as any];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    // name='' filters out
    expect(result.chats[0].agent!.mcp_servers).toEqual([]);
  });

  it('handles agent with object mcp_servers with valid tools', () => {
    const chat = makeChat();
    chat.agent!.mcp_servers = [{ name: 'srv', tools: ['tool1'] } as any];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.mcp_servers[0]).toEqual({ name: 'srv', tools: ['tool1'] });
  });

  it('handles agent with mcp_server tools as non-array', () => {
    const chat = makeChat();
    chat.agent!.mcp_servers = [{ name: 'srv2', tools: 'bad' } as any];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.mcp_servers[0]).toEqual({ name: 'srv2', tools: [] });
  });

  it('handles chat without agent', () => {
    const chat: any = { chat_id: 'chat_noagent', chat_type: 'single_agent' };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent).toBeUndefined();
  });

  it('preserves chat agent_ids (separated-model SSOT)', () => {
    const chat: any = { chat_id: 'chat_ids', chat_type: 'single_agent', agent_ids: ['agent-kobi-on-device', 'agent-x-on-device'] };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect((result.chats[0] as any).agent_ids).toEqual(['agent-kobi-on-device', 'agent-x-on-device']);
  });

  it('filters empty/non-string entries out of agent_ids', () => {
    const chat: any = { chat_id: 'chat_ids2', chat_type: 'single_agent', agent_ids: ['agent-kobi-on-device', '', '   ', 123, null] };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect((result.chats[0] as any).agent_ids).toEqual(['agent-kobi-on-device']);
  });

  it('derives agent_ids from inline agent when raw ids sanitize to empty', () => {
    const chat: any = { chat_id: 'chat_ids3', chat_type: 'single_agent', agent: makeChat().agent, agent_ids: ['', null] };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect((result.chats[0] as any).agent_ids).toEqual(['agent-test-agent-on-device']);
  });

  it('freDone defaults to false when not boolean', () => {
    const profile = makeProfile({ freDone: 'yes' as any });
    const result = sanitizeProfileV2(profile);
    expect(result.freDone).toBe(false);
  });

  it('normalizes mcp_server with hidden field', () => {
    const profile = makeProfile({
      chats: [makeChat()],
      mcp_servers: [{ name: 'srv', transport: 'stdio', command: 'c', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE', hidden: true } as any],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.mcp_servers[0].hidden).toBe(true);
  });

  it('normalizes mcp_server with headers field', () => {
    const profile = makeProfile({
      chats: [makeChat()],
      mcp_servers: [{ name: 'srv2', transport: 'http', command: '', args: [], env: {}, url: 'http://x', in_use: false, version: '1.0.0', source: 'ON-DEVICE', headers: { Authorization: 'Bearer x' } } as any],
    });
    const result = sanitizeProfileV2(profile);
    expect((result.mcp_servers[0] as any).headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('leaves toolbar settings unset when missing', () => {
    const profile = makeProfile({ toolBarSettings: undefined as any });
    const result = sanitizeProfileV2(profile);
    expect(result.toolBarSettings).toBeUndefined();
  });

  it('merges confirmation settings with defaults', () => {
    const profile = makeProfile({
      confirmationSettings: { shellCommand: false } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.confirmationSettings.shellCommand).toBe(false);
  });

  it('catch: returns minimal config on exception', () => {
    const broken: ProfileV2 = {
      alias: 'fallback-user',
      chats: null as any,
    } as any;
    const result = sanitizeProfileV2(broken);
    expect(result.version).toBe('2.0.0');
  });
});
