import {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  desktopCapturer,
  screen,
  clipboard,
  app,
  dialog,
  shell,
  systemPreferences,
  protocol,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getUnifiedLogger } from '../unifiedLogger';
import ResolveablePromise from '@shared/resolveable-promise';
import type { SaveToFileResult, DisplayInfo, CaptureResult } from '@shared/ipc/screenshot';
import { getWindowFrames } from './windowFrames';

const logger = getUnifiedLogger();

/** Selection rectangle */
export interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
}

/** Display capture info */
interface DisplayCapture extends DisplayInfo {
  window: BrowserWindow;
  screenshot: Electron.NativeImage;
  cachedJpeg: Buffer; // Pre-cached JPEG data to avoid redundant encoding
}

/** Window ready state */
interface WindowReadyState {
  window: BrowserWindow;
  display: Electron.Display;
  readyPromise: Promise<void>;
}


// 🔥 Note: protocol.registerSchemesAsPrivileged has been moved to main.ts top-level.
// It must be called before app.ready, so it cannot be executed during dynamic import here.

/**
 * Screenshot Manager - Supports multi-display, capture-first-then-select workflow.
 */
export class ScreenshotManager {
  private static instance: ScreenshotManager | null = null;
  private readonly isDev: boolean;

  private displays = new Map<number, DisplayCapture>();
  private capturePromise: ResolveablePromise<CaptureResult> | null = null;
  private captureReadyPromise: Promise<void> = Promise.reject().catch(() => {/* initial state: not ready */});
  private activeDisplayId: number | null = null;
  private mainWindow: BrowserWindow | null = null;

  private constructor() {
    this.isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
    this.registerCustomProtocol();
  }

  static getInstance(): ScreenshotManager {
    if (!ScreenshotManager.instance) {
      ScreenshotManager.instance = new ScreenshotManager();
    }
    return ScreenshotManager.instance;
  }

  private registerCustomProtocol(): void {
    protocol.handle('screenshot', (request) => {
      const url = new URL(request.url);
      if (url.host == 'image') {
        const id = Number(url.pathname.slice(1));
        const display = this.displays.get(id);
        if (display && display.cachedJpeg) {
          return new Response(
            new Uint8Array(display.cachedJpeg),
            { status: 200, headers: { 'Content-Type': 'image/jpeg' }
          });
        }
      }
      return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    });
  }

  setMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
  }

  async checkScreenCapturePermission(): Promise<boolean> {
    if (process.platform !== 'darwin') return true;
    
    const status = systemPreferences.getMediaAccessStatus('screen');
    logger.info(`[ScreenshotManager] Screen capture permission status: ${status}`);
    if (status === 'granted') return true;
    
    const dialogResult = await dialog.showMessageBox({
      type: 'info',
      title: 'Screen Recording Permission Required',
      message: 'Screen Recording permission is required for screenshots',
      detail: 'Please grant this app permission in "System Settings > Privacy & Security > Screen Recording".\n\n⚠️ You must restart the app after granting permission for it to take effect.',
      buttons: ['Open Settings', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    }) as unknown as { response: number };
    
    if (dialogResult.response === 0) {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    }
    return false;
  }

  async getInitData(displayId: number): Promise<DisplayInfo> {
    await this.captureReadyPromise;
    const display = this.displays.get(displayId);
    if (!display) {
      throw new Error('Display not found');
    }
    return {
      id: display.id,
      bounds: display.bounds,
      frames: display.frames,
    };
  }

  async capture(callback = true): Promise<CaptureResult> {
    if (!await this.checkScreenCapturePermission()) {
      return { type: 'fail', reason: 'Screen capture permission denied' };
    }
    this.cleanup();
    this.capturePromise = new ResolveablePromise<CaptureResult>();
    const captureReadyPromise = new ResolveablePromise<void>();
    this.captureReadyPromise = captureReadyPromise;

    try {
      const displays = screen.getAllDisplays();
      logger.info(`[ScreenshotManager] Starting capture for ${displays.length} display(s), isDev=${this.isDev}`);
      const windowFrames = getWindowFrames(displays);
      // Parallel launch: window creation + screenshot capture
      const [windowReadyStates, screenshots] = await Promise.all([
        Promise.all(displays.map(d => this.createDisplayWindowForParallel(d))),
        this.captureAllDisplays(displays),
      ]);
      // Once both are ready, initialize windows and show them
      this.initializeWindowsWithScreenshots(windowReadyStates, screenshots, windowFrames);
      captureReadyPromise.resolve();
    } catch (error) {
      const errorStr = String(error);
      logger.error(`[ScreenshotManager] Failed to open: ${errorStr}`);
      captureReadyPromise.reject(error);
      this.capturePromise.resolve({ type: 'fail', reason: errorStr });
      this.cleanup();
      return this.capturePromise;
    }

    if (!callback) {
      this.capturePromise.resolve({ type: 'success-without-data' });
    }
    return await this.capturePromise;
  }

  /**
   * Initialize windows with screenshots and show them.
   */
  private initializeWindowsWithScreenshots(
    windowStates: WindowReadyState[],
    screenshots: Electron.NativeImage[],
    windowFrames: ReturnType<typeof getWindowFrames>,
  ) {
    return Promise.all(
      windowStates.map(async (state, index) => {
        const { window, display, readyPromise } = state;
        if (window.isDestroyed()) return;

        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.setAlwaysOnTop(true, 'screen-saver');
        window.show();
        window.focus();
        
        const screenshot = screenshots[index];
        const cachedJpeg = screenshot.toJPEG(90);
        this.displays.set(display.id, {
          id: display.id,
          window,
          screenshot,
          cachedJpeg,
          bounds: display.bounds,
          frames: windowFrames.get(display.id) || [],
        });
        return readyPromise;
      })
    );
  }

  /**
   * Capture all displays.
   *
   * About thumbnailSize:
   * - Electron/Chromium's desktopCapturer preserves original aspect ratio.
   * - thumbnailSize is a bounding box; the image scales proportionally to fit.
   * - Setting it to the max physical pixels ensures all displays are captured at
   *   native (or near-native) resolution.
   * - Ref: https://www.electronjs.org/docs/latest/api/desktop-capturer
   */
  private async captureAllDisplays(displays: Electron.Display[]) {
    const maxWidth = Math.max(...displays.map(d => d.size.width * d.scaleFactor));
    const maxHeight = Math.max(...displays.map(d => d.size.height * d.scaleFactor));

    const maxRetries = 3;
    const retryDelay = 500; // ms — macOS 15 needs more initialization time

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: maxWidth, height: maxHeight },
      });

      logger.info(`[ScreenshotManager] desktopCapturer returned ${sources.length} sources (attempt ${attempt}/${maxRetries})`);

      const results: Electron.NativeImage[] = [];
      let allCaptured = true;

      for (const display of displays) {
        const source = sources.find(s => s.display_id === String(display.id));
        if (!source || source.thumbnail.isEmpty()) {
          allCaptured = false;
          const size = source?.thumbnail ? source.thumbnail.getSize() : null;
          logger.warn(
            `[ScreenshotManager] Capture attempt ${attempt}/${maxRetries} failed for display ${display.id} ` +
            `(source found: ${!!source}, empty: ${source ? source.thumbnail.isEmpty() : 'N/A'}, ` +
            `size: ${size ? `${size.width}x${size.height}` : 'N/A'}, ` +
            `permission: ${process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'N/A'})`
          );
          break;
        }
        results.push(source.thumbnail);
      }

      if (allCaptured) {
        logger.info(`[ScreenshotManager] All displays captured successfully on attempt ${attempt}`);
        return results;
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }

    // All retries exhausted — provide detailed diagnostics on macOS
    if (process.platform === 'darwin') {
      const permStatus = systemPreferences.getMediaAccessStatus('screen');
      const errorMsg = permStatus === 'granted'
        ? 'Screen capture returned empty images despite having permission. ' +
          'On macOS 15+, you may need to restart the app after granting Screen Recording permission.'
        : `Screen capture permission status: ${permStatus}`;

      // Show a restart prompt dialog if permission is granted but capture returns empty
      if (permStatus === 'granted') {
        // Non-blocking — use setImmediate to show the prompt asynchronously
        setImmediate(() => {
          dialog.showMessageBox({
            type: 'warning',
            title: 'Screenshot Failed',
            message: 'Screen capture returned blank images',
            detail: 'On macOS 15 and later, you must restart the app after granting Screen Recording permission.\n\n' +
                    'Please quit the app completely (Cmd+Q) and reopen it.',
            buttons: ['OK'],
          });
        });
      }

      throw new Error(errorMsg);
    }

    throw new Error(`Failed to capture displays after ${maxRetries} attempts`);
  }

  /**
   * Create a window for a single display (parallel version).
   * Returns a window-ready state containing the window and a Promise
   * that resolves when the page's JS initialization is complete.
   */
  private async createDisplayWindowForParallel(display: Electron.Display): Promise<WindowReadyState> {
    const { bounds, id } = display;
    
    const windowOptions: BrowserWindowConstructorOptions = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fullscreen: false,
      fullscreenable: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false, // Don't show yet to avoid interfering with capture
      roundedCorners: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.screenshot.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    };

    const window = new BrowserWindow(windowOptions);
    window.on('closed', () => this.displays.delete(id));
    const readyPromise = new Promise<void>((resolve) => {
      // Force-reset zoom after page load (override Chromium's per-origin inherited zoom)
      window.webContents.once('did-finish-load', () => {
        window.webContents.setZoomFactor(1);
        window.webContents.setZoomLevel(0);
        resolve();
      });
    });
    
    if (this.isDev) {
      await window.loadURL(`http://localhost:3000/screenshot.html?displayId=${id}`);
    } else {
      // ⚠️ Do NOT append query params directly to the file path!
      // Electron's loadFile internally uses pathToFileURL(), which encodes '?' as '%3F',
      // resulting in a lookup for "screenshot.html%3FdisplayId=123" (non-existent) and a load failure.
      // Query params must be passed via loadFile's `query` option.
      await window.loadFile(path.join(__dirname, '../renderer/screenshot.html'), {
        query: { displayId: String(id) },
      });
    }
    return { window, display, readyPromise };
  }

  /** User started selection — close windows on other displays */
  onSelectionStart(displayId: number): void {
    this.activeDisplayId = displayId;
    this.displays.forEach((info, id) => {
      if (id !== displayId && !info.window.isDestroyed()) {
        info.window.close();
      }
    });
  }

  private async cropFromDisplay(displayId: number, rect: SelectionRect) {
    const displayInfo = this.displays.get(displayId);
    if (!displayInfo) {
      throw new Error('Display not found');
    }
    const { screenshot, bounds } = displayInfo;
    const size = screenshot.getSize();
    const scaleX = size.width / bounds.width;
    const scaleY = size.height / bounds.height;
    const scaledRect = {
      x: Math.round(rect.startX * scaleX),
      y: Math.round(rect.startY * scaleY),
      width: Math.round(rect.width * scaleX),
      height: Math.round(rect.height * scaleY),
    };

    const cropped = screenshot.crop(scaledRect);
    if (cropped.isEmpty()) throw new Error('Cropped image is empty');
    return cropped;
  }

  async saveToFile(displayId: number, rect: SelectionRect, imageData?: Buffer, savePath?: string): Promise<SaveToFileResult> {
    try {
      const pngData = imageData || (await this.cropFromDisplay(displayId, rect)).toPNG();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const defaultFilename = `kosmos-screenshot-${timestamp}.png`;
      const defaultDir = savePath || app.getPath('downloads');

      const parentWindow = this.displays.get(displayId)?.window ?? this.mainWindow;
      const dialogOptions = {
        defaultPath: path.join(defaultDir, defaultFilename),
        filters: [{ name: 'PNG Image', extensions: ['png'] }],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electron 35 overload resolution quirk
      const result = await (parentWindow
        ? dialog.showSaveDialog(parentWindow, dialogOptions)
        : dialog.showSaveDialog(dialogOptions)) as unknown as Electron.SaveDialogReturnValue;

      if (result.canceled || !result.filePath) {
        return { type: 'cancel' };
      }

      await fs.promises.writeFile(result.filePath, pngData);
      this.capturePromise?.resolve({ type: 'saved' });
      return { type: 'success', filePath: result.filePath };
    } catch (error) {
      return { type: 'fail', error: String(error) };
    }
  }

  async copyToClipboard(displayId: number, rect: SelectionRect): Promise<{ success: boolean; error?: string }> {
    try {
      const cropped = await this.cropFromDisplay(displayId, rect);
      clipboard.writeImage(cropped);
      this.capturePromise?.resolve({ type: 'copied' });
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async sendToMain(displayId: number, rect: SelectionRect, imageData?: Buffer) {
    if (this.capturePromise) {
      if (imageData) {
        // Use the provided image data
        this.capturePromise.resolve({ type: 'success', data: imageData });
      } else {
        // Crop from the captured screenshot
        const cropped = await this.cropFromDisplay(displayId, rect);
        this.capturePromise.resolve({ type: 'success', data: cropped.toPNG() });
      }
    }
  }


  public cleanup() {
    // ⚠️ Timing-critical: ensure Dock icon stays visible before closing screenshot windows
    if (process.platform === 'darwin') {
      app.dock?.show();
    }

    this.displays.forEach(info => {
      if (!info.window.isDestroyed()) info.window.close();
    });
    this.displays.clear();
    this.activeDisplayId = null;
    // Use a properly handled rejected Promise to avoid unhandled rejection
    const rejected = Promise.reject(new Error('Screenshot not ready'));
    rejected.catch(() => {}); // Swallow the rejection to prevent UnhandledRejection warnings
    this.captureReadyPromise = rejected;
    if (this.capturePromise) {
      // Fallback: resolve any remaining unhandled cases
      this.capturePromise.resolve({ type: 'cancel' });
      this.capturePromise = null;
    }
  }
}
