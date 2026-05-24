import { buildTimestampSegment } from '../../../shared/utils/idFormats';
import { generateScheduleJobId as generateRuntimeScheduleJobId } from '../utilities/idFactory';

export function generateScheduleJobId(date = new Date()): string {
  return generateRuntimeScheduleJobId(date);
}

export function extractMonthKeyFromScheduleJob(jobId: string): string | null {
  const match = /^sched_(\d{6})\d{8}(?:_[a-z0-9-]+_[a-z0-9]+|_[a-z0-9]+)$/i.exec(jobId);
  return match ? match[1] : null;
}

export function isValidScheduleJobId(jobId: string): boolean {
  return /^sched_\d{14}(?:_[a-z0-9-]+_[a-z0-9]+|_[a-z0-9]{8,16})$/i.test(jobId);
}

export function getCurrentScheduleMonthKey(date = new Date()): string {
  return buildTimestampSegment(date).slice(0, 6);
}

export function getMonthKeyFromRunAt(runAt: string): string | null {
  const timestamp = Date.parse(runAt);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return buildTimestampSegment(new Date(timestamp)).slice(0, 6);
}
