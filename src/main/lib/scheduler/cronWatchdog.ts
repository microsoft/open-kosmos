import { createLogger } from '../unifiedLogger';
import { findMissedCronOccurrence, getSchedulerTimeZone, shouldCatchUpMissedOccurrence } from './cronRecovery';
import { scheduleStore } from './scheduleStore';
import type { SchedulerJob } from './types';

const logger = createLogger();

/**
 * A `skipped-*` execution result (overlap or concurrency-limit)
 * means executeJob returned before advancing `lastRunAt`, so the missed occurrence
 * still needs to run. Any other error means the run was actually attempted (and
 * `lastRunAt` advanced), which the `lastRunAt >= occurrence` guard already handles.
 */
function isRetryableExecutionSkip(error: string | undefined): boolean {
  return typeof error === 'string' && error.startsWith('skipped-');
}

function parsePendingRetryOccurrence(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : undefined;
}

export interface CronWatchdogTaskRuntimeMeta {
  jobId: string;
  registeredAt: string;
  cronExpression?: string;
  lastTickArrivedAt?: string;
  lastCronWatchdogCheckedAt?: string;
  lastCronWatchdogCatchUpAt?: string;
  pendingCronWatchdogRetryAt?: string;
}

/** Minimal shape of SchedulerManager.executeJob's result that the watchdog needs. */
export interface CronWatchdogExecuteResult {
  error?: string;
}

export interface CronWatchdogOptions {
  alias: string | null;
  heartbeatIntervalMs: number;
  cronJobIds: string[];
  getRuntimeMeta: (jobId: string) => CronWatchdogTaskRuntimeMeta | undefined;
  setRuntimeMeta: (jobId: string, meta: CronWatchdogTaskRuntimeMeta) => void;
  executeJob: (job: SchedulerJob) => Promise<CronWatchdogExecuteResult | undefined>;
  nowMs?: number;
}

export async function runCronWatchdog(options: CronWatchdogOptions): Promise<void> {
  const alias = options.alias;
  if (!alias) {
    return;
  }

  const checkedAtMs = options.nowMs ?? Date.now();
  const eligibleUntilMs = checkedAtMs - options.heartbeatIntervalMs;
  if (eligibleUntilMs <= 0) {
    return;
  }

  const schedulerTimeZone = getSchedulerTimeZone();
  for (const jobId of options.cronJobIds) {
    try {
      await handleCronWatchdogJob({
        ...options,
        alias,
        jobId,
        eligibleUntilMs,
        checkedAtMs,
        schedulerTimeZone,
      });
    } catch (error) {
      logger.warn('scheduler.cron.watchdog.job-failed', 'handleCronWatchdog', {
        alias,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function handleCronWatchdogJob(
  options: CronWatchdogOptions & {
    alias: string;
    jobId: string;
    eligibleUntilMs: number;
    checkedAtMs: number;
    schedulerTimeZone: string;
  },
): Promise<void> {
  const meta = options.getRuntimeMeta(options.jobId);
  if (!meta?.cronExpression) {
    return;
  }

  const lastCheckedAt = meta.lastCronWatchdogCheckedAt || meta.lastTickArrivedAt || meta.registeredAt;
  const pendingRetryOccurrence = parsePendingRetryOccurrence(meta.pendingCronWatchdogRetryAt);
  const retryOccurrence =
    pendingRetryOccurrence && shouldCatchUpMissedOccurrence(pendingRetryOccurrence, options.checkedAtMs)
      ? pendingRetryOccurrence
      : undefined;
  const detectedOccurrence = findMissedCronOccurrence(
    meta.cronExpression,
    lastCheckedAt,
    options.eligibleUntilMs,
    options.schedulerTimeZone,
  );
  const missedOccurrence = retryOccurrence ?? detectedOccurrence;
  const nextCheckedAt = new Date(options.eligibleUntilMs).toISOString();

  options.setRuntimeMeta(options.jobId, {
    ...meta,
    lastCronWatchdogCheckedAt: nextCheckedAt,
    pendingCronWatchdogRetryAt: undefined,
  });

  if (!missedOccurrence) {
    return;
  }

  const job = await scheduleStore.getJob(options.alias, options.jobId);
  if (!job || !job.enabled || job.scheduleType !== 'cron' || !job.cronExpression) {
    logger.info('scheduler.cron.watchdog.skip-inactive', 'handleCronWatchdog', {
      alias: options.alias,
      jobId: options.jobId,
      missedScheduledAt: missedOccurrence.toISOString(),
      reason: !job ? 'job-not-found' : 'job-disabled-or-not-cron',
    });
    return;
  }

  const lastRunAtMs = job.lastRunAt ? Date.parse(job.lastRunAt) : Number.NaN;
  if (Number.isFinite(lastRunAtMs) && lastRunAtMs >= missedOccurrence.getTime()) {
    logger.info('scheduler.cron.watchdog.skip-started', 'handleCronWatchdog', {
      alias: options.alias,
      jobId: options.jobId,
      name: job.name,
      cron: job.cronExpression,
      missedScheduledAt: missedOccurrence.toISOString(),
      lastRunAt: job.lastRunAt,
    });
    return;
  }

  logger.warn('scheduler.cron.watchdog.catch-up', 'handleCronWatchdog', {
    alias: options.alias,
    jobId: options.jobId,
    name: job.name,
    cron: job.cronExpression,
    missedScheduledAt: missedOccurrence.toISOString(),
    checkedAt: new Date(options.checkedAtMs).toISOString(),
    schedulerTimeZone: options.schedulerTimeZone,
  });

  const latestMeta = options.getRuntimeMeta(options.jobId);
  if (latestMeta) {
    options.setRuntimeMeta(options.jobId, {
      ...latestMeta,
      lastCronWatchdogCatchUpAt: missedOccurrence.toISOString(),
    });
  }

  const result = await options.executeJob(job);

  if (
    isRetryableExecutionSkip(result?.error) &&
    shouldCatchUpMissedOccurrence(missedOccurrence, options.checkedAtMs)
  ) {
    // The catch-up was skipped before it ran (lastRunAt untouched), so pin this
    // exact occurrence for the next heartbeat. The checkpoint rollback is only a
    // fallback; without the pinned occurrence, findMissedCronOccurrence would select
    // a newer cron tick as time advances and silently drop this one.
    const retryMeta = options.getRuntimeMeta(options.jobId);
    // If the task was unregistered between dispatch and here (retryMeta gone), the
    // checkpoint stays advanced and the occurrence is dropped — acceptable, because a
    // removed/disabled job should not run the missed occurrence anyway.
    if (retryMeta) {
      options.setRuntimeMeta(options.jobId, {
        ...retryMeta,
        lastCronWatchdogCheckedAt: new Date(missedOccurrence.getTime() - 1).toISOString(),
        pendingCronWatchdogRetryAt: missedOccurrence.toISOString(),
      });
    }
    logger.info('scheduler.cron.watchdog.retry-pending', 'handleCronWatchdog', {
      alias: options.alias,
      jobId: options.jobId,
      name: job.name,
      missedScheduledAt: missedOccurrence.toISOString(),
      skipReason: result?.error,
    });
  }
}
