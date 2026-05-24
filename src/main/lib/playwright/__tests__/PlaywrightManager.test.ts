import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightManager } from '../PlaywrightManager';

// ── Mock external dependencies ────────────────────────────────────────────────

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock playwright-core inline to avoid vi.mock hoisting issues with top-level variables
vi.mock('playwright-core', () => {
  return {
    chromium: {
      launch: vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }),
      launchPersistentContext: vi.fn().mockResolvedValue({
        close: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      }),
      executablePath: vi.fn().mockReturnValue('/usr/bin/chromium'),
    },
  };
});

// Mock fs so path-existence checks are controllable
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshManager(): PlaywrightManager {
  (PlaywrightManager as any).instance = null;
  return PlaywrightManager.getInstance();
}

async function getChromiumMock() {
  const { chromium } = await import('playwright-core');
  return chromium as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlaywrightManager — singleton', () => {
  it('getInstance returns the same instance', () => {
    (PlaywrightManager as any).instance = null;
    const a = PlaywrightManager.getInstance();
    const b = PlaywrightManager.getInstance();
    expect(a).toBe(b);
    (PlaywrightManager as any).instance = null;
  });
});

describe('PlaywrightManager — _formatCommand', () => {
  let manager: PlaywrightManager;

  beforeEach(() => {
    manager = freshManager();
  });

  it('formats a simple command without quoting', () => {
    const result = (manager as any)._formatCommand('node', ['cli.js', 'install']);
    expect(result).toBe('node cli.js install');
  });

  it('quotes arguments with spaces', () => {
    const result = (manager as any)._formatCommand('node', ['/path with spaces/cli.js', 'install']);
    expect(result).toContain('"');
    expect(result).toContain('/path with spaces/cli.js');
  });
});

describe('PlaywrightManager — _summarizeInstallOutput', () => {
  let manager: PlaywrightManager;

  beforeEach(() => {
    manager = freshManager();
  });

  it('returns empty string for empty inputs', () => {
    const result = (manager as any)._summarizeInstallOutput('', '');
    expect(result).toBe('');
  });

  it('returns a combined, trimmed summary', () => {
    const result = (manager as any)._summarizeInstallOutput('stdout line', 'stderr line');
    expect(result).toContain('stdout line');
    expect(result).toContain('stderr line');
  });

  it('truncates very long output to at most 600 chars', () => {
    const longLine = 'x'.repeat(200);
    const result = (manager as any)._summarizeInstallOutput(longLine, longLine + longLine);
    expect(result.length).toBeLessThanOrEqual(600);
  });

  it('skips blank lines', () => {
    const result = (manager as any)._summarizeInstallOutput('\n\n', '\n\n');
    expect(result).toBe('');
  });
});

describe('PlaywrightManager — _getPlaywrightCacheDir', () => {
  let manager: PlaywrightManager;

  beforeEach(() => {
    manager = freshManager();
  });

  it('returns a non-empty string path', () => {
    const dir = (manager as any)._getPlaywrightCacheDir();
    expect(typeof dir).toBe('string');
    expect(dir.length).toBeGreaterThan(0);
  });

  it('includes "ms-playwright" in the cache path', () => {
    const dir = (manager as any)._getPlaywrightCacheDir();
    expect(dir).toContain('ms-playwright');
  });
});

describe('PlaywrightManager — _getInstallStrategies', () => {
  let manager: PlaywrightManager;

  beforeEach(() => {
    manager = freshManager();
  });

  it('always includes an npx fallback strategy', () => {
    const strategies = (manager as any)._getInstallStrategies(null);
    const npxStrategy = strategies.find((s: any) => s.label === 'npx fallback');
    expect(npxStrategy).toBeDefined();
    expect(npxStrategy.args).toContain('chromium-headless-shell');
  });

  it('adds a system-node strategy when a cli path is provided', () => {
    const strategies = (manager as any)._getInstallStrategies('/path/to/cli.js');
    const nodeStrategy = strategies.find((s: any) => s.label === 'system node');
    expect(nodeStrategy).toBeDefined();
    expect(nodeStrategy.args).toContain('/path/to/cli.js');
  });

  it('returns at least one strategy when cliPath is null', () => {
    const strategies = (manager as any)._getInstallStrategies(null);
    expect(strategies.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PlaywrightManager — checkBrowserInstalled', () => {
  it('returns { installed: true } when chromium launches successfully', async () => {
    const chromium = await getChromiumMock();
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    chromium.launch.mockResolvedValueOnce(fakeBrowser);

    const manager = freshManager();
    manager.resetInstallCache();
    const result = await manager.checkBrowserInstalled();
    expect(result.installed).toBe(true);
  });

  it('returns { installed: false } when chromium.launch rejects with ENOENT', async () => {
    const chromium = await getChromiumMock();
    chromium.launch.mockRejectedValueOnce(new Error("Executable doesn't exist at /path"));

    const manager = freshManager();
    manager.resetInstallCache();
    const result = await manager.checkBrowserInstalled();
    expect(result.installed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns { installed: false } when launch fails with browserType.launch error', async () => {
    const chromium = await getChromiumMock();
    chromium.launch.mockRejectedValueOnce(new Error('browserType.launch failed'));

    const manager = freshManager();
    manager.resetInstallCache();
    const result = await manager.checkBrowserInstalled();
    expect(result.installed).toBe(false);
  });
});

describe('PlaywrightManager — launchBrowser', () => {
  it('resolves with a browser object', async () => {
    const chromium = await getChromiumMock();
    const fakeBrowser = { close: vi.fn().mockResolvedValue(undefined), on: vi.fn() };
    chromium.launch.mockResolvedValueOnce(fakeBrowser);

    const manager = freshManager();
    const browser = await manager.launchBrowser();
    expect(browser).toBe(fakeBrowser);
  });

  it('passes headless option to chromium.launch', async () => {
    const chromium = await getChromiumMock();
    chromium.launch.mockResolvedValueOnce({ close: vi.fn(), on: vi.fn() });

    const manager = freshManager();
    await manager.launchBrowser({ headless: false });
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
  });

  it('defaults to headless: true', async () => {
    const chromium = await getChromiumMock();
    chromium.launch.mockResolvedValueOnce({ close: vi.fn(), on: vi.fn() });

    const manager = freshManager();
    await manager.launchBrowser();
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });
});

describe('PlaywrightManager — closeAll', () => {
  it('resolves without error when no browsers are tracked', async () => {
    const manager = freshManager();
    await expect(manager.closeAll()).resolves.not.toThrow();
  });

  it('closes all active browsers', async () => {
    const chromium = await getChromiumMock();
    const closeFn = vi.fn().mockResolvedValue(undefined);
    chromium.launch.mockResolvedValueOnce({ close: closeFn, on: vi.fn() });

    const manager = freshManager();
    await manager.launchBrowser();
    await manager.closeAll();
    expect(closeFn).toHaveBeenCalled();
  });
});

describe('PlaywrightManager — resetInstallCache', () => {
  it('resets internal install state flags without throwing', () => {
    const manager = freshManager();
    expect(() => manager.resetInstallCache()).not.toThrow();
  });
});
