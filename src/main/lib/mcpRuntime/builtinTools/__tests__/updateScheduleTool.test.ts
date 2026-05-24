/**
 * Tests for UpdateScheduleTool — full branch coverage
 */

const { schedulerManagerMock } = vi.hoisted(() => {
  const schedulerManagerMock = {
    updateJob: vi.fn(),
    listJobs: vi.fn(),
  };
  return { schedulerManagerMock };
});

vi.mock('../../../scheduler/SchedulerManager', () => ({
  schedulerManager: schedulerManagerMock,
}));

import { UpdateScheduleTool } from '../updateScheduleTool';

describe('UpdateScheduleTool.getDefinition', () => {
  it('returns correct tool name', () => {
    const def = UpdateScheduleTool.getDefinition();
    expect(def.name).toBe('update_schedule');
    expect(def.inputSchema.required).toContain('job_id');
  });
});

describe('UpdateScheduleTool.execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failure when no editable fields are provided', async () => {
    // Pass args without any updatable field (only job_id, no name/description/etc.)
    const result = await UpdateScheduleTool.execute({
      job_id: 'sched_123',
    } as any);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/No fields to update/);
    expect(schedulerManagerMock.updateJob).not.toHaveBeenCalled();
  });

  it('updates name and description successfully', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([
      {
        id: 'sched_123',
        name: 'New Name',
        description: 'New desc',
        scheduleType: 'cron',
        cronExpression: '0 6 * * *',
        runAt: undefined,
        message: 'hello',
        agentId: 'agent-1',
        enabled: true,
        status: 'pending',
        lastRunAt: undefined,
        executedAt: undefined,
      },
    ]);

    const result = await UpdateScheduleTool.execute({
      job_id: 'sched_123',
      name: 'New Name',
      description: 'New desc',
    });

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/updated successfully/i);
    expect(result.job?.name).toBe('New Name');
  });

  it('returns success with undefined job when listJobs does not contain the job', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    const result = await UpdateScheduleTool.execute({
      description: 'updating',
      job_id: 'sched_missing',
      name: 'X',
    });

    expect(result.success).toBe(true);
    expect(result.job).toBeUndefined();
  });

  it('returns failure when updateJob returns false', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(false);

    const result = await UpdateScheduleTool.execute({
      description: 'updating',
      job_id: 'sched_123',
      name: 'X',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Failed to update/);
  });

  it('returns failure when updateJob throws', async () => {
    schedulerManagerMock.updateJob.mockRejectedValue(new Error('DB error'));

    const result = await UpdateScheduleTool.execute({
      description: 'updating',
      job_id: 'sched_123',
      name: 'X',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/DB error/);
  });

  it('clears runAt and sets status=pending when cron_expression is provided', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    await UpdateScheduleTool.execute({
      description: 'set cron',
      job_id: 'sched_123',
      cron_expression: '0 6 * * *',
    });

    const updates = schedulerManagerMock.updateJob.mock.calls[0][1];
    expect(updates.scheduleType).toBe('cron');
    expect(updates.runAt).toBeUndefined();
    expect(updates.status).toBe('pending');
    expect(updates.executedAt).toBeUndefined();
    expect(updates.lastRunAt).toBeUndefined();
  });

  it('clears cronExpression and sets status=pending when run_at is provided', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    await UpdateScheduleTool.execute({
      description: 'set run_at',
      job_id: 'sched_123',
      run_at: '2026-05-01T06:00:00+00:00',
    });

    const updates = schedulerManagerMock.updateJob.mock.calls[0][1];
    expect(updates.scheduleType).toBe('once');
    expect(updates.cronExpression).toBeUndefined();
    expect(updates.status).toBe('pending');
  });

  it('sets runAt=undefined when schedule_type=cron without cron_expression', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    await UpdateScheduleTool.execute({
      description: 'switch to cron',
      job_id: 'sched_123',
      schedule_type: 'cron',
    });

    const updates = schedulerManagerMock.updateJob.mock.calls[0][1];
    expect(updates.scheduleType).toBe('cron');
    expect(updates.runAt).toBeUndefined();
  });

  it('sets cronExpression=undefined when schedule_type=once without run_at', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    await UpdateScheduleTool.execute({
      description: 'switch to once',
      job_id: 'sched_123',
      schedule_type: 'once',
    });

    const updates = schedulerManagerMock.updateJob.mock.calls[0][1];
    expect(updates.scheduleType).toBe('once');
    expect(updates.cronExpression).toBeUndefined();
  });

  it('updates enabled field', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    await UpdateScheduleTool.execute({
      description: 'disable',
      job_id: 'sched_123',
      enabled: false,
    });

    const updates = schedulerManagerMock.updateJob.mock.calls[0][1];
    expect(updates.enabled).toBe(false);
  });

  it('updates message field', async () => {
    schedulerManagerMock.updateJob.mockResolvedValue(true);
    schedulerManagerMock.listJobs.mockResolvedValue([]);

    await UpdateScheduleTool.execute({
      description: 'new message',
      job_id: 'sched_123',
      message: 'Run now!',
    });

    const updates = schedulerManagerMock.updateJob.mock.calls[0][1];
    expect(updates.message).toBe('Run now!');
  });
});
