/**
 * Local HTTP server (127.0.0.1 only) that receives OAuth 2.0
 * authorization-code redirects (RFC 6749 §4.1.2).
 *
 * One instance per port (see `getCallbackServer(port)`) — different MCP
 * servers may pin different `cfg.oauth.callbackPort` values matching their
 * OAuth-app's registered redirect URI. Within a single instance, multiple
 * in-flight flows are routed by the OAuth `state` parameter (also our CSRF
 * guard, RFC 6749 §10.12). `server.unref()` keeps a pending flow from
 * blocking process exit. Provider-supplied error strings are HTML-escaped.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { parse } from 'url';
import { APP_NAME } from '../../../../shared/constants/branding';
import { getUnifiedLogger } from '../../unifiedLogger';

/**
 * Default OAuth callback port: in user-port range, IANA unassigned, not a
 * common dev-tool port. Override per server via `cfg.oauth.callbackPort`.
 */
export const OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT = 33420;

const CALLBACK_PATH = '/callback';
const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60_000;

const logger = getUnifiedLogger();

interface Waiter {
  resolve: (code: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  abortHandler?: () => void;
  signal?: AbortSignal;
}

class CallbackServer {
  private server: Server | null = null;
  private port = 0;
  private waiters = new Map<string, Waiter>();
  private startPromise: Promise<void> | null = null;
  private startingPort: number | null = null;

  /** Currently-bound port, or null when not started. */
  get currentPort(): number | null {
    return this.server ? this.port : null;
  }

  /**
   * Idempotently start on `preferredPort`. Concurrent calls with a
   * mismatched port (against either the bound server or a pending start)
   * reject — otherwise the second caller would silently get the first
   * caller's port for its redirect URI.
   */
  async ensureRunning(preferredPort?: number): Promise<void> {
    const wantPort = preferredPort ?? OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT;

    if (this.server) {
      if (wantPort !== 0 && this.port !== wantPort) {
        throw new Error(
          `OAuth callback server is already running on port ${this.port} but ` +
          `port ${wantPort} was requested. Stop the existing server before rebinding.`
        );
      }
      return;
    }

    if (this.startPromise) {
      if (wantPort !== 0 && this.startingPort !== null && this.startingPort !== wantPort) {
        throw new Error(
          `OAuth callback server is starting on port ${this.startingPort} but ` +
          `port ${wantPort} was requested. Wait for the in-flight start to finish ` +
          `(or stop it) before requesting a different port.`
        );
      }
      return this.startPromise;
    }

    this.startingPort = wantPort;
    this.startPromise = this.startInternal(wantPort).finally(() => {
      this.startPromise = null;
      this.startingPort = null;
    });
    return this.startPromise;
  }

  private startInternal(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.unref();

      const onError = (err: NodeJS.ErrnoException) => {
        server.removeAllListeners('listening');
        if (err.code === 'EADDRINUSE') {
          reject(new Error(
            `OAuth callback port ${port} is already in use. ` +
            `Configure another via 'oauth.callbackPort' in your MCP server config, ` +
            `or close the conflicting process.`
          ));
          return;
        }
        if (err.code === 'EACCES') {
          reject(new Error(
            `OAuth callback port ${port} requires elevated permissions. ` +
            `Pick a different port via 'oauth.callbackPort'.`
          ));
          return;
        }
        reject(err);
      };

      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        // Re-attach a permanent error handler so post-startup errors don't
        // crash the process; we only log them.
        server.on('error', (err) => {
          logger.warn('[McpOAuth] CallbackServer post-startup error', 'CallbackServer', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        this.server = server;
        // When `port === 0` the OS assigned an ephemeral port — read the
        // actual one back from server.address(). Otherwise honor the
        // requested fixed port.
        const addr = server.address();
        const actualPort =
          typeof addr === 'object' && addr && typeof addr.port === 'number'
            ? addr.port
            : port;
        this.port = actualPort;
        logger.info(`[McpOAuth] Callback server listening on http://127.0.0.1:${actualPort}${CALLBACK_PATH}`);
        resolve();
      });
    });
  }

  /**
   * Returns the redirect URI clients should register with the OAuth
   * provider. Throws if the server has not been started.
   */
  getRedirectUri(): string {
    if (!this.server) {
      throw new Error('CallbackServer not started — call ensureRunning() first');
    }
    return `http://127.0.0.1:${this.port}${CALLBACK_PATH}`;
  }

  /**
   * Wait for an authorization-code callback whose `state` matches.
   *
   * Resolves with the `code` query parameter, or rejects on:
   *   - 5-minute timeout
   *   - `error` query parameter from the provider
   *   - missing `code`
   *   - external `AbortSignal`
   */
  async waitForCode(
    state: string,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<string> {
    if (!this.server) {
      throw new Error('CallbackServer not started — call ensureRunning() first');
    }
    if (this.waiters.has(state)) {
      throw new Error(`Duplicate OAuth state: ${state.slice(0, 8)}…`);
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(state);
        reject(new Error('OAuth callback timed out (5 minutes). Please try signing in again.'));
      }, opts.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS);
      timer.unref();

      const waiter: Waiter = { resolve, reject, timer };

      if (opts.signal) {
        if (opts.signal.aborted) {
          clearTimeout(timer);
          reject(new Error('OAuth flow cancelled before callback'));
          return;
        }
        const abortHandler = () => {
          this.waiters.delete(state);
          clearTimeout(timer);
          reject(new Error('OAuth flow cancelled'));
        };
        waiter.abortHandler = abortHandler;
        waiter.signal = opts.signal;
        opts.signal.addEventListener('abort', abortHandler, { once: true });
      }

      this.waiters.set(state, waiter);
    });
  }

  /**
   * Stop the server and reject every pending waiter. Test-only; production
   * code keeps the singleton alive for the application lifetime.
   */
  async stop(): Promise<void> {
    for (const [state, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      if (waiter.signal && waiter.abortHandler) {
        waiter.signal.removeEventListener('abort', waiter.abortHandler);
      }
      waiter.reject(new Error('CallbackServer stopped'));
      this.waiters.delete(state);
    }
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    this.port = 0;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private cleanupWaiter(state: string): Waiter | undefined {
    const waiter = this.waiters.get(state);
    if (!waiter) return undefined;
    this.waiters.delete(state);
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.abortHandler) {
      waiter.signal.removeEventListener('abort', waiter.abortHandler);
    }
    return waiter;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const parsed = parse(req.url ?? '', true);
    if (parsed.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const code = typeof parsed.query.code === 'string' ? parsed.query.code : undefined;
    const state = typeof parsed.query.state === 'string' ? parsed.query.state : undefined;
    const err = typeof parsed.query.error === 'string' ? parsed.query.error : undefined;
    const errDesc =
      typeof parsed.query.error_description === 'string' ? parsed.query.error_description : '';

    if (!state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderHtml(
        'Authentication error',
        `<p>Missing OAuth state parameter. This may indicate a forged callback. You can close this window.</p>`,
      ));
      return;
    }

    const waiter = this.cleanupWaiter(state);
    if (!waiter) {
      // Unknown state — could be a stale callback from a previous flow.
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderHtml(
        'Authentication error',
        `<p>This OAuth callback does not match any pending sign-in. You can close this window.</p>`,
      ));
      return;
    }

    if (err) {
      const safeErr = escapeHtml(err);
      const safeDesc = errDesc ? escapeHtml(errDesc) : '';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderHtml(
        'Authentication failed',
        `<p>${safeErr}${safeDesc ? `: ${safeDesc}` : ''}</p>` +
        `<p>You can close this window and return to ${escapeHtml(APP_NAME)}.</p>`,
      ));
      waiter.reject(new Error(`OAuth provider error: ${err}${errDesc ? ` - ${errDesc}` : ''}`));
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.renderHtml(
        'Authentication error',
        `<p>Missing authorization code. You can close this window.</p>`,
      ));
      waiter.reject(new Error('OAuth callback missing authorization code'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this.renderHtml(
      'Authentication successful',
      `<p>You can close this window and return to ${escapeHtml(APP_NAME)}.</p>`,
    ));
    waiter.resolve(code);
  }

  private renderHtml(title: string, bodyHtml: string): string {
    const safeTitle = escapeHtml(title);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${safeTitle}</title>` +
      `<style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;margin:2rem;color:#222;text-align:center;}h1{font-size:1.5rem;margin-bottom:0.5rem;}p{max-width:32rem;line-height:1.5;}</style>` +
      `</head><body><h1>${safeTitle}</h1>${bodyHtml}</body></html>`;
  }
}

/** Minimal HTML escape — we only render to known, controlled locations. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Per-port instance registry. */
const instances = new Map<number, CallbackServer>();

export function getCallbackServer(port: number = OPENKOSMOS_DEFAULT_OAUTH_CALLBACK_PORT): CallbackServer {
  let inst = instances.get(port);
  if (!inst) {
    inst = new CallbackServer();
    instances.set(port, inst);
  }
  return inst;
}

/** Test-only — drops every cached per-port instance so tests start fresh. */
export function __resetCallbackServerForTests(): void {
  instances.clear();
}

export type { CallbackServer };
