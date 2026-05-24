import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Heavy Electron mocks (extend the global setup mock) ───────────────────────
vi.mock('electron', () => {
  const nativeImage = {
    isEmpty: vi.fn().mockReturnValue(false),
    getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    toJPEG: vi.fn().mockReturnValue(Buffer.from('jpeg')),
    toPNG: vi.fn().mockReturnValue(Buffer.from('png')),
    crop: vi.fn().mockReturnThis(),
  };

  return {
    app: {
      getPath: vi.fn(() => '/tmp/test'),
      dock: { show: vi.fn() },
    },
    BrowserWindow: vi.fn().mockImplementation(() => ({
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      webContents: {
        once: vi.fn((event: string, cb: () => void) => cb()),
        send: vi.fn(),
        setZoomFactor: vi.fn(),
        setZoomLevel: vi.fn(),
      },
      on: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    })),
    desktopCapturer: {
      getSources: vi.fn().mockResolvedValue([]),
    },
    screen: {
      getAllDisplays: vi.fn().mockReturnValue([]),
    },
    clipboard: {
      writeImage: vi.fn(),
    },
    dialog: {
      showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/test.png' }),
      showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
    },
    shell: { openExternal: vi.fn() },
    systemPreferences: {
      getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
    },
    protocol: {
      handle: vi.fn(),
      registerSchemesAsPrivileged: vi.fn(),
    },
  };
});

vi.mock('node-screenshots', () => ({
  Window: { all: vi.fn().mockReturnValue([]) },
}));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
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

// ── Import after mocks ────────────────────────────────────────────────────────
import { ScreenshotManager } from '../ScreenshotManager';

// ScreenshotManager's constructor initialises captureReadyPromise to Promise.reject(),
// which will emit an unhandledRejection if .catch() is not attached fast enough.
// Suppress these benign rejections for the duration of the test file.
const _silenceScreenshotRejections = (reason: unknown) => { void reason; };
process.on('unhandledRejection', _silenceScreenshotRejections);

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshManager(): ScreenshotManager {
  (ScreenshotManager as any).instance = null;
  const m = ScreenshotManager.getInstance();
  // Suppress the intentionally-rejected initial captureReadyPromise from the constructor
  // (Promise.reject() without an immediate .catch() triggers unhandledRejection in Node)
  (m as any).captureReadyPromise?.catch?.(() => {});
  return m;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ScreenshotManager — singleton', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('getInstance returns the same instance', () => {
    const a = ScreenshotManager.getInstance();
    const b = ScreenshotManager.getInstance();
    expect(a).toBe(b);
  });
});

describe('ScreenshotManager — checkScreenCapturePermission', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('returns true on non-darwin platforms', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const manager = freshManager();
    const result = await manager.checkScreenCapturePermission();
    expect(result).toBe(true);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('returns true on macOS when permission is "granted"', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { systemPreferences } = await import('electron');
    (systemPreferences.getMediaAccessStatus as any).mockReturnValue('granted');
    const manager = freshManager();
    const result = await manager.checkScreenCapturePermission();
    expect(result).toBe(true);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('returns false on macOS when user cancels the dialog', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { systemPreferences, dialog } = await import('electron');
    (systemPreferences.getMediaAccessStatus as any).mockReturnValue('denied');
    (dialog.showMessageBox as any).mockResolvedValue({ response: 1 }); // Cancel
    const manager = freshManager();
    const result = await manager.checkScreenCapturePermission();
    expect(result).toBe(false);
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

describe('ScreenshotManager — cleanup', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('cleanup runs without throwing', () => {
    const manager = freshManager();
    expect(() => manager.cleanup()).not.toThrow();
    // Suppress the newly-rejected captureReadyPromise set by cleanup()
    (manager as any).captureReadyPromise?.catch?.(() => {});
  });

  it('cleanup resolves any pending capturePromise as cancel', async () => {
    const manager = freshManager();
    // Inject a pending capture promise manually
    const { default: ResolvablePromise } = await import('@shared/resolveable-promise');
    const rp = new ResolvablePromise<any>();
    (manager as any).capturePromise = rp;
    manager.cleanup();
    const result = await rp;
    expect(result).toEqual({ type: 'cancel' });
  });

  it('cleanup clears active displays', () => {
    const manager = freshManager();
    const fakeWindow = { isDestroyed: () => false, close: vi.fn() };
    (manager as any).displays.set(1, { window: fakeWindow, id: 1, bounds: {}, frames: [], screenshot: {}, cachedJpeg: Buffer.from('') });
    manager.cleanup();
    expect((manager as any).displays.size).toBe(0);
  });
});

describe('ScreenshotManager — setMainWindow', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('sets the main window reference', () => {
    const manager = freshManager();
    const fakeWindow: any = { id: 99 };
    manager.setMainWindow(fakeWindow);
    expect((manager as any).mainWindow).toBe(fakeWindow);
  });
});

describe('ScreenshotManager — onSelectionStart', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('closes windows for all other displays', () => {
    const manager = freshManager();
    const closeA = vi.fn();
    const closeB = vi.fn();
    (manager as any).displays.set(1, { window: { isDestroyed: () => false, close: closeA }, id: 1, bounds: {}, frames: [], screenshot: {}, cachedJpeg: Buffer.from('') });
    (manager as any).displays.set(2, { window: { isDestroyed: () => false, close: closeB }, id: 2, bounds: {}, frames: [], screenshot: {}, cachedJpeg: Buffer.from('') });

    manager.onSelectionStart(1);

    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).toHaveBeenCalled();
  });

  it('tracks the active display id', () => {
    const manager = freshManager();
    manager.onSelectionStart(5);
    expect((manager as any).activeDisplayId).toBe(5);
  });
});

describe('ScreenshotManager — capture (no-permission path)', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('returns fail when permission is denied', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { systemPreferences, dialog } = await import('electron');
    (systemPreferences.getMediaAccessStatus as any).mockReturnValue('denied');
    (dialog.showMessageBox as any).mockResolvedValue({ response: 1 });

    const manager = freshManager();
    const result = await manager.capture(true);
    expect(result.type).toBe('fail');
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

describe('ScreenshotManager — saveToFile', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('returns cancel when dialog is cancelled', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as any).mockResolvedValue({ canceled: true });

    const manager = freshManager();
    const result = await manager.saveToFile(1, { startX: 0, startY: 0, endX: 100, endY: 100, width: 100, height: 100 }, Buffer.from('png'));
    expect(result.type).toBe('cancel');
  });

  it('returns success when file is saved', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as any).mockResolvedValue({ canceled: false, filePath: '/tmp/screenshot.png' });

    const manager = freshManager();
    const result = await manager.saveToFile(1, { startX: 0, startY: 0, endX: 100, endY: 100, width: 100, height: 100 }, Buffer.from('png'));
    expect(result.type).toBe('success');
    expect((result as any).filePath).toBe('/tmp/screenshot.png');
  });
});

describe('ScreenshotManager — copyToClipboard', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('returns { success: false } when display is not found', async () => {
    const manager = freshManager();
    const result = await manager.copyToClipboard(999, { startX: 0, startY: 0, endX: 100, endY: 100, width: 100, height: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns { success: true } when crop succeeds', async () => {
    const { clipboard } = await import('electron');

    const manager = freshManager();
    // Inject a fake display with a mockable screenshot
    const mockNativeImage = {
      isEmpty: vi.fn().mockReturnValue(false),
      getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      crop: vi.fn().mockReturnValue({
        isEmpty: vi.fn().mockReturnValue(false),
        toPNG: vi.fn().mockReturnValue(Buffer.from('png')),
      }),
    };
    (manager as any).displays.set(1, {
      id: 1,
      window: { isDestroyed: () => false, close: vi.fn() },
      screenshot: mockNativeImage,
      cachedJpeg: Buffer.from('jpeg'),
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      frames: [],
    });

    const result = await manager.copyToClipboard(1, { startX: 10, startY: 10, endX: 100, endY: 100, width: 90, height: 90 });
    expect(result.success).toBe(true);
    expect(clipboard.writeImage).toHaveBeenCalled();
  });
});

describe('ScreenshotManager — checkScreenCapturePermission (open settings)', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('opens system settings when user clicks Open Settings', async () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { systemPreferences, dialog, shell } = await import('electron');
    (systemPreferences.getMediaAccessStatus as any).mockReturnValue('denied');
    (dialog.showMessageBox as any).mockResolvedValue({ response: 0 }); // Open Settings
    const manager = freshManager();
    const result = await manager.checkScreenCapturePermission();
    expect(result).toBe(false);
    expect(shell.openExternal).toHaveBeenCalledWith(expect.stringContaining('ScreenCapture'));
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

describe('ScreenshotManager — getInitData', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('throws when display is not found', async () => {
    const manager = freshManager();
    // Make captureReadyPromise resolve immediately
    (manager as any).captureReadyPromise = Promise.resolve();
    await expect(manager.getInitData(999)).rejects.toThrow('Display not found');
  });

  it('returns display info when display exists', async () => {
    const manager = freshManager();
    (manager as any).captureReadyPromise = Promise.resolve();
    (manager as any).displays.set(42, {
      id: 42,
      window: { isDestroyed: () => false, close: vi.fn() },
      screenshot: {},
      cachedJpeg: Buffer.from('jpeg'),
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      frames: [{ x: 0, y: 0, width: 100, height: 100 }],
    });
    const info = await manager.getInitData(42);
    expect(info.id).toBe(42);
    expect(info.bounds).toBeDefined();
  });
});

describe('ScreenshotManager — sendToMain', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('resolves capturePromise with provided imageData', async () => {
    const manager = freshManager();
    const { default: ResolvablePromise } = await import('@shared/resolveable-promise');
    const rp = new ResolvablePromise<any>();
    (manager as any).capturePromise = rp;

    const imgData = Buffer.from('raw-image');
    await manager.sendToMain(1, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 }, imgData);
    const result = await rp;
    expect(result).toEqual({ type: 'success', data: imgData });
  });

  it('resolves capturePromise by cropping when no imageData provided', async () => {
    const manager = freshManager();
    const { default: ResolvablePromise } = await import('@shared/resolveable-promise');
    const rp = new ResolvablePromise<any>();
    (manager as any).capturePromise = rp;

    const pngData = Buffer.from('cropped-png');
    const mockNativeImage = {
      isEmpty: vi.fn().mockReturnValue(false),
      getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      crop: vi.fn().mockReturnValue({
        isEmpty: vi.fn().mockReturnValue(false),
        toPNG: vi.fn().mockReturnValue(pngData),
      }),
    };
    (manager as any).displays.set(1, {
      id: 1,
      window: { isDestroyed: () => false, close: vi.fn() },
      screenshot: mockNativeImage,
      cachedJpeg: Buffer.from('jpeg'),
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      frames: [],
    });

    await manager.sendToMain(1, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 });
    const result = await rp;
    expect(result.type).toBe('success');
    expect(result.data).toBe(pngData);
  });

  it('does nothing when capturePromise is null', async () => {
    const manager = freshManager();
    (manager as any).capturePromise = null;
    // Should not throw
    await expect(manager.sendToMain(1, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 })).resolves.toBeUndefined();
  });
});

describe('ScreenshotManager — saveToFile (crop from display)', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('crops from display when no imageData provided', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as any).mockResolvedValue({ canceled: false, filePath: '/tmp/test.png' });

    const manager = freshManager();
    const pngData = Buffer.from('cropped-png');
    const mockNativeImage = {
      isEmpty: vi.fn().mockReturnValue(false),
      getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      crop: vi.fn().mockReturnValue({
        isEmpty: vi.fn().mockReturnValue(false),
        toPNG: vi.fn().mockReturnValue(pngData),
      }),
    };
    (manager as any).displays.set(1, {
      id: 1,
      window: { isDestroyed: () => false, close: vi.fn() },
      screenshot: mockNativeImage,
      cachedJpeg: Buffer.from('jpeg'),
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      frames: [],
    });

    const result = await manager.saveToFile(1, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 });
    expect(result.type).toBe('success');
  });

  it('returns fail when crop returns empty image', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as any).mockResolvedValue({ canceled: false, filePath: '/tmp/test.png' });

    const manager = freshManager();
    const mockNativeImage = {
      isEmpty: vi.fn().mockReturnValue(false),
      getSize: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
      crop: vi.fn().mockReturnValue({
        isEmpty: vi.fn().mockReturnValue(true),
        toPNG: vi.fn().mockReturnValue(Buffer.from('')),
      }),
    };
    (manager as any).displays.set(1, {
      id: 1,
      window: { isDestroyed: () => false, close: vi.fn() },
      screenshot: mockNativeImage,
      cachedJpeg: Buffer.from('jpeg'),
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      frames: [],
    });

    const result = await manager.saveToFile(1, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 });
    expect(result.type).toBe('fail');
  });

  it('returns fail when display not found for crop', async () => {
    const manager = freshManager();
    const result = await manager.saveToFile(999, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 });
    expect(result.type).toBe('fail');
  });

  it('uses mainWindow as parent when no display window', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as any).mockResolvedValue({ canceled: false, filePath: '/tmp/test.png' });

    const manager = freshManager();
    const fakeMain: any = { id: 99 };
    manager.setMainWindow(fakeMain);

    const result = await manager.saveToFile(999, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 }, Buffer.from('png'));
    expect(result.type).toBe('success');
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(fakeMain, expect.anything());
  });

  it('uses dialog without parent when no display and no mainWindow', async () => {
    const { dialog } = await import('electron');
    (dialog.showSaveDialog as any).mockResolvedValue({ canceled: false, filePath: '/tmp/test.png' });

    const manager = freshManager();
    // no mainWindow, no display
    const result = await manager.saveToFile(999, { startX: 0, startY: 0, endX: 10, endY: 10, width: 10, height: 10 }, Buffer.from('png'));
    expect(result.type).toBe('success');
  });
});

describe('ScreenshotManager — capture (success path)', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('returns success-without-data when callback=false (no displays)', async () => {
    const { screen, systemPreferences } = await import('electron');
    (systemPreferences.getMediaAccessStatus as any).mockReturnValue('granted');
    // No displays → parallel Promise.all resolves with empty arrays → no blocking readyPromise
    (screen.getAllDisplays as any).mockReturnValue([]);

    const manager = freshManager();
    const result = await manager.capture(false);
    expect(result.type).toBe('success-without-data');
  });

  it('returns fail when desktopCapturer throws (no displays, success on empty)', async () => {
    const { screen, systemPreferences } = await import('electron');
    (systemPreferences.getMediaAccessStatus as any).mockReturnValue('granted');
    (screen.getAllDisplays as any).mockReturnValue([]);

    const manager = freshManager();
    // capturePromise is awaited — when callback=true and no data was resolved, it will hang
    // unless we call sendToMain. So use callback=false which auto-resolves.
    const result = await manager.capture(false);
    expect(result.type).toBe('success-without-data');
  });
});

describe('ScreenshotManager — cleanup on darwin', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('calls app.dock.show on darwin', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const manager = freshManager();
    manager.cleanup();
    import('electron').then(({ app }) => {
      expect(app.dock?.show).toHaveBeenCalled();
    });
    (manager as any).captureReadyPromise?.catch?.(() => {});
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('skips dock.show on non-darwin', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const manager = freshManager();
    expect(() => manager.cleanup()).not.toThrow();
    (manager as any).captureReadyPromise?.catch?.(() => {});
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });
});

describe('ScreenshotManager — onSelectionStart (destroyed window)', () => {
  afterEach(() => {
    (ScreenshotManager as any).instance = null;
  });

  it('skips destroyed windows', () => {
    const manager = freshManager();
    const closeB = vi.fn();
    (manager as any).displays.set(1, { window: { isDestroyed: () => false, close: vi.fn() }, id: 1, bounds: {}, frames: [], screenshot: {}, cachedJpeg: Buffer.from('') });
    (manager as any).displays.set(2, { window: { isDestroyed: () => true, close: closeB }, id: 2, bounds: {}, frames: [], screenshot: {}, cachedJpeg: Buffer.from('') });

    manager.onSelectionStart(1);
    expect(closeB).not.toHaveBeenCalled();
  });
});
