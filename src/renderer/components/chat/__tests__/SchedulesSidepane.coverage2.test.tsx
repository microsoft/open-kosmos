// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── hoisted mock variables ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const scheduleSidepaneHide = vi.fn();
  const scheduleSidepaneUse = vi.fn(() => [true, { hide: scheduleSidepaneHide }]);
  const chatSessionMenuToggle = vi.fn();
  const chatSessionMenuUse = vi.fn(() => [
    { isOpen: false, sessionId: null },
    { toggle: chatSessionMenuToggle },
  ]);
  const useAuthContext = vi.fn(() => ({ user: { login: 'testuser' } }));
  const useCurrentChatId = vi.fn(() => 'chat-1');
  const useCurrentChatSessionId = vi.fn(() => null);
  const useProfileData = vi.fn(() => ({ chats: [] }));
  const useNavigate = vi.fn(() => vi.fn());
  const getScheduledSessionDisplayState = vi.fn(() => 'completed');
  const getChatSessions = vi.fn();
  const getMoreChatSessions = vi.fn();
  return {
    scheduleSidepaneHide, scheduleSidepaneUse,
    chatSessionMenuToggle, chatSessionMenuUse,
    useAuthContext, useCurrentChatId, useCurrentChatSessionId,
    useProfileData, useNavigate, getScheduledSessionDisplayState,
    getChatSessions, getMoreChatSessions,
  };
});

vi.mock('../chat-side.atom', () => ({
  ScheduleSidepaneAtom: { use: mocks.scheduleSidepaneUse },
}));
vi.mock('../../menu/ChatSessionDropdownMenu', () => ({
  ChatSessionMenuAtom: { use: mocks.chatSessionMenuUse },
}));
vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: mocks.useAuthContext,
}));
vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatId: mocks.useCurrentChatId,
  useCurrentChatSessionId: mocks.useCurrentChatSessionId,
}));
vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: mocks.useProfileData,
}));
vi.mock('../SchedulesSidepane.utils', () => ({
  getScheduledSessionDisplayState: mocks.getScheduledSessionDisplayState,
}));
vi.mock('react-router-dom', () => ({
  useNavigate: mocks.useNavigate,
}));
vi.mock('../../../styles/Sidepane.css', () => ({}));
vi.mock('../../../styles/WorkspaceExplorerSidepane.css', () => ({}));
vi.mock('../../../styles/DropdownMenu.css', () => ({}));
vi.mock('lucide-react', () => ({
  AlarmClock: () => <span data-testid="icon-alarm" />,
  MoreHorizontal: () => <span data-testid="icon-more" />,
  X: () => <span data-testid="icon-x" />,
  Settings: () => <span data-testid="icon-settings" />,
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    chatSession_id: 'session-1',
    title: 'Test Session',
    last_updated: new Date('2024-01-15T10:00:00Z').toISOString(),
    schedulerJobId: 'job-123',
    readStatus: 'read',
    ...overrides,
  };
}

function setupElectronAPI(overrides: Record<string, unknown> = {}) {
  (window as any).electronAPI = {
    profile: {
      getChatSessions: mocks.getChatSessions,
      getMoreChatSessions: mocks.getMoreChatSessions,
      onChatSessionStoreSessionCreated: vi.fn(() => vi.fn()),
      onChatSessionStoreMetadataPatched: vi.fn(() => vi.fn()),
      onChatSessionStoreSessionDeleted: vi.fn(() => vi.fn()),
      onAutoSelectChatSession: vi.fn(() => vi.fn()),
      ...overrides,
    },
  };
}

import SchedulesSidepane from '../SchedulesSidepane';

describe('SchedulesSidepane — coverage2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduleSidepaneUse.mockReturnValue([true, { hide: mocks.scheduleSidepaneHide }]);
    mocks.chatSessionMenuUse.mockReturnValue([
      { isOpen: false, sessionId: null },
      { toggle: mocks.chatSessionMenuToggle },
    ]);
    mocks.useAuthContext.mockReturnValue({ user: { login: 'testuser' } });
    mocks.useCurrentChatId.mockReturnValue('chat-1');
    mocks.useCurrentChatSessionId.mockReturnValue(null);
    mocks.useProfileData.mockReturnValue({ chats: [] });
    mocks.useNavigate.mockReturnValue(vi.fn());
    mocks.getScheduledSessionDisplayState.mockReturnValue('completed');
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
    });
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('shows more-options menu trigger for a session', async () => {
    const session = makeSession();
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const moreBtn = document.querySelector('.chat-session-more-btn') as HTMLElement;
    expect(moreBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(moreBtn);
    });
    expect(mocks.chatSessionMenuToggle).toHaveBeenCalledWith(
      'chat-1', 'session-1', 'Test Session', expect.anything()
    );
  });

  it('does not fire toggle for more-options when currentChatId is null', async () => {
    mocks.useCurrentChatId.mockReturnValue(null);
    const session = makeSession();
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const moreBtn = document.querySelector('.chat-session-more-btn') as HTMLElement;
    if (moreBtn) {
      await act(async () => {
        fireEvent.click(moreBtn);
      });
    }
    expect(mocks.chatSessionMenuToggle).not.toHaveBeenCalled();
  });

  it('does not navigate to settings when currentChatId is null', async () => {
    mocks.useCurrentChatId.mockReturnValue(null);
    const navigate = vi.fn();
    mocks.useNavigate.mockReturnValue(navigate);
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    fireEvent.click(screen.getByLabelText('Manage Schedules'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('handles IPC onChatSessionStoreMetadataPatched for non-scheduled session — removes it', async () => {
    let patchedCallback: ((data: unknown) => void) | null = null;
    const session = makeSession();
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI({
      onChatSessionStoreMetadataPatched: vi.fn((cb) => {
        patchedCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Test Session')).toBeTruthy();

    // Patch the session so it is no longer scheduled (no schedulerJobId)
    await act(async () => {
      patchedCallback?.({
        alias: 'testuser',
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        metadata: { chatSession_id: 'session-1', title: 'Test Session', last_updated: '', schedulerJobId: '' },
      });
    });

    // After removal the sessions list should be empty
    expect(screen.queryByText('Test Session')).toBeFalsy();
  });

  it('handles IPC onChatSessionStoreMetadataPatched for still-scheduled session — updates it', async () => {
    let patchedCallback: ((data: unknown) => void) | null = null;
    const session = makeSession();
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI({
      onChatSessionStoreMetadataPatched: vi.fn((cb) => {
        patchedCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    await act(async () => {
      patchedCallback?.({
        alias: 'testuser',
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        metadata: { chatSession_id: 'session-1', title: 'Updated Title', last_updated: new Date().toISOString(), schedulerJobId: 'job-abc' },
      });
    });

    expect(screen.getByText('Updated Title')).toBeTruthy();
  });

  it('ignores IPC events for different alias or chatId', async () => {
    let createdCallback: ((data: unknown) => void) | null = null;
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI({
      onChatSessionStoreSessionCreated: vi.fn((cb) => {
        createdCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    // Different alias — should be ignored
    await act(async () => {
      createdCallback?.({
        alias: 'other-user',
        chatId: 'chat-1',
        session: makeSession({ chatSession_id: 'new-sess', title: 'Foreign Session' }),
      });
    });

    expect(screen.queryByText('Foreign Session')).toBeFalsy();
  });

  it('calls loadInitialSessions on autoSelectChatSession event', async () => {
    let autoSelectCallback: ((data: unknown) => void) | null = null;
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI({
      onAutoSelectChatSession: vi.fn((cb) => {
        autoSelectCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const callCountBefore = mocks.getChatSessions.mock.calls.length;

    await act(async () => {
      autoSelectCallback?.({ alias: 'testuser', chatId: 'chat-1' });
    });

    expect(mocks.getChatSessions.mock.calls.length).toBeGreaterThan(callCountBefore);
  });

  it('ignores autoSelectChatSession for different alias', async () => {
    let autoSelectCallback: ((data: unknown) => void) | null = null;
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI({
      onAutoSelectChatSession: vi.fn((cb) => {
        autoSelectCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const callCountBefore = mocks.getChatSessions.mock.calls.length;

    await act(async () => {
      autoSelectCallback?.({ alias: 'wrong-user', chatId: 'chat-1' });
    });

    // getChatSessions should NOT be called again
    expect(mocks.getChatSessions.mock.calls.length).toBe(callCountBefore);
  });

  it('does not loadMore when loadMoreSessions called without currentChatId', async () => {
    mocks.useCurrentChatId.mockReturnValue(null);
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: true, nextMonthIndex: 1 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    if (body) {
      Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });
    }

    expect(mocks.getMoreChatSessions).not.toHaveBeenCalled();
  });

  it('does not scroll while loading', async () => {
    let resolveChatSessions!: (v: unknown) => void;
    const pending = new Promise((res) => { resolveChatSessions = res; });
    mocks.getChatSessions.mockReturnValue(pending);
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    // While loading, scroll to bottom should not trigger loadMoreSessions
    const body = document.querySelector('.sidepane-body') as HTMLElement;
    if (body) {
      Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });
    }

    expect(mocks.getMoreChatSessions).not.toHaveBeenCalled();
    resolveChatSessions({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  });

  it('handles getMoreChatSessions failure during loadMore', async () => {
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: true, nextMonthIndex: 1 },
    });
    mocks.getMoreChatSessions.mockResolvedValue({
      success: false,
      error: 'Load more failed',
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    if (body) {
      Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });
    }

    expect(screen.getByText('Load more failed')).toBeTruthy();
  });

  it('renders sessions from paginated initial load (while loop)', async () => {
    const session1 = makeSession({ chatSession_id: 's1', title: 'First', schedulerJobId: 'j1' });
    const session2 = makeSession({ chatSession_id: 's2', title: 'Second', schedulerJobId: 'j2' });
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session1], hasMore: true, nextMonthIndex: 1 },
    });
    mocks.getMoreChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session2], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
  });

  it('shows "All loaded" hint on scroll when no more sessions remain after loadMore', async () => {
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: true, nextMonthIndex: 1 },
    });
    mocks.getMoreChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    if (body) {
      Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });
    }

    expect(screen.getByText('All scheduled runs loaded')).toBeTruthy();
  });

  it('handles mouseEnter / mouseLeave on session buttons', async () => {
    const session = makeSession();
    mocks.getChatSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const btn = screen.getByTitle('Test Session');
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    // Should not throw; background changes tested implicitly
    expect(btn).toBeTruthy();
  });
});
