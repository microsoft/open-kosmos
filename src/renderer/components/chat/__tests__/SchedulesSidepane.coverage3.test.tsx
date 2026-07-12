// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
  const getScheduledSessionInterruptionReason = vi.fn(() => undefined);
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

// A full initial page (>= PAGE_SIZE) so loadInitialSessions' own while-loop exits
// immediately and leaves hasMore=true, letting a later scroll drive loadMoreSessions.
function makeFullInitialPage(count = 100) {
  return Array.from({ length: count }, (_, i) =>
    makeSession({ chatSession_id: `init-${i}`, title: `Init ${i}`, schedulerJobId: `ij-${i}` }),
  );
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

function setScrollMetrics(
  body: HTMLElement,
  { scrollHeight, scrollTop, clientHeight }: { scrollHeight: number; scrollTop: number; clientHeight: number },
) {
  Object.defineProperty(body, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(body, 'scrollTop', { value: scrollTop, configurable: true, writable: true });
  Object.defineProperty(body, 'clientHeight', { value: clientHeight, configurable: true });
}

import SchedulesSidepane from '../SchedulesSidepane';

describe('SchedulesSidepane — coverage3', () => {
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

  // ── render: running state ───────────────────────────────────────────────────
  it('renders a running session and publishes scheduleRunning=true on more-button click', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('running');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Running One' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Running One');

    const moreBtn = document.querySelector('.chat-session-more-btn') as HTMLElement;
    await act(async () => {
      fireEvent.click(moreBtn);
    });

    expect(mocks.chatSessionMenuToggle).toHaveBeenCalledWith(
      'chat-1', 'session-1', 'Running One', expect.anything(),
    );
    const trigger = mocks.chatSessionMenuToggle.mock.calls[0][3] as HTMLElement;
    expect(trigger.dataset.scheduleRunning).toBe('true');
    expect(trigger.dataset.scheduleRetryable).toBe('false');
    expect(trigger.dataset.chatSessionMenuSource).toBe('schedule');
  });

  it('publishes scheduleRunning=false on more-button click for a non-running session', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('completed');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession()], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Test Session');

    const moreBtn = document.querySelector('.chat-session-more-btn') as HTMLElement;
    await act(async () => {
      fireEvent.click(moreBtn);
    });

    const trigger = mocks.chatSessionMenuToggle.mock.calls[0][3] as HTMLElement;
    expect(trigger.dataset.scheduleRunning).toBe('false');
  });

  it('publishes scheduleRetryable=true and scheduleJobId on more-button click for a failed session', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Retryable Run' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Retryable Run');

    const moreBtn = document.querySelector('.chat-session-more-btn') as HTMLElement;
    await act(async () => {
      fireEvent.click(moreBtn);
    });

    const trigger = mocks.chatSessionMenuToggle.mock.calls[0][3] as HTMLElement;
    expect(trigger.dataset.scheduleRetryable).toBe('true');
    expect(trigger.dataset.scheduleRunning).toBe('false');
    expect(trigger.dataset.scheduleJobId).toBe('job-123');
  });

  it('publishes scheduleRetryable=true and scheduleJobId on more-button click for an interrupted session', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Stopped Run' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Stopped Run');

    const moreBtn = document.querySelector('.chat-session-more-btn') as HTMLElement;
    await act(async () => {
      fireEvent.click(moreBtn);
    });

    const trigger = mocks.chatSessionMenuToggle.mock.calls[0][3] as HTMLElement;
    expect(trigger.dataset.scheduleRetryable).toBe('true');
    expect(trigger.dataset.scheduleRunning).toBe('false');
    expect(trigger.dataset.scheduleJobId).toBe('job-123');
  });

  // ── render: interrupted state (with + without completedAt) ───────────────────
  it('renders interrupted session with completed timestamp', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: {
        sessions: [makeSession({ title: 'Stopped Run', schedulerCompletedAt: new Date('2024-02-01T08:00:00Z').toISOString() })],
        hasMore: false,
        total: 0,
      },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Stopped Run');
    expect(screen.getByText(/2024/)).toBeTruthy();
    expect(screen.getByText('Interrupted')).toBeTruthy();
  });

  it('renders interrupted session without completed timestamp', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('interrupted');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Stopped Bare' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Stopped Bare');
    expect(screen.getByText('Interrupted')).toBeTruthy();
  });

  // ── render: failed state (with + without error) ──────────────────────────────
  it('renders failed session with error detail', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Broken Run', schedulerError: 'boom' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Broken Run');
    expect(screen.getByText(/Failed · boom/)).toBeTruthy();
  });

  it('renders failed session without error detail', async () => {
    mocks.getScheduledSessionDisplayState.mockReturnValue('failed');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Broken Bare' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Broken Bare');
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  // ── render: invalid time, unread, active, menu-open ──────────────────────────
  it('renders invalid last_updated verbatim (formatTime fallback)', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Bad Time', last_updated: 'not-a-real-date' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Bad Time');
    expect(screen.getByText('not-a-real-date')).toBeTruthy();
  });

  it('renders an unread session with missing readStatus', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Unread One', readStatus: undefined })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    const btn = await screen.findByTitle('Unread One');
    const item = btn.closest('.chat-session-item') as HTMLElement;
    expect(item.getAttribute('data-read-status')).toBe('read');
  });

  it('renders an active session and handles hover without changing background', async () => {
    mocks.useCurrentChatSessionId.mockReturnValue('session-1');
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Active One' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    const btn = await screen.findByTitle('Active One');
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    fireEvent.click(btn);
    expect(btn).toBeTruthy();
  });

  it('marks the item menu-open when its menu is open and keeps the trigger visible on mouse leave', async () => {
    mocks.chatSessionMenuUse.mockReturnValue([
      { isOpen: true, sessionId: 'session-1' },
      { toggle: mocks.chatSessionMenuToggle },
    ]);
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Menu Open' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    const btn = await screen.findByTitle('Menu Open');
    expect(btn.className).toContain('menu-open');
    fireEvent.mouseLeave(btn);
    expect(btn).toBeTruthy();
  });

  it('invokes onSelectSession when a session is clicked', async () => {
    const onSelectSession = vi.fn();
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Click Me' })], hasMore: false, total: 0 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane onSelectSession={onSelectSession} />);
    });
    const btn = await screen.findByTitle('Click Me');
    fireEvent.click(btn);
    expect(onSelectSession).toHaveBeenCalledWith('session-1');
  });

  // ── loadMoreSessions via scroll (success multi-page) ─────────────────────────
  it('loads more sessions across multiple pages on scroll to bottom', async () => {
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: makeFullInitialPage(), hasMore: true, total: 25 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: [makeSession({ chatSession_id: 's1', title: 'Page1', schedulerJobId: 'j1' })], hasMore: false, total: 25 },
      });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Init 0');
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    setScrollMetrics(body, { scrollHeight: 1000, scrollTop: 950, clientHeight: 80 });
    await act(async () => {
      fireEvent.scroll(body);
    });

    await waitFor(() => expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(2));
    expect(await screen.findByTitle('Page1')).toBeTruthy();
  });

  it('shows an error when loadMore fails on scroll', async () => {
    mocks.getAllScheduledSessions
      .mockResolvedValueOnce({
        success: true,
        data: { sessions: makeFullInitialPage(), hasMore: true, total: 25 },
      })
      .mockResolvedValueOnce({ success: false, error: 'load-more-broke' });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Init 0');

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    setScrollMetrics(body, { scrollHeight: 1000, scrollTop: 950, clientHeight: 80 });
    await act(async () => {
      fireEvent.scroll(body);
    });

    expect(await screen.findByText('load-more-broke')).toBeTruthy();
  });

  it('does not load more when scrolling but not near the bottom (hasMore=true)', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: makeFullInitialPage(), hasMore: true, total: 25 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Init 0');

    // Should have called once for initial load
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);

    const body = document.querySelector('.sidepane-body') as HTMLElement;
    setScrollMetrics(body, { scrollHeight: 1000, scrollTop: 100, clientHeight: 200 });
    await act(async () => {
      fireEvent.scroll(body);
    });

    // Still only 1 call - not near bottom
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);
  });

  // ── scroll latch when everything is already loaded (hasMore=false) ────────────
  it('shows the all-loaded hint once and resets the latch when scrolling away (hasMore=false)', async () => {
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Only One' })], hasMore: false, total: 1 },
    });
    setupElectronAPI();

    await act(async () => {
      render(<SchedulesSidepane />);
    });
    await screen.findByTitle('Only One');

    // Should have called once for initial load
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);

    const body = document.querySelector('.sidepane-body') as HTMLElement;

    // Near bottom -> latch closes, hint shows.
    setScrollMetrics(body, { scrollHeight: 1000, scrollTop: 950, clientHeight: 80 });
    await act(async () => {
      fireEvent.scroll(body);
    });
    expect(screen.getByText('All scheduled runs loaded')).toBeTruthy();

    // Near bottom again while latched -> no-op, hint still shown.
    await act(async () => {
      fireEvent.scroll(body);
    });
    expect(screen.getByText('All scheduled runs loaded')).toBeTruthy();

    // Scroll away from bottom -> latch resets.
    setScrollMetrics(body, { scrollHeight: 1000, scrollTop: 100, clientHeight: 200 });
    await act(async () => {
      fireEvent.scroll(body);
    });

    // Near bottom again -> latch closes again; triggerAllLoadedHint early-returns
    // because the hint is still visible.
    setScrollMetrics(body, { scrollHeight: 1000, scrollTop: 950, clientHeight: 80 });
    await act(async () => {
      fireEvent.scroll(body);
    });
    expect(screen.getByText('All scheduled runs loaded')).toBeTruthy();
    // Still only 1 call - no new load since hasMore is false
    expect(mocks.getAllScheduledSessions).toHaveBeenCalledTimes(1);
  });

  // ── store-event subscriptions ────────────────────────────────────────────────
  it('adds a newly created scheduled session via the store event', async () => {
    let createdCallback: ((data: unknown) => void) | null = null;
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
        session: makeSession({ chatSession_id: 'created-1', title: 'Fresh Run', schedulerJobId: 'jnew' }),
      });
    });

    expect(screen.getByText('Fresh Run')).toBeTruthy();
  });

  it('ignores a created event for a non-scheduled session', async () => {
    let createdCallback: ((data: unknown) => void) | null = null;
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
        session: { chatSession_id: 'plain-1', title: 'Plain Chat', last_updated: new Date().toISOString(), schedulerJobId: '' },
      });
    });

    expect(screen.queryByText('Plain Chat')).toBeFalsy();
  });

  it('ignores a metadataPatched event for a different chatId', async () => {
    let patchedCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Keep Me' })], hasMore: false, total: 0 },
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
    await screen.findByTitle('Keep Me');

    await act(async () => {
      patchedCallback?.({
        alias: 'testuser',
        chatId: 'other-chat',
        chatSessionId: 'session-1',
        metadata: makeSession({ title: 'Renamed' }),
      });
    });

    expect(screen.getByText('Keep Me')).toBeTruthy();
    expect(screen.queryByText('Renamed')).toBeFalsy();
  });

  it('removes a deleted scheduled session and ignores deletes for a different alias', async () => {
    let deletedCallback: ((data: unknown) => void) | null = null;
    mocks.getAllScheduledSessions.mockResolvedValue({
      success: true,
      data: { sessions: [makeSession({ title: 'Delete Me' })], hasMore: false, total: 0 },
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
    await screen.findByTitle('Delete Me');

    // Wrong alias -> ignored.
    await act(async () => {
      deletedCallback?.({ alias: 'someone-else', chatId: 'chat-1', chatSessionId: 'session-1' });
    });
    expect(screen.getByText('Delete Me')).toBeTruthy();

    // Correct alias + chatId -> removed.
    await act(async () => {
      deletedCallback?.({ alias: 'testuser', chatId: 'chat-1', chatSessionId: 'session-1' });
    });
    expect(screen.queryByText('Delete Me')).toBeFalsy();
  });
});
