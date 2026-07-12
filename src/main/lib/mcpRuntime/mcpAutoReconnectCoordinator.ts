/**
 * Adapts MCP auto-reconnect to the client manager.
 *
 * Owns the per-server "ever connected" and "base error" bookkeeping and the eligibility / last-error
 * composition logic, exposing a tiny surface to {@link MCPClientManager} so the auto-reconnect wiring
 * stays out of that already-large file. The actual backoff state machine lives in
 * {@link McpAutoReconnectManager}; this layer only supplies decisions and adapts the manager's
 * primitives through {@link AutoReconnectHost}. See docs/mcp-connection-recovery-tech-doc.md.
 */

import { McpAutoReconnectManager } from './mcpAutoReconnectManager';
import {
  shouldAutoReconnect,
  shouldSuppressAutoReconnectForError,
} from './mcpReconnectPolicy';

export interface AutoReconnectHost {
  /** Run one reconnect attempt through the manager's per-server operation lock. */
  executeReconnect: (serverName: string) => Promise<void>;
  /** Current runtime status of the server. */
  getStatus: (serverName: string) => string | undefined;
  /** Whether the server is the builtin server (never auto-reconnected). */
  isBuiltin: (serverName: string) => boolean;
  /** Whether the server's profile config is present and `in_use !== false`. */
  isInUse: (serverName: string) => boolean;
  /** Store a composed recovery hint as the server's last-error text (status stays `error`). */
  setLastError: (serverName: string, message: string) => void;
  /** Structured logging hook. */
  log: (level: 'info' | 'warning' | 'debug', message: string) => void;
}

export interface AutoReconnectErrorContext {
  /** The server was already waiting for user interaction before this error overwrote the status. */
  wasAwaitingUserInteraction?: boolean;
}

/**
 * Per-manager coordinator that decides which dropped servers to recover and keeps the user-visible
 * last-error text composed from the real cause plus the current retry hint.
 */
export class McpAutoReconnectCoordinator {
  /** Servers that reached `connected` at least once this profile session (gates recovery). */
  private readonly everConnected = new Set<string>();

  /**
   * Real failure cause per server currently in `error`, captured before any scheduling message so
   * the recovery hint composes onto it (the user always sees WHY it dropped). Cleared on
   * (re)connect and on teardown.
   */
  private readonly baseError = new Map<string, string>();

  private readonly manager: McpAutoReconnectManager;

  constructor(private readonly host: AutoReconnectHost) {
    this.manager = new McpAutoReconnectManager({
      reconnect: (serverName) => this.host.executeReconnect(serverName),
      getStatus: (serverName) => this.host.getStatus(serverName),
      isEligible: (serverName) => this.isEligible(serverName),
      onStateMessage: (serverName, message) => this.setReconnectStatus(serverName, message),
      log: (level, message) => this.host.log(level, message),
    });
  }

  /** Record a successful (re)connect: remember it and drop its now-stale failure cause. */
  noteConnected(serverName: string): void {
    this.everConnected.add(serverName);
    this.baseError.delete(serverName);
  }

  /** A server entered `error`: capture the cause and (if eligible) schedule recovery. */
  onServerError(serverName: string, cause: string, context: AutoReconnectErrorContext = {}): void {
    this.baseError.set(serverName, cause);
    if (context.wasAwaitingUserInteraction || shouldSuppressAutoReconnectForError(cause)) {
      this.manager.cancel(serverName);
      return;
    }
    this.manager.onServerError(serverName);
  }

  /** Cancel a pending/in-flight reconnect because a manual operation superseded it. */
  cancel(serverName: string): void {
    this.manager.cancel(serverName);
  }

  /** Profile teardown: drop all bookkeeping and cancel every pending attempt. */
  resetAll(): void {
    this.everConnected.clear();
    this.baseError.clear();
    this.manager.cancelAll();
  }

  private isEligible(serverName: string): boolean {
    return shouldAutoReconnect({
      isBuiltin: this.host.isBuiltin(serverName),
      inUse: this.host.isInUse(serverName),
      everConnected: this.everConnected.has(serverName),
      needsUserInteraction: this.host.getStatus(serverName) === 'needs-user-interaction',
    });
  }

  private setReconnectStatus(serverName: string, recoveryMessage: string): void {
    const base = this.baseError.get(serverName);
    this.host.setLastError(serverName, base ? `${base}; ${recoveryMessage}` : recoveryMessage);
  }
}
