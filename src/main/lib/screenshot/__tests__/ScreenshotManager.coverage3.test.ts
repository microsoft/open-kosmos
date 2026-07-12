import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBrowserWindow,
  mockHandle,
  mockGetSources,
  mockGetAllDisplays,
  mockShowMessageBox,
  mockGetMediaAccessStatus,
} = vi.hoisted(() => ({
  mockBrowserWindow: vi.fn(),
  mockHandle: vi.fn(),
  mockGetSources: vi.fn(),
  mockGetAllDisplays: vi.fn(),
  mockShowMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
  mockGetMediaAccessStatus: vi.fn().mockReturnValue('granted'),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/workspace/downloads'),
    dock: { show: vi.fn() },
  },
  BrowserWindow: mockBrowserWindow,
  desktopCapturer: {
    getSources: mockGetSources,
  },
  screen: {
    getAllDisplays: mockGetAllDisplays,
  },
  clipboard: {
    writeImage: vi.fn(),
  },
  dialog: {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/workspace/shot.png' }),
    showMessageBox: mockShowMessageBox,
  },
  shell: { openExternal: vi.fn() },
  systemPreferences: {
    getMediaAccessStatus: mockGetMediaAccessStatus,
  },
  protocol: {
    handle: mockHandle,
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

vi.mock('node-screenshots', () => ({
  Window: { all: vi.fn().mockReturnValue([]) },
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
  };
});

import { ScreenshotManager } from '../ScreenshotManager';

function createWindow(overrides: Record<string, any> = {}) {
  const webContents = {
    once: vi.fn((_event: string, cb: () => void) => cb()),
    send: vi.fn(),
    setZoomFactor: vi.fn(),
    setZoomLevel: vi.fn(),
  };
  return {
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    webContents,
    on: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    isDestroyed: vi.fn().mockReturnValue(false),
    setBounds: vi.fn(),
    ...overrides,
  };
}

function resetManager() {
  (ScreenshotManager as any).instance = null;
  const manager = ScreenshotManager.getInstance();
  (manager as any).captureReadyPromise?.catch?.(() => {});
  return manager;
}

describe('ScreenshotManager additional coverage', () => {
  const originalArgv = [...process.argv];
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetMediaAccessStatus.mockReturnValue('granted');
    mockShowMessageBox.mockResolvedValue({ response: 0 });
    process.argv.splice(0, process.argv.length, ...originalArgv.filter((arg) => arg !== '--dev'));
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  afterEach(() => {
    (ScreenshotManager as any).instance = null;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('initializes live windows with screenshots and skips destroyed windows', async () => {
    const manager = resetManager();
    const liveWindow = createWindow();
    const destroyedWindow = createWindow({ isDestroyed: vi.fn().mockReturnValue(true) });
    const screenshot = { toJPEG: vi.fn(() => Buffer.from('jpeg')) };

    await (manager as any).initializeWindowsWithScreenshots(
      [
        {
          window: liveWindow,
          display: { id: 7, bounds: { x: 0, y: 0, width: 100, height: 100 } },
          readyPromise: Promise.resolve(),
        },
        {
          window: destroyedWindow,
          display: { id: 8, bounds: { x: 10, y: 10, width: 50, height: 50 } },
          readyPromise: Promise.resolve(),
        },
      ],
      [screenshot as any, screenshot as any],
      new Map([[7, [{ x: 1, y: 2, width: 3, height: 4 }]]]),
    );

    expect(liveWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
    expect(liveWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(liveWindow.show).toHaveBeenCalled();
    expect(liveWindow.focus).toHaveBeenCalled();
    expect((manager as any).displays.get(7).frames).toEqual([{ x: 1, y: 2, width: 3, height: 4 }]);
    expect((manager as any).displays.has(8)).toBe(false);
  });

  it('creates a production overlay window with loadFile query parameters', async () => {
    const window = createWindow();
    mockBrowserWindow.mockImplementation(function () {
      return window;
    });
    const manager = resetManager();

    const state = await (manager as any).createDisplayWindowForParallel({
      id: 11,
      bounds: { x: 5, y: 6, width: 1280, height: 720 },
    });

    await state.readyPromise;
    expect(mockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(window.loadFile).toHaveBeenCalledWith(
      expect.stringContaining('renderer/screenshot.html'),
      { query: { displayId: '11' } },
    );
    expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(1);
    expect(window.webContents.setZoomLevel).toHaveBeenCalledWith(0);
    expect(window.on).toHaveBeenCalledWith('closed', expect.any(Function));
  });

  it('creates a development overlay window with loadURL', async () => {
    process.argv.push('--dev');
    const window = createWindow();
    mockBrowserWindow.mockImplementation(function () {
      return window;
    });
    const manager = resetManager();

    await (manager as any).createDisplayWindowForParallel({
      id: 12,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });

    expect(window.loadURL).toHaveBeenCalledWith(expect.stringContaining('screenshot.html?displayId=12'));
  });

  it('throws a detailed macOS error and schedules the restart dialog after repeated blank captures', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const runImmediate = vi.spyOn(global, 'setImmediate').mockImplementation(((fn: (...args: any[]) => void, ...args: any[]) => {
      fn(...args);
      return 0 as any;
    }) as any);
    mockGetSources.mockResolvedValue([
      {
        display_id: '99',
        thumbnail: {
          isEmpty: vi.fn().mockReturnValue(true),
          getSize: vi.fn().mockReturnValue({ width: 0, height: 0 }),
        },
      },
    ]);

    const manager = resetManager();

    await expect((manager as any).captureAllDisplays([
      {
        id: 99,
        size: { width: 1440, height: 900 },
        scaleFactor: 2,
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
    ])).rejects.toThrow('restart the app after granting Screen Recording permission');

    expect(mockShowMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Screenshot Failed',
    }));
    runImmediate.mockRestore();
  });
});
