/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScheduleCleanupSection } from '../ScheduleCleanupSection';
import { schedulerApi } from '../../../ipc/scheduler';

vi.mock('../../../ipc/scheduler', () => ({
  schedulerApi: {
    cleanupAllSessionHistory: vi.fn(),
  },
}));

vi.mock('../../../styles/ContentView.css', () => ({}));
vi.mock('../../../styles/ToolbarSettingsView.css', () => ({}));

const mockCleanupAllSessionHistory = vi.mocked(schedulerApi.cleanupAllSessionHistory);

async function clickAndFlush(button: HTMLElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
  });
}

describe('ScheduleCleanupSection', () => {
  beforeEach(() => {
    mockCleanupAllSessionHistory.mockClear();
  });

  it('renders cleanup button and description', () => {
    render(<ScheduleCleanupSection chatId="chat_test" />);
    expect(screen.getByText('Clean up')).toBeDefined();
    expect(screen.getByText('Clean up old scheduled runs')).toBeDefined();
  });

  it('button is disabled when disabled prop is true', () => {
    render(<ScheduleCleanupSection disabled={true} chatId="chat_test" />);
    const button = screen.getByRole('button');
    expect(button).toHaveProperty('disabled', true);
  });

  it('calls API with includeOrphans and shows success', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: true, data: { totalDeleted: 5, orphansDeleted: 2, jobsProcessed: 3, errors: 0 } })
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(mockCleanupAllSessionHistory).toHaveBeenCalledWith({ includeOrphans: true, chatId: 'chat_test' });
    expect(container.textContent).toContain('Cleanup completed successfully');
    expect(container.textContent).toContain('Deleted 5 old sessions');
    expect(container.textContent).toContain('including 2 from deleted schedules');
    expect(container.textContent).toContain('Processed 3 schedules');
  });

  it('uses the latest agent id after rerender', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: true, data: { totalDeleted: 0, orphansDeleted: 0, jobsProcessed: 0, errors: 0 } })
    );

    const { rerender } = render(<ScheduleCleanupSection chatId="chat_old" />);
    rerender(<ScheduleCleanupSection chatId="chat_new" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(mockCleanupAllSessionHistory).toHaveBeenCalledWith({ includeOrphans: true, chatId: 'chat_new' });
  });

  it('shows singular text and no orphan info when counts are 1/0', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: true, data: { totalDeleted: 1, orphansDeleted: 0, jobsProcessed: 1, errors: 0 } })
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Deleted 1 old session');
    expect(container.textContent).not.toContain('from deleted schedules');
    expect(container.textContent).toContain('Processed 1 schedule.');
  });

  it('shows error from API response', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: false, error: 'Something went wrong' })
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Cleanup failed');
    expect(container.textContent).toContain('Something went wrong');
  });

  it('shows default error when no error field in response', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: false })
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Cleanup failed');
    expect(container.textContent).toContain('Failed to cleanup scheduled runs');
  });

  it('shows error.message on thrown Error', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.reject(new Error('Network error'))
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Cleanup failed');
    expect(container.textContent).toContain('Network error');
  });

  it('shows generic error on thrown non-Error', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.reject('string error')
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Cleanup failed');
    expect(container.textContent).toContain('Failed to cleanup scheduled runs');
  });

  it('shows loading state while cleaning', async () => {
    let resolve!: (v: any) => void;
    mockCleanupAllSessionHistory.mockImplementation(() => new Promise(r => { resolve = r; }));

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await act(async () => {
      screen.getByRole('button').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Cleaning up...');

    await act(async () => {
      resolve({ success: true, data: { totalDeleted: 0, orphansDeleted: 0, jobsProcessed: 0, errors: 0 } });
      await new Promise(r => setTimeout(r, 0));
    });

    expect(container.textContent).not.toContain('Cleaning up...');
    expect(container.textContent).toContain('Clean up');
  });

  it('does not fire when disabled', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() => Promise.resolve({ success: true, data: { totalDeleted: 0, jobsProcessed: 0, orphansDeleted: 0, errors: 0 } }));

    render(<ScheduleCleanupSection disabled={true} chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(mockCleanupAllSessionHistory).not.toHaveBeenCalled();
  });

  it('hover changes button style when enabled', () => {
    render(<ScheduleCleanupSection chatId="chat_test" />);
    const button = screen.getByRole('button');
    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe('var(--color-neutral-50)');
    fireEvent.mouseLeave(button);
    expect(button.style.backgroundColor).toBe('var(--color-white)');
  });

  it('hover does not change style when disabled', () => {
    render(<ScheduleCleanupSection disabled={true} chatId="chat_test" />);
    const button = screen.getByRole('button');
    const originalBg = button.style.backgroundColor;
    fireEvent.mouseEnter(button);
    expect(button.style.backgroundColor).toBe(originalBg);
  });
});

describe('ScheduleCleanupSection — partial failure', () => {
  beforeEach(() => {
    mockCleanupAllSessionHistory.mockClear();
  });

  it('shows warning state when cleanup has errors', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: false, data: { totalDeleted: 3, orphansDeleted: 1, jobsProcessed: 2, errors: 2 }, error: '2 deletion(s) failed' })
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Cleanup completed with errors');
    expect(container.textContent).toContain('2 deletion(s) failed');
    expect(container.textContent).toContain('Deleted 3 old sessions');
  });

  it('shows success state when cleanup has zero errors', async () => {
    mockCleanupAllSessionHistory.mockImplementation(() =>
      Promise.resolve({ success: true, data: { totalDeleted: 2, orphansDeleted: 0, jobsProcessed: 1, errors: 0 } })
    );

    const { container } = render(<ScheduleCleanupSection chatId="chat_test" />);
    await clickAndFlush(screen.getByRole('button'));

    expect(container.textContent).toContain('Cleanup completed successfully');
    expect(container.textContent).not.toContain('deletion(s) failed');
  });
});
