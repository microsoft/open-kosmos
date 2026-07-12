// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ToolCall } from '@shared/types/chatTypes';
import { CreateScheduleToolCallView } from '../CreateScheduleToolCallView';

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
    id: 'create-schedule-call',
    type: 'function',
    function: {
      name: 'create_schedule',
      arguments: typeof args === 'string' || args === undefined ? (args as string) : JSON.stringify(args),
    },
  };
}

function makeToolResult(payload: unknown, raw = false): Message {
  return {
    id: 'create-schedule-result',
    role: 'tool',
    timestamp: 1000,
    tool_call_id: 'create-schedule-call',
    name: 'create_schedule',
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
    <CreateScheduleToolCallView
      toolCall={makeToolCall(args)}
      toolResult={result}
      executionStatus={status}
    />,
  );
}

describe('CreateScheduleToolCallView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentChatId = 'chat-fallback';
  });

  it('renders nothing when the arguments are missing', () => {
    const { container } = renderView({ args: '' });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the arguments are invalid JSON', () => {
    const { container } = renderView({ args: '{not json' });
    expect(container.firstChild).toBeNull();
  });

  it('falls back to the default title and the current chat id when no name/chat_id', () => {
    renderView({ args: { cron_expression: '0 9 * * 1-5' } });
    expect(screen.getByText('Scheduled Task')).toBeDefined();
    // Cron is described, prompt/description absent.
    expect(screen.getByText('Weekdays at 09:00')).toBeDefined();
  });

  it('renders all optional fields and the spinner while executing', () => {
    renderView({
      args: {
        name: 'Daily Standup',
        description: 'Posts the standup prompt',
        cron_expression: '0 9 * * 1-5',
        message: 'What did you do yesterday?',
        chat_id: 'chat-explicit',
      },
      status: 'executing',
    });
    expect(screen.getByText('Daily Standup')).toBeDefined();
    expect(screen.getByText('Posts the standup prompt')).toBeDefined();
    expect(screen.getByText('What did you do yesterday?')).toBeDefined();
    expect(document.querySelector('.schedule-spinner')).toBeTruthy();
  });

  it('shows the success icon when the result reports success', () => {
    renderView({
      args: { name: 'Task', cron_expression: '0 9 * * 1-5' },
      result: makeToolResult({ success: true }),
    });
    expect(document.querySelector('.schedule-status-success')).toBeTruthy();
  });

  it('shows the error icon when the result reports failure', () => {
    renderView({
      args: { name: 'Task' },
      result: makeToolResult({ success: false }),
    });
    expect(document.querySelector('.schedule-status-error')).toBeTruthy();
  });

  it('treats an unparseable result as no result (error icon)', () => {
    renderView({
      args: { name: 'Task' },
      result: makeToolResult('not json at all', true),
    });
    expect(document.querySelector('.schedule-status-error')).toBeTruthy();
  });

  it('renders the interrupted notice', () => {
    renderView({ args: { name: 'Task' }, status: 'interrupted' });
    expect(
      screen.getByText('Interrupted before schedule creation result was recorded.'),
    ).toBeDefined();
  });

  it('navigates to the explicit target chat schedules on click', () => {
    renderView({ args: { name: 'Task', chat_id: 'chat-explicit' } });
    fireEvent.click(screen.getByTitle('Open target agent schedules'));
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/chat-explicit/settings/schedules');
  });

  it('disables the link when neither chat_id nor current chat id is available', () => {
    mocks.currentChatId = '';
    renderView({ args: { name: 'Task' } });
    const link = screen.getByTitle('Agent schedules unavailable') as HTMLButtonElement;
    expect(link.disabled).toBe(true);
  });
});
