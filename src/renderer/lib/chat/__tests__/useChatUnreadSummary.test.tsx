/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import { useChatUnreadSummary } from '../useChatUnreadSummary';

const mockGetChatUnreadSummary = vi.fn();
const mockOnChatUnreadSummaryChanged = vi.fn();

type UnreadSummaryChangedPayload = {
  alias: string;
  summary: {
    chatId: string;
    userUnreadCount: number;
    scheduledUnreadCount: number;
    updatedAt: string;
  };
};

let unreadSummaryChangedListener:
  | ((payload: UnreadSummaryChangedPayload) => void)
  | undefined;

(window as any).electronAPI = {
  profile: {
    getChatUnreadSummary: mockGetChatUnreadSummary,
    onChatUnreadSummaryChanged: mockOnChatUnreadSummaryChanged,
  },
};

function HookHarness() {
  const summary = useChatUnreadSummary('chat-1', 'test-user');

  return (
    <div>
      <span data-testid="unread-user-count">{summary.userUnreadCount}</span>
      <span data-testid="unread-scheduled-count">{summary.scheduledUnreadCount}</span>
      <span data-testid="unread-updated-at">{summary.updatedAt || 'none'}</span>
    </div>
  );
}

describe('useChatUnreadSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unreadSummaryChangedListener = undefined;
    mockOnChatUnreadSummaryChanged.mockImplementation((listener) => {
      unreadSummaryChangedListener = listener;
      return vi.fn();
    });
  });

  it('keeps a newer live unread update when the initial fetch resolves stale data later', async () => {
    let resolveInitialFetch:
      | ((value: {
          success: boolean;
          data: {
            chatId: string;
            userUnreadCount: number;
            scheduledUnreadCount: number;
            updatedAt: string;
          };
        }) => void)
      | undefined;

    mockGetChatUnreadSummary.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInitialFetch = resolve;
        }),
    );

    render(<HookHarness />);

    await waitFor(() => {
      expect(mockOnChatUnreadSummaryChanged).toHaveBeenCalled();
    });

    act(() => {
      unreadSummaryChangedListener?.({
        alias: 'test-user',
        summary: {
          chatId: 'chat-1',
          userUnreadCount: 5,
          scheduledUnreadCount: 1,
          updatedAt: '2026-03-20T10:01:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('unread-user-count')).toHaveTextContent('5');
      expect(screen.getByTestId('unread-scheduled-count')).toHaveTextContent('1');
    });

    await act(async () => {
      resolveInitialFetch?.({
        success: true,
        data: {
          chatId: 'chat-1',
          userUnreadCount: 1,
          scheduledUnreadCount: 0,
          updatedAt: '2026-03-20T10:00:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('unread-user-count')).toHaveTextContent('5');
      expect(screen.getByTestId('unread-scheduled-count')).toHaveTextContent('1');
      expect(screen.getByTestId('unread-updated-at')).toHaveTextContent('2026-03-20T10:01:00.000Z');
    });
  });
});