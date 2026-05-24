/**
 * BrowserControlManager coverage2 — targets uncovered paths:
 *   - cdpEnable / cdpDisable / cdpGetStatus
 *   - getSettings / updateSettings
 *   - getStatus
 *   - getInstallStatus / getUpdateStatus
 *   - resolveBrowserInstallConfirm / resolveNativeServerDownloadConfirm / resolveBrowserRestartConfirm
 *   - reinstallExtension (platform guard)
 *   - launchBrowserWithSnap platform guard and alias guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock objects ──────────────────────────────────────────────────────

const {
  mockExec,
  mockSudoExec,
  mockFs,
  mockHttpServer,
  mockMcpClientManager,
  mockCheckBrowserControlStatus,
  mockCheckBrowserInstalled,
  mockFetcher,
  MockNativeServerFetcher,
} = vi.hoisted(() => {
  const mockFetcher = {
    checkLocalNativeServer: vi.fn(() => ({ exists: false, needsDownload: false })),
    checkNativeServerNeedsUpdate: vi.fn().mockResolvedValue({
      localVersion: '1.0.0', remoteVersion: '1.0.1', needsUpdate: true,
    }),
    downloadNativeServer: vi.fn().mockResolvedValue({ success: true }),
    ensureNativeServer: vi.fn().mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false }),
  };
  function MockNativeServerFetcher(this: any) { Object.assign(this, mockFetcher); }
  return {
    mockExec: vi.fn(),
    mockSudoExec: vi.fn(),
    mockFs: {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
      constants: { R_OK: 4 },
    },
    mockHttpServer: { ensureStarted: vi.fn(), stop: vi.fn() },
    mockMcpClientManager: { connect: vi.fn(), disconnect: vi.fn(), delete: vi.fn() },
    mockCheckBrowserControlStatus: vi.fn().mockResolvedValue(true),
    mockCheckBrowserInstalled: vi.fn().mockResolvedValue(true),
    mockFetcher,
    MockNativeServerFetcher,
  };
});

// ── External dependency mocks ─────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: {},
  screen: {
    getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
}));

vi.mock('child_process', () => ({ exec: mockExec }));
vi.mock('sudo-prompt', () => ({ default: { exec: mockSudoExec } }));
vi.mock('fs', () => ({ ...mockFs, default: mockFs }));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    default: actual,
    homedir: vi.fn(() => '/home/testuser'),
    userInfo: vi.fn(() => ({ username: 'testuser' })),
  };
});

vi.mock('../browserControlHttpServer', () => ({
  browserControlHttpServer: mockHttpServer,
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: mockMcpClientManager,
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../browserControlStatus', () => ({
  checkBrowserControlStatus: mockCheckBrowserControlStatus,
  checkBrowserInstalled: mockCheckBrowserInstalled,
}));

vi.mock('../nativeServerFetcher', () => ({
  NativeServerFetcher: MockNativeServerFetcher,
}));

// ── SUT import ────────────────────────────────────────────────────────────────

import { BrowserControlManager, BrowserControlDeps } from '../BrowserControlManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePcManager(overrides: Record<string, any> = {}) {
  return {
    getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
    updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
    getMcpServerInfo: vi.fn(() => ({ config: null })),
    addMcpServerConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BrowserControlDeps> = {}): BrowserControlDeps {
  return {
    getAlias: vi.fn(() => 'alice'),
    getProfileCacheManager: vi.fn().mockResolvedValue(makePcManager()),
    getMainWindow: vi.fn(() => null),
    getUserDataDir: vi.fn(() => '/tmp/userdata'),
    getAppPath: vi.fn(() => '/tmp/app'),
    getTempDir: vi.fn(() => '/tmp'),
    isFeatureEnabled: vi.fn(() => true),
    ...overrides,
  };
}

function stubPlatform(platform: string) {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => Object.defineProperty(process, 'platform', { value: original, configurable: true });
}

// ── getInstallStatus / getUpdateStatus ────────────────────────────────────────

describe('BrowserControlManager.getInstallStatus', () => {
  it('returns initial install state', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = mgr.getInstallStatus();
    expect(result.success).toBe(true);
    expect(result.data.isInstalling).toBe(false);
    expect(result.data.phase).toBe('idle');
    expect(result.data.progress).toBe(0);
    expect(result.data.error).toBe('');
  });
});

describe('BrowserControlManager.getUpdateStatus', () => {
  it('returns initial update state', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = mgr.getUpdateStatus();
    expect(result.success).toBe(true);
    expect(result.data.isUpdating).toBe(false);
    expect(result.data.phase).toBe('idle');
    expect(result.data.progress).toBe(0);
    expect(result.data.localVersion).toBe('');
    expect(result.data.remoteVersion).toBe('');
  });
});

// ── getSettings ───────────────────────────────────────────────────────────────

describe('BrowserControlManager.getSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns settings for current alias', async () => {
    const pcm = makePcManager({ getBrowserControlSettings: vi.fn(() => ({ browser: 'chrome' })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getSettings();
    expect(result.success).toBe(true);
    expect((result as any).data.browser).toBe('chrome');
  });

  it('returns error if no alias', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getSettings();
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/No current user alias/);
  });

  it('returns error when pcManager throws', async () => {
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockRejectedValue(new Error('DB error')) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getSettings();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('DB error');
  });
});

// ── updateSettings ────────────────────────────────────────────────────────────

describe('BrowserControlManager.updateSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    (global.fetch as any) = undefined;
  });

  it('returns error if no alias', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.updateSettings({ browser: 'edge' });
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/No current user alias/);
  });

  it('updates settings without browser change', async () => {
    const pcm = makePcManager({ updateBrowserControlSettings: vi.fn().mockResolvedValue(true) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.updateSettings({});
    expect(result.success).toBe(true);
  });

  it('updates settings with browser change and writes selectedBrowser.json', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const pcm = makePcManager({ updateBrowserControlSettings: vi.fn().mockResolvedValue(true) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.updateSettings({ browser: 'chrome' });
    expect(result.success).toBe(true);
    expect(mockFs.writeFileSync).toHaveBeenCalled();
  });

  it('returns failure when updateBrowserControlSettings returns false', async () => {
    const pcm = makePcManager({ updateBrowserControlSettings: vi.fn().mockResolvedValue(false) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.updateSettings({});
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/Failed to update/);
  });

  it('creates directory if it does not exist when writing selectedBrowser.json', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const pcm = makePcManager({ updateBrowserControlSettings: vi.fn().mockResolvedValue(true) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    await mgr.updateSettings({ browser: 'edge' });
    expect(mockFs.mkdirSync).toHaveBeenCalled();
  });
});

// ── getStatus ─────────────────────────────────────────────────────────────────

describe('BrowserControlManager.getStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns status when alias is set', async () => {
    mockCheckBrowserControlStatus.mockResolvedValueOnce(true);
    const pcm = makePcManager({ getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(true);
  });

  it('uses default edge browser when alias is null', async () => {
    mockCheckBrowserControlStatus.mockResolvedValueOnce(false);
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(false);
  });

  it('returns error when checkBrowserControlStatus throws', async () => {
    mockCheckBrowserControlStatus.mockRejectedValueOnce(new Error('Status check failed'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.getStatus();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('Status check failed');
  });
});

// ── resolve* methods ──────────────────────────────────────────────────────────

describe('BrowserControlManager resolve confirm methods', () => {
  it('resolveBrowserInstallConfirm returns false for unknown requestId', () => {
    const mgr = new BrowserControlManager(makeDeps());
    expect(mgr.resolveBrowserInstallConfirm('unknown-id', true)).toBe(false);
  });

  it('resolveNativeServerDownloadConfirm returns false for unknown requestId', () => {
    const mgr = new BrowserControlManager(makeDeps());
    expect(mgr.resolveNativeServerDownloadConfirm('unknown-id', true)).toBe(false);
  });

  it('resolveBrowserRestartConfirm returns false for unknown requestId', () => {
    const mgr = new BrowserControlManager(makeDeps());
    expect(mgr.resolveBrowserRestartConfirm('unknown-id', true)).toBe(false);
  });
});

// ── cdpEnable ─────────────────────────────────────────────────────────────────

describe('BrowserControlManager.cdpEnable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds MCP config and connects when config does not exist', async () => {
    const pcm = makePcManager({ getMcpServerInfo: vi.fn(() => ({ config: null })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(true);
    expect(pcm.addMcpServerConfig).toHaveBeenCalled();
    expect(mockMcpClientManager.connect).toHaveBeenCalledWith('chrome-devtools-mcp');
  });

  it('skips adding config if already exists', async () => {
    const pcm = makePcManager({ getMcpServerInfo: vi.fn(() => ({ config: { name: 'chrome-devtools-mcp' } })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(true);
    expect(pcm.addMcpServerConfig).not.toHaveBeenCalled();
    expect(mockMcpClientManager.connect).toHaveBeenCalledWith('chrome-devtools-mcp');
  });

  it('returns error if alias is null', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/Not logged in/);
  });

  it('returns error if addMcpServerConfig throws', async () => {
    const pcm = makePcManager({
      getMcpServerInfo: vi.fn(() => ({ config: null })),
      addMcpServerConfig: vi.fn().mockRejectedValue(new Error('Config error')),
    });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('Config error');
  });

  it('does not fail when connect throws (swallowed)', async () => {
    mockMcpClientManager.connect.mockRejectedValueOnce(new Error('connect failed'));
    const pcm = makePcManager({ getMcpServerInfo: vi.fn(() => ({ config: { name: 'chrome-devtools-mcp' } })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(true);
  });
});

// ── cdpDisable ────────────────────────────────────────────────────────────────

describe('BrowserControlManager.cdpDisable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('disconnects and deletes the CDP MCP server', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(true);
    expect(mockMcpClientManager.disconnect).toHaveBeenCalledWith('chrome-devtools-mcp');
    expect(mockMcpClientManager.delete).toHaveBeenCalledWith('chrome-devtools-mcp');
  });

  it('returns error if alias is null', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/Not logged in/);
  });

  it('does not fail if disconnect throws (swallowed)', async () => {
    mockMcpClientManager.disconnect.mockRejectedValueOnce(new Error('already disconnected'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(true);
  });

  it('does not fail if delete throws (swallowed)', async () => {
    mockMcpClientManager.delete.mockRejectedValueOnce(new Error('already deleted'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(true);
  });
});

// ── cdpGetStatus ──────────────────────────────────────────────────────────────

describe('BrowserControlManager.cdpGetStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns enabled=true when server config exists', async () => {
    const pcm = makePcManager({ getMcpServerInfo: vi.fn(() => ({ config: { name: 'chrome-devtools-mcp' } })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(true);
  });

  it('returns enabled=false when server config does not exist', async () => {
    const pcm = makePcManager({ getMcpServerInfo: vi.fn(() => ({ config: null })) });
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockResolvedValue(pcm) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(false);
  });

  it('returns enabled=false when alias is null', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(false);
  });

  it('returns error when pcManager throws', async () => {
    const deps = makeDeps({ getProfileCacheManager: vi.fn().mockRejectedValue(new Error('DB error')) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('DB error');
  });
});

// ── reinstallExtension - feature flag / platform guard ────────────────────────

describe('BrowserControlManager.reinstallExtension', () => {
  it('returns error if feature is disabled', async () => {
    const deps = makeDeps({ isFeatureEnabled: vi.fn(() => false) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.reinstallExtension();
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/not enabled/);
  });

  it('returns error on unsupported platform', async () => {
    const restore = stubPlatform('linux');
    try {
      const mgr = new BrowserControlManager(makeDeps());
      const result = await mgr.reinstallExtension();
      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/only supported on Windows and macOS/);
    } finally {
      restore();
    }
  });
});

// ── launchBrowserWithSnap guards ──────────────────────────────────────────────

describe('BrowserControlManager.launchBrowserWithSnap', () => {
  it('returns error on unsupported platform', async () => {
    const restore = stubPlatform('linux');
    try {
      const mgr = new BrowserControlManager(makeDeps());
      const result = await mgr.launchBrowserWithSnap();
      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/only supported on Windows and macOS/);
    } finally {
      restore();
    }
  });

  it('returns error if alias is null on darwin', async () => {
    const restore = stubPlatform('darwin');
    try {
      const deps = makeDeps({ getAlias: vi.fn(() => null) });
      const mgr = new BrowserControlManager(deps);
      const result = await mgr.launchBrowserWithSnap();
      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/No current user alias/);
    } finally {
      restore();
    }
  });
});

// ── enable - feature flag / platform guard ────────────────────────────────────

describe('BrowserControlManager.enable', () => {
  it('returns error if feature is disabled', async () => {
    const deps = makeDeps({ isFeatureEnabled: vi.fn(() => false) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/not enabled/);
  });

  it('returns error on unsupported platform', async () => {
    const restore = stubPlatform('linux');
    try {
      const mgr = new BrowserControlManager(makeDeps());
      const result = await mgr.enable();
      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/only supported on Windows and macOS/);
    } finally {
      restore();
    }
  });
});

// ── disable - feature flag / platform guard ───────────────────────────────────

describe('BrowserControlManager.disable', () => {
  it('returns error if feature is disabled', async () => {
    const deps = makeDeps({ isFeatureEnabled: vi.fn(() => false) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toMatch(/not enabled/);
  });

  it('returns error on unsupported platform', async () => {
    const restore = stubPlatform('linux');
    try {
      const mgr = new BrowserControlManager(makeDeps());
      const result = await mgr.disable();
      expect(result.success).toBe(false);
      expect((result as any).error).toMatch(/only supported on Windows and macOS/);
    } finally {
      restore();
    }
  });
});
