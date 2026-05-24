// @ts-nocheck
/**
 * Supplementary unit tests for BrowserControlManager.
 *
 * Covers branches NOT exercised by BrowserControlManager.test.ts:
 *  - updateSettings browser-set branch (fs write, mkdir, fetch notify)
 *  - checkNativeServerUpdate: local-exists path + error path
 *  - updateNativeServer: success / download-failure / exception paths
 *  - sendPhaseChange state mutations (error, completed)
 *  - enable() / disable() / launchBrowserWithSnap() on unsupported platform
 *  - disable() on darwin (manifest delete, sudo unregister, MCP cleanup)
 *  - disable() on win32 (powershell unregister, sudo unregister)
 *  - launchBrowserWithSnap() no-alias guard
 *  - launchBrowserWithSnap() darwin + win32 paths
 *  - getStatus() error path
 *  - cdpGetStatus() / cdpEnable() error paths
 *  - confirmation resolver callbacks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mock variables ───────────────────────────────────────────────────

const mockExec = vi.hoisted(() => vi.fn());
const mockSudoExec = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => false));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());
const mockEnsureStarted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpConnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpDisconnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpDelete = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCheckBrowserControlStatus = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockCheckBrowserInstalled = vi.hoisted(() => vi.fn().mockResolvedValue(true));

// NativeServerFetcher instance methods — mutated per-test via reassignment below
const nsFetcher = vi.hoisted(() => ({
  checkLocalNativeServer: vi.fn(() => ({ exists: true, needsDownload: false })),
  checkNativeServerNeedsUpdate: vi.fn().mockResolvedValue({
    localVersion: '1.0.0',
    remoteVersion: '1.1.0',
    needsUpdate: true,
  }),
  downloadNativeServer: vi.fn().mockResolvedValue({ success: true }),
  ensureNativeServer: vi.fn().mockResolvedValue({
    success: true,
    nativeServerDir: '/tmp/ns',
    version: '1.0.0',
    downloaded: false,
  }),
}));

// ── module mocks ─────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: {},
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));

vi.mock('child_process', () => ({ exec: mockExec }));

vi.mock('sudo-prompt', () => ({ default: { exec: mockSudoExec } }));

vi.mock('fs', () => ({
  default: {},
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
  constants: { R_OK: 4 },
}));

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

vi.mock('../browserControlHttpServer', () => ({
  browserControlHttpServer: { ensureStarted: mockEnsureStarted, stop: mockStop },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    connect: mockMcpConnect,
    disconnect: mockMcpDisconnect,
    delete: mockMcpDelete,
  },
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

// NativeServerFetcher: use a proper class constructor so `new NativeServerFetcher()` works
vi.mock('../nativeServerFetcher', () => ({
  NativeServerFetcher: class {
    checkLocalNativeServer(...args: any[]) { return nsFetcher.checkLocalNativeServer(...args); }
    checkNativeServerNeedsUpdate(...args: any[]) { return nsFetcher.checkNativeServerNeedsUpdate(...args); }
    downloadNativeServer(...args: any[]) { return nsFetcher.downloadNativeServer(...args); }
    ensureNativeServer(...args: any[]) { return nsFetcher.ensureNativeServer(...args); }
  },
}));

// ── SUT ──────────────────────────────────────────────────────────────────────

import { BrowserControlManager, BrowserControlDeps } from '../BrowserControlManager';

// ── helpers ──────────────────────────────────────────────────────────────────

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

/** Make exec immediately call the callback without error */
function execSucceeds() {
  mockExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    callback?.(null, '', '');
  });
}

/** Make sudoPrompt.exec immediately call the callback without error */
function sudoSucceeds() {
  mockSudoExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
    cb(undefined, '', '');
  });
}

/** Make sudoPrompt.exec immediately call the callback with an error */
function sudoFails(msg = 'sudo error') {
  mockSudoExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
    cb(new Error(msg), '', '');
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BrowserControlManager.updateSettings — browser-set branch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('writes selectedBrowser.json and notifies native server when browser is set', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({ browser: 'chrome' });
    expect(result.success).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:12306/control/set-browser',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('creates the directory when it does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({ browser: 'edge' });
    expect(result.success).toBe(true);
    expect(mockMkdirSync).toHaveBeenCalled();
  });

  it('still returns success when writeFileSync throws (warn-and-continue)', async () => {
    mockWriteFileSync.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({ browser: 'edge' });
    expect(result.success).toBe(true);
  });

  it('still returns success when fetch to native server throws (server not running)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({ browser: 'edge' });
    expect(result.success).toBe(true);
  });

  it('skips fs write and fetch when browser is not in settings', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateSettings({});
    expect(result.success).toBe(true);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when pcManager.updateBrowserControlSettings throws', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
        updateBrowserControlSettings: vi.fn().mockRejectedValue(new Error('write failed')),
        getMcpServerInfo: vi.fn(() => ({ config: null })),
        addMcpServerConfig: vi.fn(),
      }),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.updateSettings({ browser: 'edge' });
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('write failed');
  });
});

describe('BrowserControlManager.checkNativeServerUpdate', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns version info when local native server exists', async () => {
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.checkNativeServerNeedsUpdate.mockResolvedValue({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.checkNativeServerUpdate();
    expect(result.success).toBe(true);
    const data = (result as any).data;
    expect(data.localVersion).toBe('1.0.0');
    expect(data.remoteVersion).toBe('1.1.0');
    expect(data.needsUpdate).toBe(true);
  });

  it('returns 0.0.0 with no remote when local server does not exist', async () => {
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: false, needsDownload: true });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.checkNativeServerUpdate();
    expect(result.success).toBe(true);
    const data = (result as any).data;
    expect(data.localVersion).toBe('0.0.0');
    expect(data.remoteVersion).toBeNull();
    expect(data.needsUpdate).toBe(false);
  });

  it('returns error when checkNativeServerNeedsUpdate throws', async () => {
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.checkNativeServerNeedsUpdate.mockRejectedValueOnce(new Error('version check error'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.checkNativeServerUpdate();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('version check error');
  });
});

describe('BrowserControlManager.updateNativeServer', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns success when download succeeds', async () => {
    nsFetcher.checkNativeServerNeedsUpdate.mockResolvedValue({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    nsFetcher.downloadNativeServer.mockResolvedValue({ success: true });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(true);
    expect(mgr.getUpdateStatus().data.phase).toBe('completed');
  });

  it('returns failure when download fails with error string', async () => {
    nsFetcher.checkNativeServerNeedsUpdate.mockResolvedValue({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    nsFetcher.downloadNativeServer.mockResolvedValue({ success: false, error: 'network timeout' });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('network timeout');
    expect(mgr.getUpdateStatus().data.phase).toBe('error');
    expect(mgr.getUpdateStatus().data.isUpdating).toBe(false);
  });

  it('returns "Download failed" when download fails without error message', async () => {
    nsFetcher.checkNativeServerNeedsUpdate.mockResolvedValue({
      localVersion: '1.0.0',
      remoteVersion: '1.1.0',
      needsUpdate: true,
    });
    nsFetcher.downloadNativeServer.mockResolvedValue({ success: false });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('Download failed');
  });

  it('returns failure when checkNativeServerNeedsUpdate throws', async () => {
    nsFetcher.checkNativeServerNeedsUpdate.mockRejectedValueOnce(new Error('version check error'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.updateNativeServer();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('version check error');
    expect(mgr.getUpdateStatus().data.phase).toBe('error');
  });

  it('updates localVersion and remoteVersion in state from version check', async () => {
    nsFetcher.checkNativeServerNeedsUpdate.mockResolvedValue({
      localVersion: '2.0.0',
      remoteVersion: '3.0.0',
      needsUpdate: true,
    });
    nsFetcher.downloadNativeServer.mockResolvedValue({ success: true });
    const mgr = new BrowserControlManager(makeDeps());
    await mgr.updateNativeServer();
    const state = mgr.getUpdateStatus().data;
    expect(state.localVersion).toBe('2.0.0');
    expect(state.remoteVersion).toBe('3.0.0');
  });

  it('falls back to localVersion when remoteVersion is null', async () => {
    nsFetcher.checkNativeServerNeedsUpdate.mockResolvedValue({
      localVersion: '2.5.0',
      remoteVersion: null,
      needsUpdate: false,
    });
    nsFetcher.downloadNativeServer.mockResolvedValue({ success: true });
    const mgr = new BrowserControlManager(makeDeps());
    await mgr.updateNativeServer();
    const state = mgr.getUpdateStatus().data;
    expect(state.remoteVersion).toBe('2.5.0'); // falls back to localVersion
  });
});

describe('BrowserControlManager — sendPhaseChange state mutations', () => {
  it('sets isInstalling=false and error message when phase is "error"', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const mgr = new BrowserControlManager(makeDeps());
    await mgr.enable(); // linux triggers sendPhaseChange('error')
    const state = mgr.getInstallStatus().data;
    expect(state.isInstalling).toBe(false);
    expect(state.phase).toBe('error');
    expect(state.error).toContain('only supported on Windows and macOS');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});

describe('BrowserControlManager.enable — unsupported platform', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error on linux platform', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.enable();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });
});

describe('BrowserControlManager.disable — unsupported platform', () => {
  it('returns error on linux platform', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });
});

describe('BrowserControlManager.disable — darwin platform', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    execSucceeds();
    sudoSucceeds();
    mockExistsSync.mockReturnValue(true);
    mockStop.mockResolvedValue(undefined);
    mockMcpDisconnect.mockResolvedValue(undefined);
    mockMcpDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.clearAllMocks();
  });

  it('removes NativeMessagingHost manifests and runs unregister script', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
    expect(mockSudoExec).toHaveBeenCalledOnce();
    expect(mockStop).toHaveBeenCalledOnce();
  });

  it('skips unlinkSync when manifest file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('returns error when sudoPrompt.exec fails during unregister', async () => {
    sudoFails('permission denied');
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('permission denied');
  });

  it('disconnects and deletes MCP server when alias exists', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    await mgr.disable();
    expect(mockMcpDisconnect).toHaveBeenCalledWith('openkosmos-chrome-extension');
    expect(mockMcpDelete).toHaveBeenCalledWith('openkosmos-chrome-extension');
  });

  it('skips MCP cleanup when alias is null', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    await mgr.disable();
    expect(mockMcpDisconnect).not.toHaveBeenCalled();
  });

  it('still returns success when MCP disconnect/delete throw', async () => {
    mockMcpDisconnect.mockRejectedValueOnce(new Error('already off'));
    mockMcpDelete.mockRejectedValueOnce(new Error('already gone'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
  });
});

describe('BrowserControlManager.disable — win32 platform', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    execSucceeds();
    sudoSucceeds();
    mockStop.mockResolvedValue(undefined);
    mockMcpDisconnect.mockResolvedValue(undefined);
    mockMcpDelete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.clearAllMocks();
  });

  it('runs powershell unregister and sudo unregister scripts', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(true);
    expect(mockExec).toHaveBeenCalled();
    expect(mockSudoExec).toHaveBeenCalledOnce();
  });

  it('returns error when sudoPrompt.exec rejects', async () => {
    sudoFails('access denied');
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('access denied');
  });
});

describe('BrowserControlManager.launchBrowserWithSnap — platform/alias guards', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error on unsupported platform (linux)', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('only supported on Windows and macOS');
  });

  it('returns error when no alias', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.launchBrowserWithSnap();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('No current user alias');
  });
});

describe('BrowserControlManager.launchBrowserWithSnap — darwin', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    execSucceeds();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns success when browser is already running (pgrep succeeds)', async () => {
    // pgrep exits with success = browser is running
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      callback?.(null, '1234', '');
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(true);
  });

  it('launches browser when it is not running (pgrep fails)', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(true);
    const cmds = mockExec.mock.calls.map((c: any[]) => c[0] as string);
    expect(cmds.some((c) => c.includes('open -a'))).toBe(true);
  });

  it('returns success even when native server poll times out', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      callback?.(null, '', '');
    });
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const realNow = Date.now.bind(Date);
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      if (callCount === 1) return 0;
      return 31000; // immediately exceeds maxWaitTime of 30000 ms
    });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('BrowserControlManager.launchBrowserWithSnap — win32', () => {
  let originalPlatform: NodeJS.Platform;

  beforeEach(() => {
    originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    execSucceeds();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('returns success when browser is already running', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (cmd.includes('Get-Process')) {
        callback?.(null, 'True\n', '');
      } else {
        callback?.(null, '', '');
      }
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(true);
  });

  it('applies edge launch hack (kill + relaunch) when browser is edge and skipEdgeHack is false', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (cmd.includes('Get-Process')) {
        callback?.(null, 'False\n', '');
      } else {
        callback?.(null, '', '');
      }
    });
    const mgr = new BrowserControlManager(makeDeps()); // default browser is 'edge'
    const result = await mgr.launchBrowserWithSnap(); // skipEdgeHack defaults to false
    expect(result.success).toBe(true);
    const cmds = mockExec.mock.calls.map((c: any[]) => c[0] as string);
    expect(cmds.some((c) => c.includes('taskkill'))).toBe(true);
  });

  it('skips edge hack when skipEdgeHack is true', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (cmd.includes('Get-Process')) {
        callback?.(null, 'False\n', '');
      } else {
        callback?.(null, '', '');
      }
    });
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.launchBrowserWithSnap({ skipEdgeHack: true });
    expect(result.success).toBe(true);
    const cmds = mockExec.mock.calls.map((c: any[]) => c[0] as string);
    expect(cmds.filter((c) => c.includes('taskkill'))).toHaveLength(0);
  });

  it('launches non-edge browser without hack', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (cmd.includes('Get-Process')) {
        callback?.(null, 'False\n', '');
      } else {
        callback?.(null, '', '');
      }
    });
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'chrome' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
        getMcpServerInfo: vi.fn(() => ({ config: null })),
        addMcpServerConfig: vi.fn(),
      }),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.launchBrowserWithSnap();
    expect(result.success).toBe(true);
  });
});

describe('BrowserControlManager.getStatus — error paths', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error when checkBrowserControlStatus throws', async () => {
    mockCheckBrowserControlStatus.mockRejectedValueOnce(new Error('status check failed'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.getStatus();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('status check failed');
  });

  it('returns error when getProfileCacheManager throws', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockRejectedValue(new Error('db offline')),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getStatus();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('db offline');
  });
});

describe('BrowserControlManager.cdpGetStatus — error path', () => {
  it('returns error when getProfileCacheManager throws', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockRejectedValue(new Error('cdp db error')),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('cdp db error');
  });
});

describe('BrowserControlManager.cdpEnable — additional paths', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns error when getProfileCacheManager throws', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockRejectedValue(new Error('cdp enable error')),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('cdp enable error');
  });

  it('still returns success when mcpClientManager.connect throws (try-catch in source)', async () => {
    mockMcpConnect.mockRejectedValueOnce(new Error('connect failed'));
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(true);
  });
});

describe('BrowserControlManager — confirmation resolver callbacks', () => {
  it('resolveNativeServerDownloadConfirm resolves a pending callback with false', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const map = (mgr as any).pendingNativeServerDownloadConfirm as Map<string, (v: boolean) => void>;
    let resolved: boolean | undefined;
    map.set('req-ns', (v) => { map.delete('req-ns'); resolved = v; });
    const result = mgr.resolveNativeServerDownloadConfirm('req-ns', false);
    expect(result).toBe(true);
    expect(resolved).toBe(false);
    expect(map.has('req-ns')).toBe(false);
  });

  it('resolveBrowserRestartConfirm resolves a pending callback with true', () => {
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

describe('BrowserControlManager.getSettings — non-Error exception', () => {
  it('handles non-Error thrown value with "Unknown error"', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockRejectedValue('string-error'),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getSettings();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('Unknown error');
  });
});

describe('BrowserControlManager — sendToRenderer with no main window', () => {
  it('does not throw when mainWindow is null', () => {
    const deps = makeDeps({ getMainWindow: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    expect(() => {
      (mgr as any).sendPhaseChange('completed');
    }).not.toThrow();
  });

  it('sets progress=100 and isInstalling=false when phase is "completed"', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendPhaseChange('completed');
    const state = mgr.getInstallStatus().data;
    expect(state.phase).toBe('completed');
    expect(state.isInstalling).toBe(false);
    expect(state.progress).toBe(100);
  });

  it('sets isUpdating=false and progress=100 when update phase is "completed"', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendUpdatePhaseChange('completed');
    const state = mgr.getUpdateStatus().data;
    expect(state.phase).toBe('completed');
    expect(state.isUpdating).toBe(false);
    expect(state.progress).toBe(100);
  });

  it('sets update error and isUpdating=false when update phase is "error"', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendUpdatePhaseChange('error', 'update broke');
    const state = mgr.getUpdateStatus().data;
    expect(state.phase).toBe('error');
    expect(state.isUpdating).toBe(false);
    expect(state.error).toBe('update broke');
  });

  it('uses "Unknown error" as default error message in sendPhaseChange', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendPhaseChange('error'); // no message arg
    const state = mgr.getInstallStatus().data;
    expect(state.error).toBe('Unknown error');
  });

  it('uses "Unknown error" as default in sendUpdatePhaseChange', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendUpdatePhaseChange('error'); // no message arg
    const state = mgr.getUpdateStatus().data;
    expect(state.error).toBe('Unknown error');
  });
});

describe('BrowserControlManager — sendDownloadProgress', () => {
  it('updates installState.progress', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendDownloadProgress({ percent: 55, transferred: '55MB', total: '100MB' });
    expect(mgr.getInstallStatus().data.progress).toBe(55);
  });

  it('updates updateState.progress', () => {
    const mgr = new BrowserControlManager(makeDeps());
    (mgr as any).sendUpdateDownloadProgress({ percent: 77, transferred: '77MB', total: '100MB' });
    expect(mgr.getUpdateStatus().data.progress).toBe(77);
  });
});
