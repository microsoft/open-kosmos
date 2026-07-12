import { CronExpressionParser } from 'cron-parser';
import type { SchedulerJob } from './types';
import type { PendingColdStartCatchUp } from './schedulerRuntimeStateStore';

export const MAX_RESUME_CATCH_UP_DELAY_MS = 6 * 60 * 60 * 1000;

export interface ColdStartCatchUpBaseline {
  windowStartAt: string;
  source: 'clean-exit' | 'unclean-exit';
}

export interface SchedulerActivationBaselineState {
  isActive: boolean;
  lastActivatedAt?: string;
  lastDeactivatedAt?: string;
}

function normalizeDateInput(value: Date | number | string): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getSchedulerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function findMissedCronOccurrence(
  cronExpression: string,
  suspendedAt: Date | number | string,
  resumedAt: Date | number | string,
  timeZone = getSchedulerTimeZone(),
): Date | null {
  if (!cronExpression.trim()) {
    return null;
  }

  const suspendedDate = normalizeDateInput(suspendedAt);
  const resumedDate = normalizeDateInput(resumedAt);

  if (!suspendedDate || !resumedDate) {
    return null;
  }

  if (resumedDate.getTime() <= suspendedDate.getTime()) {
    return null;
  }

  try {
    const expression = CronExpressionParser.parse(cronExpression, {
      currentDate: resumedDate,
      startDate: suspendedDate,
      tz: timeZone,
    });
    const previousOccurrence = expression.prev();
    const previousOccurrenceMs = previousOccurrence.getTime();

    if (previousOccurrenceMs > suspendedDate.getTime() && previousOccurrenceMs <= resumedDate.getTime()) {
      return new Date(previousOccurrenceMs);
    }

    return null;
  } catch {
    return null;
  }
}

export function shouldCatchUpMissedOccurrence(
  missedOccurrence: Date | number | string,
  resumedAt: Date | number | string,
  maxDelayMs = MAX_RESUME_CATCH_UP_DELAY_MS,
): boolean {
  const missedDate = normalizeDateInput(missedOccurrence);
  const resumedDate = normalizeDateInput(resumedAt);

  if (!missedDate || !resumedDate) {
    return false;
  }

  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    return false;
  }

  const delayMs = resumedDate.getTime() - missedDate.getTime();
  return delayMs >= 0 && delayMs <= maxDelayMs;
}

export function getColdStartCatchUpBaseline(previousState: SchedulerActivationBaselineState | null): ColdStartCatchUpBaseline | null {
  if (!previousState) {
    return null;
  }

  const activatedAt = previousState.lastActivatedAt ? normalizeDateInput(previousState.lastActivatedAt) : null;
  const deactivatedAt = previousState.lastDeactivatedAt ? normalizeDateInput(previousState.lastDeactivatedAt) : null;

  if (previousState.isActive) {
    if (!activatedAt) {
      return null;
    }

    return {
      windowStartAt: activatedAt.toISOString(),
      source: 'unclean-exit',
    };
  }

  const cleanWindowStart = deactivatedAt ?? activatedAt;
  if (!cleanWindowStart) {
    return null;
  }

  return {
    windowStartAt: cleanWindowStart.toISOString(),
    source: 'clean-exit',
  };
}

export interface PendingColdStartReplayItem {
  job: SchedulerJob;
  occurrenceAt: string;
}

export interface PendingColdStartReplayPlan {
  replay: PendingColdStartReplayItem[];
  drop: string[];
}

/**
 * Decide which persisted pending cold-start catch-ups should be replayed now and
 * which should be dropped. A pending entry is replayed only when its job is still
 * an enabled cron job, its occurrence has not already been completed by a later
 * finished run, and it is still inside the catch-up window; otherwise it is
 * dropped so the persisted state does not accumulate stale entries.
 */
export function planPendingColdStartReplays(
  pending: Record<string, PendingColdStartCatchUp> | undefined,
  jobs: SchedulerJob[],
  nowMs: number,
): PendingColdStartReplayPlan {
  const plan: PendingColdStartReplayPlan = { replay: [], drop: [] };
  const entries = Object.entries(pending ?? {});
  if (entries.length === 0) {
    return plan;
  }

  const jobById = new Map(jobs.map((job) => [job.id, job]));
  for (const [jobId, entry] of entries) {
    const job = jobById.get(jobId);
    if (!job || !job.enabled || job.scheduleType !== 'cron' || !job.cronExpression) {
      plan.drop.push(jobId);
      continue;
    }

    const occurrenceMs = new Date(entry.occurrenceAt).getTime();
    if (!Number.isFinite(occurrenceMs)) {
      plan.drop.push(jobId);
      continue;
    }

    const lastFinishedAtMs = job.lastFinishedAt ? Date.parse(job.lastFinishedAt) : Number.NaN;
    if (Number.isFinite(lastFinishedAtMs) && lastFinishedAtMs >= occurrenceMs) {
      plan.drop.push(jobId);
      continue;
    }

    if (!shouldCatchUpMissedOccurrence(occurrenceMs, nowMs)) {
      plan.drop.push(jobId);
      continue;
    }

    plan.replay.push({ job, occurrenceAt: entry.occurrenceAt });
  }

  return plan;
}

export interface PendingColdStartReplayContext {
  readState: () => Promise<{ pendingColdStartCatchUps?: Record<string, PendingColdStartCatchUp> }>;
  listJobs: () => Promise<SchedulerJob[]>;
  clearPending: (jobId: string) => Promise<unknown>;
  replay: (job: SchedulerJob, occurrenceAt: string) => Promise<unknown>;
  now?: () => number;
}

/**
 * Read persisted pending cold-start catch-ups, drop the stale/superseded ones, and
 * replay the still-valid ones. Kept here (rather than inline in SchedulerManager) so
 * the whole drop/replay flow can be unit-tested without the scheduler runtime.
 */
export async function runPendingColdStartReplays(context: PendingColdStartReplayContext): Promise<void> {
  const runtimeState = await context.readState();
  const pending = runtimeState.pendingColdStartCatchUps;
  if (!pending || Object.keys(pending).length === 0) {
    return;
  }

  const jobs = await context.listJobs();
  const plan = planPendingColdStartReplays(pending, jobs, (context.now ?? Date.now)());
  for (const jobId of plan.drop) {
    await context.clearPending(jobId);
  }
  for (const item of plan.replay) {
    await context.replay(item.job, item.occurrenceAt);
  }
}