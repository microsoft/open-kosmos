import { createLogger } from '../unifiedLogger';
import { findMissedCronOccurrence, getSchedulerTimeZone } from './cronRecovery';
import { scheduleStore } from './scheduleStore';
import type { SchedulerJob } from './types';

const logger = createLogger();

export interface CronWatchdogTaskRuntimeMeta {
  jobId: string;
  registeredAt: string;
  cronExpression?: string;
  lastTickArrivedAt?: string;
  lastCronWatchdogCheckedAt?: string;
  lastCronWatchdogCatchUpAt?: string;
}

export interface CronWatchdogOptions {
  alias: string | null;
  heartbeatIntervalMs: number;
  cronJobIds: string[];
  getRuntimeMeta: (jobId: string) => CronWatchdogTaskRuntimeMeta | undefined;
  setRuntimeMeta: (jobId: string, meta: CronWatchdogTaskRuntimeMeta) => void;
  executeJob: (job: SchedulerJob) => Promise<void>;
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
  const missedOccurrence = findMissedCronOccurrence(
    meta.cronExpression,
    lastCheckedAt,
    options.eligibleUntilMs,
    options.schedulerTimeZone,
  );
  const nextCheckedAt = new Date(options.eligibleUntilMs).toISOString();

  options.setRuntimeMeta(options.jobId, {
    ...meta,
    lastCronWatchdogCheckedAt: nextCheckedAt,
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

  await options.executeJob(job);
}
