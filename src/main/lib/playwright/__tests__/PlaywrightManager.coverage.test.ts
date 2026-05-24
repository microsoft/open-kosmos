/**
 * Additional coverage tests for PlaywrightManager — installBrowser, ensureBrowserInstalled,
 * launchPersistentContext, _findInternalNodeShim, _cleanupPlaywrightInstallLock,
 * cached browser check path, and _logInstallOutput.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock variables ────────────────────────────────────────────────────

const {
  mockLaunch,
  mockLaunchPersistentContext,
  mockExecutablePath,
  mockExistsSync,
  mockStatSync,
  mockMkdirSync,
  mockRmSync,
  mockSpawn,
} = vi.hoisted(() => ({
  mockLaunch: vi.fn(),
  mockLaunchPersistentContext: vi.fn(),
  mockExecutablePath: vi.fn().mockReturnValue('/usr/bin/chromium'),
  mockExistsSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

// ── Mock external dependencies ────────────────────────────────────────────────

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('playwright-core', () => ({
  chromium: {
    launch: mockLaunch,
    launchPersistentContext: mockLaunchPersistentContext,
    executablePath: mockExecutablePath,
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: mockExistsSync,
    statSync: mockStatSync,
    mkdirSync: mockMkdirSync,
    rmSync: mockRmSync,
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      const paths: Record<string, string> = {
        userData: '/fake/userData',
        home: '/fake/home',
        temp: '/tmp',
      };
      return paths[name] ?? '/fake';
    },
    getAppPath: () => '/fake/appPath',
  },
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

import { PlaywrightManager } from '../PlaywrightManager';
import { EventEmitter } from 'events';

function freshManager(): PlaywrightManager {
  (PlaywrightManager as any).instance = null;
  const mgr = PlaywrightManager.getInstance();
  mgr.resetInstallCache();
  return mgr;
}

/** Create a fake child process EventEmitter that emits 'close' with code */
function makeFakeChild(exitCode: number | null, delay = 0): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>; exitCode: number | null } {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = exitCode;
  child.kill = vi.fn((signal: string) => {
    if (signal === 'SIGTERM') child.exitCode = 0; // simulate termination
  });
  if (delay === 0) {
    setTimeout(() => child.emit('close', exitCode), 0);
  } else {
    setTimeout(() => child.emit('close', exitCode), delay);
  }
  return child;
}

// ── checkBrowserInstalled — cached path ──────────────────────────────────────

describe('PlaywrightManager — checkBrowserInstalled cache invalidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecutablePath.mockReturnValue('/usr/bin/chromium');
  });

  it('re-checks when cached as available but exe no longer on disk', async () => {
    // First call: launch succeeds → sets cache
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunch.mockResolvedValueOnce(fakeBrowser);
    mockExistsSync.mockReturnValue(false);

    const manager = freshManager();
    const first = await manager.checkBrowserInstalled();
    expect(first.installed).toBe(true);

    // Now cache is set — second call with exe missing should re-check
    mockExistsSync.mockReturnValue(false); // exe gone
    mockLaunch.mockResolvedValueOnce(fakeBrowser); // re-launch succeeds
    const second = await manager.checkBrowserInstalled();
    expect(second.installed).toBe(true);
  });

  it('re-checks when executablePath() throws', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunch.mockResolvedValueOnce(fakeBrowser);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    await manager.checkBrowserInstalled(); // populate cache

    // Make executablePath throw
    mockExecutablePath.mockImplementationOnce(() => { throw new Error('no browser'); });
    mockLaunch.mockResolvedValueOnce(fakeBrowser);
    const result = await manager.checkBrowserInstalled();
    expect(result.installed).toBe(true);
  });
});

// ── installBrowser — concurrent guard ────────────────────────────────────────

describe('PlaywrightManager — installBrowser concurrent guard', () => {
  beforeEach(() => vi.resetAllMocks());

  it('serialises concurrent installs — second caller waits for first', async () => {
    // Strategy: make _doInstall run a fast npx command
    const child = makeFakeChild(0);
    mockSpawn.mockReturnValue(child);
    mockExistsSync.mockReturnValue(false);

    const manager = freshManager();
    // Fire two concurrent installs
    const [r1, r2] = await Promise.all([manager.installBrowser(), manager.installBrowser()]);
    expect(r1.success || r2.success).toBe(true);
  });
});

// ── installBrowser — _doInstall strategies ───────────────────────────────────

describe('PlaywrightManager — _doInstall strategy fallback', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns success=true when npx strategy exits 0', async () => {
    mockExistsSync.mockReturnValue(false);
    const child = makeFakeChild(0);
    mockSpawn.mockReturnValue(child);

    const manager = freshManager();
    const result = await manager.installBrowser();
    expect(result.success).toBe(true);
  });

  it('returns success=false when all strategies fail', async () => {
    mockExistsSync.mockReturnValue(false);
    const child = makeFakeChild(1); // exit code 1 = failure
    mockSpawn.mockReturnValue(child);

    const manager = freshManager();
    // Force only npx strategy by making _findPlaywrightCli return null
    vi.spyOn(manager as any, '_findPlaywrightCli').mockReturnValue(null);
    const result = await manager.installBrowser();
    expect(result.success).toBe(false);
  });

  it('handles spawn error event', async () => {
    mockExistsSync.mockReturnValue(false);

    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.kill = vi.fn();
    // Add a no-op error handler to prevent unhandled error
    child.on('error', () => {});
    mockSpawn.mockReturnValue(child);

    // Emit error asynchronously
    setTimeout(() => child.emit('error', new Error('spawn ENOENT')), 0);

    const manager = freshManager();
    vi.spyOn(manager as any, '_findPlaywrightCli').mockReturnValue(null);
    const result = await manager.installBrowser();
    expect(result.success).toBe(false);
  });
});

// ── _doInstall timeout path ───────────────────────────────────────────────────

describe('PlaywrightManager — _doInstall timeout cleanup', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.useRealTimers());

  it('cleans up lock and continues on timeout when cliPath available', async () => {
    vi.useFakeTimers();

    mockExistsSync.mockReturnValue(false); // lockPath doesn't exist → skip rmSync

    // Child that never closes (hangs)
    const hangingChild = new EventEmitter() as any;
    hangingChild.stdout = new EventEmitter();
    hangingChild.stderr = new EventEmitter();
    hangingChild.exitCode = null;
    hangingChild.kill = vi.fn();

    // Second child (npx fallback) succeeds — emit close in next tick using fake timer
    const successChild = new EventEmitter() as any;
    successChild.stdout = new EventEmitter();
    successChild.stderr = new EventEmitter();
    successChild.exitCode = 0;
    successChild.kill = vi.fn();

    mockSpawn
      .mockReturnValueOnce(hangingChild)
      .mockReturnValueOnce(successChild);

    const manager = freshManager();
    vi.spyOn(manager as any, '_findPlaywrightCli').mockReturnValue('/fake/cli.js');
    vi.spyOn(manager as any, '_findInternalNodeShim').mockReturnValue(null);

    const installPromise = manager.installBrowser();

    // Advance past the 5-minute timeout for hanging child
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    // Allow the SIGKILL fallback timer
    await vi.advanceTimersByTimeAsync(2000 + 100);

    // Emit close on the success child
    successChild.emit('close', 0);

    const result = await installPromise;
    // npx fallback succeeded
    expect(result.success).toBe(true);
  });
});

// ── ensureBrowserInstalled ────────────────────────────────────────────────────

describe('PlaywrightManager — ensureBrowserInstalled', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns immediately when browser is already installed', async () => {
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunch.mockResolvedValueOnce(fakeBrowser);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    const result = await manager.ensureBrowserInstalled();
    expect(result.installed).toBe(true);
  });

  it('auto-installs and re-verifies when not installed', async () => {
    mockExistsSync.mockReturnValue(false);

    // checkBrowserInstalled (first call): launch fails
    mockLaunch.mockRejectedValueOnce(new Error("Executable doesn't exist"));

    // installBrowser: spawn exits 0
    const child = makeFakeChild(0);
    mockSpawn.mockReturnValue(child);

    // checkBrowserInstalled (verify after install): launch succeeds
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunch.mockResolvedValueOnce(fakeBrowser);

    const manager = freshManager();
    vi.spyOn(manager as any, '_findPlaywrightCli').mockReturnValue(null);
    const result = await manager.ensureBrowserInstalled();
    expect(result.installed).toBe(true);
  });

  it('returns error when install succeeds but verify fails', async () => {
    mockExistsSync.mockReturnValue(false);

    // check: fails
    mockLaunch.mockRejectedValueOnce(new Error("Executable doesn't exist"));
    // install: succeeds
    const child = makeFakeChild(0);
    mockSpawn.mockReturnValueOnce(child);
    // verify: fails again
    mockLaunch.mockRejectedValueOnce(new Error("Executable doesn't exist"));

    const manager = freshManager();
    vi.spyOn(manager as any, '_findPlaywrightCli').mockReturnValue(null);
    const result = await manager.ensureBrowserInstalled();
    expect(result.installed).toBe(false);
    expect(result.error).toMatch(/verification failed/i);
  });

  it('returns error when install itself fails', async () => {
    mockExistsSync.mockReturnValue(false);

    // checkBrowserInstalled: fails
    mockLaunch.mockRejectedValueOnce(new Error("Executable doesn't exist"));
    // installBrowser spawn fails
    const child = makeFakeChild(1);
    mockSpawn.mockReturnValueOnce(child);

    const manager = freshManager();
    vi.spyOn(manager as any, '_findPlaywrightCli').mockReturnValue(null);
    const result = await manager.ensureBrowserInstalled();
    expect(result.installed).toBe(false);
  });
});

// ── launchPersistentContext ───────────────────────────────────────────────────

describe('PlaywrightManager — launchPersistentContext', () => {
  beforeEach(() => vi.resetAllMocks());

  it('launches with msedge channel by default', async () => {
    const fakeCtx = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunchPersistentContext.mockResolvedValue(fakeCtx);
    // BrowserProfileManager.ensureProfileDir — mock mkdirSync so it doesn't fail
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    const ctx = await manager.launchPersistentContext({ profileName: 'test-profile' });
    expect(ctx).toBe(fakeCtx);
    expect(mockLaunchPersistentContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ channel: 'msedge' })
    );
  });

  it('falls back to bundled chromium when Edge is unavailable', async () => {
    const fakeCtx = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunchPersistentContext
      .mockRejectedValueOnce(new Error('Edge not found'))
      .mockResolvedValueOnce(fakeCtx);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    const ctx = await manager.launchPersistentContext({ profileName: 'test-profile' });
    expect(ctx).toBe(fakeCtx);
    // Second call should not have channel
    expect(mockLaunchPersistentContext).toHaveBeenCalledTimes(2);
    const secondCall = mockLaunchPersistentContext.mock.calls[1][1];
    expect(secondCall).not.toHaveProperty('channel');
  });

  it('rethrows when a non-default channel is specified and it fails', async () => {
    mockLaunchPersistentContext.mockRejectedValue(new Error('custom channel error'));
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    await expect(
      manager.launchPersistentContext({ profileName: 'test-profile', channel: 'chrome' })
    ).rejects.toThrow('custom channel error');
  });

  it('passes offscreen args when offscreen=true', async () => {
    const fakeCtx = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    mockLaunchPersistentContext.mockResolvedValue(fakeCtx);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    await manager.launchPersistentContext({ profileName: 'test-profile', offscreen: true });
    const callArgs = mockLaunchPersistentContext.mock.calls[0][1];
    expect(callArgs.args).toEqual(
      expect.arrayContaining(['--window-position=-32000,-32000'])
    );
  });

  it('tracks context and removes it on close event', async () => {
    let closeHandler: (() => void) | undefined;
    const fakeCtx = {
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'close') closeHandler = handler;
      }),
    };
    mockLaunchPersistentContext.mockResolvedValue(fakeCtx);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    await manager.launchPersistentContext({ profileName: 'test-profile' });
    expect((manager as any).activeContexts.size).toBe(1);

    closeHandler?.();
    expect((manager as any).activeContexts.size).toBe(0);
  });
});

// ── _findInternalNodeShim ─────────────────────────────────────────────────────

describe('PlaywrightManager — _findInternalNodeShim', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns null when node shim does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const manager = freshManager();
    const result = (manager as any)._findInternalNodeShim();
    expect(result).toBeNull();
  });

  it('returns the shim path when both node and bun exist', () => {
    mockExistsSync.mockReturnValue(true);
    const manager = freshManager();
    const result = (manager as any)._findInternalNodeShim();
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });
});

// ── _cleanupPlaywrightInstallLock ─────────────────────────────────────────────

describe('PlaywrightManager — _cleanupPlaywrightInstallLock', () => {
  beforeEach(() => vi.resetAllMocks());

  it('does nothing when lock file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const manager = freshManager();
    expect(() => (manager as any)._cleanupPlaywrightInstallLock('test reason')).not.toThrow();
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('removes lock when it exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => false });

    const manager = freshManager();
    (manager as any)._cleanupPlaywrightInstallLock('timeout');
    expect(mockRmSync).toHaveBeenCalled();
  });

  it('does not throw when rmSync fails', () => {
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockRmSync.mockImplementation(() => { throw new Error('permission denied'); });

    const manager = freshManager();
    expect(() => (manager as any)._cleanupPlaywrightInstallLock('timeout')).not.toThrow();
  });
});

// ── _logInstallOutput ─────────────────────────────────────────────────────────

describe('PlaywrightManager — _logInstallOutput', () => {
  it('does not throw for any stream type', () => {
    const manager = freshManager();
    expect(() => (manager as any)._logInstallOutput('stdout', 'Downloading chromium...')).not.toThrow();
    expect(() => (manager as any)._logInstallOutput('stderr', 'error: something failed')).not.toThrow();
    expect(() => (manager as any)._logInstallOutput('stdout', '')).not.toThrow();
    expect(() => (manager as any)._logInstallOutput('stdout', 'just some random output')).not.toThrow();
  });
});

// ── closeAll with active contexts ─────────────────────────────────────────────

describe('PlaywrightManager — closeAll with contexts', () => {
  beforeEach(() => vi.resetAllMocks());

  it('closes both browsers and contexts', async () => {
    const fakeCtx = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };

    mockLaunchPersistentContext.mockResolvedValue(fakeCtx);
    mockLaunch.mockResolvedValue(fakeBrowser);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    await manager.launchBrowser();
    await manager.launchPersistentContext({ profileName: 'test' });
    await manager.closeAll();

    expect(fakeBrowser.close).toHaveBeenCalled();
    expect(fakeCtx.close).toHaveBeenCalled();
  });

  it('handles close errors gracefully', async () => {
    const fakeBrowser = {
      close: vi.fn().mockRejectedValue(new Error('close failed')),
      on: vi.fn(),
    };
    mockLaunch.mockResolvedValue(fakeBrowser);
    mockExistsSync.mockReturnValue(true);

    const manager = freshManager();
    await manager.launchBrowser();
    await expect(manager.closeAll()).resolves.not.toThrow();
  });
});

// ── _getPlaywrightCacheDir platform branches ──────────────────────────────────

describe('PlaywrightManager — _getPlaywrightCacheDir platform paths', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('uses Library/Caches on darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const manager = freshManager();
    const dir = (manager as any)._getPlaywrightCacheDir();
    expect(dir).toContain('Library/Caches');
  });

  it('uses LOCALAPPDATA on win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const saved = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\Users\\user\\AppData\\Local';
    const manager = freshManager();
    const dir = (manager as any)._getPlaywrightCacheDir();
    expect(dir).toContain('ms-playwright');
    process.env.LOCALAPPDATA = saved;
  });

  it('uses XDG_CACHE_HOME on linux when set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const saved = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = '/custom/cache';
    const manager = freshManager();
    const dir = (manager as any)._getPlaywrightCacheDir();
    expect(dir).toContain('/custom/cache');
    process.env.XDG_CACHE_HOME = saved;
  });
});
