/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Message, ToolCall } from '@shared/types/chatTypes';

import { CreateScheduleToolCallView } from '../CreateScheduleToolCallView';
import { GetScheduleToolCallView } from '../GetScheduleToolCallView';
import { UpdateScheduleToolCallView } from '../UpdateScheduleToolCallView';

const mockNavigate = vi.fn();
let mockCurrentChatId = 'chat-fallback';

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useCurrentChatId: () => mockCurrentChatId,
}));

vi.mock('../../../../lib/scheduler/cronDescriptions', async () => ({
  describeCronExpression: vi.fn(() => 'Weekdays at 09:00'),
}));

const buildToolCall = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `${name}-call`,
  type: 'function',
  function: {
    name,
    arguments: JSON.stringify(args),
  },
});

const buildToolResult = (payload: unknown): Message => ({
  id: 'tool-result-1',
  role: 'tool',
  timestamp: 1000,
  tool_call_id: 'tool-call-1',
  name: 'schedule',
  content: [
    {
      type: 'text',
      text: JSON.stringify(payload),
    },
  ],
});

describe('schedule tool call routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentChatId = 'chat-fallback';
  });

  it('opens the explicit target agent for create_schedule', () => {
    render(
      <CreateScheduleToolCallView
        toolCall={buildToolCall('create_schedule', {
          name: 'Cross-agent schedule',
          description: 'Create schedule for another agent',
          message: 'Summarize updates',
          agent_id: 'chat-target',
          cron_expression: '0 9 * * 1-5',
        })}
        toolResult={null}
        executionStatus="executing"
      />,
    );

    fireEvent.click(screen.getByTitle('Open target agent schedules'));

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-target/settings/schedules');
  });

  it('opens the updated job agent for update_schedule', () => {
    render(
      <UpdateScheduleToolCallView
        toolCall={buildToolCall('update_schedule', {
          job_id: 'sched_1',
          description: 'Update schedule',
          name: 'Updated schedule',
        })}
        toolResult={buildToolResult({
          success: true,
          message: 'Schedule updated successfully.',
          job: {
            job_id: 'sched_1',
            name: 'Updated schedule',
            description: 'Update schedule',
            schedule_type: 'cron',
            cron_expression: '0 9 * * 1-5',
            message: 'Summarize updates',
            agent_id: 'chat-updated',
            enabled: true,
            status: 'pending',
          },
        })}
        executionStatus="completed"
      />,
    );

    fireEvent.click(screen.getByTitle('Open target agent schedules'));

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-updated/settings/schedules');
  });

  it('opens the requested agent for agent-scoped get_schedule', () => {
    render(
      <GetScheduleToolCallView
        toolCall={buildToolCall('get_schedule', {
          description: 'List agent schedules',
          agent_id: 'chat-requested',
        })}
        toolResult={buildToolResult({
          success: true,
          message: 'Found 1 scheduled task(s).',
          schedules: [
            {
              job_id: 'sched_1',
              name: 'Daily summary',
              description: 'Daily summary',
              schedule_type: 'cron',
              cron_expression: '0 9 * * 1-5',
              message: 'Summarize updates',
              agent_id: 'chat-requested',
              enabled: true,
              status: 'pending',
            },
          ],
        })}
        executionStatus="completed"
      />,
    );

    fireEvent.click(screen.getByTitle('Open related agent schedules'));

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-requested/settings/schedules');
  });

  it('provides per-schedule agent links for multi-agent get_schedule results', () => {
    render(
      <GetScheduleToolCallView
        toolCall={buildToolCall('get_schedule', {
          description: 'List all schedules',
        })}
        toolResult={buildToolResult({
          success: true,
          message: 'Found 2 scheduled task(s).',
          schedules: [
            {
              job_id: 'sched_1',
              name: 'Daily summary',
              description: 'Daily summary',
              schedule_type: 'cron',
              cron_expression: '0 9 * * 1-5',
              message: 'Summarize updates',
              agent_id: 'chat-one',
              enabled: true,
              status: 'pending',
            },
            {
              job_id: 'sched_2',
              name: 'Weekly digest',
              description: 'Weekly digest',
              schedule_type: 'cron',
              cron_expression: '0 9 * * 1-5',
              message: 'Prepare digest',
              agent_id: 'chat-two',
              enabled: true,
              status: 'pending',
            },
          ],
        })}
        executionStatus="completed"
      />,
    );

    expect(screen.getByTitle('Open each schedule from its own agent row')).toBeDisabled();

    const rowButtons = screen.getAllByRole('button', { name: 'Open agent' });
    fireEvent.click(rowButtons[1]);

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-two/settings/schedules');
  });
});