import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listJobsMock } = vi.hoisted(() => ({
  listJobsMock: vi.fn(),
}));

vi.mock('../../../scheduler/SchedulerManager', () => ({
  schedulerManager: {
    listJobs: listJobsMock,
  },
}));

import { GetScheduleTool } from '../getScheduleTool';

describe('GetScheduleTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps jobs to chat_id and reports the count when schedules exist', async () => {
    listJobsMock.mockResolvedValue([
      {
        id: 'job-1',
        name: 'Daily',
        description: 'desc',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        runAt: undefined,
        message: 'hi',
        chat_id: 'chat_A',
        enabled: true,
        status: 'pending',
        lastRunAt: '2026-01-01T09:00:00Z',
        executedAt: '2026-01-01T09:00:01Z',
      },
    ]);

    const result = await GetScheduleTool.execute({ description: 'list', chat_id: 'chat_A' });

    expect(listJobsMock).toHaveBeenCalledWith('chat_A');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Found 1 scheduled task(s).');
    expect(result.schedules).toEqual([
      {
        job_id: 'job-1',
        name: 'Daily',
        description: 'desc',
        schedule_type: 'cron',
        cron_expression: '0 9 * * *',
        run_at: undefined,
        message: 'hi',
        chat_id: 'chat_A',
        enabled: true,
        status: 'pending',
        last_run_at: '2026-01-01T09:00:00Z',
        executed_at: '2026-01-01T09:00:01Z',
      },
    ]);
  });

  it('reports no tasks when the list is empty', async () => {
    listJobsMock.mockResolvedValue([]);

    const result = await GetScheduleTool.execute({ description: 'list' });

    expect(listJobsMock).toHaveBeenCalledWith(undefined);
    expect(result.success).toBe(true);
    expect(result.schedules).toEqual([]);
    expect(result.message).toBe('No scheduled tasks found.');
  });

  it('returns a failure message when listJobs throws an Error', async () => {
    listJobsMock.mockRejectedValue(new Error('boom'));

    const result = await GetScheduleTool.execute({ description: 'list' });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to get schedules: boom');
  });

  it('returns a failure message when listJobs throws a non-Error', async () => {
    listJobsMock.mockRejectedValue('weird');

    const result = await GetScheduleTool.execute({ description: 'list' });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Failed to get schedules: weird');
  });

  it('exposes a get_schedule definition with the expected schema', () => {
    const def = GetScheduleTool.getDefinition();
    expect(def.name).toBe('get_schedule');
    expect(def.inputSchema.required).toEqual(['description']);
    expect(def.inputSchema.properties.chat_id).toBeDefined();
  });
});
