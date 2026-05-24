/**
 * Unit tests for BrowserControlManager
 *
 * Strategy: test the public methods that do NOT require OS-level tools (exec,
 * sudoPrompt) or Playwright.  We mock all external modules and focus on:
 *   - getInstallStatus / getUpdateStatus
 *   - resolveBrowserInstallConfirm / resolveNativeServerDownloadConfirm / resolveBrowserRestartConfirm
 *   - getSettings / updateSettings
 *   - getStatus
 *   - cdpGetStatus / cdpEnable / cdpDisable
 *   - Feature-flag guard on enable() / disable() / reinstallExtension()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── External dependency mocks ────────────────────────────────────────────────

vi.mock('electron', () => ({
  BrowserWindow: {},
  screen: { getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
}));

vi.mock('child_process', () => ({ exec: vi.fn() }));
vi.mock('sudo-prompt', () => ({ default: { exec: vi.fn() } }));
vi.mock('fs', () => ({
  default: {},
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  constants: { R_OK: 4 },
}));
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return { ...actual, default: actual };
});

vi.mock('../browserControlHttpServer', () => ({
  browserControlHttpServer: { ensureStarted: vi.fn(), stop: vi.fn() },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    delete: vi.fn(),
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
  checkBrowserControlStatus: vi.fn().mockResolvedValue(true),
  checkBrowserInstalled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../nativeServerFetcher', () => ({
  NativeServerFetcher: vi.fn().mockImplementation(() => ({
    checkLocalNativeServer: vi.fn(() => ({ exists: false, needsDownload: false })),
    checkNativeServerNeedsUpdate: vi.fn().mockResolvedValue({ localVersion: '1.0.0', remoteVersion: '1.0.1', needsUpdate: true }),
    downloadNativeServer: vi.fn().mockResolvedValue({ success: true }),
    ensureNativeServer: vi.fn().mockResolvedValue({ success: true, nativeServerDir: '/tmp', version: '1.0.0', downloaded: false }),
  })),
}));

// ── SUT import ────────────────────────────────────────────────────────────────

import { BrowserControlManager, BrowserControlDeps } from '../BrowserControlManager';

// ── Factories ─────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

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

  it('returns a copy of state, not the internal reference', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const a = mgr.getInstallStatus().data;
    const b = mgr.getInstallStatus().data;
    expect(a).not.toBe(b);
  });
});

describe('BrowserControlManager.getUpdateStatus', () => {
  it('returns initial update state', () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = mgr.getUpdateStatus();
    expect(result.success).toBe(true);
    expect(result.data.isUpdating).toBe(false);
    expect(result.data.localVersion).toBe('');
    expect(result.data.remoteVersion).toBe('');
  });
});

describe('BrowserControlManager — confirmation resolvers', () => {
  it('resolveBrowserInstallConfirm returns false for unknown requestId', () => {
    const mgr = new BrowserControlManager(makeDeps());
    expect(mgr.resolveBrowserInstallConfirm('unknown', true)).toBe(false);
  });

  it('resolveNativeServerDownloadConfirm returns false for unknown requestId', () => {
    const mgr = new BrowserControlManager(makeDeps());
    expect(mgr.resolveNativeServerDownloadConfirm('unknown', true)).toBe(false);
  });

  it('resolveBrowserRestartConfirm returns false for unknown requestId', () => {
    const mgr = new BrowserControlManager(makeDeps());
    expect(mgr.resolveBrowserRestartConfirm('unknown', true)).toBe(false);
  });

  it('resolveBrowserInstallConfirm resolves a pending callback', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    // Access private map via casting
    const map = (mgr as any).pendingBrowserInstallConfirm as Map<string, (v: boolean) => void>;
    let resolved: boolean | undefined;
    // Simulate a real waitForUserConfirm callback that also deletes the entry
    map.set('req-1', (v) => { map.delete('req-1'); resolved = v; });
    const result = mgr.resolveBrowserInstallConfirm('req-1', true);
    expect(result).toBe(true);
    expect(resolved).toBe(true);
    // Entry should be deleted after resolution
    expect(map.has('req-1')).toBe(false);
  });
});

describe('BrowserControlManager.getSettings', () => {
  it('returns settings from profile cache manager', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.getSettings();
    expect(result.success).toBe(true);
    expect((result as any).data).toEqual({ browser: 'edge' });
  });

  it('returns error when alias is null', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getSettings();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('No current user alias');
  });

  it('returns error when profile cache manager throws', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockRejectedValue(new Error('DB error')),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getSettings();
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('DB error');
  });
});

describe('BrowserControlManager.updateSettings', () => {
  it('returns error when alias is null', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.updateSettings({ browser: 'chrome' });
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('No current user alias');
  });

  it('returns success=false when pcManager.updateBrowserControlSettings returns false', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(false),
        getMcpServerInfo: vi.fn(() => ({ config: null })),
        addMcpServerConfig: vi.fn(),
      }),
    });
    const mgr = new BrowserControlManager(deps);
    // settings without browser so the fetch branch is skipped
    const result = await mgr.updateSettings({});
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('Failed to update');
  });
});

describe('BrowserControlManager.getStatus', () => {
  it('returns enabled status from checkBrowserControlStatus', async () => {
    const { checkBrowserControlStatus } = await import('../browserControlStatus');
    (checkBrowserControlStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.getStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(true);
  });

  it('handles null alias (uses default browser edge)', async () => {
    const { checkBrowserControlStatus } = await import('../browserControlStatus');
    (checkBrowserControlStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.getStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(false);
  });
});

describe('BrowserControlManager — feature flag guard', () => {
  it('enable() returns error when browserControl feature is disabled', async () => {
    const deps = makeDeps({ isFeatureEnabled: vi.fn(() => false) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.enable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('not enabled');
  });

  it('disable() returns error when browserControl feature is disabled', async () => {
    const deps = makeDeps({ isFeatureEnabled: vi.fn(() => false) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.disable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('not enabled');
  });

  it('reinstallExtension() returns error when browserControl feature is disabled', async () => {
    const deps = makeDeps({ isFeatureEnabled: vi.fn(() => false) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.reinstallExtension();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('not enabled');
  });
});

describe('BrowserControlManager.cdpGetStatus', () => {
  it('returns enabled=false when no alias', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(false);
  });

  it('returns enabled=false when server config is null', async () => {
    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(false);
  });

  it('returns enabled=true when server config exists', async () => {
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
        getMcpServerInfo: vi.fn(() => ({ config: { name: 'chrome-devtools-mcp' } })),
        addMcpServerConfig: vi.fn(),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
      }),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpGetStatus();
    expect(result.success).toBe(true);
    expect((result as any).data.enabled).toBe(true);
  });
});

describe('BrowserControlManager.cdpEnable', () => {
  it('returns error when no alias', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('Not logged in');
  });

  it('adds MCP config when it does not exist and returns success', async () => {
    const addMcpServerConfig = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getMcpServerInfo: vi.fn(() => ({ config: null })),
        addMcpServerConfig,
        getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
      }),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(true);
    expect(addMcpServerConfig).toHaveBeenCalledOnce();
  });

  it('skips addMcpServerConfig when config already exists', async () => {
    const addMcpServerConfig = vi.fn();
    const deps = makeDeps({
      getProfileCacheManager: vi.fn().mockResolvedValue({
        getMcpServerInfo: vi.fn(() => ({ config: { name: 'chrome-devtools-mcp' } })),
        addMcpServerConfig,
        getBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
        updateBrowserControlSettings: vi.fn().mockResolvedValue(true),
      }),
    });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpEnable();
    expect(result.success).toBe(true);
    expect(addMcpServerConfig).not.toHaveBeenCalled();
  });
});

describe('BrowserControlManager.cdpDisable', () => {
  it('returns error when no alias', async () => {
    const deps = makeDeps({ getAlias: vi.fn(() => null) });
    const mgr = new BrowserControlManager(deps);
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(false);
    expect((result as any).error).toContain('Not logged in');
  });

  it('disconnects and deletes MCP server, returns success', async () => {
    const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
    (mcpClientManager.disconnect as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    (mcpClientManager.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(true);
    expect(mcpClientManager.disconnect).toHaveBeenCalled();
    expect(mcpClientManager.delete).toHaveBeenCalled();
  });

  it('still returns success even if disconnect throws', async () => {
    const { mcpClientManager } = await import('../../mcpRuntime/mcpClientManager');
    (mcpClientManager.disconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('already off'));
    (mcpClientManager.delete as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('already gone'));

    const mgr = new BrowserControlManager(makeDeps());
    const result = await mgr.cdpDisable();
    expect(result.success).toBe(true);
  });
});
