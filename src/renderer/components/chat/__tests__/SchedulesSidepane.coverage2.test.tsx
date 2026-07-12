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
  const getScheduledSessionInterruptionReason = vi.fn(() => undefined as string | undefined);
  const getAllScheduledSessions = vi.fn();
  return {
    scheduleSidepaneHide, scheduleSidepaneUse,
    chatSessionMenuToggle, chatSessionMenuUse,
    useAuthContext, useCurrentChatId, useCurrentChatSessionId,
    useProfileData, useNavigate, getScheduledSessionDisplayState, getScheduledSessionInterruptionReason,
    getAllScheduledSessions,
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
  getScheduledSessionInterruptionReason: mocks.getScheduledSessionInterruptionReason,
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

function makeSessionPage(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => makeSession({
    chatSession_id: `${prefix}-${index}`,
    title: `${prefix} ${index}`,
    last_updated: new Date(Date.UTC(2024, 0, 15, 10, index)).toISOString(),
    schedulerJobId: `job-${prefix}-${index}`,
  }));
}

function setupElectronAPI(overrides: Record<string, unknown> = {}) {
  (window as any).electronAPI = {
    profile: {
      getAllScheduledSessions: mocks.getAllScheduledSessions,
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
    mocks.getScheduledSessionInterruptionReason.mockReturnValue(undefined);
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
    });
  });

  afterEach(() => {
    delete (window as any).electronAPI;
  });

  it('shows more-options menu trigger for a session', async () => {
    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
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
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
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
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
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
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
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
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
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

  it('adds a scheduled session from a matching created IPC event', async () => {
    let createdCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
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

    await act(async () => {
      createdCallback?.({
        alias: 'testuser',
        chatId: 'chat-1',
        session: makeSession({ chatSession_id: 'new-sess', title: 'Created Session' }),
      });
    });

    expect(screen.getByText('Created Session')).toBeTruthy();
  });

  it('ignores non-scheduled created IPC events', async () => {
    let createdCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
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

    await act(async () => {
      createdCallback?.({
        alias: 'testuser',
        chatId: 'chat-1',
        session: { ...makeSession({ title: 'Plain Session' }), schedulerJobId: '' },
      });
    });

    expect(screen.queryByText('Plain Session')).toBeFalsy();
  });

  it('calls loadInitialSessions on autoSelectChatSession event', async () => {
    let autoSelectCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
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

    const callCountBefore = mocks.getAllScheduledSessions.mock.calls.length;

    await act(async () => {
      autoSelectCallback?.({ alias: 'testuser', chatId: 'chat-1' });
    });

    expect(mocks.getAllScheduledSessions.mock.calls.length).toBeGreaterThan(callCountBefore);
  });

  it('ignores autoSelectChatSession for different alias', async () => {
    let autoSelectCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
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

    const callCountBefore = mocks.getAllScheduledSessions.mock.calls.length;

    await act(async () => {
      autoSelectCallback?.({ alias: 'wrong-user', chatId: 'chat-1' });
    });

    // getAllScheduledSessions should NOT be called again
    expect(mocks.getAllScheduledSessions.mock.calls.length).toBe(callCountBefore);
  });

  it('ignores autoSelectChatSession for different chatId', async () => {
    let autoSelectCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
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

    const callCountBefore = mocks.getAllScheduledSessions.mock.calls.length;

    await act(async () => {
      autoSelectCallback?.({ alias: 'testuser', chatId: 'other-chat' });
    });

    expect(mocks.getAllScheduledSessions.mock.calls.length).toBe(callCountBefore);
  });

  it('removes a session from a matching deleted IPC event', async () => {
    let deletedCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
    });
    setupElectronAPI({
      onChatSessionStoreSessionDeleted: vi.fn((cb) => {
        deletedCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    expect(screen.getByText('Test Session')).toBeTruthy();

    await act(async () => {
      deletedCallback?.({ alias: 'testuser', chatId: 'chat-1', chatSessionId: 'session-1' });
    });

    expect(screen.queryByText('Test Session')).toBeFalsy();
  });

  it('ignores deleted IPC events for another chat', async () => {
    let deletedCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
    });
    setupElectronAPI({
      onChatSessionStoreSessionDeleted: vi.fn((cb) => {
        deletedCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    await act(async () => {
      deletedCallback?.({ alias: 'testuser', chatId: 'other-chat', chatSessionId: 'session-1' });
    });

    expect(screen.getByText('Test Session')).toBeTruthy();
  });

  it('calls subscription cleanup functions on unmount', async () => {
    const unsubscribeCreated = vi.fn();
    const unsubscribePatched = vi.fn();
    const unsubscribeDeleted = vi.fn();
    const unsubscribeAutoSelect = vi.fn();
    setupElectronAPI({
      onChatSessionStoreSessionCreated: vi.fn(() => unsubscribeCreated),
      onChatSessionStoreMetadataPatched: vi.fn(() => unsubscribePatched),
      onChatSessionStoreSessionDeleted: vi.fn(() => unsubscribeDeleted),
      onAutoSelectChatSession: vi.fn(() => unsubscribeAutoSelect),
    });

    let rendered: ReturnType<typeof render>;
    await act(async () => {
      rendered = render(<SchedulesSidepane />);
    });
    rendered!.unmount();

    expect(unsubscribeCreated).toHaveBeenCalled();
    expect(unsubscribePatched).toHaveBeenCalled();
    expect(unsubscribeDeleted).toHaveBeenCalled();
    expect(unsubscribeAutoSelect).toHaveBeenCalled();
  });

  it('does not loadMore when loadMoreSessions called without currentChatId', async () => {
    mocks.useCurrentChatId.mockReturnValue(null);
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: true, total: 0 },
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

    expect(mocks.getAllScheduledSessions).not.toHaveBeenCalled();
  });

  it('does not scroll while loading', async () => {
    let resolveChatSessions!: (v: unknown) => void;
    const pending = new Promise((res) => { resolveChatSessions = res; });
    mocks.getAllScheduledSessions.mockReturnValue(pending);
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    // Initial load should have been called
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);

    // While loading, scroll to bottom should not trigger another load
    const body = document.querySelector('.sidepane-body') as HTMLElement;
    if (body) {
      Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });
    }

    // Still only 1 call - no additional load while initial is pending
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);
    resolveChatSessions({ success: true, data: { sessions: [], hasMore: false, total: 0 } });
  });

  it('resets the exhausted-bottom latch when scrolling away from the bottom', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
    });

    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
    Object.defineProperty(body, 'scrollTop', { value: 100, configurable: true, writable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

    await act(async () => {
      fireEvent.scroll(body);
    });

    expect(screen.queryByText('All scheduled runs loaded')).toBeFalsy();
  });

  it('handles getAllScheduledSessions failure during loadMore', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: true, total: 0 },
    });

    mocks.getAllScheduledSessions.mockResolvedValue({
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

  it('renders sessions from initial paginated load', async () => {
    const session1 = makeSession({ chatSession_id: 's1', title: 'First', schedulerJobId: 'j1' });
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session1], hasMore: false, total: 1 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('First')).toBeTruthy();
  });

  it('shows "All loaded" hint on scroll when no more sessions remain after loadMore', async () => {
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: [makeSession()], hasMore: true, total: 2 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: [], hasMore: false, total: 2 },
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

  it('marks a session item as menu-open when the chat session menu atom targets it', async () => {
    mocks.chatSessionMenuUse.mockReturnValue([
      { isOpen: true, sessionId: 'session-1' },
      { toggle: mocks.chatSessionMenuToggle },
    ]);
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByTitle('Test Session').className).toContain('menu-open');
  });

  it('ignores metadata patch events for another alias', async () => {
    let patchedCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
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
        alias: 'other-user',
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        metadata: makeSession({ title: 'Foreign Patch' }),
      });
    });

    expect(screen.getByText('Test Session')).toBeTruthy();
    expect(screen.queryByText('Foreign Patch')).toBeFalsy();
  });

  it('returns from initial load when another load is already in progress', async () => {
    let autoSelectCallback: ((data: unknown) => void) | null = null;
    let resolveChatSessions!: (v: unknown) => void;
    const pending = new Promise((res) => { resolveChatSessions = res; });
    mocks.getAllScheduledSessions.mockReturnValue(pending);
    setupElectronAPI({
      onAutoSelectChatSession: vi.fn((cb) => {
        autoSelectCallback = cb;
        return vi.fn();
      }),
    });

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    await act(async () => {
      autoSelectCallback?.({ alias: 'testuser', chatId: 'chat-1' });
    });

    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChatSessions({ success: true, data: { sessions: [], hasMore: false, total: 0 } });
    });
  });

  it('does not load more while additional pages exist when scroll is away from bottom', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: makeSessionPage(20, 'Initial'), hasMore: true, total: 40 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    // Should have called once for initial load
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
    Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true, writable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

    await act(async () => {
      fireEvent.scroll(body);
    });

    // Still only 1 call - not near bottom so no additional load
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);
  });

  it('loads another page from scroll when the initial page is full', async () => {
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: makeSessionPage(20, 'Initial'), hasMore: true, total: 21 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          sessions: [makeSession({ chatSession_id: 'loaded-more', title: 'Loaded More' })],
          hasMore: false,
          total: 21,
        },
      });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
    Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

    await act(async () => {
      fireEvent.scroll(body);
    });

    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(2);
    expect(mocks.getAllScheduledSessions).toHaveBeenLastCalledWith('testuser', 'chat-1', expect.objectContaining({ offset: 20 }));
    expect(screen.getByText('Loaded More')).toBeTruthy();
    expect(screen.getByText('All scheduled runs loaded')).toBeTruthy();
  });

  it('shows the default load-more error when the result omits an error message', async () => {
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: makeSessionPage(20, 'Initial'), hasMore: true, total: 40 },
      })
      .mockResolvedValueOnce({ success: false });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
    Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

    await act(async () => {
      fireEvent.scroll(body);
    });

    expect(screen.getByText('Failed to load more scheduled sessions')).toBeTruthy();
  });

  it('uses the fallback load-more error for non-Error rejections', async () => {
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: makeSessionPage(20, 'Initial'), hasMore: true, total: 40 },
      })
      .mockRejectedValueOnce('boom');
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
    Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
    Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

    await act(async () => {
      fireEvent.scroll(body);
    });

    expect(screen.getByText('Failed to load more scheduled sessions')).toBeTruthy();
  });

  it('handles missing initial page arrays and default error messages', async () => {
    mocks.getAllScheduledSessions.mockResolvedValueOnce({
      success: false,
    }).mockResolvedValueOnce({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    let rendered = render(<SchedulesSidepane />);
    expect(await screen.findByText('Failed to load scheduled sessions')).toBeTruthy();
    rendered.unmount();

    await act(async () => {
      rendered = render(<SchedulesSidepane />);
    });

    expect(mocks.getAllScheduledSessions).toHaveBeenCalledWith('testuser', 'chat-1', expect.objectContaining({ limit: 20, offset: 0 }));
    expect(screen.getByText('No scheduled runs yet')).toBeTruthy();
    rendered.unmount();
  });

  it('uses the fallback initial-load error for non-Error rejections', async () => {
    mocks.getAllScheduledSessions.mockRejectedValue('boom');
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Failed to load scheduled sessions')).toBeTruthy();
  });

  it('hides the all-loaded hint after its timer and ignores duplicate visible hints', async () => {
    vi.useFakeTimers();
    try {
      mocks.getAllScheduledSessions.mockResolvedValue({
        success: true,
        data: { sessions: [makeSession()], hasMore: false, total: 0 },
      });
      setupElectronAPI();

      await act(async () => {
        render(<SchedulesSidepane />);
      });

      const body = document.querySelector('.sidepane-body') as HTMLElement;
      Object.defineProperty(body, 'scrollHeight', { value: 1050, configurable: true });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      Object.defineProperty(body, 'clientHeight', { value: 200, configurable: true });

      await act(async () => {
        fireEvent.scroll(body);
      });
      expect(screen.getByText('All scheduled runs loaded')).toBeTruthy();

      Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true, writable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });
      Object.defineProperty(body, 'scrollTop', { value: 1000, configurable: true, writable: true });
      await act(async () => {
        fireEvent.scroll(body);
      });

      await act(async () => {
        vi.runAllTimers();
      });

      expect(screen.queryByText('All scheduled runs loaded')).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles mouseEnter / mouseLeave on session buttons', async () => {
    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
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
