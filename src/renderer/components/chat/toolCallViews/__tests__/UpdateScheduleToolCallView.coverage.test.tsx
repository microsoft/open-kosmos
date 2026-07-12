// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ToolCall } from '@shared/types/chatTypes';
import { UpdateScheduleToolCallView } from '../UpdateScheduleToolCallView';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  currentChatId: 'chat-fallback',
  describeCronExpression: vi.fn(() => 'Weekdays at 09:00'),
}));

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: () => mocks.currentChatId,
}));

vi.mock('../../../../lib/scheduler/cronDescriptions', () => ({
  describeCronExpression: mocks.describeCronExpression,
}));

function makeToolCall(args: Record<string, unknown> | string | undefined = {}): ToolCall {
  return {
    id: 'update-schedule-call',
    type: 'function',
    function: {
      name: 'update_schedule',
      arguments: typeof args === 'string' || args === undefined ? (args as string) : JSON.stringify(args),
    },
  };
}

function makeToolResult(payload: unknown, raw = false): Message {
  return {
    id: 'update-schedule-result',
    role: 'tool',
    timestamp: 1000,
    tool_call_id: 'update-schedule-call',
    name: 'update_schedule',
    content: [{ type: 'text', text: raw ? String(payload) : JSON.stringify(payload) }],
  };
}

function renderView({
  args = {},
  result = null,
  status = 'completed',
}: {
  args?: Record<string, unknown> | string | undefined;
  result?: Message | null;
  status?: 'executing' | 'completed' | 'interrupted';
} = {}) {
  return render(
    <UpdateScheduleToolCallView
      toolCall={makeToolCall(args)}
      toolResult={result}
      executionStatus={status}
    />,
  );
}

describe('UpdateScheduleToolCallView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentChatId = 'chat-fallback';
  });

  it('renders nothing when the arguments are missing', () => {
    const { container } = renderView({ args: '' });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the arguments are invalid JSON', () => {
    const { container } = renderView({ args: '{bad json' });
    expect(container.firstChild).toBeNull();
  });

  it('falls back to args + default title while executing (no result yet)', () => {
    renderView({
      args: {
        name: 'Edited Task',
        description: 'Updated description',
        cron_expression: '0 9 * * 1-5',
        message: 'Updated prompt',
      },
      status: 'executing',
    });
    expect(screen.getByText('Edited Task')).toBeDefined();
    expect(screen.getByText('Updated description')).toBeDefined();
    expect(screen.getByText('Updated prompt')).toBeDefined();
    expect(document.querySelector('.schedule-spinner')).toBeTruthy();
  });

  it('uses the default title when neither job nor args provide a name', () => {
    renderView({ args: { cron_expression: '0 9 * * 1-5' } });
    expect(screen.getByText('Scheduled Task')).toBeDefined();
  });

  it('prefers the job payload over args on success and shows the success icon', () => {
    renderView({
      args: { name: 'Old Name', cron_expression: '0 0 * * *', message: 'old', description: 'old desc' },
      result: makeToolResult({
        success: true,
        job: {
          chat_id: 'chat-from-job',
          name: 'New Name',
          cron_expression: '0 9 * * 1-5',
          message: 'new prompt',
          description: 'new desc',
        },
      }),
    });
    expect(screen.getByText('New Name')).toBeDefined();
    expect(screen.getByText('new prompt')).toBeDefined();
    expect(screen.getByText('new desc')).toBeDefined();
    expect(document.querySelector('.schedule-status-success')).toBeTruthy();
  });

  it('navigates to the job chat schedules on click', () => {
    renderView({
      args: { name: 'Task' },
      result: makeToolResult({ success: true, job: { chat_id: 'chat-from-job' } }),
    });
    fireEvent.click(screen.getByTitle('Open target agent schedules'));
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/chat-from-job/settings/schedules');
  });

  it('renders the failure message and error icon when the update fails', () => {
    renderView({
      args: { name: 'Task' },
      result: makeToolResult({ success: false, message: 'Schedule not found' }),
    });
    expect(screen.getByText('Schedule not found')).toBeDefined();
    expect(document.querySelector('.schedule-status-error')).toBeTruthy();
  });

  it('treats an unparseable result as no result (error icon, args fallback)', () => {
    renderView({
      args: { name: 'Task' },
      result: makeToolResult('totally not json', true),
    });
    expect(screen.getByText('Task')).toBeDefined();
    expect(document.querySelector('.schedule-status-error')).toBeTruthy();
  });

  it('renders the interrupted notice', () => {
    renderView({ args: { name: 'Task' }, status: 'interrupted' });
    expect(
      screen.getByText('Interrupted before schedule update result was recorded.'),
    ).toBeDefined();
  });

  it('disables the link when neither job chat_id nor current chat id is available', () => {
    mocks.currentChatId = '';
    renderView({ args: { name: 'Task' } });
    const link = screen.getByTitle('Agent schedules unavailable') as HTMLButtonElement;
    expect(link.disabled).toBe(true);
  });
});
