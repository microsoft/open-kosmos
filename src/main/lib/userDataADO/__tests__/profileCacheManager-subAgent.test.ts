/**
 * ProfileCacheManager Sub-Agent CRUD unit tests
 *
 * Tests addSubAgent / updateSubAgent / deleteSubAgent / getSubAgents methods,
 * and the integration of sanitizeSubAgents within sanitizeProfileV2.
 */

// Mock dependencies before importing
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
// Also mock via alias paths
vi.mock('@shared/constants/branding', async () => ({
  BRAND_NAME: 'openkosmos',
}));
vi.mock('@shared/constants/builtinSkills', async () => ({
  ...await vi.importActual('@shared/constants/builtinSkills'),
  BUILTIN_SKILL_NAMES: ['skill-creator'],
}));

// Mock SubAgentFileManager (used by getSubAgents/addSubAgent/updateSubAgent/deleteSubAgent)
const { mockFileManager } = vi.hoisted(() => ({
  mockFileManager: {
    scanAllAgents: vi.fn().mockResolvedValue([]),
    readAgentConfig: vi.fn().mockResolvedValue(null),
    writeAgentConfig: vi.fn().mockResolvedValue(undefined),
    deleteAgentDirectory: vi.fn().mockResolvedValue(undefined),
    getCachedConfigs: vi.fn().mockReturnValue([]),
    getCachedConfig: vi.fn().mockReturnValue(undefined),
    isCacheWarmed: vi.fn().mockReturnValue(false),
    markCacheWarmed: vi.fn(),
  },
}));
vi.mock('../../subAgent/subAgentFileManager', async () => ({
  SubAgentFileManager: {
    getInstance: vi.fn(() => mockFileManager),
  },
}));

import { ProfileCacheManager } from '../profileCacheManager';
import { sanitizeProfileV2 } from '../profileSanitizer';
import type { SubAgentConfig, ProfileV2 } from '../types/profile';

// ============================================================
// Helper: create a minimal V2 profile for testing
// ============================================================
function createTestProfile(overrides: Partial<ProfileV2> = {}): ProfileV2 {
  return {
    version: '2.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    alias: 'testUser',
    freDone: true,
    primaryAgent: 'Kobi',
    mcp_servers: [],
    skills: [],
    sub_agents: [],
    chats: [{
      chat_id: 'chat_001',
      chat_type: 'single_agent',
      agent: {
        role: 'assistant',
        emoji: '🤖',
        name: 'Kobi',
        model: 'gpt-4o',
        mcp_servers: [],
        system_prompt: 'You are a helpful assistant.',
        skills: ['skill-creator'],
        sub_agents: [],
      },
    }],
    ...overrides,
  } as ProfileV2;
}

function createTestSubAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    name: 'test-sub-agent',
    description: 'A test sub-agent',
    system_prompt: 'You are a test sub-agent.',
    mcp_servers: [],
    skills: [],
    builtin_tools: [],
    ...overrides,
  };
}

// ============================================================
// Test setup: access singleton + inject cache directly
// ============================================================
let pcManager: ProfileCacheManager;

beforeEach(() => {
  // Reset singleton
  (ProfileCacheManager as any).instance = undefined;
  pcManager = ProfileCacheManager.getInstance();

  // Mock writeProfileToFile and notifyProfileDataManager to avoid side effects
  (pcManager as any).writeProfileToFile = vi.fn().mockResolvedValue(true);
  (pcManager as any).notifyProfileDataManager = vi.fn().mockResolvedValue(undefined);
  (pcManager as any).readProfileFromFile = vi.fn().mockResolvedValue(null);

  // Reset SubAgentFileManager mocks
  mockFileManager.scanAllAgents.mockReset().mockResolvedValue([]);
  mockFileManager.readAgentConfig.mockReset().mockResolvedValue(null);
  mockFileManager.writeAgentConfig.mockReset().mockResolvedValue(undefined);
  mockFileManager.deleteAgentDirectory.mockReset().mockResolvedValue(undefined);
  mockFileManager.getCachedConfigs.mockReset().mockReturnValue([]);
  mockFileManager.getCachedConfig.mockReset().mockReturnValue(undefined);
  mockFileManager.isCacheWarmed.mockReset().mockReturnValue(false);
  mockFileManager.markCacheWarmed.mockReset();
});

// ============================================================
// getSubAgents
// ============================================================
describe('getSubAgents', () => {
  it('should return empty array when no profile is cached', async () => {
    expect(await pcManager.getSubAgents()).toEqual([]);
  });

  it('should return empty array when profile has no sub_agents', async () => {
    const profile = createTestProfile({ sub_agents: undefined });
    (pcManager as any).cache.set('testUser', profile);
    expect(await pcManager.getSubAgents()).toEqual([]);
  });

  it('should return sub_agents from cached profile', async () => {
    const subAgent = createTestSubAgentConfig();
    const profile = createTestProfile({ sub_agents: [subAgent] });
    (pcManager as any).cache.set('testUser', profile);

    // Mock scanAllAgents to return the sub-agent (file-based)
    mockFileManager.scanAllAgents.mockResolvedValue([subAgent]);

    const result = await pcManager.getSubAgents();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-sub-agent');
  });
});

// ============================================================
// addSubAgent
// ============================================================
describe('addSubAgent', () => {
  it('should add a new sub-agent to the profile', async () => {
    const profile = createTestProfile();
    (pcManager as any).cache.set('testUser', profile);

    const config = createTestSubAgentConfig();
    const result = await pcManager.addSubAgent('testUser', config);

    expect(result).toBe(true);
    // Profile stores lightweight SubAgentIndex, not full config
    expect(profile.sub_agents).toHaveLength(1);
    expect(profile.sub_agents![0].name).toBe('test-sub-agent');
    expect((profile.sub_agents![0] as any).version).toBe('1.0.0');
    // Full config written to AGENT.md via SubAgentFileManager
    expect(mockFileManager.writeAgentConfig).toHaveBeenCalled();
    expect((pcManager as any).writeProfileToFile).toHaveBeenCalledWith('testUser', profile);
    expect((pcManager as any).notifyProfileDataManager).toHaveBeenCalledWith('testUser');
  });

  it('should update existing sub-agent with same name (idempotent)', async () => {
    const existingIndex = { name: 'test-sub-agent', version: '1.0.0', source: 'ON-DEVICE' as const };
    const profile = createTestProfile({ sub_agents: [existingIndex] });
    (pcManager as any).cache.set('testUser', profile);

    const updatedConfig = createTestSubAgentConfig({ description: 'new description' });
    const result = await pcManager.addSubAgent('testUser', updatedConfig);

    expect(result).toBe(true);
    expect(profile.sub_agents).toHaveLength(1);
    // Full config written to AGENT.md
    expect(mockFileManager.writeAgentConfig).toHaveBeenCalled();
  });

  it('should initialize sub_agents array if undefined', async () => {
    const profile = createTestProfile({ sub_agents: undefined });
    (pcManager as any).cache.set('testUser', profile);

    const config = createTestSubAgentConfig();
    const result = await pcManager.addSubAgent('testUser', config);

    expect(result).toBe(true);
    expect(profile.sub_agents).toHaveLength(1);
  });

  it('should return false when profile is not found', async () => {
    const result = await pcManager.addSubAgent('nonExistent', createTestSubAgentConfig());
    expect(result).toBe(false);
  });

  it('should return false when writeProfileToFile fails', async () => {
    const profile = createTestProfile();
    (pcManager as any).cache.set('testUser', profile);
    (pcManager as any).writeProfileToFile = vi.fn().mockResolvedValue(false);

    const result = await pcManager.addSubAgent('testUser', createTestSubAgentConfig());
    expect(result).toBe(false);
  });

  it('should fall back to reading from file when not cached', async () => {
    const profile = createTestProfile();
    (pcManager as any).readProfileFromFile = vi.fn().mockResolvedValue(profile);

    const config = createTestSubAgentConfig();
    const result = await pcManager.addSubAgent('testUser', config);

    expect(result).toBe(true);
    expect((pcManager as any).readProfileFromFile).toHaveBeenCalledWith('testUser');
  });
});

// ============================================================
// updateSubAgent
// ============================================================
describe('updateSubAgent', () => {
  it('should update an existing sub-agent', async () => {
    // Profile stores SubAgentIndex (post-migration format)
    const index = { name: 'test-sub-agent', version: '1.0.0', source: 'ON-DEVICE' as const };
    const profile = createTestProfile({ sub_agents: [index] });
    (pcManager as any).cache.set('testUser', profile);

    // Mock readAgentConfig to return existing full config from disk
    const existingConfig = createTestSubAgentConfig();
    mockFileManager.readAgentConfig.mockResolvedValue(existingConfig);

    const result = await pcManager.updateSubAgent('testUser', 'test-sub-agent', {
      description: 'updated description',
    });

    expect(result).toBe(true);
    // Verify full merged config was written to AGENT.md
    expect(mockFileManager.writeAgentConfig).toHaveBeenCalled();
    const writtenConfig = mockFileManager.writeAgentConfig.mock.calls[0][1] as SubAgentConfig;
    expect(writtenConfig.description).toBe('updated description');
    expect(writtenConfig.name).toBe('test-sub-agent');
    // Profile still stores SubAgentIndex
    expect(profile.sub_agents![0].name).toBe('test-sub-agent');
  });

  it('should return false when sub-agent is not found', async () => {
    const profile = createTestProfile({ sub_agents: [] });
    (pcManager as any).cache.set('testUser', profile);

    const result = await pcManager.updateSubAgent('testUser', 'nonexistent', {
      description: 'updated',
    });

    expect(result).toBe(false);
  });

  it('should return false when profile is not found', async () => {
    const result = await pcManager.updateSubAgent('nonExistent', 'test', { description: 'x' });
    expect(result).toBe(false);
  });

  it('should return false when sub_agents array is undefined', async () => {
    const profile = createTestProfile({ sub_agents: undefined });
    (pcManager as any).cache.set('testUser', profile);

    const result = await pcManager.updateSubAgent('testUser', 'test', { description: 'x' });
    expect(result).toBe(false);
  });
});

// ============================================================
// deleteSubAgent
// ============================================================
describe('deleteSubAgent', () => {
  it('should delete an existing sub-agent', async () => {
    const config = createTestSubAgentConfig();
    const profile = createTestProfile({ sub_agents: [config] });
    (pcManager as any).cache.set('testUser', profile);

    const result = await pcManager.deleteSubAgent('testUser', 'test-sub-agent');

    expect(result).toBe(true);
    expect(profile.sub_agents).toHaveLength(0);
  });

  it('should cascade-clean ChatAgent references', async () => {
    const config = createTestSubAgentConfig({ name: 'web-researcher' });
    const profile = createTestProfile({
      sub_agents: [config],
      chats: [{
        chat_id: 'chat_001',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          name: 'Kobi',
          model: 'gpt-4o',
          mcp_servers: [],
          system_prompt: 'You are a helpful assistant.',
          sub_agents: ['web-researcher', 'code-reviewer'],
        },
      }],
    });
    (pcManager as any).cache.set('testUser', profile);

    const result = await pcManager.deleteSubAgent('testUser', 'web-researcher');

    expect(result).toBe(true);
    expect(profile.chats[0].agent!.sub_agents).toEqual(['code-reviewer']);
  });

  it('should return false when sub-agent is not found', async () => {
    const profile = createTestProfile({ sub_agents: [] });
    (pcManager as any).cache.set('testUser', profile);

    const result = await pcManager.deleteSubAgent('testUser', 'nonexistent');
    expect(result).toBe(false);
  });

  it('should return false when profile is not found', async () => {
    const result = await pcManager.deleteSubAgent('nonExistent', 'test');
    expect(result).toBe(false);
  });

  it('should handle multiple sub-agents correctly', async () => {
    const configs = [
      createTestSubAgentConfig({ name: 'agent-1' }),
      createTestSubAgentConfig({ name: 'agent-2' }),
      createTestSubAgentConfig({ name: 'agent-3' }),
    ];
    const profile = createTestProfile({ sub_agents: configs });
    (pcManager as any).cache.set('testUser', profile);

    await pcManager.deleteSubAgent('testUser', 'agent-2');

    expect(profile.sub_agents).toHaveLength(2);
    expect(profile.sub_agents!.map(sa => sa.name)).toEqual(['agent-1', 'agent-3']);
  });
});

// ============================================================
// sanitizeSubAgents (tested via sanitizeProfileV2)
// ============================================================
describe('sanitizeSubAgents (via sanitizeProfileV2)', () => {
  it('should deduplicate sub-agents by name', () => {
    const profile = createTestProfile({
      sub_agents: [
        createTestSubAgentConfig({ name: 'dup-agent' }),
        createTestSubAgentConfig({ name: 'dup-agent', description: 'second copy' }),
        createTestSubAgentConfig({ name: 'unique-agent' }),
      ],
    });

    const sanitized = sanitizeProfileV2(profile);
    expect(sanitized.sub_agents).toHaveLength(2);
    expect(sanitized.sub_agents!.map((sa: any) => sa.name)).toEqual(['dup-agent', 'unique-agent']);
  });

  it('should set default values for missing fields', () => {
    const incomplete = {
      name: 'incomplete-agent',
      display_name: '',
      description: '',
      emoji: '',
      version: '',
      source: '' as any,
      system_prompt: '',
      mcp_servers: null as any,
      context_access: '' as any,
    };
    const profile = createTestProfile({ sub_agents: [incomplete as any] });

    const sanitized = sanitizeProfileV2(profile);
    const sa = sanitized.sub_agents![0] as any;

    expect(sa.mcp_servers).toEqual([]);
    expect(sa.skills).toEqual([]);
    expect(sa.builtin_tools).toEqual([]);
    expect(sa.inherit_mcp_servers).toBe(true);
    expect(sa.inherit_skills).toBe(true);
  });

  it('should clean dangling ChatAgent sub-agent references', () => {
    const profile = createTestProfile({
      sub_agents: [createTestSubAgentConfig({ name: 'valid-agent' })],
      chats: [{
        chat_id: 'chat_001',
        chat_type: 'single_agent',
        agent: {
          role: 'assistant',
          emoji: '🤖',
          name: 'Kobi',
          model: 'gpt-4o',
          mcp_servers: [],
          system_prompt: 'test',
          sub_agents: ['valid-agent', 'dangling-ref'],
        },
      }],
    });

    const sanitized = sanitizeProfileV2(profile);

    expect((sanitized as any).chats[0].agent.sub_agents).toEqual(['valid-agent']);
  });

  it('should handle missing sub_agents field gracefully', () => {
    const profile = createTestProfile({ sub_agents: undefined });

    const sanitized = sanitizeProfileV2(profile);
    expect(sanitized.sub_agents).toEqual([]);
  });

  it('should handle null entries in sub_agents array', () => {
    const profile = createTestProfile({
      sub_agents: [
        null as any,
        createTestSubAgentConfig({ name: 'valid' }),
        undefined as any,
      ],
    });

    const sanitized = sanitizeProfileV2(profile);
    expect(sanitized.sub_agents).toHaveLength(1);
    expect(((sanitized.sub_agents![0]) as any).name).toBe('valid');
  });

  // ─── New inheritance fields sanitization ───
  it('should preserve inherit_mcp_servers=false', () => {
    const config = createTestSubAgentConfig({ inherit_mcp_servers: false } as any);
    const profile = createTestProfile({ sub_agents: [config] });

    const sanitized = sanitizeProfileV2(profile);
    expect(((sanitized.sub_agents![0]) as any).inherit_mcp_servers).toBe(false);
  });

  it('should default inherit_mcp_servers to true when undefined', () => {
    const config = createTestSubAgentConfig();
    delete (config as any).inherit_mcp_servers;
    const profile = createTestProfile({ sub_agents: [config] });

    const sanitized = sanitizeProfileV2(profile);
    expect(((sanitized.sub_agents![0]) as any).inherit_mcp_servers).toBe(true);
  });

  it('should preserve inherit_skills=false', () => {
    const config = createTestSubAgentConfig({ inherit_skills: false } as any);
    const profile = createTestProfile({ sub_agents: [config] });

    const sanitized = sanitizeProfileV2(profile);
    expect(((sanitized.sub_agents![0]) as any).inherit_skills).toBe(false);
  });

  it('should default inherit_skills to true when undefined', () => {
    const config = createTestSubAgentConfig();
    delete (config as any).inherit_skills;
    const profile = createTestProfile({ sub_agents: [config] });

    const sanitized = sanitizeProfileV2(profile);
    expect(((sanitized.sub_agents![0]) as any).inherit_skills).toBe(true);
  });
});
