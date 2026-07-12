import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/scheduler';
import { schedulerManager } from './SchedulerManager';
import { cleanupAllSchedulerSessionHistory } from './sessionHistoryCleanup';
import { chatSessionManager } from '../userDataADO/chatSessionManager';

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

  handle.runJobNow(async (_event, jobId, options) => {
    try {
      const result = await schedulerManager.runJobNow(jobId, options);
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

  handle.getJobSessions(async (_event, jobId, options) => {
    try {
      const job = await schedulerManager.getJob(jobId);
      if (!job) {
        return { success: false, error: 'Job not found' };
      }

      const alias = schedulerManager.getUserAlias();
      if (!alias) {
        return { success: false, error: 'No user alias' };
      }

      // Use paginated query instead of loading all sessions
      const result = await chatSessionManager.getScheduledSessionsByJobId(
        alias,
        job.chat_id,
        jobId,
        { limit: options?.limit ?? 20, offset: options?.offset ?? 0 }
      );

      return {
        success: true,
        data: {
          sessions: result.sessions.map(s => ({
            chatSession_id: s.chatSession_id,
            title: s.title,
            last_updated: s.last_updated,
          })),
          total: result.total,
          hasMore: result.hasMore,
        },
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  handle.cleanupAllSessionHistory(async (_event, options) => {
    try {
      if (!options || typeof options !== 'object' || typeof options.chatId !== 'string' || options.chatId.trim().length === 0) {
        return { success: false, error: 'Chat id is required' };
      }

      const chatId = options.chatId.trim();
      const alias = schedulerManager.getUserAlias();
      if (!alias) {
        return { success: false, error: 'No user alias' };
      }

      let jobs = await schedulerManager.listJobs();
      jobs = jobs.filter(j => j.chat_id === chatId);
      const result = await cleanupAllSchedulerSessionHistory(alias, jobs, {
        includeOrphans: options.includeOrphans ?? true,
        chatId,
      });

      return { success: result.errors === 0, data: result, error: result.errors > 0 ? `${result.errors} deletion(s) failed` : undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  isRegistered = true;
};
