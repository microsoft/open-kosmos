import { runCronWatchdog, type CronWatchdogTaskRuntimeMeta } from '../cronWatchdog';

vi.mock('../scheduleStore', async () => ({
  scheduleStore: {
    getJob: vi.fn(async () => null),
  },
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('runCronWatchdog edge cases', () => {
  it('returns early when alias is null', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const executeJob = vi.fn();
    await runCronWatchdog({
      alias: null,
      heartbeatIntervalMs: 60_000,
      cronJobIds: ['job-1'],
      getRuntimeMeta: () => undefined,
      setRuntimeMeta: vi.fn(),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });
    expect(scheduleStore.getJob).not.toHaveBeenCalled();
    expect(executeJob).not.toHaveBeenCalled();
  });

  it('returns early when eligibleUntilMs <= 0 (heartbeatIntervalMs >= nowMs)', async () => {
    const executeJob = vi.fn();
    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 1_000_000,
      cronJobIds: ['job-1'],
      getRuntimeMeta: () => undefined,
      setRuntimeMeta: vi.fn(),
      executeJob,
      nowMs: 500_000, // less than heartbeatIntervalMs so eligibleUntilMs is negative
    });
    expect(executeJob).not.toHaveBeenCalled();
  });

  it('returns early when there is no missed cron occurrence in the window', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(null);

    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        'job-no-miss',
        {
          jobId: 'job-no-miss',
          registeredAt: '2026-04-07T03:00:00.000Z',
          cronExpression: '0 12 * * *', // runs at noon, window is 03:00-03:03
          lastCronWatchdogCheckedAt: '2026-04-07T03:00:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn();

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: ['job-no-miss'],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).not.toHaveBeenCalled();
    expect(scheduleStore.getJob).not.toHaveBeenCalled();
  });

  it('skips catch-up when job has already been run after the missed occurrence', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const job = {
      id: 'job-already-ran',
      name: 'already ran',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: true,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
      lastRunAt: '2026-04-07T03:02:00.000Z', // already ran after the missed occurrence
    };
    vi.mocked(scheduleStore.getJob).mockResolvedValue(job);

    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        job.id,
        {
          jobId: job.id,
          registeredAt: '2026-04-07T02:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: '2026-04-07T03:00:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn();

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).not.toHaveBeenCalled();
  });

  it('returns early when runtimeMeta has no cronExpression', async () => {
    const executeJob = vi.fn();
    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        'job-no-cron',
        {
          jobId: 'job-no-cron',
          registeredAt: '2026-04-07T03:00:00.000Z',
          // cronExpression intentionally absent
        },
      ],
    ]);
    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: ['job-no-cron'],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: vi.fn(),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });
    expect(executeJob).not.toHaveBeenCalled();
  });

  it('returns early when getRuntimeMeta returns undefined', async () => {
    const executeJob = vi.fn();
    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: ['job-missing'],
      getRuntimeMeta: () => undefined,
      setRuntimeMeta: vi.fn(),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });
    expect(executeJob).not.toHaveBeenCalled();
  });

  it('uses lastTickArrivedAt as baseline when lastCronWatchdogCheckedAt is absent', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const job = {
      id: 'job-tick',
      name: 'tick job',
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
          registeredAt: '2026-04-07T02:00:00.000Z',
          cronExpression: '* * * * *',
          lastTickArrivedAt: '2026-04-07T03:00:00.000Z',
          // no lastCronWatchdogCheckedAt
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
  });

  it('skips catch-up when job exists but is disabled', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const disabledJob = {
      id: 'job-disabled',
      name: 'disabled job',
      description: '',
      scheduleType: 'cron' as const,
      cronExpression: '* * * * *',
      enabled: false,
      agentId: 'agent-1',
      message: 'hello',
      status: 'pending' as const,
    };
    vi.mocked(scheduleStore.getJob).mockResolvedValue(disabledJob);

    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        disabledJob.id,
        {
          jobId: disabledJob.id,
          registeredAt: '2026-04-07T02:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: '2026-04-07T03:00:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn();

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [disabledJob.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).not.toHaveBeenCalled();
  });

  it('executes catch-up when latestMeta is absent (getRuntimeMeta returns undefined after setRuntimeMeta)', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const job = {
      id: 'job-no-meta',
      name: 'no-meta job',
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
          registeredAt: '2026-04-07T02:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: '2026-04-07T03:00:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn(async () => undefined);

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [job.id],
      // Return undefined for second call (simulates race where meta is cleared)
      getRuntimeMeta: (() => {
        let callCount = 0;
        return (id: string) => {
          callCount++;
          return callCount === 1 ? runtimeMeta.get(id) : undefined;
        };
      })(),
      setRuntimeMeta: vi.fn(),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
  });

  it('logs a non-Error exception from watchdog job handler', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    // Make getJob throw a non-Error (e.g., a string)
    vi.mocked(scheduleStore.getJob).mockRejectedValue('string-error');

    const runtimeMeta = new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        'job-throw',
        {
          jobId: 'job-throw',
          registeredAt: '2026-04-07T02:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: '2026-04-07T03:00:00.000Z',
        },
      ],
    ]);
    const executeJob = vi.fn();

    // Should not throw - the error is caught and logged
    await expect(
      runCronWatchdog({
        alias: 'alice',
        heartbeatIntervalMs: 60_000,
        cronJobIds: ['job-throw'],
        getRuntimeMeta: (id) => runtimeMeta.get(id),
        setRuntimeMeta: vi.fn(),
        executeJob,
        nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
      }),
    ).resolves.toBeUndefined();

    expect(executeJob).not.toHaveBeenCalled();
  });
});
