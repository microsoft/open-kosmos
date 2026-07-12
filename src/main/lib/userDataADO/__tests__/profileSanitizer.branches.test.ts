// @ts-nocheck
/**
 * Branch-coverage supplement for profileSanitizer.ts.
 * These tests target the false/fallback sides of ||, ??, ternary, and if guards
 * that the main test suite does not exercise.
 */
import { vi, describe, it, expect } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', async () => ({ app: { getPath: vi.fn(() => '/mock/userData') } }));
vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
}));
vi.mock('../../../../shared/constants/branding', async () => ({ BRAND_NAME: 'openkosmos' }));
vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

import {
  sanitizeProfileV2,
  sanitizeMcpServerList,
  sanitizeStarredChatSessions,
  buildStarredChatSessionIndexItem,
} from '../profileSanitizer';
import type { ProfileV2, ChatConfig, ChatSession } from '../types/profile';

function makeProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias: 'alice',
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

// ─── sanitizeStarredChatSessions – fallback branches ─────────────────────────

describe('sanitizeStarredChatSessions – field fallback branches', () => {
  it('uses empty string for non-string chatId (line 128 false branch)', () => {
    const chat = makeChat();
    // chatId is a number — item will have no matching chat → filtered out
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 123, chatSessionId: 'session1', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result).toHaveLength(0);
  });

  it('defaults title to Untitled Session when title is empty (line 132 false branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session1', title: '', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].title).toBe('Untitled Session');
  });

  it('defaults title to Untitled Session when title is missing (line 132 false branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session1', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].title).toBe('Untitled Session');
  });

  it('defaults lastUpdated to now when empty (line 133 false branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session1', title: 'T', lastUpdated: '', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    // should be ISO string (dynamically generated)
    expect(result[0].lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('defaults starredAt to lastUpdated when starredAt is empty (line 136 false branch)', () => {
    const chat = makeChat();
    const lastUpdated = '2026-03-01T00:00:00Z';
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session2', title: 'T', lastUpdated, starredAt: '' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].starredAt).toBe(lastUpdated);
  });

  it('uses readStatus=undefined when value is not read/unread (line 150)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session3', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z', readStatus: 'other' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].readStatus).toBeUndefined();
  });

  it('sets readStatus=read when explicitly read (line 150 first branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session4', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z', readStatus: 'read' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].readStatus).toBe('read');
  });

  it('sets readStatus=unread (line 150 second branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'session5', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z', readStatus: 'unread' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].readStatus).toBe('unread');
  });

  it('uses item.agentName fallback when chat has no agent (line 152)', () => {
    const chatNoAgent: ChatConfig = { chat_id: 'chat_002', chat_type: 'single_agent' } as any;
    const profile = makeProfile({
      chats: [chatNoAgent],
      'starred-chat-sessions': [
        { chatId: 'chat_002', chatSessionId: 'session6', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z', agentName: 'Fallback Agent' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chatNoAgent]);
    expect(result[0].agentName).toBe('Fallback Agent');
  });

  it('uses Unnamed Agent when no agent and no agentName in item (line 152)', () => {
    const chatNoAgent: ChatConfig = { chat_id: 'chat_003', chat_type: 'single_agent' } as any;
    const profile = makeProfile({
      chats: [chatNoAgent],
      'starred-chat-sessions': [
        { chatId: 'chat_003', chatSessionId: 'session7', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chatNoAgent]);
    expect(result[0].agentName).toBe('Unnamed Agent');
  });

  it('uses item.agentEmoji/avatar/source/version when chat agent has none (lines 153-156)', () => {
    const chatNoAgent: ChatConfig = { chat_id: 'chat_004', chat_type: 'single_agent' } as any;
    const profile = makeProfile({
      chats: [chatNoAgent],
      'starred-chat-sessions': [
        {
          chatId: 'chat_004', chatSessionId: 'session8', title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z',
          agentEmoji: '🤖', agentAvatar: 'avatar.png', agentSource: 'STORE', agentVersion: '2.0.0',
        },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chatNoAgent]);
    expect(result[0].agentEmoji).toBe('🤖');
    expect(result[0].agentAvatar).toBe('avatar.png');
    expect(result[0].agentSource).toBe('STORE');
    expect(result[0].agentVersion).toBe('2.0.0');
  });
});

// ─── buildStarredChatSessionIndexItem – branch coverage ───────────────────────

describe('buildStarredChatSessionIndexItem – branch coverage', () => {
  it('handles profile with no starred-chat-sessions field (line 174 || [] branch)', () => {
    const chat = makeChat();
    const profileNoStarred = {
      ...makeProfile({ chats: [chat] }),
    };
    delete (profileNoStarred as any)['starred-chat-sessions'];
    const session: Partial<ChatSession> = {
      chatSession_id: 'session1',
      title: 'T',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const result = buildStarredChatSessionIndexItem(profileNoStarred, 'chat_001', session);
    expect(result).not.toBeNull();
  });

  it('uses fallback agent name Unnamed Agent when chat agent has no name (line 188)', () => {
    const chat = makeChat();
    (chat.agent as any).name = '';
    const profile = makeProfile({ chats: [chat] });
    const session: Partial<ChatSession> = {
      chatSession_id: 'session2',
      title: 'T',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result!.agentName).toBe('Unnamed Agent');
  });

  it('uses session.starredAt when present (line 193 first branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({ chats: [chat] });
    const session: Partial<ChatSession> = {
      chatSession_id: 'session3',
      title: 'T',
      last_updated: '2026-01-01T00:00:00Z',
      starredAt: '2025-12-01T00:00:00Z',
    };
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result!.starredAt).toBe('2025-12-01T00:00:00Z');
  });

  it('falls back to new Date() when no starredAt and no fallback (line 193 last branch)', () => {
    const chat = makeChat();
    const profile = makeProfile({ chats: [chat] });
    const session: Partial<ChatSession> = {
      chatSession_id: 'session4',
      title: 'T',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result!.starredAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

// ─── sanitizeProfileV2 – MCP server and agent field fallbacks ─────────────────

describe('sanitizeProfileV2 – MCP server fallback branches', () => {
  it('fills default values for mcp server missing fields', () => {
    const profile = makeProfile({
      mcp_servers: [{ name: '', transport: undefined, command: undefined, args: null, env: null, url: undefined, in_use: undefined, version: undefined, source: undefined }] as any,
      chats: [],
    });
    const result = sanitizeProfileV2(profile);
    const server = result.mcp_servers[0];
    expect(server.transport).toBe('stdio');
    expect(server.command).toBe('');
    expect(server.args).toEqual([]);
    expect(server.env).toEqual({});
    expect(server.url).toBe('');
    expect(server.in_use).toBe(false);
    expect(server.version).toBe('1.0.0');
    expect(server.source).toBe('ON-DEVICE');
    expect(server.remoteVersion).toBe('');
  });

  it('includes hidden field when set on mcp server', () => {
    const profile = makeProfile({
      mcp_servers: [{ name: 'srv', transport: 'stdio', command: 'cmd', args: [], env: {}, url: '', in_use: false, version: '1.0.0', source: 'ON-DEVICE', hidden: true }] as any,
      chats: [],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.mcp_servers[0].hidden).toBe(true);
  });

  it('includes headers when present on mcp server', () => {
    const profile = makeProfile({
      mcp_servers: [{ name: 'srv', transport: 'sse', command: '', args: [], env: {}, url: 'http://x', in_use: false, version: '1.0.0', source: 'ON-DEVICE', headers: { Authorization: 'Bearer tok' } }] as any,
      chats: [],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.mcp_servers[0].headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('drops null/primitive global mcp_servers entries during profile sanitize', () => {
    const profile = makeProfile({
      mcp_servers: [null, undefined, 42, 'oops', { name: 'good', command: 'node' }] as any,
      chats: [],
    });
    const result = sanitizeProfileV2(profile);
    expect(result.mcp_servers).toHaveLength(1);
    expect(result.mcp_servers[0].name).toBe('good');
  });
});

describe('sanitizeMcpServerList – malformed entry filtering', () => {
  it('drops null, undefined, and primitive entries while normalizing valid ones', () => {
    const result = sanitizeMcpServerList([null, undefined, 42, 'oops', { name: 'good', command: 'node' }] as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'good', command: 'node', transport: 'stdio', in_use: false });
  });

  it('returns an empty array for an undefined list', () => {
    expect(sanitizeMcpServerList(undefined)).toEqual([]);
  });

  it('drops orphaned plugin-injected servers carrying the retired source: PLUGIN', () => {
    const result = sanitizeMcpServerList([
      { name: 'plugin--foo--srv', command: 'node', source: 'PLUGIN' },
      { name: 'user-srv', command: 'node', source: 'ON-DEVICE' },
    ] as any);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('user-srv');
    expect(result.some(s => (s.source as string) === 'PLUGIN')).toBe(false);
  });

  it('drops plugin-- named servers even when their source was lost or coerced', () => {
    const result = sanitizeMcpServerList([
      { name: 'plugin--foo--srv', command: 'node', source: 'ON-DEVICE' },
      { name: 'plugin--bar--srv', command: 'node' },
      { name: 'user-srv', command: 'node', source: 'ON-DEVICE' },
    ] as any);
    expect(result.map(s => s.name)).toEqual(['user-srv']);
  });
});

describe('sanitizeProfileV2 – agent field fallbacks', () => {
  it('preserves legacy Library metadata without network access', () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    try {
      const profile = makeProfile({
        mcp_servers: [{
          name: 'legacy-mcp',
          transport: 'stdio',
          command: 'node',
          args: [],
          env: {},
          in_use: false,
          version: '1.0.0',
          remoteVersion: '2.0.0',
          source: 'IN-LIBRARY',
        }],
        skills: [{
          name: 'legacy-skill',
          description: 'Legacy skill',
          version: '1.0.0',
          remoteVersion: '2.0.0',
          source: 'IN-LIBRARY',
        }],
        chats: [makeChat({
          agent: {
            name: 'Legacy Agent',
            model: 'gpt-4o',
            system_prompt: '',
            mcp_servers: [],
            skills: [],
            version: '1.0.0',
            remoteVersion: '2.0.0',
            source: 'IN-LIBRARY',
          },
        })],
      });

      const result = sanitizeProfileV2(profile);

      expect(result.mcp_servers[0]).toMatchObject({
        source: 'IN-LIBRARY',
        remoteVersion: '2.0.0',
      });
      expect(result.skills[0]).toMatchObject({
        source: 'IN-LIBRARY',
        remoteVersion: '2.0.0',
      });
      expect(result.chats[0].agent).toMatchObject({
        source: 'IN-LIBRARY',
        remoteVersion: '2.0.0',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fills default role/emoji/name/model when missing from agent', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: {
        // name, model, role, emoji all missing/empty
        system_prompt: 'hi',
        source: 'ON-DEVICE',
        version: '1.0.0',
        mcp_servers: [],
        skills: [],
      },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    const agent = result.chats[0].agent!;
    expect(agent.name).toBeTruthy(); // default name
    expect(agent.model).toBeTruthy(); // default model
  });

  it('fills default version/source for agent when missing', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: {
        name: 'X', model: 'gpt-4o', system_prompt: '',
        mcp_servers: [], skills: [],
        // version and source missing
      },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.version).toBe('1.0.0');
    expect(result.chats[0].agent!.source).toBe('ON-DEVICE');
    expect(result.chats[0].agent!.remoteVersion).toBe('');
  });

  it('strips orphaned plugin-prefixed agent MCP and skill bindings, keeping normal ones', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: {
        name: 'X', model: 'gpt-4o', system_prompt: '', version: '1.0.0', source: 'ON-DEVICE',
        mcp_servers: [
          { name: 'plugin--foo--srv', tools: ['t1'] },
          { name: 'real-srv', tools: ['t2'] },
        ],
        skills: ['plugin--foo--bar', 'real-skill'],
      },
    };
    const result = sanitizeProfileV2(makeProfile({ chats: [chat] }));
    const agent = result.chats[0].agent!;
    expect(agent.mcp_servers.map(s => s.name)).toEqual(['real-srv']);
    expect(agent.skills).toEqual(['real-skill']);
  });

  it('empties an agent MCP allowlist that contained only plugin servers (restores tool fallback)', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: {
        name: 'X', model: 'gpt-4o', system_prompt: '', version: '1.0.0', source: 'ON-DEVICE',
        mcp_servers: [
          { name: 'plugin--foo--srv', tools: [] },
          'plugin--foo--srv2',
        ],
        skills: [],
      },
    };
    const result = sanitizeProfileV2(makeProfile({ chats: [chat] }));
    expect(result.chats[0].agent!.mcp_servers).toEqual([]);
  });

  it('handles chat with no agent field (line 349 cleanAgent=undefined)', () => {
    const chat: any = { chat_id: 'chat_001', chat_type: 'single_agent' };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    // agent should be absent
    expect(result.chats[0].agent).toBeUndefined();
  });

  it('strips legacy agent workspace from sanitized profile shape', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: { name: 'A', model: 'gpt-4o', system_prompt: '', mcp_servers: [], skills: [], workspace: '/agent/ws' },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].workspace).toBeUndefined();
    expect(result.chats[0].agent!.workspace).toBeUndefined();
  });

  it('filters out agent mcp_servers with null/invalid values (line 369)', () => {
    const chat = makeChat();
    (chat.agent as any).mcp_servers = [null, undefined, { name: '', tools: [] }, { name: 'good', tools: null }];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    // null, undefined, and empty-name items should be filtered; 'good' with null tools uses []
    const serverNames = result.chats[0].agent!.mcp_servers.map((s: any) => s.name);
    expect(serverNames).not.toContain('');
    expect(serverNames).toContain('good');
    const goodServer = result.chats[0].agent!.mcp_servers.find((s: any) => s.name === 'good');
    expect(goodServer!.tools).toEqual([]);
  });

  it('uses empty string for agent avatar when missing (line 355 false branch)', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: { name: 'A', model: 'gpt-4o', system_prompt: '', mcp_servers: [], skills: [] },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.avatar).toBe('');
  });

  it('leaves context_enhancement unset when missing', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: { name: 'A', model: 'gpt-4o', system_prompt: '', mcp_servers: [], skills: [] },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.context_enhancement).toBeUndefined();
  });

  it('fills zero_states default when missing', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: { name: 'A', model: 'gpt-4o', system_prompt: '', mcp_servers: [], skills: [], zero_states: null },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.zero_states).toBeDefined();
  });

  it('preserves authToken as string, drops non-string authToken', () => {
    const chat1: any = { chat_id: 'chat_001', chat_type: 'single_agent', agent: { name: 'A', model: 'm', system_prompt: '', mcp_servers: [], skills: [], authToken: 'my-token' } };
    const chat2: any = { chat_id: 'chat_002', chat_type: 'single_agent', agent: { name: 'B', model: 'm', system_prompt: '', mcp_servers: [], skills: [], authToken: 12345 } };
    const profile = makeProfile({ chats: [chat1, chat2] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.authToken).toBe('my-token');
    expect(result.chats[1].agent!.authToken).toBeUndefined();
  });
});

describe('sanitizeProfileV2 – profile-level field fallbacks', () => {
  it('fills default version/createdAt/updatedAt/alias and omits primaryChat when missing', () => {
    const profile = makeProfile({ version: undefined as any, createdAt: undefined, updatedAt: undefined, alias: undefined as any, primaryChat: undefined as any });
    const result = sanitizeProfileV2(profile);
    expect(result.version).toBe('2.0.0');
    expect(result.alias).toBe('');
    // primaryChat is only persisted when set; the sanitizer never invents a default.
    expect(result.primaryChat).toBeUndefined();
    expect(result.createdAt).toMatch(/^\d{4}/);
    expect(result.updatedAt).toMatch(/^\d{4}/);
  });

  it('fills freDone=false when freDone is not a boolean', () => {
    const profile = makeProfile({ freDone: 'yes' as any });
    const result = sanitizeProfileV2(profile);
    expect(result.freDone).toBe(false);
  });

  it('fills profile skills with defaults when fields missing', () => {
    const profile = makeProfile({
      chats: [],
      skills: [{ name: undefined, description: undefined, version: undefined, source: undefined }] as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.skills[0].name).toBe('');
    expect(result.skills[0].description).toBe('');
    expect(result.skills[0].version).toBe('1.0.0');
    expect(result.skills[0].source).toBe('ON-DEVICE');
    expect(result.skills[0].remoteVersion).toBe('');
  });

  it('drops orphaned plugin skills and mcp servers carrying the retired source: PLUGIN', () => {
    const profile = makeProfile({
      chats: [],
      skills: [
        { name: 'plugin--foo--bar', description: 'p', version: '1.0.0', source: 'PLUGIN' },
        { name: 'keep-skill', description: 'k', version: '1.0.0', source: 'ON-DEVICE' },
      ] as any,
      mcp_servers: [
        { name: 'plugin--foo--srv', command: 'node', source: 'PLUGIN' },
        { name: 'keep-srv', command: 'node', source: 'ON-DEVICE' },
      ] as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.skills.map(s => s.name)).toEqual(['keep-skill']);
    expect(result.mcp_servers.map(s => s.name)).toEqual(['keep-srv']);
    expect(result.skills.some(s => (s.source as string) === 'PLUGIN')).toBe(false);
    expect(result.mcp_servers.some(s => (s.source as string) === 'PLUGIN')).toBe(false);
  });

  it('drops plugin-- named profile skills and mcp servers even when source was coerced', () => {
    const profile = makeProfile({
      chats: [],
      skills: [
        { name: 'plugin--foo--bar', description: 'p', version: '1.0.0', source: 'ON-DEVICE' },
        { name: 'keep-skill', description: 'k', version: '1.0.0', source: 'ON-DEVICE' },
      ] as any,
      mcp_servers: [
        { name: 'plugin--foo--srv', command: 'node', source: 'ON-DEVICE' },
        { name: 'keep-srv', command: 'node', source: 'ON-DEVICE' },
      ] as any,
    });
    const result = sanitizeProfileV2(profile);
    expect(result.skills.map(s => s.name)).toEqual(['keep-skill']);
    expect(result.mcp_servers.map(s => s.name)).toEqual(['keep-srv']);
  });

  it('creates default chat when chats array is empty', () => {
    const profile = makeProfile({ chats: [] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].chat_type).toBe('single_agent');
  });
});
