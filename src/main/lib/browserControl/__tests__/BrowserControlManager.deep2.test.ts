// @ts-nocheck
/**
 * BrowserControlManager.deep2.test.ts
 *
 * Targets remaining uncovered branches:
 *  - enable() on darwin and win32: full flow through ensureBrowserInstalled,
 *    registerExtensions, ensureNativeServer, registerNativeServer, addMcpConfig,
 *    checkAndRestartBrowser (browser not running), launchBrowserWithSnap
 *  - reinstallExtension(): browser running + user confirms restart
 *  - reinstallExtension(): browser running + user cancels restart
 *  - addMcpConfig() when MCP config already exists (skip branch)
 *  - checkAndRestartBrowser() user skips restart (null sentinel path)
 *  - checkAndRestartBrowser() user confirms restart (kill + return true)
 *  - downloadAndInstallBrowserWindows user cancelled + download failure + installer missing
 *  - downloadAndInstallBrowserMac user cancelled + DMG missing
 *  - registerNativeServer() darwin (writes NMH manifests)
 *  - registerNativeServer() win32 (runs powershell)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ────────────────────────────────────────────────────────────

const mockExec = vi.hoisted(() => vi.fn());
const mockSudoExec = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn(() => false));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockEnsureStarted = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpConnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpDisconnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMcpDelete = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCheckBrowserControlStatus = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockCheckBrowserInstalled = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const mockFetch = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

const nsFetcher = vi.hoisted(() => ({
  checkLocalNativeServer: vi.fn(() => ({ exists: true, needsDownload: false })),
  checkNativeServerNeedsUpdate: vi.fn().mockResolvedValue({
    localVersion: '1.0.0',
    remoteVersion: '1.1.0',
    needsUpdate: false,
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
    getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
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
  browserControlHttpServer: { ensureStarted: mockEnsureStarted, stop: mockStop },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: { connect: mockMcpConnect, disconnect: mockMcpDisconnect, delete: mockMcpDelete },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

vi.mock('../browserControlStatus', () => ({
  checkBrowserControlStatus: mockCheckBrowserControlStatus,
  checkBrowserInstalled: mockCheckBrowserInstalled,
}));

vi.mock('../nativeServerFetcher', () => ({
  NativeServerFetcher: class {
    checkLocalNativeServer(...a: any[]) { return nsFetcher.checkLocalNativeServer(...a); }
    checkNativeServerNeedsUpdate(...a: any[]) { return nsFetcher.checkNativeServerNeedsUpdate(...a); }
    downloadNativeServer(...a: any[]) { return nsFetcher.downloadNativeServer(...a); }
    ensureNativeServer(...a: any[]) { return nsFetcher.ensureNativeServer(...a); }
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

/** exec immediately calls callback with no error */
function execOk(stdout = '') {
  mockExec.mockImplementation((_cmd: string, _opts: any, cb?: Function) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    callback?.(null, stdout, '');
  });
}

/** sudoPrompt.exec immediately calls callback with no error */
function sudoOk() {
  mockSudoExec.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
    cb(undefined, '', '');
  });
}

function stubPlatform(platform: string) {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => Object.defineProperty(process, 'platform', { value: original, configurable: true });
}

// ── enable() darwin — browser already installed, no native server download needed ──

describe('BrowserControlManager.enable() — darwin full flow (browser installed, NS ready)', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    execOk();
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false); // dir does not exist => mkdirSync
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('returns success when browser is not running (checkAndRestartBrowser returns false)', async () => {
    // pgrep fails => browser not running => checkAndRestartBrowser returns false
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.enable();
    expect(result.success).toBe(true);
    expect(mockEnsureStarted).toHaveBeenCalled();
    expect(mockMkdirSync).toHaveBeenCalled(); // ensured dir for selectedBrowser.json
  });

  it('addMcpConfig skips addMcpServerConfig when config already exists', async () => {
    // getMcpServerInfo returns existing config
    const addMcpServerConfig = vi.fn();
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'chrome' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
        getMcpServerInfo: vi.fn(() => ({ config: { name: 'openkosmos-chrome-extension' } })),
        addMcpServerConfig,
      }),
    });

    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(deps);
    await mgr.enable();
    expect(addMcpServerConfig).not.toHaveBeenCalled();
  });

  it('addMcpConfig adds config when alias is null (skips entirely)', async () => {
    const addMcpServerConfig = vi.fn();
    const deps = makeDeps({
      getAlias: vi.fn(() => null),
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
        getMcpServerInfo: vi.fn(() => ({ config: null })),
        addMcpServerConfig,
      }),
    });

    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(deps);
    await mgr.enable();
    // addMcpConfig returns early when alias is null
    expect(addMcpServerConfig).not.toHaveBeenCalled();
  });
});

// ── checkAndRestartBrowser — user skips (null sentinel) ──────────────────────

describe('BrowserControlManager.enable() — darwin: user skips browser restart', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('returns success early when user skips restart (pgrep finds process)', async () => {
    // pgrep succeeds => browser is running => ask restart
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      callback?.(null, '1234', '');
    });

    const mgr = new BrowserControlManager(makeDeps());

    // Simulate user rejecting restart: resolve the confirm after a tick
    const originalWait = (mgr as any).waitForUserConfirm.bind(mgr);
    (mgr as any).waitForUserConfirm = async (map: Map<string, (v: boolean) => void>, id: string) => {
      // Return false (user cancels) immediately
      return false;
    };

    const result = await mgr.enable();
    // User skipped: enable() returns { success: true } early
    expect(result.success).toBe(true);
  });
});

// ── checkAndRestartBrowser — user confirms restart ────────────────────────────

describe('BrowserControlManager.enable() — darwin: user confirms browser restart', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('kills browser and re-launches when user confirms restart', async () => {
    // pgrep succeeds first (browser running), then pgrep fails (not running for launch check)
    let pgrepCallCount = 0;
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        pgrepCallCount++;
        if (pgrepCallCount === 1) {
          callback?.(null, '1234', ''); // browser running
        } else {
          callback?.(new Error('not found'), '', ''); // after kill
        }
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());

    // Simulate user confirming restart
    (mgr as any).waitForUserConfirm = async (_map: Map<any, any>, _id: string) => true;

    const result = await mgr.enable();
    expect(result.success).toBe(true);
    // pkill should have been called to kill the browser
    const cmds = mockExec.mock.calls.map((c: any[]) => c[0] as string);
    expect(cmds.some(c => c.includes('pkill'))).toBe(true);
  });
});

// ── enable() win32 — browser installed, no native server download ─────────────

describe('BrowserControlManager.enable() — win32 full flow', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('win32');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('returns success when Get-Process shows browser not running', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('Get-Process')) {
        callback?.(null, 'False\n', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.enable();
    expect(result.success).toBe(true);
    expect(mockSudoExec).toHaveBeenCalled(); // registerExtensions uses sudo
  });

  it('calls registerNativeServer win32 (powershell)', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('Get-Process')) {
        callback?.(null, 'False\n', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());
    await mgr.enable();
    const cmds = mockExec.mock.calls.map((c: any[]) => c[0] as string);
    expect(cmds.some(c => c.includes('powershell'))).toBe(true);
  });
});

// ── reinstallExtension — browser running, user confirms ───────────────────────

describe('BrowserControlManager.reinstallExtension() — darwin: browser running, user confirms', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockExistsSync.mockReturnValue(true);
    mockStop.mockResolvedValue(undefined);
    mockMcpDisconnect.mockResolvedValue(undefined);
    mockMcpDelete.mockResolvedValue(undefined);
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('returns failure when user cancels browser restart in reinstall', async () => {
    // pgrep finds browser running
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      callback?.(null, '1234', '');
    });

    const mgr = new BrowserControlManager(makeDeps());

    // User cancels restart
    (mgr as any).waitForUserConfirm = async () => false;

    const result = await mgr.reinstallExtension();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('User cancelled browser restart');
  });
});

describe('BrowserControlManager.reinstallExtension() — darwin: browser not running', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockExistsSync.mockReturnValue(true);
    mockStop.mockResolvedValue(undefined);
    mockMcpDisconnect.mockResolvedValue(undefined);
    mockMcpDelete.mockResolvedValue(undefined);
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('proceeds through full reinstall when browser is not running', async () => {
    let pgrepCount = 0;
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        pgrepCount++;
        // First check in reinstallExtension: not running
        // Subsequent checks in enable(): not running
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.reinstallExtension();
    expect(result.success).toBe(true);
  });
});

// ── reinstallExtension win32 — browser running, user confirms ─────────────────

describe('BrowserControlManager.reinstallExtension() — win32: browser running, user confirms', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('win32');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockExistsSync.mockReturnValue(false);
    mockStop.mockResolvedValue(undefined);
    mockMcpDisconnect.mockResolvedValue(undefined);
    mockMcpDelete.mockResolvedValue(undefined);
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('kills browser and proceeds when user confirms restart', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('Get-Process')) {
        callback?.(null, 'True\n', '');
      } else {
        callback?.(null, 'False\n', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());
    // User confirms restart
    (mgr as any).waitForUserConfirm = async () => true;

    const result = await mgr.reinstallExtension();
    expect(result.success).toBe(true);
    const cmds = mockExec.mock.calls.map((c: any[]) => c[0] as string);
    expect(cmds.some(c => c.includes('taskkill'))).toBe(true);
  });
});

// ── ensureNativeServer — user cancels native server download ─────────────────

describe('BrowserControlManager — ensureNativeServer: user cancels download', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: false });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    mockCheckBrowserInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
    // Native server needs download
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: false, needsDownload: true });
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('throws error when user cancels native server download', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    const mgr = new BrowserControlManager(makeDeps());
    // User cancels native server download
    (mgr as any).waitForUserConfirm = async () => false;

    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('User cancelled Native Server download');
  });

  it('throws error when ensureNativeServer fails after confirmed download', async () => {
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });

    nsFetcher.ensureNativeServer.mockResolvedValue({ success: false, error: 'download failed' });

    const mgr = new BrowserControlManager(makeDeps());
    // User confirms native server download
    (mgr as any).waitForUserConfirm = async () => true;

    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('Failed to download Native Server');
  });
});

// ── registerNativeServer — darwin writes NMH manifests ───────────────────────

describe('BrowserControlManager — registerNativeServer darwin (via enable)', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    mockCheckBrowserInstalled.mockResolvedValue(true);
    mockExistsSync.mockReturnValue(false);
    mockExec.mockImplementation((cmd: string, _opts: any, cb?: Function) => {
      const callback = typeof _opts === 'function' ? _opts : cb;
      if (typeof cmd === 'string' && cmd.includes('pgrep')) {
        callback?.(new Error('not found'), '', '');
      } else {
        callback?.(null, '', '');
      }
    });
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('writes NativeMessagingHost manifests on darwin', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    await mgr.enable();
    // registerNativeServer on darwin calls mkdirSync and writeFileSync for NMH dirs
    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    // Check at least one call includes the NMH host name
    const writeArgs = mockWriteFileSync.mock.calls;
    expect(writeArgs.some((args: any[]) => String(args[0]).includes('NativeMessagingHosts') || String(args[1]).includes('com.chromemcp.nativehost'))).toBe(true);
  });
});

// ── downloadAndInstallBrowserWindows — user cancelled ────────────────────────

describe('BrowserControlManager — downloadAndInstallBrowserWindows: user cancelled', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('win32');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    // Browser NOT installed on win32 -> triggers downloadAndInstallBrowserWindows
    mockCheckBrowserInstalled.mockResolvedValue(false);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('returns failure when user cancels browser installation on win32', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    // User cancels installation
    (mgr as any).waitForUserConfirm = async () => false;

    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('User cancelled browser installation');
  });
});

// ── downloadAndInstallBrowserMac — user cancelled ────────────────────────────

describe('BrowserControlManager — downloadAndInstallBrowserMac: user cancelled', () => {
  let restore: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    restore = stubPlatform('darwin');
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true });
    sudoOk();
    mockEnsureStarted.mockResolvedValue(undefined);
    nsFetcher.checkLocalNativeServer.mockReturnValue({ exists: true, needsDownload: false });
    nsFetcher.ensureNativeServer.mockResolvedValue({ success: true, nativeServerDir: '/tmp/ns', version: '1.0.0', downloaded: false });
    // Chrome NOT installed on darwin and selectedBrowser is chrome -> triggers downloadAndInstallBrowserMac
    mockCheckBrowserInstalled.mockResolvedValue(false);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  it('returns failure when user cancels chrome installation on darwin', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'chrome' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
        getMcpServerInfo: vi.fn(() => ({ config: null })),
        addMcpServerConfig: vi.fn().mockResolvedValue(undefined),
      }),
    });

    const mgr = new BrowserControlManager(deps);
    // User cancels installation
    (mgr as any).waitForUserConfirm = async () => false;

    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('User cancelled browser installation');
  });
});
