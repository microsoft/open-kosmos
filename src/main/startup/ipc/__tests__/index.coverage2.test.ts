// @ts-nocheck
/**
 * index.coverage2.test.ts
 *
 * Additional coverage for setUpIPC targeting branches not covered by index.coverage.test.ts:
 *  - mainWindow:showWithAgent null chatId
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── vi.hoisted ────────────────────────────────────────────────────────────────

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
  mockPromptImportConflictResolution,
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
    mockReplacePlaceholders: vi.fn(() => ({ KEY: 'val' })),
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
    mockPromptImportConflictResolution: vi.fn().mockResolvedValue('skip'),
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

// ─── sub-module handler stubs ──────────────────────────────────────────────────

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
  registerSyncIPC: vi.fn(),
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
vi.mock('../shared', async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    promptImportConflictResolution: (...args: any[]) => (mockPromptImportConflictResolution as any)(...args),
  };
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for channel: "${channel}"`);
  return call[1];
}

function makeMainWindow(opts: { destroyed?: boolean; minimized?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => opts.destroyed ?? false),
    isMinimized: vi.fn(() => opts.minimized ?? false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    getTitle: vi.fn(() => 'Main'),
    getParentWindow: vi.fn(() => null),
    webContents: { send: vi.fn() },
  };
}

function makeEvent(senderUrl = '') {
  return {
    sender: {
      getURL: vi.fn(() => senderUrl),
    },
  } as any;
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
    selectedText: '',
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

describe('setUpIPC — additional coverage (index.coverage2)', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(false);
    mockBuiltinToolsManager.isInitialized = false;
    mockUseAdvancedLogger.mockResolvedValue(undefined);
    mockPromptImportConflictResolution.mockResolvedValue('skip');

    ctx = makeCtx();
    setUpIPC(ctx);
  });

  // ── mainWindow:showWithAgent — no chatId ──────────────────────────────────

  describe('mainWindow:showWithAgent — no chatId', () => {
    it('handles empty chatId (no pseudo-agent prefix, shows window)', async () => {
      const handler = getHandler('mainWindow:showWithAgent');
      const result = await handler({}, '');
      // Empty string goes to mainWindow path (not pseudo-agent), shows window
      expect(result.success).toBe(true);
    });
  });

});
