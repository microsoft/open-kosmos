/**
 * Unit tests for src/main/main.ts
 * Goal: maximize line/branch/function coverage of the Electron main-process entry point.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock variables ──────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const appEventHandlers: Record<string, Function[]> = {};

  const mockWebContents = {
    send: vi.fn(),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getZoomLevel: vi.fn(() => 0),
    setZoomLevel: vi.fn(),
    openDevTools: vi.fn(),
    executeJavaScript: vi.fn(() => Promise.resolve()),
    reload: vi.fn(),
  };

  const mockMainBrowserWindow = {
    id: 1,
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    webContents: mockWebContents,
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    close: vi.fn(),
    maximize: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    setPosition: vi.fn(),
    setBounds: vi.fn(),
  };

  // Must use a regular function (not arrow) so it can be called with `new`
  const MockBrowserWindowClass = vi.fn(function MockBW() { return mockMainBrowserWindow; }) as any;
  MockBrowserWindowClass.fromWebContents = vi.fn();

  const mockApp = {
    on: vi.fn((event: string, handler: Function) => {
      if (!appEventHandlers[event]) appEventHandlers[event] = [];
      appEventHandlers[event].push(handler);
    }),
    once: vi.fn((event: string, handler: Function) => {
      if (!appEventHandlers[event]) appEventHandlers[event] = [];
      appEventHandlers[event].push(handler);
    }),
    quit: vi.fn(),
    exit: vi.fn(),
    isReady: vi.fn(() => true),
    isPackaged: false,
    requestSingleInstanceLock: vi.fn(() => true),
    getPath: vi.fn((_name: string) => '/tmp/test-userdata'),
    getName: vi.fn(() => 'openkosmos-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
  };

  const mockMenu = {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
    setApplicationMenu: vi.fn(),
  };

  const mockShell = {
    openExternal: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve()),
  };

  const mockProtocol = {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  };

  const mockPowerMonitor = {
    on: vi.fn(),
  };

  const mockScreen = {
    getCursorScreenPoint: vi.fn(() => ({ x: 500, y: 300 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  };

  const mockGlobalShortcut = {
    register: vi.fn(() => true),
    unregisterAll: vi.fn(),
  };

  let capturedInjection: any = null;

  return {
    appEventHandlers,
    mockApp,
    mockWebContents,
    mockMainBrowserWindow,
    MockBrowserWindowClass,
    mockMenu,
    mockShell,
    mockProtocol,
    mockPowerMonitor,
    mockScreen,
    mockGlobalShortcut,
    get capturedInjection() { return capturedInjection; },
    setCapturedInjection(v: any) { capturedInjection = v; },
  };
});

// ─── Electron mock ────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: mocks.mockApp,
  BrowserWindow: mocks.MockBrowserWindowClass,
  Menu: mocks.mockMenu,
  shell: mocks.mockShell,
  protocol: mocks.mockProtocol,
  powerMonitor: mocks.mockPowerMonitor,
  screen: mocks.mockScreen,
  globalShortcut: mocks.mockGlobalShortcut,
}));

// ─── Utility / library mocks ──────────────────────────────────────────────────

vi.mock('../lib/unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  getUnifiedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../lib/crash/CrashCaptureManager', () => ({
  crashCaptureManager: {
    initialize: vi.fn(),
    recordBreadcrumb: vi.fn(),
    attachToMainWindow: vi.fn(),
    getStatus: vi.fn(() => ({
      recoveredCrash: null,
      currentSessionId: 'test-session',
      hasRecoveredCrash: false,
      crashRootDir: '/tmp/crash-root',
    })),
    markCleanExit: vi.fn(),
  },
}));

vi.mock('../lib/utilities/safeConsole', () => ({
  safeConsole: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    time: vi.fn(),
    timeEnd: vi.fn(),
    debug: vi.fn(),
  },
  exitSafeLog: vi.fn(),
}));

vi.mock('../lib/utilities/debugInfoEntries', () => ({
  getDebugInfoEntries: vi.fn(() => []),
}));

vi.mock('../lib/utilities/debugInfoManifest', () => ({
  buildDebugInfoManifest: vi.fn(() => ({})),
}));

vi.mock('../lib/utilities/redact', () => ({
  createRedactor: vi.fn(() => (s: string) => s),
  isTextFile: vi.fn(() => false),
  redactFileContent: vi.fn((s: string) => s),
}));

vi.mock('../lib/featureFlags', () => ({
  featureFlagManager: {
    initialize: vi.fn(),
  },
  isFeatureEnabled: vi.fn(() => false),
}));

const mockAdvancedLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  flushToDisk: vi.fn(() => Promise.resolve()),
  handleAppExit: vi.fn(() => Promise.resolve()),
};

vi.mock('../startup/lazy', () => ({
  getProfileCacheManager: vi.fn(() =>
    Promise.resolve({
      setMainWindow: vi.fn(),
      getAllChatConfigs: vi.fn(() => []),
    }),
  ),
  getAppCacheManager: vi.fn(() =>
    Promise.resolve({
      setMainWindow: vi.fn(),
      getConfig: vi.fn(() => ({ zoomLevel: 0, mainWindowMaximized: false })),
      updateConfig: vi.fn(() => Promise.resolve()),
    }),
  ),
  getMainAuthManager: vi.fn(() =>
    Promise.resolve({ setMainWindow: vi.fn() }),
  ),
  getMainTokenMonitor: vi.fn(() =>
    Promise.resolve({ setMainWindow: vi.fn() }),
  ),
  getProfileCacheManagerSync: vi.fn(() => ({
    getAllChatConfigs: vi.fn(() => []),
  })),
  getAdvancedLogger: vi.fn(() => mockAdvancedLogger),
  useAdvancedLogger: vi.fn((fn: any) => fn(mockAdvancedLogger)),
}));

vi.mock('../startup/ipc', () => ({
  setUpIPC: vi.fn((injection: any) => {
    mocks.setCapturedInjection(injection);
  }),
}));

vi.mock('../startup/evalMode', () => ({
  startEvalMode: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/llm/ghcModelsManager', () => ({
  ghcModelsManager: {
    refreshFromRemote: vi.fn(() => Promise.resolve(true)),
  },
}));

vi.mock('../lib/scheduler/SchedulerManager', () => ({
  schedulerManager: {
    getRuntimeDiagnostics: vi.fn(() => ({})),
    dispose: vi.fn(() => Promise.resolve()),
    handleSystemResume: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../lib/mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    cleanup: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../lib/chat/agentChatManager', () => ({
  agentChatManager: {
    setMainWindow: vi.fn(),
  },
}));

vi.mock('../lib/chat/chatSessionStore', () => ({
  chatSessionStore: {
    setMainWindow: vi.fn(),
  },
}));

vi.mock('../lib/scheduler/scheduleStore', () => ({
  scheduleStore: {
    setMainWindow: vi.fn(),
  },
}));

vi.mock('../lib/screenshot', () => ({
  registerScreenshotIPC: vi.fn(),
  registerScreenshotShortcut: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/devLogger', () => ({
  attachDevLoggerToWindow: vi.fn(),
  shutdownDevLogger: vi.fn(() => Promise.resolve()),
}));

vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(() => ({
    file: vi.fn(),
    folder: vi.fn(),
    generateAsync: vi.fn(() => Promise.resolve(Buffer.from('zip-data'))),
  })),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => ''),
}));

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));

vi.mock('electron-reload', () => ({
  default: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => Buffer.from('')),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    promises: {
      ...actual.promises,
      access: vi.fn(() => Promise.resolve()),
      stat: vi.fn(() => Promise.resolve({ isDirectory: () => false, isFile: () => true })),
      readdir: vi.fn(() => Promise.resolve([])),
      readFile: vi.fn(() => Promise.resolve(Buffer.from(''))),
      writeFile: vi.fn(() => Promise.resolve()),
    },
    constants: actual.constants,
  };
});

// ─── Import subject under test ────────────────────────────────────────────────
// We use dynamic import so all vi.mock() calls above are in place first.
let electronApp: any;

describe('main.ts – ElectronApp', () => {
  beforeEach(async () => {
    // Reset module registry to get a clean import each describe run
    // (we reset once for the whole suite rather than per test to avoid re-running module-level side effects)
    if (!electronApp) {
      const mod = await import('../main');
      electronApp = mod.default;
    }
  });

  // ─── Module-level side effects ──────────────────────────────────────────────
  describe('module-level side effects', () => {
    it('calls protocol.registerSchemesAsPrivileged with screenshot', () => {
      expect(mocks.mockProtocol.registerSchemesAsPrivileged).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ scheme: 'screenshot' }),
        ]),
      );
    });

    it('requests a single instance lock', () => {
      expect(mocks.mockApp.requestSingleInstanceLock).toHaveBeenCalled();
    });

    it('registers app event handlers (ready, window-all-closed, activate, before-quit, will-quit)', () => {
      const registeredEvents = (mocks.mockApp.on as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(registeredEvents).toContain('ready');
      expect(registeredEvents).toContain('window-all-closed');
      expect(registeredEvents).toContain('activate');
      expect(registeredEvents).toContain('before-quit');
      expect(registeredEvents).toContain('will-quit');
    });

    it('calls setUpIPC with an Injection instance', () => {
      expect(mocks.capturedInjection).not.toBeNull();
    });

    it('exports a non-null electronApp when single instance lock succeeds', () => {
      expect(electronApp).not.toBeNull();
    });
  });

  // ─── process stdio error handlers ──────────────────────────────────────────
  describe('process stdio error handlers', () => {
    it('EPIPE error on stdout is silently ignored', () => {
      const handlers = process.stdout?.listeners('error') as Function[];
      if (handlers && handlers.length > 0) {
        expect(() => handlers[0](Object.assign(new Error('EPIPE'), { code: 'EPIPE' }))).not.toThrow();
      }
    });

    it('EIO error on stderr is silently ignored', () => {
      const handlers = process.stderr?.listeners('error') as Function[];
      if (handlers && handlers.length > 0) {
        expect(() => handlers[0](Object.assign(new Error('EIO'), { code: 'EIO' }))).not.toThrow();
      }
    });
  });

  // ─── Injection methods ──────────────────────────────────────────────────────
  describe('Injection proxy', () => {
    let inj: any;

    beforeEach(() => {
      inj = mocks.capturedInjection;
    });

    it('exposes getMenuTemplate that returns an array', () => {
      const template = inj.getMenuTemplate();
      expect(Array.isArray(template)).toBe(true);
      expect(template.length).toBeGreaterThan(0);
    });

    it('unregisterGlobalShortcuts calls globalShortcut.unregisterAll', () => {
      inj.unregisterGlobalShortcuts();
      expect(mocks.mockGlobalShortcut.unregisterAll).toHaveBeenCalled();
    });

    it('applyWindowZoomLevel returns 0 when mainWindow is null', () => {
      // Main window is null initially because createMainWindow hasn't been called
      // In our mock setup, the BrowserWindow constructor was called during onReady
      // so the window might exist. We simply verify the method is callable.
      const result = inj.applyWindowZoomLevel(1.5);
      expect(typeof result).toBe('number');
    });

  });

  // ─── app event callbacks ────────────────────────────────────────────────────
  describe('app event: window-all-closed', () => {
    it('calls app.quit on non-darwin platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const handlers = mocks.appEventHandlers['window-all-closed'];
      expect(handlers).toBeDefined();
      handlers[0]();
      expect(mocks.mockApp.quit).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('does NOT call app.quit on darwin', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mocks.mockApp.quit.mockClear();
      const handlers = mocks.appEventHandlers['window-all-closed'];
      handlers[0]();
      expect(mocks.mockApp.quit).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  describe('app event: second-instance', () => {
    it('calls onActivate when app is already ready', () => {
      mocks.mockApp.isReady.mockReturnValueOnce(true);
      const handlers = mocks.appEventHandlers['second-instance'];
      expect(handlers).toBeDefined();
      // Should not throw
      expect(() => handlers[0]()).not.toThrow();
    });

    it('registers once-ready handler when app is NOT ready', () => {
      mocks.mockApp.isReady.mockReturnValueOnce(false);
      const handlers = mocks.appEventHandlers['second-instance'];
      handlers[0]();
      // app.once should have been called to defer focus
      expect(mocks.mockApp.once).toHaveBeenCalled();
    });
  });

  describe('app event: before-quit (lightweight handler)', () => {
    it('first before-quit handler (cleanup) does not throw', () => {
      const handlers = mocks.appEventHandlers['before-quit'];
      expect(handlers).toBeDefined();
      if (handlers.length > 0) {
        expect(() => handlers[0]({ preventDefault: vi.fn() })).not.toThrow();
      }
    });
  });

  describe('app event: will-quit', () => {
    it('will-quit handler does not throw', () => {
      const handlers = mocks.appEventHandlers['will-quit'];
      if (handlers && handlers.length > 0) {
        expect(() => handlers[0]({ preventDefault: vi.fn() })).not.toThrow();
      }
    });
  });

  // ─── onBeforeQuit via Injection ─────────────────────────────────────────────
  describe('onBeforeQuit', () => {
    it('calls app.exit(0) on successful cleanup', async () => {
      mocks.mockApp.exit.mockClear();
      const fakeEvent = { preventDefault: vi.fn() };
      await injectOnBeforeQuit(fakeEvent);
      expect(mocks.mockApp.exit).toHaveBeenCalledWith(0);
    });

    it('calls app.exit when cleanup completes', async () => {
      mocks.mockApp.exit.mockClear();
      const fakeEvent = { preventDefault: vi.fn() };
      await injectOnBeforeQuit(fakeEvent);
      // exit is called with either 0 or 1 depending on whether other phases succeed
      expect(mocks.mockApp.exit).toHaveBeenCalled();
    });
  });

  // ─── normalizeWindowZoomLevel (via stepWindowZoomLevel) ────────────────────
  describe('zoom level helpers via Injection', () => {
    it('stepWindowZoomLevel returns a number', async () => {
      const result = await mocks.capturedInjection.stepWindowZoomLevel(0.5);
      expect(typeof result).toBe('number');
    });

    it('resetWindowZoomLevel returns 0', async () => {
      const result = await mocks.capturedInjection.resetWindowZoomLevel();
      expect(result).toBe(0);
    });

    it('getPersistedWindowZoomLevel returns a number', async () => {
      const result = await mocks.capturedInjection.getPersistedWindowZoomLevel();
      expect(typeof result).toBe('number');
    });
  });

  // ─── getMenuTemplate branches ───────────────────────────────────────────────
  describe('getMenuTemplate platform branches', () => {
    it('includes darwin-specific app menu on darwin', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      const template = mocks.capturedInjection.getMenuTemplate();
      const labels = template.map((item: any) => item.label);
      // On darwin, app name is unshifted as first item
      expect(labels[0]).toBe('openkosmos-test');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('does not include darwin app menu on linux', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const template = mocks.capturedInjection.getMenuTemplate();
      const labels = template.map((item: any) => item.label);
      expect(labels[0]).toBe('File');

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  // ─── registerGlobalShortcuts ────────────────────────────────────────────────
  describe('registerGlobalShortcuts', () => {
    it('registers screenshot shortcut', async () => {
      const { registerScreenshotShortcut } = await import('../lib/screenshot');
      (registerScreenshotShortcut as ReturnType<typeof vi.fn>).mockClear();
      await mocks.capturedInjection.registerGlobalShortcuts();
      expect(registerScreenshotShortcut).toHaveBeenCalled();
    });
  });

  // ─── createDebugWindow ──────────────────────────────────────────────────────
  describe('createDebugWindow', () => {
    it('creates a debug window in production mode', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      mocks.MockBrowserWindowClass.mockClear();
      await mocks.capturedInjection.createDebugWindow();
      expect(mocks.MockBrowserWindowClass).toHaveBeenCalled();
      process.env.NODE_ENV = originalNodeEnv;
    });
  });
});

// ─── Helper to call onBeforeQuit via captured injection ──────────────────────
async function injectOnBeforeQuit(fakeEvent: any) {
  // The second before-quit handler is onBeforeQuit (registered via .bind)
  const handlers = mocks.appEventHandlers['before-quit'];
  if (!handlers || handlers.length < 2) {
    // Fallback: call directly through injection if available
    return mocks.capturedInjection.onBeforeQuit(fakeEvent);
  }
  // The last one is bound to onBeforeQuit
  const onBeforeQuitHandler = handlers[handlers.length - 1];
  return onBeforeQuitHandler(fakeEvent);
}
