// @ts-nocheck
/**
 * index.ts IPC handler coverage tests
 *
 * Covers: setUpIPC — all inline ipcMain.handle registrations plus
 *   the app lifecycle hooks (before-quit and will-quit).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── vi.hoisted: all variables needed by vi.mock factories ────────────────────

const {
  mockHandle,
  mockAppOn,
  mockGetPath,
  mockShellOpenPath,
  mockFsExistsSync,
  mockFsMkdirSync,
  mockFsWriteFileSync,
  mockFsRmSync,
  mockSetupMemex,
  mockCreateLogger,
  mockIsFeatureEnabled,
  mockFeatureFlagManager,
  mockGetProfileCacheManager,
  mockGetAppCacheManager,
  mockGetTerminalManagerInstance,
  mockGetAdvancedLogger,
  mockUseAdvancedLogger,
  mockReplacePlaceholders,
  mockParseConfig,
  mockBuiltinToolsManager,
  mockGetBuiltinToolsManager,
  mockNativeModuleManager,
  mockRuntimeManagerGetInstance,
  mockRegisterCodingCliIPC,
  mockInitEmbeddedBrowserManager,
  mockRegisterSyncIPC,
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
    mockShellOpenPath: vi.fn().mockResolvedValue(''),
    mockFsExistsSync: vi.fn(() => false),
    mockFsMkdirSync: vi.fn(),
    mockFsWriteFileSync: vi.fn(),
    mockFsRmSync: vi.fn(),
    mockSetupMemex: vi.fn(),
    mockCreateLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    mockIsFeatureEnabled: vi.fn((_flag: string) => false),
    mockFeatureFlagManager: {
      getAllFlagsValues: vi.fn(() => ({ flag1: true })),
      isEnabled: vi.fn((_flag: string) => true),
    },
    mockGetProfileCacheManager: vi.fn(),
    mockGetAppCacheManager: vi.fn(),
    mockGetTerminalManagerInstance: vi.fn(),
    mockGetAdvancedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
    mockUseAdvancedLogger: vi.fn().mockResolvedValue(undefined),
    mockReplacePlaceholders: vi.fn(() => ({ OPENKOSMOS_FOO: 'bar' })),
    mockParseConfig: vi.fn(() => ({ parsed: true })),
    mockBuiltinToolsManager: builtinMgr,
    mockGetBuiltinToolsManager: vi.fn(() => builtinMgr),
    mockNativeModuleManager: {
      getStatus: vi.fn(() => ({ status: 'ready' })),
      ensureDownloaded: vi.fn().mockResolvedValue('/local/path'),
      cancelDownload: vi.fn(),
      deleteModule: vi.fn(),
    },
    mockRuntimeManagerGetInstance: vi.fn(),
    mockRegisterCodingCliIPC: vi.fn(),
    mockInitEmbeddedBrowserManager: vi.fn(() => ({ id: 'browser-manager' })),
    mockRegisterSyncIPC: vi.fn(),
  };
});

// ─── electron ─────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    on: (...args: any[]) => (mockAppOn as any)(...args),
    getPath: (...args: any[]) => (mockGetPath as any)(...args),
    getAppPath: vi.fn(() => '/mock/appPath'),
  },
  ipcMain: {
    handle: (...args: any[]) => (mockHandle as any)(...args),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  shell: {
    openPath: (...args: any[]) => (mockShellOpenPath as any)(...args),
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
vi.mock('../agent-chat-steering', () => ({ default: vi.fn() }));
vi.mock('../tts', () => ({ default: vi.fn() }));
vi.mock('../fs', () => ({ default: vi.fn() }));
vi.mock('../workspace', () => ({ default: vi.fn() }));
vi.mock('../llm', () => ({ default: vi.fn() }));
vi.mock('../whisper', () => ({ default: vi.fn() }));
vi.mock('../window', () => ({ default: vi.fn() }));
vi.mock('../toolbar', () => ({ default: vi.fn() }));
vi.mock('../plugin', () => ({ default: vi.fn() }));
vi.mock('../chat-session', () => ({ default: vi.fn() }));
vi.mock('../renderer-log', () => ({ registerRendererLogIPC: vi.fn() }));

vi.mock('../../../lib/memex/memexIPC', () => ({
  setupMemex: (...args: any[]) => (mockSetupMemex as any)(...args),
}));
vi.mock('../../../lib/sync/syncIPC', () => ({
  registerSyncIPC: (...args: any[]) => mockRegisterSyncIPC(...args),
}));
vi.mock('../../../lib/scheduler/SchedulerIPC', () => ({
  registerSchedulerIPC: vi.fn(),
}));
vi.mock('../../../lib/agentHooks/agentHooksIpc', () => ({
  registerAgentHooksIPC: vi.fn(),
}));
vi.mock('../../../lib/buddy/BuddyIPC', () => ({
  registerBuddyIPC: vi.fn(),
}));
vi.mock('../../../lib/externalAgent/externalAgentIPC', () => ({
  registerExternalAgentIPC: vi.fn(),
}));
vi.mock('../../../lib/codingCli/codingCliIPC', () => ({
  registerCodingCliIPC: (...args: any[]) => mockRegisterCodingCliIPC(...args),
}));
vi.mock('../../../lib/embeddedBrowser/EmbeddedBrowserManager', () => ({
  initEmbeddedBrowserManager: (...args: any[]) => mockInitEmbeddedBrowserManager(...args),
}));
vi.mock('../../../lib/embeddedBrowser/embeddedBrowserIPC', () => ({
  registerEmbeddedBrowserIPC: vi.fn(),
}));
vi.mock('../../../lib/unifiedLogger', () => {
  const noop = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), updateConfig: vi.fn() });
  return {
    createLogger: (...args: any[]) => (mockCreateLogger as any)(...args),
    createConsoleLogger: vi.fn(noop),
    getUnifiedLogger: vi.fn(noop),
    createHighPerformanceLogger: vi.fn(noop),
    createDebugLogger: vi.fn(noop),
    getRefactoredLogger: vi.fn(noop),
    getGlobalLogger: vi.fn(noop),
    initializeGlobalLogger: vi.fn(noop),
    resetGlobalLogger: vi.fn(),
    isGlobalLoggerInitialized: vi.fn(() => false),
    default: vi.fn(noop),
  };
});
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
  getAdvancedLogger: (...args: any[]) => (mockGetAdvancedLogger as any)(...args),
  useAdvancedLogger: (...args: any[]) => (mockUseAdvancedLogger as any)(...args),
}));
vi.mock('../../../lib/userDataADO/openkosmosPlaceholders', () => ({
  openkosmosPlaceholderManager: {
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
vi.mock('../../../lib/nativeModules', () => ({
  nativeModuleManager: {
    getStatus: (...args: any[]) => mockNativeModuleManager.getStatus(...args),
    ensureDownloaded: (...args: any[]) => mockNativeModuleManager.ensureDownloaded(...args),
    cancelDownload: (...args: any[]) => mockNativeModuleManager.cancelDownload(...args),
    deleteModule: (...args: any[]) => mockNativeModuleManager.deleteModule(...args),
  },
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
    toolBarWindow: null,
    isDev: false,
    isAgentChatReady: true,
    toolBarVisible: false,
    selectedText: 'hello',
    cleanupSelectionHook: vi.fn(),
    onBeforeQuit: vi.fn(),
    registerGlobalShortcuts: vi.fn(),
    getPersistedWindowZoomLevel: vi.fn().mockResolvedValue(1),
    applyWindowZoomLevel: vi.fn(),
    stepWindowZoomLevel: vi.fn(),
    resetWindowZoomLevel: vi.fn().mockResolvedValue(1),
    getMenuTemplate: vi.fn(() => []),
    showToolBar: vi.fn(),
    toggleToolBar: vi.fn(),
    handleWebSearch: vi.fn().mockResolvedValue({ success: true }),
    getToolBarAutoHide: vi.fn(() => false),
    hideToolBar: vi.fn(),
    applyToolBarSettings: vi.fn(),
    unregisterGlobalShortcuts: vi.fn(),
    calculateToolBarPosition: vi.fn(() => ({ x: 0, y: 0 })),
    createDebugWindow: vi.fn().mockResolvedValue(undefined),
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
    ctx = makeCtx();
    setUpIPC(ctx);
  });

  // ── app lifecycle ──────────────────────────────────────────────────────────

  describe('app lifecycle hooks', () => {
    it('registers before-quit and will-quit listeners', () => {
      const channels = mockAppOn.mock.calls.map(([c]: any[]) => c);
      expect(channels).toContain('before-quit');
      expect(channels).toContain('will-quit');
    });

    it('first before-quit calls cleanupSelectionHook', () => {
      const [, handler] = mockAppOn.mock.calls.find(([c, h]: any[]) => c === 'before-quit' && h !== ctx.onBeforeQuit)!;
      handler({});
      expect(ctx.cleanupSelectionHook).toHaveBeenCalled();
    });

    it('before-quit suppresses cleanupSelectionHook errors', () => {
      ctx.cleanupSelectionHook = vi.fn(() => { throw new Error('boom'); });
      const [, handler] = mockAppOn.mock.calls[0];
      expect(() => handler({})).not.toThrow();
    });

    it('will-quit calls cleanupSelectionHook', () => {
      const [, handler] = mockAppOn.mock.calls.find(([c]: any[]) => c === 'will-quit')!;
      handler({});
      expect(ctx.cleanupSelectionHook).toHaveBeenCalled();
    });

    it('will-quit suppresses cleanupSelectionHook errors', () => {
      ctx.cleanupSelectionHook = vi.fn(() => { throw new Error('oops'); });
      const [, handler] = mockAppOn.mock.calls.find(([c]: any[]) => c === 'will-quit')!;
      expect(() => handler({})).not.toThrow();
    });
  });

  // ── openkosmos:replacePlaceholders ─────────────────────────────────────────────

  describe('openkosmos:replacePlaceholders', () => {
    it('returns success with replaced data', async () => {
      const handler = getHandler('openkosmos:replacePlaceholders');
      const result = await handler({}, { KEY: 'val' });
      expect(result).toEqual({ success: true, data: { OPENKOSMOS_FOO: 'bar' } });
    });

    it('returns error when no currentUserAlias', async () => {
      ctx.currentUserAlias = null;
      vi.clearAllMocks();
      setUpIPC(ctx);
      const handler = getHandler('openkosmos:replacePlaceholders');
      const result = await handler({}, {});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/No current user alias/);
    });

    it('returns error on exception', async () => {
      mockReplacePlaceholders.mockImplementationOnce(() => { throw new Error('fail'); });
      const handler = getHandler('openkosmos:replacePlaceholders');
      const result = await handler({}, {});
      expect(result).toEqual({ success: false, error: 'fail' });
    });

    it('returns unknown error for non-Error throws', async () => {
      mockReplacePlaceholders.mockImplementationOnce(() => { throw 'string-error'; });
      const handler = getHandler('openkosmos:replacePlaceholders');
      const result = await handler({}, {});
      expect(result.error).toBe('Unknown error');
    });
  });

  // ── openkosmos:parseUserInputPlaceholders ─────────────────────────────────────

  describe('openkosmos:parseUserInputPlaceholders', () => {
    it('returns success', async () => {
      const handler = getHandler('openkosmos:parseUserInputPlaceholders');
      const result = await handler({}, { tool: 'test' });
      expect(result).toEqual({ success: true, data: { parsed: true } });
    });

    it('returns error on throw', async () => {
      mockParseConfig.mockImplementationOnce(() => { throw new Error('parse fail'); });
      const handler = getHandler('openkosmos:parseUserInputPlaceholders');
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

    it('auto-hides toolbar when configured', async () => {
      ctx.getToolBarAutoHide = vi.fn(() => true);
      const handler = getHandler('mainWindow:showWithAgent');
      await handler({}, 'agent-123');
      expect(ctx.hideToolBar).toHaveBeenCalled();
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

  describe('registered service callbacks', () => {
    it('resolves the current alias and live main window lazily', () => {
      const codingOptions = mockRegisterCodingCliIPC.mock.calls[0][0];
      const browserWindowProvider = mockInitEmbeddedBrowserManager.mock.calls[0][0];
      const syncOptions = mockRegisterSyncIPC.mock.calls[0][0];

      expect(codingOptions.getAlias()).toBe('testuser');
      expect(browserWindowProvider()).toBe(ctx.mainWindow);
      expect(syncOptions.getCurrentAlias()).toBe('testuser');
      ctx.currentUserAlias = '';
      expect(syncOptions.getCurrentAlias()).toBe('default');
    });

    it('passes the advanced logger to the manual flush callback', async () => {
      const advancedLogger = { flushToDisk: vi.fn().mockResolvedValue(undefined) };
      mockUseAdvancedLogger.mockImplementationOnce(async (callback: Function) => callback(advancedLogger));

      await expect(getHandler('logger:manualFlush')({})).resolves.toEqual({ success: true });
      expect(advancedLogger.flushToDisk).toHaveBeenCalled();
    });
  });

  describe('non-Error failure normalization', () => {
    it('normalizes placeholder and builtin-tool failures', async () => {
      mockParseConfig.mockImplementationOnce(() => { throw 'parse failed'; });
      expect(await getHandler('openkosmos:parseUserInputPlaceholders')({}, {}))
        .toEqual({ success: false, error: 'Unknown error' });

      mockBuiltinToolsManager.executeTool.mockRejectedValueOnce('execute failed');
      expect(await getHandler('builtinTools:execute')({}, 'tool', {}))
        .toEqual({ success: false, error: 'Unknown error' });

      mockBuiltinToolsManager.getAllToolsInfo.mockImplementationOnce(() => { throw 'tools failed'; });
      expect(await getHandler('builtinTools:getAllTools')({}))
        .toEqual({ success: false, error: 'Unknown error' });

      mockBuiltinToolsManager.isBuiltinTool.mockImplementationOnce(() => { throw 'check failed'; });
      expect(await getHandler('builtinTools:isBuiltinTool')({}, 'tool'))
        .toEqual({ success: false, error: 'Unknown error' });
    });

    it('normalizes folder, debug-window, and feature-flag failures', async () => {
      mockShellOpenPath.mockRejectedValueOnce('logs failed');
      expect(await getHandler('folder:openLogs')({}))
        .toEqual({ success: false, error: 'Unknown error' });

      mockShellOpenPath.mockRejectedValueOnce('profile failed');
      expect(await getHandler('folder:openProfile')({}, 'testuser'))
        .toEqual({ success: false, error: 'Unknown error' });

      ctx.createDebugWindow.mockRejectedValueOnce('debug failed');
      expect(await getHandler('debug:openWindow')({}))
        .toEqual({ success: false, error: 'Unknown error' });

      mockFeatureFlagManager.getAllFlagsValues.mockImplementationOnce(() => { throw 'flags failed'; });
      expect(await getHandler('featureFlags:getAllFlags')({}))
        .toEqual({ success: false, error: 'Unknown error' });

      mockFeatureFlagManager.isEnabled.mockImplementationOnce(() => { throw 'flag failed'; });
      expect(await getHandler('featureFlags:isEnabled')({}, 'flag'))
        .toEqual({ success: false, error: 'Unknown error' });
    });

    it('normalizes every native-module failure path', async () => {
      mockNativeModuleManager.getStatus.mockImplementationOnce(() => { throw 'status failed'; });
      expect(await getHandler('native-module:getStatus')({}, 'whisper'))
        .toEqual({ success: false, error: 'Unknown error' });

      mockNativeModuleManager.ensureDownloaded.mockRejectedValueOnce('download failed');
      expect(await getHandler('native-module:ensureDownloaded')({}, 'whisper'))
        .toEqual({ success: false, error: 'Unknown error' });

      mockNativeModuleManager.cancelDownload.mockImplementationOnce(() => { throw 'cancel failed'; });
      expect(await getHandler('native-module:cancelDownload')({}, 'whisper'))
        .toEqual({ success: false, error: 'Unknown error' });

      mockNativeModuleManager.deleteModule.mockImplementationOnce(() => { throw 'delete failed'; });
      expect(await getHandler('native-module:delete')({}, 'whisper'))
        .toEqual({ success: false, error: 'Unknown error' });
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

  // ── native-module IPC ──────────────────────────────────────────────────────

  describe('native-module:getStatus', () => {
    it('returns module status', async () => {
      const handler = getHandler('native-module:getStatus');
      const result = await handler({}, 'whisper');
      expect(result).toEqual({ success: true, data: { status: 'ready' } });
    });

    it('returns error on exception', async () => {
      mockNativeModuleManager.getStatus.mockImplementationOnce(() => { throw new Error('status err'); });
      const handler = getHandler('native-module:getStatus');
      const result = await handler({}, 'whisper');
      expect(result.success).toBe(false);
    });
  });

  describe('native-module:ensureDownloaded', () => {
    it('returns local path', async () => {
      const handler = getHandler('native-module:ensureDownloaded');
      const result = await handler({}, 'whisper');
      expect(result).toEqual({ success: true, data: { localPath: '/local/path' } });
    });

    it('returns error on exception', async () => {
      mockNativeModuleManager.ensureDownloaded.mockRejectedValueOnce(new Error('dl err'));
      const handler = getHandler('native-module:ensureDownloaded');
      const result = await handler({}, 'whisper');
      expect(result.success).toBe(false);
    });
  });

  describe('native-module:cancelDownload', () => {
    it('cancels download', async () => {
      const handler = getHandler('native-module:cancelDownload');
      const result = await handler({}, 'whisper');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockNativeModuleManager.cancelDownload.mockImplementationOnce(() => { throw new Error('cancel err'); });
      const handler = getHandler('native-module:cancelDownload');
      const result = await handler({}, 'whisper');
      expect(result.success).toBe(false);
    });
  });

  describe('native-module:delete', () => {
    it('deletes module', async () => {
      const handler = getHandler('native-module:delete');
      const result = await handler({}, 'whisper');
      expect(result.success).toBe(true);
    });

    it('returns error on exception', async () => {
      mockNativeModuleManager.deleteModule.mockImplementationOnce(() => { throw new Error('del err'); });
      const handler = getHandler('native-module:delete');
      const result = await handler({}, 'whisper');
      expect(result.success).toBe(false);
    });
  });

  // ── memex read IPC ─────────────────────────────────────────────────────────

  describe('memex read IPC', () => {
    it('always calls setupMemex with the context (flag-gating is internal)', () => {
      vi.clearAllMocks();
      setUpIPC(ctx);
      expect(mockSetupMemex).toHaveBeenCalledWith(ctx);
    });

    it('calls setupMemex even when the memex flag is disabled', () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      vi.clearAllMocks();
      setUpIPC(ctx);
      expect(mockSetupMemex).toHaveBeenCalledWith(ctx);
    });
  });
});
