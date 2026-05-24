// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseMessages = vi.hoisted(() => vi.fn(() => []));
const mockIsReplaying = vi.hoisted(() => ({ use: vi.fn(() => false) }));
const mockCurrentSessionStatus = vi.hoisted(() => ({
  use: vi.fn(() => ({ chatStatus: 'idle' })),
}));
const mockSetReplayingStatus = vi.hoisted(() => vi.fn());
const mockGetCurrentChatId = vi.hoisted(() => vi.fn(() => 'c1'));
const mockSubscribe = vi.hoisted(() => vi.fn(() => vi.fn()));
const mockGetAllCaches = vi.hoisted(() => vi.fn(() => ({})));

const mockUseCurrentChatSessionId = vi.hoisted(() => vi.fn(() => 'session-1'));

const mockSubAgentAtomState = vi.hoisted(() => ({
  state: { visible: false, selectedTaskId: null },
  actions: { effectiveToggle: vi.fn() },
}));

const mockListForSession = vi.hoisted(() => vi.fn());
let onTaskCreatedCallback: ((data: any) => void) | null = null;
let onTaskUpdatedCallback: ((data: any) => void) | null = null;
const mockOnTaskCreatedUnsub = vi.hoisted(() => vi.fn());
const mockOnTaskUpdatedUnsub = vi.hoisted(() => vi.fn());

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
}));

vi.mock('../../ui/StatusBadges', () => ({ default: () => null }));
vi.mock('../../common/AgentAvatar', () => ({
  AgentAvatar: () => <div data-testid="agent-avatar" />,
}));
vi.mock('../../common/UnreadCountBadge', () => ({ default: () => null }));

vi.mock('../../userData/userDataProvider', () => ({
  useAgentConfig: () => ({
    agent: {
      id: 'agent-1',
      name: 'Test Agent',
      source: 'LIBRARY',
      version: '1.0.0',
      remoteVersion: '1.0.0',
      emoji: '🤖',
      avatar: undefined,
    },
  }),
}));

vi.mock('../../layout/LayoutProvider', () => ({
  useLayout: () => ({
    isMinimalMode: false,
    setMinimalMode: vi.fn(),
    isAlwaysOnTop: false,
    toggleAlwaysOnTop: vi.fn(),
  }),
}));

vi.mock('../../../lib/featureFlags', () => ({
  useFeatureFlag: () => false,
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useMessages: () => mockUseMessages(),
  useCurrentChatId: () => 'c1',
  useCurrentChatSessionId: () => mockUseCurrentChatSessionId(),
  CurrentSessionIsReplaying: mockIsReplaying,
  CurrentSessionStatus: mockCurrentSessionStatus,
  agentChatSessionCacheManager: {
    setReplayingStatus: mockSetReplayingStatus,
    getCurrentChatId: mockGetCurrentChatId,
    subscribeToCurrentChatSessionId: mockSubscribe,
    getAllChatSessionCaches: mockGetAllCaches,
  },
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ user: { login: 'tester' } }),
}));

vi.mock('../../../lib/chat/useChatUnreadSummary', () => ({
  useChatUnreadSummary: () => ({ scheduledUnreadCount: 0 }),
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock('../chat-side.atom', () => ({
  ScheduleSidepaneAtom: {
    use: () => [false, { effectiveToggle: vi.fn() }],
  },
  WorkspaceExplorerAtom: {
    use: () => [{ visible: false }, { effectiveToggle: vi.fn(), setVisible: vi.fn(), setReveal: vi.fn(), cancelReveal: vi.fn(), effectiveReveal: vi.fn() }],
  },
  SubAgentTasksSidepaneAtom: {
    use: () => [mockSubAgentAtomState.state, mockSubAgentAtomState.actions],
  },
}));

// ── import ─────────────────────────────────────────────────────────────────────
import ChatViewHeader from '../ChatViewHeader';

// ── helpers ────────────────────────────────────────────────────────────────────
function setupElectronAPI(listResult: { success: boolean; data: any[] }) {
  onTaskCreatedCallback = null;
  onTaskUpdatedCallback = null;

  mockListForSession.mockResolvedValue(listResult);

  window.electronAPI = {
    subAgentTask: {
      listForSession: mockListForSession,
      onTaskCreated: (cb: (data: any) => void) => {
        onTaskCreatedCallback = cb;
        return mockOnTaskCreatedUnsub;
      },
      onTaskUpdated: (cb: (data: any) => void) => {
        onTaskUpdatedCallback = cb;
        return mockOnTaskUpdatedUnsub;
      },
    },
  } as any;
}

// ── reset between tests ────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockSubAgentAtomState.state = { visible: false, selectedTaskId: null };
  mockUseCurrentChatSessionId.mockReturnValue('session-1');
  setupElectronAPI({ success: true, data: [] });
});

// ── tests ──────────────────────────────────────────────────────────────────────
describe('ToggleSubAgentTasks – button visibility', () => {
  it('button is absent when listForSession returns empty array', async () => {
    setupElectronAPI({ success: true, data: [] });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();
    expect(screen.queryByTestId('icon-bot')).toBeNull();
  });

  it('button appears after listForSession returns tasks', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'completed', parentSessionId: 'session-1' }],
    });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTitle('Show sub-agent tasks')).toBeTruthy();
    });
  });

  it('running badge is shown when a task has status "running"', async () => {
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'session-1' }],
    });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTitle('Show sub-agent tasks')).toBeTruthy();
    });

    const badge = document.querySelector('.subagent-running-badge');
    expect(badge).toBeTruthy();
  });

  it('running badge disappears when task updates to "completed"', async () => {
    // Start with a running task
    setupElectronAPI({
      success: true,
      data: [{ id: 'task-1', status: 'running', parentSessionId: 'session-1' }],
    });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
    });

    // Task updates to completed — listForSession re-query returns no running tasks
    mockListForSession.mockResolvedValue({
      success: true,
      data: [{ id: 'task-1', status: 'completed', parentSessionId: 'session-1' }],
    });

    await act(async () => {
      onTaskUpdatedCallback?.({ id: 'task-1', status: 'completed', parentSessionId: 'session-1' });
    });

    await waitFor(() => {
      expect(document.querySelector('.subagent-running-badge')).toBeNull();
    });
  });

  it('button appears immediately when onTaskCreated fires', async () => {
    // No tasks initially
    setupElectronAPI({ success: true, data: [] });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    // Confirm button is hidden initially
    expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();

    // Fire the onTaskCreated event with a running task
    await act(async () => {
      onTaskCreatedCallback?.({ id: 'task-2', status: 'running', parentSessionId: 'session-1' });
    });

    await waitFor(() => {
      expect(screen.getByTitle('Show sub-agent tasks')).toBeTruthy();
    });

    // Running badge should also appear
    expect(document.querySelector('.subagent-running-badge')).toBeTruthy();
  });
});

describe('ToggleSubAgentTasks – atom state visible=true overrides hasTasks=false', () => {
  it('button still renders when sidepane is visible even with no tasks', async () => {
    // No tasks from API
    setupElectronAPI({ success: true, data: [] });
    // But atom says visible=true (sidepane was open before tasks were cleared)
    mockSubAgentAtomState.state = { visible: true, selectedTaskId: null };

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    await waitFor(() => {
      expect(screen.getByTitle('Hide sub-agent tasks')).toBeTruthy();
    });
  });
});

describe('ToggleSubAgentTasks – task created without running status', () => {
  it('shows button but no running badge when created task is not running', async () => {
    setupElectronAPI({ success: true, data: [] });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();

    await act(async () => {
      onTaskCreatedCallback?.({ id: 'task-3', status: 'pending', parentSessionId: 'session-1' });
    });

    await waitFor(() => {
      expect(screen.getByTitle('Show sub-agent tasks')).toBeTruthy();
    });

    expect(document.querySelector('.subagent-running-badge')).toBeNull();
  });
});

describe('ToggleSubAgentTasks – ignores events from other sessions', () => {
  it('does not show button when onTaskCreated fires for a different session', async () => {
    setupElectronAPI({ success: true, data: [] });

    await act(async () => {
      render(<ChatViewHeader currentChatSessionId="session-1" />);
    });

    await act(async () => {
      onTaskCreatedCallback?.({ id: 'task-x', status: 'running', parentSessionId: 'other-session' });
    });

    // Should still be hidden
    expect(screen.queryByTitle(/sub-agent tasks/i)).toBeNull();
  });
});
