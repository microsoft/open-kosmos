/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

type RouteState = {
  chatId: string;
  sessionId: string;
  pathname: string;
  state: Record<string, unknown> | null;
};

const mockNavigate = vi.fn();
const mockEffectiveShow = vi.fn();
let scheduleSidepaneOpen = false;
const mockSetMinimalMode = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockDeleteChat = vi.fn();
const mockUseCurrentChatSessionId = vi.fn(() => 'session-a');
const mockUseHasChatSessionCache = vi.fn(() => true);
const mockUseChatStatus = vi.fn(() => 'idle');
const mockUseMessagesWithStream = vi.fn(() => ({ messages: [] as any[], streamingMessageId: undefined }));

let routeState: RouteState = {
  chatId: 'chat-1',
  sessionId: 'session-a',
  pathname: '/agent/chat/chat-1/session-a',
  state: null,
};

let outletContextState = {
  onSendMessage: vi.fn(),
  onCancelChat: vi.fn(),
  onWorkspaceMenuToggle: vi.fn(),
  workspaceMenuState: null,
  onEditAgentMenuToggle: vi.fn(),
  onAttachMenuToggle: vi.fn(),
  onChatSessionMenuToggle: vi.fn(),
  openMenuChatSessionId: null,
  onFileTreeNodeMenuToggle: vi.fn(),
};

vi.mock('react-router-dom', async () => ({
  useOutletContext: () => outletContextState,
  useParams: () => ({ chatId: routeState.chatId, sessionId: routeState.sessionId }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routeState.pathname, state: routeState.state }),
}));

vi.mock('../ChatViewHeader', () => ({ default: () => <div data-testid="chat-view-header" /> }));

vi.mock('../chat-side.atom', () => ({
  ScheduleSidepaneAtom: {
    useChange: () => ({
      effectiveShow: () => { scheduleSidepaneOpen = true; mockEffectiveShow(); },
      hide: vi.fn(),
      show: vi.fn(),
      effectiveToggle: vi.fn(),
    }),
    useData: () => scheduleSidepaneOpen,
  },
  WorkspaceExplorerAtom: {
    useChange: () => ({ setVisible: vi.fn(), effectiveToggle: vi.fn(), effectiveReveal: vi.fn() }),
    useData: () => ({ visible: false }),
  },
}));

vi.mock('../ChatViewContent', () => ({ default: (props: any) => {
  const { messages } = mockUseMessagesWithStream();
  return (
  <div>
    <button type="button" onClick={() => props.onSelectScheduledSession?.('session-b')}>
      Open Session B
    </button>
    <div data-testid="schedules-sidepane-state">
      {scheduleSidepaneOpen ? 'open' : 'closed'}
    </div>
    {props.isSessionSwitching ? (
      <div data-testid="session-transition">Opening chat history...</div>
    ) : (
      <div data-testid="rendered-history">
        {(messages || [])
          .map((message: any) => message.content?.[0]?.text || '')
          .join(' | ')}
      </div>
    )}
  </div>
  );
} }));

vi.mock('../chat-input/ContextMenu', async () => ({
  ContextMenu: () => null,
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useProfileData: () => ({ chats: [] }),
  useChats: () => ({ deleteChat: mockDeleteChat }),
  useAgentConfig: () => ({ agent: { id: 'agent-1', name: 'Test Agent' } }),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

vi.mock('../../layout/LayoutProvider', async () => ({
  useLayout: () => ({
    isMinimalMode: false,
    setMinimalMode: mockSetMinimalMode,
  }),
}));

vi.mock('../../auth/AuthProvider', async () => ({
  useAuthContext: () => ({
    user: { alias: 'test-user', login: 'test-user' },
  }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useCurrentChatId: () => 'chat-1',
  useCurrentChatSessionId: () => mockUseCurrentChatSessionId(),
  useChatStatus: () => mockUseChatStatus(),
  useHasChatSessionCache: () => mockUseHasChatSessionCache(),
  useMessagesWithStream: () => mockUseMessagesWithStream(),
  CurrentSessionStatus: { use: () => ({ chatId: 'chat-1', chatSessionId: mockUseCurrentChatSessionId(), chatStatus: mockUseChatStatus() }) },
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => 'chat-1'),
    getCurrentChatSessionId: vi.fn(() => mockUseCurrentChatSessionId()),
    subscribeToCurrentChatSessionId: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../../../lib/userData', async () => ({
  profileDataManager: {
    getCurrentChat: vi.fn(() => ({
      agent: {
        knowledgeBase: '/kb',
        workspace: '/workspace',
      },
      chatSessions: [
        { chatSession_id: 'session-a' },
        { chatSession_id: 'session-b', schedulerJobId: 'job-1' },
      ],
    })),
    getCurrentAgentSkills: vi.fn(() => []),
  },
}));

vi.mock('../../../lib/workspace/workspaceSearchService', async () => ({
  quickSearchFiles: vi.fn(),
  searchWorkspaceFiles: vi.fn(),
}));

vi.mock('../../../lib/chat/pmAgentSayHi', async () => ({
  getPmAgentSayHiMessageConfig: vi.fn(() => null),
}));

vi.mock('../../../lib/chat/startNewChatFor', async () => ({
  startNewChatFor: vi.fn(),
}));

describe('ChatView session switching UX', () => {
  let consoleLogSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleSidepaneOpen = false;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    routeState = {
      chatId: 'chat-1',
      sessionId: 'session-a',
      pathname: '/agent/chat/chat-1/session-a',
      state: null,
    };
    outletContextState = {
      ...outletContextState,
    };
    mockUseMessagesWithStream.mockReturnValue({
      messages: [
        {
          id: 'assistant-a',
          role: 'assistant',
          timestamp: 1,
          streamingComplete: true,
          content: [{ type: 'text', text: 'history for session A' }],
        },
      ],
      streamingMessageId: undefined,
    });
    mockUseCurrentChatSessionId.mockReturnValue('session-a');
    mockUseHasChatSessionCache.mockReturnValue(true);
    mockUseChatStatus.mockReturnValue('idle');

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        profile: {
          getChatUnreadSummary: vi.fn(() => new Promise(() => {})),
          onChatUnreadSummaryChanged: vi.fn(() => vi.fn()),
        },
        agentChat: {
          switchToChatSession: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('navigates, shows a transition state, and then renders the target session history once ready', async () => {
    const { default: ChatView } = await import('../ChatView');

    const { rerender } = render(<ChatView key="session-a-initial" />);

    expect(screen.getByTestId('rendered-history')).toHaveTextContent('history for session A');

    fireEvent.click(screen.getByRole('button', { name: 'Open Session B' }));

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/session-b');

    routeState = {
      chatId: 'chat-1',
      sessionId: 'session-b',
      pathname: '/agent/chat/chat-1/session-b',
      state: null,
    };
    mockUseCurrentChatSessionId.mockReturnValue('session-a');
    mockUseHasChatSessionCache.mockReturnValue(false);

    rerender(<ChatView key="session-b-transition" />);

    expect(screen.getByTestId('session-transition')).toHaveTextContent('Opening chat history...');
    expect(screen.queryByText('history for session A')).not.toBeInTheDocument();

    mockUseMessagesWithStream.mockReturnValue({
      messages: [
        {
          id: 'assistant-b',
          role: 'assistant',
          timestamp: 2,
          streamingComplete: true,
          content: [{ type: 'text', text: 'history for session B' }],
        },
      ],
      streamingMessageId: undefined,
    });
    mockUseCurrentChatSessionId.mockReturnValue('session-b');
    mockUseHasChatSessionCache.mockReturnValue(true);

    rerender(<ChatView key="session-b-ready" />);

    expect(screen.queryByTestId('session-transition')).not.toBeInTheDocument();
    expect(screen.getByTestId('rendered-history')).toHaveTextContent('history for session B');
  });

  it('opens the schedules sidepane after route-state navigation reaches a scheduled session', async () => {
    const { default: ChatView } = await import('../ChatView');

    routeState = {
      chatId: 'chat-1',
      sessionId: 'session-b',
      pathname: '/agent/chat/chat-1/session-b',
      state: {
        intent: 'open-session',
        source: 'schedule-run-toast',
        targetChatId: 'chat-1',
        targetSessionId: 'session-b',
        openSchedulesSidepane: true,
      },
    };
    outletContextState = {
      ...outletContextState,
    };
    mockUseMessagesWithStream.mockReturnValue({
      messages: [
        {
          id: 'assistant-b',
          role: 'assistant',
          timestamp: 2,
          streamingComplete: true,
          content: [{ type: 'text', text: 'history for session B' }],
        },
      ],
      streamingMessageId: undefined,
    });
    mockUseCurrentChatSessionId.mockReturnValue('session-b');
    mockUseHasChatSessionCache.mockReturnValue(true);

    render(<ChatView />);

    expect(mockEffectiveShow).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/session-b', {
      replace: true,
      state: {
        intent: 'open-session',
        source: 'schedule-run-toast',
        targetChatId: 'chat-1',
        targetSessionId: 'session-b',
        openSchedulesSidepane: false,
      },
    });
  });
});