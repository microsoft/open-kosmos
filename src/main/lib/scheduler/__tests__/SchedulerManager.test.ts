import type { CronWatchdogTaskRuntimeMeta } from '../cronWatchdog';

vi.mock('node-cron', async () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

vi.mock('../../unifiedLogger', async () => ({
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

describe('SchedulerManager cold-start catch-up', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

    // Re-apply default implementations after resetAllMocks clears them
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
    vi.mocked(schedulerRuntimeStateStore.markPendingColdStartCatchUp).mockResolvedValue(undefined as any);
    vi.mocked(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).mockResolvedValue(undefined as any);

    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // Ignore cleanup failures in tests that never loaded the module.
    }

    vi.useRealTimers();
  });

  it('replays a missed recurring cron on cold start when the app was offline overnight', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:20:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: false,
      lastActivatedAt: '2026-04-06T20:00:00.000Z',
      lastDeactivatedAt: '2026-04-07T00:10:00.000Z',
    });

    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      {
        id: 'sched_20260401000000_abcd1234',
        name: 'Morning briefing',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        enabled: true,
        agentId: 'agent-1',
        message: 'hello',
        status: 'pending',
      },
    ]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
    expect(schedulerRuntimeStateStore.markPendingColdStartCatchUp).toHaveBeenCalledTimes(1);
    expect(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).toHaveBeenCalledTimes(1);
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalledTimes(1);
    expect(scheduleStore.markJobExecutionCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not replay a missed recurring cron when lastRunAt already covers that occurrence', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:20:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2026-04-07T00:10:00.000Z',
    });

    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      {
        id: 'sched_20260401000000_abcd1234',
        name: 'Morning briefing',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        enabled: true,
        agentId: 'agent-1',
        message: 'hello',
        status: 'pending',
        lastRunAt: '2026-04-07T03:00:05.000Z',
      },
    ]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
    expect(scheduleStore.markJobExecutionStarted).not.toHaveBeenCalled();
  });

  it('replays a pending cold-start catch-up after the previous startup crashed mid-recovery', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:25:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2026-04-07T03:20:00.000Z',
      pendingColdStartCatchUps: {
        sched_20260401000000_abcd1234: {
          occurrenceAt: '2026-04-07T03:00:00.000Z',
          recordedAt: '2026-04-07T03:20:01.000Z',
        },
      },
    });

    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      {
        id: 'sched_20260401000000_abcd1234',
        name: 'Morning briefing',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        enabled: true,
        agentId: 'agent-1',
        message: 'hello',
        status: 'pending',
        lastRunAt: '2026-04-07T03:20:02.000Z',
      },
    ]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
    expect(schedulerRuntimeStateStore.markPendingColdStartCatchUp).not.toHaveBeenCalled();
    expect(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).toHaveBeenCalledTimes(1);
  });

  it('does not run the same occurrence twice when pending replay and baseline scan point to the same missed cron', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:25:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2026-04-07T03:20:00.000Z',
      pendingColdStartCatchUps: {
        sched_20260401000000_abcd1234: {
          occurrenceAt: '2026-04-07T03:00:00.000Z',
          recordedAt: '2026-04-07T03:20:01.000Z',
        },
      },
    });

    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      {
        id: 'sched_20260401000000_abcd1234',
        name: 'Morning briefing',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        enabled: true,
        agentId: 'agent-1',
        message: 'hello',
        status: 'pending',
        lastRunAt: '2026-04-07T03:20:02.000Z',
      },
    ]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalledTimes(1);
    expect(scheduleStore.markJobExecutionCompleted).toHaveBeenCalledTimes(1);
  });

  it('marks the current alias as deactivated on dispose', async () => {
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { schedulerManager } = await import('../SchedulerManager');

    await schedulerManager.initialize('alice');
    await schedulerManager.dispose('app-quit');

    expect(schedulerRuntimeStateStore.markDeactivated).toHaveBeenCalledTimes(1);
  });

  it('returns a manual run chatSessionId only after the scheduled session is ready', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');
    const { schedulerManager } = await import('../SchedulerManager');

    vi.mocked(scheduleStore.getJob).mockResolvedValue({
      id: 'job-manual-1',
      name: 'Manual schedule',
      description: '',
      scheduleType: 'cron',
      cronExpression: '0 * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending',
    });

    const releaseRunRef: { current: (() => void) | null } = { current: null };
    vi.mocked(agentChatManager.runScheduledJob).mockImplementationOnce(async (_job: any, options?: { chatSessionId?: string; onReady?: (payload: { chatSessionId: string }) => void }) => {
      const sessionId = options?.chatSessionId || 'unexpected-session-id';
      options?.onReady?.({ chatSessionId: sessionId });

      await new Promise<void>((resolve) => {
        releaseRunRef.current = resolve;
      });

      return {
        success: true,
        chatSessionId: sessionId,
        messagesCount: 1,
      };
    });

    await schedulerManager.initialize('alice');

    const resultPromise = schedulerManager.runJobNow('job-manual-1');
    const result = await resultPromise;

    expect(result).toEqual({
      success: true,
      chatSessionId: expect.any(String),
    });
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-manual-1' }),
      expect.objectContaining({
        chatSessionId: result.chatSessionId,
        onReady: expect.any(Function),
      }),
    );
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalledTimes(1);

    if (releaseRunRef.current) {
      releaseRunRef.current();
    }
  });

  it('runs a watchdog catch-up when node-cron misses an occurrence while the app stays alive', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:00:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');
    const { runCronWatchdog } = await import('../cronWatchdog');

    const job = {
      id: 'sched_20260401000000_abcd1234',
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
    };

    vi.mocked(scheduleStore.getJob).mockResolvedValue(job);
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: job.cronExpression,
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (jobId) => runtimeMeta.get(jobId),
      setRuntimeMeta: (jobId, meta) => runtimeMeta.set(jobId, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }));
    expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
    expect(runtimeMeta.get(job.id)?.lastCronWatchdogCatchUpAt).toBe('2026-04-07T03:01:00.000Z');
  });

  it('does not run a watchdog catch-up when the missed occurrence is already started', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-04-07T03:00:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');
    const { runCronWatchdog } = await import('../cronWatchdog');

    const job = {
      id: 'sched_20260401000000_abcd1234',
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
      lastRunAt: '2026-04-07T03:02:30.000Z',
    };

    vi.mocked(scheduleStore.getJob).mockResolvedValue(job);
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: job.cronExpression,
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (jobId) => runtimeMeta.get(jobId),
      setRuntimeMeta: (jobId, meta) => runtimeMeta.set(jobId, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
  });

  it('allows watchdog catch-up for a later occurrence while an earlier run is still active', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { runCronWatchdog } = await import('../cronWatchdog');

    const job = {
      id: 'sched_20260401000000_abcd1234',
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
      lastRunAt: '2026-04-07T03:01:30.000Z',
    };
    vi.mocked(scheduleStore.getJob).mockResolvedValue(job);
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: job.cronExpression,
          lastCronWatchdogCheckedAt: '2026-04-07T03:01:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (jobId) => runtimeMeta.get(jobId),
      setRuntimeMeta: (jobId, meta) => runtimeMeta.set(jobId, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:04:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith(job);
    expect(runtimeMeta.get(job.id)?.lastCronWatchdogCatchUpAt).toBe('2026-04-07T03:02:00.000Z');
  });

  it('does not run a watchdog catch-up when no cron occurrence was missed', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { runCronWatchdog } = await import('../cronWatchdog');
    const jobId = 'sched_20260401000000_abcd1234';
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        jobId,
        {
          jobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: '2026-04-07T03:02:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [jobId],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(scheduleStore.getJob).not.toHaveBeenCalled();
    expect(executeJob).not.toHaveBeenCalled();
    expect(runtimeMeta.get(jobId)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T03:02:00.000Z');
  });

  it('does not run a watchdog catch-up when the latest job is inactive', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { runCronWatchdog } = await import('../cronWatchdog');
    const jobId = 'sched_20260401000000_abcd1234';
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        jobId,
        {
          jobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);
    vi.mocked(scheduleStore.getJob).mockResolvedValue({
      id: jobId,
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron',
      cronExpression: '* * * * *',
      enabled: false,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending',
    });

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [jobId],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(scheduleStore.getJob).toHaveBeenCalledWith('alice', jobId);
    expect(executeJob).not.toHaveBeenCalled();
  });

  it('continues watchdog catch-up when one cron job fails', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { runCronWatchdog } = await import('../cronWatchdog');
    const failingJobId = 'sched_20260401000000_abcd1234';
    const successfulJobId = 'sched_20260401000000_efgh5678';
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        failingJobId,
        {
          jobId: failingJobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
        },
      ],
      [
        successfulJobId,
        {
          jobId: successfulJobId,
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '* * * * *',
        },
      ],
    ]);
    const successfulJob = {
      id: successfulJobId,
      name: 'Hourly briefing',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
    };
    const executeJob = vi.fn(async () => undefined);
    vi.mocked(scheduleStore.getJob).mockImplementation(async (_alias: string, jobId: string) => {
      if (jobId === failingJobId) {
        throw new Error('read failed');
      }
      return successfulJob;
    });

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [failingJobId, successfulJobId],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(scheduleStore.getJob).toHaveBeenCalledTimes(2);
    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(executeJob).toHaveBeenCalledWith(successfulJob);
  });
});

describe('SchedulerManager resume-catchup dedup', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

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
    vi.mocked(schedulerRuntimeStateStore.markPendingColdStartCatchUp).mockResolvedValue(undefined as any);
    vi.mocked(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).mockResolvedValue(undefined as any);

    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });
  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // Ignore cleanup failures
    }
    vi.useRealTimers();
  });

  it('skips resume-catchup for a job that already ran via normal cron', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-11T01:25:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    // Scheduler was active, then suspended
    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2026-05-09T08:00:00.000Z',
    });

    // Job already ran at 22:00 via normal cron
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      {
        id: 'sched_job1',
        name: 'Daily Monitor',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 22 * * *',
        enabled: true,
        agentId: 'agent-1',
        message: 'hello',
        status: 'pending',
        lastRunAt: '2026-05-10T22:00:00.450Z',
      },
    ]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Simulate resume: suspended at 05-09, resumed at 05-11 01:25
    await schedulerManager.handleSystemResume(
      Date.parse('2026-05-09T08:26:27.338Z'),
      Date.parse('2026-05-11T01:25:00.000Z'),
    );

    // Should NOT re-run the job because lastRunAt covers the missed occurrence
    expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
  });

  it('runs resume-catchup for a job that has not run since before suspension', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-11T01:25:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2026-05-09T08:00:00.000Z',
    });

    // Job has NOT run since before suspension — cron every hour, last run well before suspend
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      {
        id: 'sched_job2',
        name: 'Hourly Monitor',
        description: '',
        scheduleType: 'cron',
        cronExpression: '0 * * * *',
        enabled: true,
        agentId: 'agent-1',
        message: 'hello',
        status: 'pending',
        lastRunAt: '2026-05-09T08:00:00.000Z',
      },
    ]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Clear any calls from cold-start-catchup during initialize
    vi.mocked(agentChatManager.runScheduledJob).mockClear();

    // Suspended 30 min ago, resumed now — missed 01:00 occurrence is only 25 min old
    await schedulerManager.handleSystemResume(
      Date.parse('2026-05-11T00:55:00.000Z'),
      Date.parse('2026-05-11T01:25:00.000Z'),
    );

    // Should run because lastRunAt is well before the missed occurrence
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });
});

describe('SchedulerManager toggleJobsByAgent', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');

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
    vi.mocked(schedulerRuntimeStateStore.markPendingColdStartCatchUp).mockResolvedValue(undefined as any);
    vi.mocked(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).mockResolvedValue(undefined as any);
  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // Ignore cleanup failures
    }
    vi.useRealTimers();
  });

  it('toggleJobsByAgent(false) only disables enabled jobs, skips already disabled', async () => {
    const { scheduleStore } = await import('../scheduleStore');

    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      { id: 'job-1', name: 'J1', description: '', scheduleType: 'cron', cronExpression: '0 9 * * *', enabled: true, agentId: 'agent-x', message: 'hi', status: 'pending' },
      { id: 'job-2', name: 'J2', description: '', scheduleType: 'cron', cronExpression: '0 17 * * *', enabled: false, agentId: 'agent-x', message: 'hi', status: 'pending' },
      { id: 'job-3', name: 'J3', description: '', scheduleType: 'cron', cronExpression: '0 12 * * *', enabled: true, agentId: 'agent-x', message: 'hi', status: 'pending' },
    ]);

    vi.mocked(scheduleStore.toggleJob).mockImplementation(async (_alias, _jobId, enabled) => {
      return { id: _jobId, name: '', description: '', scheduleType: 'cron' as const, cronExpression: '', enabled, agentId: 'agent-x', message: '', status: 'pending' as const };
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const count = await schedulerManager.toggleJobsByAgent('agent-x', false);

    expect(count).toBe(2);
    expect(scheduleStore.toggleJob).toHaveBeenCalledTimes(2);
    expect(scheduleStore.toggleJob).toHaveBeenCalledWith('alice', 'job-1', false);
    expect(scheduleStore.toggleJob).toHaveBeenCalledWith('alice', 'job-3', false);
  });

  it('toggleJobsByAgent(true) only enables disabled jobs, skips already enabled', async () => {
    const { scheduleStore } = await import('../scheduleStore');

    vi.mocked(scheduleStore.listJobs).mockResolvedValue([
      { id: 'job-1', name: 'J1', description: '', scheduleType: 'cron', cronExpression: '0 9 * * *', enabled: false, agentId: 'agent-x', message: 'hi', status: 'pending' },
      { id: 'job-2', name: 'J2', description: '', scheduleType: 'cron', cronExpression: '0 17 * * *', enabled: true, agentId: 'agent-x', message: 'hi', status: 'pending' },
      { id: 'job-3', name: 'J3', description: '', scheduleType: 'cron', cronExpression: '0 12 * * *', enabled: false, agentId: 'agent-x', message: 'hi', status: 'pending' },
    ]);

    vi.mocked(scheduleStore.toggleJob).mockImplementation(async (_alias, _jobId, enabled) => {
      return { id: _jobId, name: '', description: '', scheduleType: 'cron' as const, cronExpression: '', enabled, agentId: 'agent-x', message: '', status: 'pending' as const };
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const count = await schedulerManager.toggleJobsByAgent('agent-x', true);

    expect(count).toBe(2);
    expect(scheduleStore.toggleJob).toHaveBeenCalledTimes(2);
    expect(scheduleStore.toggleJob).toHaveBeenCalledWith('alice', 'job-1', true);
    expect(scheduleStore.toggleJob).toHaveBeenCalledWith('alice', 'job-3', true);
  });
});
