// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockUseProfileData = vi.fn();
const mockGetChatSessions = vi.fn();
const mockGetMoreChatSessions = vi.fn();
const mockUseChatUnreadSummaryMap = vi.fn();

const mockAgentToggle = vi.fn();
const mockChatSessionToggle = vi.fn();
let agentMenuState = { isOpen: false, chatId: null as string | null };
let chatSessionMenuState = { isOpen: false, sessionId: null as string | null };

let onChatStatusChangedHandler: ((data: any) => void) | null = null;
let onChatUnreadSummaryChangedHandler: ((data: any) => void) | null = null;

vi.mock('../../../userData/userDataProvider', () => ({
  useProfileData: () => mockUseProfileData(),
}));

vi.mock('../../../lib/chat/useChatUnreadSummary', () => ({
  useChatUnreadSummaryMap: (...args: any[]) => mockUseChatUnreadSummaryMap(...args),
}));

vi.mock('../../../ui/navigation/NavItem', () => ({
  default: (props: any) => (
    <button type="button" data-testid={`nav-${props.ariaLabel}`} className={props.isActive ? 'active' : ''} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {props.rightContent}
    </button>
  ),
}));

vi.mock('../../../common/AgentAvatar', () => ({
  AgentAvatar: ({ name }: { name?: string }) => <span data-testid="agent-avatar">{name || 'avatar'}</span>,
}));

vi.mock('../../../menu/AgentDropdownMenu', () => ({
  AgentMenuAtom: {
    use: () => [agentMenuState, { toggle: mockAgentToggle, close: vi.fn() }],
  },
}));

vi.mock('../../../menu/ChatSessionDropdownMenu', () => ({
  ChatSessionMenuAtom: {
    use: () => [chatSessionMenuState, { toggle: mockChatSessionToggle, close: vi.fn() }],
  },
}));

vi.mock('../../../styles/DropdownMenu.css', () => ({}));
vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const { mockIsBuiltinAgent } = vi.hoisted(() => ({
  mockIsBuiltinAgent: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../lib/userData/types', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, isBuiltinAgent: mockIsBuiltinAgent };
});

vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));

vi.mock('lucide-react', () => {
  const Mock = (props: any) => <span {...props} />;
  return { MoreHorizontal: Mock, Globe: Mock, Search: Mock, Star: Mock, X: Mock };
});

function buildElectronApi() {
  return {
    profile: {
      getChatSessions: mockGetChatSessions,
      getMoreChatSessions: mockGetMoreChatSessions,
      onChatUnreadSummaryChanged: vi.fn((handler) => {
        onChatUnreadSummaryChangedHandler = handler;
        return vi.fn();
      }),
      onChatSessionStoreSessionCreated: vi.fn(() => vi.fn()),
      onChatSessionStoreMetadataPatched: vi.fn(() => vi.fn()),
      onChatSessionStoreSessionDeleted: vi.fn(() => vi.fn()),
    },
    agentChat: {
      onChatStatusChanged: vi.fn((handler) => {
        onChatStatusChangedHandler = handler;
        return vi.fn();
      }),
    },
  };
}

import AgentList from '../AgentList';

const defaultProfile = {
  data: { profile: { alias: 'user1', 'starred-chat-sessions': [] } },
};

const makeSession = (overrides: any = {}): any => ({
  chatSession_id: overrides.chatSession_id || 's1',
  title: overrides.title || 'Session One',
  last_updated: overrides.last_updated || '2026-01-01T00:00:00Z',
  readStatus: overrides.readStatus || 'read',
  ...overrides,
});

const makeChat = (overrides: any = {}): any => ({
  chat_id: overrides.chat_id || 'chat-1',
  chat_type: 'single_agent',
  agent: {
    name: 'Debt Agent',
    role: 'assistant',
    emoji: '🤖',
    avatar: '',
    version: '1.0.0',
    source: 'IN-LIBRARY',
    workspace: '',
    mcp_servers: [],
    skills: [],
    ...overrides.agent,
  },
  chatSessions: overrides.chatSessions || [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBuiltinAgent.mockReturnValue(false);
  agentMenuState = { isOpen: false, chatId: null };
  chatSessionMenuState = { isOpen: false, sessionId: null };
  onChatStatusChangedHandler = null;
  onChatUnreadSummaryChangedHandler = null;
  mockUseProfileData.mockReturnValue(defaultProfile);
  mockUseChatUnreadSummaryMap.mockReturnValue({});
  mockGetChatSessions.mockResolvedValue({
    success: true,
    data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
  });
  mockGetMoreChatSessions.mockResolvedValue({
    success: true,
    data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  };
  window.cancelAnimationFrame = vi.fn();
  (window as any).electronAPI = buildElectronApi();
});

describe('AgentList debt coverage', () => {
  it('covers agent right-content click and keyboard menu handlers', async () => {
    const session = makeSession({ chatSession_id: 's1', title: 'Loaded Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    const onSelectChat = vi.fn();

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        currentChatSessionId="s1"
        activeView="chat"
        onSelectChat={onSelectChat}
      />,
    );

    await waitFor(() => screen.getByText('Loaded Session'));
    const startNew = screen.getByLabelText('Start new conversation');
    fireEvent.click(startNew);
    fireEvent.keyDown(startNew, { key: 'Enter' });
    fireEvent.keyDown(startNew, { key: ' ' });

    const more = screen.getByLabelText('More options');
    fireEvent.click(more);
    fireEvent.keyDown(more, { key: 'Enter' });
    fireEvent.keyDown(more, { key: ' ' });

    expect(onSelectChat).toHaveBeenCalledWith('chat-1');
    expect(mockAgentToggle).toHaveBeenCalled();
  });

  it('covers chat session menu, delete, fork, hover, and loading adornments', async () => {
    const session = makeSession({
      chatSession_id: 's1',
      title: 'Interactive Session',
      starred: true,
    });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });
    const onDeleteChatSession = vi.fn();
    const onForkChatSession = vi.fn();

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        onDeleteChatSession={onDeleteChatSession}
        onForkChatSession={onForkChatSession}
      />,
    );

    await waitFor(() => screen.getByText('Interactive Session'));
    await act(async () => {
      onChatStatusChangedHandler?.({ chatId: 'chat-1', chatSessionId: 's1', chatStatus: 'running' });
    });

    const item = document.querySelector('.chat-session-item') as HTMLElement;
    fireEvent.mouseEnter(item);
    fireEvent.mouseLeave(item);
    fireEvent.click(item.querySelector('.chat-session-more-btn') as HTMLElement);

    expect(mockChatSessionToggle).toHaveBeenCalledWith('chat-1', 's1', 'Interactive Session', expect.any(HTMLElement));
  });

  it('covers starred session hover and menu handlers', async () => {
    chatSessionMenuState = { isOpen: true, sessionId: 'star-1' };
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'user1',
          'starred-chat-sessions': [
            {
              chatId: 'chat-1',
              chatSessionId: 'star-1',
              title: 'Starred Debt Session',
              lastUpdated: '2026-01-01T00:00:00Z',
              readStatus: 'unread',
            },
          ],
        },
      },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        excludeBuiltinAgents
        onDeleteChatSession={vi.fn()}
        onForkChatSession={vi.fn()}
      />,
    );

    const item = await screen.findByTitle('Starred Debt Session');
    fireEvent.mouseEnter(item);
    fireEvent.mouseLeave(item);
    fireEvent.click(item.querySelector('.chat-session-more-btn') as HTMLElement);

    expect(mockChatSessionToggle).toHaveBeenCalledWith('chat-1', 'star-1', 'Starred Debt Session', expect.any(HTMLElement));
  });

  it('covers open agent and chat-session menu visual state branches', async () => {
    agentMenuState = { isOpen: true, chatId: 'chat-1' };
    chatSessionMenuState = { isOpen: true, sessionId: 's1' };
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [makeSession({ chatSession_id: 's1', title: 'Open Menu Session' })],
        hasMore: false,
        nextMonthIndex: 0,
      },
    });

    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" currentChatSessionId="s1" activeView="chat" onDeleteChatSession={vi.fn()} />);

    await waitFor(() => screen.getByText('Open Menu Session'));
    expect(document.querySelector('.chat-session-item.menu-open')).toBeTruthy();
  });

  it('covers search cache loading, paging, mention mouse enter, filter clear, and top-50 hint', async () => {
    const manySessions = Array.from({ length: 55 }, (_, index) =>
      makeSession({
        chatSession_id: `search-${index}`,
        title: `Searchable Topic ${index}`,
        last_updated: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        readStatus: index === 0 ? 'unread' : 'read',
      }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: manySessions.slice(0, 30), hasMore: true, nextMonthIndex: 1 },
    });
    mockGetMoreChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: manySessions.slice(30), hasMore: false, nextMonthIndex: 2 },
    });

    render(
      <AgentList
        chats={[makeChat({ chatSessions: [] })]}
        searchSourceChats={[makeChat({ chatSessions: [] })]}
        showSearch
      />,
    );

    const input = screen.getByLabelText('Search conversations');
    fireEvent.focus(input);
    expect(screen.getByText(/type @/i)).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '@Debt' } });
    const option = await screen.findByText('Filter conversations for this agent');
    fireEvent.mouseEnter(option.closest('button') as HTMLElement);
    fireEvent.click(option.closest('button') as HTMLElement);
    expect(screen.getByText('Filtering by agent')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Searchable' } });
    await waitFor(() => expect(screen.getByText('Showing top 50 results')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Clear agent filter'));

    expect(mockGetMoreChatSessions).toHaveBeenCalledWith('user1', 'chat-1', 1);
  });

  it('covers failed search pagination after the first search page', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [makeSession({ chatSession_id: 'search-page-1', title: 'Paged Search One' })],
        hasMore: true,
        nextMonthIndex: 9,
      },
    });
    mockGetMoreChatSessions.mockResolvedValueOnce({ success: false, error: 'More search failed' });

    render(<AgentList chats={[makeChat({ chatSessions: [] })]} showSearch />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'Paged' } });

    await waitFor(() => expect(mockGetMoreChatSessions).toHaveBeenCalledWith('user1', 'chat-1', 9));
  });

  it('covers failed search-session cache loading', async () => {
    mockGetChatSessions.mockResolvedValueOnce({ success: false, error: 'Search cache failed' });

    render(<AgentList chats={[makeChat({ chatSessions: [] })]} showSearch />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'whatever' } });

    await waitFor(() => expect(screen.getByText('No conversations found')).toBeInTheDocument());
    expect(mockGetChatSessions).toHaveBeenCalledWith('user1', 'chat-1', 100);
  });

  it('covers unread summary recency guards and cleanup of stale chat state', async () => {
    mockUseChatUnreadSummaryMap.mockReturnValue({
      'chat-1': {
        chatId: 'chat-1',
        userUnreadCount: 1,
        scheduledUnreadCount: 0,
        updatedAt: '2026-01-01T00:00:00Z',
      },
    });
    const { rerender } = render(<AgentList chats={[makeChat()]} />);

    await waitFor(() => expect(onChatUnreadSummaryChangedHandler).toBeTruthy());
    await act(async () => {
      onChatUnreadSummaryChangedHandler?.({
        alias: 'user1',
        summary: {
          chatId: 'chat-1',
          userUnreadCount: 0,
          scheduledUnreadCount: 0,
          updatedAt: '2025-01-01T00:00:00Z',
        },
      });
      onChatUnreadSummaryChangedHandler?.({
        alias: 'other',
        summary: {
          chatId: 'chat-1',
          userUnreadCount: 9,
          scheduledUnreadCount: 0,
          updatedAt: '2027-01-01T00:00:00Z',
        },
      });
    });

    rerender(<AgentList chats={[makeChat({ chat_id: 'chat-2', agent: { name: 'Other Agent' } })]} />);
    expect(screen.getAllByText('Other Agent').length).toBeGreaterThan(0);
  });

});
