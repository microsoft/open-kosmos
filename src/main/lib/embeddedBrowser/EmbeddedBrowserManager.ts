/**
 * EmbeddedBrowserManager — owns the in-app browser views shown as a side panel
 * beside the chat. The browser is **scoped per chat session**: each session
 * gets its own Electron WebContentsView so different agents' browsing never
 * interferes.
 *
 * Lifecycle (one view per sessionId):
 *  - Foreground: attached to mainWindow.contentView, bounds tracked. Exactly
 *    one session is foreground at a time (the active chat session's panel).
 *  - Background: detached (removeChildView) when its panel unmounts; a 5-minute
 *    idle timer then destroys it to reclaim memory.
 *  - Destroyed: webContents closed, removed from the map. The last URL is kept
 *    so a later `show` recreates the view and reloads it.
 *
 * Views are created lazily (only on first link click, never on new-session) and
 * reused if still alive. All views share one persistent session partition so
 * cookies, site data and cached images/files are shared across every view.
 *
 * Because a WebContentsView always floats above the DOM, "closing"/backgrounding
 * a panel detaches the view so it never covers the chat.
 */

import { WebContentsView, session, shell, type BrowserWindow } from 'electron';
import {
  mainToRender,
  type EmbeddedBrowserBounds,
  type EmbeddedBrowserNavState,
} from '@shared/ipc/embeddedBrowser';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();
type BrowserRuntimeCleanupCallback = (sessionId?: string) => void;
const runtimeCleanupCallbacks = new Set<BrowserRuntimeCleanupCallback>();

export function registerEmbeddedBrowserRuntimeCleanup(callback: BrowserRuntimeCleanupCallback): void {
  runtimeCleanupCallbacks.add(callback);
}

function notifyRuntimeCleanup(sessionId?: string): void {
  for (const callback of runtimeCleanupCallbacks) {
    try {
      callback(sessionId);
    } catch (err) {
      logger.warn(`[EmbeddedBrowser] runtime cleanup callback failed: ${String(err)}`);
    }
  }
}

const FALLBACK_CHROME_MAJOR_VERSION = '149';
/**
 * Shared persistent partition for every embedded browser view → shared cookies,
 * site data, and cached images/files across all sessions/tabs.
 */
const EMBEDDED_BROWSER_PARTITION = 'persist:openkosmos-embedded-browser';
const MAX_NETWORK_REQUESTS = 200;
let chromeIdentityConfigured = false;

interface SessionView {
  view: WebContentsView;
  lastBounds: EmbeddedBrowserBounds | null;
  idleTimer: NodeJS.Timeout | null;
  /** Whether the CDP debugger is currently attached (for agent input). */
  debuggerAttached: boolean;
  /** Whether CDP Network is enabled before automation navigation traffic. */
  networkEnabled: boolean;
  debuggerMessageListener?: (event: unknown, method: string, params: Record<string, unknown>) => void;
  diagnostics: EmbeddedBrowserDiagnostic[];
  networkEvents: EmbeddedBrowserNetworkEvent[];
  networkRequests: Map<string, { url: string; method?: string; headers?: Record<string, string> }>;
}

export interface EmbeddedBrowserDiagnostic {
  type: 'console' | 'page-error' | 'load-failure';
  message: string;
  level?: string;
  url?: string;
  line?: number;
  timestamp: number;
}

export interface EmbeddedBrowserNetworkEvent {
  type: 'response' | 'failure';
  url: string;
  status?: number;
  statusText?: string;
  method?: string;
  resourceType?: string;
  errorText?: string;
  requestId?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  timing?: Record<string, unknown>;
  timestamp: number;
}

export interface EmbeddedBrowserDownloadEvent {
  type: 'started' | 'updated' | 'done';
  filename: string;
  url: string;
  mimeType?: string;
  savePath?: string;
  receivedBytes?: number;
  totalBytes?: number;
  state?: string;
  timestamp: number;
}

export class EmbeddedBrowserManager {
  /** Idle time after which a backgrounded view is destroyed. */
  private static readonly IDLE_MS = 5 * 60 * 1000;
  /** Max time to wait for a navigation to settle before resolving anyway. */
  private static readonly NAV_TIMEOUT_MS = 30 * 1000;
  /**
   * Shared persistent partition for every embedded browser view → shared
   * cookies, site data, and cached images/files across all sessions/tabs.
   */
  private static readonly PARTITION = EMBEDDED_BROWSER_PARTITION;

  /** Living views keyed by chat sessionId. */
  private views = new Map<string, SessionView>();
  /** Last loaded URL per session — survives view destruction for later reuse. */
  private lastUrls = new Map<string, string>();
  /** Last reported panel bounds per session — may arrive before view creation. */
  private lastBounds = new Map<string, EmbeddedBrowserBounds>();
  /** The single session whose view is currently attached, or null. */
  private foregroundSessionId: string | null = null;
  /** Chat session currently rendered by the renderer. Agent automation must match this. */
  private activeSessionId: string | null = null;
  private downloadEvents = new Map<string, EmbeddedBrowserDownloadEvent[]>();
  private webContentsToSession = new Map<number, string>();
  private downloadListenerInstalled = false;
  private getWindow: () => BrowserWindow | null;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
    this.installDownloadListener();
  }

  // ── public API (one entry per IPC method, all sessionId-scoped) ──────────

  /** Create/reuse the session's view, foreground it, and load a URL. */
  async open(sessionId: string, url: string): Promise<void> {
    assertWebNavigationUrl(url);
    this.ensureView(sessionId);
    this.foreground(sessionId);
    this.navigate(sessionId, url);
  }

  navigate(sessionId: string, url: string): void {
    assertWebNavigationUrl(url);
    const sv = this.views.get(sessionId);
    if (!sv) return;
    this.lastUrls.set(sessionId, url);
    void sv.view.webContents.loadURL(url).catch((err) => {
      logger.warn(`[EmbeddedBrowser] loadURL failed for ${redactEmbeddedBrowserDiagnosticUrl(url)}: ${String(err)}`);
    });
  }

  /**
   * Bring the session's view to the foreground. Reuses a living view (keeping
   * its page + history); if the view was reclaimed, recreates it and reloads
   * the session's last URL. Called when the panel mounts or the user switches
   * back to the session.
   */
  async show(sessionId: string): Promise<void> {
    const existed = this.views.has(sessionId);
    const sv = this.ensureView(sessionId);
    if (!sv) return;
    if (!existed) {
      const last = this.lastUrls.get(sessionId);
      if (last) this.navigate(sessionId, last);
    }
    this.foreground(sessionId);
  }

  /**
   * Background the session's view (detach) and start the idle-destroy timer.
   * Called when the panel unmounts (session switch or user close).
   */
  hide(sessionId: string): void {
    if (this.foregroundSessionId === sessionId) {
      this.detach(sessionId);
      this.foregroundSessionId = null;
    }
    this.startIdle(sessionId);
  }

  setBounds(sessionId: string, bounds: EmbeddedBrowserBounds): void {
    this.lastBounds.set(sessionId, bounds);
    const sv = this.views.get(sessionId);
    if (!sv) return;
    sv.lastBounds = bounds;
    if (this.foregroundSessionId === sessionId) {
      sv.view.setBounds(this.roundBounds(bounds));
    }
  }

  goBack(sessionId: string): void {
    const wc = this.views.get(sessionId)?.view.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  goForward(sessionId: string): void {
    const wc = this.views.get(sessionId)?.view.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(sessionId: string): void {
    this.views.get(sessionId)?.view.webContents.reload();
  }

  /** Stop the session's in-flight load (mirrors the browser stop button). */
  stop(sessionId: string): void {
    this.views.get(sessionId)?.view.webContents.stop();
  }

  getNavState(sessionId: string): EmbeddedBrowserNavState | null { return this.views.has(sessionId) ? this.readNavState(sessionId, true) : null; }
  getRawNavState(sessionId: string): EmbeddedBrowserNavState | null { return this.views.has(sessionId) ? this.readNavState(sessionId, false) : null; }

  setActiveSession(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  /** Destroy every view and forget remembered page state (disable/teardown path). */
  destroyAll(): void {
    for (const sessionId of Array.from(this.views.keys())) {
      this.destroyView(sessionId);
    }
    this.lastUrls.clear();
    this.lastBounds.clear();
    this.downloadEvents.clear();
    this.foregroundSessionId = null;
    notifyRuntimeCleanup();
  }

  destroySession(sessionId: string): void {
    this.destroyView(sessionId);
    this.lastUrls.delete(sessionId);
    this.lastBounds.delete(sessionId);
    this.downloadEvents.delete(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    notifyRuntimeCleanup(sessionId);
  }

  // ── agent automation API (driven by the built-in `browser` tool) ──────────

  /** Create/reuse the view, reveal it, load when needed, and return nav state. */
  async ensureViewForAutomation(
    sessionId: string,
    url?: string,
    signal?: AbortSignal,
  ): Promise<EmbeddedBrowserNavState> {
    this.assertActiveSession(sessionId);

    const existed = this.views.has(sessionId);
    const sv = this.ensureView(sessionId);
    if (!sv) throw new Error('Embedded browser view could not be created');

    // Keep the view alive while the agent is using it.
    this.clearIdle(sessionId);
    this.foreground(sessionId);

    // When reused after an idle-reclaim we must reload the remembered page so
    // subsequent actions see real content, not a blank recreated view.
    const target = url ?? (!existed ? this.lastUrls.get(sessionId) : undefined);
    // Reveal the renderer panel, mirroring the best-known URL.
    this.requestPanelOpen(sessionId, target ?? sv.view.webContents.getURL());

    if (target) {
      await this.enableNetworkDiagnostics(sessionId);
      await this.loadAndWait(sessionId, target, signal);
    } else {
      await this.waitForReady(sessionId, signal);
    }
    this.assertActiveSession(sessionId);
    return this.readNavState(sessionId, true);
  }

  /** Whether this session has a live or idle-reclaimed page worth capturing. */
  hasNavigablePage(sessionId: string): boolean {
    return this.views.has(sessionId) || this.lastUrls.has(sessionId);
  }

  /** Capture the current page as a PNG, returned as raw base64 (no data: prefix). */
  async captureScreenshot(
    sessionId: string,
    rect?: { x: number; y: number; width: number; height: number },
  ): Promise<{ data: string; mimeType: string }> {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    this.clearIdle(sessionId);
    // Defensive net behind the tool's `hasNavigablePage` gate: a view only has a
    // non-zero size once its renderer panel has reported real bounds, and a 0×0
    // view has never composited, so `capturePage()` would return an empty PNG.
    // Report honestly instead of capturing a blank — matching how the other
    // actions require a live page.
    const { width, height } = sv.view.getBounds();
    if (width <= 0 || height <= 0) {
      throw new Error(
        'The embedded browser has no visible page to capture yet. ' +
          'Call the navigate action first.',
      );
    }
    const image = await sv.view.webContents.capturePage(rect ? this.roundBounds(rect) : undefined);
    return { data: image.toPNG().toString('base64'), mimeType: 'image/png' };
  }

  setAutomationViewport(sessionId: string, width: number, height: number): EmbeddedBrowserBounds {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    const current = sv.view.getBounds();
    const bounds = this.roundBounds({
      x: current.x,
      y: current.y,
      width,
      height,
    });
    sv.view.setBounds(bounds);
    sv.lastBounds = bounds;
    this.lastBounds.set(sessionId, bounds);
    return bounds;
  }

  getAutomationViewport(sessionId: string): EmbeddedBrowserBounds {
    this.assertActiveSession(sessionId);
    return this.roundBounds(this.requireView(sessionId).view.getBounds());
  }

  getDiagnostics(sessionId: string): {
    readyState: string | null;
    url: string;
    title: string;
    isLoading: boolean;
    recentEvents: EmbeddedBrowserDiagnostic[];
    networkEvents: EmbeddedBrowserNetworkEvent[];
    downloads: EmbeddedBrowserDownloadEvent[];
  } {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    const wc = sv.view.webContents;
    return {
      readyState: null,
      url: redactEmbeddedBrowserDiagnosticUrl(wc.getURL()),
      title: wc.getTitle(),
      isLoading: wc.isLoading(),
      recentEvents: [...sv.diagnostics],
      networkEvents: [...sv.networkEvents],
      downloads: [...(this.downloadEvents.get(sessionId) ?? [])],
    };
  }

  getDownloads(sessionId: string): EmbeddedBrowserDownloadEvent[] {
    this.assertActiveSession(sessionId);
    return [...(this.downloadEvents.get(sessionId) ?? [])];
  }

  /**
   * Evaluate an expression in the page's main world and return its result.
   * `userGesture: true` so gesture-gated APIs behave as if user-initiated.
   */
  async executeJs(sessionId: string, expression: string): Promise<unknown> {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    this.clearIdle(sessionId);
    return sv.view.webContents.executeJavaScript(expression, true);
  }

  /**
   * Attach the Chrome DevTools Protocol debugger once (guarded against the
   * exclusive single-client attach), enabling trusted input dispatch.
   */
  ensureDebugger(sessionId: string): void {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    if (sv.debuggerAttached) return;
    const dbg = sv.view.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    if (!sv.debuggerMessageListener) {
      sv.debuggerMessageListener = (_event, method, params) => {
        if (method === 'Network.requestWillBeSent') {
          if (typeof params?.requestId === 'string') {
            const request = params.request as { url?: string; method?: string; headers?: Record<string, string> } | undefined;
            sv.networkRequests.set(params.requestId, {
              url: redactEmbeddedBrowserDiagnosticUrl(request?.url),
              method: request?.method,
              headers: redactNetworkHeaders(request?.headers),
            });
            while (sv.networkRequests.size > MAX_NETWORK_REQUESTS) {
              const oldestRequestId = sv.networkRequests.keys().next().value;
              if (oldestRequestId === undefined) break;
              sv.networkRequests.delete(oldestRequestId);
            }
          }
        } else if (method === 'Network.responseReceived') {
          const response = params?.response as { url?: string; status?: number; statusText?: string; headers?: Record<string, string>; timing?: Record<string, unknown> } | undefined;
          const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
          const request = requestId ? sv.networkRequests.get(requestId) : undefined;
          this.pushNetworkEvent(sessionId, {
            type: 'response',
            requestId,
            url: redactEmbeddedBrowserDiagnosticUrl(response?.url),
            status: response?.status,
            statusText: response?.statusText,
            method: request?.method,
            resourceType: typeof params?.type === 'string' ? params.type : undefined,
            requestHeaders: request?.headers,
            responseHeaders: redactNetworkHeaders(response?.headers),
            timing: response?.timing,
          });
          if (requestId) sv.networkRequests.delete(requestId);
        } else if (method === 'Network.loadingFailed') {
          const requestId = typeof params?.requestId === 'string' ? params.requestId : '';
          const request = requestId ? sv.networkRequests.get(requestId) : undefined;
          this.pushNetworkEvent(sessionId, {
            type: 'failure',
            requestId,
            url: request?.url ?? redactEmbeddedBrowserDiagnosticUrl(requestId),
            method: request?.method,
            errorText: typeof params?.errorText === 'string' ? params.errorText : undefined,
            resourceType: typeof params?.type === 'string' ? params.type : undefined,
            requestHeaders: request?.headers,
          });
          if (requestId) sv.networkRequests.delete(requestId);
        }
      };
      dbg.on('message', sv.debuggerMessageListener);
    }
    sv.debuggerAttached = true;
  }

  /** Send a CDP command (auto-attaching the debugger first). */
  async sendCdpCommand(
    sessionId: string,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    this.ensureDebugger(sessionId);
    this.clearIdle(sessionId);
    return sv.view.webContents.debugger.sendCommand(method, params);
  }

  async enableNetworkDiagnostics(sessionId: string): Promise<void> {
    this.assertActiveSession(sessionId);
    const sv = this.requireView(sessionId);
    if (sv.networkEnabled) return;
    try {
      this.ensureDebugger(sessionId); await sv.view.webContents.debugger.sendCommand('Network.enable', {}); sv.networkEnabled = true;
    } catch (err) {
      const message = `Network diagnostics unavailable: ${err instanceof Error ? err.message : String(err)}`; this.pushDiagnostic(sessionId, { type: 'console', level: 'warning', message }); logger.warn(`[EmbeddedBrowser] ${message}`);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private installDownloadListener(): void {
    if (this.downloadListenerInstalled) return;
    this.downloadListenerInstalled = true;
    let embeddedSession: Electron.Session | null = null;
    try {
      embeddedSession = typeof session?.fromPartition === 'function'
        ? session.fromPartition(EmbeddedBrowserManager.PARTITION)
        : null;
    } catch {
      return;
    }
    if (!embeddedSession) return;
    embeddedSession.on?.('will-download', (_event, item, webContents) => {
      const sessionId = this.webContentsToSession.get(webContents?.id);
      if (!sessionId) return;
      const record = (type: EmbeddedBrowserDownloadEvent['type'], state?: string) => {
        this.pushDownloadEvent(sessionId, {
          type,
          filename: typeof item.getFilename === 'function' ? item.getFilename() : '',
          url: redactEmbeddedBrowserDiagnosticUrl(typeof item.getURL === 'function' ? item.getURL() : ''),
          mimeType: typeof item.getMimeType === 'function' ? item.getMimeType() : undefined,
          savePath: undefined,
          receivedBytes: typeof item.getReceivedBytes === 'function' ? item.getReceivedBytes() : undefined,
          totalBytes: typeof item.getTotalBytes === 'function' ? item.getTotalBytes() : undefined,
          state,
        });
      };
      record('started');
      item.on?.('updated', (_itemEvent, state) => record('updated', String(state)));
      item.once?.('done', (_itemEvent, state) => record('done', String(state)));
    });
  }

  /** Lazily create the per-session WebContentsView and wire its events. */
  private ensureView(sessionId: string): SessionView | null {
    const existing = this.views.get(sessionId);
    if (existing) return existing;

    configureEmbeddedBrowserChromeIdentity();

    const view = new WebContentsView({
      webPreferences: {
        partition: EmbeddedBrowserManager.PARTITION,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });

    const wc = view.webContents;
    this.webContentsToSession.set(wc.id, sessionId);
    wc.setUserAgent(buildChromeUserAgent());

    // Popups inside the browsed page go to the system browser to avoid
    // recursively spawning more embedded panels.
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebNavigationUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    wc.on('will-navigate', (event, url) => {
      if (!isWebNavigationUrl(url)) {
        event.preventDefault();
        logger.warn(`[EmbeddedBrowser] blocked non-web navigation: ${url}`);
      }
    });
    wc.on('will-redirect', (event, url) => {
      if (!isWebNavigationUrl(url)) {
        event.preventDefault();
        logger.warn(`[EmbeddedBrowser] blocked non-web redirect: ${url}`);
      }
    });

    const pushState = () => this.emitNavState(sessionId);
    wc.on('did-navigate', pushState);
    wc.on('did-navigate-in-page', pushState);
    wc.on('page-title-updated', pushState);
    wc.on('did-start-loading', pushState);
    wc.on('did-stop-loading', pushState);
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      if (errorCode === -3 || errorDescription === 'ERR_ABORTED') {
        pushState();
        return;
      }
      this.pushDiagnostic(sessionId, {
        type: 'load-failure',
        message: `${errorCode} ${errorDescription}`,
        url: redactEmbeddedBrowserDiagnosticUrl(validatedURL),
      });
      logger.warn(
        `[EmbeddedBrowser] main-frame load failed for ${redactEmbeddedBrowserDiagnosticUrl(validatedURL)}: ` +
        `${errorCode} ${errorDescription}`,
      );
      pushState();
    });
    wc.on('console-message', (_event, level, message, line, sourceId) => {
      const levelText = typeof level === 'number' ? ({ 0: 'debug', 1: 'info', 2: 'warning', 3: 'error' } as Record<number, string>)[level] ?? String(level) : String(level);
      if (typeof level === 'number' && level <= 1) return;
      if (levelText === 'debug' || levelText === 'log' || levelText === 'info') return;
      this.pushDiagnostic(sessionId, {
        type: 'console',
        level: levelText,
        message: redactDiagnosticText(String(message)),
        line: typeof line === 'number' ? line : undefined,
        url: typeof sourceId === 'string' ? redactEmbeddedBrowserDiagnosticUrl(sourceId) : undefined,
      });
    });
    wc.on('render-process-gone', (_event, details) => {
      this.pushDiagnostic(sessionId, {
        type: 'page-error',
        message: `Render process gone: ${details?.reason ?? 'unknown'}`,
      });
    });

    const sv: SessionView = {
      view,
      lastBounds: this.lastBounds.get(sessionId) ?? null,
      idleTimer: null,
      debuggerAttached: false,
      networkEnabled: false,
      debuggerMessageListener: undefined,
      diagnostics: [],
      networkEvents: [],
      networkRequests: new Map(),
    };
    this.views.set(sessionId, sv);
    return sv;
  }

  /**
   * Like `ensureView` but throws a typed error when no view exists and one
   * cannot be made — used by automation paths that must operate on a live page.
   */
  private requireView(sessionId: string): SessionView {
    const sv = this.views.get(sessionId);
    if (!sv) {
      throw new Error(
        `No embedded browser for this session. Call the navigate action first.`,
      );
    }
    return sv;
  }

  private assertActiveSession(sessionId: string): void {
    if (this.activeSessionId !== sessionId) {
      throw new Error('Embedded browser automation is only available for the active chat session.');
    }
  }

  /** Attach the session's view, detaching any other foreground view first. */
  private foreground(sessionId: string): void {
    const win = this.getWindow();
    const sv = this.views.get(sessionId);
    if (!win || !sv || win.isDestroyed()) return;

    // Only one native view may be attached at a time.
    if (this.foregroundSessionId && this.foregroundSessionId !== sessionId) {
      this.detach(this.foregroundSessionId);
    }
    if (this.foregroundSessionId !== sessionId) {
      win.contentView.addChildView(sv.view);
    }
    this.foregroundSessionId = sessionId;
    this.clearIdle(sessionId);
    if (sv.lastBounds) sv.view.setBounds(this.roundBounds(sv.lastBounds));
  }

  /** Detach a session's view from the window content (idempotent, guarded). */
  private detach(sessionId: string): void {
    const win = this.getWindow();
    const sv = this.views.get(sessionId);
    if (!win || !sv || win.isDestroyed()) return;
    try {
      win.contentView.removeChildView(sv.view);
    } catch (err) {
      logger.warn(`[EmbeddedBrowser] detach failed: ${String(err)}`);
    }
  }
  /** Start (or restart) the idle-destroy timer for a backgrounded view. */
  private startIdle(sessionId: string): void {
    const sv = this.views.get(sessionId);
    if (!sv) return;
    this.clearIdle(sessionId);
    sv.idleTimer = setTimeout(
      () => this.destroyView(sessionId),
      EmbeddedBrowserManager.IDLE_MS,
    );
  }

  private clearIdle(sessionId: string): void {
    const sv = this.views.get(sessionId);
    if (sv?.idleTimer) {
      clearTimeout(sv.idleTimer);
      sv.idleTimer = null;
    }
  }

  /** Tear down a view; keep its last URL so a later `show` can recreate it. */
  private destroyView(sessionId: string): void {
    const sv = this.views.get(sessionId);
    if (!sv) return;
    this.clearIdle(sessionId);
    this.detach(sessionId);
    if (this.foregroundSessionId === sessionId) this.foregroundSessionId = null;
    try {
      // Detach the CDP debugger before closing so we never leak an attached
      // client across recreation of the view.
      if (sv.debuggerAttached && !sv.view.webContents.isDestroyed()) {
        const dbg = sv.view.webContents.debugger;
        if (sv.debuggerMessageListener) {
          dbg.off('message', sv.debuggerMessageListener);
          sv.debuggerMessageListener = undefined;
        }
        if (dbg.isAttached()) dbg.detach();
      }
    } catch (err) {
      logger.warn(`[EmbeddedBrowser] debugger detach failed: ${String(err)}`);
    }
    sv.debuggerAttached = false;
    if (!sv.view.webContents.isDestroyed() && isWebNavigationUrl(sv.view.webContents.getURL())) this.lastUrls.set(sessionId, sv.view.webContents.getURL());
    try {
      if (!sv.view.webContents.isDestroyed()) sv.view.webContents.close();
    } catch (err) {
      logger.warn(`[EmbeddedBrowser] destroy failed: ${String(err)}`);
    }
    this.views.delete(sessionId);
    this.webContentsToSession.delete(sv.view.webContents.id);
  }

  private emitNavState(sessionId: string): void {
    const win = this.getWindow();
    const wc = this.views.get(sessionId)?.view.webContents;
    if (!win || !wc || win.isDestroyed() || wc.isDestroyed()) return;
    mainToRender.bindWebContents(win.webContents).navStateChanged({
      sessionId,
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
    });
  }

  /**
   * Ask the renderer to reveal the panel for this session (agent automation).
   * The native view is already created/navigated here, so the renderer must
   * only flip the panel open and mirror the URL — never re-issue `open`.
   */
  private requestPanelOpen(sessionId: string, url: string): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    mainToRender.bindWebContents(win.webContents).panelOpenRequested({ sessionId, url });
  }

  /** Load a URL and resolve once the main-frame finishes (or fails) loading. */
  private loadAndWait(sessionId: string, url: string, signal?: AbortSignal): Promise<void> {
    assertWebNavigationUrl(url);
    const sv = this.requireView(sessionId);
    const wc = sv.view.webContents;
    this.lastUrls.set(sessionId, url);
    if (signal?.aborted) {
      wc.stop();
      return Promise.reject(new Error('aborted'));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        wc.off('did-finish-load', onFinish);
        wc.off('did-fail-load', onFail);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        wc.stop();
        cleanup();
        reject(new Error('aborted'));
      };
      const onFinish = () => done();
      const onFail = (
        _e: unknown,
        _code: number,
        _desc: string,
        _url: string,
        isMainFrame: boolean,
      ) => {
        if (isMainFrame) done();
      };
      // Cap the wait so a hung load never blocks the agent indefinitely.
      const timer = setTimeout(done, EmbeddedBrowserManager.NAV_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });
      wc.on('did-finish-load', onFinish);
      wc.on('did-fail-load', onFail);
      void wc.loadURL(url).catch(() => done());
    });
  }

  /** Resolve once the view is not actively loading (or immediately if idle). */
  private waitForReady(sessionId: string, signal?: AbortSignal): Promise<void> {
    const sv = this.requireView(sessionId);
    const wc = sv.view.webContents;
    if (!wc.isLoading()) return Promise.resolve();
    if (signal?.aborted) {
      wc.stop();
      return Promise.reject(new Error('aborted'));
    }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (cb: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        wc.off('did-stop-loading', done);
        cb();
      };
      const done = () => {
        finish(resolve);
      };
      const onAbort = () => finish(() => { wc.stop(); reject(new Error('aborted')); });
      const timer = setTimeout(done, EmbeddedBrowserManager.NAV_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });
      wc.on('did-stop-loading', done);
    });
  }

  /** Snapshot the current navigation state for an automation result. */
  private readNavState(sessionId: string, redactUrl: boolean): EmbeddedBrowserNavState {
    const wc = this.requireView(sessionId).view.webContents;
    const url = wc.getURL();
    return {
      sessionId,
      url: redactUrl ? redactEmbeddedBrowserDiagnosticUrl(url) : url,
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
    };
  }

  private pushDiagnostic(
    sessionId: string,
    event: Omit<EmbeddedBrowserDiagnostic, 'timestamp'>,
  ): void {
    const sv = this.views.get(sessionId);
    if (!sv) return;
    sv.diagnostics.push({ ...event, timestamp: Date.now() });
    if (sv.diagnostics.length > 50) {
      sv.diagnostics.splice(0, sv.diagnostics.length - 50);
    }
  }

  private pushNetworkEvent(
    sessionId: string,
    event: Omit<EmbeddedBrowserNetworkEvent, 'timestamp'>,
  ): void {
    const sv = this.views.get(sessionId);
    if (!sv) return;
    sv.networkEvents.push({ ...event, timestamp: Date.now() });
    if (sv.networkEvents.length > 100) {
      sv.networkEvents.splice(0, sv.networkEvents.length - 100);
    }
  }

  private pushDownloadEvent(
    sessionId: string,
    event: Omit<EmbeddedBrowserDownloadEvent, 'timestamp'>,
  ): void {
    const events = this.downloadEvents.get(sessionId) ?? [];
    events.push({ ...event, timestamp: Date.now() });
    if (events.length > 100) events.splice(0, events.length - 100);
    this.downloadEvents.set(sessionId, events);
  }

  private roundBounds(bounds: EmbeddedBrowserBounds): EmbeddedBrowserBounds {
    return {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
  }
}

// ── singleton accessor ───────────────────────────────────────────────────────
//
// The manager is created once at startup (see startup/ipc) and stored here so
// main-process code that cannot reach the startup closure — notably the
// agent-facing `browser` built-in tool — can obtain the live instance.

let instance: EmbeddedBrowserManager | null = null;

/** Create the singleton manager (call once during main-window startup). */
export function initEmbeddedBrowserManager(
  getWindow: () => BrowserWindow | null,
): EmbeddedBrowserManager {
  instance = new EmbeddedBrowserManager(getWindow);
  return instance;
}

/** Get the singleton manager, or null if startup has not created it yet. */
export function getEmbeddedBrowserManager(): EmbeddedBrowserManager | null {
  return instance;
}

function configureEmbeddedBrowserChromeIdentity(): void {
  if (chromeIdentityConfigured) return;

  chromeIdentityConfigured = true;
  const embeddedSession = session.fromPartition(EMBEDDED_BROWSER_PARTITION);
  embeddedSession.setUserAgent(buildChromeUserAgent());
  embeddedSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      setRequestHeader(requestHeaders, 'User-Agent', buildChromeUserAgent());
      setRequestHeader(requestHeaders, 'sec-ch-ua', buildChromeBrandsHeader());
      setRequestHeader(requestHeaders, 'sec-ch-ua-mobile', '?0');
      setRequestHeader(requestHeaders, 'sec-ch-ua-platform', `"${getChromePlatformName()}"`);
      setRequestHeaderIfPresent(requestHeaders, 'sec-ch-ua-arch', `"${getChromeArchitecture()}"`);
      setRequestHeaderIfPresent(requestHeaders, 'sec-ch-ua-bitness', '"64"');
      setRequestHeaderIfPresent(
        requestHeaders,
        'sec-ch-ua-full-version',
        `"${getChromeFullVersion()}"`,
      );
      setRequestHeaderIfPresent(
        requestHeaders,
        'sec-ch-ua-full-version-list',
        buildChromeFullVersionListHeader(),
      );
      callback({ requestHeaders });
    },
  );
}

function buildChromeUserAgent(): string {
  return `Mozilla/5.0 (${getChromePlatformToken()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${getChromeMajorVersion()}.0.0.0 Safari/537.36`;
}

function buildChromeBrandsHeader(): string {
  const majorVersion = getChromeMajorVersion();
  return `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="24"`;
}

function buildChromeFullVersionListHeader(): string {
  const fullVersion = getChromeFullVersion();
  return `"Google Chrome";v="${fullVersion}", "Chromium";v="${fullVersion}", "Not_A Brand";v="24.0.0.0"`;
}

function getChromeMajorVersion(): string {
  return getChromeFullVersion().split('.')[0] || FALLBACK_CHROME_MAJOR_VERSION;
}

function getChromeFullVersion(): string {
  return process.versions.chrome || `${FALLBACK_CHROME_MAJOR_VERSION}.0.0.0`;
}

function getChromePlatformToken(): string {
  if (process.platform === 'win32') {
    return process.arch === 'arm64'
      ? 'Windows NT 10.0; ARM64'
      : 'Windows NT 10.0; Win64; x64';
  }
  return process.arch === 'arm64'
    ? 'Macintosh; ARM Mac OS X 10_15_7'
    : 'Macintosh; Intel Mac OS X 10_15_7';
}

function getChromePlatformName(): string { return process.platform === 'win32' ? 'Windows' : 'macOS'; }

function getChromeArchitecture(): string { return process.arch === 'arm64' ? 'arm' : 'x86'; }

function assertWebNavigationUrl(url: string): void {
  if (url === 'about:blank') return; // safe empty bootstrap page, allowed
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Embedded browser navigation requires a valid http or https URL.');
  }
  if (!isParsedWebNavigationUrl(parsed)) {
    throw new Error('Embedded browser navigation only supports http and https URLs.');
  }
}

function isWebNavigationUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isParsedWebNavigationUrl(parsed);
}

function isParsedWebNavigationUrl(parsed: URL): boolean {
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function setRequestHeader(headers: Record<string, string>, headerName: string, value: string): void {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === headerName.toLowerCase());
  headers[existingKey ?? headerName] = value;
}

function setRequestHeaderIfPresent(headers: Record<string, string>, headerName: string, value: string): void {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === headerName.toLowerCase());
  if (existingKey) headers[existingKey] = value;
}

const REDACTED_HEADER_VALUE = '[redacted]', SENSITIVE_NETWORK_HEADER_PATTERN = /(^|[-_])(auth|authorization|cookie|csrf|xsrf|key|secret|session|token)($|[-_])/i, SENSITIVE_URL_PARAM_PATTERN = /(^|[-_])(access_token|auth|authorization|code|cookie|csrf|xsrf|key|pass|password|pwd|secret|session|sig|signature|token)($|[-_])/i;

function redactNetworkHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) redacted[key] = SENSITIVE_NETWORK_HEADER_PATTERN.test(key) ? REDACTED_HEADER_VALUE : redactDiagnosticText(String(value));
  return redacted;
}
export function redactEmbeddedBrowserDiagnosticUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.username) url.username = REDACTED_HEADER_VALUE; if (url.password) url.password = REDACTED_HEADER_VALUE;
    url.hash = url.hash ? '#[redacted]' : '';
    for (const key of Array.from(url.searchParams.keys())) if (SENSITIVE_URL_PARAM_PATTERN.test(key)) url.searchParams.set(key, REDACTED_HEADER_VALUE);
    return url.toString();
  } catch {
    return SENSITIVE_URL_PARAM_PATTERN.test(value) ? REDACTED_HEADER_VALUE : value;
  }
}
function redactDiagnosticText(value: string): string { return value.replace(/https?:\/\/[^\s"'<>]+/g, (match) => redactEmbeddedBrowserDiagnosticUrl(match)); }
