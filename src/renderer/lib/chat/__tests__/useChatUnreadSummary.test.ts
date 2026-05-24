/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useChatUnreadSummaryMap,
  useChatUnreadSummary,
  formatUnreadBadgeCount,
} from '../useChatUnreadSummary';

function makeSummary(chatId: string, updatedAt = '2024-01-01T00:00:00Z', unread = 1) {
  return { chatId, userUnreadCount: unread, scheduledUnreadCount: 0, updatedAt };
}

function setupWindow(overrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      profile: {
        getChatUnreadSummary: vi.fn(async () => ({ success: true, data: makeSummary('chat-1') })),
        onChatUnreadSummaryChanged: vi.fn(() => vi.fn()),
        ...overrides,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupWindow();
});

describe('formatUnreadBadgeCount', () => {
  it('returns string count for <= 99', () => {
    expect(formatUnreadBadgeCount(5)).toBe('5');
    expect(formatUnreadBadgeCount(99)).toBe('99');
  });

  it('returns "99+" for > 99', () => {
    expect(formatUnreadBadgeCount(100)).toBe('99+');
    expect(formatUnreadBadgeCount(999)).toBe('99+');
  });
});

describe('useChatUnreadSummaryMap', () => {
  it('returns empty map when alias is null', () => {
    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], null));
    expect(result.current).toEqual({});
  });

  it('returns empty map when chatIds is empty', () => {
    const { result } = renderHook(() => useChatUnreadSummaryMap([], 'user1'));
    expect(result.current).toEqual({});
  });

  it('returns empty map when getChatUnreadSummary is not available', () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true, writable: true,
      value: { profile: {} },
    });
    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    expect(result.current).toEqual({});
  });

  it('fetches and populates summary map', async () => {
    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    // Let effects run
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current['chat-1']).toBeDefined();
    expect(result.current['chat-1'].chatId).toBe('chat-1');
  });

  it('returns empty summary when fetch result has no data', async () => {
    setupWindow({
      getChatUnreadSummary: vi.fn(async () => ({ success: false })),
      onChatUnreadSummaryChanged: vi.fn(() => vi.fn()),
    });
    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    // Falls back to buildEmptySummary
    expect(result.current['chat-1']).toBeDefined();
  });

  it('handles fetch exception gracefully (cancelled branch)', async () => {
    setupWindow({
      getChatUnreadSummary: vi.fn(async () => { throw new Error('network fail'); }),
      onChatUnreadSummaryChanged: vi.fn(() => vi.fn()),
    });
    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    // Exception caught, falls back to empty summary
    expect(result.current['chat-1']).toBeDefined();
  });

  it('subscribes to onChatUnreadSummaryChanged and updates on matching event', async () => {
    let capturedCallback: ((data: any) => void) | null = null;
    setupWindow({
      getChatUnreadSummary: vi.fn(async () => ({ success: true, data: makeSummary('chat-1') })),
      onChatUnreadSummaryChanged: vi.fn((cb: any) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Fire the callback with matching alias + chatId
    act(() => {
      capturedCallback?.({
        alias: 'user1',
        summary: makeSummary('chat-1', '2025-01-01T00:00:00Z', 5),
      });
    });

    expect(result.current['chat-1'].userUnreadCount).toBe(5);
  });

  it('ignores onChatUnreadSummaryChanged events for different alias', async () => {
    let capturedCallback: ((data: any) => void) | null = null;
    setupWindow({
      getChatUnreadSummary: vi.fn(async () => ({ success: true, data: makeSummary('chat-1') })),
      onChatUnreadSummaryChanged: vi.fn((cb: any) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const countBefore = result.current['chat-1']?.userUnreadCount;

    act(() => {
      capturedCallback?.({
        alias: 'other-user',
        summary: makeSummary('chat-1', '2025-01-01T00:00:00Z', 99),
      });
    });

    expect(result.current['chat-1']?.userUnreadCount).toBe(countBefore);
  });

  it('ignores onChatUnreadSummaryChanged events for unknown chatId', async () => {
    let capturedCallback: ((data: any) => void) | null = null;
    setupWindow({
      getChatUnreadSummary: vi.fn(async () => ({ success: true, data: makeSummary('chat-1') })),
      onChatUnreadSummaryChanged: vi.fn((cb: any) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const countBefore = result.current['chat-1']?.userUnreadCount;

    act(() => {
      capturedCallback?.({
        alias: 'user1',
        summary: makeSummary('other-chat', '2025-01-01T00:00:00Z', 99),
      });
    });

    expect(result.current['chat-1']?.userUnreadCount).toBe(countBefore);
  });

  it('handles cancelled fetch (unmount before promise resolves)', async () => {
    let resolve!: () => void;
    setupWindow({
      getChatUnreadSummary: vi.fn(() => new Promise((r) => { resolve = () => r({ success: true, data: makeSummary('chat-1') }); })),
      onChatUnreadSummaryChanged: vi.fn(() => vi.fn()),
    });
    const { unmount } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    unmount(); // cancel before resolve
    // Now resolve — should be a no-op (cancelled = true)
    act(() => { resolve(); });
    // No assertion needed — just ensuring no errors thrown
  });
});

describe('useChatUnreadSummary', () => {
  it('returns empty summary when chatId is null', () => {
    const { result } = renderHook(() => useChatUnreadSummary(null, 'user1'));
    expect(result.current.chatId).toBe('');
    expect(result.current.userUnreadCount).toBe(0);
  });

  it('returns summary for given chatId', async () => {
    const { result } = renderHook(() => useChatUnreadSummary('chat-1', 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    expect(result.current.chatId).toBe('chat-1');
  });

  it('getSummaryUpdatedAtValue returns NEGATIVE_INFINITY when updatedAt is empty (line 29)', async () => {
    // Trigger the code path where a summary with empty updatedAt is merged with a newer one
    // Set up: fetch returns a summary with no updatedAt, then an event fires with newer
    let capturedCallback: ((data: any) => void) | null = null;
    setupWindow({
      getChatUnreadSummary: vi.fn(async () => ({
        success: true,
        data: { chatId: 'chat-1', userUnreadCount: 0, scheduledUnreadCount: 0, updatedAt: '' },
      })),
      onChatUnreadSummaryChanged: vi.fn((cb: any) => {
        capturedCallback = cb;
        return vi.fn();
      }),
    });

    const { result } = renderHook(() => useChatUnreadSummaryMap(['chat-1'], 'user1'));
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Now fire an update with a real timestamp — mergeSummaryByRecency compares both timestamps
    // The current summary has empty updatedAt (NEGATIVE_INFINITY), incoming has a real date
    act(() => {
      capturedCallback?.({
        alias: 'user1',
        summary: { chatId: 'chat-1', userUnreadCount: 3, scheduledUnreadCount: 0, updatedAt: '2025-01-01T00:00:00Z' },
      });
    });

    expect(result.current['chat-1'].userUnreadCount).toBe(3);
  });
});
