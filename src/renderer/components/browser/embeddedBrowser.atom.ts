import { atom } from '@/atom';
import { embeddedBrowserApi } from '@/ipc/embeddedBrowser';
import {
  WorkspaceExplorerAtom,
  ScheduleSidepaneAtom,
  SubAgentTasksSidepaneAtom,
  MemexMemorySidepaneAtom,
} from '../chat/chat-side.atom';

// ── Embedded browser panel state (scoped per chat session) ────────────────────
//
// The browser is per chat session: `sessions[sessionId]` holds the panel state
// for that session, so switching agents shows that agent's own browsing (or
// nothing if it never opened a link). `width`/`resizing` are global layout prefs
// shared by whichever session's panel is currently visible.

/**
 * Fraction of the chat-content-wrapper the panel may occupy when resized.
 * Mirrors InlineFilePreviewPanel so both side panels feel identical.
 * When `width` is undefined the panel falls back to a 50/50 flex split.
 */
const MIN_WIDTH_RATIO = 0.3;
const MAX_WIDTH_RATIO = 0.6;

/**
 * Homepage loaded when the browser panel is opened from the header toggle for a
 * session that has never browsed anything yet (no link click). Kept consistent
 * with the address bar's search fallback (Bing).
 */
const DEFAULT_HOME = 'https://www.bing.com';

/** Per-session browser panel state. */
export interface SessionBrowser {
  /** Whether this session wants its browser panel shown (persists across switches). */
  isOpen: boolean;
  /** The URL the panel was asked to load (address bar input source). */
  url: string;
  /** Page title reported by the main-process view. */
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export interface EmbeddedBrowserState {
  sessions: Record<string, SessionBrowser>;
  /**
   * Pixel width of the panel once the user has dragged the divider. Undefined
   * means "no explicit width" → the panel uses `flex: 1` for a 50/50 split with
   * the chat content (matches InlineFilePreviewPanel's default).
   */
  width?: number;
  resizing: boolean;
}

const zeroSession: SessionBrowser = {
  isOpen: false,
  url: '',
  title: '',
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
};

const zeroState: EmbeddedBrowserState = {
  sessions: {},
  width: undefined,
  resizing: false,
};

/** Read helper: is the given session's browser panel open? */
export function isBrowserOpenFor(state: EmbeddedBrowserState, sessionId: string | null | undefined): boolean {
  return !!(sessionId && state.sessions[sessionId]?.isOpen);
}

export const EmbeddedBrowserAtom = atom(zeroState, (get, set, use) => {
  function patchSession(sessionId: string, patch: Partial<SessionBrowser>) {
    const prev = get();
    const current = prev.sessions[sessionId] ?? zeroSession;
    set({
      ...prev,
      sessions: { ...prev.sessions, [sessionId]: { ...current, ...patch } },
    });
  }

  // Opening the browser is mutually exclusive with the four singleton sidepanes
  // (Workspace Explorer / Schedules / Sub-Agent Tasks / Memex Memory). Closing
  // them here is one direction of the exclusion; the reverse (a sidepane opening
  // closes the browser) lives in ChatSide because the browser is session-scoped.
  function closeSidepanes() {
    use(WorkspaceExplorerAtom)[1].setVisible(false);
    use(ScheduleSidepaneAtom)[1].hide();
    use(SubAgentTasksSidepaneAtom)[1].hide();
    use(MemexMemorySidepaneAtom)[1].hide();
  }

  /** Open the session's panel and load a URL in its native view. */
  function open(sessionId: string, url: string) {
    // Mutually exclusive with the singleton sidepanes.
    closeSidepanes();
    patchSession(sessionId, { isOpen: true, url, isLoading: true });
    void embeddedBrowserApi.open(sessionId, url);
  }

  function navigate(sessionId: string, url: string) {
    patchSession(sessionId, { url, isLoading: true });
    void embeddedBrowserApi.navigate(sessionId, url);
  }

  /**
   * User-initiated close (X button): mark the session's panel closed. The
   * panel then unmounts and its cleanup calls the main-process `hide`, which
   * backgrounds the native view (kept alive 5 min for reuse).
   */
  function close(sessionId: string) {
    patchSession(sessionId, { isOpen: false });
  }

  function closeAllAndDestroy() {
    set({ ...get(), sessions: {}, resizing: false });
    void embeddedBrowserApi.destroyAll();
  }

  /**
   * Header entry point: toggle this session's browser panel. Opening reuses the
   * session's existing page (its panel `show` recreates/reuses the native view);
   * if the session has never browsed anything, it loads the default homepage.
   * Closing just hides the panel (view is backgrounded, not destroyed).
   */
  function toggle(sessionId: string) {
    const current = get().sessions[sessionId];
    if (current?.isOpen) {
      close(sessionId);
      return;
    }
    // Mutually exclusive with the singleton sidepanes.
    closeSidepanes();
    if (current?.url) {
      // Reuse the last page: just re-show the panel (its mount → show reuses
      // the living view or recreates it from the remembered URL).
      patchSession(sessionId, { isOpen: true });
    } else {
      // First open with no prior page → load the default homepage.
      open(sessionId, DEFAULT_HOME);
    }
  }

  function goBack(sessionId: string) {
    void embeddedBrowserApi.goBack(sessionId);
  }

  function goForward(sessionId: string) {
    void embeddedBrowserApi.goForward(sessionId);
  }

  function reload(sessionId: string) {
    // Optimistically show the loading state so the progress bar appears at once;
    // the main process's did-start/stop-loading events reconcile it.
    patchSession(sessionId, { isLoading: true });
    void embeddedBrowserApi.reload(sessionId);
  }

  /**
   * Stop the in-flight load (the reload button becomes a stop button while
   * loading). Optimistically clears `isLoading` so the button flips back
   * immediately; did-stop-loading confirms it.
   */
  function stop(sessionId: string) {
    patchSession(sessionId, { isLoading: false });
    void embeddedBrowserApi.stop(sessionId);
  }

  /** Merge navigation state pushed from the main process for a session. */
  function applyNavState(sessionId: string, next: Partial<SessionBrowser>) {
    const prev = get();
    // Ignore events for sessions that have no entry (e.g. already discarded).
    if (!prev.sessions[sessionId]) return;
    patchSession(sessionId, next);
  }

  /**
   * Reveal the panel because agent automation (the `browser` built-in tool) is
   * driving this session's native view. The main-process view is already
   * created and navigated, so we ONLY flip `isOpen` and mirror the URL — we must
   * NOT call `embeddedBrowserApi.open`, which would re-navigate the page.
   */
  function revealForAutomation(sessionId: string, url: string) {
    const current = get().sessions[sessionId];
    // No-op if already open at this URL to avoid redundant re-renders.
    if (current?.isOpen && current.url === url) return;
    // Mutually exclusive with the singleton sidepanes.
    closeSidepanes();
    patchSession(sessionId, { isOpen: true, ...(url ? { url } : null) });
  }

  /**
   * Resize the panel by dragging its left-edge divider. Mirrors
   * `InlinePreviewAtom.resize`: width is clamped to 30–60% of the
   * `.chat-content-wrapper` (the divider's parent), so the browser and the file
   * preview share the same resize feel. The `resizing` flag drives the
   * divider's `.dragging` highlight.
   */
  function startResize(event: React.MouseEvent) {
    event.preventDefault();
    const wrapperEl = (event.currentTarget as HTMLElement).parentElement;
    if (!wrapperEl) return;
    const wrapperWidth = wrapperEl.getBoundingClientRect().width;
    const startX = event.clientX;
    const startWidth = get().width ?? wrapperWidth / 2;

    const onMouseMove = (ev: MouseEvent) => {
      // Drag LEFT to grow the panel (the panel sits on the right edge).
      const delta = startX - ev.clientX;
      const minWidth = wrapperWidth * MIN_WIDTH_RATIO;
      const maxWidth = wrapperWidth * MAX_WIDTH_RATIO;
      const next = Math.min(Math.max(startWidth + delta, minWidth), maxWidth);
      set({ ...get(), width: next, resizing: true });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      set({ ...get(), resizing: false });
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  return {
    open,
    navigate,
    close,
    closeAllAndDestroy,
    toggle,
    goBack,
    goForward,
    reload,
    stop,
    applyNavState,
    revealForAutomation,
    startResize,
  };
});
