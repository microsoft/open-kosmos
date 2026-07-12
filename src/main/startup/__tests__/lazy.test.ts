import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level singletons that lazy.ts wraps are stubbed out here.
// ---------------------------------------------------------------------------

const mockProfileCacheManager = {
  setMainWindow: vi.fn(),
  getAllChatConfigs: vi.fn(() => []),
};

const mockAppCacheManager = {
  initialize: vi.fn().mockResolvedValue(undefined),
  setMainWindow: vi.fn(),
  getConfig: vi.fn(() => ({})),
  updateConfig: vi.fn().mockResolvedValue(undefined),
};

const mockMainAuthManager = {
  getValidAuthsForSignin: vi.fn(),
  setCurrentAuth: vi.fn(),
  getCurrentAuth: vi.fn(),
  setMainWindow: vi.fn(),
};

const mockTerminalManager = {};

const mockMainTokenMonitor = {
  setMainWindow: vi.fn(),
};

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-app'),
    setPath: vi.fn(),
    getName: vi.fn(() => 'openkosmos-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
    isReady: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: vi.fn(),
}));

vi.mock('../../lib/userDataADO', () => ({
  profileCacheManager: mockProfileCacheManager,
}));

vi.mock('../../lib/userDataADO/appCacheManager', () => ({
  appCacheManager: mockAppCacheManager,
}));

vi.mock('../../lib/auth/authManager', () => ({
  mainAuthManager: mockMainAuthManager,
}));

vi.mock('../../lib/auth/tokenMonitor', () => ({
  MainTokenMonitor: {
    getInstance: vi.fn(() => mockMainTokenMonitor),
  },
}));

vi.mock('../../lib/terminalManager', () => ({
  getTerminalManager: vi.fn(() => mockTerminalManager),
}));

vi.mock('../../lib/unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flushToDisk: vi.fn(),
    handleAppExit: vi.fn(),
  })),
  UnifiedLogger: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('startup/lazy', () => {
  // We need to reset module state between tests because lazy.ts uses
  // module-level let variables as a cache.
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ---- getProfileCacheManager --------------------------------------------

  it('getProfileCacheManager returns the singleton', async () => {
    const { getProfileCacheManager } = await import('../lazy');
    const result = await getProfileCacheManager();
    expect(result).toBe(mockProfileCacheManager);
  });

  it('getProfileCacheManager returns the same instance on second call (cached)', async () => {
    const { getProfileCacheManager } = await import('../lazy');
    const a = await getProfileCacheManager();
    const b = await getProfileCacheManager();
    expect(a).toBe(b);
  });

  // ---- getAppCacheManager ------------------------------------------------

  it('getAppCacheManager initializes and returns singleton', async () => {
    const { getAppCacheManager } = await import('../lazy');
    const result = await getAppCacheManager();
    expect(result).toBe(mockAppCacheManager);
    expect(mockAppCacheManager.initialize).toHaveBeenCalledOnce();
  });

  it('getAppCacheManager does not call initialize twice on second call', async () => {
    const { getAppCacheManager } = await import('../lazy');
    await getAppCacheManager();
    await getAppCacheManager();
    expect(mockAppCacheManager.initialize).toHaveBeenCalledTimes(1);
  });

  // ---- getMainAuthManager ------------------------------------------------

  it('getMainAuthManager returns the singleton', async () => {
    const { getMainAuthManager } = await import('../lazy');
    const result = await getMainAuthManager();
    expect(result).toBe(mockMainAuthManager);
  });

  it('getMainAuthManager returns the same instance on second call', async () => {
    const { getMainAuthManager } = await import('../lazy');
    const a = await getMainAuthManager();
    const b = await getMainAuthManager();
    expect(a).toBe(b);
  });

  // ---- getMainTokenMonitor -----------------------------------------------

  it('getMainTokenMonitor calls getInstance and returns result', async () => {
    const { getMainTokenMonitor } = await import('../lazy');
    const result = await getMainTokenMonitor();
    expect(result).toBe(mockMainTokenMonitor);
  });

  it('getMainTokenMonitor returns cached instance on second call', async () => {
    const { getMainTokenMonitor } = await import('../lazy');
    const a = await getMainTokenMonitor();
    const b = await getMainTokenMonitor();
    expect(a).toBe(b);
  });

  // ---- getTerminalManagerInstance ----------------------------------------

  it('getTerminalManagerInstance returns the terminal manager', async () => {
    const { getTerminalManagerInstance } = await import('../lazy');
    const result = await getTerminalManagerInstance();
    expect(result).toBe(mockTerminalManager);
  });

  it('getTerminalManagerInstance returns cached instance on second call', async () => {
    const { getTerminalManagerInstance } = await import('../lazy');
    const a = await getTerminalManagerInstance();
    const b = await getTerminalManagerInstance();
    expect(a).toBe(b);
  });

  // ---- getExternalAgentService -------------------------------------------

  it('getExternalAgentService dynamically imports and initializes the module', async () => {
    const mockEAS = { stop: vi.fn() };
    vi.doMock('../../lib/externalAgent', () => ({
      initExternalAgentModule: vi.fn().mockResolvedValue(mockEAS),
    }));

    const { getExternalAgentService } = await import('../lazy');
    const result = await getExternalAgentService('testuser');
    expect(result).toBe(mockEAS);
  });

  it('getExternalAgentService returns cached instance on second call', async () => {
    const mockEAS = { stop: vi.fn() };
    vi.doMock('../../lib/externalAgent', () => ({
      initExternalAgentModule: vi.fn().mockResolvedValue(mockEAS),
    }));

    const { getExternalAgentService } = await import('../lazy');
    const a = await getExternalAgentService('user1');
    const b = await getExternalAgentService('user2'); // alias ignored on cache hit
    expect(a).toBe(b);
  });

  // ---- useExternalAgentService -------------------------------------------

  it('useExternalAgentService returns undefined when service is not initialized', async () => {
    const { useExternalAgentService } = await import('../lazy');
    expect(useExternalAgentService(() => 'called')).toBeUndefined();
  });

  it('useExternalAgentService invokes callback when service is initialized', async () => {
    const mockEAS = { stop: vi.fn().mockResolvedValue(undefined) };
    vi.doMock('../../lib/externalAgent', () => ({
      initExternalAgentModule: vi.fn().mockResolvedValue(mockEAS),
    }));

    const { getExternalAgentService, useExternalAgentService } = await import('../lazy');
    await getExternalAgentService('testuser');

    const result = useExternalAgentService((s) => 'result-from-service');
    expect(result).toBe('result-from-service');
  });

  // ---- resetExternalAgentService -----------------------------------------

  it('resetExternalAgentService stops and clears the service', async () => {
    const mockEAS = { stop: vi.fn().mockResolvedValue(undefined) };
    vi.doMock('../../lib/externalAgent', () => ({
      initExternalAgentModule: vi.fn().mockResolvedValue(mockEAS),
    }));

    const { getExternalAgentService, resetExternalAgentService, useExternalAgentService } = await import('../lazy');
    await getExternalAgentService('testuser');
    await resetExternalAgentService();

    expect(mockEAS.stop).toHaveBeenCalledOnce();
    // After reset, useExternalAgentService should return undefined
    expect(useExternalAgentService(() => 'called')).toBeUndefined();
  });

  it('resetExternalAgentService is a no-op when service was never initialized', async () => {
    const { resetExternalAgentService } = await import('../lazy');
    // Should not throw
    await expect(resetExternalAgentService()).resolves.toBeUndefined();
  });

  // ---- getProfileCacheManagerSync ----------------------------------------

  it('getProfileCacheManagerSync returns null before first async call', async () => {
    const { getProfileCacheManagerSync } = await import('../lazy');
    expect(getProfileCacheManagerSync()).toBeNull();
  });

  it('getProfileCacheManagerSync returns manager after getProfileCacheManager is called', async () => {
    const { getProfileCacheManager, getProfileCacheManagerSync } = await import('../lazy');
    await getProfileCacheManager();
    expect(getProfileCacheManagerSync()).toBe(mockProfileCacheManager);
  });

  // ---- getAdvancedLogger -------------------------------------------------

  it('getAdvancedLogger creates and returns a logger', async () => {
    const { createLogger } = await import('../../lib/unifiedLogger');
    const { getAdvancedLogger } = await import('../lazy');
    const logger = getAdvancedLogger();
    expect(logger).toBeDefined();
    // createLogger was called (once)
    expect(createLogger).toHaveBeenCalledOnce();
  });

  it('getAdvancedLogger returns the same logger on repeated calls', async () => {
    const { getAdvancedLogger } = await import('../lazy');
    const a = getAdvancedLogger();
    const b = getAdvancedLogger();
    expect(a).toBe(b);
  });

  // ---- useAdvancedLogger -------------------------------------------------

  it('useAdvancedLogger returns undefined when logger is not initialized', async () => {
    const { useAdvancedLogger } = await import('../lazy');
    expect(useAdvancedLogger(() => 'called')).toBeUndefined();
  });

  it('useAdvancedLogger invokes callback when logger is initialized', async () => {
    const { getAdvancedLogger, useAdvancedLogger } = await import('../lazy');
    const logger = getAdvancedLogger(); // populate cache
    const result = useAdvancedLogger(() => 'logger-result');
    expect(result).toBe('logger-result');
  });
});
