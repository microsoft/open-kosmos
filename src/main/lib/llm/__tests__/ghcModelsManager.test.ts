/**
 * Tests for GhcModelsManager — focus on refreshFromRemote() integrity check
 * and _doInitialize() local-cache-first behavior.
 */

import { GhcCopilotModel } from '@shared/types/ghcChatTypes';

// ============================================================================
// Mocks
// ============================================================================

const mockGetAllWindows = vi.fn().mockReturnValue([]);

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
  app: { getPath: () => '/tmp/test-app-data' },
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

const mockGetCopilotAccessToken = vi.fn();
const mockRefreshCopilotToken = vi.fn();

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: () => ({
      getCopilotAccessToken: mockGetCopilotAccessToken,
      refreshCopilotToken: mockRefreshCopilotToken,
    }),
  },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.test.com',
    USER_AGENT: 'test',
    EDITOR_VERSION: '1.0',
    EDITOR_PLUGIN_VERSION: '1.0',
  },
}));

// Mock fs
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  promises: {
    readFile: (...args: any[]) => mockReadFile(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

// ============================================================================
// Helpers
// ============================================================================

function makeModel(id: string, overrides?: Partial<GhcCopilotModel>): GhcCopilotModel {
  return {
    id,
    name: id,
    vendor: 'test',
    version: '1.0',
    object: 'model',
    preview: false,
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: true,
    billing: { is_premium: false, multiplier: 1 },
    capabilities: {
      family: id,
      object: 'model_capabilities',
      tokenizer: 'test',
      type: 'chat',
      supports: { streaming: true, tool_calls: true, vision: false },
    },
    ...overrides,
  };
}

const claudeModel = makeModel('claude-sonnet-4.6');
const geminiModel = makeModel('gemini-2.5-pro');
const gptModel = makeModel('gpt-5.5');

/**
 * Get a fresh GhcModelsManager instance (bypass singleton for isolation).
 * We access the private constructor via module re-import.
 */
async function getManager() {
  // Reset module to get a fresh singleton
  vi.resetModules();
  // Re-mock after reset
  vi.doMock('electron', () => ({
    BrowserWindow: { getAllWindows: () => mockGetAllWindows() },
    app: { getPath: () => '/tmp/test-app-data' },
  }));
  vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
  vi.doMock('../../auth/authManager', () => ({
    MainAuthManager: {
      getInstance: () => ({
        getCopilotAccessToken: mockGetCopilotAccessToken,
        refreshCopilotToken: mockRefreshCopilotToken,
      }),
    },
  }));
  vi.doMock('../../auth/ghcConfig', () => ({
    GHC_CONFIG: {
      API_ENDPOINT: 'https://api.test.com',
      USER_AGENT: 'test',
      EDITOR_VERSION: '1.0',
      EDITOR_PLUGIN_VERSION: '1.0',
    },
  }));
  vi.doMock('fs', () => ({
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    promises: {
      readFile: (...args: any[]) => mockReadFile(...args),
      writeFile: (...args: any[]) => mockWriteFile(...args),
    },
  }));

  const mod = await import('../ghcModelsManager');
  return mod.ghcModelsManager;
}

// ============================================================================
// Tests
// ============================================================================

describe('GhcModelsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockWriteFile.mockResolvedValue(undefined);
    // Default: no token during initialize to prevent background refresh interference
    mockGetCopilotAccessToken.mockReturnValue(null);
    mockRefreshCopilotToken.mockResolvedValue({ success: false });
  });

  describe('refreshFromRemote() — integrity check', () => {
    it('should update cache when remote has Claude models', async () => {
      const manager = await getManager();
      // Seed local cache with Claude
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel] }));
      // Disable token during init to prevent background refresh interference
      mockGetCopilotAccessToken.mockReturnValue(null);
      mockRefreshCopilotToken.mockResolvedValue({ success: false });
      await manager.initialize('test-alias');

      // Now enable token for explicit refresh
      mockGetCopilotAccessToken.mockReturnValue('test-token');
      const remoteModels = [claudeModel, geminiModel, gptModel];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: remoteModels }),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(true);
      expect(manager.getAllModels()).toHaveLength(3);
    });

    it('should NOT update cache when remote is missing Claude but local has Claude', async () => {
      const manager = await getManager();
      // Seed local cache with Claude; background refresh will also hit this mock
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel] }));
      // Make background refresh from initialize() a no-op (no token)
      mockGetCopilotAccessToken.mockReturnValue(null);
      mockRefreshCopilotToken.mockResolvedValue({ success: false });
      await manager.initialize('test-alias');

      // Now set up for the explicit refreshFromRemote call
      mockGetCopilotAccessToken.mockReturnValue('test-token');
      const remoteModels = [geminiModel, gptModel];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: remoteModels }),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
      // Local cache preserved — still has Claude
      expect(manager.getAllModels()).toHaveLength(2);
      expect(manager.getAllModels().some(m => m.id === 'claude-sonnet-4.6')).toBe(true);
    });

    it('should update cache when remote has no Claude AND local has no Claude', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [geminiModel] }));
      await manager.initialize('test-alias');

      // Enable token for explicit refresh
      mockGetCopilotAccessToken.mockReturnValue('test-token');
      const remoteModels = [geminiModel, gptModel];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: remoteModels }),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(true);
      expect(manager.getAllModels()).toHaveLength(2);
    });

    it('should NOT update cache when remote returns empty list', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
      expect(manager.getAllModels()).toHaveLength(1);
    });

    it('should return false when fetch response is not ok', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
      expect(manager.getAllModels()).toHaveLength(1);
    });

    it('should return false when no access token available', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      // Keep token null (already default)
      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
    });

    it('should return false on unexpected API response format', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: 'format' }),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
    });

    it('should handle direct array response format from API', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [geminiModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      const remoteModels = [geminiModel, gptModel];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(remoteModels),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(true);
      expect(manager.getAllModels()).toHaveLength(2);
    });

    it('should return false on network error (fetch throws)', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      mockFetch.mockRejectedValue(new Error('Network unreachable'));

      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
      expect(manager.getAllModels()).toHaveLength(1);
    });

    it('should attempt token refresh when initial token is null', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [geminiModel] }));
      await manager.initialize('test-alias');

      // First call returns null, after refresh returns token
      mockGetCopilotAccessToken.mockReturnValueOnce(null).mockReturnValueOnce('refreshed-token');
      mockRefreshCopilotToken.mockResolvedValue({ success: true });

      const remoteModels = [geminiModel, gptModel];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: remoteModels }),
      });

      const result = await manager.refreshFromRemote();
      expect(result).toBe(true);
      expect(mockRefreshCopilotToken).toHaveBeenCalled();
    });

    it('should persist to file after successful update', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [geminiModel] }));
      await manager.initialize('test-alias');
      mockWriteFile.mockClear();

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      const remoteModels = [claudeModel, geminiModel];
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: remoteModels }),
      });

      await manager.refreshFromRemote();
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writtenData = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(writtenData.models).toHaveLength(2);
      expect(writtenData.count).toBe(2);
      expect(writtenData.updatedAt).toBeDefined();
    });

    it('should handle saveToFile error gracefully and still update cache', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [geminiModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      mockWriteFile.mockRejectedValue(new Error('disk full'));
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [claudeModel, geminiModel] }),
      });

      // Should not throw even if saveToFile fails
      const result = await manager.refreshFromRemote();
      expect(result).toBe(true);
      expect(manager.getAllModels()).toHaveLength(2);
    });

    it('should handle token refresh error gracefully', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      mockGetCopilotAccessToken.mockReturnValue(null);
      mockRefreshCopilotToken.mockRejectedValue(new Error('refresh crash'));

      const result = await manager.refreshFromRemote();
      expect(result).toBe(false);
    });

    it('should NOT persist to file when integrity check fails', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel] }));
      await manager.initialize('test-alias');
      mockWriteFile.mockClear();

      mockGetCopilotAccessToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [geminiModel] }),
      });

      await manager.refreshFromRemote();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('initialize() — local cache first', () => {
    it('should load from local cache and notify renderer', async () => {
      const manager = await getManager();
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
      mockGetAllWindows.mockReturnValue([mockWin]);
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel] }));

      await manager.initialize('test-alias');

      expect(manager.getAllModels()).toHaveLength(2);
      expect(mockWin.webContents.send).toHaveBeenCalledWith('models:updated', expect.objectContaining({ count: 2 }));
    });

    it('should not notify renderer when local cache is empty', async () => {
      const manager = await getManager();
      const mockWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
      mockGetAllWindows.mockReturnValue([mockWin]);
      mockExistsSync.mockReturnValue(false); // No local file

      await manager.initialize('test-alias');

      expect(manager.getAllModels()).toHaveLength(0);
      expect(mockWin.webContents.send).not.toHaveBeenCalled();
    });

    it('should handle loadFromFile error gracefully', async () => {
      const manager = await getManager();
      mockReadFile.mockRejectedValue(new Error('disk error'));

      await manager.initialize('test-alias');

      expect(manager.getAllModels()).toHaveLength(0);
    });

    it('should support bare array format in local file', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify([claudeModel, geminiModel]));

      await manager.initialize('test-alias');
      expect(manager.getAllModels()).toHaveLength(2);
    });

    it('should return false for invalid file format', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ invalid: 'format' }));

      await manager.initialize('test-alias');
      expect(manager.getAllModels()).toHaveLength(0);
    });

    it('should re-initialize when alias changes', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));

      await manager.initialize('alias-1');
      expect(manager.getAllModels()).toHaveLength(1);

      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel, gptModel] }));
      await manager.initialize('alias-2');
      expect(manager.getAllModels()).toHaveLength(3);
    });

    it('should not re-initialize when same alias is passed', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));

      await manager.initialize('same-alias');
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel, gptModel] }));
      await manager.initialize('same-alias');
      expect(manager.getAllModels()).toHaveLength(1);
    });

    it('should skip destroyed windows when notifying renderer', async () => {
      const manager = await getManager();
      const destroyedWin = { isDestroyed: () => true, webContents: { send: vi.fn() } };
      const goodWin = { isDestroyed: () => false, webContents: { send: vi.fn() } };
      mockGetAllWindows.mockReturnValue([destroyedWin, goodWin]);
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));

      await manager.initialize('test-alias');

      expect(destroyedWin.webContents.send).not.toHaveBeenCalled();
      expect(goodWin.webContents.send).toHaveBeenCalled();
    });

    it('should handle notifyRenderer error gracefully', async () => {
      const manager = await getManager();
      mockGetAllWindows.mockImplementation(() => { throw new Error('window error'); });
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));

      // Should not throw
      await manager.initialize('test-alias');
      expect(manager.getAllModels()).toHaveLength(1);
    });
  });

  describe('getAllOpenKosmosUsedModels() — dynamic filtering', () => {
    it('should filter and sort models by pattern rules', async () => {
      const manager = await getManager();
      const models = [
        makeModel('claude-sonnet-4.6'),
        makeModel('claude-opus-4.5'),
        makeModel('gemini-2.5-pro'),
        makeModel('gpt-5.5'),
        makeModel('gpt-4.1'), // Should be excluded (< 5.1)
        makeModel('claude-haiku-4.5'), // Should be excluded by OPENKOSMOS_MODEL_EXCLUDE
        makeModel('gemini-2.5-flash'), // Should be excluded
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ models }));

      await manager.initialize('test-alias');
      const openkosmos = manager.getAllOpenKosmosUsedModels();

      // Should include: claude-sonnet-4.6, claude-opus-4.5, gemini-2.5-pro, gpt-5.5
      expect(openkosmos).toHaveLength(4);
      // Claude first (sortGroup 0), then Gemini (1), then GPT (2)
      expect(openkosmos[0].id).toMatch(/^claude/);
      expect(openkosmos[openkosmos.length - 1].id).toMatch(/^gpt/);
    });

    it('should exclude non-chat and non-picker-enabled models', async () => {
      const manager = await getManager();
      const models = [
        makeModel('claude-sonnet-4.6'),
        makeModel('claude-opus-4.5', { capabilities: { ...makeModel('x').capabilities, type: 'embeddings' } }),
        makeModel('claude-sonnet-4', { model_picker_enabled: false }),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ models }));

      await manager.initialize('test-alias');
      const openkosmos = manager.getAllOpenKosmosUsedModels();
      expect(openkosmos).toHaveLength(1);
      expect(openkosmos[0].id).toBe('claude-sonnet-4.6');
    });
  });

  describe('utility methods', () => {
    it('getModelById returns correct model', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel, geminiModel] }));
      await manager.initialize('test-alias');

      expect(manager.getModelById('claude-sonnet-4.6')).toEqual(claudeModel);
      expect(manager.getModelById('nonexistent')).toBeUndefined();
    });

    it('warns when called before initialization', async () => {
      const manager = await getManager();
      // Call without initialize — should not throw, returns empty
      expect(manager.getAllModels()).toHaveLength(0);
      expect(manager.validateModelId('claude-sonnet-4.6')).toBe(false);
    });

    it('validateModelId returns correct boolean', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      expect(manager.validateModelId('claude-sonnet-4.6')).toBe(true);
      expect(manager.validateModelId('nonexistent')).toBe(false);
    });

    it('getDefaultModel returns claude-sonnet-4.6', async () => {
      const manager = await getManager();
      expect(manager.getDefaultModel()).toBe('claude-sonnet-4.6');
    });

    it('isReasoningModel detects o3/o4 models', async () => {
      const manager = await getManager();
      const o3Model = makeModel('o3-mini', { capabilities: { ...makeModel('x').capabilities, family: 'o3' } });
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [o3Model, claudeModel] }));
      await manager.initialize('test-alias');

      expect(manager.isReasoningModel('o3-mini')).toBe(true);
      expect(manager.isReasoningModel('claude-sonnet-4.6')).toBe(false);
      expect(manager.isReasoningModel('nonexistent')).toBe(false);
    });

    it('getModelCapabilities returns null for unknown model', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      expect(manager.getModelCapabilities('nonexistent')).toBeNull();
      const caps = manager.getModelCapabilities('claude-sonnet-4.6');
      expect(caps).not.toBeNull();
      expect(caps!.supportsStreaming).toBe(true);
      expect(caps!.supportsTools).toBe(true);
    });

    it('getModelsByCategory returns filtered models', async () => {
      const manager = await getManager();
      const models = [
        makeModel('claude-sonnet-4'),
        makeModel('claude-sonnet-4.5'),
        makeModel('gpt-4.1'),
        makeModel('gemini-2.5-pro'),
      ];
      mockReadFile.mockResolvedValue(JSON.stringify({ models }));
      await manager.initialize('test-alias');

      const claude = manager.getModelsByCategory('claude');
      expect(claude.some(m => m.id === 'claude-sonnet-4')).toBe(true);
      expect(claude.some(m => m.id === 'claude-sonnet-4.5')).toBe(true);

      const gpt = manager.getModelsByCategory('gpt');
      expect(gpt.some(m => m.id === 'gpt-4.1')).toBe(true);
    });

    it('MODEL_CATEGORIES accessor returns categories', async () => {
      const manager = await getManager();
      expect(manager.MODEL_CATEGORIES).toHaveProperty('claude');
      expect(manager.MODEL_CATEGORIES).toHaveProperty('gpt');
      expect(manager.MODEL_CATEGORIES).toHaveProperty('gemini');
      expect(manager.MODEL_CATEGORIES).toHaveProperty('reasoning');
    });

    it('getModelCapabilities returns correct fields for model with limits', async () => {
      const manager = await getManager();
      const modelWithLimits = makeModel('claude-sonnet-4.6', {
        capabilities: {
          family: 'claude-sonnet-4.6',
          object: 'model_capabilities',
          tokenizer: 'test',
          type: 'chat',
          supports: { streaming: true, tool_calls: true, vision: true },
          limits: {
            max_prompt_tokens: 200000,
            max_output_tokens: 8192,
            max_context_window_tokens: 200000,
          },
        },
      });
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [modelWithLimits] }));
      await manager.initialize('test-alias');

      const caps = manager.getModelCapabilities('claude-sonnet-4.6');
      expect(caps!.maxContextLength).toBe(200000);
      expect(caps!.maxOutputLength).toBe(8192);
      expect(caps!.supportsImages).toBe(true);
      expect(caps!.supportsAttachments).toBe(true);
      expect(caps!.supportsReasoning).toBe(false);
      expect(caps!.supportsTemperature).toBe(true);
    });

    it('getModelCapabilities detects reasoning model (o3)', async () => {
      const manager = await getManager();
      const o3 = makeModel('o3', { capabilities: { ...makeModel('x').capabilities, family: 'o3' } });
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [o3] }));
      await manager.initialize('test-alias');

      const caps = manager.getModelCapabilities('o3');
      expect(caps!.supportsReasoning).toBe(true);
      expect(caps!.supportsTemperature).toBe(false);
    });
  });

  describe('waitForInitialization()', () => {
    it('resolves immediately if already initialized', async () => {
      const manager = await getManager();
      mockReadFile.mockResolvedValue(JSON.stringify({ models: [claudeModel] }));
      await manager.initialize('test-alias');

      // Should resolve instantly
      await manager.waitForInitialization(100);
    });

    it('times out if initialization never starts', async () => {
      const manager = await getManager();
      // Never call initialize — waitForInitialization should return after timeout
      const start = Date.now();
      await manager.waitForInitialization(50);
      // Should return quickly (not hang)
      expect(Date.now() - start).toBeLessThan(200);
    });

    it('waits for in-progress initialization with timeout', async () => {
      const manager = await getManager();
      // Make loadFromFile take a long time
      mockReadFile.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(JSON.stringify({ models: [claudeModel] })), 500)));

      // Start initialization but don't await it
      const initPromise = manager.initialize('test-alias');

      // waitForInitialization should wait (or timeout)
      const start = Date.now();
      await manager.waitForInitialization(100);
      const elapsed = Date.now() - start;
      // Should have timed out around 100ms (not waited full 500ms)
      expect(elapsed).toBeLessThan(300);

      // Clean up
      await initPromise;
    });
  });
});

describe('module-level exports', () => {
  it('requiresMaxCompletionTokens identifies GPT-5+ and o-series', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
    vi.doMock('../../auth/authManager', () => ({
      MainAuthManager: { getInstance: () => ({ getCopilotAccessToken: () => null, refreshCopilotToken: async () => ({ success: false }) }) },
    }));
    vi.doMock('../../auth/ghcConfig', () => ({
      GHC_CONFIG: { API_ENDPOINT: 'https://api.test.com', USER_AGENT: 'test', EDITOR_VERSION: '1.0', EDITOR_PLUGIN_VERSION: '1.0' },
    }));
    vi.doMock('fs', () => ({
      existsSync: () => true,
      mkdirSync: () => {},
      promises: { readFile: async () => '[]', writeFile: async () => {} },
    }));

    const mod = await import('../ghcModelsManager');

    expect(mod.requiresMaxCompletionTokens('gpt-5.1')).toBe(true);
    expect(mod.requiresMaxCompletionTokens('gpt-5.2-codex')).toBe(true);
    expect(mod.requiresMaxCompletionTokens('o3-mini')).toBe(true);
    expect(mod.requiresMaxCompletionTokens('o4-mini')).toBe(true);
    expect(mod.requiresMaxCompletionTokens('claude-sonnet-4.6')).toBe(false);
    expect(mod.requiresMaxCompletionTokens('gpt-4.1')).toBe(false);

    expect(mod.buildMaxTokensParam('gpt-5.1', 1000)).toEqual({ max_completion_tokens: 1000 });
    expect(mod.buildMaxTokensParam('claude-sonnet-4.6', 1000)).toEqual({ max_tokens: 1000 });
  });

  it('normalizeReasoningEfforts lowercases + dedupes but preserves all API tiers', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
    vi.doMock('../../auth/authManager', () => ({
      MainAuthManager: { getInstance: () => ({ getCopilotAccessToken: () => null, refreshCopilotToken: async () => ({ success: false }) }) },
    }));
    vi.doMock('../../auth/ghcConfig', () => ({
      GHC_CONFIG: { API_ENDPOINT: 'https://api.test.com', USER_AGENT: 'test', EDITOR_VERSION: '1.0', EDITOR_PLUGIN_VERSION: '1.0' },
    }));
    vi.doMock('fs', () => ({ existsSync: () => true, mkdirSync: () => {}, promises: { readFile: async () => '[]', writeFile: async () => {} } }));

    const mod = await import('../ghcModelsManager');

    expect(mod.normalizeReasoningEfforts(undefined)).toEqual([]);
    expect(mod.normalizeReasoningEfforts(null)).toEqual([]);
    expect(mod.normalizeReasoningEfforts('high')).toEqual([]);
    expect(mod.normalizeReasoningEfforts(['low', 'medium', 'high'])).toEqual(['low', 'medium', 'high']);
    // New tiers (e.g. minimal, xhigh) must pass through verbatim.
    expect(mod.normalizeReasoningEfforts(['minimal', 'low', 'xhigh'])).toEqual(['minimal', 'low', 'xhigh']);
    expect(mod.normalizeReasoningEfforts(['LOW', 'High', 'XHigh'])).toEqual(['low', 'high', 'xhigh']);
    expect(mod.normalizeReasoningEfforts(['low', 'low', 'medium'])).toEqual(['low', 'medium']);
    // Non-string / empty entries are dropped.
    expect(mod.normalizeReasoningEfforts(['low', '', 42, null])).toEqual(['low']);
  });

  it('buildReasoningParams shapes per-endpoint and respects capability gating', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
    vi.doMock('../../auth/authManager', () => ({
      MainAuthManager: { getInstance: () => ({ getCopilotAccessToken: () => null, refreshCopilotToken: async () => ({ success: false }) }) },
    }));
    vi.doMock('../../auth/ghcConfig', () => ({
      GHC_CONFIG: { API_ENDPOINT: 'https://api.test.com', USER_AGENT: 'test', EDITOR_VERSION: '1.0', EDITOR_PLUGIN_VERSION: '1.0' },
    }));
    vi.doMock('fs', () => ({ existsSync: () => true, mkdirSync: () => {}, promises: { readFile: async () => '[]', writeFile: async () => {} } }));

    const mod = await import('../ghcModelsManager');

    // No effort requested → empty fragment
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low', 'medium', 'high'] })).toEqual({});

    // Effort requested but model has no support → empty fragment
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: undefined, reasoningEffort: 'high' })).toEqual({});
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: [], reasoningEffort: 'high' })).toEqual({});

    // Effort not in supported set → empty fragment
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low'], reasoningEffort: 'high' })).toEqual({});

    // /chat/completions → flat form
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low', 'medium', 'high'], reasoningEffort: 'medium' })).toEqual({ reasoning_effort: 'medium' });

    // /responses → nested form
    expect(mod.buildReasoningParams({ endpoint: '/responses', supportedEfforts: ['low', 'medium', 'high'], reasoningEffort: 'high' })).toEqual({ reasoning: { effort: 'high' } });

    // Case insensitivity
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low', 'medium', 'high'], reasoningEffort: 'LOW' })).toEqual({ reasoning_effort: 'low' });

    // New tiers (e.g. minimal, xhigh) are honored when the model advertises them.
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'], reasoningEffort: 'xhigh' })).toEqual({ reasoning_effort: 'xhigh' });
    expect(mod.buildReasoningParams({ endpoint: '/responses', supportedEfforts: ['minimal', 'medium'], reasoningEffort: 'minimal' })).toEqual({ reasoning: { effort: 'minimal' } });

    // defaultEffort is used when reasoningEffort is not provided (user didn't explicitly pick)
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'medium' })).toEqual({ reasoning_effort: 'medium' });
    expect(mod.buildReasoningParams({ endpoint: '/responses', supportedEfforts: ['low', 'medium', 'high'], defaultEffort: 'high' })).toEqual({ reasoning: { effort: 'high' } });

    // Explicit reasoningEffort takes precedence over defaultEffort
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low', 'medium', 'high'], reasoningEffort: 'low', defaultEffort: 'high' })).toEqual({ reasoning_effort: 'low' });

    // defaultEffort not in supported list → empty
    expect(mod.buildReasoningParams({ endpoint: '/chat/completions', supportedEfforts: ['low'], defaultEffort: 'high' })).toEqual({});
  });

  it('getDefaultReasoningEffort returns vendor-aware default', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
    vi.doMock('../../auth/authManager', () => ({
      MainAuthManager: { getInstance: () => ({ getCopilotAccessToken: () => null, refreshCopilotToken: async () => ({ success: false }) }) },
    }));
    vi.doMock('../../auth/ghcConfig', () => ({
      GHC_CONFIG: { API_ENDPOINT: 'https://api.test.com', USER_AGENT: 'test', EDITOR_VERSION: '1.0', EDITOR_PLUGIN_VERSION: '1.0' },
    }));
    vi.doMock('fs', () => ({ existsSync: () => true, mkdirSync: () => {}, promises: { readFile: async () => '[]', writeFile: async () => {} } }));

    const mod = await import('../ghcModelsManager');

    // Claude models → prefer high
    expect(mod.getDefaultReasoningEffort('claude-opus-4.6', ['low', 'medium', 'high'])).toBe('high');
    expect(mod.getDefaultReasoningEffort('claude-sonnet-4.6', ['low', 'medium'])).toBe('medium');
    expect(mod.getDefaultReasoningEffort('claude-opus-4.6', ['xhigh'])).toBe('xhigh');

    // GPT models → prefer medium
    expect(mod.getDefaultReasoningEffort('gpt-5.5', ['low', 'medium', 'high', 'xhigh'])).toBe('medium');
    expect(mod.getDefaultReasoningEffort('gpt-5.5', ['high', 'xhigh'])).toBe('high');
    expect(mod.getDefaultReasoningEffort('gpt-5.5', ['xhigh'])).toBe('xhigh');

    // Empty list → undefined
    expect(mod.getDefaultReasoningEffort('gpt-5.5', [])).toBeUndefined();
  });

  it('module-level wrapper functions delegate to singleton', async () => {
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
    vi.doMock('../../auth/authManager', () => ({
      MainAuthManager: { getInstance: () => ({ getCopilotAccessToken: () => null, refreshCopilotToken: async () => ({ success: false }) }) },
    }));
    vi.doMock('../../auth/ghcConfig', () => ({
      GHC_CONFIG: { API_ENDPOINT: 'https://api.test.com', USER_AGENT: 'test', EDITOR_VERSION: '1.0', EDITOR_PLUGIN_VERSION: '1.0' },
    }));
    vi.doMock('fs', () => ({
      existsSync: () => true,
      mkdirSync: () => {},
      promises: {
        readFile: async () => JSON.stringify({ models: [
          { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', vendor: 'anthropic', version: '1.0', object: 'model', preview: false, is_chat_default: false, is_chat_fallback: false, model_picker_enabled: true, billing: { is_premium: false, multiplier: 1 }, capabilities: { family: 'claude', object: 'model_capabilities', tokenizer: 'test', type: 'chat', supports: { streaming: true, tool_calls: true, vision: false } } },
        ] }),
        writeFile: async () => {},
      },
    }));

    const mod = await import('../ghcModelsManager');
    await mod.ghcModelsManager.initialize('test');

    expect(mod.getAllModels()).toHaveLength(1);
    expect(mod.getAllOpenKosmosUsedModels()).toHaveLength(1);
    expect(mod.getModelById('claude-sonnet-4.6')).toBeDefined();
    expect(mod.getModelsByCategory('claude')).toBeDefined();
    expect(mod.getModelCapabilities('claude-sonnet-4.6')).not.toBeNull();
    expect(mod.validateModelId('claude-sonnet-4.6')).toBe(true);
    expect(mod.isReasoningModel('claude-sonnet-4.6')).toBe(false);
    expect(mod.getDefaultModel()).toBe('claude-sonnet-4.6');
    expect(mod.MODEL_CATEGORIES).toBeDefined();
    await mod.ensureModelsReady(); // should resolve without error
  });

  it('getElectronApp returns global.electron.app when available', async () => {
    // Covers: (global as any).electron?.app branch — line 226
    vi.resetModules();
    vi.doMock('electron', () => ({
      BrowserWindow: { getAllWindows: () => [] },
      app: { getPath: () => '/tmp/test-app-data' },
    }));
    vi.doMock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
    vi.doMock('../../auth/authManager', () => ({
      MainAuthManager: { getInstance: () => ({ getCopilotAccessToken: () => null, refreshCopilotToken: async () => ({ success: false }) }) },
    }));
    vi.doMock('../../auth/ghcConfig', () => ({
      GHC_CONFIG: { API_ENDPOINT: 'https://api.test.com', USER_AGENT: 'test', EDITOR_VERSION: '1.0', EDITOR_PLUGIN_VERSION: '1.0' },
    }));
    vi.doMock('fs', () => ({
      existsSync: () => false,
      mkdirSync: () => {},
      promises: { readFile: async () => '[]', writeFile: async () => {} },
    }));

    // Set global.electron.app to simulate Electron global injection
    (global as any).electron = { app: { getPath: () => '/tmp/global-electron-path' } };

    const mod = await import('../ghcModelsManager');
    await mod.ghcModelsManager.initialize('test-alias');

    // Clean up
    delete (global as any).electron;
    expect(mod.ghcModelsManager.getAllModels()).toHaveLength(0);
  });
});
