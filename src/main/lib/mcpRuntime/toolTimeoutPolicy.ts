/**
 * Unified time-constraint policy for MCP connections and tool execution.
 *
 * Two metrics replace the previous ad-hoc, per-call timeouts:
 *
 *  1. Connection budget (MCP_CONNECT_TIMEOUT_MS): the total time for a third-party
 *     MCP server to become usable - transport start + `initialize` handshake +
 *     `tools/list` - must not exceed this budget. Exceeding it fails the connection
 *     (UI transitions `connecting` -> `error`). This bounds the previously unbounded
 *     `initialize` wait.
 *
 *  2. Idle / no-response budget (TOOL_IDLE_TIMEOUT_MS): a running tool is never capped
 *     by total execution time. It is only force-terminated after this many milliseconds
 *     elapse with NO activity. Real downstream activity - a matching MCP response /
 *     progress notification or streamed tool output - resets the countdown. Synthetic
 *     UI heartbeats must not reset it, or a hung tool could stay alive forever.
 *     This replaces fixed execution caps (e.g. the previous hardcoded 1 hour for
 *     third-party `tools/call`).
 */

/** Total budget for a third-party MCP server to finish connecting (start + initialize + tools/list). */
export const MCP_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

/** Fixed timeout for short MCP control requests such as resources/list and resources/read. */
export const MCP_CONTROL_REQUEST_TIMEOUT_MS = 30 * 1000;

/** Maximum time a tool may stay silent (no response/output) before it is force-terminated. */
export const TOOL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Number of consecutive tool idle timeouts (within {@link IDLE_TIMEOUT_ESCALATION_WINDOW_MS})
 * that escalate from a request-level failure to a full connection reset.
 *
 * A single idle timeout only fails the offending request and keeps the transport — one hung
 * tool must not tear down an otherwise healthy MCP server. But repeated back-to-back timeouts
 * mean the transport itself is wedged, so the connection is reset (which then auto-reconnects).
 * A matched response resets the counter, so only genuinely consecutive failures escalate.
 */
export const IDLE_TIMEOUT_ESCALATION_THRESHOLD = 3;

/**
 * Sliding window for counting consecutive idle timeouts. Two idle timeouts further apart than
 * this restart the count, so an isolated slow tool every few hours never escalates.
 */
export const IDLE_TIMEOUT_ESCALATION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Builtin tools that already enforce the no-response budget internally and therefore opt OUT of the
 * central watchdog in {@link module:agentChatToolExecutor}. Listing a tool here prevents
 * double-management (two timers racing the same call).
 *
 * `coding_agent` self-manages an {@link InactivityTimer} (fixed at {@link TOOL_IDLE_TIMEOUT_MS},
 * re-armed by real CLI output) inside its own spawn loop. Because it is listed here it opts OUT of
 * the central watchdog on BOTH execution paths — the main-agent path (`agentChatToolExecutor`) and
 * the sub-agent path (`subAgentToolExecutor`), each of which arms the central watchdog only for
 * builtin tools NOT in this set. Keeping the timer intrinsic to the tool covers both paths
 * uniformly while guaranteeing no second, redundant timer ever races the same call. Both mechanisms
 * implement the SAME no-response semantics.
 */
export const SELF_MANAGED_IDLE_TOOLS = new Set<string>(['coding_agent']);

/** Raised when an MCP server fails to finish connecting within {@link MCP_CONNECT_TIMEOUT_MS}. */
export class ConnectionTimeoutError extends Error {
  readonly serverName: string;
  readonly timeoutMs: number;

  constructor(serverName: string, timeoutMs: number) {
    super(`MCP connection timed out after ${timeoutMs}ms (server: ${serverName})`);
    this.name = 'ConnectionTimeoutError';
    this.serverName = serverName;
    this.timeoutMs = timeoutMs;
  }
}

/** Raised when a tool produces no response for {@link TOOL_IDLE_TIMEOUT_MS} and is terminated. */
export class ToolIdleTimeoutError extends Error {
  readonly toolName: string;
  readonly idleMs: number;

  constructor(toolName: string, idleMs: number) {
    super(`Tool "${toolName}" produced no response for ${idleMs}ms and was terminated`);
    this.name = 'ToolIdleTimeoutError';
    this.toolName = toolName;
    this.idleMs = idleMs;
  }
}

/**
 * Raised when the server reports a JSON-RPC error that the client cannot attribute to a pending
 * request but that clearly means the connection/session is gone (e.g. proxy "Session not found",
 * code -32001). It fails the connection immediately instead of waiting out the idle budget, which
 * lets {@link module:mcpClientManager} auto-reconnect.
 */
export class McpProtocolConnectionError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = 'McpProtocolConnectionError';
    this.code = code;
  }
}

/**
 * Inactivity ("no-response") watchdog.
 *
 * Fires `onIdle()` exactly once after `idleMs` elapse without a `touch()`. Each `touch()`
 * restarts the countdown, so a continuously-active tool never trips it. After it fires (or
 * after `dispose()`), the timer is permanently inert and further `touch()` calls are ignored.
 */
export class InactivityTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active = true;

  constructor(
    private readonly idleMs: number,
    private readonly onIdle: () => void,
  ) {
    this.arm();
  }

  /** Reset the countdown because activity was observed. No-op once fired or disposed. */
  touch(): void {
    if (!this.active) {
      return;
    }
    this.arm();
  }

  /** Stop the timer permanently without firing. Safe to call multiple times. */
  dispose(): void {
    this.active = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private arm(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    // clearTimeout in arm()/dispose() guarantees this callback never runs after a
    // re-arm or dispose, so `active` is always true here - no inner guard needed.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.active = false;
      this.onIdle();
    }, this.idleMs);
  }
}
