import { createLogger } from '../unifiedLogger';
import type { SchedulerRuntimeState } from './schedulerRuntimeStateStore';
import type { SchedulerJob } from './types';
import {
  findMissedCronOccurrence,
  getColdStartCatchUpBaseline,
  getSchedulerTimeZone,
  MAX_RESUME_CATCH_UP_DELAY_MS,
  shouldCatchUpMissedOccurrence,
} from './cronRecovery';

const logger = createLogger();

type ColdStartCatchUpPhase = 'pending' | 'baseline';

type ColdStartExecutionResult = {
  success: boolean;
};

type FreshCronJob = SchedulerJob & { cronExpression: string };

export interface ColdStartCatchUpRunnerContext {
  alias: string;
  startupAtMs: number;
  jobs: SchedulerJob[];
  runtimeState: SchedulerRuntimeState;
  getJob: (jobId: string) => Promise<SchedulerJob | null>;
  clearPending: (jobId: string) => Promise<unknown>;
  execute: (
    job: SchedulerJob,
    occurrenceAt: string,
    alreadyPending: boolean,
  ) => Promise<ColdStartExecutionResult>;
}

export async function runColdStartCatchUp(context: ColdStartCatchUpRunnerContext): Promise<void> {
  const recurringJobs = context.jobs.filter(isEnabledCronJob);
  const pendingCatchUps = context.runtimeState.pendingColdStartCatchUps || {};
  const pendingEntries = Object.entries(pendingCatchUps);

  if (recurringJobs.length === 0 && pendingEntries.length === 0) {
    return;
  }

  const snapshotJobById = new Map(context.jobs.map((job) => [job.id, job]));
  const replayedPendingOccurrences = new Set<string>();
  let recoveredRuns = 0;

  for (const [jobId, pendingCatchUp] of pendingEntries) {
    const snapshotJob = snapshotJobById.get(jobId);
    if (!isEnabledCronJob(snapshotJob)) {
      await context.clearPending(jobId);
      logger.info('scheduler.cold-start-catchup.drop-inactive-pending', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId,
        name: snapshotJob?.name,
        pendingOccurrenceAt: pendingCatchUp.occurrenceAt,
        recordedAt: pendingCatchUp.recordedAt,
      });
      continue;
    }

    const pendingOccurrence = new Date(pendingCatchUp.occurrenceAt);
    if (!shouldCatchUpMissedOccurrence(pendingOccurrence, context.startupAtMs)) {
      await context.clearPending(snapshotJob.id);
      logger.info('scheduler.cold-start-catchup.drop-stale-pending', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId: snapshotJob.id,
        name: snapshotJob.name,
        pendingOccurrenceAt: pendingCatchUp.occurrenceAt,
        recordedAt: pendingCatchUp.recordedAt,
      });
      continue;
    }

    const job = await loadFreshColdStartRecurringJob(context, snapshotJob, 'pending');
    if (!job) {
      await context.clearPending(snapshotJob.id);
      logger.info('scheduler.cold-start-catchup.drop-inactive-pending', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId: snapshotJob.id,
        name: snapshotJob.name,
        pendingOccurrenceAt: pendingCatchUp.occurrenceAt,
        recordedAt: pendingCatchUp.recordedAt,
      });
      continue;
    }

    const pendingOccurrenceMs = pendingOccurrence.getTime();
    const pendingLastFinishedAtMs = job.lastFinishedAt ? Date.parse(job.lastFinishedAt) : Number.NaN;
    if (Number.isFinite(pendingLastFinishedAtMs) && pendingLastFinishedAtMs >= pendingOccurrenceMs) {
      await context.clearPending(job.id);
      logger.info('scheduler.cold-start-catchup.drop-completed-pending', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId: job.id,
        name: job.name,
        pendingOccurrenceAt: pendingCatchUp.occurrenceAt,
        recordedAt: pendingCatchUp.recordedAt,
        lastFinishedAt: job.lastFinishedAt,
      });
      continue;
    }

    logger.info('scheduler.cold-start-catchup.replay-pending', 'handleColdStartCatchUp', {
      alias: context.alias,
      jobId: job.id,
      name: job.name,
      pendingOccurrenceAt: pendingCatchUp.occurrenceAt,
    });

    const result = await context.execute(job, pendingCatchUp.occurrenceAt, true);
    if (result.success) {
      replayedPendingOccurrences.add(`${job.id}::${pendingCatchUp.occurrenceAt}`);
      recoveredRuns += 1;
    }
  }

  const baseline = getColdStartCatchUpBaseline(context.runtimeState);
  if (!baseline) {
    logger.info('scheduler.cold-start-catchup.end-without-baseline', 'handleColdStartCatchUp', {
      alias: context.alias,
      recurringJobs: recurringJobs.length,
      recoveredRuns,
    });
    return;
  }

  const schedulerTimeZone = getSchedulerTimeZone();

  logger.info('scheduler.cold-start-catchup.start', 'handleColdStartCatchUp', {
    alias: context.alias,
    recurringJobs: recurringJobs.length,
    windowStartAt: baseline.windowStartAt,
    startupAt: new Date(context.startupAtMs).toISOString(),
    baselineSource: baseline.source,
    schedulerTimeZone,
  });

  for (const snapshotJob of recurringJobs) {
    const job = await loadFreshColdStartRecurringJob(context, snapshotJob, 'baseline');
    if (!job) {
      continue;
    }

    const missedOccurrence = findMissedCronOccurrence(
      job.cronExpression,
      baseline.windowStartAt,
      context.startupAtMs,
      schedulerTimeZone,
    );

    if (!missedOccurrence) {
      continue;
    }

    const occurrenceKey = `${job.id}::${missedOccurrence.toISOString()}`;
    if (replayedPendingOccurrences.has(occurrenceKey)) {
      logger.info('scheduler.cold-start-catchup.skip-duplicate-pending', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId: job.id,
        name: job.name,
        missedScheduledAt: missedOccurrence.toISOString(),
      });
      continue;
    }

    const missedOccurrenceMs = missedOccurrence.getTime();
    const lastRunAtMs = job.lastRunAt ? Date.parse(job.lastRunAt) : Number.NaN;
    if (Number.isFinite(lastRunAtMs) && lastRunAtMs >= missedOccurrenceMs) {
      logger.info('scheduler.cold-start-catchup.skip-started', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId: job.id,
        name: job.name,
        cron: job.cronExpression,
        missedScheduledAt: missedOccurrence.toISOString(),
        lastRunAt: job.lastRunAt,
      });
      continue;
    }

    const catchUpDelayMs = context.startupAtMs - missedOccurrenceMs;
    if (!shouldCatchUpMissedOccurrence(missedOccurrence, context.startupAtMs)) {
      logger.info('scheduler.cold-start-catchup.skip-stale', 'handleColdStartCatchUp', {
        alias: context.alias,
        jobId: job.id,
        name: job.name,
        cron: job.cronExpression,
        missedScheduledAt: missedOccurrence.toISOString(),
        catchUpDelayMs,
        maxCatchUpDelayMs: MAX_RESUME_CATCH_UP_DELAY_MS,
      });
      continue;
    }

    logger.info('scheduler.cold-start-catchup.execute', 'handleColdStartCatchUp', {
      alias: context.alias,
      jobId: job.id,
      name: job.name,
      cron: job.cronExpression,
      missedScheduledAt: missedOccurrence.toISOString(),
      catchUpDelayMs,
      baselineSource: baseline.source,
    });

    const result = await context.execute(job, missedOccurrence.toISOString(), false);
    if (result.success) {
      recoveredRuns += 1;
    }
  }

  logger.info('scheduler.cold-start-catchup.end', 'handleColdStartCatchUp', {
    alias: context.alias,
    recurringJobs: recurringJobs.length,
    recoveredRuns,
    baselineSource: baseline.source,
  });
}

async function loadFreshColdStartRecurringJob(
  context: ColdStartCatchUpRunnerContext,
  snapshotJob: SchedulerJob,
  phase: ColdStartCatchUpPhase,
): Promise<FreshCronJob | null> {
  const latestJob = await context.getJob(snapshotJob.id);
  if (!latestJob) {
    logger.info('scheduler.cold-start-catchup.skip-missing-job', 'handleColdStartCatchUp', {
      alias: context.alias,
      jobId: snapshotJob.id,
      name: snapshotJob.name,
      phase,
    });
    return null;
  }

  if (!isEnabledCronJob(latestJob)) {
    logger.info('scheduler.cold-start-catchup.skip-inactive-job', 'handleColdStartCatchUp', {
      alias: context.alias,
      jobId: latestJob.id,
      name: latestJob.name,
      phase,
      enabled: latestJob.enabled,
      scheduleType: latestJob.scheduleType,
      hasCronExpression: Boolean(latestJob.cronExpression),
    });
    return null;
  }

  return { ...latestJob, cronExpression: latestJob.cronExpression };
}

function isEnabledCronJob(job: SchedulerJob | null | undefined): job is FreshCronJob {
  return !!job && job.enabled && job.scheduleType === 'cron' && !!job.cronExpression;
}
