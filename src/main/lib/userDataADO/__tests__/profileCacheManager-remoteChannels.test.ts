vi.mock('electron', async () => ({
  BrowserWindow: vi.fn(),
  app: {
    getPath: vi.fn(() => '/mock/userData'),
  },
}));
vi.mock('fs');

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => mockLogger),
  createLogger: vi.fn(() => mockLogger),
  getUnifiedLogger: vi.fn(() => mockLogger),
}));

vi.mock('../../cache/quickStartImageCacheManager', async () => ({
  quickStartImageCacheManager: {
    getInstance: vi.fn(() => ({
      cacheQuickStartImages: vi.fn(),
    })),
  },
}));

vi.mock('../../llm/ghcModelsManager', async () => ({
  getDefaultModel: vi.fn(() => 'mock-default-model'),
}));

vi.mock('../chatSessionFileOps', async () => ({
  ChatSessionFileOps: {
    loadChatSessionsFromDisk: vi.fn(() => []),
    saveChatSessionToDisk: vi.fn(),
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

vi.mock('@shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));

vi.mock('@shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('@shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

import { ProfileCacheManager } from '../profileCacheManager';
import type { ProfileV2 } from '../types/profile';

function createTestProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    alias: 'testUser',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    chats: [{
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      agent: {
        role: 'assistant',
        emoji: '🤖',
        name: 'Kobi',
        model: 'claude-sonnet-4.6',
        mcp_servers: [],
        system_prompt: 'You are a helpful assistant.',
        skills: ['skill-creator'],
      },
    }],
    ...overrides,
  } as ProfileV2;
}

describe('ProfileCacheManager remote channel config', () => {
  let manager: ProfileCacheManager;

  beforeEach(() => {
    (ProfileCacheManager as any).instance = undefined;
    manager = ProfileCacheManager.getInstance();
    (manager as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
    (manager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updateRemoteChannelsConfig merges new channel config', async () => {
    const profile = createTestProfile({
      remoteChannels: { teams: { boundChatId: 'chat-1' } },
    });
    (manager as any).cache.set('testUser', profile);

    const success = await manager.updateRemoteChannelsConfig('testUser', {
      teams: { boundChatId: 'chat-2' },
    });

    const updatedProfile = (manager as any).cache.get('testUser') as ProfileV2;
    expect(success).toBe(true);
    expect(updatedProfile.remoteChannels?.teams?.boundChatId).toBe('chat-2');
  });
});
