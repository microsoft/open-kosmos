// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── hoisted mock variables ────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const scheduleSidepaneHide = vi.fn();
  const scheduleSidepaneUse = vi.fn(() => [true, { hide: scheduleSidepaneHide }]);

  const chatSessionMenuUse = vi.fn(() => [
    { isOpen: false, sessionId: null },
    { toggle: vi.fn() },
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
    scheduleSidepaneHide,
    scheduleSidepaneUse,
    chatSessionMenuUse,
    useAuthContext,
    useCurrentChatId,
    useCurrentChatSessionId,
    useProfileData,
    useNavigate,
    getScheduledSessionDisplayState,
    getAllScheduledSessions,
    getScheduledSessionInterruptionReason,
  };
});

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('../chat-side.atom', () => ({
  ScheduleSidepaneAtom: { use: mocks.scheduleSidepaneUse },
  WorkspaceExplorerAtom: { use: vi.fn(() => [false, {}]) },
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

// ── helpers ───────────────────────────────────────────────────────────────────
function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chatSession_id: 'session-1',
    title: 'Test Session',
    last_updated: new Date('2024-01-15T10:00:00Z').toISOString(),
    schedulerJobId: 'job-123',
    readStatus: 'read',
    ...overrides,
  };
}

function setupElectronAPI(opts: {
  getAllScheduledSessions?: ReturnType<typeof vi.fn>;
  extras?: Record<string, unknown>;
} = {}) {
  (window as unknown as Record<string, unknown>).electronAPI = {
    profile: {
      getAllScheduledSessions: opts.getAllScheduledSessions ?? mocks.getAllScheduledSessions,
      onChatSessionStoreSessionCreated: vi.fn(() => vi.fn()),
      onChatSessionStoreMetadataPatched: vi.fn(() => vi.fn()),
      onChatSessionStoreSessionDeleted: vi.fn(() => vi.fn()),
      onAutoSelectChatSession: vi.fn(() => vi.fn()),
      ...(opts.extras ?? {}),
    },
  };
}

// ── import after mocks ────────────────────────────────────────────────────────
import SchedulesSidepane from '../SchedulesSidepane';

// ── tests ─────────────────────────────────────────────────────────────────────
describe('SchedulesSidepane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scheduleSidepaneUse.mockReturnValue([true, { hide: mocks.scheduleSidepaneHide }]);
    mocks.chatSessionMenuUse.mockReturnValue([
      { isOpen: false, sessionId: null },
      { toggle: vi.fn() },
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
    delete (window as unknown as Record<string, unknown>).electronAPI;
  });

  it('returns null when not visible', () => {
    mocks.scheduleSidepaneUse.mockReturnValue([false, { hide: mocks.scheduleSidepaneHide }]);
    const { container } = render(<SchedulesSidepane />);
    expect(container.firstChild).toBeNull();
  });

  it('shows empty state when visible and no sessions loaded', async () => {
    setupElectronAPI();
    await act(async () => {
      render(<SchedulesSidepane />);
    });
    expect(screen.getByText('No scheduled runs yet')).toBeTruthy();
  });

  it('shows loading state initially when fetching', async () => {
    let resolvePromise!: (v: unknown) => void;
    const pending = new Promise((res) => { resolvePromise = res; });
    mocks.getAllScheduledSessions.mockReturnValue(pending);
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Loading scheduled runs')).toBeTruthy();
    // resolve to avoid hanging
    resolvePromise({ success: true, data: { sessions: [], hasMore: false, total: 0 } });
  });

  it('closes when close button is clicked', async () => {
    setupElectronAPI();
    await act(async () => {
      render(<SchedulesSidepane />);
    });

    fireEvent.click(screen.getByLabelText('Close schedules'));
    expect(mocks.scheduleSidepaneHide).toHaveBeenCalled();
  });

  it('navigates to schedules settings when manage button clicked', async () => {
    const navigate = vi.fn();
    mocks.useNavigate.mockReturnValue(navigate);
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    fireEvent.click(screen.getByLabelText('Manage Schedules'));
    expect(navigate).toHaveBeenCalledWith('/agent/chat/chat-1/settings/schedules');
  });

  it('renders sessions from electronAPI', async () => {
    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Test Session')).toBeTruthy();
  });

  it('renders error state when API fails', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: false,
      error: 'Network error',
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Failed to load scheduled runs')).toBeTruthy();
    expect(screen.getByText('Network error')).toBeTruthy();
  });

  it('shows ExecutingIcon for running state', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('running');
    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Test Session')).toBeTruthy();
  });

  it('shows InterruptedIcon for interrupted state', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getScheduledSessionInterruptionReason.mockReturnValue('MCP server not ready');
    const session = makeSession({ schedulerCompletedAt: '2024-01-15T11:00:00Z' });
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText(/Interrupted/)).toBeTruthy();
    expect(screen.getByText(/MCP server not ready/)).toBeTruthy();
  });

  it('shows failed text for failed state', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');
    const session = makeSession({ schedulerError: 'Timeout' });
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText(/Failed/)).toBeTruthy();
    expect(screen.getByText(/Timeout/)).toBeTruthy();
  });

  it('calls onSelectSession when session is clicked', async () => {
    const onSelectSession = vi.fn();
    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane onSelectSession={onSelectSession} />);
    });

    fireEvent.click(screen.getByTitle('Test Session'));
    expect(onSelectSession).toHaveBeenCalledWith('session-1');
  });

  it('loads more sessions on scroll to bottom', async () => {
    // First call returns one session with hasMore: true
    // Second call (on scroll) returns empty with hasMore: false
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: [makeSession()], hasMore: true, total: 2 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: [makeSession({ chatSession_id: 'session-2', title: 'Session 2' })], hasMore: false, total: 2 },
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

    // Should have called getAllScheduledSessions twice (initial + load more)
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(2);
    // Second call should have offset
    expect(mocks.getAllScheduledSessions).toHaveBeenLastCalledWith(
      'testuser',
      'chat-1',
      expect.objectContaining({ offset: 1 }),
    );
  });

  it('shows all loaded hint when scrolled to bottom with no more items', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
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

  it('handles session with unread status styling', async () => {
    const session = makeSession({ readStatus: 'unread' });
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const sessionBtn = screen.getByTitle('Test Session');
    expect(sessionBtn).toBeTruthy();
    expect(sessionBtn.getAttribute('data-read-status')).toBe('unread');
  });

  it('handles active session styling', async () => {
    mocks.useCurrentChatSessionId.mockReturnValue('session-1');
    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    // Active session should have darker background
    const sessionBtn = screen.getByTitle('Test Session');
    expect(sessionBtn.style.background).toContain('rgba(0, 0, 0, 0.06)');
  });

  it('does not load when electronAPI is unavailable', async () => {
    // No electronAPI setup
    delete (window as unknown as Record<string, unknown>).electronAPI;

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('No scheduled runs yet')).toBeTruthy();
  });

  it('handles exception from getChatSessions', async () => {
    mocks.getAllScheduledSessions.mockRejectedValue(new Error('Unexpected error'));
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Unexpected error')).toBeTruthy();
  });

  it('fires live subscription for session created', async () => {
    let createdCallback: ((data: unknown) => void) | null = null;
    const unsubCreated = vi.fn();

    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [], hasMore: false, total: 0 },
    });

    (window as unknown as Record<string, unknown>).electronAPI = {
      profile: {
        getAllScheduledSessions: mocks.getAllScheduledSessions,

        onChatSessionStoreSessionCreated: vi.fn((cb) => {
          createdCallback = cb;
          return unsubCreated;
        }),
        onChatSessionStoreMetadataPatched: vi.fn(() => vi.fn()),
        onChatSessionStoreSessionDeleted: vi.fn(() => vi.fn()),
        onAutoSelectChatSession: vi.fn(() => vi.fn()),
      },
    };

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    const newSession = makeSession({ chatSession_id: 'new-session', title: 'New Scheduled' });
    await act(async () => {
      createdCallback?.({ alias: 'testuser', chatId: 'chat-1', session: newSession });
    });

    expect(screen.getByText('New Scheduled')).toBeTruthy();
  });

  it('fires live subscription for session deleted', async () => {
    let deletedCallback: ((data: unknown) => void) | null = null;

    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });

    (window as unknown as Record<string, unknown>).electronAPI = {
      profile: {
        getAllScheduledSessions: mocks.getAllScheduledSessions,

        onChatSessionStoreSessionCreated: vi.fn(() => vi.fn()),
        onChatSessionStoreMetadataPatched: vi.fn(() => vi.fn()),
        onChatSessionStoreSessionDeleted: vi.fn((cb) => {
          deletedCallback = cb;
          return vi.fn();
        }),
        onAutoSelectChatSession: vi.fn(() => vi.fn()),
      },
    };

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Test Session')).toBeTruthy();

    await act(async () => {
      deletedCallback?.({ alias: 'testuser', chatId: 'chat-1', chatSessionId: 'session-1' });
    });

    expect(screen.queryByText('Test Session')).toBeNull();
  });

  it('fires live subscription for metadata patched', async () => {
    let patchedCallback: ((data: unknown) => void) | null = null;

    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });

    (window as unknown as Record<string, unknown>).electronAPI = {
      profile: {
        getAllScheduledSessions: mocks.getAllScheduledSessions,

        onChatSessionStoreSessionCreated: vi.fn(() => vi.fn()),
        onChatSessionStoreMetadataPatched: vi.fn((cb) => {
          patchedCallback = cb;
          return vi.fn();
        }),
        onChatSessionStoreSessionDeleted: vi.fn(() => vi.fn()),
        onAutoSelectChatSession: vi.fn(() => vi.fn()),
      },
    };

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    // Patch with updated title
    const patchedSession = makeSession({ title: 'Updated Title' });
    await act(async () => {
      patchedCallback?.({ alias: 'testuser', chatId: 'chat-1', chatSessionId: 'session-1', metadata: patchedSession });
    });

    expect(screen.getByText('Updated Title')).toBeTruthy();
  });

  it('removes session from list when metadata patched without schedulerJobId', async () => {
    let patchedCallback: ((data: unknown) => void) | null = null;

    const session = makeSession();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [session], hasMore: false, total: 0 },
    });

    (window as unknown as Record<string, unknown>).electronAPI = {
      profile: {
        getAllScheduledSessions: mocks.getAllScheduledSessions,

        onChatSessionStoreSessionCreated: vi.fn(() => vi.fn()),
        onChatSessionStoreMetadataPatched: vi.fn((cb) => {
          patchedCallback = cb;
          return vi.fn();
        }),
        onChatSessionStoreSessionDeleted: vi.fn(() => vi.fn()),
        onAutoSelectChatSession: vi.fn(() => vi.fn()),
      },
    };

    await act(async () => {
      render(<SchedulesSidepane />);
    });

    expect(screen.getByText('Test Session')).toBeTruthy();

    // Patch without schedulerJobId should remove from list
    await act(async () => {
      patchedCallback?.({
        alias: 'testuser',
        chatId: 'chat-1',
        chatSessionId: 'session-1',
        metadata: { chatSession_id: 'session-1', title: 'Test Session', last_updated: new Date().toISOString() },
      });
    });

    expect(screen.queryByText('Test Session')).toBeNull();
  });
});
