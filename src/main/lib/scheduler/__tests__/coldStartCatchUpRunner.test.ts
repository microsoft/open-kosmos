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

import { runColdStartCatchUp, type ColdStartCatchUpRunnerContext } from '../coldStartCatchUpRunner';
import type { SchedulerJob } from '../types';

function makeJob(overrides?: Partial<SchedulerJob>): SchedulerJob {
  return {
    id: 'job-1',
    name: 'Morning briefing',
    description: '',
    scheduleType: 'cron',
    cronExpression: '0 * * * *',
    enabled: true,
    chat_id: 'agent-1',
    message: 'hello',
    status: 'pending',
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ColdStartCatchUpRunnerContext>): ColdStartCatchUpRunnerContext {
  const job = makeJob();
  return {
    alias: 'alice',
    startupAtMs: Date.parse('2026-04-07T03:25:00.000Z'),
    jobs: [job],
    runtimeState: {
      schemaVersion: 1,
      alias: 'alice',
      isActive: true,
      lastActivatedAt: '2026-04-07T00:10:00.000Z',
    },
    getJob: vi.fn(async () => job),
    clearPending: vi.fn(async () => undefined),
    execute: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

describe('coldStartCatchUpRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clears pending catch-up when the job is missing from the startup snapshot', async () => {
    const context = makeContext({
      jobs: [],
      runtimeState: {
        schemaVersion: 1,
        alias: 'alice',
        isActive: false,
        pendingColdStartCatchUps: {
          'deleted-job': {
            occurrenceAt: '2026-04-07T03:00:00.000Z',
            recordedAt: '2026-04-07T03:01:00.000Z',
          },
        },
      },
    });

    await runColdStartCatchUp(context);

    expect(context.clearPending).toHaveBeenCalledWith('deleted-job');
    expect(context.getJob).not.toHaveBeenCalled();
    expect(context.execute).not.toHaveBeenCalled();
  });

  it('clears pending catch-up when the refreshed job is inactive', async () => {
    const snapshotJob = makeJob();
    const context = makeContext({
      jobs: [snapshotJob],
      runtimeState: {
        schemaVersion: 1,
        alias: 'alice',
        isActive: false,
        pendingColdStartCatchUps: {
          [snapshotJob.id]: {
            occurrenceAt: '2026-04-07T03:00:00.000Z',
            recordedAt: '2026-04-07T03:01:00.000Z',
          },
        },
      },
      getJob: vi.fn(async () => ({ ...snapshotJob, enabled: false })),
    });

    await runColdStartCatchUp(context);

    expect(context.clearPending).toHaveBeenCalledWith(snapshotJob.id);
    expect(context.execute).not.toHaveBeenCalled();
  });

  it('does not run baseline catch-up again after replaying the same pending occurrence', async () => {
    const job = makeJob({ cronExpression: '0 * * * *' });
    const context = makeContext({
      startupAtMs: Date.parse('2026-04-07T03:25:00.000Z'),
      jobs: [job],
      runtimeState: {
        schemaVersion: 1,
        alias: 'alice',
        isActive: true,
        lastActivatedAt: '2026-04-07T02:50:00.000Z',
        pendingColdStartCatchUps: {
          [job.id]: {
            occurrenceAt: '2026-04-07T03:00:00.000Z',
            recordedAt: '2026-04-07T03:01:00.000Z',
          },
        },
      },
      getJob: vi.fn(async () => job),
    });

    await runColdStartCatchUp(context);

    expect(context.execute).toHaveBeenCalledTimes(1);
    expect(context.execute).toHaveBeenCalledWith(job, '2026-04-07T03:00:00.000Z', true);
  });

  it('skips stale baseline occurrences', async () => {
    const dateTimeFormatSpy = vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'UTC' }),
    } as Intl.DateTimeFormat);
    const job = makeJob({ cronExpression: '5 12 * * *' });
    const context = makeContext({
      startupAtMs: Date.parse('2026-05-11T20:00:00.000Z'),
      jobs: [job],
      runtimeState: {
        schemaVersion: 1,
        alias: 'alice',
        isActive: false,
        lastDeactivatedAt: '2026-05-11T12:00:00.000Z',
      },
      getJob: vi.fn(async () => job),
    });

    await runColdStartCatchUp(context);

    expect(context.execute).not.toHaveBeenCalled();
    dateTimeFormatSpy.mockRestore();
  });

  it('does not count failed baseline executions as recovered', async () => {
    const job = makeJob({ cronExpression: '0 * * * *' });
    const context = makeContext({
      startupAtMs: Date.parse('2026-04-07T03:25:00.000Z'),
      jobs: [job],
      runtimeState: {
        schemaVersion: 1,
        alias: 'alice',
        isActive: true,
        lastActivatedAt: '2026-04-07T00:10:00.000Z',
      },
      getJob: vi.fn(async () => job),
      execute: vi.fn(async () => ({ success: false })),
    });

    await runColdStartCatchUp(context);

    expect(context.execute).toHaveBeenCalledTimes(1);
  });
});
