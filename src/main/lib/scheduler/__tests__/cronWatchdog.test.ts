import { runCronWatchdog, type CronWatchdogTaskRuntimeMeta } from '../cronWatchdog';

vi.mock('../scheduleStore', async () => ({
  scheduleStore: {
    getJob: vi.fn(async () => null),
  },
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
      chat_id: 'agent-1',
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
      chat_id: 'agent-1',
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
      chat_id: 'agent-1',
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
      chat_id: 'agent-1',
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

  const everyMinuteJob = {
    id: 'job-retry',
    name: 'retry job',
    description: '',
    scheduleType: 'cron' as const,
    cronExpression: '* * * * *',
    enabled: true,
    chat_id: 'agent-1',
    message: 'hello',
    status: 'pending' as const,
  };

  const seedRuntimeMeta = (jobId: string, lastCheckedAt: string) =>
    new Map<string, CronWatchdogTaskRuntimeMeta>([
      [
        jobId,
        {
          jobId,
          registeredAt: '2026-04-07T02:00:00.000Z',
          cronExpression: '* * * * *',
          lastCronWatchdogCheckedAt: lastCheckedAt,
        },
      ],
    ]);

  it('rolls the checkpoint back so a guard-skipped catch-up is retried next heartbeat', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(everyMinuteJob);

    const runtimeMeta = seedRuntimeMeta(everyMinuteJob.id, '2026-04-07T03:00:00.000Z');
    const executeJob = vi.fn(async () => ({ error: 'skipped-overlap' }));

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [everyMinuteJob.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    // Missed occurrence is 03:01:00 (prev tick before the 03:02:00 window end);
    // the checkpoint is held to just before it so the next heartbeat re-detects
    // and retries the same occurrence.
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T03:00:59.999Z');
  });

  it('retries the exact guard-skipped occurrence across multiple heartbeats', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(everyMinuteJob);

    const runtimeMeta = seedRuntimeMeta(everyMinuteJob.id, '2026-04-07T03:00:00.000Z');
    const executeJob = vi.fn(async () => ({ error: 'skipped-concurrency-limit' }));
    const options = {
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [everyMinuteJob.id],
      getRuntimeMeta: (id: string) => runtimeMeta.get(id),
      setRuntimeMeta: (id: string, meta: CronWatchdogTaskRuntimeMeta) => runtimeMeta.set(id, meta),
      executeJob,
    };

    await runCronWatchdog({
      ...options,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCatchUpAt).toBe('2026-04-07T03:01:00.000Z');

    await runCronWatchdog({
      ...options,
      nowMs: Date.parse('2026-04-07T03:04:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(2);
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCatchUpAt).toBe('2026-04-07T03:01:00.000Z');
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T03:00:59.999Z');
  });

  it('advances the checkpoint normally when the catch-up succeeds', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(everyMinuteJob);

    const runtimeMeta = seedRuntimeMeta(everyMinuteJob.id, '2026-04-07T03:00:00.000Z');
    const executeJob = vi.fn(async () => ({})); // success: no error

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [everyMinuteJob.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T03:02:00.000Z');
  });

  it('advances the checkpoint when the catch-up fails because a required MCP server is disconnected', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(everyMinuteJob);

    const runtimeMeta = seedRuntimeMeta(everyMinuteJob.id, '2026-04-07T03:00:00.000Z');
    const executeJob = vi.fn(async () => ({ error: 'Required MCP server disconnected: teams' }));

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 60_000,
      cronJobIds: [everyMinuteJob.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T03:02:00.000Z');
  });

  it('does not retry a guard-skipped catch-up once the occurrence is outside the catch-up window', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(everyMinuteJob);

    // A 7h heartbeat window forces the missed every-minute occurrence to land 7h
    // before "now" — beyond the 6h catch-up window — without depending on the
    // local timezone the way an hour-specific cron would.
    const runtimeMeta = seedRuntimeMeta(everyMinuteJob.id, '2026-04-07T04:00:00.000Z');
    const executeJob = vi.fn(async () => ({ error: 'skipped-overlap' }));

    await runCronWatchdog({
      alias: 'alice',
      heartbeatIntervalMs: 7 * 60 * 60 * 1000,
      cronJobIds: [everyMinuteJob.id],
      getRuntimeMeta: (id) => runtimeMeta.get(id),
      setRuntimeMeta: (id, meta) => runtimeMeta.set(id, meta),
      executeJob,
      nowMs: Date.parse('2026-04-07T12:00:00.000Z'),
    });

    expect(executeJob).toHaveBeenCalledTimes(1);
    // Checkpoint advances to eligibleUntil (now - heartbeat); the stale occurrence is given up.
    expect(runtimeMeta.get(everyMinuteJob.id)?.lastCronWatchdogCheckedAt).toBe('2026-04-07T05:00:00.000Z');
  });

  it('still resolves when runtimeMeta disappears before the retry rollback', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.getJob).mockResolvedValue(everyMinuteJob);

    const seeded = seedRuntimeMeta(everyMinuteJob.id, '2026-04-07T03:00:00.000Z');
    const setRuntimeMeta = vi.fn();
    let callCount = 0;
    const getRuntimeMeta = (id: string) => {
      callCount++;
      // First two reads return meta; the third (retry rollback) returns undefined.
      return callCount <= 2 ? seeded.get(id) : undefined;
    };
    const executeJob = vi.fn(async () => ({ error: 'skipped-overlap' }));

    await expect(
      runCronWatchdog({
        alias: 'alice',
        heartbeatIntervalMs: 60_000,
        cronJobIds: [everyMinuteJob.id],
        getRuntimeMeta,
        setRuntimeMeta,
        executeJob,
        nowMs: Date.parse('2026-04-07T03:03:00.000Z'),
      }),
    ).resolves.toBeUndefined();

    expect(executeJob).toHaveBeenCalledTimes(1);
    // No third setRuntimeMeta (rollback) because retryMeta was undefined.
    expect(setRuntimeMeta).toHaveBeenCalledTimes(2);
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
