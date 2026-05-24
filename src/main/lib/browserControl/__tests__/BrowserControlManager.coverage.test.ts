// @ts-nocheck
/**
 * Additional coverage tests for BrowserControlManager.
 *
 * Targets uncovered code paths:
 *   - checkNativeServerUpdate (both branches)
 *   - updateNativeServer (success, download failure, throw)
 *   - enable() / disable() platform-guard paths + darwin/win32 execution
 *   - launchBrowserWithSnap() guards
 *   - updateSettings with browser change (selectedBrowser.json + fetch notification)
 *   - sendPhaseChange / sendUpdatePhaseChange side-effects (via updateNativeServer)
 *   - disable() darwin and win32 execution paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock objects (must be declared before vi.mock calls) ──────────────

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
      localVersion: '1.0.0',
      remoteVersion: '1.0.1',
      needsUpdate: true,
    }),
    downloadNativeServer: vi.fn().mockResolvedValue({ success: true }),
    ensureNativeServer: vi.fn().mockResolvedValue({
      success: true,
      nativeServerDir: '/tmp/ns',
      version: '1.0.0',
      downloaded: false,
    }),
  };
  // Must be a real function (not arrow) so `new MockNativeServerFetcher()` works
  function MockNativeServerFetcher(this: any) {
    Object.assign(this, mockFetcher);
  }
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

// ── External dependency mocks ────────────────────────────────────────────────

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
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<BrowserControlDeps> = {}): BrowserControlDeps {
  return {
    getAlias: vi.fn(() => 'alice'),
    getProfileCacheManager: vi.fn().mockResolvedValue({
      getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
      updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
      getMcpServerInfo: vi.fn(() => ({ config: null })),
      addMcpServerConfig: vi.fn().mockResolvedValue(undefined),
    }),
    getMainWindow: vi.fn(() => null),
    getUserDataDir: vi.fn(() => '/tmp/userdata'),
    getAppPath: vi.fn(() => '/tmp/app'),
    getTempDir: vi.fn(() => '/tmp'),
    isFeatureEnabled: vi.fn(() => true),
    ...overrides,
  };
}

/** Stub process.platform and restore after each test. */
function stubPlatform(platform: string) {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => Object.defineProperty(process, 'platform', { value: original, configurable: true });
}

/** Configure mockExec to immediately invoke its callback with given values. */
function mockExecSuccess(stdout = '') {
  mockExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    callback?.(null, stdout, '');
  });
}

function mockExecError(msg = 'exec error') {
  mockExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    callback?.(new Error(msg), '', '');
  });
}

function mockSudoSuccess() {
  mockSudoExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    cb?.(undefined, 'ok', '');
  });
}

function mockSudoError(msg = 'sudo error') {
  mockSudoExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    cb?.(new Error(msg), '', '');
  });
}

// ── checkNativeServerUpdate ───────────────────────────────────────────────────

describe('BrowserControlManager.checkNativeServerUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0.0.0 / needsUpdate=false when local server does not exist', async () => {
    mockFetcher.checkLocalNativeServer.mockReturnValueOnce({ exists: false });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.checkNativeServerUpdate();
    expect(result.success).toBe(true);
    expect((result as any).data).toEqual({
      localVersion: '0.0.0',
      remoteVersion: null,
      needsUpdate: false,
    });
  });

  it('returns version info when local server exists and update is available', async () => {
    mockFetcher.checkLocalNativeServer.mockReturnValueOnce({ exists: true });
    mockFetcher.checkNativeServerNeedsUpdate.mockResolvedValueOnce({
      localVersion: '1.2.0',
      remoteVersion: '1.3.0',
      needsUpdate: true,
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.checkNativeServerUpdate();
    expect(result.success).toBe(true);
    expect((result as any).data).toEqual({
      localVersion: '1.2.0',
      remoteVersion: '1.3.0',
      needsUpdate: true,
    });
  });

  it('returns failure when fetcher throws', async () => {
    mockFetcher.checkLocalNativeServer.mockImplementationOnce(() => {
      throw new Error('fetcher boom');
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.checkNativeServerUpdate();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('fetcher boom');
  });
});

// ── updateNativeServer ────────────────────────────────────────────────────────

describe('BrowserControlManager.updateNativeServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds and sets isUpdating=false when download succeeds', async () => {
    mockFetcher.checkNativeServerNeedsUpdate.mockResolvedValueOnce({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    mockFetcher.downloadNativeServer.mockResolvedValueOnce({ success: true });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(true);
    expect(mgr.getUpdateStatus().data.isUpdating).toBe(false);
    expect(mgr.getUpdateStatus().data.localVersion).toBe('1.0.0');
    expect(mgr.getUpdateStatus().data.remoteVersion).toBe('1.1.0');
  });

  it('returns failure when downloadNativeServer returns success=false', async () => {
    mockFetcher.checkNativeServerNeedsUpdate.mockResolvedValueOnce({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    mockFetcher.downloadNativeServer.mockResolvedValueOnce({
      success: false,
      error: 'network timeout',
    });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('network timeout');
    expect(mgr.getUpdateStatus().data.phase).toBe('error');
    expect(mgr.getUpdateStatus().data.isUpdating).toBe(false);
  });

  it('returns failure when fetcher throws', async () => {
    mockFetcher.checkNativeServerNeedsUpdate.mockRejectedValueOnce(new Error('version check failed'));

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('version check failed');
  });

  it('calls progress and phase callbacks during download', async () => {
    let progressCb: Function | undefined;
    let phaseCb: Function | undefined;
    mockFetcher.checkNativeServerNeedsUpdate.mockResolvedValueOnce({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    mockFetcher.downloadNativeServer.mockImplementationOnce((onProgress: Function, onPhase: Function) => {
      progressCb = onProgress;
      phaseCb = onPhase;
      progressCb?.({ percent: 50, transferred: '5MB', total: '10MB' });
      phaseCb?.('downloading');
      return Promise.resolve({ success: true });
    });

    const mgr = new BrowserControlManager(makeDeps());
    await mgr.updateNativeServer();
    expect(mgr.getUpdateStatus().data.progress).toBe(100); // completed sets 100
  });
});

// ── enable() platform guard ───────────────────────────────────────────────────

describe('BrowserControlManager.enable() — platform guard', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    restore?.();
  });

  it('returns error on linux (unsupported platform)', async () => {
    restore = stubPlatform('linux');
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });
});

// ── disable() platform guard + darwin path ────────────────────────────────────

describe('BrowserControlManager.disable() — platform guard', () => {
  let restore: () => void;

  afterEach(() => restore?.());

  it('returns error on linux (unsupported platform)', async () => {
    restore = stubPlatform('linux');
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });
});

describe('BrowserControlManager.disable() — darwin path', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
  });

  afterEach(() => restore());

  it('succeeds: deletes existing NMH manifests and runs unregisterAllMac', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockSudoSuccess();
    mockHttpServer.stop.mockResolvedValue(undefined);
    mockMcpClientManager.disconnect.mockResolvedValue(undefined);
    mockMcpClientManager.delete.mockResolvedValue(undefined);

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockFs.unlinkSync).toHaveBeenCalled();
    expect(mockSudoExec).toHaveBeenCalled();
    expect(mockHttpServer.stop).toHaveBeenCalled();
  });

  it('succeeds even when NMH manifests do not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockSudoSuccess();
    mockHttpServer.stop.mockResolvedValue(undefined);

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockFs.unlinkSync).not.toHaveBeenCalled();
  });

  it('returns failure when sudoPrompt.exec throws', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockSudoError('permission denied');

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('permission denied');
  });

  it('skips MCP disconnect when alias is null', async () => {
    mockFs.existsSync.mockReturnValue(false);
    mockSudoSuccess();
    mockHttpServer.stop.mockResolvedValue(undefined);

    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockMcpClientManager.disconnect).not.toHaveBeenCalled();
  });
});

// ── disable() — win32 path ────────────────────────────────────────────────────

describe('BrowserControlManager.disable() — win32 path', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('win32');
  });

  afterEach(() => restore());

  it('succeeds: runs unregisterNativeServerAll then unregisterAll', async () => {
    mockExecSuccess();
    mockSudoSuccess();
    mockHttpServer.stop.mockResolvedValue(undefined);
    mockMcpClientManager.disconnect.mockResolvedValue(undefined);
    mockMcpClientManager.delete.mockResolvedValue(undefined);

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockExec).toHaveBeenCalled();
    expect(mockSudoExec).toHaveBeenCalled();
    expect(mockHttpServer.stop).toHaveBeenCalled();
  });

  it('still succeeds when exec errors (native server unregistration is best-effort)', async () => {
    mockExecError('script not found');
    mockSudoSuccess();
    mockHttpServer.stop.mockResolvedValue(undefined);
    mockMcpClientManager.disconnect.mockResolvedValue(undefined);
    mockMcpClientManager.delete.mockResolvedValue(undefined);

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    // exec errors are logged but resolveNative() is still called — should succeed
    expect(result.success).toBe(true);
  });

  it('returns failure when sudoPrompt.exec throws on unregisterAll', async () => {
    mockExecSuccess();
    mockSudoError('access denied');

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('access denied');
  });
});

// ── launchBrowserWithSnap() guards ────────────────────────────────────────────

describe('BrowserControlManager.launchBrowserWithSnap()', () => {
  let restore: () => void;

  afterEach(() => restore?.());

  it('returns error on unsupported platform', async () => {
    restore = stubPlatform('linux');
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });

  it('returns error when alias is null', async () => {
    restore = stubPlatform('darwin');
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('No current user alias');
  });
});

// ── reinstallExtension() platform guard ──────────────────────────────────────

describe('BrowserControlManager.reinstallExtension() — platform guard', () => {
  let restore: () => void;

  afterEach(() => restore?.());

  it('returns error on linux (unsupported platform)', async () => {
    restore = stubPlatform('linux');
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.reinstallExtension();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });
});

// ── updateSettings — browser change triggers file write + fetch ───────────────

describe('BrowserControlManager.updateSettings — with browser change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes selectedBrowser.json when browser is provided', async () => {
    mockFs.existsSync.mockReturnValue(true);
    // Mock global fetch to simulate native server not reachable (abort/error)
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({ browser: 'chrome' });
    expect(result.success).toBe(true);
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('selectedBrowser.json'),
      expect.stringContaining('chrome'),
      // no encoding arg
    );

    global.fetch = originalFetch;
  });

  it('notifies native server when browser is provided and server is reachable', async () => {
    mockFs.existsSync.mockReturnValue(true);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({ browser: 'edge' });
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:12306/control/set-browser',
      expect.objectContaining({ method: 'POST' }),
    );

    global.fetch = originalFetch;
  });

  it('does not write selectedBrowser.json when no browser in settings', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    await mgr.updateSettings({});
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});

// ── getStatus — error path ────────────────────────────────────────────────────

describe('BrowserControlManager.getStatus — error path', () => {
  it('returns failure when checkBrowserControlStatus throws', async () => {
    mockCheckBrowserControlStatus.mockRejectedValueOnce(new Error('status check failed'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.getStatus();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('status check failed');
  });
});

// ── sendPhaseChange side-effects ──────────────────────────────────────────────

describe('BrowserControlManager sendPhaseChange side-effects', () => {
  it('sendToRenderer is called when mainWindow exists', async () => {
    const sendMock = vi.fn();
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    } as any;

    // Use updateNativeServer to trigger sendUpdatePhaseChange('completed')
    mockFetcher.checkNativeServerNeedsUpdate.mockResolvedValueOnce({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    mockFetcher.downloadNativeServer.mockResolvedValueOnce({ success: true });

    const deps = makeDeps({ getMainWindow: vi.fn(() => mainWindow) });
    const mgr = new BrowserControlManager(deps);
    await mgr.updateNativeServer();

    expect(sendMock).toHaveBeenCalledWith(
      'browserControl:updatePhaseChange',
      'completed',
      undefined,
    );
  });
});

// ── confirmation resolver callbacks ──────────────────────────────────────────

describe('BrowserControlManager — all confirmation resolvers with callbacks', () => {
  it('resolveNativeServerDownloadConfirm resolves a pending callback', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const map = (mgr as any).pendingNativeServerDownloadConfirm as Map<string, (v: boolean) => void>;
    let resolved: boolean | undefined;
    map.set('req-ns', (v) => { map.delete('req-ns'); resolved = v; });
    const result = mgr.resolveNativeServerDownloadConfirm('req-ns', false);
    expect(result).toBe(true);
    expect(resolved).toBe(false);
    expect(map.has('req-ns')).toBe(false);
  });

  it('resolveBrowserRestartConfirm resolves a pending callback', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const map = (mgr as any).pendingBrowserRestartConfirm as Map<string, (v: boolean) => void>;
    let resolved: boolean | undefined;
    map.set('req-restart', (v) => { map.delete('req-restart'); resolved = v; });
    const result = mgr.resolveBrowserRestartConfirm('req-restart', true);
    expect(result).toBe(true);
    expect(resolved).toBe(true);
    expect(map.has('req-restart')).toBe(false);
  });
});
