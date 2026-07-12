// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockUseMessages = vi.hoisted(() => vi.fn(() => []));
const mockCurrentSessionStatus = vi.hoisted(() => ({
  use: vi.fn(() => ({ chatId: 'c1', chatSessionId: 's1', chatStatus: 'idle' })),
}));
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
  },
}));
const mockLayoutRef = vi.hoisted(() => ({
  isMinimalMode: false,
  isAlwaysOnTop: false,
  setMinimalMode: vi.fn(),
  toggleAlwaysOnTop: vi.fn(),
}));
const mockScheduleRef = vi.hoisted(() => ({
  visible: false,
  actions: {
    show: vi.fn(), hide: vi.fn(), effectiveToggle: vi.fn(),
  },
}));
const mockWorkspaceRef = vi.hoisted(() => ({
  visible: false,
  actions: {
    setVisible: vi.fn(), effectiveToggle: vi.fn(), setReveal: vi.fn(), cancelReveal: vi.fn(), effectiveReveal: vi.fn(),
  },
}));

// ── module mocks (paths relative to THIS test file in __tests__/) ─────────────
vi.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
vi.mock('../../../styles/Header.css', () => ({}));

vi.mock('lucide-react', () => ({
  Eye: () => <span data-testid="icon-eye" />,
  EyeOff: () => <span data-testid="icon-eyeoff" />,
  Pin: () => <span data-testid="icon-pin" />,
  PinOff: () => <span data-testid="icon-pinoff" />,
  RotateCw: () => <span data-testid="icon-rotatecw" />,
  AlarmClock: () => <span data-testid="icon-alarmclock" />,
  Copy: () => <span data-testid="icon-copy" />,
  Check: () => <span data-testid="icon-check" />,
  Globe: () => <span data-testid="icon-globe" />,
}));

vi.mock('../../ui/StatusBadges', () => ({ default: () => null }));
vi.mock('../../common/AgentAvatar', () => ({
  AgentAvatar: () => <div data-testid="agent-avatar" />,
}));
vi.mock('../../common/UnreadCountBadge', () => ({ default: () => null }));

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => ({ data: { profile: { browser: { enabled: false } } } }),
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
  useMessages: () => mockUseMessages(),
  useCurrentChatId: () => 'c1',
  useCurrentChatSessionId: () => 'sess-1',
  CurrentSessionStatus: mockCurrentSessionStatus,
  agentChatSessionCacheManager: {
    getCurrentChatId: mockGetCurrentChatId,
    subscribeToCurrentChatSessionId: mockSubscribe,
    getAllChatSessionCaches: mockGetAllCaches,
  },
}));

vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({ user: { login: 'tester' } }),
}));

vi.mock('../../../lib/chat/useChatUnreadSummary', () => ({
  useChatUnreadSummary: () => ({ scheduledUnreadCount: 3 }),
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
    use: () => [{ visible: false }, { toggle: vi.fn(), show: vi.fn(), hide: vi.fn() }],
  },
}));

vi.mock('../MemexMemorySidepane', () => ({
  ToggleMemexMemory: () => null,
}));

// ── reset between tests ────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  (window as any).electronAPI = {
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    subAgentTask: {
      listForSession: vi.fn().mockResolvedValue([]),
      resolveByCorrelationId: vi.fn().mockResolvedValue(null),
      onTaskCreated: vi.fn().mockReturnValue(vi.fn()),
      onTaskUpdated: vi.fn().mockReturnValue(vi.fn()),
      onTaskCompleted: vi.fn().mockReturnValue(vi.fn()),
    },
  };
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
  mockCurrentSessionStatus.use.mockReturnValue({ chatStatus: 'idle' });
  mockUseMessages.mockReturnValue([]);
  mockScheduleRef.visible = false;
  mockWorkspaceRef.visible = false;
  mockGetAllCaches.mockReturnValue({});
});

// ── import ─────────────────────────────────────────────────────────────────────
import ChatViewHeader from '../ChatViewHeader';

// ── tests ──────────────────────────────────────────────────────────────────────
describe('ChatViewHeader – basic render', () => {
  it('renders agent name', () => {
    render(<ChatViewHeader currentChatSessionId="s1" />);
    expect(screen.getByText('Test Agent')).toBeTruthy();
  });

  it('renders "Chat" when agent is null', () => {
    mockAgentRef.agent = null as any;
    render(<ChatViewHeader />);
    expect(screen.getByText('Chat')).toBeTruthy();
  });

  it('renders AgentAvatar when agent present', () => {
    render(<ChatViewHeader />);
    expect(screen.getByTestId('agent-avatar')).toBeTruthy();
  });
});

describe('ChatViewHeader – schedules sidepane toggle', () => {
  it('calls effectiveToggle when schedule button clicked', () => {
    render(<ChatViewHeader />);
    fireEvent.click(screen.getByTitle('Show schedules'));
    expect(mockScheduleRef.actions.effectiveToggle).toHaveBeenCalled();
  });

  it('shows active title when schedule sidepane is visible', () => {
    mockScheduleRef.visible = true;
    render(<ChatViewHeader />);
    expect(screen.getByTitle('Hide schedules')).toBeTruthy();
  });
});

describe('ChatViewHeader – workspace explorer toggle', () => {
  it('calls effectiveToggle when workspace button clicked', () => {
    render(<ChatViewHeader />);
    fireEvent.click(screen.getByTitle('Show workspace explorer'));
    expect(mockWorkspaceRef.actions.effectiveToggle).toHaveBeenCalled();
  });

  it('shows hide title when workspace visible', () => {
    mockWorkspaceRef.visible = true;
    render(<ChatViewHeader />);
    expect(screen.getByTitle('Hide workspace explorer')).toBeTruthy();
  });
});

describe('ChatViewHeader – minimal mode', () => {
  it('does NOT show schedule/workspace toggles in minimal mode', () => {
    mockLayoutRef.isMinimalMode = true;
    render(<ChatViewHeader />);
    expect(screen.queryByTitle(/schedules/i)).toBeFalsy();
    expect(screen.queryByTitle(/workspace explorer/i)).toBeFalsy();
  });

  it('shows Pin (always-on-top) button in minimal mode', () => {
    mockLayoutRef.isMinimalMode = true;
    render(<ChatViewHeader />);
    expect(screen.getByTitle('Enable always on top')).toBeTruthy();
  });

  it('shows "Disable" title when alwaysOnTop is true', () => {
    mockLayoutRef.isMinimalMode = true;
    mockLayoutRef.isAlwaysOnTop = true;
    render(<ChatViewHeader />);
    expect(screen.getByTitle('Disable always on top')).toBeTruthy();
  });

  it('clicking Pin button calls toggleAlwaysOnTop', () => {
    mockLayoutRef.isMinimalMode = true;
    render(<ChatViewHeader />);
    fireEvent.click(screen.getByTitle('Enable always on top'));
    expect(mockLayoutRef.toggleAlwaysOnTop).toHaveBeenCalled();
  });
});

describe('ChatViewHeader – DevInfoBadge (development mode)', () => {
  beforeEach(() => {
    try {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', configurable: true, writable: true });
    } catch {
      (process.env as any).NODE_ENV = 'development';
    }
    window.electronAPI = { getVersion: vi.fn().mockResolvedValue('9.8.7'), subAgentTask: { listForSession: vi.fn().mockResolvedValue([]), onTaskCreated: vi.fn().mockReturnValue(vi.fn()), onTaskUpdated: vi.fn().mockReturnValue(vi.fn()), onTaskCompleted: vi.fn().mockReturnValue(vi.fn()) } } as any;
  });
  afterEach(() => {
    try {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', configurable: true, writable: true });
    } catch {
      (process.env as any).NODE_ENV = 'test';
    }
  });

  it('renders DEV badge in development mode', async () => {
    render(<ChatViewHeader currentChatSessionId="s1" />);
    expect(screen.getByText('DEV')).toBeTruthy();
  });

  it('DEV badge toggles popover on click', async () => {
    render(<ChatViewHeader currentChatSessionId="s1" />);
    const devBtn = screen.getByText('DEV');
    fireEvent.click(devBtn);
    expect(screen.getByText('Version')).toBeTruthy();
    // click again to close
    fireEvent.click(devBtn);
    expect(screen.queryByText('Version')).toBeFalsy();
  });

  it('popover closes on outside click', async () => {
    render(<ChatViewHeader currentChatSessionId="s1" />);
    fireEvent.click(screen.getByText('DEV'));
    expect(screen.getByText('Version')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByText('Version')).toBeFalsy());
  });

  it('copies version on row click', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
      writable: true,
    });
    render(<ChatViewHeader currentChatSessionId="s1" />);
    fireEvent.click(screen.getByText('DEV'));
    const versionRow = screen.getByText('Version').closest('.dev-info-row')!;
    fireEvent.click(versionRow);
    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    // copied=key shows Check icon briefly
    expect(screen.getByTestId('icon-check')).toBeTruthy();
  });

  it('DevInfoBadge shows chatId and sessionId rows when provided', () => {
    render(<ChatViewHeader currentChatSessionId="my-session-id" />);
    fireEvent.click(screen.getByText('DEV'));
    expect(screen.getByText('Chat ID')).toBeTruthy();
    expect(screen.getByText('Session ID')).toBeTruthy();
  });

  it('DevInfoBadge omits chatId row when chatId is null', () => {
    mockGetCurrentChatId.mockReturnValue(null);
    render(<ChatViewHeader currentChatSessionId={null} />);
    fireEvent.click(screen.getByText('DEV'));
    expect(screen.queryByText('Chat ID')).toBeFalsy();
  });

  it('uses fallback version when getVersion rejects', async () => {
    window.electronAPI = { getVersion: vi.fn().mockRejectedValue(new Error('no version')), subAgentTask: { listForSession: vi.fn().mockResolvedValue([]), onTaskCreated: vi.fn().mockReturnValue(vi.fn()), onTaskUpdated: vi.fn().mockReturnValue(vi.fn()), onTaskCompleted: vi.fn().mockReturnValue(vi.fn()) } } as any;
    render(<ChatViewHeader currentChatSessionId="s1" />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    fireEvent.click(screen.getByText('DEV'));
    expect(screen.getByText('1.15.6')).toBeTruthy();
  });

  it('updates appVersion when getVersion resolves', async () => {
    render(<ChatViewHeader currentChatSessionId="s1" />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    fireEvent.click(screen.getByText('DEV'));
    expect(screen.getByText('9.8.7')).toBeTruthy();
  });
});
