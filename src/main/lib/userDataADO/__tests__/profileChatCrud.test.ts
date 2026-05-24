import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../pathUtils', async () => ({
  getUserDataPath: vi.fn(() => '/mock/userData'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
  getDefaultAgentWorkspacePath: vi.fn((alias: string, name: string, source: string) =>
    `/mock/userData/profiles/${alias}/chat_workspaces/agent-${name.toLowerCase().replace(/\s+/g, '-')}-${source.toLowerCase()}`
  ),
  ensureWorkspaceExists: vi.fn(() => true),
  removeChatSessionsDirectory: vi.fn(() => true),
  removeDefaultWorkspaceDirectory: vi.fn(() => true),
  isDefaultWorkspacePath: vi.fn(() => true),
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  BUILTIN_SKILL_NAMES: ['skill-creator'],
  BUILTIN_DEFAULTS_VERSION: '1.0.0',
}));

vi.mock('../../cache/quickStartImageCacheManager', async () => ({
  quickStartImageCacheManager: {
    getInstance: vi.fn(() => ({
      clearAgentCache: vi.fn(),
    })),
    clearAgentCache: vi.fn(),
  },
}));

import {
  addChatConfig,
  updateChatConfig,
  deleteChatConfig,
  getChatConfig,
  getAllChatConfigs,
  updateChatAgent,
  updateChatSkillSnapshot,
  ChatCrudContext,
} from '../profileChatCrud';
import type { ProfileV2, ChatConfig, ChatAgent } from '../types/profile';

function makeProfile(alias = 'alice'): ProfileV2 {
  return {
    version: '2.0.0' as any,
    alias,
    primaryAgent: 'Test Agent',
    mcp_servers: [],
    skills: [],
    sub_agents: [],
    chats: [],
    'starred-chat-sessions': [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as ProfileV2;
}

function makeAgent(overrides: Partial<ChatAgent> = {}): ChatAgent {
  return {
    name: 'Test Agent',
    model: 'gpt-4o',
    system_prompt: 'Hi',
    source: 'ON-DEVICE',
    version: '1.0.0',
    workspace: '/workspace',
    knowledge: { knowledgeBase: '/workspace/knowledge' },
    mcp_servers: [],
    skills: [],
    ...overrides,
  } as ChatAgent;
}

function makeChat(overrides: Partial<ChatConfig> = {}): ChatConfig {
  return {
    chat_id: 'chat_001',
    chat_type: 'single_agent',
    agent: makeAgent(),
    ...overrides,
  };
}

function makeCtx(profile?: ProfileV2, alias = 'alice'): ChatCrudContext {
  const cache = new Map<string, ProfileV2>();
  if (profile) cache.set(alias, profile);
  return {
    cache,
    readProfileFromFile: vi.fn(async () => null),
    writeProfileToFile: vi.fn(async () => true),
    notifyProfileDataManager: vi.fn(async () => {}),
  };
}

// ── addChatConfig ─────────────────────────────────────────────────────────────

describe('addChatConfig', () => {
  it('adds chat config to profile', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const result = await addChatConfig(ctx, 'alice', makeChat());
    expect(result).toBe(true);
    expect(profile.chats).toHaveLength(1);
  });

  it('returns false when chat_id already exists', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);
  });

  it('auto-sets workspace path when not provided', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({ agent: makeAgent({ workspace: '' }) });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent!.workspace).toContain('agent-');
  });

  it('auto-sets knowledgeBase when empty', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    const chat = makeChat({
      agent: makeAgent({ workspace: '/ws', knowledge: { knowledgeBase: '' } }),
    });
    await addChatConfig(ctx, 'alice', chat);
    expect(chat.agent!.knowledge?.knowledgeBase).toContain('knowledge');
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await addChatConfig(ctx, 'alice', makeChat())).toBe(false);
  });

  it('reads from file when not in cache', async () => {
    const profile = makeProfile();
    const ctx = makeCtx();
    (ctx.readProfileFromFile as any).mockResolvedValue(profile);
    const result = await addChatConfig(ctx, 'alice', makeChat());
    expect(result).toBe(true);
  });
});

// ── updateChatConfig ──────────────────────────────────────────────────────────

describe('updateChatConfig', () => {
  it('updates chat config fields', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = await updateChatConfig(ctx, 'alice', 'chat_001', { chat_type: 'multi_agent' });
    expect(result).toBe(true);
    expect(profile.chats[0].chat_type).toBe('multi_agent');
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateChatConfig(ctx, 'alice', 'no_chat', {})).toBe(false);
  });

  it('returns false when profile not found', async () => {
    const ctx = makeCtx();
    expect(await updateChatConfig(ctx, 'alice', 'chat_001', {})).toBe(false);
  });
});

// ── deleteChatConfig ──────────────────────────────────────────────────────────

describe('deleteChatConfig', () => {
  it('removes chat and replaces with default when it is the only chat', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = await deleteChatConfig(ctx, 'alice', 'chat_001');
    expect(result).toBe(true);
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).not.toBe('chat_001');
  });

  it('splices chat when multiple chats exist', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'chat_001' }));
    profile.chats.push(makeChat({ chat_id: 'chat_002', agent: makeAgent({ name: 'Agent 2' }) }));
    const ctx = makeCtx(profile);
    await deleteChatConfig(ctx, 'alice', 'chat_001');
    expect(profile.chats).toHaveLength(1);
    expect(profile.chats[0].chat_id).toBe('chat_002');
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await deleteChatConfig(ctx, 'alice', 'no_chat')).toBe(false);
  });

  it('returns false when trying to delete builtin agent (Kobi)', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ agent: makeAgent({ name: 'Kobi' }) }));
    const ctx = makeCtx(profile);
    expect(await deleteChatConfig(ctx, 'alice', 'chat_001')).toBe(false);
  });
});

// ── getChatConfig ─────────────────────────────────────────────────────────────

describe('getChatConfig', () => {
  it('returns chat config when found', () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = getChatConfig(ctx, 'alice', 'chat_001');
    expect(result?.chat_id).toBe('chat_001');
  });

  it('returns null when chat not found', () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(getChatConfig(ctx, 'alice', 'no_chat')).toBeNull();
  });

  it('returns null when profile not found', () => {
    const ctx = makeCtx();
    expect(getChatConfig(ctx, 'alice', 'chat_001')).toBeNull();
  });
});

// ── getAllChatConfigs ──────────────────────────────────────────────────────────

describe('getAllChatConfigs', () => {
  it('returns all chats', () => {
    const profile = makeProfile();
    profile.chats.push(makeChat({ chat_id: 'c1' }));
    profile.chats.push(makeChat({ chat_id: 'c2' }));
    const ctx = makeCtx(profile);
    expect(getAllChatConfigs(ctx, 'alice')).toHaveLength(2);
  });

  it('returns empty array when profile not found', () => {
    const ctx = makeCtx();
    expect(getAllChatConfigs(ctx, 'alice')).toEqual([]);
  });
});

// ── updateChatAgent ───────────────────────────────────────────────────────────

describe('updateChatAgent', () => {
  it('updates agent fields', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const result = await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-4o-mini' });
    expect(result).toBe(true);
    expect(profile.chats[0].agent?.model).toBe('gpt-4o-mini');
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateChatAgent(ctx, 'alice', 'no_chat', {})).toBe(false);
  });

  it('syncs primaryAgent when agent is renamed', async () => {
    const profile = makeProfile();
    profile.primaryAgent = 'Test Agent';
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    await updateChatAgent(ctx, 'alice', 'chat_001', { name: 'Renamed Agent' });
    expect(profile.primaryAgent).toBe('Renamed Agent');
  });


  it('clears skill_snapshot when skills change', async () => {
    const profile = makeProfile();
    const chat = makeChat({
      agent: makeAgent({ skills: ['skill-a'] }),
      skill_snapshot: { binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '' },
    });
    profile.chats.push(chat);
    const ctx = makeCtx(profile);
    await updateChatAgent(ctx, 'alice', 'chat_001', { skills: ['skill-b'] });
    expect(profile.chats[0].skill_snapshot).toBeUndefined();
  });

  it('keeps skill_snapshot when skills unchanged', async () => {
    const profile = makeProfile();
    const chat = makeChat({
      agent: makeAgent({ skills: ['skill-a'] }),
      skill_snapshot: { binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '' },
    });
    profile.chats.push(chat);
    const ctx = makeCtx(profile);
    await updateChatAgent(ctx, 'alice', 'chat_001', { model: 'gpt-4o-mini' });
    expect(profile.chats[0].skill_snapshot).toBeDefined();
  });
});

// ── updateChatSkillSnapshot ───────────────────────────────────────────────────

describe('updateChatSkillSnapshot', () => {
  it('sets skill snapshot', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const snapshot = { binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '' };
    const result = await updateChatSkillSnapshot(ctx, 'alice', 'chat_001', snapshot);
    expect(result).toBe(true);
    expect(profile.chats[0].skill_snapshot?.binding_signature).toBe('sig');
  });

  it('clears skill snapshot when passed null', async () => {
    const profile = makeProfile();
    const chat = makeChat({ skill_snapshot: { binding_signature: 'sig', registry_signature: '', prompt: '', skills: [], generated_at: '' } });
    profile.chats.push(chat);
    const ctx = makeCtx(profile);
    await updateChatSkillSnapshot(ctx, 'alice', 'chat_001', null);
    expect(profile.chats[0].skill_snapshot).toBeUndefined();
  });

  it('returns false when chat not found', async () => {
    const profile = makeProfile();
    const ctx = makeCtx(profile);
    expect(await updateChatSkillSnapshot(ctx, 'alice', 'no_chat', null)).toBe(false);
  });

  it('notifies renderer when option is set', async () => {
    const profile = makeProfile();
    profile.chats.push(makeChat());
    const ctx = makeCtx(profile);
    const snapshot = { binding_signature: '', registry_signature: '', prompt: 'p', skills: [], generated_at: '' };
    await updateChatSkillSnapshot(ctx, 'alice', 'chat_001', snapshot, { notifyRenderer: true });
    expect(ctx.notifyProfileDataManager).toHaveBeenCalled();
  });
});
