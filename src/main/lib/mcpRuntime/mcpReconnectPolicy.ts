/**
 * Pure decision helpers for MCP connection recovery.
 *
 * Kept free of any runtime / I/O state so the branchy logic that drives protocol
 * fail-fast and auto-reconnect can be unit-tested exhaustively, while the large
 * `VscodeMcpClient` / `mcpClientManager` files only carry thin wiring.
 *
 * See docs/mcp-connection-recovery-tech-doc.md.
 */

/**
 * Classification of a JSON-RPC error response by whether it signals a lost session, used for both
 * matched responses (the error's `id` maps to a pending request) and unmatched ones (empty,
 * missing, or non-matching `id`).
 *
 * - `connection-lost`: the upstream/proxy session is gone; every pending request on this
 *   connection is doomed, so the connection should be failed and auto-reconnected — regardless of
 *   the error's `id`.
 * - `ambiguous`: any other error. For a matched response this is a normal business error that
 *   fails only that request; for an unmatched one it is safe to fail only the single in-flight
 *   request (if exactly one is id-less), otherwise log and keep the connection.
 */
export type ProtocolErrorClass = 'connection-lost' | 'ambiguous';

/**
 * JSON-RPC error codes that indicate the session/connection is gone. `-32001` is the upstream
 * proxy "Session not found" code observed in the Teams MCP incident.
 */
const CONNECTION_LOST_CODES: ReadonlySet<number> = new Set<number>([-32001]);

/** MCP auth errors that require user action instead of retrying the same connection. */
const USER_ACTION_REQUIRED_ERROR_CODES: readonly string[] = [
  'MCP_AUTH_CANCELLED',
  'MCP_OAUTH_FLOW_FAILED',
  'MCP_DCR_REQUIRES_USER_CLIENT_ID',
  'MCP_DCR_RESTRICTED',
];

/** Message patterns that indicate a lost upstream session regardless of the numeric code. */
const CONNECTION_LOST_PATTERNS: readonly RegExp[] = [
  /session not found/i,
  /session expired/i,
  /session .*closed/i,
];

/** Deterministic failures that require user/account/config changes instead of retrying. */
const NON_RETRYABLE_ERROR_PATTERNS: readonly RegExp[] = [
  /after successful sign-in/i,
  /not available for your account/i,
  /unsupported transport type/i,
  /unknown transport type/i,
  /stdio transport requires '?command'?/i,
  /http\/sse transport requires '?url'?/i,
  /transport requires (?:a )?(?:command|args array|url)/i,
  /transport url must start with http:\/\/ or https:\/\//i,
  /not found in configuration/i,
];

/**
 * Classify a JSON-RPC error response so the client can decide between a request-level failure and
 * a full connection reset. Applies to both matched and unmatched error responses.
 */
export function classifyProtocolError(
  error?: { code?: number; message?: string } | null,
): ProtocolErrorClass {
  if (!error) {
    return 'ambiguous';
  }
  if (typeof error.code === 'number' && CONNECTION_LOST_CODES.has(error.code)) {
    return 'connection-lost';
  }
  const message = typeof error.message === 'string' ? error.message : '';
  if (CONNECTION_LOST_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'connection-lost';
  }
  return 'ambiguous';
}

/**
 * Decide whether an error is deterministic/user-action-required, so auto-reconnect should be
 * suppressed. These failures are not fixed by retrying: the user must finish auth or edit config.
 */
export function shouldSuppressAutoReconnectForError(
  error?: Error | string | null,
): boolean {
  if (!error) {
    return false;
  }

  const message = typeof error === 'string' ? error : error.message;
  if (USER_ACTION_REQUIRED_ERROR_CODES.some((code) => message.includes(`[${code}]`))) {
    return true;
  }

  return NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Exponential backoff schedule for auto-reconnect attempts (milliseconds): 5s, 30s, 2m, 5m,
 * 15m, 30m. The last value is the cap; jitter is added on top.
 */
export const RECONNECT_BACKOFF_SCHEDULE_MS: readonly number[] = [
  5_000,
  30_000,
  120_000,
  300_000,
  900_000,
  1_800_000,
];

/** Stop auto-reconnecting after this many consecutive failed attempts. */
export const MAX_AUTO_RECONNECT_ATTEMPTS = 8;

/**
 * Delay before the given 1-based reconnect attempt. Indices beyond the schedule clamp to the cap;
 * attempts below 1 clamp to the first step. Adds up to +20% jitter so many servers failing at
 * once do not retry in lockstep.
 */
export function computeReconnectDelayMs(attempt: number, rng: () => number = Math.random): number {
  const clamped = Math.min(Math.max(attempt, 1), RECONNECT_BACKOFF_SCHEDULE_MS.length);
  const base = RECONNECT_BACKOFF_SCHEDULE_MS[clamped - 1];
  const jitter = Math.floor(base * 0.2 * rng());
  return base + jitter;
}

/** Inputs the manager knows about a server when deciding whether to auto-reconnect it. */
export interface AutoReconnectDecisionInput {
  /** Builtin server is always connected and managed separately; never auto-reconnected. */
  isBuiltin: boolean;
  /** The user still wants this server (profile `in_use !== false`). */
  inUse: boolean;
  /** The server reached `connected` at least once; a never-connected server is not "recovered". */
  everConnected: boolean;
  /** The server is awaiting OAuth consent / sign-in; retrying cannot fix it. */
  needsUserInteraction: boolean;
}

/**
 * Decide whether a server that entered `error` should be auto-reconnected. Only previously
 * healthy, in-use, non-builtin servers that are not blocked on user interaction qualify.
 */
export function shouldAutoReconnect(input: AutoReconnectDecisionInput): boolean {
  return (
    !input.isBuiltin &&
    input.inUse &&
    input.everConnected &&
    !input.needsUserInteraction
  );
}
