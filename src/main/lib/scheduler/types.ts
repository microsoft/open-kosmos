export type SchedulerJobType = 'cron' | 'once';

export type SchedulerJobStatus = 'pending' | 'completed' | 'expired' | 'failed';

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
  /** chat_id of the owning agent */
  agentId: string;
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
  /** Whether to send a notification on completion. Defaults to true. */
  notifyOnCompletion?: boolean;
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

export function normalizeSchedulerJob(job: Partial<SchedulerJob> & Pick<SchedulerJob, 'id'>): SchedulerJob {
  return {
    id: typeof job.id === 'string' ? job.id : '',
    description: typeof job.description === 'string' ? job.description : '',
    name: typeof job.name === 'string' ? job.name : '',
    scheduleType: job.scheduleType === 'once' ? 'once' : 'cron',
    cronExpression: typeof job.cronExpression === 'string' ? job.cronExpression : undefined,
    runAt: typeof job.runAt === 'string' ? job.runAt : undefined,
    enabled: typeof job.enabled === 'boolean' ? job.enabled : true,
    agentId: typeof job.agentId === 'string' ? job.agentId : '',
    message: typeof job.message === 'string' ? job.message : '',
    status: isSchedulerJobStatus(job.status) ? job.status : 'pending',
    lastRunAt: typeof job.lastRunAt === 'string' ? job.lastRunAt : undefined,
    lastFinishedAt: typeof job.lastFinishedAt === 'string' ? job.lastFinishedAt : undefined,
    executedAt: typeof job.executedAt === 'string' ? job.executedAt : undefined,
    notifyOnCompletion: typeof job.notifyOnCompletion === 'boolean' ? job.notifyOnCompletion : true,
  };
}

export function normalizeScheduleMonthFile(input: unknown): ScheduleMonthFile {
  const schedulerJobs = Array.isArray((input as ScheduleMonthFile | null | undefined)?.schedulerJobs)
    ? (input as ScheduleMonthFile).schedulerJobs.map((job) => normalizeSchedulerJob(job))
    : [];

  return { schedulerJobs };
}
