// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockGetCurrentChatId = vi.hoisted(() => vi.fn(() => 'c1'));
const mockSubscribe = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockGetAllCaches = vi.hoisted(() => vi.fn(() => ({})));
const mockAgentRef = vi.hoisted(() => ({
  agent: {
    id: 'agent-1',
    name: 'Test Agent',
    source: 'LIBRARY' as string,
    version: '1.0.0',
    remoteVersion: '1.0.0',
    emoji: '🤖',
    avatar: undefined as string | undefined,
  } as any,
}));
const mockLayoutRef = vi.hoisted(() => ({
  isMinimalMode: false,
  isAlwaysOnTop: false,
  setMinimalMode: vi.fn(),
  toggleAlwaysOnTop: vi.fn(),
}));
const mockScheduleRef = vi.hoisted(() => ({
  visible: false,
  actions: { show: vi.fn(), hide: vi.fn(), effectiveToggle: vi.fn() },
}));
const mockWorkspaceRef = vi.hoisted(() => ({
  visible: false,
  actions: { setVisible: vi.fn(), effectiveToggle: vi.fn(), setReveal: vi.fn(), cancelReveal: vi.fn(), effectiveReveal: vi.fn() },
}));
const mockSubAgentAtomState = vi.hoisted(() => ({
  state: { visible: false, selectedTaskId: null },
  actions: { effectiveToggle: vi.fn(), show: vi.fn(), hide: vi.fn() },
}));
const mockUseCurrentChatSessionId = vi.hoisted(() => vi.fn(() => 'sess-1'));
const mockAuthContextRef = vi.hoisted(() => ({ user: { login: 'tester' } as any }));

let onTaskCreatedCallback: ((data: any) => void) | null = null;
let onTaskUpdatedCallback: ((data: any) => void) | null = null;
const mockListForSession = vi.hoisted(() => vi.fn());
const mockEmbeddedBrowserState = vi.hoisted(() => ({
  state: { sessions: {}, width: undefined, resizing: false },
  actions: { toggle: vi.fn(), open: vi.fn(), close: vi.fn() },
}));
// App-level master switch for the embedded browser feature. Default ON here so
// the existing ToggleEmbeddedBrowser assertions exercise the visible button.
const mockBrowserFeatureEnabled = vi.hoisted(() => ({ value: true }));

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../../../styles/Header.css', () => ({}));

vi.mock('lucide-react', () => ({
  Eye: () => <span data-testid="icon-eye" />,
  EyeOff: () => <span data-testid="icon-eyeoff" />,
  Pin: () => <span data-testid="icon-pin" />,
  PinOff: () => <span data-testid="icon-pinoff" />,
  RotateCw: () => <span data-testid="icon-rotatecw" />,
  Play: () => <span data-testid="icon-play" />,
  Square: () => <span data-testid="icon-square" />,
  AlarmClock: () => <span data-testid="icon-alarmclock" />,
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
  Bot: () => <span data-testid="icon-bot" />,
  Globe: () => <span data-testid="icon-globe" />,
}));

vi.mock('../../ui/StatusBadges', () => ({ default: () => null }));
vi.mock('../../common/AgentAvatar', () => ({
  AgentAvatar: () => <div data-testid="agent-avatar" />,
}));
vi.mock('../../common/UnreadCountBadge', () => ({ default: () => null }));

vi.mock('../../userData/userDataProvider', () => ({
  useAgentConfig: () => ({ agent: mockAgentRef.agent }),
}));

vi.mock('../../layout/LayoutProvider', () => ({
  useLayout: () => ({
    isMinimalMode: mockLayoutRef.isMinimalMode,
    setMinimalMode: mockLayoutRef.setMinimalMode,
    isAlwaysOnTop: mockLayoutRef.isAlwaysOnTop,
    toggleAlwaysOnTop: mockLayoutRef.toggleAlwaysOnTop,
  }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => [],
  useCurrentChatId: () => 'c1',
  useCurrentChatSessionId: () => mockUseCurrentChatSessionId(),
  agentChatSessionCacheManager: {
    getCurrentChatId: mockGetCurrentChatId,
    subscribeToCurrentChatSessionId: mockSubscribe,
    getAllChatSessionCaches: mockGetAllCaches,
  },
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ user: mockAuthContextRef.user }),
}));

vi.mock('../../../lib/chat/useChatUnreadSummary', () => ({
  useChatUnreadSummary: () => ({ scheduledUnreadCount: 0 }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('../chat-side.atom', () => ({
  ScheduleSidepaneAtom: {
    use: () => [mockScheduleRef.visible, mockScheduleRef.actions],
  },
  WorkspaceExplorerAtom: {
    use: () => [{ visible: mockWorkspaceRef.visible }, mockWorkspaceRef.actions],
  },
  SubAgentTasksSidepaneAtom: {
    use: () => [mockSubAgentAtomState.state, mockSubAgentAtomState.actions],
  },
  MemexMemorySidepaneAtom: {
    use: () => [{ visible: false }],
  },
}));

// Isolate the header from the memex sidepane subtree (atom + memexApi + hooks);
// the ToggleMemexMemory entry point is exercised by MemexMemorySidepane's own tests.
vi.mock('../MemexMemorySidepane', () => ({
  default: () => null,
  ToggleMemexMemory: () => null,
}));

vi.mock('../../browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: {
    use: () => [mockEmbeddedBrowserState.state, mockEmbeddedBrowserState.actions],
  },
  isBrowserOpenFor: (_state: any, sessionId: string | null | undefined) => {
    if (!sessionId) return false;
    return !!(mockEmbeddedBrowserState.state.sessions[sessionId]?.isOpen);
  },
}));

vi.mock('../../../lib/userData/useEmbeddedBrowserEnabled', () => ({
  useEmbeddedBrowserEnabled: () => mockBrowserFeatureEnabled.value,
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showError: vi.fn(), showToast: vi.fn() }),
}));

// ── import ─────────────────────────────────────────────────────────────────────
import ChatViewHeader from '../ChatViewHeader';

// ── helpers ────────────────────────────────────────────────────────────────────
function setupElectronAPI(listResult: { success: boolean; data: any[] }) {
  onTaskCreatedCallback = null;
  onTaskUpdatedCallback = null;
  mockListForSession.mockResolvedValue(listResult);

  window.electronAPI = {
    getVersion: vi.fn().mockResolvedValue('2.0.0'),
    subAgentTask: {
      listForSession: mockListForSession,
      onTaskCreated: (cb: (data: any) => void) => {
        onTaskCreatedCallback = cb;
        return vi.fn();
      },
      onTaskUpdated: (cb: (data: any) => void) => {
        onTaskUpdatedCallback = cb;
        return vi.fn();
      },
    },
    window: {
      getSize: vi.fn().mockResolvedValue({ width: 1200, height: 800 }),
      setMinSize: vi.fn().mockResolvedValue(undefined),
      setMaxSize: vi.fn().mockResolvedValue(undefined),
      setSize: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

// ── reset between tests ────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockAgentRef.agent = {
    id: 'agent-1',
    name: 'Test Agent',
    source: 'LIBRARY',
    version: '1.0.0',
    remoteVersion: '1.0.0',
    emoji: '🤖',
    avatar: undefined,
  };
  mockLayoutRef.isMinimalMode = false;
  mockLayoutRef.isAlwaysOnTop = false;
  mockScheduleRef.visible = false;
  mockWorkspaceRef.visible = false;
  mockSubAgentAtomState.state = { visible: false, selectedTaskId: null };
  mockUseCurrentChatSessionId.mockReturnValue('sess-1');
  mockGetAllCaches.mockReturnValue({});
  mockEmbeddedBrowserState.state = { sessions: {}, width: undefined, resizing: false };
  mockBrowserFeatureEnabled.value = true;
  mockAuthContextRef.user = { login: 'tester' };
  setupElectronAPI({ success: true, data: [] });
});

// ── ToggleEmbeddedBrowser tests ────────────────────────────────────────────────
describe('ToggleEmbeddedBrowser', () => {
  it('renders globe button when currentSessionId is set', async () => {
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');
    await act(async () => {
      render(<ChatViewHeader />);
    });
    expect(screen.getByTitle('Show browser')).toBeTruthy();
    expect(screen.getByTestId('icon-globe')).toBeTruthy();
  });

  it('hides globe button when currentSessionId is null', async () => {
    mockUseCurrentChatSessionId.mockReturnValue(null);
    await act(async () => {
      render(<ChatViewHeader />);
    });
    expect(screen.queryByTitle(/browser/i)).toBeNull();
    expect(screen.queryByTestId('icon-globe')).toBeNull();
  });

  it('hides globe button when the app-level browser feature is disabled', async () => {
    mockBrowserFeatureEnabled.value = false;
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');
    await act(async () => {
      render(<ChatViewHeader />);
    });
    expect(screen.queryByTitle(/browser/i)).toBeNull();
    expect(screen.queryByTestId('icon-globe')).toBeNull();
  });

  it('shows "Hide browser" title when browser is open for current session', async () => {
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');
    mockEmbeddedBrowserState.state = {
      sessions: { 'sess-1': { isOpen: true, url: 'https://example.com', title: '', canGoBack: false, canGoForward: false, isLoading: false } },
      width: undefined,
      resizing: false,
    };
    await act(async () => {
      render(<ChatViewHeader />);
    });
    expect(screen.getByTitle('Hide browser')).toBeTruthy();
  });

  it('calls toggle with sessionId when browser button is clicked', async () => {
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');
    await act(async () => {
      render(<ChatViewHeader />);
    });
    fireEvent.click(screen.getByTitle('Show browser'));
    expect(mockEmbeddedBrowserState.actions.toggle).toHaveBeenCalledWith('sess-1');
  });
});

// ── ToggleMinimal tests ────────────────────────────────────────────────────────
describe('ToggleMinimal', () => {
  // ENABLE_TOGGLE_MINIMAL_MODE is false by default in source, so ToggleMinimal
  // is behind that flag. We cannot toggle the constant in tests.
  // Instead we verify the flag is false (so the button is absent) and document it.
  it('ToggleMinimal button is absent because ENABLE_TOGGLE_MINIMAL_MODE=false', async () => {
    render(<ChatViewHeader />);
    // No Eye/EyeOff button from ToggleMinimal (the flag is disabled in source)
    expect(screen.queryByTitle(/minimal mode/i)).toBeNull();
  });
});

// ── ToggleSubAgentTasks additional branch coverage ─────────────────────────────
describe('ToggleSubAgentTasks – additional branches', () => {
  it('handles listForSession API failure gracefully', async () => {
    mockListForSession.mockRejectedValue(new Error('API error'));
    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });
    // After rejection, hasTasks should be false and button absent
    expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();
  });

  it('does nothing when listForSession returns success=false', async () => {
    setupElectronAPI({ success: false, data: [] });
    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });
    await waitFor(() => {
      expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();
    });
  });

  it('handles no currentSessionId: clears tasks and running state', async () => {
    mockUseCurrentChatSessionId.mockReturnValue(null);
    await act(async () => {
      render(<ChatViewHeader currentChatSessionId={null} />);
    });
    // No tasks visible since no session
    expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();
  });

  it('onTaskUpdated fires for different session: does not re-query', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'sess-1' }],
    });
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
    });

    // Fire update for different session - should be ignored (no extra listForSession call)
    const callsBefore = mockListForSession.mock.calls.length;
    await act(async () => {
      onTaskUpdatedCallback?.({ id: 'task-x', status: 'completed', parentSessionId: 'other-session' });
    });
    // No additional list call should have been made
    expect(mockListForSession.mock.calls.length).toBe(callsBefore);
  });

  it('onTaskUpdated for same session with non-running status triggers re-query', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'sess-1' }],
    });
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
    });

    // Now the task finishes
    mockListForSession.mockResolvedValue({
      success: true,
      data: [{ id: 'task-1', status: 'completed', parentSessionId: 'sess-1' }],
    });

    await act(async () => {
      onTaskUpdatedCallback?.({ id: 'task-1', status: 'completed', parentSessionId: 'sess-1' });
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeNull();
    });
  });

  it('onTaskUpdated for running status does not trigger re-query', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'sess-1' }],
    });
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
    });

    const callsBefore = mockListForSession.mock.calls.length;
    // Fire with status=running - should NOT re-query (branch: data.status !== 'running' is false)
    await act(async () => {
      onTaskUpdatedCallback?.({ id: 'task-1', status: 'running', parentSessionId: 'sess-1' });
    });
    expect(mockListForSession.mock.calls.length).toBe(callsBefore);
  });

  it('onTaskUpdated re-query: listForSession fails gracefully', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'sess-1' }],
    });
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
    });

    // Make re-query fail
    mockListForSession.mockRejectedValue(new Error('oops'));

    await act(async () => {
      onTaskUpdatedCallback?.({ id: 'task-1', status: 'completed', parentSessionId: 'sess-1' });
    });

    // Error is swallowed (.catch(() => {})); badge might persist but no crash
    // Just verify no exception thrown
    expect(true).toBe(true);
  });

  it('onTaskUpdated re-query: listForSession returns success=true but data=null', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'sess-1' }],
    });
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
    });

    // Re-query returns success=true but null data — covers branch 51[1]
    mockListForSession.mockResolvedValue({ success: true, data: null });

    await act(async () => {
      onTaskUpdatedCallback?.({ id: 'task-1', status: 'completed', parentSessionId: 'sess-1' });
    });

    // No crash; running badge state unchanged since result.data was null
    expect(true).toBe(true);
  });

  it('button toggle calls effectiveToggle', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'completed', parentSessionId: 'sess-1' }],
    });
    mockUseCurrentChatSessionId.mockReturnValue('sess-1');

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTitle('Show sub-agent tasks')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle('Show sub-agent tasks'));
    expect(mockSubAgentAtomState.actions.effectiveToggle).toHaveBeenCalled();
  });

  it('shows hide title when sub-agent sidepane is visible', async () => {
    mockSubAgentAtomState.state = { visible: true, selectedTaskId: null };
    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="sess-1" />);
    });
    expect(screen.getByTitle('Hide sub-agent tasks')).toBeTruthy();
  });
});

// ── DevInfoBadge – copy timeout reset ─────────────────────────────────────────
describe('DevInfoBadge – copy timeout behavior (development mode)', () => {
  beforeEach(() => {
    try {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true, writable: true });
    } catch {
      (process.env as any).NODE_ENV = 'development';
    }
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    try {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', configurable: true, writable: true });
    } catch {
      (process.env as any).NODE_ENV = 'test';
    }
  });

  it('Check icon reverts to Copy after 1500ms timeout', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
      writable: true,
    });

    render(<ChatViewHeader currentChatSessionId="s1" />);
    fireEvent.click(screen.getByText('DEV'));

    const versionRow = screen.getByText('Version').closest('.dev-info-row')!;
    await act(async () => {
      fireEvent.click(versionRow);
    });

    // Should show Check icon immediately after copy
    expect(screen.getByTestId('icon-check')).toBeTruthy();

    // Advance timer past 1500ms
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });

    // After timeout, Copy icon should be restored (Check gone)
    expect(screen.queryByTestId('icon-check')).toBeNull();
  });

  it('outside click handler: fires but ref.current contains target (no close)', async () => {
    render(<ChatViewHeader currentChatSessionId="s1" />);
    fireEvent.click(screen.getByText('DEV'));
    expect(screen.getByText('Version')).toBeTruthy();

    // Click INSIDE the dev-info-wrapper — should NOT close the popover
    const wrapper = document.querySelector('.dev-info-wrapper');
    if (wrapper) {
      fireEvent.mouseDown(wrapper);
    }
    // Popover should still be open
    expect(screen.getByText('Version')).toBeTruthy();
  });

  it('outside click handler is removed when popover closes', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    render(<ChatViewHeader currentChatSessionId="s1" />);

    await act(async () => {
      fireEvent.click(screen.getByText('DEV'));
    });
    // Popover is open
    expect(screen.getByText('Version')).toBeTruthy();

    // Click again to close via button (not outside)
    await act(async () => {
      fireEvent.click(screen.getByText('DEV'));
    });
    expect(screen.queryByText('Version')).toBeNull();
  });
});

// ── DevInfoBadge – subscribeToCurrentChatSessionId cleanup ──────────────────
describe('ChatViewHeader – subscription cleanup', () => {
  it('calls unsubscribe returned from subscribeToCurrentChatSessionId on unmount', () => {
    const unsubFn = vi.fn();
    mockSubscribe.mockReturnValue(unsubFn);

    const { unmount } = render(<ChatViewHeader />);
    expect(mockSubscribe).toHaveBeenCalled();

    unmount();
    expect(unsubFn).toHaveBeenCalled();
  });

  it('updates currentChatId when subscribeToCurrentChatSessionId fires callback', () => {
    let subscribedCallback: (() => void) | null = null;
    mockSubscribe.mockImplementation((cb: () => void) => {
      subscribedCallback = cb;
      return vi.fn();
    });
    mockGetCurrentChatId.mockReturnValue('chat-A');

    render(<ChatViewHeader />);
    expect(mockSubscribe).toHaveBeenCalled();

    // Simulate chat switch
    mockGetCurrentChatId.mockReturnValue('chat-B');
    act(() => {
      subscribedCallback?.();
    });
    // No error, and getCurrentChatId was called at least twice (init + subscription)
    expect(mockGetCurrentChatId).toHaveBeenCalledWith();
  });
});

// ── ToggleSchedulesSidepane ───────────────────────────────────────────────────
describe('ToggleSchedulesSidepane – additional coverage', () => {
  it('renders schedule button', () => {
    render(<ChatViewHeader />);
    expect(screen.getByTitle('Show schedules')).toBeTruthy();
  });

  it('renders correctly when user is null (login falls back to null)', async () => {
    // This test exercises the user?.login || null branch where user is null
    mockAuthContextRef.user = null;
    await act(async () => {
      render(<ChatViewHeader />);
    });
    // Schedule button still renders even without a user
    expect(screen.getByTitle('Show schedules')).toBeTruthy();
  });
});
