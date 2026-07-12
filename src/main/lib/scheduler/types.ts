export type SchedulerJobType = 'cron' | 'once';

export type SchedulerJobStatus = 'pending' | 'completed' | 'expired' | 'failed';

/**
 * History retention policy for scheduler job execution sessions.
 * Adopts the Kubernetes CronJob pattern: retain a bounded number of
 * successful and failed execution records to prevent unbounded growth.
 */
export interface SchedulerHistoryRetention {
  /** Max successful execution sessions to keep. Default: 20 for high-freq cron, 50 otherwise */
  successfulLimit: number;
  /** Max failed execution sessions to keep. Default: 10 for high-freq cron, 20 otherwise */
  failedLimit: number;
}

export interface SchedulerJob {
  /** Unique identifier */
  id: string;
  /** Task description */
  description: string;
  /** Human-readable name */
  name: string;
  /** Schedule type */
  scheduleType: SchedulerJobType;
  /** node-cron expression, required for recurring jobs */
  cronExpression?: string;
  /** ISO timestamp, required for one-time jobs */
  runAt?: string;
  /** Whether the job is enabled */
  enabled: boolean;
  /** chat_id that owns this job (the chat whose agent runs the scheduled prompt) */
  chat_id: string;
  /** Prompt to send as the first message when triggered */
  message: string;
  /** Current lifecycle status */
  status: SchedulerJobStatus;
  /** Last execution attempt time */
  lastRunAt?: string;
  /** Last execution finish time (success or failure) */
  lastFinishedAt?: string;
  /** Completion time for one-time jobs */
  executedAt?: string;
  /**
   * History retention policy for this job's execution sessions.
   * When omitted, defaults are applied based on cron frequency.
   * One-time jobs do not use retention (they execute only once).
   */
  historyRetention?: SchedulerHistoryRetention;
}

export interface ScheduleMonthFile {
  schedulerJobs: SchedulerJob[];
}

export interface ScheduleJobLocation {
  monthKey: string;
  job: SchedulerJob;
}

export type ScheduleJobUpdate = Partial<SchedulerJob>;

export type ScheduleJobCreateInput = Omit<SchedulerJob, 'id'> & { id?: string };

export function isSchedulerJobStatus(value: unknown): value is SchedulerJobStatus {
  return value === 'pending' || value === 'completed' || value === 'expired' || value === 'failed';
}

export function isSchedulerJobType(value: unknown): value is SchedulerJobType {
  return value === 'cron' || value === 'once';
}

export function normalizeSchedulerJob(job: Partial<SchedulerJob> & Pick<SchedulerJob, 'id'> & { agentId?: string }): SchedulerJob {
  return {
    id: typeof job.id === 'string' ? job.id : '',
    description: typeof job.description === 'string' ? job.description : '',
    name: typeof job.name === 'string' ? job.name : '',
    scheduleType: job.scheduleType === 'once' ? 'once' : 'cron',
    cronExpression: typeof job.cronExpression === 'string' ? job.cronExpression : undefined,
    runAt: typeof job.runAt === 'string' ? job.runAt : undefined,
    enabled: typeof job.enabled === 'boolean' ? job.enabled : true,
    chat_id: typeof job.chat_id === 'string' ? job.chat_id : (typeof job.agentId === 'string' ? job.agentId : ''),
    message: typeof job.message === 'string' ? job.message : '',
    status: isSchedulerJobStatus(job.status) ? job.status : 'pending',
    lastRunAt: typeof job.lastRunAt === 'string' ? job.lastRunAt : undefined,
    lastFinishedAt: typeof job.lastFinishedAt === 'string' ? job.lastFinishedAt : undefined,
    executedAt: typeof job.executedAt === 'string' ? job.executedAt : undefined,
    historyRetention: normalizeHistoryRetention(job.historyRetention),
  };
}

function normalizeHistoryRetention(
  retention: SchedulerHistoryRetention | undefined
): SchedulerHistoryRetention | undefined {
  if (!retention) return undefined;
  if (typeof retention !== 'object') return undefined;
  const successfulLimit = typeof retention.successfulLimit === 'number' && retention.successfulLimit >= 0
    ? retention.successfulLimit
    : undefined;
  const failedLimit = typeof retention.failedLimit === 'number' && retention.failedLimit >= 0
    ? retention.failedLimit
    : undefined;
  if (successfulLimit === undefined && failedLimit === undefined) return undefined;
  return {
    successfulLimit: successfulLimit ?? 20,
    failedLimit: failedLimit ?? 10,
  };
}

export function normalizeScheduleMonthFile(input: unknown): ScheduleMonthFile {
  const schedulerJobs = Array.isArray((input as ScheduleMonthFile | null | undefined)?.schedulerJobs)
    ? (input as ScheduleMonthFile).schedulerJobs.map((job) => normalizeSchedulerJob(job))
    : [];

  return { schedulerJobs };
}
