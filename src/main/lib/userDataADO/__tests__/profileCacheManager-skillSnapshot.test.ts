vi.mock('electron', async () => ({
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));
vi.mock('fs');

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../pathUtils', async () => ({
  getDefaultWorkspacePath: vi.fn(() => '/mock/workspace'),
  getDefaultAgentWorkspacePath: vi.fn(() => '/mock/workspace/agent'),
  getProfileDirectoryPath: vi.fn((alias: string) => `/mock/userData/profiles/${alias}`),
  getAgentKnowledgePath: vi.fn((alias: string, agentId: string) =>
    `/mock/userData/profiles/${alias}/agents/${agentId}/knowledge`
  ),
  ensureWorkspaceExists: vi.fn(),
  removeChatSessionsDirectory: vi.fn(),
  removeDefaultWorkspaceDirectory: vi.fn(),
  isDefaultWorkspacePath: vi.fn(() => false),
  moveContentsToDirectory: vi.fn(),
}));

vi.mock('../chatSessionManager', async () => ({
  chatSessionManager: {
    loadChatSessions: vi.fn(),
    saveChatSession: vi.fn(),
  },
}));

vi.mock('../../../../shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('../../../../shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn(),
    saveSession: vi.fn(),
    deleteSession: vi.fn(),
  },
}));

// Mock only the disk I/O of skillsFileStore; keep the real pure helpers so the
// SkillsConfigManager dirty-check behaves exactly as in production.
vi.mock('../skillsFileStore', async () => {
  const actual = await vi.importActual<typeof import('../skillsFileStore')>('../skillsFileStore');
  return {
    ...actual,
    loadSkillsForProfile: vi.fn(async (_dir: string, raw: { skills?: unknown }) => ({
      skills: Array.isArray(raw?.skills) ? raw.skills : [],
      needsProfileRewrite: false,
    })),
    writeSkillsFile: vi.fn(async () => {}),
    readSkillsFile: vi.fn(async () => null),
  };
});

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProfileCacheManager } from '../profileCacheManager';
import { skillsConfigManager } from '../skillsConfigManager';
import { chatSkillSnapshotStore } from '../chatSkillSnapshotStore';
import type { ChatSkillSnapshot, ProfileV2 } from '../types/profile';

function createSnapshot(overrides: Partial<ChatSkillSnapshot> = {}): ChatSkillSnapshot {
  return {
    binding_signature: '["pptx"]',
    registry_signature: '[{"name":"pptx"}]',
    generated_at: '2026-03-24T00:00:00.000Z',
    skills: [
      {
        name: 'pptx',
        description: 'Create slides',
        version: '1.0.0',
        file_path: '/mock/userData/profiles/testUser/skills/pptx/SKILL.md',
      },
    ],
    prompt: 'skills prompt',
    ...overrides,
  };
}

function createTestProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    alias: 'testUser',
    freDone: true,
    mcp_servers: [],
    skills: [
      {
        name: 'pptx',
        description: 'Create slides',
        version: '1.0.0',
        remoteVersion: '',
        source: 'ON-DEVICE',
      },
    ],
    chats: [
      {
        chat_id: 'chat-1',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Agent One',
          model: 'claude-sonnet-4.6',
          workspace: '',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: { 'Base.md': 'test', 'AGENTS.md': '' },
          skills: ['pptx'],
          zero_states: { greeting: '', quick_starts: [] },
        },
      },
      {
        chat_id: 'chat-2',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          avatar: '',
          name: 'Agent Two',
          model: 'claude-sonnet-4.6',
          workspace: '',
          knowledgeBase: '',
          version: '1.0.0',
          remoteVersion: '',
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: { 'Base.md': 'test', 'AGENTS.md': '' },
          skills: ['other-skill'],
          zero_states: { greeting: '', quick_starts: [] },
        },
      },
    ],
    'starred-chat-sessions': [],
    ...overrides,
  };
}

describe('ProfileCacheManager skill snapshot invalidation (in-memory store)', () => {
  let manager: ProfileCacheManager;

  beforeEach(async () => {
    (ProfileCacheManager as any).instance = undefined;
    manager = ProfileCacheManager.getInstance();
    (manager as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    (manager as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
    skillsConfigManager.clearAll();
    chatSkillSnapshotStore.clearAll();
  });

  async function primeRegistryAndSnapshots(profile: ProfileV2): Promise<void> {
    (manager as any).cache.set('testUser', profile);
    await skillsConfigManager.loadForAlias('testUser', profile);
    chatSkillSnapshotStore.set('testUser', 'chat-1', createSnapshot());
    chatSkillSnapshotStore.set('testUser', 'chat-2', createSnapshot({
      binding_signature: '["other-skill"]',
      registry_signature: '[{"name":"other-skill"}]',
      prompt: 'other prompt',
    }));
  }

  it('invalidates only affected chat snapshots when addSkill updates an existing skill', async () => {
    const profile = createTestProfile();
    await primeRegistryAndSnapshots(profile);

    const result = await manager.addSkill('testUser', {
      name: 'pptx',
      description: 'Updated slides skill',
      version: '1.1.0',
      remoteVersion: '',
      source: 'ON-DEVICE',
    });

    expect(result).toBe(true);
    expect(chatSkillSnapshotStore.get('testUser', 'chat-1')).toBeUndefined();
    expect(chatSkillSnapshotStore.get('testUser', 'chat-2')).toBeDefined();
    expect(skillsConfigManager.getSkill('testUser', 'pptx')?.version).toBe('1.1.0');
  });

  it('invalidates only affected chat snapshots when deleteSkill removes a referenced skill', async () => {
    const profile = createTestProfile();
    await primeRegistryAndSnapshots(profile);

    const result = await manager.deleteSkill('testUser', 'pptx');

    expect(result).toBe(true);
    expect(skillsConfigManager.hasSkill('testUser', 'pptx')).toBe(false);
    expect(chatSkillSnapshotStore.get('testUser', 'chat-1')).toBeUndefined();
    expect(chatSkillSnapshotStore.get('testUser', 'chat-2')).toBeDefined();
  });

  it('updates skill config and notifies without touching unaffected snapshots when updateSkill runs', async () => {
    const profile = createTestProfile();
    await primeRegistryAndSnapshots(profile);

    const result = await manager.updateSkill('testUser', 'pptx', { version: '2.0.0' });

    expect(result).toBe(true);
    expect(skillsConfigManager.getSkill('testUser', 'pptx')?.version).toBe('2.0.0');
    expect(chatSkillSnapshotStore.get('testUser', 'chat-1')).toBeUndefined();
    expect(chatSkillSnapshotStore.get('testUser', 'chat-2')).toBeDefined();
  });

  it('clears the chat snapshot when updateChatAgent changes skills', async () => {
    const profile = createTestProfile();
    await primeRegistryAndSnapshots(profile);

    const result = await manager.updateChatAgent('testUser', 'chat-1', {
      skills: ['new-skill'],
    });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.skills).toEqual(['new-skill']);
    expect(chatSkillSnapshotStore.get('testUser', 'chat-1')).toBeUndefined();
  });

  it('keeps the chat snapshot when updateChatAgent receives the same skills', async () => {
    const profile = createTestProfile();
    await primeRegistryAndSnapshots(profile);

    const result = await manager.updateChatAgent('testUser', 'chat-1', {
      skills: ['pptx'],
    });

    expect(result).toBe(true);
    expect(chatSkillSnapshotStore.get('testUser', 'chat-1')).toBeDefined();
  });

  it('keeps the chat snapshot when updateChatAgent changes unrelated fields only', async () => {
    const profile = createTestProfile();
    await primeRegistryAndSnapshots(profile);

    const result = await manager.updateChatAgent('testUser', 'chat-1', {
      system_prompt: { 'Base.md': 'updated prompt only', 'AGENTS.md': '' },
    });

    expect(result).toBe(true);
    expect(chatSkillSnapshotStore.get('testUser', 'chat-1')).toBeDefined();
  });
});
