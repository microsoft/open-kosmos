/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

interface MockSkill {
  name: string;
  description?: string;
}

const mockUseCurrentChatSessionId = vi.fn(() => 'chatSession_20260324_test');
const mockUseHasChatSessionCache = vi.fn(() => true);
const mockUseChatStatus = vi.fn(() => 'idle');
const mockChatViewContent = vi.fn();
const mockNavigate = vi.fn();
const mockSetMinimalMode = vi.fn();
const mockDeleteChat = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockGetCurrentAgentSkills = vi.fn(() => []);

vi.mock('react-router-dom', async () => ({
  useOutletContext: () => ({
    messages: [],
    streamingMessageId: null,
    onSendMessage: vi.fn(),
    onWorkspaceMenuToggle: vi.fn(),
    workspaceMenuState: null,
    onEditAgentMenuToggle: vi.fn(),
    onAttachMenuToggle: vi.fn(),
    onChatSessionMenuToggle: vi.fn(),
    openMenuChatSessionId: null,
    onFileTreeNodeMenuToggle: vi.fn(),
  }),
  useParams: () => ({ chatId: 'chat-1', sessionId: 'chatSession_20260324_test' }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/agent/chat/chat-1/chatSession_20260324_test', state: null }),
}));

vi.mock('../ChatViewHeader', () => ({ default: () => <div data-testid="chat-view-header" /> }));

vi.mock('../ChatViewContent', () => ({ default: (props: any) => {
  mockChatViewContent(props);

  return <div />;
} }));

vi.mock('../chat-input/ContextMenu', async () => ({
  ContextMenu: () => <div data-testid="context-menu" />,
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
    user: { alias: 'test-user' },
  }),
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', async () => ({
  useCurrentChatId: () => 'chat-1',
  useCurrentChatSessionId: () => mockUseCurrentChatSessionId(),
  useChatStatus: () => mockUseChatStatus(),
  useHasChatSessionCache: () => mockUseHasChatSessionCache(),
  CurrentSessionStatus: { use: () => ({ chatId: 'chat-1', chatSessionId: mockUseCurrentChatSessionId(), chatStatus: mockUseChatStatus() }) },
  agentChatSessionCacheManager: {
    getCurrentChatId: vi.fn(() => 'chat-1'),
    getCurrentChatSessionId: vi.fn(() => 'chatSession_20260324_test'),
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
    })),
    getCurrentAgentSkills: mockGetCurrentAgentSkills,
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

describe('ChatView context menu defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentAgentSkills.mockReturnValue([]);
    mockUseCurrentChatSessionId.mockReturnValue('chatSession_20260324_test');
    mockUseChatStatus.mockReturnValue('idle');
    mockUseHasChatSessionCache.mockReturnValue(true);

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        profile: {
          getChatUnreadSummary: vi.fn().mockResolvedValue({
            success: true,
            data: {
              chatId: 'chat-1',
              userUnreadCount: 0,
              scheduledUnreadCount: 0,
              updatedAt: '',
            },
          }),
          onChatUnreadSummaryChanged: vi.fn(() => vi.fn()),
        },
      },
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('passes session switching state when the route session cache is not ready yet', async () => {
    mockUseHasChatSessionCache.mockReturnValue(false);

    const { default: ChatView } = await import('../ChatView');

    render(<ChatView />);

    expect(mockChatViewContent).toHaveBeenCalled();
    expect(mockChatViewContent.mock.calls.at(-1)?.[0]?.isSessionSwitching).toBe(true);
  });

  it('renders from cache-managed chat status without requiring direct agentChat IPC listeners', async () => {
    mockUseChatStatus.mockReturnValue('sending_response');

    const { default: ChatView } = await import('../ChatView');

    render(<ChatView />);

    expect(mockChatViewContent).toHaveBeenCalled();
    expect(mockChatViewContent.mock.calls.at(-1)?.[0]?.chatStatus).toEqual('sending_response');
    expect((window as any).electronAPI.agentChat).toBeUndefined();
  });
});