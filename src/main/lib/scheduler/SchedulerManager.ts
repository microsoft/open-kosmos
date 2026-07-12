/**
 * SchedulerManager - Scheduled task runtime manager
 *
 * Responsible only for runtime registration and execution.
 * Schedule settings source of truth is owned by ScheduleStore.
 */

import * as cron from 'node-cron';
import { createLogger } from '../unifiedLogger';
import { agentChatManager } from '../chat/agentChatManager';
import { chatSessionStore } from '../chat/chatSessionStore';
import { scheduleStore } from './scheduleStore';
import { SchedulerJob, type ScheduleJobCreateInput } from './types';
import type { SchedulerManualRunOptions } from '../../../shared/ipc/scheduler';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { schedulerRuntimeStateStore, type SchedulerRuntimeState } from './schedulerRuntimeStateStore';
import { INTERRUPTED_SCHEDULED_SESSION_ERROR, SCHEDULER_ALIAS_CHANGED_ERROR } from '../../../shared/constants/scheduler';
import { generateChatSessionId as generateRuntimeChatSessionId } from '../userDataADO/pathUtils';
import {
  findMissedCronOccurrence,
  getSchedulerTimeZone,
  MAX_RESUME_CATCH_UP_DELAY_MS,
  runPendingColdStartReplays,
  shouldCatchUpMissedOccurrence,
} from './cronRecovery';
import { runCronWatchdog } from './cronWatchdog';
import { SchedulerExecutionGuards, type ExecutionToken } from './SchedulerExecutionGuards';
import { ensureSchedulerJobMcpReady, formatSchedulerMcpDisconnectedError } from './schedulerMcpReadiness';
import { runColdStartCatchUp } from './coldStartCatchUpRunner';
import { cleanupSchedulerSessionHistory } from './sessionHistoryCleanup';

const logger = createLogger();
const MAX_TIMEOUT_MS = 2_147_483_647;

type ActiveTask =
  | { kind: 'cron'; task: cron.ScheduledTask }
  | { kind: 'timeout'; timer: ReturnType<typeof setTimeout> };

type SchedulerTaskRuntimeMeta = {
  jobId: string;
  alias: string | null;
  schedulerGeneration: number;
  taskSequence: number;
  taskKind: ActiveTask['kind'];
  registeredAt: string;
  cronExpression?: string;
  runAt?: string;
  lastTickArrivedAt?: string;
  lastCronWatchdogCheckedAt?: string;
  lastCronWatchdogCatchUpAt?: string;
  pendingCronWatchdogRetryAt?: string;
  lastExecuteStartAt?: string;
  lastExecuteEndAt?: string;
  lastExecuteOutcome?: 'success' | 'failed';
  unregisteredAt?: string;
  lastUnregisterReason?: string;
};

type SchedulerExecutionResult = {
  success: boolean;
  cancelled?: boolean;
  chatSessionId?: string;
  messagesCount?: number;
  error?: string;
};

type SchedulerDisposeReason =
  | 'app-quit'
  | 'updater-handoff'
  | 'auth-destroy-current-session'
  | 'alias-switch'
  | 'window-close'
  | 'manual-debug'
  | 'unknown';

type SchedulerTaskUnregisterReason =
  | 're-register-before-cron-register'
  | 're-register-before-once-register'
  | 'initialize-clear'
  | 'dispose'
  | 'app-quit'
  | 'updater-handoff'
  | 'auth-destroy-current-session'
  | 'toggle-disable'
  | 'toggle-enable-replace-existing'
  | 'update-job'
  | 'delete-job'
  | 'once-job-completed'
  | 'once-job-failed'
  | 'once-job-expired'
  | 'alias-switch'
  | 'window-close'
  | 'manual-debug'
  | 'unknown';

type SchedulerRuntimeDiagnostics = {
  alias: string | null;
  schedulerGeneration: number;
  activeTaskCount: number;
  activeJobIds: string[];
  executingJobIds: string[];
  executionSlotsAvailable: number;
  maxConcurrentExecutions: number;
  taskRuntimeMetaSnapshot: SchedulerTaskRuntimeMeta[];
};

export class SchedulerManager {
  private static instance: SchedulerManager;

  private static readonly HEARTBEAT_INTERVAL_MS = 60_000;

  /** Active scheduled tasks: jobId -> task handle */
  private activeTasks: Map<string, ActiveTask> = new Map();

  /** Current user alias */
  private currentUserAlias: string | null = null;

  private currentAliasActivatedAt: string | null = null;

  private schedulerGeneration = 0;

  private taskSequence = 0;

  private taskRuntimeMeta: Map<string, SchedulerTaskRuntimeMeta> = new Map();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private static readonly MAX_CONCURRENT_EXECUTIONS = 3;

  private executionGuards = new SchedulerExecutionGuards(SchedulerManager.MAX_CONCURRENT_EXECUTIONS);

  private constructor() {}

  static getInstance(): SchedulerManager {
    if (!SchedulerManager.instance) {
      SchedulerManager.instance = new SchedulerManager();
    }
    return SchedulerManager.instance;
  }

  /** Get current user alias */
  getUserAlias(): string | null {
    return this.currentUserAlias;
  }

  getRuntimeDiagnostics(): SchedulerRuntimeDiagnostics {
    const activeJobIds = Array.from(this.activeTasks.keys());
    return {
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      activeTaskCount: this.activeTasks.size,
      activeJobIds,
      executingJobIds: this.executionGuards.getExecutingJobIds(),
      executionSlotsAvailable: this.executionGuards.getExecutionSlotsAvailable(),
      maxConcurrentExecutions: this.executionGuards.maxConcurrentExecutions,
      taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(activeJobIds),
    };
  }

  /** Initialize runtime tasks from ScheduleStore */
  async initialize(alias: string): Promise<void> {
    const previousAlias = this.currentUserAlias;
    const previousGeneration = this.schedulerGeneration;
    this.schedulerGeneration += 1;
    const schedulerGeneration = this.schedulerGeneration;
    const previousActiveTasks = this.activeTasks.size;
    const activeJobIdsBefore = Array.from(this.activeTasks.keys());
    const startupAtMs = Date.now();
    const startupAtIso = new Date(startupAtMs).toISOString();

    if (this.currentUserAlias && this.currentUserAlias !== alias) {
      await this.markAliasDeactivated(this.currentUserAlias, startupAtIso);
    }

    this.currentUserAlias = alias;
    this.currentAliasActivatedAt = startupAtIso;
    this.clearActiveTasks(previousAlias && previousAlias !== alias ? 'alias-switch' : 'initialize-clear');
    this.executionGuards.reset();

    logger.info('scheduler.initialize.start', 'initialize', {
      alias,
      previousAlias,
      schedulerGeneration,
      previousGeneration,
      activeTaskCountBefore: previousActiveTasks,
      activeJobIdsBefore,
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
    });

    try {
      await this.recoverInterruptedScheduledSessions(alias);
      logger.info('scheduler.recover-interrupted.end', 'initialize', {
        alias,
        schedulerGeneration,
      });

      await scheduleStore.initialize(alias);
      logger.info('scheduler.store.initialize.end', 'initialize', {
        alias,
        schedulerGeneration,
      });

      const runtimeState = await schedulerRuntimeStateStore.readState(alias);
      await schedulerRuntimeStateStore.markActivated(alias, startupAtIso);

      const jobs = await scheduleStore.listJobs(alias);
      const enabledJobs = jobs.filter((job) => job.enabled);
      const cronJobs = enabledJobs.filter((job) => job.scheduleType === 'cron').length;
      const oneTimeJobs = enabledJobs.filter((job) => job.scheduleType === 'once').length;

      logger.info('scheduler.initialize.jobs-loaded', 'initialize', {
        alias,
        schedulerGeneration,
        totalJobs: jobs.length,
        enabledJobs: enabledJobs.length,
        disabledJobs: jobs.length - enabledJobs.length,
        enabledCronJobs: cronJobs,
        enabledOneTimeJobs: oneTimeJobs,
        enabledJobIds: enabledJobs.map((job) => job.id),
        enabledJobSnapshots: enabledJobs.map((job) => ({
          jobId: job.id,
          name: job.name,
          scheduleType: job.scheduleType,
          cronExpression: job.cronExpression,
          runAt: job.runAt,
          enabled: job.enabled,
          status: job.status,
          lastRunAt: job.lastRunAt,
        })),
      });

      // Arm live cron ticks and the heartbeat before the gated cold-start catch-up.
      for (const job of jobs) {
        if (job.enabled) {
          try {
            await this.registerJob(job);
          } catch (error) {
            logger.warn('scheduler.initialize.register-job-failed', 'initialize', {
              alias,
              schedulerGeneration,
              jobId: job.id,
              name: job.name,
              scheduleType: job.scheduleType,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      }

      this.startHeartbeat();

      logger.info('scheduler.initialize.live-armed', 'initialize', {
        alias,
        schedulerGeneration,
        activeTasks: this.activeTasks.size,
        activeJobIds: Array.from(this.activeTasks.keys()),
      });

      await this.handleColdStartCatchUp(startupAtMs, jobs, runtimeState);

      logger.info('scheduler.initialize.end', 'initialize', {
        alias,
        schedulerGeneration,
        totalJobs: jobs.length,
        enabledJobs: enabledJobs.length,
        activeTasks: this.activeTasks.size,
        activeJobIds: Array.from(this.activeTasks.keys()),
      });
    } catch (error) {
      logger.warn('scheduler.initialize.failed', 'initialize', {
        alias,
        schedulerGeneration,
        error: error instanceof Error ? error.message : String(error),
        activeTasks: this.activeTasks.size,
        activeJobIds: Array.from(this.activeTasks.keys()),
      });
    }
  }

  async createJob(job: ScheduleJobCreateInput): Promise<boolean> {
    if (!this.currentUserAlias) {
      throw new Error('Scheduler is not initialized for the current user.');
    }

    try {
      const created = await scheduleStore.createJob(this.currentUserAlias, job);
      if (created.enabled) {
        await this.registerJob(created);
      }
      return true;
    } catch (error) {
      logger.warn('scheduler.job.create.failed', 'createJob', {
        alias: this.currentUserAlias,
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async deleteJob(jobId: string): Promise<boolean> {
    if (!this.currentUserAlias) {
      throw new Error('Scheduler is not initialized for the current user.');
    }

    this.unregisterTask(jobId, 'delete-job');
    const deleted = await scheduleStore.deleteJob(this.currentUserAlias, jobId);
    if (!deleted) {
      throw new Error(`Schedule job not found: ${jobId}`);
    }
    return true;
  }

  async toggleJobsByAgent(chatId: string, enabled: boolean): Promise<number> {
    if (!this.currentUserAlias) {
      logger.warn('scheduler.toggle-jobs-for-agent.skipped-no-alias', 'toggleJobsByAgent', { chatId, enabled });
      return 0;
    }
    const jobs = await scheduleStore.listJobs(this.currentUserAlias, chatId);
    let toggled = 0;
    for (const job of jobs) {
      if (job.enabled === enabled) continue;
      try {
        await this.toggleJob(job.id, enabled);
        toggled++;
      } catch (err) {
        logger.warn('scheduler.toggle-job-for-agent.failed', 'toggleJobsByAgent', {
          alias: this.currentUserAlias, chatId, jobId: job.id, enabled,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info('scheduler.jobs-toggled-for-agent', 'toggleJobsByAgent', {
      alias: this.currentUserAlias, chatId, enabled, toggledCount: toggled,
    });
    return toggled;
  }

  async listJobs(chatId?: string): Promise<SchedulerJob[]> {
    if (!this.currentUserAlias) return [];
    return await scheduleStore.listJobs(this.currentUserAlias, chatId);
  }

  async getJob(jobId: string): Promise<SchedulerJob | null> {
    if (!this.currentUserAlias) return null;
    return await scheduleStore.getJob(this.currentUserAlias, jobId);
  }

  async updateJob(
    jobId: string,
    updates: Partial<Pick<SchedulerJob, 'name' | 'message' | 'cronExpression' | 'runAt' | 'description' | 'enabled' | 'scheduleType' | 'status' | 'lastRunAt' | 'executedAt'>>,
  ): Promise<boolean> {
    if (!this.currentUserAlias) {
      throw new Error('Scheduler is not initialized for the current user.');
    }

    try {
      const updated = await scheduleStore.updateJob(this.currentUserAlias, jobId, updates);
      if (!updated) {
        throw new Error(`Schedule job not found: ${jobId}`);
      }

      this.unregisterTask(jobId, 'update-job');
      if (updated.enabled) {
        await this.registerJob(updated);
      }
      return true;
    } catch (error) {
      logger.warn('scheduler.job.update.failed', 'updateJob', {
        alias: this.currentUserAlias,
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async toggleJob(jobId: string, enabled: boolean): Promise<boolean> {
    if (!this.currentUserAlias) {
      throw new Error('Scheduler is not initialized for the current user.');
    }

    try {
      const updated = await scheduleStore.toggleJob(this.currentUserAlias, jobId, enabled);
      if (!updated) {
        throw new Error(`Schedule job not found: ${jobId}`);
      }

      this.unregisterTask(jobId, enabled ? 'toggle-enable-replace-existing' : 'toggle-disable');
      if (updated.enabled) {
        await this.registerJob(updated);
      }
      return true;
    } catch (error) {
      logger.warn('scheduler.job.toggle.failed', 'toggleJob', {
        alias: this.currentUserAlias,
        jobId,
        enabled,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * A one-time schedule is auto-disabled once its single run concludes — whether
   * it completed, failed, was cancelled/interrupted (recorded as a disabled
   * 'completed' job, indistinguishable from a clean completion), or expired. Such
   * a "spent" one-time schedule can be re-triggered from the beginning, but ONLY
   * via the explicit Schedules "..." menu Retry action (which passes
   * `isManualRetry`). Plain "Run now" callers (schedule cards, the Agent editor
   * Schedules tab, the run-schedule tool) deliberately keep the strict guard so
   * they cannot rerun a spent one-time schedule.
   *
   * "Spent" is detected by `status !== 'pending'` OR a set `lastRunAt`. The
   * `lastRunAt` fallback is essential: `markJobExecutionStarted` transiently
   * resets `status` back to 'pending' (and stamps `lastRunAt`) for the duration
   * of a run. If the app crashes/exits mid-retry, recovery only patches the chat
   * session metadata to 'failed' — it never restores the job's terminal status —
   * so the job is left at `status: 'pending'` while still being a spent run.
   * Without the `lastRunAt` check the interrupted retry would still surface a
   * Retry button yet be rejected as non-rerunnable, stranding the user. Because
   * `lastRunAt` is only ever written by execution, a one-time schedule that has
   * never run (status 'pending' and no `lastRunAt`) and is disabled was explicitly
   * turned off, not spent, so even Retry leaves it blocked. Cron schedules are
   * never auto-disabled, so a disabled cron stays blocked too.
   */
  private isRerunnableOnce(job: SchedulerJob): boolean {
    if (job.scheduleType !== 'once') {
      return false;
    }
    return job.status !== 'pending' || job.lastRunAt != null;
  }

  async runJobNow(
    jobId: string,
    options?: SchedulerManualRunOptions,
  ): Promise<SchedulerExecutionResult> {
    if (!this.currentUserAlias) {
      return {
        success: false,
        error: 'Scheduler is not initialized for the current user.',
      };
    }

    const job = await scheduleStore.getJob(this.currentUserAlias, jobId);
    if (!job) {
      return {
        success: false,
        error: `Schedule job not found: ${jobId}`,
      };
    }

    const allowSpentOnceRetry = options?.isManualRetry === true && this.isRerunnableOnce(job);
    if (!job.enabled && !allowSpentOnceRetry) {
      return {
        success: false,
        error: 'Only enabled schedules can be run manually.',
      };
    }

    logger.info('scheduler.job.run-now.start', 'runJobNow', {
      alias: this.currentUserAlias,
      jobId: job.id,
      name: job.name,
      chatId: job.chat_id,
      scheduleType: job.scheduleType,
    });

    const chatSessionId = generateRuntimeChatSessionId();

    return await new Promise<SchedulerExecutionResult>((resolve) => {
      let resolved = false;

      void this.executeJob(job, 'manual', chatSessionId, (readyPayload) => {
        if (resolved) {
          return;
        }

        resolved = true;
        resolve({
          success: true,
          chatSessionId: readyPayload.chatSessionId,
        });
      }).then((result) => {
        if (!result.success) {
          logger.warn('scheduler.job.run-now.dispatch-failed', 'runJobNow', {
            alias: this.currentUserAlias,
            jobId: job.id,
            name: job.name,
            chatSessionId,
            error: result.error || 'Unknown error',
          });
        }

        if (resolved) {
          return;
        }

        resolved = true;
        resolve(result);
      });
    });
  }

  async handleSystemResume(suspendedAtMs: number, resumedAtMs: number): Promise<void> {
    if (!this.currentUserAlias) {
      return;
    }

    if (!Number.isFinite(suspendedAtMs) || !Number.isFinite(resumedAtMs) || resumedAtMs <= suspendedAtMs) {
      return;
    }

    try {
      const jobs = await scheduleStore.listJobs(this.currentUserAlias);
      const recurringJobs = jobs.filter(
        (job) => job.enabled && job.scheduleType === 'cron' && !!job.cronExpression,
      );

      if (recurringJobs.length === 0) {
        return;
      }

      const schedulerTimeZone = getSchedulerTimeZone();
      let recoveredRuns = 0;

      logger.info('scheduler.resume-catchup.start', 'handleSystemResume', {
        alias: this.currentUserAlias,
        recurringJobs: recurringJobs.length,
        suspendedAt: new Date(suspendedAtMs).toISOString(),
        resumedAt: new Date(resumedAtMs).toISOString(),
        schedulerTimeZone,
      });

      for (const job of recurringJobs) {
        const missedOccurrence = findMissedCronOccurrence(
          job.cronExpression || '',
          suspendedAtMs,
          resumedAtMs,
          schedulerTimeZone,
        );

        if (!missedOccurrence) {
          continue;
        }

        const catchUpDelayMs = resumedAtMs - missedOccurrence.getTime();
        if (!shouldCatchUpMissedOccurrence(missedOccurrence, resumedAtMs)) {
          logger.info('scheduler.resume-catchup.skip-stale', 'handleSystemResume', {
            alias: this.currentUserAlias,
            jobId: job.id,
            name: job.name,
            cron: job.cronExpression,
            missedScheduledAt: missedOccurrence.toISOString(),
            catchUpDelayMs,
            maxCatchUpDelayMs: MAX_RESUME_CATCH_UP_DELAY_MS,
          });
          continue;
        }

        const lastRunAtMs = job.lastRunAt ? Date.parse(job.lastRunAt) : Number.NaN;
        if (Number.isFinite(lastRunAtMs) && lastRunAtMs >= missedOccurrence.getTime()) {
          logger.info('scheduler.resume-catchup.skip-started', 'handleSystemResume', {
            alias: this.currentUserAlias,
            jobId: job.id,
            name: job.name,
            cron: job.cronExpression,
            missedScheduledAt: missedOccurrence.toISOString(),
            lastRunAt: job.lastRunAt,
          });
          continue;
        }

        logger.info('scheduler.resume-catchup.execute', 'handleSystemResume', {
          alias: this.currentUserAlias,
          jobId: job.id,
          name: job.name,
          cron: job.cronExpression,
          missedScheduledAt: missedOccurrence.toISOString(),
          catchUpDelayMs,
        });

        const result = await this.executeJob(job, 'resume-catchup');
        if (result.success) {
          recoveredRuns += 1;
        }
      }

      logger.info('scheduler.resume-catchup.end', 'handleSystemResume', {
        alias: this.currentUserAlias,
        recurringJobs: recurringJobs.length,
        recoveredRuns,
      });
    } catch (error) {
      logger.warn('scheduler.resume-catchup.failed', 'handleSystemResume', {
        alias: this.currentUserAlias,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleColdStartCatchUp(
    startupAtMs: number,
    jobs: SchedulerJob[],
    runtimeState: SchedulerRuntimeState,
  ): Promise<void> {
    const alias = this.currentUserAlias;
    if (!alias) {
      return;
    }

    await runColdStartCatchUp({
      alias,
      startupAtMs,
      jobs,
      runtimeState,
      getJob: (jobId) => scheduleStore.getJob(alias, jobId),
      clearPending: (jobId) => schedulerRuntimeStateStore.clearPendingColdStartCatchUp(alias, jobId),
      execute: (job, occurrenceAt, alreadyPending) =>
        this.executeColdStartCatchUp(job, occurrenceAt, alreadyPending),
    });
  }

  private async recoverInterruptedScheduledSessions(alias: string): Promise<void> {
    const chats = profileCacheManager.getAllChatConfigs(alias);
    const recoveredSessionIds: string[] = [];
    logger.info('scheduler.recover-interrupted.start', 'recoverInterruptedScheduledSessions', {
      alias,
      schedulerGeneration: this.schedulerGeneration,
      chatCount: chats.length,
    });

    if (chats.length === 0) {
      logger.info('scheduler.recover-interrupted.end', 'recoverInterruptedScheduledSessions', {
        alias,
        schedulerGeneration: this.schedulerGeneration,
        recoveredCount: 0,
        recoveredSessionIds,
        scannedChats: 0,
      });
      return;
    }

    let recoveredCount = 0;

    for (const chat of chats) {
      try {
        const projection = await chatSessionStore.getChatSessionsProjection(alias, chat.chat_id);
        logger.info('scheduler.recover-interrupted.chat-scan', 'recoverInterruptedScheduledSessions', {
          alias,
          schedulerGeneration: this.schedulerGeneration,
          chatId: chat.chat_id,
          sessionCount: projection.sessions.length,
        });

        for (const session of projection.sessions) {
          if (!session.schedulerJobId || session.schedulerExecutionStatus !== 'running') {
            continue;
          }

          const patched = await chatSessionStore.patchSchedulerMetadata(
            alias,
            chat.chat_id,
            session.chatSession_id,
            {
              schedulerExecutionStatus: 'failed',
              schedulerCompletedAt: new Date().toISOString(),
              schedulerError:
                session.schedulerError && session.schedulerError.trim().length > 0
                  ? session.schedulerError
                  : INTERRUPTED_SCHEDULED_SESSION_ERROR,
            },
          );

          if (patched) {
            recoveredCount += 1;
            recoveredSessionIds.push(session.chatSession_id);
          }
        }
      } catch (error) {
        logger.warn('scheduler.recover-interrupted.failed', 'recoverInterruptedScheduledSessions', {
          alias,
          schedulerGeneration: this.schedulerGeneration,
          chatId: chat.chat_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('scheduler.recover-interrupted.end', 'recoverInterruptedScheduledSessions', {
      alias,
      schedulerGeneration: this.schedulerGeneration,
      recoveredCount,
      recoveredSessionIds,
      scannedChats: chats.length,
    });
  }

  private async executeColdStartCatchUp(
    job: SchedulerJob,
    occurrenceAt: string,
    alreadyPending: boolean,
  ): Promise<SchedulerExecutionResult> {
    if (!this.currentUserAlias) {
      return {
        success: false,
        error: 'Scheduler is not initialized for the current user.',
      };
    }

    if (!alreadyPending) {
      await schedulerRuntimeStateStore.markPendingColdStartCatchUp(
        this.currentUserAlias,
        job.id,
        occurrenceAt,
        new Date().toISOString(),
      );
    }

    const result = await this.executeJob(job, 'cold-start-catchup');
    if (result.success) {
      await schedulerRuntimeStateStore.clearPendingColdStartCatchUp(this.currentUserAlias, job.id);
    }

    return result;
  }

  /** Replay pending cold-start catch-ups skipped for MCP-not-ready (see ai.prompt.md). */
  private async replayPendingColdStartCatchUps(): Promise<void> {
    const alias = this.currentUserAlias;
    if (!alias) {
      return;
    }
    await runPendingColdStartReplays({
      readState: () => schedulerRuntimeStateStore.readState(alias),
      listJobs: () => scheduleStore.listJobs(alias),
      clearPending: (jobId) => schedulerRuntimeStateStore.clearPendingColdStartCatchUp(alias, jobId),
      replay: (job, occurrenceAt) => this.executeColdStartCatchUp(job, occurrenceAt, true),
    });
  }

  private async markAliasDeactivated(alias: string, deactivatedAtIso: string): Promise<void> {
    await schedulerRuntimeStateStore.markDeactivated(alias, deactivatedAtIso);
    if (this.currentUserAlias === alias) {
      this.currentAliasActivatedAt = null;
    }
  }

  private async registerJob(job: SchedulerJob): Promise<void> {
    logger.info('scheduler.task.register.start', 'registerJob', {
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      jobId: job.id,
      name: job.name,
      scheduleType: job.scheduleType,
      cronExpression: job.cronExpression,
      runAt: job.runAt,
      enabled: job.enabled,
      status: job.status,
      lastRunAt: job.lastRunAt,
    });

    logger.info('scheduler.task.register.dispatch', 'registerJob', {
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      jobId: job.id,
      scheduleType: job.scheduleType,
    });

    if (job.scheduleType === 'once') {
      await this.registerOneTimeTask(job);
      return;
    }

    this.registerCronTask(job);
  }

  /** Register a recurring cron task */
  private registerCronTask(job: SchedulerJob): void {
    if (!job.cronExpression) {
      logger.warn('scheduler.cron.register.missing-cron-expression', 'registerCronTask', {
        jobId: job.id,
        name: job.name,
        schedulerGeneration: this.schedulerGeneration,
      });
      return;
    }

    const previousMeta = this.taskRuntimeMeta.get(job.id);
    logger.info('scheduler.cron.register.before-replace-existing', 'registerCronTask', {
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      jobId: job.id,
      name: job.name,
      cronExpression: job.cronExpression,
      hadExistingTask: this.activeTasks.has(job.id),
      previousRuntimeMeta: previousMeta ? { ...previousMeta } : null,
    });

    this.unregisterTask(job.id, 're-register-before-cron-register');

    const task = cron.schedule(job.cronExpression, async () => {
      const firedAt = new Date().toISOString();
      const activeTask = this.activeTasks.get(job.id);
      const runtimeMeta = this.taskRuntimeMeta.get(job.id);
      if (runtimeMeta) {
        this.taskRuntimeMeta.set(job.id, {
          ...runtimeMeta,
          lastTickArrivedAt: firedAt,
        });
      }

      if (this.executionGuards.isJobExecuting(job.id)) {
        logger.info('scheduler.cron.tick-skipped-overlap', 'registerCronTask', { jobId: job.id, firedAt });
        return;
      }

      logger.info('scheduler.cron.tick-arrived', 'registerCronTask', {
        jobId: job.id,
        name: job.name,
        alias: this.currentUserAlias,
        currentUserAlias: this.currentUserAlias,
        schedulerGeneration: runtimeMeta?.schedulerGeneration ?? this.schedulerGeneration,
        taskSequence: runtimeMeta?.taskSequence,
        firedAt,
        activeTaskExists: !!activeTask,
        activeTaskCount: this.activeTasks.size,
        pid: process.pid,
      });

      logger.info('scheduler.cron.tick-dispatch-executeJob', 'registerCronTask', {
        jobId: job.id,
        alias: this.currentUserAlias,
        schedulerGeneration: runtimeMeta?.schedulerGeneration ?? this.schedulerGeneration,
        taskSequence: runtimeMeta?.taskSequence,
        firedAt,
      });
      await this.executeJob(job, 'scheduled');
    }, { timezone: getSchedulerTimeZone() });

    this.activeTasks.set(job.id, { kind: 'cron', task });
    const runtimeMeta = this.createTaskRuntimeMeta(job, 'cron');
    runtimeMeta.lastCronWatchdogCheckedAt = runtimeMeta.registeredAt;
    this.taskRuntimeMeta.set(job.id, runtimeMeta);

    logger.info('scheduler.cron.registered', 'registerCronTask', {
      jobId: job.id,
      name: job.name,
      alias: this.currentUserAlias,
      cronExpression: job.cronExpression,
      schedulerGeneration: runtimeMeta.schedulerGeneration,
      taskSequence: runtimeMeta.taskSequence,
      registeredAt: runtimeMeta.registeredAt,
      activeTaskCountAfter: this.activeTasks.size,
      activeTaskKeysAfter: Array.from(this.activeTasks.keys()),
    });
  }

  /** Register a one-time scheduled task */
  private async registerOneTimeTask(job: SchedulerJob): Promise<void> {
    if (!job.runAt) {
      logger.warn('scheduler.once.register.missing-runAt', 'registerOneTimeTask', {
        jobId: job.id,
        name: job.name,
        schedulerGeneration: this.schedulerGeneration,
      });
      return;
    }

    const runAtMs = Date.parse(job.runAt);
    if (Number.isNaN(runAtMs)) {
      logger.warn('scheduler.once.register.invalid-runAt', 'registerOneTimeTask', {
        jobId: job.id,
        name: job.name,
        runAt: job.runAt,
        schedulerGeneration: this.schedulerGeneration,
      });
      return;
    }

    const delayMs = runAtMs - Date.now();
    if (delayMs <= 0) {
      await this.markOneTimeJobExpired(job.id);
      return;
    }

    const previousMeta = this.taskRuntimeMeta.get(job.id);
    logger.info('scheduler.once.register.before-replace-existing', 'registerOneTimeTask', {
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      jobId: job.id,
      name: job.name,
      runAt: job.runAt,
      hadExistingTask: this.activeTasks.has(job.id),
      previousRuntimeMeta: previousMeta ? { ...previousMeta } : null,
    });

    this.unregisterTask(job.id, 're-register-before-once-register');

    const retryUntilMs = runAtMs + MAX_RESUME_CATCH_UP_DELAY_MS;
    const getGuardRetryDelayMs = () => Math.max(1, Math.min(60_000, retryUntilMs - Date.now()));
    const scheduleTimeout = (remainingMs: number) => {
      const nextDelayMs = Math.min(remainingMs, MAX_TIMEOUT_MS);
      const timer = setTimeout(async () => {
        if (this.activeTasks.get(job.id)?.kind !== 'timeout') return;

        if (remainingMs > MAX_TIMEOUT_MS) {
          await this.registerOneTimeTask(job);
          return;
        }

        const result = await this.executeJob(job, 'scheduled');
        if (
          result.error === 'skipped-overlap' ||
          result.error === 'skipped-concurrency-limit'
        ) {
          if (Date.now() < retryUntilMs) {
            scheduleTimeout(getGuardRetryDelayMs());
          } else if (this.currentUserAlias) {
            await scheduleStore.markJobExecutionFailed(this.currentUserAlias, job.id, new Date().toISOString());
            this.unregisterTask(job.id, 'once-job-failed');
          }
        }
      }, nextDelayMs);

      this.activeTasks.set(job.id, { kind: 'timeout', timer });
    };

    scheduleTimeout(delayMs);
    const runtimeMeta = this.createTaskRuntimeMeta(job, 'timeout');
    this.taskRuntimeMeta.set(job.id, runtimeMeta);

    logger.info('scheduler.once.registered', 'registerOneTimeTask', {
      jobId: job.id,
      name: job.name,
      runAt: job.runAt,
      delayMs,
      alias: this.currentUserAlias,
      schedulerGeneration: runtimeMeta.schedulerGeneration,
      taskSequence: runtimeMeta.taskSequence,
    });
  }

  /** Unregister a single task */
  private unregisterTask(jobId: string, reason: SchedulerTaskUnregisterReason): void {
    const activeTask = this.activeTasks.get(jobId);
    if (!activeTask) {
      logger.info('scheduler.task.unregister.skip-missing', 'unregisterTask', {
        jobId,
        reason,
        alias: this.currentUserAlias,
        schedulerGeneration: this.schedulerGeneration,
      });
      return;
    }

    const unregisteredAt = new Date().toISOString();
    const previousRuntimeMeta = this.taskRuntimeMeta.get(jobId);
    logger.info('scheduler.task.unregister.start', 'unregisterTask', {
      jobId,
      reason,
      alias: this.currentUserAlias,
      schedulerGeneration: previousRuntimeMeta?.schedulerGeneration ?? this.schedulerGeneration,
      previousRuntimeMeta: previousRuntimeMeta ? { ...previousRuntimeMeta } : null,
    });

    if (activeTask.kind === 'cron') {
      activeTask.task.stop();
    } else {
      clearTimeout(activeTask.timer);
    }

    this.activeTasks.delete(jobId);

    if (previousRuntimeMeta) {
      this.taskRuntimeMeta.set(jobId, {
        ...previousRuntimeMeta,
        unregisteredAt,
        lastUnregisterReason: reason,
      });
    }

    logger.info('scheduler.task.unregister.end', 'unregisterTask', {
      jobId,
      reason,
      alias: this.currentUserAlias,
      schedulerGeneration: previousRuntimeMeta?.schedulerGeneration ?? this.schedulerGeneration,
      activeTaskCountAfter: this.activeTasks.size,
    });
  }

  private clearActiveTasks(reason: SchedulerTaskUnregisterReason): void {
    const jobIds = Array.from(this.activeTasks.keys());
    logger.info('scheduler.tasks.clear.start', 'clearActiveTasks', {
      alias: this.currentUserAlias,
      reason,
      count: jobIds.length,
      jobIds,
      schedulerGeneration: this.schedulerGeneration,
      taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(jobIds),
    });

    for (const [jobId] of this.activeTasks) {
      this.unregisterTask(jobId, reason);
    }

    logger.info('scheduler.tasks.clear.end', 'clearActiveTasks', {
      alias: this.currentUserAlias,
      reason,
      count: this.activeTasks.size,
      schedulerGeneration: this.schedulerGeneration,
    });
  }

  private async markOneTimeJobExpired(jobId: string): Promise<void> {
    if (!this.currentUserAlias) return;

    this.unregisterTask(jobId, 'once-job-expired');
    await scheduleStore.markJobExpired(this.currentUserAlias, jobId);
    logger.info('scheduler.once.expired-before-execution', 'markOneTimeJobExpired', {
      jobId,
    });
  }

  /** Execute a job by delegating runtime creation/execution to AgentChatManager. */
  private async executeJob(
    job: SchedulerJob,
    triggerSource: 'scheduled' | 'manual' | 'resume-catchup' | 'cold-start-catchup' | 'watchdog-catchup',
    preallocatedChatSessionId?: string,
    onReady?: (payload: { chatSessionId: string }) => void,
  ): Promise<SchedulerExecutionResult> {
    const isManual = triggerSource === 'manual';

    if (!isManual && this.executionGuards.isJobExecuting(job.id)) {
      logger.info('scheduler.execute.skipped-overlap', 'executeJob', {
        jobId: job.id,
        name: job.name,
        triggerSource,
        alias: this.currentUserAlias,
      });
      return { success: false, error: 'skipped-overlap' };
    }

    if (!isManual && !this.executionGuards.hasAvailableSlot()) {
      logger.info('scheduler.execute.skipped-concurrency-limit', 'executeJob', {
        jobId: job.id,
        name: job.name,
        triggerSource,
        alias: this.currentUserAlias,
        maxConcurrent: SchedulerManager.MAX_CONCURRENT_EXECUTIONS,
      });
      return { success: false, error: 'skipped-concurrency-limit' };
    }

    const executionToken = this.executionGuards.markStarted(job.id);

    // Capture the alias/generation this execution started under. The MCP-readiness
    // wait below can yield for up to 30s; if a sign-out or alias switch lands during
    // that window, every alias-dependent step after it (markJobExecutionStarted,
    // runScheduledJob, markJobExecutionCompleted) would otherwise run against a
    // different user. We re-check these after the wait and abort if they changed.
    const executionAlias = this.currentUserAlias;
    const executionGeneration = this.schedulerGeneration;

    const executedAt = new Date().toISOString();
    const runtimeMeta = this.taskRuntimeMeta.get(job.id);
    if (runtimeMeta) {
      this.taskRuntimeMeta.set(job.id, {
        ...runtimeMeta,
        lastExecuteStartAt: executedAt,
      });
    }

    logger.info('scheduler.execute.start', 'executeJob', {
      jobId: job.id,
      name: job.name,
      chatId: job.chat_id,
      scheduleType: job.scheduleType,
      triggerSource,
      alias: this.currentUserAlias,
      schedulerGeneration: runtimeMeta?.schedulerGeneration ?? this.schedulerGeneration,
      taskSequence: runtimeMeta?.taskSequence,
    });

    try {
      let preflightError: string | undefined;

      if (!isManual) {
        const readiness = await ensureSchedulerJobMcpReady(job, executionAlias);
        if (!readiness.ready) {
          preflightError = formatSchedulerMcpDisconnectedError(readiness.notConnected);
          logger.warn('scheduler.execute.mcp-not-ready', 'executeJob', {
            jobId: job.id,
            name: job.name,
            triggerSource,
            alias: this.currentUserAlias,
            requiredServers: readiness.requiredServers,
            notConnected: readiness.notConnected,
            preflightError,
          });
        }
      }

      // Abort if the active session was torn down (sign-out) or switched to another
      // alias/generation while we waited for MCP servers to settle. The steps below
      // read the live this.currentUserAlias, so continuing here would run this job
      // under a different user's session. Returning a `skipped-*` result leaves
      // lastRunAt untouched (no markJobExecutionStarted/Failed), so the missed run
      // stays eligible for the original user instead of executing as the new one.
      if (
        this.currentUserAlias !== executionAlias ||
        this.schedulerGeneration !== executionGeneration
      ) {
        logger.warn('scheduler.execute.skipped-alias-changed', 'executeJob', {
          jobId: job.id,
          name: job.name,
          triggerSource,
          executionAlias,
          currentAlias: this.currentUserAlias,
          executionGeneration,
          currentGeneration: this.schedulerGeneration,
        });
        return { success: false, error: SCHEDULER_ALIAS_CHANGED_ERROR };
      }

      if (this.currentUserAlias) {
        logger.info('scheduler.execute.before-mark-started', 'executeJob', {
          jobId: job.id,
          triggerSource,
          alias: this.currentUserAlias,
        });
        await scheduleStore.markJobExecutionStarted(this.currentUserAlias, job.id, executedAt);
        logger.info('scheduler.execute.after-mark-started', 'executeJob', {
          jobId: job.id,
          triggerSource,
          alias: this.currentUserAlias,
        });
      }

      logger.info('scheduler.execute.before-runScheduledJob', 'executeJob', {
        jobId: job.id,
        triggerSource,
        alias: this.currentUserAlias,
      });
      const result = await agentChatManager.runScheduledJob(job, {
        chatSessionId: preallocatedChatSessionId,
        onReady,
        isManualTrigger: isManual,
        preflightError,
      });
      logger.info('scheduler.execute.after-runScheduledJob', 'executeJob', {
        jobId: job.id,
        triggerSource,
        alias: this.currentUserAlias,
        success: result.success,
        chatSessionId: result.chatSessionId,
        messagesCount: result.messagesCount,
        error: result.error,
      });

      if (result.success) {
        if (this.currentUserAlias) {
          logger.info('scheduler.execute.before-mark-completed', 'executeJob', {
            jobId: job.id,
            triggerSource,
            alias: this.currentUserAlias,
          });
          await scheduleStore.markJobExecutionCompleted(this.currentUserAlias, job.id, executedAt);
          logger.info('scheduler.execute.after-mark-completed', 'executeJob', {
            jobId: job.id,
            triggerSource,
            alias: this.currentUserAlias,
          });
        }

        if (job.scheduleType === 'once') {
          this.unregisterTask(job.id, 'once-job-completed');
        }

        const finalMeta = this.taskRuntimeMeta.get(job.id);
        if (finalMeta) {
          this.taskRuntimeMeta.set(job.id, {
            ...finalMeta,
            lastExecuteEndAt: new Date().toISOString(),
            lastExecuteOutcome: 'success',
          });
        }

        logger.info('scheduler.execute.end', 'executeJob', {
          jobId: job.id,
          name: job.name,
          triggerSource,
          chatSessionId: result.chatSessionId,
          messagesCount: result.messagesCount ?? 0,
          success: true,
        });

        // Fire-and-forget: clean up old scheduler sessions to prevent unbounded growth
        // This runs asynchronously and never blocks the main execution path
        if (this.currentUserAlias && job.scheduleType === 'cron') {
          void cleanupSchedulerSessionHistory(this.currentUserAlias, job).catch(err => {
            logger.warn('scheduler.session-cleanup.error', 'executeJob', {
              jobId: job.id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        return result;
      }

      if (this.currentUserAlias) {
        logger.info('scheduler.execute.before-mark-failed', 'executeJob', {
          jobId: job.id,
          triggerSource,
          alias: this.currentUserAlias,
        });
        await scheduleStore.markJobExecutionFailed(this.currentUserAlias, job.id, executedAt);
        logger.info('scheduler.execute.after-mark-failed', 'executeJob', {
          jobId: job.id,
          triggerSource,
          alias: this.currentUserAlias,
        });
      }

      if (job.scheduleType === 'once') {
        this.unregisterTask(job.id, 'once-job-failed');
      }

      const failedMeta = this.taskRuntimeMeta.get(job.id);
      if (failedMeta) {
        this.taskRuntimeMeta.set(job.id, {
          ...failedMeta,
          lastExecuteEndAt: new Date().toISOString(),
          lastExecuteOutcome: 'failed',
        });
      }

      logger.error('scheduler.execute.end', 'executeJob', {
        jobId: job.id,
        name: job.name,
        triggerSource,
        chatSessionId: result.chatSessionId,
        error: result.error || 'Unknown error',
        success: false,
      });

      // Fire-and-forget: clean up old scheduler sessions (including failed ones)
      if (this.currentUserAlias && job.scheduleType === 'cron') {
        void cleanupSchedulerSessionHistory(this.currentUserAlias, job).catch(err => {
          logger.warn('scheduler.session-cleanup.error', 'executeJob', {
            jobId: job.id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      return result;
    } catch (error) {
      if (this.currentUserAlias) {
        logger.info('scheduler.execute.before-mark-failed', 'executeJob', {
          jobId: job.id,
          triggerSource,
          alias: this.currentUserAlias,
        });
        await scheduleStore.markJobExecutionFailed(this.currentUserAlias, job.id, executedAt);
        logger.info('scheduler.execute.after-mark-failed', 'executeJob', {
          jobId: job.id,
          triggerSource,
          alias: this.currentUserAlias,
        });
      }

      if (job.scheduleType === 'once') {
        this.unregisterTask(job.id, 'once-job-failed');
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedMeta = this.taskRuntimeMeta.get(job.id);
      if (failedMeta) {
        this.taskRuntimeMeta.set(job.id, {
          ...failedMeta,
          lastExecuteEndAt: new Date().toISOString(),
          lastExecuteOutcome: 'failed',
        });
      }

      logger.error('scheduler.execute.end', 'executeJob', {
        jobId: job.id,
        name: job.name,
        triggerSource,
        error: errorMessage,
        success: false,
      });

      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      this.executionGuards.markFinished(executionToken);
    }
  }

  /** Dispose all runtime tasks (called on app exit) */
  async dispose(reason: SchedulerDisposeReason = 'unknown'): Promise<void> {
    logger.info('scheduler.dispose.start', 'dispose', {
      reason,
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      activeTaskCountBefore: this.activeTasks.size,
      activeJobIdsBefore: Array.from(this.activeTasks.keys()),
      taskRuntimeMetaSnapshot: this.getTaskRuntimeMetaSnapshot(Array.from(this.activeTasks.keys())),
    });

    if (this.currentUserAlias) {
      await this.markAliasDeactivated(this.currentUserAlias, new Date().toISOString());
    }

    this.stopHeartbeat();
    this.clearActiveTasks(reason === 'unknown' ? 'dispose' : reason);
    this.executionGuards.reset();
    this.currentUserAlias = null;
    this.currentAliasActivatedAt = null;
    logger.info('scheduler.dispose.end', 'dispose', {
      reason,
      schedulerGeneration: this.schedulerGeneration,
      activeTaskCountAfter: this.activeTasks.size,
    });
  }

  private createTaskRuntimeMeta(job: SchedulerJob, taskKind: ActiveTask['kind']): SchedulerTaskRuntimeMeta {
    this.taskSequence += 1;
    return {
      jobId: job.id,
      alias: this.currentUserAlias,
      schedulerGeneration: this.schedulerGeneration,
      taskSequence: this.taskSequence,
      taskKind,
      registeredAt: new Date().toISOString(),
      cronExpression: job.cronExpression,
      runAt: job.runAt,
    };
  }

  private getTaskRuntimeMetaSnapshot(jobIds: string[]): SchedulerTaskRuntimeMeta[] {
    return jobIds
      .map((jobId) => this.taskRuntimeMeta.get(jobId))
      .filter((meta): meta is SchedulerTaskRuntimeMeta => !!meta)
      .map((meta) => ({ ...meta }));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      void this.replayPendingColdStartCatchUps().catch((error) => {
        logger.warn('scheduler.cold-start-catchup.replay-failed', 'heartbeat', {
          error: error instanceof Error ? error.message : String(error),
        });
      });

      if (this.activeTasks.size === 0) {
        return;
      }

      const memUsage = process.memoryUsage();
      logger.info('scheduler.heartbeat', 'heartbeat', {
        alias: this.currentUserAlias,
        schedulerGeneration: this.schedulerGeneration,
        activeTaskCount: this.activeTasks.size,
        activeTaskJobIds: Array.from(this.activeTasks.keys()),
        rssBytes: memUsage.rss,
        heapUsedBytes: memUsage.heapUsed,
      });

      const RSS_WARN_THRESHOLD = 2 * 1024 * 1024 * 1024;
      if (memUsage.rss > RSS_WARN_THRESHOLD) {
        logger.warn('scheduler.heartbeat.memory-pressure', 'heartbeat', {
          rssMB: Math.round(memUsage.rss / 1024 / 1024),
          heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          activeTaskCount: this.activeTasks.size,
        });
      }

      const cronJobIds = Array.from(this.activeTasks.entries())
        .filter(([, task]) => task.kind === 'cron')
        .map(([jobId]) => jobId);
      void runCronWatchdog({
        alias: this.currentUserAlias,
        heartbeatIntervalMs: SchedulerManager.HEARTBEAT_INTERVAL_MS,
        cronJobIds,
        getRuntimeMeta: (jobId) => this.taskRuntimeMeta.get(jobId),
        setRuntimeMeta: (jobId, meta) => {
          const current = this.taskRuntimeMeta.get(jobId);
          if (current) {
            this.taskRuntimeMeta.set(jobId, {
              ...current,
              ...meta,
            });
          }
        },
        executeJob: (job) => this.executeJob(job, 'watchdog-catchup'),
      });
    }, SchedulerManager.HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export const schedulerManager = SchedulerManager.getInstance();
