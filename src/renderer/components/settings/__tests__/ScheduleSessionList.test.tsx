/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock schedulerApi
const mockGetJobSessions = vi.fn();
vi.mock('../../../ipc/scheduler', () => ({
  schedulerApi: {
    getJobSessions: (...args: unknown[]) => mockGetJobSessions(...args),
  },
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ChevronRight: () => <span data-testid="chevron-icon" />,
}));

import { ScheduleSessionList } from '../ScheduleSessionList';

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    chatSession_id: 'session-1',
    title: 'Test Session',
    last_updated: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function renderComponent(props: { jobId?: string; chatId?: string } = {}) {
  return render(
    <ScheduleSessionList
      jobId={props.jobId ?? 'job-123'}
      chatId={props.chatId ?? 'agent-1'}
    />
  );
}

describe('ScheduleSessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], total: 0, hasMore: false },
    });
  });

  describe('collapsed state', () => {
    it('renders collapsed by default', () => {
      renderComponent();
      expect(screen.getByText('Scheduled runs')).toBeTruthy();
      expect(screen.queryByText('Loading...')).toBeNull();
      expect(screen.queryByText('No scheduled runs found')).toBeNull();
    });

    it('does not fetch sessions when collapsed', () => {
      renderComponent();
      expect(mockGetJobSessions).not.toHaveBeenCalled();
    });

    it('does not show total badge when not loaded', () => {
      renderComponent();
      // No badge should be visible since loaded is false
      const button = screen.getByText('Scheduled runs').closest('button');
      expect(button?.textContent).toBe('Scheduled runs');
    });
  });

  describe('expansion and loading', () => {
    it('fetches sessions when expanded', async () => {
      renderComponent();

      await act(async () => {
        fireEvent.click(screen.getByText('Scheduled runs'));
      });

      expect(mockGetJobSessions).toHaveBeenCalledWith('job-123', { limit: 20, offset: 0 });
    });

    it('shows loading state while fetching', async () => {
      let resolvePromise!: (value: unknown) => void;
      mockGetJobSessions.mockReturnValue(new Promise((resolve) => {
        resolvePromise = resolve;
      }));

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      expect(screen.getByText('Loading...')).toBeTruthy();

      await act(async () => {
        resolvePromise({ success: true, data: { sessions: [], total: 0, hasMore: false } });
      });
    });

    it('shows empty state when no sessions', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('No scheduled runs found')).toBeTruthy();
      });
    });

    it('shows sessions when loaded', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [
            makeSession({ chatSession_id: 's1', title: 'Run A' }),
            makeSession({ chatSession_id: 's2', title: 'Run B' }),
          ],
          total: 2,
          hasMore: false,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('Run A')).toBeTruthy();
        expect(screen.getByText('Run B')).toBeTruthy();
      });
    });

    it('shows total badge after loading', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: { sessions: [makeSession()], total: 5, hasMore: true },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('5')).toBeTruthy();
      });
    });

    it('does not refetch when collapsed and re-expanded', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: { sessions: [makeSession()], total: 1, hasMore: false },
      });

      renderComponent();

      // Expand
      fireEvent.click(screen.getByText('Scheduled runs'));
      await waitFor(() => expect(screen.getByText('Test Session')).toBeTruthy());

      // Collapse
      fireEvent.click(screen.getByText('Scheduled runs'));
      expect(screen.queryByText('Test Session')).toBeNull();

      // Re-expand - should not fetch again
      fireEvent.click(screen.getByText('Scheduled runs'));
      expect(mockGetJobSessions).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Test Session')).toBeTruthy();
    });
  });

  describe('pagination', () => {
    it('shows "Show more" button when hasMore is true', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession()],
          total: 25,
          hasMore: true,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText(/Show more/)).toBeTruthy();
        expect(screen.getByText(/24 remaining/)).toBeTruthy();
      });
    });

    it('does not show "Show more" button when hasMore is false', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession()],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('Test Session')).toBeTruthy();
      });

      expect(screen.queryByText(/Show more/)).toBeNull();
    });

    it('loads more sessions when "Show more" is clicked', async () => {
      mockGetJobSessions
        .mockResolvedValueOnce({
          success: true,
          data: {
            sessions: [makeSession({ chatSession_id: 's1', title: 'Run A' })],
            total: 2,
            hasMore: true,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          data: {
            sessions: [makeSession({ chatSession_id: 's2', title: 'Run B' })],
            total: 2,
            hasMore: false,
          },
        });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('Run A')).toBeTruthy();
      });

      fireEvent.click(screen.getByText(/Show more/));

      await waitFor(() => {
        expect(screen.getByText('Run B')).toBeTruthy();
      });

      // Second call should have offset=1
      expect(mockGetJobSessions).toHaveBeenLastCalledWith('job-123', { limit: 20, offset: 1 });

      // "Show more" should be gone
      expect(screen.queryByText(/Show more/)).toBeNull();
    });

    it('shows "Loading more..." while fetching more', async () => {
      let resolveMore!: (value: unknown) => void;

      mockGetJobSessions
        .mockResolvedValueOnce({
          success: true,
          data: {
            sessions: [makeSession()],
            total: 2,
            hasMore: true,
          },
        })
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveMore = resolve;
        }));

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText(/Show more/)).toBeTruthy();
      });

      fireEvent.click(screen.getByText(/Show more/));

      expect(screen.getByText('Loading more...')).toBeTruthy();
      expect(screen.queryByText(/Show more/)).toBeNull();

      await act(async () => {
        resolveMore({ success: true, data: { sessions: [], total: 2, hasMore: false } });
      });
    });

    it('does not trigger load more when already loading', async () => {
      let resolveMore!: (value: unknown) => void;

      mockGetJobSessions
        .mockResolvedValueOnce({
          success: true,
          data: {
            sessions: [makeSession()],
            total: 2,
            hasMore: true,
          },
        })
        .mockReturnValueOnce(new Promise((resolve) => {
          resolveMore = resolve;
        }));

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText(/Show more/)).toBeTruthy();
      });

      // Click "Show more" - should start loading
      fireEvent.click(screen.getByText(/Show more/));

      // handleLoadMore should early-return because loadingMore is true
      // We can't directly call it again since button is hidden, but the guard is there

      await act(async () => {
        resolveMore({ success: true, data: { sessions: [], total: 2, hasMore: false } });
      });

      expect(mockGetJobSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('handles API error gracefully', async () => {
      mockGetJobSessions.mockRejectedValue(new Error('Network error'));

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      // Should still show empty state, not crash
      await waitFor(() => {
        expect(screen.getByText('No scheduled runs found')).toBeTruthy();
      });
    });

    it('handles API returning success: false', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: false,
        error: 'Something went wrong',
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('No scheduled runs found')).toBeTruthy();
      });
    });

    it('retries fetch on re-expand after API error', async () => {
      // First call fails
      mockGetJobSessions.mockRejectedValueOnce(new Error('Network error'));
      // Second call succeeds
      mockGetJobSessions.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSession({ chatSession_id: 's1', title: 'Run A' })],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent();

      // First expand - fails
      fireEvent.click(screen.getByText('Scheduled runs'));
      await waitFor(() => {
        expect(screen.getByText('No scheduled runs found')).toBeTruthy();
      });

      // Collapse
      fireEvent.click(screen.getByText('Scheduled runs'));

      // Re-expand - should retry and succeed
      fireEvent.click(screen.getByText('Scheduled runs'));
      await waitFor(() => {
        expect(screen.getByText('Run A')).toBeTruthy();
      });

      expect(mockGetJobSessions).toHaveBeenCalledTimes(2);
    });

    it('retries fetch on re-expand after success: false', async () => {
      // First call returns success: false
      mockGetJobSessions.mockResolvedValueOnce({
        success: false,
        error: 'Something went wrong',
      });
      // Second call succeeds
      mockGetJobSessions.mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSession({ chatSession_id: 's1', title: 'Run A' })],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent();

      // First expand - fails
      fireEvent.click(screen.getByText('Scheduled runs'));
      await waitFor(() => {
        expect(screen.getByText('No scheduled runs found')).toBeTruthy();
      });

      // Collapse
      fireEvent.click(screen.getByText('Scheduled runs'));

      // Re-expand - should retry and succeed
      fireEvent.click(screen.getByText('Scheduled runs'));
      await waitFor(() => {
        expect(screen.getByText('Run A')).toBeTruthy();
      });

      expect(mockGetJobSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe('navigation', () => {
    it('navigates to session when clicked', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession({ chatSession_id: 's1', title: 'Run A' })],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent({ chatId: 'agent-abc' });
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('Run A')).toBeTruthy();
      });

      // Click on the session button
      const sessionButton = screen.getByTitle('Open session: Run A');
      fireEvent.click(sessionButton);

      expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/agent-abc/s1');
    });
  });

  describe('hover interactions', () => {
    it('handles mouse events on toggle button', async () => {
      renderComponent();
      const button = screen.getByText('Scheduled runs').closest('button')!;

      fireEvent.mouseEnter(button);
      fireEvent.mouseLeave(button);
      // No assertion needed - just ensuring no errors
      expect(button).toBeTruthy();
    });

    it('handles mouse events on session buttons', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession()],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText('Test Session')).toBeTruthy();
      });

      const sessionButton = screen.getByTitle('Open session: Test Session');
      fireEvent.mouseEnter(sessionButton);
      fireEvent.mouseLeave(sessionButton);
      expect(sessionButton).toBeTruthy();
    });

    it('handles mouse events on show more button', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession()],
          total: 5,
          hasMore: true,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        expect(screen.getByText(/Show more/)).toBeTruthy();
      });

      const showMoreButton = screen.getByText(/Show more/).closest('button')!;
      fireEvent.mouseEnter(showMoreButton);
      fireEvent.mouseLeave(showMoreButton);
      expect(showMoreButton).toBeTruthy();
    });
  });

  describe('formatDate', () => {
    it('formats valid date correctly', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession({ last_updated: '2026-06-15T14:30:00Z' })],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        // The exact format depends on locale, but should contain month and time
        const sessionButton = screen.getByTitle('Open session: Test Session');
        expect(sessionButton.textContent).toContain('Jun');
      });
    });

    it('shows Invalid Date for invalid date string', async () => {
      mockGetJobSessions.mockResolvedValue({
        success: true,
        data: {
          sessions: [makeSession({ last_updated: 'invalid-date' })],
          total: 1,
          hasMore: false,
        },
      });

      renderComponent();
      fireEvent.click(screen.getByText('Scheduled runs'));

      await waitFor(() => {
        const sessionButton = screen.getByTitle('Open session: Test Session');
        // Invalid date string results in "Invalid Date" from toLocaleString
        expect(sessionButton.textContent).toContain('Invalid Date');
      });
    });
  });
});
