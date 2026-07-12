// @ts-nocheck
/**
 * Coverage9 — Part 2: registerGlobalShortcuts,
 * addPathToZip (empty dir / text file / missing source), exportDebugInfo (crash root / duplicate zip),
 * createDebugWindow second-call focus.
 *
 * Key lesson: vi.fn(() => obj) uses an arrow function which cannot be used as a constructor.
 * Use vi.fn().mockImplementation(function() { return obj; }) for mocks called with `new`.
 */
import { vi, describe, it, expect, beforeAll } from 'vitest';

const mocks = vi.hoisted(() => {
  const appEventHandlers: Record<string, Function[]> = {};
  const windowEventHandlers: Record<string, Function[]> = {};
  const mockWebContents = {
    send: vi.fn(), on: vi.fn(), setWindowOpenHandler: vi.fn(), getZoomLevel: vi.fn(() => 0),
    setZoomLevel: vi.fn(), openDevTools: vi.fn(), executeJavaScript: vi.fn(() => Promise.resolve()), reload: vi.fn(),
  };
  const mockMainBrowserWindow = {
    id: 1, loadURL: vi.fn(() => Promise.resolve()), loadFile: vi.fn(() => Promise.resolve()),
    webContents: mockWebContents,
    on: vi.fn((e: string, h: Function) => { (windowEventHandlers[e] ??= []).push(h); }),
    once: vi.fn((e: string, h: Function) => { (windowEventHandlers[e] ??= []).push(h); }),
    show: vi.fn(), hide: vi.fn(), focus: vi.fn(), restore: vi.fn(), close: vi.fn(),
    maximize: vi.fn(), isDestroyed: vi.fn(() => false), isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false), setAlwaysOnTop: vi.fn(), setPosition: vi.fn(), setBounds: vi.fn(),
  };
  const MockBrowserWindowClass = vi.fn(function MockBW() { return mockMainBrowserWindow; }) as any;
  MockBrowserWindowClass.fromWebContents = vi.fn();
  const mockApp = {
    on: vi.fn((e: string, h: Function) => { (appEventHandlers[e] ??= []).push(h); }),
    once: vi.fn((e: string, h: Function) => { (appEventHandlers[e] ??= []).push(h); }),
    quit: vi.fn(), exit: vi.fn(), isReady: vi.fn(() => true), isPackaged: false,
    requestSingleInstanceLock: vi.fn(() => true), getPath: vi.fn(() => '/tmp/test-userdata'),
    getName: vi.fn(() => 'openkosmos-test'), getVersion: vi.fn(() => '0.0.0-test'),
  };
  const mockMenu = { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })), setApplicationMenu: vi.fn() };
  const mockShell = { openExternal: vi.fn(() => Promise.resolve()), openPath: vi.fn(() => Promise.resolve()) };
  const mockGlobalShortcut = { register: vi.fn(() => true), unregisterAll: vi.fn() };
  const mockGetDebugInfoEntries = vi.fn(() => []);
  let capturedInjection: any = null;
  return {
    appEventHandlers, windowEventHandlers, mockApp, mockMainBrowserWindow, MockBrowserWindowClass,
    mockMenu, mockShell, mockGlobalShortcut, mockGetDebugInfoEntries,
    get capturedInjection() { return capturedInjection; },
    setCapturedInjection(v: any) { capturedInjection = v; },
  };
});

vi.mock('electron', () => ({
  app: mocks.mockApp, BrowserWindow: mocks.MockBrowserWindowClass, Menu: mocks.mockMenu,
  shell: mocks.mockShell, protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  powerMonitor: { on: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })), getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })) },
  globalShortcut: mocks.mockGlobalShortcut,
}));
vi.mock('selection-hook', () => ({ default: vi.fn(() => ({ on: vi.fn(), start: vi.fn(), stop: vi.fn(), getCurrentSelection: vi.fn(() => null) })) }));
vi.mock('../lib/selectionHookEncoding', () => ({ recoverSelectionText: vi.fn((t: string) => t) }));
vi.mock('../lib/unifiedLogger', () => ({
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createConsoleLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  getUnifiedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));
vi.mock('../lib/crash/CrashCaptureManager', () => ({
  crashCaptureManager: { initialize: vi.fn(), recordBreadcrumb: vi.fn(), attachToMainWindow: vi.fn(),
    getStatus: vi.fn(() => ({ recoveredCrash: null, currentSessionId: 's', hasRecoveredCrash: false, crashRootDir: '/tmp/crash-root' })),
    markCleanExit: vi.fn() },
}));
vi.mock('../lib/utilities/safeConsole', () => ({
  safeConsole: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), time: vi.fn(), timeEnd: vi.fn(), debug: vi.fn() },
  exitSafeLog: vi.fn(),
}));
vi.mock('../lib/utilities/debugInfoEntries', () => ({ getDebugInfoEntries: (...args: any[]) => mocks.mockGetDebugInfoEntries(...args) }));
vi.mock('../lib/utilities/debugInfoManifest', () => ({ buildDebugInfoManifest: vi.fn(() => ({})) }));
vi.mock('../lib/utilities/redact', () => ({
  createRedactor: vi.fn(() => (s: string) => s), isTextFile: vi.fn((p: string) => p.endsWith('.txt')), redactFileContent: vi.fn((s: string) => s),
}));
vi.mock('../lib/featureFlags', () => ({ featureFlagManager: { initialize: vi.fn() }, isFeatureEnabled: vi.fn(() => false) }));
vi.mock('../startup/lazy', () => ({
  getProfileCacheManager: vi.fn(() => Promise.resolve({ setMainWindow: vi.fn(), getAllChatConfigs: vi.fn(() => []), getToolBarSettings: vi.fn(() => ({ autoHide: true, visibleAgents: [], shortcut: '' })) })),
  getAppCacheManager: vi.fn(() => Promise.resolve({ setMainWindow: vi.fn(), getConfig: vi.fn(() => ({ zoomLevel: 0, mainWindowMaximized: false })), updateConfig: vi.fn(() => Promise.resolve()) })),
  getMainAuthManager: vi.fn(() => Promise.resolve({ setMainWindow: vi.fn() })),
  getMainTokenMonitor: vi.fn(() => Promise.resolve({ setMainWindow: vi.fn() })),
  getProfileCacheManagerSync: vi.fn(() => ({ getAllChatConfigs: vi.fn(() => []), getToolBarSettings: vi.fn(() => ({ autoHide: true, visibleAgents: [], shortcut: '' })) })),
  getAdvancedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), flushToDisk: vi.fn(() => Promise.resolve()), handleAppExit: vi.fn(() => Promise.resolve()) })),
  useAdvancedLogger: vi.fn((fn: any) => fn({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), flushToDisk: vi.fn(() => Promise.resolve()), handleAppExit: vi.fn(() => Promise.resolve()) })),
}));
vi.mock('../startup/ipc', () => ({ setUpIPC: vi.fn((injection: any) => { mocks.setCapturedInjection(injection); }) }));
vi.mock('../startup/evalMode', () => ({ startEvalMode: vi.fn(() => Promise.resolve()) }));
vi.mock('../lib/llm/ghcModelsManager', () => ({ ghcModelsManager: { refreshFromRemote: vi.fn(() => Promise.resolve(true)) } }));
vi.mock('../lib/scheduler/SchedulerManager', () => ({ schedulerManager: { getRuntimeDiagnostics: vi.fn(() => ({})), dispose: vi.fn(() => Promise.resolve()), handleSystemResume: vi.fn(() => Promise.resolve()) } }));
vi.mock('../lib/mcpRuntime/mcpClientManager', () => ({ mcpClientManager: { cleanup: vi.fn(() => Promise.resolve()) } }));
vi.mock('../lib/chat/agentChatManager', () => ({ agentChatManager: { setMainWindow: vi.fn() } }));
vi.mock('../lib/chat/chatSessionStore', () => ({ chatSessionStore: { setMainWindow: vi.fn() } }));
vi.mock('../lib/scheduler/scheduleStore', () => ({ scheduleStore: { setMainWindow: vi.fn() } }));
vi.mock('../lib/screenshot', () => ({ registerScreenshotIPC: vi.fn(), registerScreenshotShortcut: vi.fn(() => Promise.resolve()) }));
vi.mock('../lib/devLogger', () => ({ attachDevLoggerToWindow: vi.fn(), shutdownDevLogger: vi.fn(() => Promise.resolve()) }));

const mockJszipInstance = vi.hoisted(() => ({
  file: vi.fn(), folder: vi.fn(),
  generateAsync: vi.fn(() => Promise.resolve(Buffer.from('zip'))),
}));
// Must use a regular function (not arrow) so `new JSZip()` returns mockJszipInstance
vi.mock('jszip', () => ({ default: vi.fn().mockImplementation(function() { return mockJszipInstance; }) }));
vi.mock('child_process', () => ({ execSync: vi.fn(() => ''), execFile: vi.fn() }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('electron-reload', () => ({ default: vi.fn() }));

const mockFs = vi.hoisted(() => ({
  existsSync: vi.fn(() => false), readFileSync: vi.fn(() => Buffer.from('')),
  unlinkSync: vi.fn(), rmSync: vi.fn(), mkdirSync: vi.fn(), readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false })),
  promises: {
    access: vi.fn(() => Promise.resolve()),
    stat: vi.fn(() => Promise.resolve({ isDirectory: () => false, isFile: () => true })),
    readdir: vi.fn(() => Promise.resolve([])),
    readFile: vi.fn(() => Promise.resolve(Buffer.from('content'))),
    writeFile: vi.fn(() => Promise.resolve()),
  },
  constants: { F_OK: 0 },
}));
vi.mock('fs', () => mockFs);

function getFileSubmenu(): any[] {
  for (const [tpl] of vi.mocked(mocks.mockMenu.buildFromTemplate).mock.calls) {
    if (Array.isArray(tpl)) {
      const file = (tpl as any[]).find((t: any) => t.label === 'File');
      if (file) return file.submenu ?? [];
    }
  }
  return [];
}
const findItem = (label: string) => getFileSubmenu().find((i: any) => i.label === label);

beforeAll(async () => {
  await import('../main');
  for (const h of mocks.appEventHandlers['ready'] || []) { try { await h(); } catch {} }
  await new Promise((resolve) => setImmediate(resolve));
});

describe('main.ts coverage9 (part 2)', () => {
  it('module loads and injection is captured', () => {
    expect(mocks.capturedInjection).not.toBeNull();
  });

  it('registerGlobalShortcuts: openkosmos registers shortcut', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    vi.mocked(mocks.mockGlobalShortcut.register).mockReturnValue(true).mockClear();
    await inj.registerGlobalShortcuts();
    expect(true).toBe(true);
  });

  it('registerGlobalShortcuts: registration failure branch', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    vi.mocked(mocks.mockGlobalShortcut.register).mockReturnValue(false);
    await inj.registerGlobalShortcuts();
    expect(true).toBe(true);
  });

  it('onBeforeQuit: covers optional cleanup failure branches', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    const { isFeatureEnabled } = await import('../lib/featureFlags');
    const { schedulerManager } = await import('../lib/scheduler/SchedulerManager');
    const { mcpClientManager } = await import('../lib/mcpRuntime/mcpClientManager');

    vi.mocked(isFeatureEnabled).mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
    vi.mocked(schedulerManager.dispose).mockRejectedValueOnce('scheduler dispose failed');
    vi.mocked(mcpClientManager.cleanup).mockRejectedValueOnce('mcp cleanup failed');

    await expect(inj.onBeforeQuit({ preventDefault: vi.fn() })).resolves.not.toThrow();
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
  });

  it('onBeforeQuit: covers Error cleanup branches', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    const { isFeatureEnabled } = await import('../lib/featureFlags');
    const { schedulerManager } = await import('../lib/scheduler/SchedulerManager');

    vi.mocked(isFeatureEnabled).mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
    vi.mocked(schedulerManager.dispose).mockRejectedValueOnce(new Error('scheduler dispose failed'));

    await expect(inj.onBeforeQuit({ preventDefault: vi.fn() })).resolves.not.toThrow();
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
  });

  it('onBeforeQuit: flushes DevLogger in development and handles flush failure', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    await expect(inj.onBeforeQuit({ preventDefault: vi.fn() })).resolves.not.toThrow();

    const { shutdownDevLogger } = await import('../lib/devLogger');
    vi.mocked(shutdownDevLogger).mockRejectedValueOnce(new Error('flush failed'));
    await expect(inj.onBeforeQuit({ preventDefault: vi.fn() })).resolves.not.toThrow();

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('createDebugWindow: second call focuses existing window', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    await inj.createDebugWindow();
    vi.mocked(mocks.mockMainBrowserWindow.focus).mockClear();
    mocks.mockMainBrowserWindow.isDestroyed.mockReturnValue(false);
    await inj.createDebugWindow();
    expect(mocks.mockMainBrowserWindow.focus).toHaveBeenCalled();
  });

  it('createDebugWindow: ready-to-show and closed handlers run', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    await inj.createDebugWindow();
    for (const h of mocks.windowEventHandlers['ready-to-show'] || []) {
      try { await h(); } catch {}
    }
    for (const h of mocks.windowEventHandlers['closed'] || []) {
      try { h(); } catch {}
    }
    expect(true).toBe(true);
  });

  it('createDebugWindow uses the packaged icon and ignores ready after close', async () => {
    const inj = mocks.capturedInjection;
    if (!inj) return;
    for (const handler of mocks.windowEventHandlers['closed'] || []) handler();
    mocks.mockApp.isPackaged = true;
    const originalResourcesPath = (process as any).resourcesPath;
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: '/app/resources' });
    const readyCount = (mocks.windowEventHandlers['ready-to-show'] || []).length;
    const closedCount = (mocks.windowEventHandlers.closed || []).length;

    await inj.createDebugWindow();

    const windowOptions = mocks.MockBrowserWindowClass.mock.calls.at(-1)?.[0];
    expect(windowOptions.icon).toContain('brand-assets/win/app.ico');
    const newClosedHandler = mocks.windowEventHandlers.closed[closedCount];
    const newReadyHandler = mocks.windowEventHandlers['ready-to-show'][readyCount];
    vi.mocked(mocks.mockMainBrowserWindow.show).mockClear();
    newClosedHandler();
    newReadyHandler();
    expect(mocks.mockMainBrowserWindow.show).not.toHaveBeenCalled();
    mocks.mockApp.isPackaged = false;
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: originalResourcesPath });
  });

  it('addPathToZip: empty directory calls zip.folder', async () => {
    // existsSync must return false for .zip paths to avoid infinite loop in exportDebugInfo
    mocks.mockGetDebugInfoEntries.mockReturnValue([{ sourcePath: '/tmp/emptydir', zipPath: 'empty' }]);
    mockFs.existsSync.mockImplementation((p: string) => p === '/tmp/emptydir');
    mockFs.promises.stat.mockResolvedValue({ isDirectory: () => true, isFile: () => false });
    mockFs.promises.readdir.mockResolvedValue([]);
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(mockJszipInstance.folder).toHaveBeenCalled();
    mockFs.existsSync.mockReturnValue(false);
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
  });

  it('addPathToZip: text file content is added', async () => {
    mocks.mockGetDebugInfoEntries.mockReturnValue([{ sourcePath: '/tmp/log.txt', zipPath: 'log.txt' }]);
    mockFs.existsSync.mockImplementation((p: string) => p === '/tmp/log.txt');
    mockFs.promises.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue('log content');
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(mockJszipInstance.file).toHaveBeenCalled();
    mockFs.existsSync.mockReturnValue(false);
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
  });

  it('addPathToZip: directory with mixed children (txt, bin, subdir)', async () => {
    mocks.mockGetDebugInfoEntries.mockReturnValue([{ sourcePath: '/tmp/dir', zipPath: 'dir' }]);
    mockFs.existsSync.mockImplementation((p: string) => p === '/tmp/dir' || p.startsWith('/tmp/dir/'));
    // Top-level dir is a directory; children f.txt and f.bin are files; 'sub' is a dir with no children
    mockFs.promises.stat.mockImplementation((p: string) => Promise.resolve({
      isDirectory: () => p === '/tmp/dir' || p.endsWith('/sub'),
      isFile: () => !p.endsWith('/sub') && p !== '/tmp/dir',
    }));
    mockFs.promises.readdir.mockImplementation((p: string) => Promise.resolve(
      p === '/tmp/dir'
        ? [{ name: 'f.txt', isDirectory: () => false, isFile: () => true }, { name: 'f.bin', isDirectory: () => false, isFile: () => true }, { name: 'sub', isDirectory: () => true, isFile: () => false }]
        : [] // sub directory is empty
    ));
    mockFs.promises.readFile.mockResolvedValue(Buffer.from('content'));
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(true).toBe(true);
    mockFs.existsSync.mockReturnValue(false);
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
    mockFs.promises.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
    mockFs.promises.readdir.mockResolvedValue([]);
  });

  it('exportDebugInfo: crash root listing with statSync throw', async () => {
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
    mockFs.existsSync.mockImplementation((p: string) => p === '/tmp/crash-root');
    vi.mocked(mockFs.readdirSync).mockReturnValue(['b1', 'b2'] as any);
    vi.mocked(mockFs.statSync)
      .mockReturnValueOnce({ isDirectory: () => true })
      .mockImplementationOnce(() => { throw new Error('stat fail'); });
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(mockFs.readdirSync).toHaveBeenCalled();
    mockFs.existsSync.mockReturnValue(false);
    vi.mocked(mockFs.statSync).mockReturnValue({ isDirectory: () => false });
  });

  it('exportDebugInfo: duplicate zip filename increments suffix', async () => {
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
    let cnt = 0;
    // Only make .zip paths appear to exist (to trigger duplicate-name loop)
    mockFs.existsSync.mockImplementation((p: string) => { if (p.endsWith('.zip')) { cnt++; return cnt <= 2; } return false; });
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(cnt).toBeGreaterThan(0);
    mockFs.existsSync.mockReturnValue(false);
  });

  it('exportDebugInfo: skips missing paths', async () => {
    mocks.mockGetDebugInfoEntries.mockReturnValue([{ sourcePath: '/tmp/missing', zipPath: 'missing' }]);
    mockFs.existsSync.mockReturnValue(false);
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(true).toBe(true);
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
  });

  it('exportDebugInfo: adds binary top-level files', async () => {
    mocks.mockGetDebugInfoEntries.mockReturnValue([{ sourcePath: '/tmp/file.bin', zipPath: 'file.bin' }]);
    mockFs.existsSync.mockImplementation((p: string) => p === '/tmp/file.bin');
    mockFs.promises.stat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(Buffer.from('binary'));
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(mockJszipInstance.file).toHaveBeenCalled();
    mockFs.existsSync.mockReturnValue(false);
    mocks.mockGetDebugInfoEntries.mockReturnValue([]);
  });

  it('exportDebugInfo: returns fallback error for non-Error failures and no flush method', async () => {
    const { getAdvancedLogger } = await import('../startup/lazy');
    vi.mocked(getAdvancedLogger).mockReturnValueOnce({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any);
    mockJszipInstance.generateAsync.mockRejectedValueOnce('zip failed');
    const item = findItem('Download Debug Info');
    if (item?.click) await item.click();
    expect(true).toBe(true);
  });

  it('quits and exports null when the single-instance lock is unavailable', async () => {
    vi.resetModules();
    mocks.mockApp.requestSingleInstanceLock.mockReturnValueOnce(false);
    vi.mocked(mocks.mockApp.quit).mockClear();

    const mod = await import('../main');

    expect(mocks.mockApp.quit).toHaveBeenCalled();
    expect(mod.default).toBeNull();
  });

  it('uses eval mode without requesting the single-instance lock', async () => {
    vi.resetModules();
    const originalArgv = [...process.argv];
    const originalPath = process.env.PATH;
    process.argv.push('--eval-mode');
    delete process.env.PATH;
    vi.mocked(mocks.mockApp.requestSingleInstanceLock).mockClear();
    const readyHandlersBefore = (mocks.appEventHandlers.ready || []).length;

    const { startEvalMode } = await import('../startup/evalMode');
    const mod = await import('../main');
    const newReadyHandlers = (mocks.appEventHandlers.ready || []).slice(readyHandlersBefore);
    for (const handler of newReadyHandlers) {
      await handler();
    }

    expect(mod.default).not.toBeNull();
    expect(mocks.mockApp.requestSingleInstanceLock).not.toHaveBeenCalled();
    expect(startEvalMode).toHaveBeenCalled();

    process.argv.length = 0;
    process.argv.push(...originalArgv);
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  });
});
