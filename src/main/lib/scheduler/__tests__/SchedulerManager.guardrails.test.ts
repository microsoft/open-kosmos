vi.mock('node-cron', async () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    waitForServersSettled: vi.fn(async () => undefined),
    getMcpServerRuntimeState: vi.fn(() => undefined),
    getInUseServerNames: vi.fn(() => []),
  },
}));

vi.mock('../../mcpRuntime/builtinMcpClient', () => ({
  BUILTIN_SERVER_NAME: 'builtin-tools',
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: {
    runScheduledJob: vi.fn(async () => ({ success: true, chatSessionId: 'sess-1', messagesCount: 1 })),
  },
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn(),
    patchSchedulerMetadata: vi.fn(),
  },
}));

vi.mock('../scheduleStore', async () => ({
  scheduleStore: {
    initialize: vi.fn(async () => undefined),
    getJob: vi.fn(async () => null),
    listJobs: vi.fn(async () => []),
    createJob: vi.fn(async () => null),
    markJobExecutionStarted: vi.fn(async () => undefined),
    markJobExecutionCompleted: vi.fn(async () => undefined),
    markJobExecutionFailed: vi.fn(async () => undefined),
    markJobExpired: vi.fn(async () => undefined),
    toggleJob: vi.fn(async () => null),
    updateJob: vi.fn(async () => null),
    deleteJob: vi.fn(async () => true),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getAllChatConfigs: vi.fn(() => []),
  },
}));

vi.mock('../schedulerRuntimeStateStore', async () => ({
  schedulerRuntimeStateStore: {
    readState: vi.fn(async () => ({
      schemaVersion: 1,
      alias: 'alice',
      isActive: false,
    })),
    markActivated: vi.fn(async () => undefined),
    markDeactivated: vi.fn(async () => undefined),
    markPendingColdStartCatchUp: vi.fn(async () => undefined),
    clearPendingColdStartCatchUp: vi.fn(async () => undefined),
  },
}));

vi.mock('../../userDataADO/pathUtils', async () => ({
  generateChatSessionId: vi.fn(() => 'preallocated-session-id'),
}));

import type { SchedulerJob } from '../types';

function makeJob(overrides?: Partial<SchedulerJob>): SchedulerJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: '',
    scheduleType: 'cron',
    cronExpression: '*/5 * * * *',
    enabled: true,
    chat_id: 'agent-1',
    message: 'hello',
    status: 'pending',
    ...overrides,
  };
}

async function setupMocks() {
  const { scheduleStore } = await import('../scheduleStore');
  const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
  const { agentChatManager } = await import('../../chat/agentChatManager');

  vi.mocked(scheduleStore.initialize).mockResolvedValue(undefined);
  vi.mocked(scheduleStore.getJob).mockResolvedValue(null);
  vi.mocked(scheduleStore.listJobs).mockResolvedValue([]);
  vi.mocked(scheduleStore.markJobExecutionStarted).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExecutionCompleted).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExecutionFailed).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExpired).mockResolvedValue(undefined as any);

  vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({ schemaVersion: 1, alias: 'alice', isActive: false });
  vi.mocked(schedulerRuntimeStateStore.markActivated).mockResolvedValue(undefined as any);
  vi.mocked(schedulerRuntimeStateStore.markDeactivated).mockResolvedValue(undefined as any);

  vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });

  return { scheduleStore, agentChatManager };
}

describe('SchedulerManager execution guardrails', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    await setupMocks();
  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // ignore
    }
    vi.useRealTimers();
  });

  describe('overlap guard', () => {
    it('skips scheduled execution when the same job is already running', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      let resolveFirst!: (value: any) => void;
      vi.mocked(agentChatManager.runScheduledJob)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce({ success: true, chatSessionId: 'sess-2', messagesCount: 1 });

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const job = makeJob();

      const firstExecution = (schedulerManager as any).executeJob(job, 'scheduled');
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).toContain(job.id);
      });

      const secondResult = await (schedulerManager as any).executeJob(job, 'scheduled');
      expect(secondResult).toEqual({ success: false, error: 'skipped-overlap' });

      resolveFirst({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
      const firstResult = await firstExecution;
      expect(firstResult.success).toBe(true);

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
    });

    it('allows execution after previous one completes', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const job = makeJob();

      const firstResult = await (schedulerManager as any).executeJob(job, 'scheduled');
      expect(firstResult.success).toBe(true);

      const secondResult = await (schedulerManager as any).executeJob(job, 'scheduled');
      expect(secondResult.success).toBe(true);

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(2);
    });

    it('allows manual trigger even when job is already running', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      let resolveFirst!: (value: any) => void;
      vi.mocked(agentChatManager.runScheduledJob)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce({ success: true, chatSessionId: 'sess-2', messagesCount: 1 });

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const job = makeJob();

      const firstExecution = (schedulerManager as any).executeJob(job, 'scheduled');
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).toContain(job.id);
      });

      const manualResult = await (schedulerManager as any).executeJob(job, 'manual');
      expect(manualResult.success).toBe(true);

      resolveFirst({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
      await firstExecution;

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(2);
    });

    it('keeps scheduled overlap blocked when a manual trigger finishes first', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      let resolveScheduled!: (value: any) => void;
      vi.mocked(agentChatManager.runScheduledJob)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveScheduled = resolve; }))
        .mockResolvedValueOnce({ success: true, chatSessionId: 'sess-manual', messagesCount: 1 })
        .mockResolvedValueOnce({ success: true, chatSessionId: 'sess-after', messagesCount: 1 });

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const job = makeJob();
      const scheduledExecution = (schedulerManager as any).executeJob(job, 'scheduled');
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).toContain(job.id);
      });

      const manualResult = await (schedulerManager as any).executeJob(job, 'manual');
      expect(manualResult.success).toBe(true);

      const overlappedScheduledResult = await (schedulerManager as any).executeJob(job, 'scheduled');
      expect(overlappedScheduledResult).toEqual({ success: false, error: 'skipped-overlap' });

      resolveScheduled({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
      await scheduledExecution;

      const afterCompletionResult = await (schedulerManager as any).executeJob(job, 'scheduled');
      expect(afterCompletionResult.success).toBe(true);

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(3);
    });

    it('clears executing state on dispose', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      let resolveFirst!: (value: any) => void;
      vi.mocked(agentChatManager.runScheduledJob)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const job = makeJob();
      const execution = (schedulerManager as any).executeJob(job, 'scheduled');
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).toContain(job.id);
      });

      await schedulerManager.dispose('manual-debug');
      expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).toEqual([]);

      resolveFirst({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
      await execution;
    });

    it('keeps execution slots capped when an execution finishes after dispose', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      let resolveFirst!: (value: any) => void;
      vi.mocked(agentChatManager.runScheduledJob)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const execution = (schedulerManager as any).executeJob(makeJob(), 'scheduled');
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executionSlotsAvailable).toBe(2);
      });

      await schedulerManager.dispose('manual-debug');
      expect(schedulerManager.getRuntimeDiagnostics().executionSlotsAvailable).toBe(3);

      resolveFirst({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
      await execution;

      expect(schedulerManager.getRuntimeDiagnostics().executionSlotsAvailable).toBe(3);
    });

    it('clears executing flag even when execution fails', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');
      vi.mocked(agentChatManager.runScheduledJob).mockRejectedValueOnce(new Error('LLM error'));

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const job = makeJob();
      const result = await (schedulerManager as any).executeJob(job, 'scheduled');
      expect(result.success).toBe(false);
      expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).not.toContain(job.id);
    });

    it('retries one-time jobs when the concurrency guard skips the first fire', async () => {
      vi.useFakeTimers().setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');

      const resolvers: Array<(value: any) => void> = [];
      vi.mocked(agentChatManager.runScheduledJob).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );

      const onceJob = makeJob({
        id: 'once-job',
        scheduleType: 'once',
        cronExpression: undefined,
        runAt: '2026-05-11T12:00:01.000Z',
      });
      vi.mocked(scheduleStore.listJobs).mockResolvedValue([onceJob]);

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const runningExecutions = [0, 1, 2].map((i) =>
        (schedulerManager as any).executeJob(makeJob({ id: `running-${i}` }), 'scheduled'),
      );
      await vi.waitFor(() => {
        expect(resolvers.length).toBe(3);
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(resolvers.length).toBe(3);
      expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).toContain('once-job');

      resolvers[0]({ success: true, chatSessionId: 'sess-free-slot', messagesCount: 1 });
      await runningExecutions[0];

      await vi.advanceTimersByTimeAsync(60_000);
      await vi.waitFor(() => {
        expect(resolvers.length).toBe(4);
      });

      resolvers[1]({ success: true, chatSessionId: 'sess-running-1', messagesCount: 1 });
      resolvers[2]({ success: true, chatSessionId: 'sess-running-2', messagesCount: 1 });
      resolvers[3]({ success: true, chatSessionId: 'sess-once', messagesCount: 1 });
      await Promise.all(runningExecutions.slice(1));

      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).not.toContain('once-job');
      });
    });

    it('fails one-time jobs when guard retries exceed the catch-up window', async () => {
      vi.useFakeTimers().setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');

      vi.mocked(agentChatManager.runScheduledJob).mockImplementation(
        () => new Promise(() => undefined),
      );

      const onceJob = makeJob({
        id: 'once-job',
        scheduleType: 'once',
        cronExpression: undefined,
        runAt: '2026-05-11T12:00:01.000Z',
      });
      vi.mocked(scheduleStore.listJobs).mockResolvedValue([onceJob]);

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      for (let i = 0; i < 3; i++) {
        (schedulerManager as any).executeJob(makeJob({ id: `running-${i}` }), 'scheduled');
      }
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executionSlotsAvailable).toBe(0);
      });

      await vi.advanceTimersByTimeAsync((6 * 60 * 60 * 1_000) + 1_000);

      expect(scheduleStore.markJobExecutionFailed).toHaveBeenCalledWith(
        'alice',
        'once-job',
        expect.any(String),
      );
      expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).not.toContain('once-job');
    });

    it('runs a one-time job on its first timer fire without scheduling a guard retry', async () => {
      vi.useFakeTimers().setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');

      const onceJob = makeJob({
        id: 'once-job',
        scheduleType: 'once',
        cronExpression: undefined,
        runAt: '2026-05-11T12:00:01.000Z',
      });
      vi.mocked(scheduleStore.listJobs).mockResolvedValue([onceJob]);
      vi.mocked(agentChatManager.runScheduledJob).mockResolvedValueOnce({
        success: true,
        chatSessionId: 'sess-once',
        messagesCount: 1,
      });

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      await vi.advanceTimersByTimeAsync(1_000);

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
      expect(scheduleStore.markJobExecutionCompleted).toHaveBeenCalledWith(
        'alice',
        'once-job',
        expect.any(String),
      );
      expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).not.toContain('once-job');
    });

    it('ignores a stale one-time timer callback when the active task was removed', async () => {
      vi.useFakeTimers().setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');

      vi.mocked(scheduleStore.listJobs).mockResolvedValue([
        makeJob({
          id: 'once-job',
          scheduleType: 'once',
          cronExpression: undefined,
          runAt: '2026-05-11T12:00:01.000Z',
        }),
      ]);

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');
      (schedulerManager as any).activeTasks.delete('once-job');

      await vi.advanceTimersByTimeAsync(1_000);

      expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
      expect(scheduleStore.markJobExecutionStarted).not.toHaveBeenCalledWith(
        'alice',
        'once-job',
        expect.any(String),
      );
    });

    it('does not expire a one-time job when no user alias is active', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { schedulerManager } = await import('../SchedulerManager');

      await (schedulerManager as any).markOneTimeJobExpired('once-job');

      expect(scheduleStore.markJobExpired).not.toHaveBeenCalled();
    });

    it('handles execution results without an active user alias', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');
      const { schedulerManager } = await import('../SchedulerManager');

      vi.mocked(agentChatManager.runScheduledJob).mockResolvedValueOnce({ success: true, chatSessionId: 'sess-1' });
      const successResult = await (schedulerManager as any).executeJob(makeJob({ id: 'success-no-alias' }), 'scheduled');
      expect(successResult.success).toBe(true);

      vi.mocked(agentChatManager.runScheduledJob).mockResolvedValueOnce({ success: false });
      const failedResult = await (schedulerManager as any).executeJob(makeJob({ id: 'failed-no-alias' }), 'scheduled');
      expect(failedResult.success).toBe(false);

      vi.mocked(agentChatManager.runScheduledJob).mockRejectedValueOnce('string failure');
      const thrownResult = await (schedulerManager as any).executeJob(makeJob({ id: 'thrown-no-alias' }), 'scheduled');
      expect(thrownResult).toEqual({ success: false, error: 'string failure' });

      expect(scheduleStore.markJobExecutionStarted).not.toHaveBeenCalled();
      expect(scheduleStore.markJobExecutionCompleted).not.toHaveBeenCalled();
      expect(scheduleStore.markJobExecutionFailed).not.toHaveBeenCalled();
      expect(schedulerManager.getRuntimeDiagnostics().executionSlotsAvailable).toBe(3);
    });
  });

  describe('concurrency cap', () => {
    it('limits concurrent executions to MAX_CONCURRENT_EXECUTIONS', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      const resolvers: Array<(value: any) => void> = [];
      vi.mocked(agentChatManager.runScheduledJob).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const executions = [];
      for (let i = 0; i < 4; i++) {
        executions.push(
          (schedulerManager as any).executeJob(makeJob({ id: `job-${i}` }), 'scheduled'),
        );
      }

      // Allow promises to settle
      await vi.waitFor(() => {
        expect(resolvers.length).toBe(3);
      });

      // 4th should have been rejected immediately
      const fourthResult = await executions[3];
      expect(fourthResult).toEqual({ success: false, error: 'skipped-concurrency-limit' });

      // Complete the first 3
      for (const resolve of resolvers) {
        resolve({ success: true, chatSessionId: 'sess-ok', messagesCount: 1 });
      }
      const results = await Promise.all(executions.slice(0, 3));
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('releases slot after execution completes', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      for (let i = 0; i < 5; i++) {
        const result = await (schedulerManager as any).executeJob(makeJob({ id: `job-${i}` }), 'scheduled');
        expect(result.success).toBe(true);
      }

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(5);
    });

    it('manual trigger bypasses concurrency cap', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      const resolvers: Array<(value: any) => void> = [];
      vi.mocked(agentChatManager.runScheduledJob).mockImplementation(
        () => new Promise((resolve) => { resolvers.push(resolve); }),
      );

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      // Fill all 3 slots
      for (let i = 0; i < 3; i++) {
        (schedulerManager as any).executeJob(makeJob({ id: `job-${i}` }), 'scheduled');
      }
      await vi.waitFor(() => {
        expect(resolvers.length).toBe(3);
      });

      // Manual trigger should still work
      const manualExecution = (schedulerManager as any).executeJob(makeJob({ id: 'job-manual' }), 'manual');
      await vi.waitFor(() => {
        expect(resolvers.length).toBe(4);
      });

      // Clean up
      for (const resolve of resolvers) {
        resolve({ success: true, chatSessionId: 'sess-ok', messagesCount: 1 });
      }
      const manualResult = await manualExecution;
      expect(manualResult.success).toBe(true);
    });

    it('releases slot even when execution fails', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');
      vi.mocked(agentChatManager.runScheduledJob).mockRejectedValue(new Error('LLM error'));

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');
      expect(result.success).toBe(false);

      const diag = schedulerManager.getRuntimeDiagnostics();
      expect(diag.executionSlotsAvailable).toBe(3);
    });

    it('exposes guardrail state in diagnostics', async () => {
      const { agentChatManager } = await import('../../chat/agentChatManager');

      let resolveExec!: (value: any) => void;
      vi.mocked(agentChatManager.runScheduledJob).mockImplementation(
        () => new Promise((resolve) => { resolveExec = resolve; }),
      );

      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.initialize('alice');

      const execution = (schedulerManager as any).executeJob(makeJob(), 'scheduled');
      await vi.waitFor(() => {
        expect(schedulerManager.getRuntimeDiagnostics().executingJobIds).toHaveLength(1);
      });

      const diag = schedulerManager.getRuntimeDiagnostics();
      expect(diag.executingJobIds).toEqual(['job-1']);
      expect(diag.executionSlotsAvailable).toBe(2);
      expect(diag.maxConcurrentExecutions).toBe(3);

      await vi.waitFor(() => {
        expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
      });
      resolveExec({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
      await execution;
    });
  });

  describe('coverage guard branches', () => {
    it('returns the existing singleton instance', async () => {
      const { SchedulerManager, schedulerManager } = await import('../SchedulerManager');

      expect(SchedulerManager.getInstance()).toBe(schedulerManager);
    });

    it('handles public mutation branches and non-Error failures', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { schedulerManager } = await import('../SchedulerManager');

      await expect(schedulerManager.listJobs()).resolves.toEqual([]);
      await expect(schedulerManager.getJob('job-1')).resolves.toBeNull();
      await expect(schedulerManager.deleteJob('job-1')).rejects.toThrow('Scheduler is not initialized');

      await schedulerManager.initialize('alice');

      vi.mocked(scheduleStore.createJob).mockResolvedValueOnce(makeJob({ id: 'enabled-created' }));
      await expect(schedulerManager.createJob(makeJob({ id: 'enabled-created' }))).resolves.toBe(true);

      vi.mocked(scheduleStore.createJob).mockResolvedValueOnce(makeJob({ id: 'disabled-created', enabled: false }));
      await expect(schedulerManager.createJob(makeJob({ id: 'disabled-created', enabled: false }))).resolves.toBe(true);

      vi.mocked(scheduleStore.createJob).mockRejectedValueOnce('create-string-failure');
      await expect(schedulerManager.createJob(makeJob({ id: 'create-fails' }))).rejects.toThrow('create-string-failure');

      vi.mocked(scheduleStore.deleteJob).mockResolvedValueOnce(false);
      await expect(schedulerManager.deleteJob('missing-delete')).rejects.toThrow('Schedule job not found');

      vi.mocked(scheduleStore.updateJob).mockResolvedValueOnce(makeJob({ id: 'updated-enabled' }));
      await expect(schedulerManager.updateJob('updated-enabled', { name: 'Updated' })).resolves.toBe(true);

      vi.mocked(scheduleStore.updateJob).mockResolvedValueOnce(makeJob({ id: 'updated-disabled', enabled: false }));
      await expect(schedulerManager.updateJob('updated-disabled', { enabled: false })).resolves.toBe(true);

      vi.mocked(scheduleStore.updateJob).mockResolvedValueOnce(null);
      await expect(schedulerManager.updateJob('missing-update', { name: 'Missing' })).rejects.toThrow('Schedule job not found');

      vi.mocked(scheduleStore.updateJob).mockRejectedValueOnce('update-string-failure');
      await expect(schedulerManager.updateJob('update-fails', { name: 'Fails' })).rejects.toThrow('update-string-failure');

      vi.mocked(scheduleStore.toggleJob).mockResolvedValueOnce(null);
      await expect(schedulerManager.toggleJob('missing-toggle', true)).rejects.toThrow('Schedule job not found');

      vi.mocked(scheduleStore.toggleJob).mockResolvedValueOnce(makeJob({ id: 'toggle-enabled' }));
      await expect(schedulerManager.toggleJob('toggle-enabled', true)).resolves.toBe(true);

      vi.mocked(scheduleStore.toggleJob).mockRejectedValueOnce('toggle-string-failure');
      await expect(schedulerManager.toggleJob('toggle-fails', true)).rejects.toThrow('toggle-string-failure');
    });

    it('covers toggle-by-agent skip and failed job branches', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { schedulerManager } = await import('../SchedulerManager');

      await expect(schedulerManager.toggleJobsByAgent('agent-1', false)).resolves.toBe(0);

      await schedulerManager.initialize('alice');
      vi.mocked(scheduleStore.listJobs).mockResolvedValueOnce([
        makeJob({ id: 'already-disabled', enabled: false }),
        makeJob({ id: 'toggle-string-error', enabled: true }),
        makeJob({ id: 'toggle-error', enabled: true }),
        makeJob({ id: 'toggle-ok', enabled: true }),
      ]);
      vi.mocked(scheduleStore.toggleJob)
        .mockRejectedValueOnce('toggle-agent-string-failure')
        .mockRejectedValueOnce(new Error('toggle-agent-error-failure'))
        .mockResolvedValueOnce(makeJob({ id: 'toggle-ok', enabled: false }));

      await expect(schedulerManager.toggleJobsByAgent('agent-1', false)).resolves.toBe(1);
    });

    it('covers initialize registration failures with non-Error values', async () => {
      const cron = await import('node-cron');
      const { scheduleStore } = await import('../scheduleStore');
      const { schedulerManager } = await import('../SchedulerManager');

      vi.mocked(scheduleStore.listJobs).mockResolvedValueOnce([makeJob({ id: 'bad-cron' })]);
      vi.mocked(cron.schedule).mockImplementationOnce(() => {
        throw 'cron-string-failure';
      });

      await expect(schedulerManager.initialize('alice')).resolves.toBeUndefined();
    });

    it('skips cron registration when the cron expression is missing', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { schedulerManager } = await import('../SchedulerManager');

      vi.mocked(scheduleStore.listJobs).mockResolvedValueOnce([
        makeJob({ id: 'missing-cron', cronExpression: undefined }),
      ]);

      await schedulerManager.initialize('alice');

      expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).not.toContain('missing-cron');
    });

    it('returns run-now validation failures without executing', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');
      const { schedulerManager } = await import('../SchedulerManager');

      await expect(schedulerManager.runJobNow('job-1')).resolves.toEqual({
        success: false,
        error: 'Scheduler is not initialized for the current user.',
      });

      await schedulerManager.initialize('alice');
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(null);
      await expect(schedulerManager.runJobNow('missing-job')).resolves.toEqual({
        success: false,
        error: 'Schedule job not found: missing-job',
      });

      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(makeJob({ enabled: false }));
      await expect(schedulerManager.runJobNow('disabled-job')).resolves.toEqual({
        success: false,
        error: 'Only enabled schedules can be run manually.',
      });

      expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
    });

    it('covers run-now ready and failed dispatch resolution paths', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');
      const { schedulerManager } = await import('../SchedulerManager');

      await schedulerManager.initialize('alice');

      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(makeJob({ id: 'ready-job' }));
      vi.mocked(agentChatManager.runScheduledJob).mockImplementationOnce(async (_job, options?: any) => {
        options?.onReady?.({ chatSessionId: 'ready-session' });
        options?.onReady?.({ chatSessionId: 'ignored-session' });
        return { success: true, chatSessionId: 'final-session', messagesCount: 1 };
      });

      await expect(schedulerManager.runJobNow('ready-job')).resolves.toEqual({
        success: true,
        chatSessionId: 'ready-session',
      });

      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(makeJob({ id: 'failed-job' }));
      vi.mocked(agentChatManager.runScheduledJob).mockResolvedValueOnce({ success: false });

      await expect(schedulerManager.runJobNow('failed-job')).resolves.toEqual({ success: false });
    });

    it('allows Retry to rerun a spent one-time schedule but blocks plain Run now and never-run disabled ones', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { agentChatManager } = await import('../../chat/agentChatManager');
      const { schedulerManager } = await import('../SchedulerManager');

      await schedulerManager.initialize('alice');

      // A failed one-time schedule is auto-disabled, but the explicit Retry intent
      // ({ isManualRetry: true }) re-runs it from scratch.
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({ id: 'failed-once', enabled: false, scheduleType: 'once', status: 'failed' }),
      );
      vi.mocked(agentChatManager.runScheduledJob).mockImplementationOnce(async (_job, options?: any) => {
        options?.onReady?.({ chatSessionId: 'retry-failed' });
        return { success: true, chatSessionId: 'retry-failed', messagesCount: 1 };
      });
      await expect(schedulerManager.runJobNow('failed-once', { isManualRetry: true })).resolves.toEqual({
        success: true,
        chatSessionId: 'retry-failed',
      });

      // A cancelled/interrupted one-time run is recorded as a disabled 'completed'
      // job (indistinguishable from a clean completion), so Retry must re-run it too.
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({ id: 'done-once', enabled: false, scheduleType: 'once', status: 'completed' }),
      );
      vi.mocked(agentChatManager.runScheduledJob).mockImplementationOnce(async (_job, options?: any) => {
        options?.onReady?.({ chatSessionId: 'retry-done' });
        return { success: true, chatSessionId: 'retry-done', messagesCount: 1 };
      });
      await expect(schedulerManager.runJobNow('done-once', { isManualRetry: true })).resolves.toEqual({
        success: true,
        chatSessionId: 'retry-done',
      });

      // A retry that was itself interrupted mid-run is left as a disabled 'pending'
      // job with `lastRunAt` set (markJobExecutionStarted resets status to 'pending';
      // crash recovery only patches the chat session, not the job). Retry must still
      // re-run it via the `lastRunAt` spent-detection fallback, otherwise the user is
      // stranded with a Retry button that always rejects.
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({
          id: 'interrupted-retry-once',
          enabled: false,
          scheduleType: 'once',
          status: 'pending',
          lastRunAt: '2026-06-19T10:00:00.000Z',
        }),
      );
      vi.mocked(agentChatManager.runScheduledJob).mockImplementationOnce(async (_job, options?: any) => {
        options?.onReady?.({ chatSessionId: 'retry-interrupted' });
        return { success: true, chatSessionId: 'retry-interrupted', messagesCount: 1 };
      });
      await expect(
        schedulerManager.runJobNow('interrupted-retry-once', { isManualRetry: true }),
      ).resolves.toEqual({
        success: true,
        chatSessionId: 'retry-interrupted',
      });

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(3);

      // Without the Retry intent, plain "Run now" callers (schedule cards, agent
      // editor, run-schedule tool) must NOT rerun a spent one-time schedule.
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({ id: 'failed-once-run-now', enabled: false, scheduleType: 'once', status: 'failed' }),
      );
      await expect(schedulerManager.runJobNow('failed-once-run-now')).resolves.toEqual({
        success: false,
        error: 'Only enabled schedules can be run manually.',
      });

      // isManualRetry: false is treated the same as omitting it.
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({ id: 'done-once-run-now', enabled: false, scheduleType: 'once', status: 'completed' }),
      );
      await expect(schedulerManager.runJobNow('done-once-run-now', { isManualRetry: false })).resolves.toEqual({
        success: false,
        error: 'Only enabled schedules can be run manually.',
      });

      // A one-time schedule that has never run (status 'pending', no lastRunAt) and
      // is disabled stays blocked even under Retry: it was explicitly turned off, not
      // spent.
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({ id: 'pending-once', enabled: false, scheduleType: 'once', status: 'pending' }),
      );
      await expect(schedulerManager.runJobNow('pending-once', { isManualRetry: true })).resolves.toEqual({
        success: false,
        error: 'Only enabled schedules can be run manually.',
      });

      // Retry never re-arms a disabled cron schedule (cron is never auto-disabled).
      vi.mocked(scheduleStore.getJob).mockResolvedValueOnce(
        makeJob({ id: 'disabled-cron-retry', enabled: false, scheduleType: 'cron', status: 'completed' }),
      );
      await expect(schedulerManager.runJobNow('disabled-cron-retry', { isManualRetry: true })).resolves.toEqual({
        success: false,
        error: 'Only enabled schedules can be run manually.',
      });

      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(3);
    });

    it('covers system-resume early returns and failure handling', async () => {
      const { scheduleStore } = await import('../scheduleStore');
      const { schedulerManager } = await import('../SchedulerManager');

      await expect(schedulerManager.handleSystemResume(100, 200)).resolves.toBeUndefined();

      await schedulerManager.initialize('alice');
      await expect(schedulerManager.handleSystemResume(Number.NaN, 200)).resolves.toBeUndefined();
      await expect(schedulerManager.handleSystemResume(200, 100)).resolves.toBeUndefined();

      vi.mocked(scheduleStore.listJobs).mockResolvedValueOnce([
        makeJob({ id: 'disabled-cron', enabled: false }),
        makeJob({ id: 'once-job', scheduleType: 'once', runAt: '2026-05-11T12:00:00.000Z' }),
        makeJob({ id: 'cron-without-expression', cronExpression: undefined }),
      ]);
      await expect(schedulerManager.handleSystemResume(100, 200)).resolves.toBeUndefined();

      vi.mocked(scheduleStore.listJobs).mockRejectedValueOnce('resume-list-string-failure');
      await expect(schedulerManager.handleSystemResume(100, 200)).resolves.toBeUndefined();
    });
  });
});
