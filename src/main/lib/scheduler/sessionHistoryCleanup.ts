/**
 * Scheduler Session History Cleanup
 *
 * Implements the Kubernetes CronJob pattern for bounded retention of scheduler
 * execution sessions. High-frequency cron jobs can generate thousands of sessions
 * over time; this module automatically cleans up old sessions beyond the configured
 * retention limits.
 *
 * Design principles:
 * - Fire-and-forget: cleanup runs asynchronously after job execution, never blocking
 * - Fail-safe: cleanup errors are logged but never propagate to the scheduler
 * - Bounded: limits are per-job, so each job's history is independently managed
 * - Efficient: only queries sessions for the specific job being cleaned
 */

import { createConsoleLogger } from '../unifiedLogger';
import { chatSessionManager } from '../userDataADO/chatSessionManager';
import { chatSessionStore } from '../chat/chatSessionStore';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import type { ChatSession } from '../userDataADO/types/profile';
import type { SchedulerJob, SchedulerHistoryRetention } from './types';

const logger = createConsoleLogger();

/** Default retention for high-frequency cron (every 30 min or less) */
const HIGH_FREQ_DEFAULTS: SchedulerHistoryRetention = {
  successfulLimit: 20,
  failedLimit: 10,
};

/** Default retention for normal-frequency cron (hourly or less frequent) */
const NORMAL_FREQ_DEFAULTS: SchedulerHistoryRetention = {
  successfulLimit: 50,
  failedLimit: 20,
};

/**
 * Detect if a cron expression represents high-frequency execution.
 * High-frequency = executes more than twice per hour (every 30 min or less).
 *
 * Examples of high-frequency:
 * - `*\/5 * * * *` (every 5 min)
 * - `*\/10 * * * 1-5` (every 10 min on weekdays)
 * - `*\/30 * * * *` (every 30 min)
 *
 * Examples of normal-frequency:
 * - `0 * * * *` (every hour)
 * - `0 9 * * *` (daily at 9am)
 * - `0 0 * * 0` (weekly)
 */
export function isHighFrequencyCron(cronExpression: string | undefined): boolean {
  if (!cronExpression) return false;

  // Parse the minute field (first field in cron expression)
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const minuteField = parts[0];

  // `*` means every minute, which is the highest-frequency cron pattern.
  if (minuteField === '*') {
    return true;
  }

  // Check for step notation: */N where N <= 30
  const stepMatch = minuteField.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const interval = parseInt(stepMatch[1], 10);
    return interval > 0 && interval <= 30;
  }

  // Check for multiple specific minutes that result in high frequency
  // e.g., "0,30" = every 30 min, "0,15,30,45" = every 15 min
  if (minuteField.includes(',')) {
    const minutes = minuteField.split(',').map(m => parseInt(m, 10)).filter(m => !isNaN(m));
    if (minutes.length >= 2) {
      // 2+ executions per hour = high frequency (every 30 min or more often)
      return true;
    }
  }

  // Check for range with step: 0-59/N where N <= 30
  const rangeStepMatch = minuteField.match(/^\d+-\d+\/(\d+)$/);
  if (rangeStepMatch) {
    const interval = parseInt(rangeStepMatch[1], 10);
    return interval > 0 && interval <= 30;
  }

  return false;
}

/**
 * Get the effective retention limits for a job.
 * Priority: job.historyRetention > frequency-based defaults
 */
export function getEffectiveRetentionLimits(job: SchedulerJob): SchedulerHistoryRetention {
  // One-time jobs don't need retention (they only execute once)
  if (job.scheduleType === 'once') {
    return { successfulLimit: Infinity, failedLimit: Infinity };
  }

  // Use job-specific retention if configured
  if (job.historyRetention) {
    return job.historyRetention;
  }

  // Fall back to frequency-based defaults
  return isHighFrequencyCron(job.cronExpression) ? HIGH_FREQ_DEFAULTS : NORMAL_FREQ_DEFAULTS;
}

/**
 * Identify sessions to delete based on retention limits.
 * Returns session IDs that exceed the limits (oldest first).
 */
export function identifySessionsToDelete(
  sessions: ChatSession[],
  limits: SchedulerHistoryRetention
): string[] {
  // Separate by execution status
  const successful: ChatSession[] = [];
  const failed: ChatSession[] = [];
  const other: ChatSession[] = []; // running, no status, etc.

  for (const session of sessions) {
    if (session.schedulerExecutionStatus === 'completed') {
      successful.push(session);
    } else if (session.schedulerExecutionStatus === 'failed') {
      failed.push(session);
    } else {
      other.push(session);
    }
  }

  // Sort each group by last_updated descending (newest first)
  const sortByDate = (a: ChatSession, b: ChatSession) =>
    new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime();

  successful.sort(sortByDate);
  failed.sort(sortByDate);

  // Identify sessions beyond limits
  const toDelete: string[] = [];

  if (limits.successfulLimit !== Infinity && successful.length > limits.successfulLimit) {
    const excess = successful.slice(limits.successfulLimit);
    toDelete.push(...excess.map(s => s.chatSession_id));
  }

  if (limits.failedLimit !== Infinity && failed.length > limits.failedLimit) {
    const excess = failed.slice(limits.failedLimit);
    toDelete.push(...excess.map(s => s.chatSession_id));
  }

  // Note: 'other' (running, etc.) are never deleted to avoid interrupting active sessions

  return toDelete;
}

/**
 * Clean up old scheduler sessions for a specific job.
 * This is the main entry point called after job execution.
 *
 * @param alias - User alias
 * @param job - The scheduler job that just executed
 */
export async function cleanupSchedulerSessionHistory(
  alias: string,
  job: SchedulerJob
): Promise<{ deletedCount: number; errorCount: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Skip for one-time jobs
    if (job.scheduleType === 'once') {
      return { deletedCount: 0, errorCount: 0 };
    }

    const limits = getEffectiveRetentionLimits(job);

    // Scan month indexes incrementally (newest first) to collect job sessions
    // without loading full session content
    const chatIndex = await chatSessionManager.readChatIndex(alias, job.chat_id);
    if (!chatIndex || chatIndex.months.length === 0) {
      return { deletedCount: 0, errorCount: 0 };
    }

    const jobSessions: ChatSession[] = [];
    for (const month of chatIndex.months) {
      const monthData = await chatSessionManager.readMonthIndex(alias, job.chat_id, month);
      if (!monthData) continue;
      for (const session of monthData.sessions) {
        if (session.schedulerJobId === job.id) {
          jobSessions.push(session);
        }
      }
    }

    if (jobSessions.length === 0) {
      return { deletedCount: 0, errorCount: 0 };
    }

    // Check if cleanup is needed
    const successfulCount = jobSessions.filter(s => s.schedulerExecutionStatus === 'completed').length;
    const failedCount = jobSessions.filter(s => s.schedulerExecutionStatus === 'failed').length;

    if (successfulCount <= limits.successfulLimit && failedCount <= limits.failedLimit) {
      // No cleanup needed
      logger.debug('[SessionCleanup] No cleanup needed', 'cleanupSchedulerSessionHistory', {
        alias,
        jobId: job.id,
        successfulCount,
        failedCount,
        limits,
      });
      return { deletedCount: 0, errorCount: 0 };
    }

    // Identify sessions to delete
    const toDelete = identifySessionsToDelete(jobSessions, limits);

    if (toDelete.length === 0) {
      return { deletedCount: 0, errorCount: 0 };
    }

    // Delete sessions via chatSessionStore (cache-aware: evicts in-memory state, cleans attachments).
    // One notification is sent at the end of the entire cleanup operation.
    let deletedCount = 0;
    const errors: string[] = [];

    for (const sessionId of toDelete) {
      try {
        const success = await chatSessionStore.deleteSession(alias, job.chat_id, sessionId);
        if (success) {
          deletedCount++;
          await profileCacheManager.removeStarredChatSessionIndex(alias, sessionId, { notifyRenderer: false });
        } else {
          errors.push(sessionId);
        }
      } catch (err) {
        errors.push(sessionId);
      }
    }

    const duration = Date.now() - startTime;

    logger.info('[SessionCleanup] Cleaned old scheduler sessions', 'cleanupSchedulerSessionHistory', {
      alias,
      jobId: job.id,
      jobName: job.name,
      cronExpression: job.cronExpression,
      totalJobSessions: jobSessions.length,
      successfulKept: Math.min(successfulCount, limits.successfulLimit),
      failedKept: Math.min(failedCount, limits.failedLimit),
      deletedCount,
      deleteErrors: errors.length,
      durationMs: duration,
    });

    return {
      deletedCount,
      errorCount: errors.length,
      error: errors.length > 0 ? `Failed to delete ${errors.length} sessions` : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[SessionCleanup] Cleanup failed', 'cleanupSchedulerSessionHistory', {
      alias,
      jobId: job.id,
      error: errorMessage,
    });
    return { deletedCount: 0, errorCount: 1, error: errorMessage };
  }
}

/**
 * Run cleanup for all cron jobs of a user.
 * Used for migration/one-time cleanup of existing sessions.
 *
 * @param alias - User alias
 * @param jobs - All scheduler jobs for the user
 * @param options - Cleanup options
 */
export async function cleanupAllSchedulerSessionHistory(
  alias: string,
  jobs: SchedulerJob[],
  options?: { includeOrphans?: boolean; chatId?: string }
): Promise<{ totalDeleted: number; jobsProcessed: number; orphansDeleted: number; errors: number }> {
  const cronJobs = jobs.filter(j => j.scheduleType === 'cron');

  let totalDeleted = 0;
  let orphansDeleted = 0;
  let errors = 0;

  // Phase 1: Clean up sessions for existing jobs (retention-based)
  for (const job of cronJobs) {
    const result = await cleanupSchedulerSessionHistory(alias, job);
    totalDeleted += result.deletedCount;
    errors += result.errorCount ?? 0;
  }

  // Phase 2: Clean up orphan sessions (jobs that no longer exist)
  if (options?.includeOrphans) {
    const orphanResult = await cleanupOrphanSchedulerSessions(alias, jobs, { chatId: options?.chatId });
    orphansDeleted = orphanResult.deletedCount;
    totalDeleted += orphansDeleted;
    errors += orphanResult.errorCount ?? 0;
  }

  // Send ONE profile notification after all deletions complete
  if (totalDeleted > 0) {
    await profileCacheManager.forceNotifyProfileDataManager(alias);
  }

  logger.info('[SessionCleanup] Bulk cleanup completed', 'cleanupAllSchedulerSessionHistory', {
    alias,
    jobsProcessed: cronJobs.length,
    totalDeleted,
    orphansDeleted,
    includeOrphans: options?.includeOrphans ?? false,
    errors,
  });

  return { totalDeleted, jobsProcessed: cronJobs.length, orphansDeleted, errors };
}

/**
 * Clean up orphan scheduler sessions - sessions whose schedulerJobId
 * refers to a job that no longer exists.
 *
 * This handles the case where a user deletes a scheduler job but its
 * historical execution sessions remain on disk.
 *
 * @param alias - User alias
 * @param existingJobs - All current scheduler jobs (used to identify valid job IDs)
 */
export async function cleanupOrphanSchedulerSessions(
  alias: string,
  existingJobs: SchedulerJob[],
  options?: { chatId?: string }
): Promise<{ deletedCount: number; errorCount: number; error?: string }> {
  const startTime = Date.now();

  try {
    // Build a set of valid job IDs
    const validJobIds = new Set(existingJobs.map(j => j.id));

    // Get chats to scan — if chatId is provided, only scan that chat
    const allChats = profileCacheManager.getAllChatConfigs(alias);
    const chatsToScan = options?.chatId
      ? allChats.filter(c => c.chat_id === options.chatId)
      : allChats;

    let deletedCount = 0;
    const errors: string[] = [];

    // Scan each chat for orphan scheduler sessions (month-by-month to avoid loading all at once)
    for (const chat of chatsToScan) {
      try {
        const chatIndex = await chatSessionManager.readChatIndex(alias, chat.chat_id);
        if (!chatIndex || chatIndex.months.length === 0) continue;

        for (const month of chatIndex.months) {
          const monthData = await chatSessionManager.readMonthIndex(alias, chat.chat_id, month);
          if (!monthData) continue;

          // Find orphan sessions in this month
          const orphanSessions = monthData.sessions.filter(
            s => s.schedulerJobId && !validJobIds.has(s.schedulerJobId)
              && s.schedulerExecutionStatus !== 'running'
              && s.schedulerExecutionStatus !== undefined
          );

          // Delete orphan sessions via chatSessionStore (cache-aware, batched profile notification)
          for (const session of orphanSessions) {
            try {
              const success = await chatSessionStore.deleteSession(
                alias,
                chat.chat_id,
                session.chatSession_id
              );
              if (success) {
                deletedCount++;
                await profileCacheManager.removeStarredChatSessionIndex(alias, session.chatSession_id, { notifyRenderer: false });
              } else {
                errors.push(session.chatSession_id);
              }
            } catch {
              errors.push(session.chatSession_id);
            }
          }
        }
      } catch (err) {
        errors.push(`scan:${chat.chat_id}`);
        logger.warn('[SessionCleanup] Failed to scan chat for orphans', 'cleanupOrphanSchedulerSessions', {
          alias,
          chatId: chat.chat_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('[SessionCleanup] Orphan cleanup completed', 'cleanupOrphanSchedulerSessions', {
      alias,
      chatsScanned: chatsToScan.length,
      deletedCount,
      deleteErrors: errors.length,
      durationMs: duration,
    });

    return {
      deletedCount,
      errorCount: errors.length,
      error: errors.length > 0 ? `Failed to delete ${errors.length} orphan sessions` : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[SessionCleanup] Orphan cleanup failed', 'cleanupOrphanSchedulerSessions', {
      alias,
      error: errorMessage,
    });
    return { deletedCount: 0, errorCount: 1, error: errorMessage };
  }
}
