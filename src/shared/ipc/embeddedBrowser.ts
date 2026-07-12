import { connectRenderToMain, connectMainToRender } from './base';

/**
 * Pixel bounds of the renderer-side panel placeholder, reported to the main
 * process so the native WebContentsView can be positioned exactly over it.
 *
 * Values are in DIPs (CSS pixels) relative to the main window content area —
 * i.e. straight from `getBoundingClientRect()`. Do NOT multiply by
 * devicePixelRatio; WebContentsView.setBounds expects DIPs.
 */
export interface EmbeddedBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Navigation state pushed from main → renderer after each navigation.
 *
 * `sessionId` identifies which chat session's view emitted the event, so the
 * renderer can route it to the correct per-session state entry (multiple
 * sessions may have a backgrounded view alive at once).
 */
export interface EmbeddedBrowserNavState {
  sessionId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

// ──────────────────────────────────────────────
// Renderer → Main
// ──────────────────────────────────────────────
//
// The browser is scoped per chat session: every call carries the `sessionId`
// it applies to. The main process keeps one WebContentsView per session and
// shows exactly one (the active session's) at a time.

type RenderToMain = {
  /** Create/reuse the session's view, bring it to the foreground, and load a URL. */
  open: { call: [sessionId: string, url: string]; return: void };
  /** Navigate the session's existing view to a URL without changing visibility. */
  navigate: { call: [sessionId: string, url: string]; return: void };
  /**
   * Bring the session's view to the foreground (reuse if alive, recreate +
   * reload its last URL if it was reclaimed). Called when the panel mounts or
   * the user switches back to the session.
   */
  show: { call: [sessionId: string]; return: void };
  /**
   * Detach the session's view (background it). Starts a 5-minute idle timer
   * after which the view is destroyed. Called when the panel unmounts.
   */
  hide: { call: [sessionId: string]; return: void };
  /** Position the session's foreground view to match the panel placeholder bounds. */
  setBounds: { call: [sessionId: string, bounds: EmbeddedBrowserBounds]; return: void };
  goBack: { call: [sessionId: string]; return: void };
  goForward: { call: [sessionId: string]; return: void };
  reload: { call: [sessionId: string]; return: void };
  /** Stop the session's in-flight load (the reload button becomes a stop button while loading). */
  stop: { call: [sessionId: string]; return: void };
  /** Renderer reports the currently mounted chat session so agent automation can stay visible. */
  setActiveSession: { call: [sessionId: string | null]; return: void };
  /** Destroy every main-process WebContentsView owned by the embedded browser manager. */
  destroyAll: { call: []; return: void };
};

// ──────────────────────────────────────────────
// Main → Renderer
// ──────────────────────────────────────────────

/**
 * Emitted when the main process drives a session's browser on the agent's
 * behalf (built-in `browser` tool) and the renderer should auto-open the panel
 * so the user can watch. The native view is already created/navigated by the
 * main process; the renderer must only reveal the panel and mirror the URL —
 * it must NOT re-issue `open` (that would double-navigate).
 */
export interface EmbeddedBrowserPanelOpenRequest {
  sessionId: string;
  url: string;
}

export type MainToRender = {
  /** Emitted after navigation / title / loading changes (carries sessionId). */
  navStateChanged: EmbeddedBrowserNavState;
  /** Emitted when agent automation wants the panel revealed for a session. */
  panelOpenRequested: EmbeddedBrowserPanelOpenRequest;
};

// ──────────────────────────────────────────────
// Export connectors
// ──────────────────────────────────────────────

export const renderToMain = connectRenderToMain<RenderToMain>('embeddedBrowser');
export const mainToRender = connectMainToRender<MainToRender>('embeddedBrowser');
