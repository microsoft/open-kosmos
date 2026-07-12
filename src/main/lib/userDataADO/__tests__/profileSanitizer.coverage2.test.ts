// @ts-nocheck
/**
 * profileSanitizer.coverage2.test.ts
 *
 * Targets uncovered branches (the opposite side of ||/??/ternary fallbacks):
 *  - sanitizeStarredChatSessions non-string chatId/chatSessionId (128, 131),
 *    agent fallbacks to item fields (152, 155, 156)
 *  - buildStarredChatSessionIndexItem find predicate + |[] (174-175), Unnamed Agent (188)
 *  - sanitizeProfileV2 mcp server defaults (326-335), agent field defaults (351-387),
 *    builtin skills already present (395), chat id/type defaults (401-402),
 *    freDone boolean true (416), skill defaults (420-424),
 *    catch-branch alias fallback
 */
import { vi, describe, it, expect } from 'vitest';

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
} from '../profileSanitizer';
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

// ── sanitizeStarredChatSessions non-string ids + agent fallbacks ──────────────

describe('sanitizeStarredChatSessions — id ternary false sides (128, 131)', () => {
  it('coerces non-string chatId and chatSessionId to "" (then skips)', () => {
    const chat = makeChat();
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 123, chatSessionId: 456, title: 'T', lastUpdated: '2026-01-01T00:00:00Z', starredAt: '2026-01-01T00:00:00Z' },
      ] as any,
    });
    // chatId coerced to '' → chatsById.get('') undefined → skipped
    expect(sanitizeStarredChatSessions(profile, [chat])).toEqual([]);
  });
});

describe('sanitizeStarredChatSessions — agent field fallbacks to item (152, 155, 156)', () => {
  it('falls back to item.agentName/agentSource/agentVersion when agent fields blank', () => {
    const chat: any = {
      chat_id: 'chat_blank',
      chat_type: 'single_agent',
      agent: { name: '', emoji: '', avatar: '', source: '', version: '', model: 'm', system_prompt: '', mcp_servers: [], skills: [] },
    };
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        {
          chatId: 'chat_blank',
          chatSessionId: 'chatSession_20260101010101_dev_w1',
          title: 'T',
          lastUpdated: '2026-03-01T00:00:00Z',
          starredAt: '2026-03-01T00:00:00Z',
          agentName: 'ItemAgent',
          agentSource: 'REMOTE',
          agentVersion: '9.9',
        },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].agentName).toBe('ItemAgent');
    expect(result[0].agentSource).toBe('REMOTE');
    expect(result[0].agentVersion).toBe('9.9');
  });

  it('uses "Unnamed Agent" when agent name blank and item has no agentName', () => {
    const chat: any = {
      chat_id: 'chat_blank2',
      chat_type: 'single_agent',
      agent: { name: '', model: 'm', system_prompt: '', source: 'ON-DEVICE', version: '1.0.0', mcp_servers: [], skills: [] },
    };
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        {
          chatId: 'chat_blank2',
          chatSessionId: 'chatSession_20260101010101_dev_w2',
          title: 'T',
          lastUpdated: '2026-03-01T00:00:00Z',
          starredAt: '2026-03-01T00:00:00Z',
        },
      ] as any,
    });
    const result = sanitizeStarredChatSessions(profile, [chat]);
    expect(result[0].agentName).toBe('Unnamed Agent');
  });
});

// ── buildStarredChatSessionIndexItem find predicate + Unnamed Agent ───────────

describe('buildStarredChatSessionIndexItem — find predicate + |[] (174-175)', () => {
  it('runs the find predicate over existing starred sessions and uses existingItem', () => {
    const chat = makeChat();
    const session: Partial<ChatSession> = {
      chatSession_id: 'chatSession_20260101010101_dev_e1',
      title: 'My Session',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const profile = makeProfile({
      chats: [chat],
      'starred-chat-sessions': [
        { chatId: 'chat_001', chatSessionId: 'chatSession_20260101010101_dev_e1', readStatus: 'read', source: 'manual' },
      ] as any,
    });
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result).not.toBeNull();
    // readStatus falls back to existingItem when the session lacks it
    expect(result!.readStatus).toBe('read');
  });

  it('handles undefined starred-chat-sessions via || [] fallback', () => {
    const chat = makeChat();
    const session: Partial<ChatSession> = {
      chatSession_id: 'chatSession_20260101010101_dev_e2',
      title: 'S',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const profile = makeProfile({ chats: [chat], 'starred-chat-sessions': undefined as any });
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result).not.toBeNull();
  });

  it('falls back to "Unnamed Agent" when chat agent has no name (188)', () => {
    const chat: any = {
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: { name: '', model: 'm', system_prompt: '', source: 'ON-DEVICE', version: '1.0.0', mcp_servers: [], skills: [] },
    };
    const session: Partial<ChatSession> = {
      chatSession_id: 'chatSession_20260101010101_dev_e3',
      title: 'S',
      last_updated: '2026-01-01T00:00:00Z',
    };
    const profile = makeProfile({ chats: [chat] });
    const result = buildStarredChatSessionIndexItem(profile, 'chat_001', session);
    expect(result!.agentName).toBe('Unnamed Agent');
  });
});

// ── sanitizeProfileV2 default sides ───────────────────────────────────────────

describe('sanitizeProfileV2 — mcp server default sides (326-335)', () => {
  it('fills defaults for sparse mcp server', () => {
    const profile = makeProfile({
      chats: [makeChat()],
      mcp_servers: [
        { command: 'c', args: 'not-array', env: null, url: 'u', in_use: false } as any,
      ],
    });
    const result = sanitizeProfileV2(profile);
    const srv = result.mcp_servers[0];
    expect(srv.name).toBe('');
    expect(srv.transport).toBe('stdio');
    expect(srv.args).toEqual([]);
    expect(srv.env).toEqual({});
    expect(srv.version).toBe('1.0.0');
    expect(srv.source).toBe('ON-DEVICE');
  });
});

describe('sanitizeProfileV2 — agent field default sides (351-387)', () => {
  it('fills defaults and keeps present array fields for a sparse agent', () => {
    const chat: any = {
      chat_id: 'chat_sparse',
      chat_type: 'single_agent',
      agent: {
        // name, model, version, source, system_prompt, knowledge missing → defaults
        workspace: '/ws',
        skills: 'not-array',          // 351 false → []
        mcp_servers: undefined,        // 366 false → []
        authToken: 'tok-123',          // 387 true
      },
    };
    const profile = makeProfile({
      chats: [chat],
    });
    const result = sanitizeProfileV2(profile);
    const agent: any = result.chats[0].agent;
    expect(agent.name).toBeTruthy();
    expect(agent.model).toBeTruthy();
    expect(agent.version).toBe('1.0.0');
    expect(agent.source).toBe('ON-DEVICE');
    expect(Array.isArray(agent.skills)).toBe(true);
    expect(agent.mcp_servers).toEqual([]);
    expect(agent.authToken).toBe('tok-123');
    expect(result.chats[0].workspace).toBeUndefined();
    expect(agent.workspace).toBeUndefined();
    expect(agent.knowledge.knowledgeBase).toBe('');
  });

  it('computes empty knowledgeBase when no knowledge and no workspace (361 inner false)', () => {
    const chat: any = {
      chat_id: 'chat_nows',
      chat_type: 'single_agent',
      agent: {
        name: 'NoWs',
        model: 'm',
        system_prompt: 's',
        source: 'ON-DEVICE',
        version: '1.0.0',
        workspace: '',
        mcp_servers: [],
        skills: [],
      },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.knowledge.knowledgeBase).toBe('');
  });

  it('uses DEFAULT system_prompt when agent.system_prompt is undefined (382)', () => {
    const chat: any = {
      chat_id: 'chat_nosp',
      chat_type: 'single_agent',
      agent: { name: 'NoSp', model: 'm', source: 'ON-DEVICE', version: '1.0.0', workspace: '', mcp_servers: [], skills: [] },
    };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(result.chats[0].agent!.system_prompt).toEqual(expect.objectContaining({
      'Base.md': expect.any(String),
      'AGENTS.md': '',
    }));
  });
});

describe('sanitizeProfileV2 — builtin agent already has all skills (395 false)', () => {
  it('does not duplicate skills when builtin agent already has them', () => {
    const chat = makeChat();
    chat.agent!.name = 'Kobi';
    chat.agent!.skills = ['skill-creator'];
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    const skills = result.chats[0].agent!.skills;
    expect(skills.filter(s => s === 'skill-creator')).toHaveLength(1);
  });
});

describe('sanitizeProfileV2 — chat id/type defaults (401-402)', () => {
  it('generates chat_id and defaults chat_type when missing', () => {
    const chat: any = { agent: makeChat().agent };
    const profile = makeProfile({ chats: [chat] });
    const result = sanitizeProfileV2(profile);
    expect(typeof result.chats[0].chat_id).toBe('string');
    expect(result.chats[0].chat_id.length).toBeGreaterThan(0);
    expect(result.chats[0].chat_type).toBe('single_agent');
  });
});

describe('sanitizeProfileV2 — freDone boolean true side (416)', () => {
  it('keeps freDone when it is a boolean', () => {
    const profile = makeProfile({ freDone: true });
    const result = sanitizeProfileV2(profile);
    expect(result.freDone).toBe(true);
  });
});

describe('sanitizeProfileV2 — skill default sides (420-424)', () => {
  it('fills defaults for a sparse skill object', () => {
    const profile = makeProfile({ chats: [makeChat()], skills: [{}] as any });
    const result = sanitizeProfileV2(profile);
    const skill = result.skills[0];
    expect(skill.name).toBe('');
    expect(skill.description).toBe('');
    expect(skill.version).toBe('1.0.0');
    expect(skill.source).toBe('ON-DEVICE');
  });
});

describe('sanitizeProfileV2 — catch-branch fallback', () => {
  it('preserves a truthy alias', () => {
    const broken: any = {
      alias: 'caught-user',
      chats: [makeChat()],
      skills: [null], // null.name throws → catch
    };
    const result = sanitizeProfileV2(broken);
    expect(result.version).toBe('2.0.0');
    expect(result.alias).toBe('caught-user');
  });

  it('preserves an empty alias', () => {
    const broken: any = {
      alias: '',
      chats: [makeChat()],
      skills: [null],
    };
    const result = sanitizeProfileV2(broken);
    expect(result.alias).toBe('');
  });
});
