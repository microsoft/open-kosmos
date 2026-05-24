import { CronExpressionParser } from 'cron-parser';

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