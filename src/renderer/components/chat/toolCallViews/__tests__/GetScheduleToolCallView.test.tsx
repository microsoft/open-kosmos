// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ToolCall } from '@shared/types/chatTypes';
import { GetScheduleToolCallView } from '../GetScheduleToolCallView';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  currentChatId: 'chat-fallback',
  describeCronExpression: vi.fn(() => 'Weekdays at 09:00'),
}));

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: () => mocks.currentChatId,
}));

vi.mock('../../../../lib/scheduler/cronDescriptions', () => ({
  describeCronExpression: mocks.describeCronExpression,
}));

function makeToolCall(args: Record<string, unknown> | string = {}): ToolCall {
  return {
    id: 'get-schedule-call',
    type: 'function',
    function: {
      name: 'get_schedule',
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
    },
  };
}

function makeToolResult(payload: unknown, raw = false): Message {
  return {
    id: 'get-schedule-result',
    role: 'tool',
    timestamp: 1000,
    tool_call_id: 'get-schedule-call',
    name: 'get_schedule',
    content: [{ type: 'text', text: raw ? String(payload) : JSON.stringify(payload) }],
  };
}

function renderView({
  args = {},
  result = null,
  status = 'completed',
}: {
  args?: Record<string, unknown> | string;
  result?: Message | null;
  status?: 'executing' | 'completed' | 'interrupted';
} = {}) {
  return render(
    <GetScheduleToolCallView
      toolCall={makeToolCall(args)}
      toolResult={result}
      executionStatus={status}
    />,
  );
}

describe('GetScheduleToolCallView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentChatId = 'chat-fallback';
    mocks.describeCronExpression.mockReturnValue('Weekdays at 09:00');
  });

  it('renders executing state without a result summary and routes to the fallback chat', () => {
    renderView({ status: 'executing' });

    expect(screen.getByText('All Schedules')).toBeInTheDocument();
    expect(screen.queryByText(/Found/)).not.toBeInTheDocument();

    const link = screen.getByTitle('Open related agent schedules');
    expect(link).not.toBeDisabled();
    fireEvent.click(link);

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/chat-fallback/settings/schedules');
  });

  it('renders an agent-scoped successful cron schedule and opens the requested agent', () => {
    renderView({
      args: { chat_id: 'agent-requested' },
      result: makeToolResult({
        success: true,
        message: 'Found 1 scheduled task(s).',
        schedules: [
          {
            job_id: 'job-cron',
            name: 'Daily summary',
            schedule_type: 'cron',
            cron_expression: '0 9 * * 1-5',
            message: 'Summarize updates',
            chat_id: 'agent-requested',
            enabled: true,
          },
        ],
      }),
    });

    expect(screen.getByText('Agent Schedules')).toBeInTheDocument();
    expect(screen.getByText('Found 1 scheduled task(s).')).toBeInTheDocument();
    expect(screen.getByText(/Weekdays at 09:00/)).toHaveTextContent('Weekdays at 09:00 · Summarize updates');

    fireEvent.click(screen.getByTitle('Open related agent schedules'));

    expect(mocks.describeCronExpression).toHaveBeenCalledWith('0 9 * * 1-5');
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/agent-requested/settings/schedules');
  });

  it('renders one-time schedules, disabled token styles, and single-result routing', () => {
    renderView({
      result: makeToolResult({
        success: true,
        message: 'Found 2 scheduled task(s).',
        schedules: [
          {
            job_id: 'job-once-missing-run-at',
            name: 'Immediate note',
            schedule_type: 'once',
            message: 'Send now',
            chat_id: '',
            enabled: false,
          },
          {
            job_id: 'job-once',
            name: 'Launch note',
            schedule_type: 'once',
            run_at: '2026-06-20T10:00:00.000Z',
            message: 'Send later',
            chat_id: 'agent-single',
            enabled: false,
          },
        ],
      }),
    });

    expect(screen.getByText(/One-time schedule/)).toHaveTextContent('One-time schedule · Send now');
    expect(screen.getByText(/Send later/)).toHaveTextContent('One-time');

    const disabledBadges = screen.getAllByText('disabled');
    expect(disabledBadges).toHaveLength(2);
    for (const badge of disabledBadges) {
      expect(badge.style.color).toBe('var(--color-neutral-400)');
      expect(badge.style.backgroundColor).toBe('var(--color-neutral-100)');
    }

    fireEvent.click(screen.getByTitle('Open related agent schedules'));
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/agent-single/settings/schedules');
  });


  it('falls back to the raw one-time date when locale formatting throws', () => {
    const toLocaleStringSpy = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => {
      throw new Error('locale failed');
    });

    renderView({
      result: makeToolResult({
        success: true,
        message: 'Found 1 scheduled task(s).',
        schedules: [
          {
            job_id: 'job-raw-date',
            name: 'Raw date',
            schedule_type: 'once',
            run_at: 'not-a-locale-date',
            message: 'Use raw date',
            chat_id: 'agent-single',
            enabled: true,
          },
        ],
      }),
    });

    expect(screen.getByText(/Use raw date/)).toHaveTextContent('One-time not-a-locale-date · Use raw date');
    toLocaleStringSpy.mockRestore();
  });

  it('uses per-row links for multi-agent results and disables the header link', () => {
    renderView({
      result: makeToolResult({
        success: true,
        message: 'Found 2 scheduled task(s).',
        schedules: [
          {
            job_id: 'job-one',
            name: 'First agent',
            schedule_type: 'cron',
            cron_expression: '0 9 * * 1-5',
            message: 'First task',
            chat_id: 'agent-one',
            enabled: true,
          },
          {
            job_id: 'job-two',
            name: 'Second agent',
            schedule_type: 'cron',
            cron_expression: '0 10 * * 1-5',
            message: 'Second task',
            chat_id: 'agent-two',
            enabled: true,
          },
        ],
      }),
    });

    expect(screen.getByTitle('Open each schedule from its own agent row')).toBeDisabled();

    const rowLinks = screen.getAllByRole('button', { name: 'Open agent' });
    fireEvent.click(rowLinks[1]);

    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/agent-two/settings/schedules');
  });

  it('shows interrupted text and unavailable routing when no target exists', () => {
    mocks.currentChatId = undefined;
    renderView({ status: 'interrupted' });

    expect(screen.getByText('Interrupted before schedule query result was recorded.')).toBeInTheDocument();
    expect(screen.getByTitle('Agent schedules unavailable')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Open agent' })).not.toBeInTheDocument();
  });

  it('handles invalid arguments and invalid result JSON as a completed failure', () => {
    renderView({
      args: '{invalid',
      result: makeToolResult('{not-json', true),
    });

    expect(screen.getByText('All Schedules')).toBeInTheDocument();
    expect(screen.getByTitle('Open related agent schedules')).not.toBeDisabled();
    expect(document.querySelector('.schedule-status-error')).toBeInTheDocument();
    expect(document.querySelector('.schedule-card-fields')).toBeNull();
  });

  it('handles missing argument and result content as a completed failure', () => {
    const toolCall = makeToolCall('');
    const result = makeToolResult('', true);

    render(
      <GetScheduleToolCallView
        toolCall={toolCall}
        toolResult={result}
        executionStatus="completed"
      />,
    );

    expect(screen.getByText('All Schedules')).toBeInTheDocument();
    expect(document.querySelector('.schedule-status-error')).toBeInTheDocument();
    expect(screen.getByTitle('Open related agent schedules')).not.toBeDisabled();
  });
});
