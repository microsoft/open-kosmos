/**
 * cursorOverlay — a dedicated, on-screen "AI cursor" that visualizes every
 * pointer action Computer Use performs on the real desktop.
 *
 * Why this exists: Computer Use must not hijack the user's real pointer, so the
 * input driver snaps the OS cursor back to where the user left it after every
 * action (see `inputDriver.ts`). On its own that leaves the agent's work
 * invisible. This module paints a distinct, glowing pointer that follows the
 * agent's action trajectory, so the user sees TWO independent cursors: their own
 * (which never moves) and the AI's (which does the clicking/dragging).
 *
 * The cursor stays solid while the agent is active — it does not fade between
 * actions — and the window only hides after a generous idle gap (refreshed via
 * `ping()` on each screenshot AND each keyboard/focus action, so it stays
 * continuously visible across the model's per-step think-time, not just during
 * the instant of an action).
 *
 * The overlay is a transparent, click-through, non-focusable, always-on-top
 * Electron window positioned over the target display. It is critical that it:
 *   - is click-through (`setIgnoreMouseEvents`) so neither the synthetic click
 *     nor the user's real click is intercepted by the overlay;
 *   - never steals focus (`focusable:false` + `showInactive`) so it does not
 *     pollute foreground-app detection or misdirect nut.js input;
 *   - does not throttle animations (`backgroundThrottling:false`) — the window
 *     is permanently non-focused, so rAF/timers would otherwise drop to ~1fps.
 *
 * IMPORTANT — the window does NOT use `setContentProtection`. On Windows,
 * `transparent:true` + `setContentProtection(true)` produces an *invisible*
 * window (Chromium disables DirectComposition overlays for transparency while
 * protected content forces them back), so the user would never see the AI
 * cursor — which is the whole point. The AI cursor is instead kept out of the
 * model's screenshots by the manager, which hides this overlay for the duration
 * of each capture (see `ComputerUseManager.screenshot`).
 *
 * The page itself is a plain `about:blank`; all DOM/animation is injected from
 * the main process via `executeJavaScript`, which runs in the page main world
 * and bypasses any page CSP — so no preload, IPC channel, HTML entry, or build
 * config is required. The class is built over an injectable window factory so
 * every branch is exercisable with a fake window in tests.
 */

import { BrowserWindow, app } from 'electron';
import { createLogger } from '../unifiedLogger';
import type { DisplayBounds } from './types';
import { BOOTSTRAP_SCRIPT, buildPayload, cursorInvocation } from './cursorRenderer';
import type { CursorPayload, CursorSignal } from './cursorRenderer';

const logger = createLogger();

// Re-export the pure, electron-free render layer (payload projection + the
// in-page BOOTSTRAP_SCRIPT) from its own module so existing importers and tests
// keep importing from `cursorOverlay`, while the same code can be rasterized by
// the render smoke test without dragging electron into a browser/node context.
export { BOOTSTRAP_SCRIPT, buildPayload, cursorInvocation, toLocalCss } from './cursorRenderer';
export type { CursorPayload, CursorSignal } from './cursorRenderer';

/** Wall-clock idle period after which the overlay window hides itself. Sized to
 * comfortably bridge the model's per-step think-time (the gap between a
 * screenshot returning and the agent issuing its next action — routinely many
 * seconds), so the AI cursor stays continuously visible THROUGHOUT an operation
 * instead of blinking out between steps. Every screenshot ({@link
 * CursorIndicator.ping}), pointer action, and keyboard/focus action refreshes
 * this timer, so it only fires once the agent has truly stopped acting. */
export const IDLE_HIDE_MS = 20000;
const READY_SETTLE_TIMEOUT_MS = 1000;

/** Display-only sink for cursor signals. Fire-and-forget; methods MUST NOT throw. */
export interface CursorIndicator {
  signal(sig: CursorSignal): void;
  /** Keep the AI cursor visible across the agent's think-time without moving it. */
  ping(): void;
  /**
   * Resolve once the AI cursor has glided onto its last signaled target (or after
   * a short in-page safety cap). Lets the caller land the real input only after the
   * cursor has visibly arrived — "move there, THEN click" — instead of the app
   * reacting before the cursor lands. Fire-and-forget-safe: never rejects.
   */
  settle(): Promise<void>;
  hide(): void;
  dispose(): void;
}

/** No-op indicator used in tests and as a safe fallback when no overlay is available. */
export class NoopCursorIndicator implements CursorIndicator {
  signal(): void {}
  ping(): void {}
  settle(): Promise<void> {
    return Promise.resolve();
  }
  hide(): void {}
  dispose(): void {}
}

/** Minimal slice of `BrowserWindow` the overlay drives; lets tests inject a fake. */
export interface OverlayWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  getBounds(): DisplayBounds;
  setBounds(bounds: DisplayBounds): void;
  showInactive(): void;
  moveTop(): void;
  hide(): void;
  destroy(): void;
  loadURL(url: string): Promise<void>;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  setVisibleOnAllWorkspaces(visible: boolean, options?: { visibleOnFullScreen?: boolean }): void;
  webContents: {
    executeJavaScript(code: string): Promise<unknown>;
    once(event: 'did-finish-load', listener: () => void): void;
  };
}

export type OverlayWindowFactory = () => OverlayWindow;

/**
 * Registers a teardown hook: `onAllHostWindowsClosed` is invoked once every one of
 * the app's real (non-overlay) windows has closed. Injectable so tests can drive
 * the overlay's self-disposal without real Electron windows.
 */
export type ShutdownWatcher = (onAllHostWindowsClosed: () => void) => void;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Re-assert the app's macOS Dock icon. Putting a transparent, frameless,
 * `skipTaskbar` overlay BrowserWindow on screen makes macOS hide the owning
 * app's Dock icon as an activation-policy side effect — the exact same reason
 * `ScreenshotManager.cleanup()` calls `app.dock?.show()` around its region-capture
 * overlay. The Computer Use cursor overlay is the identical kind of window, so
 * without this the Dock icon vanishes the moment the first pointer action shows
 * the overlay. During a run the main window is almost always occluded by the app
 * the agent is driving, so a missing Dock icon makes the user believe OpenKosmos was
 * closed and that it cannot be brought back. `app.dock.show()` is idempotent and
 * macOS-only, so it is safe to re-assert on every overlay show; it is a no-op off
 * macOS. Dock restoration is best-effort and must never break the cursor overlay.
 */
function ensureDockIconVisible(): void {
  if (process.platform !== 'darwin') {
    return;
  }
  try {
    app.dock?.show();
  } catch (err) {
    logger.warn(`[ComputerUse] dock icon restore failed: ${errMsg(err)}`);
  }
}

/**
 * Marker stamped on the overlay's own BrowserWindow so the shutdown watcher can
 * tell it apart from the app's real windows. The overlay is only ever hidden (not
 * closed) between actions and after the idle timeout, so without the teardown
 * below a lingering hidden overlay window would keep Electron's `window-all-closed`
 * event from firing — on Windows/Linux the app would then never quit after the
 * user closes the main window (the window disappears but the process stays alive).
 */
const OVERLAY_TAG = '__cuCursorOverlay';

function isHostWindow(win: BrowserWindow): boolean {
  return !win.isDestroyed() && !(win as unknown as Record<string, unknown>)[OVERLAY_TAG];
}

/**
 * Default {@link ShutdownWatcher}: watch every real (non-overlay) window — those
 * open now and any opened later — and fire `onAllHostWindowsClosed` once none
 * remain, so the overlay can destroy its own (otherwise lingering) window and let
 * the app actually exit. On macOS the main window only hides on close (it is never
 * destroyed), so this never fires there and the Dock-resident app lifetime is
 * unaffected.
 */
export function watchHostWindowsForShutdown(onAllHostWindowsClosed: () => void): void {
  const check = (): void => {
    if (!BrowserWindow.getAllWindows().some(isHostWindow)) {
      onAllHostWindowsClosed();
    }
  };
  const watch = (win: BrowserWindow): void => {
    if (isHostWindow(win)) {
      win.once('closed', check);
    }
  };
  for (const win of BrowserWindow.getAllWindows()) {
    watch(win);
  }
  app.on('browser-window-created', (_event, win) => watch(win));
}

/** Default factory: a real transparent, click-through, non-focusable BrowserWindow. */
export function createOverlayWindow(): OverlayWindow {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    x: 0,
    y: 0,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: false,
    acceptFirstMouse: false,
    enableLargerThanScreen: true,
    title: 'cu-cursor-overlay',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      devTools: false,
    },
  });
  (win as unknown as Record<string, unknown>)[OVERLAY_TAG] = true;
  return win as unknown as OverlayWindow;
}

/**
 * Real overlay. Lazily creates the window on first signal, positions it over the
 * target display, and injects each visualization. All Electron interaction is
 * fire-and-forget and guarded so a failure can never break the agent's action.
 */
export class CursorOverlay implements CursorIndicator {
  private win: OverlayWindow | null = null;
  private ready = false;
  private pending: CursorPayload | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private shutdownArmed = false;
  private readyWaiters: Array<() => void> = [];

  constructor(
    private readonly factory: OverlayWindowFactory = createOverlayWindow,
    private readonly watchShutdown: ShutdownWatcher = watchHostWindowsForShutdown,
  ) {}

  signal(sig: CursorSignal): void {
    if (this.disposed) {
      return;
    }
    try {
      const win = this.ensureWindow();
      win.setBounds(sig.display.bounds);
      this.raise(win);
      this.send(win, buildPayload(sig));
      this.armIdleHide();
    } catch (err) {
      logger.warn(`[ComputerUse] cursor overlay signal failed: ${errMsg(err)}`);
    }
  }

  hide(): void {
    this.clearIdle();
    const win = this.win;
    if (win && !win.isDestroyed()) {
      try {
        win.hide();
      } catch (err) {
        logger.warn(`[ComputerUse] cursor overlay hide failed: ${errMsg(err)}`);
      }
    }
  }

  /**
   * Keep the AI cursor alive across the agent's think-time between actions (e.g.
   * while the model composes its next step after a screenshot) WITHOUT moving the
   * cursor: re-show the window if needed and refresh the idle-hide timer. A no-op
   * until the first action has created the window, so a screenshot taken before
   * any pointer action never spawns an empty overlay.
   */
  ping(): void {
    if (this.disposed) {
      return;
    }
    const win = this.win;
    if (!win || win.isDestroyed()) {
      return;
    }
    try {
      this.raise(win);
      this.armIdleHide();
    } catch (err) {
      logger.warn(`[ComputerUse] cursor overlay ping failed: ${errMsg(err)}`);
    }
  }

  /**
   * Show the overlay AND force it back to the top of the z-order. Re-asserting the
   * always-on-top level and calling `moveTop()` on EVERY show (not only at window
   * creation) is deliberate and load-bearing on Windows: once the agent activates a
   * real foreground app — e.g. a maximized Paint/editor it is driving — Windows can
   * silently drop a window whose always-on-top was set only at creation BELOW that
   * newly-active app, leaving the AI cursor painted behind the target and invisible
   * to the user. `showInactive()` alone re-shows the window but does not re-raise it.
   * A hidden->visible transition is logged once (low frequency — at most a handful
   * per session) so the dev harness can confirm the overlay believes it is on screen
   * if a "cursor not visible" report comes in.
   */
  private raise(win: OverlayWindow): void {
    // Showing this transparent, skipTaskbar overlay hides the macOS Dock icon as a
    // side effect; re-assert it on every show so the user never loses the OpenKosmos
    // Dock icon mid-run and mistake the occluded main window for a closed app.
    ensureDockIconVisible();
    const wasVisible = win.isVisible();
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    if (!wasVisible) {
      logger.info(
        `[ComputerUse] cursor overlay shown (ready=${this.ready} bounds=${JSON.stringify(win.getBounds())})`,
      );
    }
  }

  /** Wait for the AI cursor to arrive before dispatching real pointer input. */
  async settle(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const win = this.win;
    if (!win || win.isDestroyed()) {
      return;
    }
    if (!this.ready) {
      await this.waitUntilReadyForSettle();
    }
    const readyWin = this.win;
    if (!readyWin || readyWin.isDestroyed() || !this.ready) {
      return;
    }
    try {
      await readyWin.webContents.executeJavaScript('window.__cuSettle ? window.__cuSettle() : 0;');
    } catch (err) {
      logger.warn(`[ComputerUse] cursor overlay settle failed: ${errMsg(err)}`);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearIdle();
    const win = this.win;
    this.win = null;
    this.ready = false;
    this.pending = null;
    this.flushReadyWaiters();
    if (win && !win.isDestroyed()) {
      try {
        win.destroy();
      } catch (err) {
        logger.warn(`[ComputerUse] cursor overlay dispose failed: ${errMsg(err)}`);
      }
    }
  }

  private ensureWindow(): OverlayWindow {
    if (this.win && !this.win.isDestroyed()) {
      return this.win;
    }
    this.ready = false;
    this.pending = null;
    const win = this.factory();
    this.win = win;
    win.setIgnoreMouseEvents(true, { forward: false });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // NOTE: deliberately NO setContentProtection here — on Windows it makes a
    // transparent window invisible, hiding the AI cursor from the user. The
    // manager hides this overlay during capture to keep it out of screenshots.
    win.webContents.once('did-finish-load', () => this.onReady(win));
    void win.loadURL('about:blank').catch((err) => {
      logger.warn(`[ComputerUse] cursor overlay load failed: ${errMsg(err)}`);
    });
    logger.info('[ComputerUse] cursor overlay window created');
    this.armShutdownWatch();
    return win;
  }

  private onReady(win: OverlayWindow): void {
    // A late callback can only belong to a window we already destroyed (recreate
    // happens only after destroy), so the destroyed check fully guards staleness.
    if (win.isDestroyed()) {
      return;
    }
    win.webContents
      .executeJavaScript(BOOTSTRAP_SCRIPT)
      .then(() => {
        this.ready = true;
        logger.info('[ComputerUse] cursor overlay ready and visible');
        const pending = this.pending;
        this.pending = null;
        if (pending) {
          this.invoke(win, pending);
        }
        this.flushReadyWaiters();
      })
      .catch((err) => {
        logger.warn(`[ComputerUse] cursor overlay bootstrap failed: ${errMsg(err)}`);
        this.flushReadyWaiters();
      });
  }

  private async waitUntilReadyForSettle(): Promise<void> {
    if (this.ready) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((waiter) => waiter !== done);
        resolve();
      }, READY_SETTLE_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.readyWaiters.push(done);
    });
  }

  private flushReadyWaiters(): void {
    const waiters = this.readyWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  private send(win: OverlayWindow, payload: CursorPayload): void {
    if (!this.ready) {
      this.pending = payload;
      return;
    }
    this.invoke(win, payload);
  }

  private invoke(win: OverlayWindow, payload: CursorPayload): void {
    if (win.isDestroyed()) {
      return;
    }
    void win.webContents.executeJavaScript(cursorInvocation(payload)).catch((err) => {
      logger.warn(`[ComputerUse] cursor overlay invoke failed: ${errMsg(err)}`);
    });
  }

  /**
   * Arm the one-shot teardown that destroys this overlay once the app's real
   * windows have all closed. The overlay window is only ever hidden (never closed)
   * between actions, so without this it would keep Electron's `window-all-closed`
   * from firing and the process would stay alive after the user closes the main
   * window (Windows/Linux). Registered once, when the overlay first creates its
   * window; a visualization helper must never break the agent, so a failing
   * watcher is swallowed.
   */
  private armShutdownWatch(): void {
    if (this.shutdownArmed) {
      return;
    }
    this.shutdownArmed = true;
    try {
      this.watchShutdown(() => this.dispose());
    } catch (err) {
      logger.warn(`[ComputerUse] cursor overlay shutdown watch failed: ${errMsg(err)}`);
    }
  }

  private armIdleHide(): void {
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.hide(), IDLE_HIDE_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

let cursorSingleton: CursorIndicator | null = null;

/** Process-wide overlay indicator. Lazy so importing the module touches no Electron. */
export function getCursorIndicator(): CursorIndicator {
  if (!cursorSingleton) {
    cursorSingleton = new CursorOverlay();
  }
  return cursorSingleton;
}

/** Test seam: replace or clear the singleton. */
export function setCursorIndicatorForTesting(indicator: CursorIndicator | null): void {
  cursorSingleton = indicator;
}
