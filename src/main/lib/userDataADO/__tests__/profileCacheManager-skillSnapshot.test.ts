vi.mock('electron', async () => ({
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));
vi.mock('fs');

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../cache/quickStartImageCacheManager', async () => ({
  quickStartImageCacheManager: {
    getInstance: vi.fn(() => ({
      cacheQuickStartImages: vi.fn(),
      clearAgentCache: vi.fn(),
    })),
  },
}));

vi.mock('../pathUtils', async () => ({
  getDefaultWorkspacePath: vi.fn(() => '/mock/workspace'),
  getDefaultAgentWorkspacePath: vi.fn(() => '/mock/workspace/agent'),
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

import { ProfileCacheManager } from '../profileCacheManager';
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
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [
      {
        name: 'pptx',
        description: 'Create slides',
        version: '1.0.0',
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
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: 'test',
          skills: ['pptx'],
          zero_states: { greeting: '', quick_starts: [] },
        },
        skill_snapshot: createSnapshot(),
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
          source: 'ON-DEVICE',
          mcp_servers: [],
          system_prompt: 'test',
          skills: ['other-skill'],
          zero_states: { greeting: '', quick_starts: [] },
        },
        skill_snapshot: createSnapshot({
          binding_signature: '["other-skill"]',
          registry_signature: '[{"name":"other-skill"}]',
          skills: [
            {
              name: 'other-skill',
              description: 'Other skill',
              version: '2.0.0',
              file_path: '/mock/userData/profiles/testUser/skills/other-skill/SKILL.md',
            },
          ],
          prompt: 'other prompt',
        }),
      },
    ],
    'starred-chat-sessions': [],
    ...overrides,
  };
}

describe('ProfileCacheManager skill snapshot invalidation', () => {
  let manager: ProfileCacheManager;

  beforeEach(() => {
    (ProfileCacheManager as any).instance = undefined;
    manager = ProfileCacheManager.getInstance();
    (manager as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
    (manager as any).readProfileFromFile = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates only affected chat snapshots when addSkill updates an existing skill', async () => {
    const profile = createTestProfile();
    (manager as any).cache.set('testUser', profile);

    const result = await manager.addSkill('testUser', {
      name: 'pptx',
      description: 'Updated slides skill',
      version: '1.1.0',
      source: 'ON-DEVICE',
    });

    expect(result).toBe(true);
    expect(profile.chats[0].skill_snapshot).toBeUndefined();
    expect(profile.chats[1].skill_snapshot).toBeDefined();
    expect(profile.skills![0].version).toBe('1.1.0');
  });

  it('invalidates only affected chat snapshots when deleteSkill removes a referenced skill', async () => {
    const profile = createTestProfile();
    (manager as any).cache.set('testUser', profile);

    const result = await manager.deleteSkill('testUser', 'pptx');

    expect(result).toBe(true);
    expect(profile.skills).toEqual([]);
    expect(profile.chats[0].skill_snapshot).toBeUndefined();
    expect(profile.chats[1].skill_snapshot).toBeDefined();
  });

  it('clears the chat snapshot when updateChatAgent changes skills', async () => {
    const profile = createTestProfile();
    (manager as any).cache.set('testUser', profile);

    const result = await manager.updateChatAgent('testUser', 'chat-1', {
      skills: ['new-skill'],
    });

    expect(result).toBe(true);
    expect(profile.chats[0].agent?.skills).toEqual(['new-skill']);
    expect(profile.chats[0].skill_snapshot).toBeUndefined();
  });

  it('keeps the chat snapshot when updateChatAgent receives the same skills', async () => {
    const profile = createTestProfile();
    (manager as any).cache.set('testUser', profile);

    const result = await manager.updateChatAgent('testUser', 'chat-1', {
      skills: ['pptx'],
    });

    expect(result).toBe(true);
    expect(profile.chats[0].skill_snapshot).toBeDefined();
  });

  it('keeps the chat snapshot when updateChatAgent changes unrelated fields only', async () => {
    const profile = createTestProfile();
    (manager as any).cache.set('testUser', profile);

    const result = await manager.updateChatAgent('testUser', 'chat-1', {
      system_prompt: 'updated prompt only',
    });

    expect(result).toBe(true);
    expect(profile.chats[0].skill_snapshot).toBeDefined();
  });

  it('persists a refreshed chat skill snapshot via updateChatSkillSnapshot', async () => {
    const profile = createTestProfile({
      chats: [
        {
          ...createTestProfile().chats[0],
          skill_snapshot: undefined,
        },
      ],
    });
    (manager as any).cache.set('testUser', profile);

    const nextSnapshot = createSnapshot({
      missing_skill_names: ['missing-skill'],
    });

    const result = await manager.updateChatSkillSnapshot('testUser', 'chat-1', nextSnapshot);

    expect(result).toBe(true);
    expect(profile.chats[0].skill_snapshot).toEqual(nextSnapshot);
    expect((manager as any).writeProfileToFile).toHaveBeenCalledWith('testUser', profile);
  });
});