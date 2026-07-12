export const INTERRUPTED_SCHEDULED_SESSION_ERROR = 'Interrupted before completion';
export const SCHEDULER_SKIPPED_OVERLAP_ERROR = 'skipped-overlap';
export const SCHEDULER_SKIPPED_CONCURRENCY_LIMIT_ERROR = 'skipped-concurrency-limit';
export const SCHEDULER_MCP_NOT_READY_ERROR = 'skipped-mcp-not-ready';
// Internal control signal returned by executeJob when the active alias/generation
// changes while it awaits the MCP-readiness preflight (sign-out or alias switch during
// the wait). It is never persisted to session metadata or surfaced in the UI; the
// `skipped-` prefix keeps it in the "did not run, lastRunAt untouched" class that
// the cron watchdog already retries.
export const SCHEDULER_ALIAS_CHANGED_ERROR = 'skipped-alias-changed';
export const SCHEDULER_USER_CANCELLED_ERROR = 'Cancelled by user';

const INTERRUPTED_SCHEDULED_SESSION_ERROR_LOWER = INTERRUPTED_SCHEDULED_SESSION_ERROR.toLowerCase();
const INTERRUPTED_SCHEDULED_SESSION_ERROR_PREFIX = `${INTERRUPTED_SCHEDULED_SESSION_ERROR_LOWER}:`;
const GENERIC_INTERRUPTION_REASON = 'App closed before completion';
const USER_CANCELLED_INTERRUPTION_REASON = SCHEDULER_USER_CANCELLED_ERROR;
const SCHEDULER_SKIP_REASON_LABELS: Record<string, string> = {
  [SCHEDULER_SKIPPED_OVERLAP_ERROR]: 'Another run is already in progress',
  [SCHEDULER_SKIPPED_CONCURRENCY_LIMIT_ERROR]: 'Scheduler concurrency limit reached',
  [SCHEDULER_MCP_NOT_READY_ERROR]: 'MCP server not ready',
};

function normalizeSchedulerError(error: string | null | undefined): string | undefined {
  const trimmed = error?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function isInterruptedScheduledSessionError(
  error: string | null | undefined,
): boolean {
  const normalized = normalizeSchedulerError(error);
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  return lower === INTERRUPTED_SCHEDULED_SESSION_ERROR_LOWER ||
    lower.startsWith(INTERRUPTED_SCHEDULED_SESSION_ERROR_PREFIX) ||
    isSchedulerSkippedExecutionError(normalized) ||
    isSchedulerUserCancelledError(normalized);
}

export function isSchedulerSkippedExecutionError(error: string | null | undefined): boolean {
  const normalized = normalizeSchedulerError(error);
  return normalized ? normalized.toLowerCase() in SCHEDULER_SKIP_REASON_LABELS : false;
}

function isSchedulerUserCancelledError(error: string | null | undefined): boolean {
  const normalized = normalizeSchedulerError(error);
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  return /^(?:operation|edit)?\s*(?:was\s+)?cancell?ed\b/.test(lower) ||
    /^user\s+cancell?ed\b/.test(lower) ||
    /\bcancell?ed\s+by\s+user\b/.test(lower);
}

export function getSchedulerExecutionInterruptionReason(
  error: string | null | undefined,
): string | undefined {
  const normalized = normalizeSchedulerError(error);
  if (!normalized) {
    return undefined;
  }

  const lower = normalized.toLowerCase();
  if (lower === INTERRUPTED_SCHEDULED_SESSION_ERROR_LOWER) {
    return GENERIC_INTERRUPTION_REASON;
  }

  if (lower.startsWith(INTERRUPTED_SCHEDULED_SESSION_ERROR_PREFIX)) {
    const detail = normalized.slice(INTERRUPTED_SCHEDULED_SESSION_ERROR.length + 1).trim();
    return getSchedulerExecutionInterruptionReason(detail) ?? (detail.length > 0 ? detail : undefined);
  }

  if (isSchedulerUserCancelledError(normalized)) {
    return USER_CANCELLED_INTERRUPTION_REASON;
  }

  return SCHEDULER_SKIP_REASON_LABELS[lower] ?? normalized;
}