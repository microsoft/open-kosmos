// @ts-nocheck
/**
 * index.ts IPC handler coverage tests
 *
 * Covers: setUpIPC — all inline ipcMain.handle registrations plus
 *   the app lifecycle hooks (before-quit, will-quit) and the
 *   useUpdateManager helper (init-failed, call-failed, success paths).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── vi.hoisted: all variables needed by vi.mock factories ────────────────────

const {
  mockHandle,
  mockAppOn,
  mockGetPath,
  mockGetVersion,
  mockShellOpenPath,
  mockBrowserWindowFromWebContents,
  mockFsExistsSync,
  mockFsMkdirSync,
  mockFsWriteFileSync,
  mockFsRmSync,
  mockCreateLogger,
  mockIsFeatureEnabled,
  mockFeatureFlagManager,
  mockGetProfileCacheManager,
  mockGetAppCacheManager,
  mockGetTerminalManagerInstance,
  mockGetRemoteChannelManager,
  mockGetAdvancedLogger,
  mockUseAdvancedLogger,
  mockReplacePlaceholders,
  mockParseConfig,
  mockBuiltinToolsManager,
  mockGetBuiltinToolsManager,
  mockQuickStartImageCacheManager,
  mockSchedulerManager,
  mockRuntimeManagerGetInstance,
} = vi.hoisted(() => {
  const builtinMgr = {
    isInitialized: false as any,
    initialize: vi.fn().mockResolvedValue(undefined),
    executeTool: vi.fn().mockResolvedValue({ success: true, data: 'result', error: undefined }),
    getAllToolsInfo: vi.fn(() => [{ name: 'tool1' }]),
    isBuiltinTool: vi.fn(() => true),
  };

  return {
    mockHandle: vi.fn(),
    mockAppOn: vi.fn(),
    mockGetPath: vi.fn((_: string) => '/mock/userData'),
    mockGetVersion: vi.fn(() => '2.0.0'),
    mockShellOpenPath: vi.fn().mockResolvedValue(''),
    mockBrowserWindowFromWebContents: vi.fn(() => null),
    mockFsExistsSync: vi.fn(() => false),
    mockFsMkdirSync: vi.fn(),
    mockFsWriteFileSync: vi.fn(),
    mockFsRmSync: vi.fn(),
    mockCreateLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    mockIsFeatureEnabled: vi.fn((_flag: string) => false),
    mockFeatureFlagManager: {
      getAllFlagsValues: vi.fn(() => ({ flag1: true })),
      isEnabled: vi.fn((_flag: string) => true),
    },
    mockGetProfileCacheManager: vi.fn(),
    mockGetAppCacheManager: vi.fn(),
    mockGetTerminalManagerInstance: vi.fn(),
    mockGetRemoteChannelManager: vi.fn(),
    mockGetAdvancedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    mockUseAdvancedLogger: vi.fn().mockResolvedValue(undefined),
    mockReplacePlaceholders: vi.fn(() => ({ OpenKosmos_FOO: 'bar' })),
    mockParseConfig: vi.fn(() => ({ parsed: true })),
    mockBuiltinToolsManager: builtinMgr,
    mockGetBuiltinToolsManager: vi.fn(() => builtinMgr),
    mockQuickStartImageCacheManager: {
      getOrCacheImage: vi.fn().mockResolvedValue('file:///mock/image.png'),
      clearAgentCache: vi.fn(),
      clearAllCache: vi.fn(),
    },
    mockSchedulerManager: {
      dispose: vi.fn().mockResolvedValue(undefined),
      getRuntimeDiagnostics: vi.fn(() => ({})),
    },
    mockRuntimeManagerGetInstance: vi.fn(),
  };
});

// ─── electron ─────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    on: (...args: any[]) => (mockAppOn as any)(...args),
    getPath: (...args: any[]) => (mockGetPath as any)(...args),
    getVersion: (...args: any[]) => (mockGetVersion as any)(...args),
    getAppPath: vi.fn(() => '/mock/appPath'),
  },
  ipcMain: {
    handle: (...args: any[]) => (mockHandle as any)(...args),
    removeHandler: vi.fn(),
  },
  shell: {
    openPath: (...args: any[]) => (mockShellOpenPath as any)(...args),
  },
  BrowserWindow: {
    fromWebContents: (...args: any[]) => (mockBrowserWindowFromWebContents as any)(...args),
  },
}));

// ─── fs ───────────────────────────────────────────────────────────────────────

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => (mockFsExistsSync as any)(...args),
  mkdirSync: (...args: any[]) => (mockFsMkdirSync as any)(...args),
  writeFileSync: (...args: any[]) => (mockFsWriteFileSync as any)(...args),
  rmSync: (...args: any[]) => (mockFsRmSync as any)(...args),
}));

// ─── sub-module handler stubs ─────────────────────────────────────────────────

vi.mock('../app', () => ({ default: vi.fn() }));
vi.mock('../signin', () => ({ default: vi.fn() }));
vi.mock('../auth', () => ({ default: vi.fn() }));
vi.mock('../profile', () => ({ default: vi.fn() }));
vi.mock('../sub-agent', () => ({ default: vi.fn() }));
vi.mock('../mcp', () => ({ default: vi.fn() }));
vi.mock('../skill', () => ({ default: vi.fn() }));
vi.mock('../agent-chat', () => ({ default: vi.fn() }));
vi.mock('../fs', () => ({ default: vi.fn() }));
vi.mock('../workspace', () => ({ default: vi.fn() }));
vi.mock('../llm', () => ({ default: vi.fn() }));
vi.mock('../window', () => ({ default: vi.fn() }));
vi.mock('../toolbar', () => ({ default: vi.fn() }));
vi.mock('../plugin', () => ({ default: vi.fn() }));
vi.mock('../chat-session', () => ({ default: vi.fn() }));
vi.mock('../renderer-log', () => ({ registerRendererLogIPC: vi.fn() }));
vi.mock('../doctor', () => ({ default: vi.fn() }));

// ─── library mocks ────────────────────────────────────────────────────────────

vi.mock('../../../lib/browserControl/BrowserControlManager', () => ({
  BrowserControlManager: vi.fn(),
}));
vi.mock('../../../lib/browserControl/browserControlIPC', () => ({
  registerBrowserControlIPC: vi.fn(),
}));
vi.mock('../../../lib/scheduler/SchedulerIPC', () => ({
  registerSchedulerIPC: vi.fn(),
}));
vi.mock('../../../lib/buddy/BuddyIPC', () => ({
  registerBuddyIPC: vi.fn(),
}));
vi.mock('../../../lib/externalAgent/externalAgentIPC', () => ({
  registerExternalAgentIPC: vi.fn(),
}));
vi.mock('../../../lib/remoteChannel/remoteChannelIPC', () => ({
  registerRemoteChannelIPC: vi.fn(),
}));
vi.mock('../../../lib/unifiedLogger', () => ({
  createLogger: (...args: any[]) => (mockCreateLogger as any)(...args),
}));
vi.mock('../../../lib/utilities/safeConsole', () => ({
  safeConsole: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../lib/featureFlags', () => ({
  isFeatureEnabled: (...args: any[]) => (mockIsFeatureEnabled as any)(...args),
  featureFlagManager: {
    getAllFlagsValues: (...args: any[]) => mockFeatureFlagManager.getAllFlagsValues(...args),
    isEnabled: (...args: any[]) => mockFeatureFlagManager.isEnabled(...args),
  },
}));
vi.mock('../../../startup/lazy', () => ({
  getProfileCacheManager: (...args: any[]) => (mockGetProfileCacheManager as any)(...args),
  getAppCacheManager: (...args: any[]) => (mockGetAppCacheManager as any)(...args),
  getTerminalManagerInstance: (...args: any[]) => (mockGetTerminalManagerInstance as any)(...args),
  getRemoteChannelManager: (...args: any[]) => (mockGetRemoteChannelManager as any)(...args),
  getAdvancedLogger: (...args: any[]) => (mockGetAdvancedLogger as any)(...args),
  useAdvancedLogger: (...args: any[]) => (mockUseAdvancedLogger as any)(...args),
}));
vi.mock('../../../lib/userDataADO/kosmosPlaceholders', () => ({
  kosmosPlaceholderManager: {
    replacePlaceholdersInObject: (...args: any[]) => (mockReplacePlaceholders as any)(...args),
  },
}));
vi.mock('../../../lib/userDataADO/userInputPlaceholderParser', () => ({
  userInputPlaceholderParser: {
    parseConfig: (...args: any[]) => (mockParseConfig as any)(...args),
  },
}));
vi.mock('../../../lib/mcpRuntime/builtinTools/builtinToolsManager', () => ({
  getBuiltinToolsManager: (...args: any[]) => (mockGetBuiltinToolsManager as any)(...args),
}));
vi.mock('../../../lib/cache/quickStartImageCacheManager', () => ({
  quickStartImageCacheManager: {
    getOrCacheImage: (...args: any[]) => mockQuickStartImageCacheManager.getOrCacheImage(...args),
    clearAgentCache: (...args: any[]) => mockQuickStartImageCacheManager.clearAgentCache(...args),
    clearAllCache: (...args: any[]) => mockQuickStartImageCacheManager.clearAllCache(...args),
  },
}));
vi.mock('../../../lib/scheduler/SchedulerManager', () => ({
  schedulerManager: {
    dispose: (...args: any[]) => mockSchedulerManager.dispose(...args),
    getRuntimeDiagnostics: (...args: any[]) => mockSchedulerManager.getRuntimeDiagnostics(...args),
  },
}));
vi.mock('../../../lib/startupUpdate/startupUpdateService', () => ({
  StartupUpdateService: vi.fn(),
}));
vi.mock('../../../lib/runtime/RuntimeManager', () => ({
  RuntimeManager: {
    getInstance: (...args: any[]) => (mockRuntimeManagerGetInstance as any)(...args),
  },
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for channel: "${channel}"`);
  return call[1];
}

function makeEvent(senderUrl = '') {
  return {
    sender: {
      getURL: vi.fn(() => senderUrl),
    },
  } as any;
}

function makeMainWindow(opts: {
  destroyed?: boolean;
  minimized?: boolean;
  title?: string;
} = {}) {
  return {
    isDestroyed: vi.fn(() => opts.destroyed ?? false),
    isMinimized: vi.fn(() => opts.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    getTitle: vi.fn(() => opts.title ?? 'Main'),
    getParentWindow: vi.fn(() => null),
    webContents: { send: vi.fn() },
  };
}

function makeCtx(overrides: Partial<any> = {}) {
  return {
    currentUserAlias: 'testuser',
    mainWindow: makeMainWindow(),
    debugWindow: null,
    updateManager: Promise.resolve({
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn(),
      skipVersion: vi.fn().mockResolvedValue(undefined),
      getPreferences: vi.fn().mockResolvedValue({ autoUpdate: true }),
      updatePreferences: vi.fn().mockResolvedValue(undefined),
    }),
    isDev: false,
    isAnalyticsReady: true,
    isAgentChatReady: true,
    selectedText: 'hello',
    onBeforeQuit: vi.fn(),
    registerGlobalShortcuts: vi.fn(),
    getPersistedWindowZoomLevel: vi.fn().mockResolvedValue(1),
    applyWindowZoomLevel: vi.fn(),
    stepWindowZoomLevel: vi.fn(),
    resetWindowZoomLevel: vi.fn().mockResolvedValue(1),
    getMenuTemplate: vi.fn(() => []),
    handleWebSearch: vi.fn().mockResolvedValue({ success: true }),
    unregisterGlobalShortcuts: vi.fn(),
    createDebugWindow: vi.fn().mockResolvedValue(undefined),
    checkAssetsLibrariesAsync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── module under test ────────────────────────────────────────────────────────

import { setUpIPC } from '../index';

// ─── tests ────────────────────────────────────────────────────────────────────

describe('setUpIPC', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(false);
    mockBuiltinToolsManager.isInitialized = false;
    mockUseAdvancedLogger.mockResolvedValue(undefined);
    // Restore StartupUpdateService to a working mock after vi.clearAllMocks()
    const { StartupUpdateService } = await import('../../../lib/startupUpdate/startupUpdateService');
    (StartupUpdateService as any).mockImplementation(function(this: any) {
      this.run = vi.fn().mockResolvedValue({ updated: true });
    });
    ctx = makeCtx();
    setUpIPC(ctx);
  });

  // ── app lifecycle ──────────────────────────────────────────────────────────

  describe('app lifecycle hooks', () => {
    it('registers before-quit listener', () => {
      const channels = mockAppOn.mock.calls.map(([c]: any[]) => c);
      expect(channels).toContain('before-quit');
    });
  });

  // ── kosmos:replacePlaceholders ─────────────────────────────────────────────

  describe('kosmos:replacePlaceholders', () => {
    it('returns success with replaced data', async () => {
      const handler = getHandler('kosmos:replacePlaceholders');
      const result = await handler({}, { KEY: 'val' });
      expect(result).toEqual({ success: true, data: { OpenKosmos_FOO: 'bar' } });
    });

    it('returns error when no currentUserAlias', async () => {
      ctx.currentUserAlias = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('kosmos:replacePlaceholders');
      const result = await handler({}, {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No current user alias/);
    });

    it('returns error on exception', async () => {
      mockReplacePlaceholders.mockImplementationOnce(() => { throw new Error('fail'); });
      const handler = getHandler('kosmos:replacePlaceholders');
      const result = await handler({}, {});
      expect(result).toEqual({ success: false, error: 'fail' });
    });

    it('returns unknown error for non-Error throws', async () => {
      mockReplacePlaceholders.mockImplementationOnce(() => { throw 'string-error'; });
      const handler = getHandler('kosmos:replacePlaceholders');
      const result = await handler({}, {});
      expect(result.error).toBe('Unknown error');
    });
  });

  // ── kosmos:parseUserInputPlaceholders ─────────────────────────────────────

  describe('kosmos:parseUserInputPlaceholders', () => {
    it('returns success', async () => {
      const handler = getHandler('kosmos:parseUserInputPlaceholders');
      const result = await handler({}, { tool: 'test' });
      expect(result).toEqual({ success: true, data: { parsed: true } });
    });

    it('returns error on throw', async () => {
      mockParseConfig.mockImplementationOnce(() => { throw new Error('parse fail'); });
      const handler = getHandler('kosmos:parseUserInputPlaceholders');
      const result = await handler({}, {});
      expect(result).toEqual({ success: false, error: 'parse fail' });
    });
  });

  // ── builtinTools:execute ───────────────────────────────────────────────────

  describe('builtinTools:execute', () => {
    it('initializes and executes tool', async () => {
      const handler = getHandler('builtinTools:execute');
      const result = await handler({}, 'myTool', { arg: 1 });
      expect(mockBuiltinToolsManager.initialize).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toBe('result');
    });

    it('skips initialize when already initialized', async () => {
      mockBuiltinToolsManager.isInitialized = true;
      const handler = getHandler('builtinTools:execute');
      await handler({}, 'myTool', {});
      expect(mockBuiltinToolsManager.initialize).not.toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      mockBuiltinToolsManager.executeTool.mockRejectedValueOnce(new Error('exec error'));
      const handler = getHandler('builtinTools:execute');
      const result = await handler({}, 'myTool', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('exec error');
    });
  });

  // ── builtinTools:getAllTools ───────────────────────────────────────────────

  describe('builtinTools:getAllTools', () => {
    it('returns tools info', async () => {
      mockBuiltinToolsManager.isInitialized = true;
      const handler = getHandler('builtinTools:getAllTools');
      const result = await handler({});
      expect(result).toEqual({ success: true, data: [{ name: 'tool1' }] });
    });

    it('initializes if not initialized', async () => {
      mockBuiltinToolsManager.isInitialized = false;
      const handler = getHandler('builtinTools:getAllTools');
      await handler({});
      expect(mockBuiltinToolsManager.initialize).toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      mockBuiltinToolsManager.getAllToolsInfo.mockImplementationOnce(() => { throw new Error('get error'); });
      const handler = getHandler('builtinTools:getAllTools');
      const result = await handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── builtinTools:isBuiltinTool ────────────────────────────────────────────

  describe('builtinTools:isBuiltinTool', () => {
    it('returns true for builtin tool', async () => {
      mockBuiltinToolsManager.isInitialized = true;
      const handler = getHandler('builtinTools:isBuiltinTool');
      const result = await handler({}, 'tool1');
      expect(result).toEqual({ success: true, data: true });
    });

    it('returns error on exception', async () => {
      mockBuiltinToolsManager.isBuiltinTool.mockImplementationOnce(() => { throw new Error('check error'); });
      const handler = getHandler('builtinTools:isBuiltinTool');
      const result = await handler({}, 'tool1');
      expect(result.success).toBe(false);
    });
  });

  // ── mainWindow:show ────────────────────────────────────────────────────────

  describe('mainWindow:show', () => {
    it('shows and focuses window', () => {
      const handler = getHandler('mainWindow:show');
      const result = handler({});
      expect(result).toEqual({ success: true });
      expect(ctx.mainWindow!.show).toHaveBeenCalled();
      expect(ctx.mainWindow!.focus).toHaveBeenCalled();
    });

    it('restores minimized window', () => {
      (ctx.mainWindow as any).isMinimized = vi.fn(() => true);
      const handler = getHandler('mainWindow:show');
      handler({});
      expect(ctx.mainWindow!.restore).toHaveBeenCalled();
    });

    it('returns error when no main window', () => {
      ctx.mainWindow = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('mainWindow:show');
      const result = handler({});
      expect(result.success).toBe(false);
    });

    it('returns error when window destroyed', () => {
      (ctx.mainWindow as any).isDestroyed = vi.fn(() => true);
      const handler = getHandler('mainWindow:show');
      const result = handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── mainWindow:focus ───────────────────────────────────────────────────────

  describe('mainWindow:focus', () => {
    it('focuses window', () => {
      const handler = getHandler('mainWindow:focus');
      const result = handler({});
      expect(result.success).toBe(true);
    });

    it('returns error when no main window', () => {
      ctx.mainWindow = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('mainWindow:focus');
      expect(handler({}).success).toBe(false);
    });
  });

  // ── mainWindow:navigate ────────────────────────────────────────────────────

  describe('mainWindow:navigate', () => {
    it('sends navigate event', () => {
      const handler = getHandler('mainWindow:navigate');
      const result = handler({}, '/home', { foo: 'bar' });
      expect(result.success).toBe(true);
      expect(ctx.mainWindow!.webContents.send).toHaveBeenCalledWith('navigate:to', {
        route: '/home',
        state: { foo: 'bar' },
      });
    });

    it('returns error when no main window', () => {
      ctx.mainWindow = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      expect(getHandler('mainWindow:navigate')({}, '/home').success).toBe(false);
    });
  });

  // ── mainWindow:showWithAgent ───────────────────────────────────────────────

  describe('mainWindow:showWithAgent', () => {
    it('handles pseudo-agent-search chatId', async () => {
      const handler = getHandler('mainWindow:showWithAgent');
      const result = await handler({}, 'pseudo-agent-search-abc');
      expect(ctx.handleWebSearch).toHaveBeenCalledWith('pseudo-agent-search-abc');
      expect(result).toEqual({ success: true });
    });

    it('shows window and navigates for regular chatId', async () => {
      const handler = getHandler('mainWindow:showWithAgent');
      const result = await handler({}, 'agent-123');
      expect(result.success).toBe(true);
      expect(ctx.mainWindow!.webContents.send).toHaveBeenCalledWith(
        'navigate:to',
        expect.objectContaining({ route: '/agent/chat/agent-123' }),
      );
    });

    it('restores minimized window', async () => {
      (ctx.mainWindow as any).isMinimized = vi.fn(() => true);
      const handler = getHandler('mainWindow:showWithAgent');
      await handler({}, 'agent-123');
      expect(ctx.mainWindow!.restore).toHaveBeenCalled();
    });

    it('returns error when no main window', async () => {
      ctx.mainWindow = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('mainWindow:showWithAgent')({}, 'agent-123');
      expect(result.success).toBe(false);
    });
  });

  // ── logger:manualFlush ─────────────────────────────────────────────────────

  describe('logger:manualFlush', () => {
    it('returns success', async () => {
      const handler = getHandler('logger:manualFlush');
      const result = await handler({});
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockUseAdvancedLogger.mockRejectedValueOnce(new Error('flush error'));
      const handler = getHandler('logger:manualFlush');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('flush error');
    });
  });

  // ── folder:openLogs ────────────────────────────────────────────────────────

  describe('folder:openLogs', () => {
    it('opens logs directory', async () => {
      const handler = getHandler('folder:openLogs');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(mockShellOpenPath).toHaveBeenCalled();
    });

    it('creates logs directory if missing', async () => {
      mockFsExistsSync.mockReturnValueOnce(false);
      const handler = getHandler('folder:openLogs');
      await handler({});
      expect(mockFsMkdirSync).toHaveBeenCalled();
    });

    it('skips mkdir when logs dir exists', async () => {
      mockFsExistsSync.mockReturnValueOnce(true);
      const handler = getHandler('folder:openLogs');
      await handler({});
      expect(mockFsMkdirSync).not.toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      mockShellOpenPath.mockRejectedValueOnce(new Error('open error'));
      const handler = getHandler('folder:openLogs');
      const result = await handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── folder:openProfile ─────────────────────────────────────────────────────

  describe('folder:openProfile', () => {
    it('opens profile directory', async () => {
      const handler = getHandler('folder:openProfile');
      const result = await handler({}, 'testuser');
      expect(result.success).toBe(true);
    });

    it('returns error when no alias', async () => {
      const handler = getHandler('folder:openProfile');
      const result = await handler({}, '');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No user profile/);
    });

    it('creates profile directory if missing', async () => {
      mockFsExistsSync.mockReturnValueOnce(false);
      const handler = getHandler('folder:openProfile');
      await handler({}, 'testuser');
      expect(mockFsMkdirSync).toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      mockShellOpenPath.mockRejectedValueOnce(new Error('shell error'));
      const handler = getHandler('folder:openProfile');
      const result = await handler({}, 'testuser');
      expect(result.success).toBe(false);
    });
  });

  // ── quickStartImageCache ───────────────────────────────────────────────────

  describe('quickStartImageCache:getOrCache', () => {
    it('returns cached url', async () => {
      const handler = getHandler('quickStartImageCache:getOrCache');
      const result = await handler({}, 'agent', 'http://example.com/img.png');
      expect(result.success).toBe(true);
      expect(result.cachedUrl).toBe('file:///mock/image.png');
    });

    it('returns error on exception', async () => {
      mockQuickStartImageCacheManager.getOrCacheImage.mockRejectedValueOnce(new Error('cache fail'));
      const handler = getHandler('quickStartImageCache:getOrCache');
      const result = await handler({}, 'agent', 'http://x.com/img.png');
      expect(result.success).toBe(false);
      expect(result.cachedUrl).toBeNull();
    });
  });

  describe('quickStartImageCache:clearAgent', () => {
    it('clears agent cache', async () => {
      const handler = getHandler('quickStartImageCache:clearAgent');
      const result = await handler({}, 'agent');
      expect(result.success).toBe(true);
      expect(mockQuickStartImageCacheManager.clearAgentCache).toHaveBeenCalledWith('agent');
    });

    it('returns error on exception', async () => {
      mockQuickStartImageCacheManager.clearAgentCache.mockImplementationOnce(() => { throw new Error('err'); });
      const handler = getHandler('quickStartImageCache:clearAgent');
      const result = await handler({}, 'agent');
      expect(result.success).toBe(false);
    });
  });

  describe('quickStartImageCache:clearAll', () => {
    it('clears all cache', async () => {
      const handler = getHandler('quickStartImageCache:clearAll');
      const result = await handler({});
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockQuickStartImageCacheManager.clearAllCache.mockImplementationOnce(() => { throw new Error('err'); });
      const handler = getHandler('quickStartImageCache:clearAll');
      const result = await handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── debug:openWindow ───────────────────────────────────────────────────────

  describe('debug:openWindow', () => {
    it('opens debug window', async () => {
      const handler = getHandler('debug:openWindow');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(ctx.createDebugWindow).toHaveBeenCalled();
    });

    it('returns error on exception', async () => {
      ctx.createDebugWindow = vi.fn().mockRejectedValueOnce(new Error('create error'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('debug:openWindow');
      const result = await handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── update:checkForUpdates ─────────────────────────────────────────────────

  describe('update:checkForUpdates', () => {
    it('succeeds for non-silent check', async () => {
      const handler = getHandler('update:checkForUpdates');
      const result = await handler({}, false);
      expect(result.success).toBe(true);
    });

    it('triggers checkAssetsLibrariesAsync for silent check with alias', async () => {
      const handler = getHandler('update:checkForUpdates');
      await handler({}, true);
      expect(ctx.checkAssetsLibrariesAsync).toHaveBeenCalled();
    });

    it('does not trigger checkAssetsLibrariesAsync when no alias', async () => {
      ctx.currentUserAlias = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:checkForUpdates');
      await handler({}, true);
      expect(ctx.checkAssetsLibrariesAsync).not.toHaveBeenCalled();
    });

    it('returns error when updateManager init fails', async () => {
      ctx.updateManager = Promise.reject(new Error('init fail'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:checkForUpdates');
      const result = await handler({}, false);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to initialize update manager/);
    });

    it('returns error when call fails', async () => {
      const mgr = {
        checkForUpdates: vi.fn().mockRejectedValueOnce(new Error('check fail')),
        downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
        skipVersion: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:checkForUpdates');
      const result = await handler({}, false);
      expect(result.success).toBe(false);
    });
  });

  // ── update:downloadUpdate ──────────────────────────────────────────────────

  describe('update:downloadUpdate', () => {
    it('returns success', async () => {
      const handler = getHandler('update:downloadUpdate');
      const result = await handler({}, 'http://example.com/update.zip');
      expect(result.success).toBe(true);
    });

    it('returns error when init fails', async () => {
      ctx.updateManager = Promise.reject(new Error('init err'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:downloadUpdate');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to initialize update manager/);
    });

    it('returns error when call fails', async () => {
      const mgr = {
        downloadUpdate: vi.fn().mockRejectedValueOnce(new Error('dl fail')),
        checkForUpdates: vi.fn(), quitAndInstall: vi.fn(),
        skipVersion: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:downloadUpdate');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('dl fail');
    });
  });

  // ── update:quitAndInstall ──────────────────────────────────────────────────

  describe('update:quitAndInstall', () => {
    it('calls quitAndInstall on manager', async () => {
      const quitAndInstall = vi.fn();
      const mgr = {
        checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall,
        skipVersion: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:quitAndInstall');
      await handler({}, '/path/to/update');
      expect(quitAndInstall).toHaveBeenCalled();
    });

    it('disposes scheduler when feature flag enabled', async () => {
      const quitAndInstall = vi.fn();
      const mgr = {
        checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall,
        skipVersion: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'kosmosFeatureScheduler');
      setUpIPC(ctx);
      const handler = getHandler('update:quitAndInstall');
      await handler({}, undefined);
      expect(mockSchedulerManager.dispose).toHaveBeenCalled();
    });

    it('throws when init fails', async () => {
      ctx.updateManager = Promise.reject(new Error('init fail'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:quitAndInstall');
      await expect(handler({}, undefined)).rejects.toThrow('init fail');
    });

    it('throws when call fails', async () => {
      const mgr = {
        checkForUpdates: vi.fn(), downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn().mockImplementationOnce(() => { throw new Error('quit fail'); }),
        skipVersion: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('update:quitAndInstall');
      await expect(handler({}, undefined)).rejects.toThrow('quit fail');
    });
  });

  // ── update:getVersion ──────────────────────────────────────────────────────

  describe('update:getVersion', () => {
    it('returns app version', () => {
      const handler = getHandler('update:getVersion');
      expect(handler()).toBe('2.0.0');
    });
  });

  // ── update:skipVersion ─────────────────────────────────────────────────────

  describe('update:skipVersion', () => {
    it('returns success', async () => {
      const handler = getHandler('update:skipVersion');
      const result = await handler({}, '1.0.0');
      expect(result.success).toBe(true);
    });

    it('returns error when init fails', async () => {
      ctx.updateManager = Promise.reject(new Error('init err'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('update:skipVersion')({}, '1.0.0');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to initialize update manager/);
    });

    it('returns error when call fails', async () => {
      const mgr = {
        checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
        skipVersion: vi.fn().mockRejectedValueOnce(new Error('skip fail')),
        getPreferences: vi.fn(), updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('update:skipVersion')({}, '1.0.0');
      expect(result.success).toBe(false);
    });
  });

  // ── update:getPreferences ──────────────────────────────────────────────────

  describe('update:getPreferences', () => {
    it('returns preferences on success', async () => {
      const handler = getHandler('update:getPreferences');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ autoUpdate: true });
    });

    it('returns error when init fails', async () => {
      ctx.updateManager = Promise.reject(new Error('init err'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('update:getPreferences')({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to initialize update manager/);
    });

    it('returns error when call fails', async () => {
      const mgr = {
        checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
        skipVersion: vi.fn(),
        getPreferences: vi.fn().mockRejectedValueOnce(new Error('pref fail')),
        updatePreferences: vi.fn(),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('update:getPreferences')({});
      expect(result.success).toBe(false);
    });
  });

  // ── update:updatePreferences ───────────────────────────────────────────────

  describe('update:updatePreferences', () => {
    it('returns success', async () => {
      const handler = getHandler('update:updatePreferences');
      const result = await handler({}, { autoUpdate: false });
      expect(result.success).toBe(true);
    });

    it('returns error when init fails', async () => {
      ctx.updateManager = Promise.reject(new Error('init err'));
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('update:updatePreferences')({}, {});
      expect(result.success).toBe(false);
    });

    it('returns error when call fails', async () => {
      const mgr = {
        checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
        skipVersion: vi.fn(), getPreferences: vi.fn(),
        updatePreferences: vi.fn().mockRejectedValueOnce(new Error('upref fail')),
      };
      ctx.updateManager = Promise.resolve(mgr);
      vi.clearAllMocks();
      setUpIPC(ctx);
      const result = await getHandler('update:updatePreferences')({}, {});
      expect(result.success).toBe(false);
    });
  });

  // ── startup:checkAndInstallUpdates ─────────────────────────────────────────

  describe('startup:checkAndInstallUpdates', () => {
    it('returns error when no alias', async () => {
      ctx.currentUserAlias = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('startup:checkAndInstallUpdates');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No user logged in/);
    });

    it('runs service and returns success', async () => {
      // Use the handler from beforeEach (StartupUpdateService is properly mocked)
      const handler = getHandler('startup:checkAndInstallUpdates');
      const result = await handler({});
      expect(result.success).toBe(true);
    });

    it('returns error on unexpected exception', async () => {
      // Patch StartupUpdateService to throw in run() before re-registering
      const mod = await import('../../../lib/startupUpdate/startupUpdateService');
      (mod.StartupUpdateService as any).mockImplementation(function(this: any) {
        this.run = vi.fn().mockRejectedValueOnce(new Error('service error'));
      });
      const handler = getHandler('startup:checkAndInstallUpdates');
      const result = await handler({});
      expect(result.success).toBe(false);
      // Restore original mock
      (mod.StartupUpdateService as any).mockImplementation(function(this: any) {
        this.run = vi.fn().mockResolvedValue({ updated: true });
      });
    });
  });

  // ── featureFlags:getAllFlags ────────────────────────────────────────────────

  describe('featureFlags:getAllFlags', () => {
    it('returns all flags', async () => {
      const handler = getHandler('featureFlags:getAllFlags');
      const result = await handler({});
      expect(result).toEqual({ success: true, data: { flag1: true } });
    });

    it('returns error on exception', async () => {
      mockFeatureFlagManager.getAllFlagsValues.mockImplementationOnce(() => { throw new Error('flags error'); });
      const handler = getHandler('featureFlags:getAllFlags');
      const result = await handler({});
      expect(result.success).toBe(false);
    });
  });

  // ── featureFlags:isEnabled ─────────────────────────────────────────────────

  describe('featureFlags:isEnabled', () => {
    it('returns enabled state', async () => {
      const handler = getHandler('featureFlags:isEnabled');
      const result = await handler({}, 'someFlag');
      expect(result).toEqual({ success: true, data: true });
    });

    it('returns error on exception', async () => {
      mockFeatureFlagManager.isEnabled.mockImplementationOnce(() => { throw new Error('flag error'); });
      const handler = getHandler('featureFlags:isEnabled');
      const result = await handler({}, 'someFlag');
      expect(result.success).toBe(false);
    });
  });


});
