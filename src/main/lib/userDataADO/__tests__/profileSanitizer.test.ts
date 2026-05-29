// @ts-nocheck
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'kosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

import {
  sanitizeProfileV2,
  sanitizeSubAgents,
  sanitizeStarredChatSessions,
  buildStarredChatSessionIndexItem,
  sanitizeChatSkillSnapshot,
  clearSkillSnapshotsForAffectedChats,
  normalizeAgentSkillNames,
  createDefaultChat,
  generateChatId,
} from '../profileSanitizer';
import type { ProfileV2, ChatConfig, ChatSession } from '../types/profile';

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias: 'alice',
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    sub_agents: [],
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

describe('sanitizeChatSkillSnapshot', () => {
  it('returns undefined for null/non-object', () => {
    expect(sanitizeChatSkillSnapshot(null)).toBeUndefined();
    expect(sanitizeChatSkillSnapshot('string')).toBeUndefined();
  });

  it('returns undefined for snapshot with no useful content', () => {
    expect(sanitizeChatSkillSnapshot({
      binding_signature: '',
      registry_signature: '',
      prompt: '',
      skills: [],
    })).toBeUndefined();
  });

  it('returns normalized snapshot with useful content', () => {
    const snapshot = sanitizeChatSkillSnapshot({
      binding_signature: 'sig123',
      registry_signature: '',
      prompt: '',
      skills: [{ name: 'my-skill', description: 'desc', version: '1.0', file_path: '/p' }],
      generated_at: '2026-01-01T00:00:00Z',
    });
    expect(snapshot).toBeDefined();
    expect(snapshot!.binding_signature).toBe('sig123');
    expect(snapshot!.skills[0].name).toBe('my-skill');
  });

  it('includes missing_skill_names when present', () => {
    const snapshot = sanitizeChatSkillSnapshot({
      binding_signature: 'sig',
      registry_signature: '',
      prompt: '',
      skills: [],
      missing_skill_names: ['skill-x'],
    });
    expect(snapshot).toBeDefined();
    expect(snapshot!.missing_skill_names).toContain('skill-x');
  });

  it('filters empty strings from missing_skill_names', () => {
    const snapshot = sanitizeChatSkillSnapshot({
      binding_signature: 'sig',
      registry_signature: '',
      prompt: '',
      skills: [],
      missing_skill_names: ['', 'valid'],
    });
    expect(snapshot!.missing_skill_names).toEqual(['valid']);
  });
});

describe('clearSkillSnapshotsForAffectedChats', () => {
  it('returns 0 for empty skillNames', () => {
    const profile = makeProfile({ chats: [makeChat()] });
    expect(clearSkillSnapshotsForAffectedChats(profile, [])).toBe(0);
  });

  it('clears snapshot for affected chat', () => {
    const chat = makeChat({ skill_snapshot: { binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '' } });
    chat.agent!.skills = ['skill-a'];
    const profile = makeProfile({ chats: [chat] });

    const count = clearSkillSnapshotsForAffectedChats(profile, ['skill-a']);
    expect(count).toBe(1);
    expect(chat.skill_snapshot).toBeUndefined();
  });

  it('does not clear unaffected chat snapshots', () => {
    const chat = makeChat({ skill_snapshot: { binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '' } });
    chat.agent!.skills = ['skill-b'];
    const profile = makeProfile({ chats: [chat] });

    const count = clearSkillSnapshotsForAffectedChats(profile, ['skill-a']);
    expect(count).toBe(0);
    expect(chat.skill_snapshot).toBeDefined();
  });

  it('skips chats without skill_snapshot', () => {
    const chat = makeChat();
    chat.agent!.skills = ['skill-a'];
    const profile = makeProfile({ chats: [chat] });
    expect(clearSkillSnapshotsForAffectedChats(profile, ['skill-a'])).toBe(0);
  });
});

describe('sanitizeSubAgents', () => {
  it('returns empty array when sub_agents is not array', () => {
    const profile = makeProfile({ sub_agents: null as any });
    expect(sanitizeSubAgents(profile, [])).toEqual([]);
  });

  it('deduplicates sub-agents by name', () => {
    const profile = makeProfile({
      sub_agents: [
        { name: 'agent-a', version: '1.0.0', source: 'ON-DEVICE' } as any,
        { name: 'agent-a', version: '2.0.0', source: 'ON-DEVICE' } as any,
      ],
    });
    const result = sanitizeSubAgents(profile, []);
    expect(result).toHaveLength(1);
  });

  it('handles post-migration format as SubAgentIndex', () => {
    const profile = makeProfile({
      sub_agents: [{ name: 'new-agent', version: '1.0.0', source: 'ON-DEVICE' }] as any,
    });
    const result = sanitizeSubAgents(profile, []) as any[];
    expect(result[0].name).toBe('new-agent');
    expect('system_prompt' in result[0]).toBe(false);
  });

  it('removes dangling sub_agent references from chats', () => {
    const chat = makeChat();
    chat.agent!.sub_agents = ['existing', 'ghost'];
    const profile = makeProfile({
      sub_agents: [{ name: 'existing', version: '1.0.0', source: 'ON-DEVICE' }] as any,
      chats: [chat],
    });
    sanitizeSubAgents(profile, [chat]);
    expect(chat.agent!.sub_agents).toEqual(['existing']);
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

  it('adds builtin skills to builtin agent', () => {
    const chat = makeChat();
    chat.agent!.name = 'Kobi';
    chat.agent!.skills = [];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.skills).toContain('skill-creator');
  });

  it('handles remoteChannels with valid boundChatId', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      remoteChannels: { teams: { boundChatId: 'chat_001' } } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.remoteChannels?.teams?.boundChatId).toBe('chat_001');
  });

  it('preserves remoteChannels as-is from input', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      remoteChannels: { teams: { boundChatId: 'nonexistent_chat' } } as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.remoteChannels).toEqual({ teams: { boundChatId: 'nonexistent_chat' } });
  });

  it('handles error gracefully and returns minimal safe config', () => {
    // A profile with chats that throw during sanitization — use profile with required alias
    const broken: ProfileV2 = { alias: '', chats: null as any } as any;
    const result = sanitizeProfileV2(broken);
    expect(result.version).toBe('2.0.0');
    expect(result.chats.length).toBeGreaterThan(0);
  });

  it('preserves skill_snapshot when valid', () => {
    const chat = makeChat({
      skill_snapshot: {
        binding_signature: 'sig123',
        registry_signature: '',
        prompt: '',
        skills: [],
        generated_at: '2026-01-01T00:00:00Z',
      },
    });
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].skill_snapshot?.binding_signature).toBe('sig123');
  });

  it('normalizes skills array in profile', () => {
    const profile = makeProfile({
      chats: [makeChat()],
      skills: [{ name: 'my-skill', description: 'desc', version: '1.0.0', source: 'ON-DEVICE' }],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.skills[0].name).toBe('my-skill');
  });
});
