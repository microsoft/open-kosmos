/**
 * @vitest-environment happy-dom
 * Coverage tests for useSubAgentTask.ts
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────
const mockOpen = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockSubscribe = vi.hoisted(() => vi.fn((_cb: () => void) => () => {}));
// Stable map reference so useSyncExternalStore doesn't loop on identity change
const stableEmptyMap = new Map();
const mockGetSnapshot = vi.hoisted(() => vi.fn(() => stableEmptyMap));
const mockI18nState = vi.hoisted(() => {
  const makeTranslator = (language: string) => (key: string) => `${language}:${key}`;
  return {
    language: 'en',
    translators: {
      en: makeTranslator('en'),
      zh: makeTranslator('zh'),
    },
  };
});

vi.mock('../subAgentTaskCacheManager', () => ({
  subAgentTaskCacheManager: {
    open: mockOpen,
    close: mockClose,
    subscribe: mockSubscribe,
    getSnapshot: mockGetSnapshot,
  },
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: mockI18nState.translators[mockI18nState.language as 'en' | 'zh'],
  }),
}));

import {
  useSubAgentTask,
  useSubAgentTaskMessages,
  useSubAgentTaskStatus,
} from '../useSubAgentTask';

describe('useSubAgentTaskMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSnapshot.mockReturnValue(new Map());
    mockSubscribe.mockImplementation(() => () => {});
  });

  it('returns empty array when taskId is null', () => {
    mockGetSnapshot.mockReturnValue(stableEmptyMap);
    const { result } = renderHook(() => useSubAgentTaskMessages(null));
    expect(result.current).toEqual([]);
  });

  it('returns empty array when taskId is not in snapshot', () => {
    mockGetSnapshot.mockReturnValue(stableEmptyMap);
    const { result } = renderHook(() => useSubAgentTaskMessages('task-1'));
    expect(result.current).toEqual([]);
  });

  it('returns messages from snapshot when taskId is present', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const map = new Map([['task-1', { messages, status: 'idle' as const }]]);
    mockGetSnapshot.mockReturnValue(map);

    const { result } = renderHook(() => useSubAgentTaskMessages('task-1'));
    expect(result.current).toEqual(messages);
  });
});

describe('useSubAgentTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSnapshot.mockReturnValue(new Map());
    mockSubscribe.mockImplementation(() => () => {});
  });

  it('returns undefined when taskId is null', () => {
    const { result } = renderHook(() => useSubAgentTaskStatus(null));
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when taskId is not in snapshot', () => {
    const { result } = renderHook(() => useSubAgentTaskStatus('task-x'));
    expect(result.current).toBeUndefined();
  });

  it('returns status from snapshot when taskId is present', () => {
    const map = new Map([['task-1', { messages: [], status: 'running' as const }]]);
    mockGetSnapshot.mockReturnValue(map);

    const { result } = renderHook(() => useSubAgentTaskStatus('task-1'));
    expect(result.current).toBe('running');
  });
});

describe('useSubAgentTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSnapshot.mockReturnValue(new Map());
    mockSubscribe.mockImplementation(() => () => {});
    mockClose.mockResolvedValue(undefined);
    mockI18nState.language = 'en';
  });

  it('returns idle state when taskId is null (no open called)', () => {
    const { result } = renderHook(() => useSubAgentTask(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.status).toBeUndefined();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('calls open with taskId when mounted with valid taskId', async () => {
    mockOpen.mockResolvedValue({ messages: [], status: 'idle' });
    renderHook(() => useSubAgentTask('task-1'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('task-1'));
  });

  it('sets error to taskNotFound key when open resolves with null', async () => {
    mockOpen.mockResolvedValue(null);
    const { result } = renderHook(() => useSubAgentTask('task-missing'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('task-missing'));
    await waitFor(() => expect(result.current.error).toBe('en:sidepane.subAgents.taskNotFound'));
  });

  it('sets error from caught exception when open rejects', async () => {
    mockOpen.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => useSubAgentTask('task-err'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('task-err'));
    await waitFor(() => expect(result.current.error).toBe('network error'));
  });

  it('does not reopen or close the task when only language changes', async () => {
    mockOpen.mockResolvedValue({ messages: [], status: 'running' });
    const { rerender } = renderHook(() => useSubAgentTask('task-stable'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('task-stable'));
    expect(mockOpen).toHaveBeenCalledTimes(1);

    act(() => {
      mockI18nState.language = 'zh';
      rerender();
    });

    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('uses the latest translation for a missing task after language changes', async () => {
    let resolveOpen: (value: null) => void = () => {};
    mockOpen.mockReturnValue(new Promise(resolve => { resolveOpen = resolve; }));
    const { result, rerender } = renderHook(() => useSubAgentTask('task-late-missing'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('task-late-missing'));

    await act(async () => {
      mockI18nState.language = 'zh';
      rerender();
    });
    await act(async () => {
      resolveOpen(null);
    });

    await waitFor(() => expect(result.current.error).toBe('zh:sidepane.subAgents.taskNotFound'));
  });

  it('calls close on unmount', async () => {
    mockOpen.mockResolvedValue({ messages: [], status: 'idle' });
    const { unmount } = renderHook(() => useSubAgentTask('task-cleanup'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalled());
    unmount();
    expect(mockClose).toHaveBeenCalledWith('task-cleanup');
  });

  it('ignores late open rejection and close rejection after unmount', async () => {
    let rejectOpen: (error: Error) => void = () => {};
    mockOpen.mockReturnValue(new Promise((_resolve, reject) => { rejectOpen = reject; }));
    mockClose.mockRejectedValueOnce(new Error('close failed'));

    const { unmount } = renderHook(() => useSubAgentTask('task-late-error'));
    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith('task-late-error'));

    unmount();
    await act(async () => {
      rejectOpen(new Error('late failure'));
    });

    expect(mockClose).toHaveBeenCalledWith('task-late-error');
  });
});
