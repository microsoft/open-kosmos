/**
 * ComputerUseManager — orchestrates perception, targeting, and synthetic input
 * for the real local desktop.
 *
 * It is intentionally built over injected provider seams ({@link DesktopControl},
 * the input-driver loader, the permission probe, and the audit trail) and holds
 * no direct Electron / native imports, so every branch is exercisable with
 * fakes. The real wiring lives in {@link getComputerUseManager}.
 *
 * Coordinates from the agent are screenshot-image-space; the manager grounds
 * them against the LAST captured frame (Codex model: screenshot, then act), and
 * refuses pointer actions until a screenshot has been taken.
 */

import { mapImagePointToScreen } from './coordinateMapping';
import { getActionAudit, ActionAudit } from './actionAudit';
import { getPermissionStatus } from './permissions';
import { loadInputDriver, type InputDriver, type InputDriverLoadResult } from './inputDriver';
import { createDefaultDesktopControl, type DesktopControl } from './desktopControl';
import {
  getCursorIndicator,
  NoopCursorIndicator,
  type CursorIndicator,
} from './cursorOverlay';
import type {
  CaptureResult,
  DisplayBounds,
  DisplayInfo,
  ForegroundApp,
  MouseButton,
  PermissionStatus,
  Point,
  WindowInfo,
} from './types';

/**
 * Max absolute scroll delta (in nut.js scroll "clicks") accepted per `scroll` call.
 * A model can emit an arbitrarily large `dx`/`dy`; passing it raw to the native driver
 * either issues one enormous jump or loops thousands of scroll events, stalling the turn
 * and yanking the foreground app unpredictably. Clamping bounds a single call to a long-
 * but-finite scroll; the agent simply issues another `scroll` if it needs to go further.
 */
export const MAX_SCROLL_DELTA = 100;

/** Clamp a model-supplied scroll delta to `[-MAX_SCROLL_DELTA, MAX_SCROLL_DELTA]`; non-finite -> 0. */
export function clampScrollDelta(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, n));
}

export interface ManagerDeps {
  desktop: DesktopControl;
  loadDriver: () => InputDriverLoadResult;
  permissions: (prompt?: boolean) => PermissionStatus;
  audit: ActionAudit;
  /** Visualizes pointer actions with an on-screen AI cursor; defaults to a no-op. */
  cursor?: CursorIndicator;
}

/** Audit/intent context attached to a dispatched action. */
export interface DispatchContext {
  chatSessionId?: string;
  confirmed: boolean;
  /**
   * Turn-cancellation signal. Re-checked immediately before each synthetic-input
   * dispatch so an abort that arrives during the pre-action cursor settle (~1s)
   * aborts the action instead of landing native input after the user cancelled.
   */
  signal?: AbortSignal;
}

interface FrameRef {
  width: number;
  height: number;
  bounds: { x: number; y: number; width: number; height: number };
  displayId: number;
  scaleFactor: number;
}

interface SessionState {
  lastFrame: FrameRef | null;
  lastFocusedApp: string | undefined;
  lastFrontmost: ForegroundApp | undefined;
}

const DEFAULT_SESSION_KEY = '__default__';

export class ComputerUseManager {
  private readonly desktop: DesktopControl;
  private readonly loadDriver: () => InputDriverLoadResult;
  private readonly permissionsFn: (prompt?: boolean) => PermissionStatus;
  readonly audit: ActionAudit;
  private readonly cursor: CursorIndicator;

  private driverResult: InputDriverLoadResult | null = null;
  private readonly sessionState = new Map<string, SessionState>();

  constructor(deps: ManagerDeps) {
    this.desktop = deps.desktop;
    this.loadDriver = deps.loadDriver;
    this.permissionsFn = deps.permissions;
    this.audit = deps.audit;
    this.cursor = deps.cursor ?? new NoopCursorIndicator();
  }

  permissions(prompt: boolean = false): PermissionStatus {
    return this.permissionsFn(prompt);
  }

  /** Human-friendly name of the OS-resolved foreground app for display/audit. */
  getForegroundApp(chatSessionId?: string): string | undefined {
    const state = this.getSessionState(chatSessionId);
    return state.lastFrontmost?.name ?? state.lastFocusedApp;
  }

  /**
   * Every identifier the allowlist may match the foreground app against (friendly name +
   * raw process name on Windows), so a user can allowlist either form.
   */
  getForegroundAppCandidates(chatSessionId?: string): string[] {
    const state = this.getSessionState(chatSessionId);
    if (state.lastFrontmost) {
      return state.lastFrontmost.candidates;
    }
    return state.lastFocusedApp ? [state.lastFocusedApp] : [];
  }

  async refreshForegroundAppCandidates(chatSessionId?: string): Promise<string[]> {
    const frontmost = await this.desktop.getFrontmostApp().catch(() => undefined);
    const state = this.getSessionState(chatSessionId);
    state.lastFrontmost = frontmost;
    state.lastFocusedApp = frontmost?.name;
    return this.getForegroundAppCandidates(chatSessionId);
  }

  listDisplays(): DisplayInfo[] {
    return this.desktop.listDisplays();
  }

  listWindows(): Promise<WindowInfo[]> {
    return this.desktop.listWindows();
  }

  async focusWindow(
    query: { appId?: string; title?: string },
    ctx: Pick<DispatchContext, 'chatSessionId'> & Partial<Pick<DispatchContext, 'confirmed'>> = {},
  ): Promise<boolean> {
    this.ensureAccessibility();
    const ok = await this.desktop.focusWindow(query);
    if (ok) {
      const state = this.getSessionState(ctx.chatSessionId);
      const frontmost = await this.desktop.getFrontmostApp().catch(() => undefined);
      // The previous screenshot's frontmost app is stale after focus changes. Only trust
      // the OS-resolved active app; if it cannot be resolved, leave the foreground unknown
      // so the allowlist gate requires confirmation instead of trusting model-supplied
      // focus query text.
      state.lastFrontmost = frontmost;
      state.lastFocusedApp = frontmost?.name;
      const target = frontmost?.name ?? (query.appId ?? query.title ?? '').trim();
      this.record('focus_window', target || 'unknown', {
        chatSessionId: ctx.chatSessionId,
        confirmed: ctx.confirmed ?? false,
      });
    }
    // Non-pointer step, but still part of the operation: keep the AI cursor alive.
    this.cursor.ping();
    return ok;
  }

  async screenshot(
    displayId?: number,
    ctx: Pick<DispatchContext, 'chatSessionId'> = {},
  ): Promise<CaptureResult> {
    const status = this.permissions();
    if (status.screenRecording !== 'granted') {
      throw new Error(
        'Screen Recording permission is required (System Settings > Privacy & Security > Screen Recording). Restart the app after granting.',
      );
    }
    // Hide the AI cursor overlay so it never lands in the frame the model sees
    // (we no longer use setContentProtection, which is invisible on Windows).
    this.cursor.hide();
    // Start the frontmost-app probe in parallel, but re-show the AI cursor as
    // soon as the FRAME is captured rather than waiting on the (slower) app
    // query — so the overlay is hidden only for the capture itself, keeping the
    // cursor visually continuous across the operation.
    const frontmostP = this.desktop.getFrontmostApp().catch(() => undefined);
    const frame = await this.desktop.capture(displayId).finally(() => {
      // Bring the AI cursor back even if capture throws — otherwise a failed
      // screenshot would leave the overlay hidden until the next successful
      // action, violating the "hidden only for the capture itself" invariant.
      // ping() is contractually never-throw, so the finally can't mask the error.
      this.cursor.ping();
    });
    const frontmost = await frontmostP;
    const state = this.getSessionState(ctx.chatSessionId);
    state.lastFrame = {
      width: frame.width,
      height: frame.height,
      bounds: frame.bounds,
      displayId: frame.displayId,
      scaleFactor: frame.scaleFactor,
    };
    state.lastFrontmost = frontmost;
    return {
      data: frame.base64,
      mimeType: frame.mimeType,
      width: frame.width,
      height: frame.height,
      displayId: frame.displayId,
      bounds: frame.bounds,
      scaleFactor: frame.scaleFactor,
      foregroundApp: this.getForegroundApp(ctx.chatSessionId),
      displays: this.listDisplays(),
    };
  }

  /**
   * Throw an `aborted` error if the turn was cancelled. Called right before every
   * synthetic-input dispatch (in particular AFTER the pre-action cursor settle) so a
   * cancellation that arrives mid-action stops it before native input is injected.
   * The thrown error is caught by `ComputerUseTool.execute` and mapped to the same
   * `{ ok: false, error: 'aborted' }` envelope as a pre-dispatch abort.
   */
  private throwIfAborted(ctx: DispatchContext): void {
    if (ctx.signal?.aborted) {
      throw new Error('aborted');
    }
  }

  async moveMouse(imageX: number, imageY: number, ctx: DispatchContext): Promise<Point> {
    const g = this.groundPoint(imageX, imageY, ctx);
    // Show/move the AI cursor toward the target BEFORE the synthetic input, so the
    // user sees the cursor arriving rather than appearing only after the action lands.
    this.cursor.signal({ kind: 'move', point: g.logical, display: g.display });
    this.throwIfAborted(ctx);
    await this.driver().moveMouse(g.driver);
    this.record('move_mouse', `${g.driver.x},${g.driver.y}`, ctx);
    return g.driver;
  }

  async click(
    imageX: number,
    imageY: number,
    button: MouseButton,
    ctx: DispatchContext,
  ): Promise<Point> {
    const g = this.groundPoint(imageX, imageY, ctx);
    this.cursor.signal({ kind: 'click', point: g.logical, button, display: g.display });
    // Wait for the AI cursor to glide onto the target before the real click lands,
    // so the user sees "move there, then click" instead of the app reacting first.
    await this.cursor.settle();
    this.throwIfAborted(ctx);
    await this.driver().click(g.driver, button);
    this.record(button === 'right' ? 'right_click' : 'click', `${g.driver.x},${g.driver.y}`, ctx);
    return g.driver;
  }

  async doubleClick(imageX: number, imageY: number, ctx: DispatchContext): Promise<Point> {
    const g = this.groundPoint(imageX, imageY, ctx);
    this.cursor.signal({ kind: 'double', point: g.logical, display: g.display });
    await this.cursor.settle();
    this.throwIfAborted(ctx);
    await this.driver().doubleClick(g.driver);
    this.record('double_click', `${g.driver.x},${g.driver.y}`, ctx);
    return g.driver;
  }

  async drag(from: Point, to: Point, ctx: DispatchContext): Promise<{ from: Point; to: Point }> {
    const mappedFrom = this.groundPoint(from.x, from.y, ctx);
    const mappedTo = this.groundPoint(to.x, to.y, ctx);
    // Like a human: first glide to the grab point and wait for the AI cursor to
    // arrive, THEN press and drag — never start dragging before the cursor is there.
    this.cursor.signal({ kind: 'move', point: mappedFrom.logical, display: mappedFrom.display });
    await this.cursor.settle();
    this.cursor.signal({
      kind: 'drag',
      point: mappedFrom.logical,
      to: mappedTo.logical,
      display: mappedFrom.display,
    });
    this.throwIfAborted(ctx);
    await this.driver().drag(mappedFrom.driver, mappedTo.driver);
    this.record(
      'drag',
      `${mappedFrom.driver.x},${mappedFrom.driver.y}->${mappedTo.driver.x},${mappedTo.driver.y}`,
      ctx,
    );
    return { from: mappedFrom.driver, to: mappedTo.driver };
  }

  async scroll(
    imageX: number,
    imageY: number,
    dx: number,
    dy: number,
    ctx: DispatchContext,
  ): Promise<Point> {
    const g = this.groundPoint(imageX, imageY, ctx);
    this.cursor.signal({ kind: 'scroll', point: g.logical, display: g.display });
    await this.cursor.settle();
    this.throwIfAborted(ctx);
    const cdx = clampScrollDelta(dx);
    const cdy = clampScrollDelta(dy);
    await this.driver().scroll(g.driver, cdx, cdy);
    this.record('scroll', `${g.driver.x},${g.driver.y} d=${cdx},${cdy}`, ctx);
    return g.driver;
  }

  async typeText(text: string, ctx: DispatchContext): Promise<void> {
    this.ensureAccessibility();
    this.throwIfAborted(ctx);
    await this.driver().typeText(text);
    this.cursor.ping();
    this.record('type_text', `${text.length} chars`, ctx);
  }

  async pressKey(key: string, ctx: DispatchContext): Promise<void> {
    this.ensureAccessibility();
    this.throwIfAborted(ctx);
    await this.driver().pressKey(key);
    this.cursor.ping();
    this.record('press_key', key, ctx);
  }

  async hotkey(keys: string[], ctx: DispatchContext): Promise<void> {
    this.ensureAccessibility();
    this.throwIfAborted(ctx);
    await this.driver().hotkey(keys);
    this.cursor.ping();
    this.record('hotkey', keys.join('+'), ctx);
  }

  /**
   * Ground an image-space point against the last captured frame, returning both the
   * LOGICAL (DIP) screen point — used to position the on-screen AI cursor — and the
   * platform-correct DRIVER point handed to nut.js (physical px off macOS), plus the
   * display the action targets.
   */
  private groundPoint(
    imageX: number,
    imageY: number,
    ctx: DispatchContext,
  ): { logical: Point; driver: Point; display: { id: number; bounds: DisplayBounds } } {
    this.ensureAccessibility();
    const state = this.getSessionState(ctx.chatSessionId);
    if (!state.lastFrame) {
      throw new Error(
        'Take a screenshot before issuing pointer actions so coordinates can be grounded.',
      );
    }
    const frame = state.lastFrame;
    const mapped = mapImagePointToScreen({
      imagePoint: { x: imageX, y: imageY },
      imageDims: { width: frame.width, height: frame.height },
      bounds: frame.bounds,
    });
    if (!mapped.ok) {
      throw new Error(mapped.error);
    }
    const driver = this.desktop.toDriverPoint(mapped.point, frame.scaleFactor);
    return {
      logical: mapped.point,
      driver,
      display: { id: frame.displayId, bounds: frame.bounds },
    };
  }

  private getSessionState(chatSessionId?: string): SessionState {
    const key = chatSessionId?.trim() || DEFAULT_SESSION_KEY;
    let state = this.sessionState.get(key);
    if (!state) {
      state = { lastFrame: null, lastFocusedApp: undefined, lastFrontmost: undefined };
      this.sessionState.set(key, state);
    }
    return state;
  }

  private ensureAccessibility(): void {
    const error = this.accessibilityError();
    if (error) {
      throw new Error(error);
    }
  }

  /**
   * Permission error string for input-injecting (mutating) actions, or null when Accessibility is
   * granted. The tool surfaces this BEFORE the confirmation gate so the documented decision flow
   * (permission check precedes confirmation) holds: the user is never asked to approve a click/type
   * that can't run for lack of Accessibility. `ensureAccessibility` reuses it so dispatch stays
   * defended even if a caller skips the up-front check.
   */
  accessibilityError(): string | null {
    return this.permissions().accessibility === true
      ? null
      : 'Accessibility permission is required (System Settings > Privacy & Security > Accessibility) to control other apps.';
  }

  private driver(): InputDriver {
    if (!this.driverResult) {
      this.driverResult = this.loadDriver();
    }
    if (!this.driverResult.available) {
      throw new Error(
        this.driverResult.reason
          ? `Input driver unavailable: ${this.driverResult.reason}`
          : 'Input driver unavailable.',
      );
    }
    return this.driverResult.driver;
  }

  private record(action: string, target: string, ctx: DispatchContext): void {
    this.audit.record({
      chatSessionId: ctx.chatSessionId,
      action,
      target,
      confirmed: ctx.confirmed,
    });
  }
}

let singleton: ComputerUseManager | null = null;

/** Process-wide manager bound to the real desktop providers. */
export function getComputerUseManager(): ComputerUseManager {
  if (!singleton) {
    singleton = new ComputerUseManager({
      desktop: createDefaultDesktopControl(),
      loadDriver: () => loadInputDriver(),
      permissions: (prompt?: boolean) => getPermissionStatus(prompt),
      audit: getActionAudit(),
      cursor: getCursorIndicator(),
    });
  }
  return singleton;
}

/** Test seam: replace or clear the singleton. */
export function setComputerUseManagerForTesting(manager: ComputerUseManager | null): void {
  singleton = manager;
}
