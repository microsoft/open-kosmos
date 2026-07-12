import { connectRenderToMain } from './base';
import type { SchedulerJob } from '../../main/lib/scheduler/types';

export type { SchedulerJob };
export type SchedulerJobCreateInput = Omit<SchedulerJob, 'id'> & { id?: string };

export interface SchedulerSessionInfo {
  chatSession_id: string;
  title: string;
  last_updated: string;
}

export interface SchedulerSessionPaginationOptions {
  limit?: number;
  offset?: number;
}

export interface SchedulerSessionPaginatedResult {
  sessions: SchedulerSessionInfo[];
  total: number;
  hasMore: boolean;
}

export interface SchedulerManualRunResult {
  chatSessionId?: string;
  messagesCount?: number;
}

export interface SchedulerManualRunOptions {
  /**
   * Marks the manual run as an explicit Retry of a spent one-time schedule
   * (the Schedules "..." menu Retry action on a failed/interrupted/cancelled
   * run). Only when this is true does the guard permit re-triggering a spent,
   * auto-disabled one-time schedule. Plain "Run now" callers omit it and keep
   * the strict "only enabled schedules can be run manually" behavior.
   */
  isManualRetry?: boolean;
}

export interface SchedulerCleanupResult {
  totalDeleted: number;
  jobsProcessed: number;
  orphansDeleted: number;
  errors: number;
}

export interface SchedulerCleanupOptions {
  /** Include orphan sessions (sessions from deleted jobs). Default: true */
  includeOrphans?: boolean;
  /** Scope cleanup to the specified chat's jobs. */
  chatId: string;
}

type RenderToMain = {
  listJobs: {
    call: [];
    return: { success: boolean; data?: SchedulerJob[]; error?: string };
  };
  createJob: {
    call: [job: SchedulerJobCreateInput];
    return: { success: boolean; error?: string };
  };
  deleteJob: {
    call: [jobId: string];
    return: { success: boolean; error?: string };
  };
  toggleJob: {
    call: [jobId: string, enabled: boolean];
    return: { success: boolean; error?: string };
  };
  updateJob: {
    call: [jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'enabled' | 'status' | 'lastRunAt' | 'executedAt'>>];
    return: { success: boolean; error?: string };
  };
  runJobNow: {
    call: [jobId: string, options?: SchedulerManualRunOptions];
    return: { success: boolean; data?: SchedulerManualRunResult; error?: string };
  };
  getJobSessions: {
    call: [jobId: string, options?: SchedulerSessionPaginationOptions];
    return: { success: boolean; data?: SchedulerSessionPaginatedResult; error?: string };
  };
  /**
   * Clean up old scheduler sessions for all cron jobs.
   * Applies retention limits (default: 20 successful, 10 failed for high-freq;
   * 50 successful, 20 failed for normal-freq). Use for migration or manual cleanup.
   */
  cleanupAllSessionHistory: {
    call: [options: SchedulerCleanupOptions];
    return: { success: boolean; data?: SchedulerCleanupResult; error?: string };
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('scheduler');
