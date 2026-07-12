/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SchedulerJob } from '@shared/ipc/scheduler';

import GeneratedScheduleCards from '../GeneratedScheduleCards';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  listJobs: vi.fn(),
  runJobNow: vi.fn(),
  showToast: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  describeCronExpression: vi.fn(),
  showScheduledRunStartedToast: vi.fn(),
  effectiveShow: vi.fn(),
  currentChatId: 'chat-current' as string | undefined,
}));

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../../../ipc/scheduler', async () => ({
  schedulerApi: {
    listJobs: () => mocks.listJobs(),
    runJobNow: (...args: unknown[]) => mocks.runJobNow(...args),
  },
}));

vi.mock('../../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useCurrentChatId: () => mocks.currentChatId,
}));

vi.mock('../../../../lib/scheduler/cronDescriptions', async () => ({
  describeCronExpression: (...args: unknown[]) => mocks.describeCronExpression(...args),
}));

vi.mock('../../../../lib/scheduler/showScheduledRunStartedToast', async () => ({
  showScheduledRunStartedToast: (...args: unknown[]) => mocks.showScheduledRunStartedToast(...args),
}));

vi.mock('../../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showToast: mocks.showToast,
    showSuccess: mocks.showSuccess,
    showError: mocks.showError,
  }),
}));

vi.mock('../../chat-side.atom', async () => ({
  ScheduleSidepaneAtom: {
    useChange: () => ({
      effectiveShow: mocks.effectiveShow,
    }),
  },
}));

const makeJob = (overrides: Partial<SchedulerJob> & Pick<SchedulerJob, 'id'>): SchedulerJob => ({
  id: overrides.id,
  name: overrides.name ?? `Job ${overrides.id}`,
  description: overrides.description ?? 'Default description',
  scheduleType: overrides.scheduleType ?? 'cron',
  cronExpression: Object.prototype.hasOwnProperty.call(overrides, 'cronExpression')
    ? overrides.cronExpression
    : '0 9 * * 1-5',
  runAt: Object.prototype.hasOwnProperty.call(overrides, 'runAt') ? overrides.runAt : undefined,
  enabled: overrides.enabled ?? true,
  chat_id: overrides.chat_id ?? 'chat-from-job',
  message: overrides.message ?? 'Run the scheduled task.',
  status: overrides.status ?? 'pending',
  lastRunAt: overrides.lastRunAt,
});

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

const getReactProps = (element: Element): Record<string, unknown> => {
  const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
  if (!propsKey) {
    throw new Error('React props were not found on the element');
  }
  return (element as unknown as Record<string, Record<string, unknown>>)[propsKey];
};

describe('GeneratedScheduleCards coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentChatId = 'chat-current';
    mocks.describeCronExpression.mockReturnValue('Weekdays at 09:00');
    mocks.listJobs.mockResolvedValue({ success: true, data: [] });
    mocks.runJobNow.mockResolvedValue({ success: true, data: { chatSessionId: 'session-1' } });
  });

  it('renders nothing and skips loading when schedule ids normalize to an empty list', () => {
    const { container } = render(<GeneratedScheduleCards scheduleIds={[' ', '', '\n']} />);

    expect(container.firstChild).toBeNull();
    expect(mocks.listJobs).not.toHaveBeenCalled();
  });

  it('deduplicates trimmed ids, renders cron and once summaries, and ignores unrelated jobs', async () => {
    const validRunAt = '2026-06-29T09:30:00.000Z';
    mocks.listJobs.mockResolvedValueOnce({
      success: true,
      data: [
        makeJob({
          id: 'cron-id',
          name: 'Cron briefing',
          description: 'Morning briefing',
          scheduleType: 'cron',
          cronExpression: '0 9 * * 1-5',
          enabled: true,
          lastRunAt: '2026-06-28T09:00:00.000Z',
          chat_id: 'chat-cron',
        }),
        makeJob({
          id: 'once-id',
          name: 'One-time follow-up',
          description: '',
          scheduleType: 'once',
          runAt: validRunAt,
          cronExpression: undefined,
          enabled: false,
          chat_id: 'chat-once',
        }),
        makeJob({ id: 'unrelated-id', name: 'Hidden job' }),
      ],
    });

    render(<GeneratedScheduleCards scheduleIds={[' cron-id ', 'once-id', 'cron-id', '']} />);

    expect(await screen.findByText('Cron briefing')).toBeInTheDocument();
    expect(screen.getByText('One-time follow-up')).toBeInTheDocument();
    expect(screen.queryByText('Hidden job')).not.toBeInTheDocument();
    expect(screen.getAllByText('cron-id')).toHaveLength(1);
    expect(screen.getByText('Weekdays at 09:00')).toBeInTheDocument();
    expect(screen.getByText(/Jun 29, 2026|29 Jun 2026/)).toBeInTheDocument();
    expect(mocks.describeCronExpression).toHaveBeenCalledWith('0 9 * * 1-5');
  });

  it('falls back for missing jobs, invalid one-time dates, and absent cron expressions', async () => {
    mocks.listJobs.mockResolvedValueOnce({
      success: true,
      data: [
        makeJob({
          id: 'bad-once',
          name: '',
          scheduleType: 'once',
          runAt: 'not-a-date',
          cronExpression: undefined,
        }),
        makeJob({
          id: 'cron-without-expression',
          name: 'Cron without expression',
          scheduleType: 'cron',
          cronExpression: undefined,
        }),
        makeJob({
          id: 'once-without-run-at',
          name: 'Once without runAt',
          scheduleType: 'once',
          runAt: undefined,
          cronExpression: undefined,
        }),
      ],
    });

    render(
      <GeneratedScheduleCards
        scheduleIds={['missing-id', 'bad-once', 'cron-without-expression', 'once-without-run-at']}
      />,
    );

    expect(await screen.findByText('Cron without expression')).toBeInTheDocument();
    expect(screen.getAllByText('Scheduled task').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Schedule found in response')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Run now' })[0]).toBeDisabled();
    expect(mocks.describeCronExpression).not.toHaveBeenCalled();
  });

  it('clears loading without setting jobs when listJobs returns unsuccessful or empty responses', async () => {
    mocks.listJobs.mockResolvedValueOnce({ success: false, error: 'No access' });
    const { rerender } = render(<GeneratedScheduleCards scheduleIds={['failed-id']} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
    });
    expect(screen.getByText('Scheduled task')).toBeInTheDocument();

    mocks.listJobs.mockResolvedValueOnce(undefined);
    rerender(<GeneratedScheduleCards scheduleIds={['undefined-response']} />);

    await waitFor(() => {
      expect(screen.getByText('undefined-response')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Run now' })).toBeDisabled();
  });

  it('does not update state after unmounting before listJobs resolves', async () => {
    const deferred = createDeferred<{ success: boolean; data: SchedulerJob[] }>();
    mocks.listJobs.mockReturnValueOnce(deferred.promise);

    const { unmount } = render(<GeneratedScheduleCards scheduleIds={['slow-id']} />);
    unmount();

    await act(async () => {
      deferred.resolve({ success: true, data: [makeJob({ id: 'slow-id' })] });
      await deferred.promise;
    });

    expect(mocks.listJobs).toHaveBeenCalledTimes(1);
  });

  it('runs a schedule successfully with the job chat_id and opens the schedule sidepane', async () => {
    mocks.listJobs.mockResolvedValueOnce({
      success: true,
      data: [makeJob({ id: 'run-id', chat_id: 'chat-from-scheduler' })],
    });
    mocks.runJobNow.mockResolvedValueOnce({ success: true, data: { chatSessionId: 'session-2' } });

    render(<GeneratedScheduleCards scheduleIds={['run-id']} />);

    const runButtons = await screen.findAllByRole('button', { name: 'Run now' });
    fireEvent.click(runButtons[0]);

    await waitFor(() => {
      expect(mocks.runJobNow).toHaveBeenCalledWith('run-id');
      expect(mocks.showScheduledRunStartedToast).toHaveBeenCalledWith(expect.objectContaining({
        result: { chatSessionId: 'session-2' },
        chatId: 'chat-from-scheduler',
        navigate: mocks.navigate,
        showToast: mocks.showToast,
        showSuccess: mocks.showSuccess,
      }));
      expect(mocks.effectiveShow).toHaveBeenCalled();
    });
  });

  it('shows explicit and fallback errors when running a schedule fails without throwing', async () => {
    mocks.listJobs.mockResolvedValue({
      success: true,
      data: [
        makeJob({ id: 'error-id', name: 'Error job' }),
        makeJob({ id: 'unknown-error-id', name: 'Unknown error job' }),
      ],
    });
    mocks.runJobNow
      .mockResolvedValueOnce({ success: false, error: 'Backend rejected the run' })
      .mockResolvedValueOnce(undefined);

    render(<GeneratedScheduleCards scheduleIds={['error-id', 'unknown-error-id']} />);

    const runButtons = await screen.findAllByRole('button', { name: 'Run now' });
    fireEvent.click(runButtons[0]);
    await waitFor(() => {
      expect(mocks.showError).toHaveBeenCalledWith('Failed to run schedule: Backend rejected the run');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[1]);
    await waitFor(() => {
      expect(mocks.showError).toHaveBeenCalledWith('Failed to run schedule: Unknown error');
    });
  });

  it('shows thrown Error and non-Error messages when runJobNow rejects', async () => {
    mocks.listJobs.mockResolvedValue({
      success: true,
      data: [
        makeJob({ id: 'throws-error', name: 'Throws error' }),
        makeJob({ id: 'throws-string', name: 'Throws string' }),
      ],
    });
    mocks.runJobNow
      .mockRejectedValueOnce(new Error('Network down'))
      .mockRejectedValueOnce('string failure');

    render(<GeneratedScheduleCards scheduleIds={['throws-error', 'throws-string']} />);

    const runButtons = await screen.findAllByRole('button', { name: 'Run now' });
    fireEvent.click(runButtons[0]);
    await waitFor(() => {
      expect(mocks.showError).toHaveBeenCalledWith('Failed to run schedule: Network down');
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Run now' })[1]);
    await waitFor(() => {
      expect(mocks.showError).toHaveBeenCalledWith('Failed to run schedule: string failure');
    });
  });

  it('keeps the second running state when a different job finishes first', async () => {
    const firstRun = createDeferred<{ success: boolean; data: Record<string, never> }>();
    const secondRun = createDeferred<{ success: boolean; data: Record<string, never> }>();
    mocks.listJobs.mockResolvedValueOnce({
      success: true,
      data: [
        makeJob({ id: 'first-job', name: 'First job' }),
        makeJob({ id: 'second-job', name: 'Second job' }),
      ],
    });
    mocks.runJobNow
      .mockReturnValueOnce(firstRun.promise)
      .mockReturnValueOnce(secondRun.promise);

    render(<GeneratedScheduleCards scheduleIds={['first-job', 'second-job']} />);

    const runButtons = await screen.findAllByRole('button', { name: 'Run now' });
    fireEvent.click(runButtons[0]);
    await waitFor(() => {
      expect(runButtons[0]).toBeDisabled();
    });

    fireEvent.click(runButtons[1]);
    await waitFor(() => {
      expect(runButtons[0]).not.toBeDisabled();
    });

    await act(async () => {
      firstRun.resolve({ success: true, data: {} });
      await firstRun.promise;
    });

    expect(runButtons[0]).not.toBeDisabled();
    expect(runButtons[1]).toBeDisabled();

    await act(async () => {
      secondRun.resolve({ success: true, data: {} });
      await secondRun.promise;
    });

    expect(runButtons[1]).not.toBeDisabled();
  });

  it('navigates to schedule management when the current chat id exists', async () => {
    render(<GeneratedScheduleCards scheduleIds={['manage-id']} />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/chat/chat-current/settings/schedules');
  });

  it('disables management and reports an error when no current chat id exists', () => {
    mocks.currentChatId = '';

    render(<GeneratedScheduleCards scheduleIds={['no-chat-id']} />);

    const manageButton = screen.getByRole('button', { name: 'Manage' });
    expect(manageButton).toBeDisabled();

    const props = getReactProps(manageButton);
    act(() => {
      (props.onClick as () => void)();
    });

    expect(mocks.showError).toHaveBeenCalledWith('Unable to open schedules for this chat.');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
