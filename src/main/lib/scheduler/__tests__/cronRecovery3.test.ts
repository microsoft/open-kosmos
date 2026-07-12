import {
  planPendingColdStartReplays,
  runPendingColdStartReplays,
  MAX_RESUME_CATCH_UP_DELAY_MS,
} from '../cronRecovery';
import type { PendingColdStartReplayContext } from '../cronRecovery';
import type { SchedulerJob } from '../types';
import type { PendingColdStartCatchUp } from '../schedulerRuntimeStateStore';

function makeJob(overrides?: Partial<SchedulerJob>): SchedulerJob {
  return {
    id: 'job-1',
    description: '',
    name: 'Test Job',
    scheduleType: 'cron',
    cronExpression: '*/5 * * * *',
    enabled: true,
    chat_id: 'chat-1',
    message: 'hello',
    status: 'pending',
    ...overrides,
  };
}

function pendingEntry(occurrenceAt: string): PendingColdStartCatchUp {
  return { occurrenceAt, recordedAt: '2026-05-11T11:59:00.000Z' };
}

const NOW_MS = Date.parse('2026-05-11T12:00:00.000Z');
const RECENT_OCCURRENCE = '2026-05-11T11:55:00.000Z';

describe('planPendingColdStartReplays', () => {
  it('returns an empty plan when pending is undefined', () => {
    expect(planPendingColdStartReplays(undefined, [makeJob()], NOW_MS)).toEqual({ replay: [], drop: [] });
  });

  it('returns an empty plan when there are no pending entries', () => {
    expect(planPendingColdStartReplays({}, [makeJob()], NOW_MS)).toEqual({ replay: [], drop: [] });
  });

  it('drops a pending entry whose job no longer exists', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(pending, [], NOW_MS);
    expect(plan.replay).toEqual([]);
    expect(plan.drop).toEqual(['job-1']);
  });

  it('drops a pending entry whose job is disabled', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(pending, [makeJob({ enabled: false })], NOW_MS);
    expect(plan.drop).toEqual(['job-1']);
  });

  it('drops a pending entry whose job is no longer a cron job', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(
      pending,
      [makeJob({ scheduleType: 'once', cronExpression: undefined, runAt: RECENT_OCCURRENCE })],
      NOW_MS,
    );
    expect(plan.drop).toEqual(['job-1']);
  });

  it('drops a pending entry whose cron job has no cron expression', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(pending, [makeJob({ cronExpression: undefined })], NOW_MS);
    expect(plan.drop).toEqual(['job-1']);
  });

  it('drops a pending entry with an unparseable occurrence timestamp', () => {
    const pending = { 'job-1': pendingEntry('not-a-date') };
    const plan = planPendingColdStartReplays(pending, [makeJob()], NOW_MS);
    expect(plan.drop).toEqual(['job-1']);
  });

  it('drops a pending entry already completed by a later finished run', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(
      pending,
      [makeJob({ lastRunAt: '2026-05-11T11:56:00.000Z', lastFinishedAt: '2026-05-11T11:57:00.000Z' })],
      NOW_MS,
    );
    expect(plan.drop).toEqual(['job-1']);
  });

  it('replays a pending entry when only lastRunAt covers the occurrence', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(
      pending,
      [makeJob({ lastRunAt: '2026-05-11T11:56:00.000Z' })],
      NOW_MS,
    );
    expect(plan.drop).toEqual([]);
    expect(plan.replay).toHaveLength(1);
  });

  it('drops a pending entry whose occurrence is outside the catch-up window', () => {
    const stale = new Date(NOW_MS - MAX_RESUME_CATCH_UP_DELAY_MS - 60_000).toISOString();
    const pending = { 'job-1': pendingEntry(stale) };
    const plan = planPendingColdStartReplays(pending, [makeJob()], NOW_MS);
    expect(plan.drop).toEqual(['job-1']);
  });

  it('replays a valid in-window pending entry without a recorded last run', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(pending, [makeJob()], NOW_MS);
    expect(plan.drop).toEqual([]);
    expect(plan.replay).toEqual([{ job: makeJob(), occurrenceAt: RECENT_OCCURRENCE }]);
  });

  it('replays when the last run predates the missed occurrence', () => {
    const pending = { 'job-1': pendingEntry(RECENT_OCCURRENCE) };
    const plan = planPendingColdStartReplays(
      pending,
      [makeJob({ lastRunAt: '2026-05-11T11:50:00.000Z' })],
      NOW_MS,
    );
    expect(plan.replay).toHaveLength(1);
    expect(plan.replay[0].occurrenceAt).toBe(RECENT_OCCURRENCE);
  });

  it('handles a mix of replayable and droppable entries', () => {
    const stale = new Date(NOW_MS - MAX_RESUME_CATCH_UP_DELAY_MS - 60_000).toISOString();
    const pending = {
      'job-1': pendingEntry(RECENT_OCCURRENCE),
      'job-2': pendingEntry(stale),
    };
    const jobs = [makeJob({ id: 'job-1' }), makeJob({ id: 'job-2' })];
    const plan = planPendingColdStartReplays(pending, jobs, NOW_MS);
    expect(plan.replay.map((item) => item.job.id)).toEqual(['job-1']);
    expect(plan.drop).toEqual(['job-2']);
  });
});

describe('runPendingColdStartReplays', () => {
  function makeContext(overrides?: Partial<PendingColdStartReplayContext>): {
    context: PendingColdStartReplayContext;
    readState: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
    clearPending: ReturnType<typeof vi.fn>;
    replay: ReturnType<typeof vi.fn>;
  } {
    const readState = vi.fn(async () => ({ pendingColdStartCatchUps: undefined as Record<string, PendingColdStartCatchUp> | undefined }));
    const listJobs = vi.fn(async () => [] as SchedulerJob[]);
    const clearPending = vi.fn(async () => undefined);
    const replay = vi.fn(async () => undefined);
    const context: PendingColdStartReplayContext = {
      readState,
      listJobs,
      clearPending,
      replay,
      ...overrides,
    };
    return { context, readState, listJobs, clearPending, replay };
  }

  it('returns early when there are no persisted pending entries', async () => {
    const { context, listJobs, clearPending, replay } = makeContext();
    await runPendingColdStartReplays(context);
    expect(listJobs).not.toHaveBeenCalled();
    expect(clearPending).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it('returns early when the persisted pending map is empty', async () => {
    const { context, listJobs } = makeContext({
      readState: vi.fn(async () => ({ pendingColdStartCatchUps: {} })),
    });
    await runPendingColdStartReplays(context);
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('clears dropped entries and replays valid ones using the injected clock', async () => {
    const stale = new Date(NOW_MS - MAX_RESUME_CATCH_UP_DELAY_MS - 60_000).toISOString();
    const { context, clearPending, replay } = makeContext({
      readState: vi.fn(async () => ({
        pendingColdStartCatchUps: {
          'job-1': pendingEntry(RECENT_OCCURRENCE),
          'job-2': pendingEntry(stale),
        },
      })),
      listJobs: vi.fn(async () => [makeJob({ id: 'job-1' }), makeJob({ id: 'job-2' })]),
      now: () => NOW_MS,
    });

    await runPendingColdStartReplays(context);

    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(clearPending).toHaveBeenCalledWith('job-2');
    expect(replay).toHaveBeenCalledTimes(1);
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }), RECENT_OCCURRENCE);
  });

  it('falls back to the real clock when no clock is injected', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const { context, replay } = makeContext({
      readState: vi.fn(async () => ({ pendingColdStartCatchUps: { 'job-1': pendingEntry(recent) } })),
      listJobs: vi.fn(async () => [makeJob({ id: 'job-1' })]),
    });

    await runPendingColdStartReplays(context);

    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }), recent);
  });
});
