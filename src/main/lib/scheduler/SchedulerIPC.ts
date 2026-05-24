import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/scheduler';
import { schedulerManager } from './SchedulerManager';
import { profileCacheManager } from '../userDataADO/profileCacheManager';

let isRegistered = false;

export const registerSchedulerIPC = (): void => {
  if (isRegistered) return;

  const handle = renderToMain.bindMain(ipcMain);

  handle.listJobs(async () => {
    try {
      const jobs = await schedulerManager.listJobs();
      return { success: true, data: jobs };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.createJob(async (_event, job) => {
    try {
      const success = await schedulerManager.createJob(job);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.deleteJob(async (_event, jobId) => {
    try {
      const success = await schedulerManager.deleteJob(jobId);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.toggleJob(async (_event, jobId, enabled) => {
    try {
      const success = await schedulerManager.toggleJob(jobId, enabled);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.updateJob(async (_event, jobId, updates) => {
    try {
      const success = await schedulerManager.updateJob(jobId, updates);
      return { success };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.runJobNow(async (_event, jobId) => {
    try {
      const result = await schedulerManager.runJobNow(jobId);
      if (!result.success) {
        return { success: false, error: result.error || 'Failed to run schedule' };
      }

      return {
        success: true,
        data: {
          chatSessionId: result.chatSessionId,
          messagesCount: result.messagesCount,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.getJobSessions(async (_event, jobId) => {
    try {
      const job = await schedulerManager.getJob(jobId);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      const alias = schedulerManager.getUserAlias();
      if (!alias) {
        return { success: false, error: 'No user alias' };
      }

      // Load all sessions for this agent, then filter by schedulerJobId
      const allSessions = await profileCacheManager.getChatSessionsAsync(alias, job.agentId);
      const matched = allSessions
        .filter(s => s.schedulerJobId === jobId)
        .map(s => ({
          chatSession_id: s.chatSession_id,
          title: s.title,
          last_updated: s.last_updated,
        }));

      // Sort newest first
      matched.sort((a, b) => b.last_updated.localeCompare(a.last_updated));

      return { success: true, data: matched };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  isRegistered = true;
};
