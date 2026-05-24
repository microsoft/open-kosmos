import { connectRenderToMain } from './base';
import type { SchedulerJob } from '../../main/lib/scheduler/types';

export type { SchedulerJob };
export type SchedulerJobCreateInput = Omit<SchedulerJob, 'id'> & { id?: string };

export interface SchedulerSessionInfo {
  chatSession_id: string;
  title: string;
  last_updated: string;
}

export interface SchedulerManualRunResult {
  chatSessionId?: string;
  messagesCount?: number;
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
    call: [jobId: string, updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'scheduleType' | 'cronExpression' | 'runAt' | 'description' | 'enabled' | 'status' | 'lastRunAt' | 'executedAt' | 'notifyOnCompletion'>>];
    return: { success: boolean; error?: string };
  };
  runJobNow: {
    call: [jobId: string];
    return: { success: boolean; data?: SchedulerManualRunResult; error?: string };
  };
  getJobSessions: {
    call: [jobId: string];
    return: { success: boolean; data?: SchedulerSessionInfo[]; error?: string };
  };
};

export const renderToMain = connectRenderToMain<RenderToMain>('scheduler');
