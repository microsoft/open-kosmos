import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createJobMock } = vi.hoisted(() => ({
  createJobMock: vi.fn(),
}));

vi.mock('../../../scheduler/id', () => ({
  generateScheduleJobId: vi.fn(() => 'job-test-123'),
}));

vi.mock('../../../scheduler/SchedulerManager', () => ({
  schedulerManager: {
    createJob: createJobMock,
  },
}));

import { CreateScheduleTool } from '../createScheduleTool';

describe('CreateScheduleTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createJobMock.mockResolvedValue(true);
  });

  it('uses captured execution context as the target agent when chat_id is omitted', async () => {
    const result = await CreateScheduleTool.execute(
      {
        description: 'Follow up later',
        name: 'Follow-up reminder',
        run_at: '2026-03-25T12:00:00Z',
        message: 'Follow up with the team.',
      },
      {
        executionContext: {
          chatId: 'captured-agent-42',
          chatSessionId: 'session-42',
          userAlias: 'alice',
          isSubAgent: false,
        } as any,
      },
    );

    expect(result).toEqual({
      success: true,
      job_id: 'job-test-123',
      message: 'One-time schedule "Follow-up reminder" created successfully. Run at: 2026-03-25T12:00:00Z',
    });
    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'captured-agent-42',
        scheduleType: 'once',
        runAt: '2026-03-25T12:00:00Z',
        cronExpression: undefined,
      }),
    );
  });

  it('uses explicit chat_id before captured execution context', async () => {
    await CreateScheduleTool.execute(
      {
        description: 'Daily report',
        name: 'Daily report',
        cron_expression: '0 6 * * *',
        message: 'Prepare the daily report.',
        chat_id: 'explicit-agent',
      },
      {
        executionContext: {
          chatId: 'captured-agent',
          chatSessionId: 'session-1',
          userAlias: 'alice',
          isSubAgent: false,
        } as any,
      },
    );

    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_id: 'explicit-agent',
        scheduleType: 'cron',
        cronExpression: '0 6 * * *',
        runAt: undefined,
      }),
    );
  });

  it('returns an error when no target agent can be resolved', async () => {
    const result = await CreateScheduleTool.execute({
      description: 'No agent',
      name: 'No agent',
      run_at: '2026-03-25T12:00:00Z',
      message: 'Hello',
    });

    expect(result).toEqual({
      success: false,
      message: 'chat_id is required. Could not determine the target chat.',
    });
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('requires exactly one schedule timing mode', async () => {
    const bothModes = await CreateScheduleTool.execute({
      description: 'Invalid',
      name: 'Invalid',
      cron_expression: '0 6 * * *',
      run_at: '2026-03-25T12:00:00Z',
      message: 'Hello',
      chat_id: 'agent-1',
    });
    const noMode = await CreateScheduleTool.execute({
      description: 'Invalid',
      name: 'Invalid',
      message: 'Hello',
      chat_id: 'agent-1',
    });

    expect(bothModes).toEqual({ success: false, message: 'Provide exactly one of cron_expression or run_at.' });
    expect(noMode).toEqual({ success: false, message: 'Provide exactly one of cron_expression or run_at.' });
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it('returns one-time creation failure message when scheduler rejects run_at job', async () => {
    createJobMock.mockResolvedValue(false);

    const result = await CreateScheduleTool.execute({
      description: 'Rejected once',
      name: 'Rejected once',
      run_at: '2026-03-25T12:00:00Z',
      message: 'Hello',
      chat_id: 'agent-1',
    });

    expect(result).toEqual({
      success: false,
      message: 'Failed to create one-time schedule. Please check if run_at is a valid ISO timestamp in the future.',
    });
  });

  it('returns recurring creation failure message when scheduler rejects cron job', async () => {
    createJobMock.mockResolvedValue(false);

    const result = await CreateScheduleTool.execute({
      description: 'Rejected cron',
      name: 'Rejected cron',
      cron_expression: '0 6 * * *',
      message: 'Hello',
      chat_id: 'agent-1',
    });

    expect(result).toEqual({
      success: false,
      message: 'Failed to create recurring schedule. Please check if the cron expression is valid.',
    });
  });

  it('returns an error message when scheduler throws', async () => {
    createJobMock.mockRejectedValue(new Error('database unavailable'));

    const result = await CreateScheduleTool.execute({
      description: 'Throws',
      name: 'Throws',
      run_at: '2026-03-25T12:00:00Z',
      message: 'Hello',
      chat_id: 'agent-1',
    });

    expect(result).toEqual({
      success: false,
      message: 'Failed to create schedule: database unavailable',
    });
  });

  it('returns the create_schedule definition', () => {
    const definition = CreateScheduleTool.getDefinition();

    expect(definition.name).toBe('create_schedule');
    expect(definition.inputSchema.required).toEqual(['description', 'name', 'message']);
    expect(definition.inputSchema.properties).toHaveProperty('chat_id');
  });
});