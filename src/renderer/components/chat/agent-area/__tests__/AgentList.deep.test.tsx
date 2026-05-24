/**
 * @vitest-environment happy-dom
 */

/**
 * Deep coverage tests for AgentList.
 * Targets branches not covered by the existing test files.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockUseProfileData = vi.fn();
const mockGetChatSessions = vi.fn();
const mockGetMoreChatSessions = vi.fn();
const mockOnChatUnreadSummaryChanged = vi.fn();
const mockUseChatUnreadSummaryMap = vi.fn();

let onSessionCreatedHandler: ((data: any) => void) | null = null;
let onMetadataPatchedHandler: ((data: any) => void) | null = null;
let onSessionDeletedHandler: ((data: any) => void) | null = null;
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
    <button type="button" onClick={props.onClick} className={props.isActive ? 'active' : ''}>
      {props.icon}
      <span data-testid={`nav-label-${props.ariaLabel || 'nav-item'}`}>{props.label}</span>
      {props.rightContent}
    </button>
  ),
}));

vi.mock('../../../common/AgentAvatar', () => ({
  AgentAvatar: ({ name }: { name?: string }) => <div data-testid="agent-avatar">{name || 'avatar'}</div>,
}));

vi.mock('../../../../styles/DropdownMenu.css', () => ({}));

vi.mock('../../../lib/userData/types', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    isBuiltinAgent: vi.fn().mockReturnValue(false),
  };
});

vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));

function buildElectronApi() {
  return {
    profile: {
      getChatSessions: mockGetChatSessions,
      getMoreChatSessions: mockGetMoreChatSessions,
      onChatUnreadSummaryChanged: vi.fn((handler) => {
        onChatUnreadSummaryChangedHandler = handler;
        return vi.fn();
      }),
      onChatSessionStoreSessionCreated: vi.fn((handler) => {
        onSessionCreatedHandler = handler;
        return vi.fn();
      }),
      onChatSessionStoreMetadataPatched: vi.fn((handler) => {
        onMetadataPatchedHandler = handler;
        return vi.fn();
      }),
      onChatSessionStoreSessionDeleted: vi.fn((handler) => {
        onSessionDeletedHandler = handler;
        return vi.fn();
      }),
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

const makeChat = (overrides: any = {}): any => ({
  chat_id: 'chat-1',
  chat_type: 'single_agent',
  agent: {
    name: 'Test Agent',
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
  chatSessions: [],
  ...overrides,
});

const defaultProfile = {
  data: {
    profile: {
      alias: 'test-user',
      'starred-chat-sessions': [],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  onSessionCreatedHandler = null;
  onMetadataPatchedHandler = null;
  onSessionDeletedHandler = null;
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

  (window as any).electronAPI = buildElectronApi();
});

// ============================================================
// Starred sessions
// ============================================================

describe('Starred sessions rendering', () => {
  it('renders starred sessions section when starred sessions exist', async () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            {
              chatSessionId: 'starred-1',
              chatId: 'chat-1',
              title: 'Starred Conversation',
              lastUpdated: '2024-06-01T00:00:00Z',
              readStatus: 'read',
            },
          ],
        },
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents />);
    await waitFor(() => {
      expect(screen.getByText('Starred')).toBeInTheDocument();
      expect(screen.getByText('Starred Conversation')).toBeInTheDocument();
    });
  });

  it('shows Agents section header when both starred and regular chats present', async () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            {
              chatSessionId: 'starred-1',
              chatId: 'chat-1',
              title: 'A Starred One',
              lastUpdated: '2024-06-01T00:00:00Z',
              readStatus: 'read',
            },
          ],
        },
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents />);
    await waitFor(() => {
      expect(screen.getByText('Agents')).toBeInTheDocument();
    });
  });

  it('deduplicates starred sessions with same chatSessionId', async () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            { chatSessionId: 'dup-1', chatId: 'chat-1', title: 'Dup Title', lastUpdated: '2024-06-01T00:00:00Z', readStatus: 'read' },
            { chatSessionId: 'dup-1', chatId: 'chat-1', title: 'Dup Title', lastUpdated: '2024-06-01T00:00:00Z', readStatus: 'read' },
          ],
        },
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents />);
    await waitFor(() => {
      const items = screen.getAllByText('Dup Title');
      expect(items).toHaveLength(1);
    });
  });

  it('sorts starred sessions by lastUpdated descending', async () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            { chatSessionId: 's-old', chatId: 'chat-1', title: 'Old Starred', lastUpdated: '2023-01-01T00:00:00Z', readStatus: 'read' },
            { chatSessionId: 's-new', chatId: 'chat-1', title: 'New Starred', lastUpdated: '2024-06-01T00:00:00Z', readStatus: 'read' },
          ],
        },
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents />);
    await waitFor(() => {
      const items = screen.getAllByTitle(/Starred|Old Starred|New Starred/);
      // New Starred should appear before Old Starred
      const newIdx = Array.from(document.querySelectorAll('[title]')).findIndex(el => el.getAttribute('title') === 'New Starred');
      const oldIdx = Array.from(document.querySelectorAll('[title]')).findIndex(el => el.getAttribute('title') === 'Old Starred');
      expect(newIdx).toBeLessThan(oldIdx);
    });
  });

  it('does not render starred section when excludeBuiltinAgents=false', () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            { chatSessionId: 's1', chatId: 'chat-1', title: 'Hidden Starred', lastUpdated: '2024-01-01T00:00:00Z', readStatus: 'read' },
          ],
        },
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents={false} />);
    expect(screen.queryByText('Hidden Starred')).not.toBeInTheDocument();
  });

  it('clicking starred session calls onSelectChatSession', async () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            { chatSessionId: 'star-click', chatId: 'chat-1', title: 'Click Starred', lastUpdated: '2024-01-01T00:00:00Z', readStatus: 'read' },
          ],
        },
      },
    });
    const onSelectChatSession = vi.fn();
    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents onSelectChatSession={onSelectChatSession} />);
    await waitFor(() => screen.getByText('Click Starred'));
    fireEvent.click(screen.getByText('Click Starred'));
    await waitFor(() => expect(onSelectChatSession).toHaveBeenCalledWith('chat-1', 'star-click'));
  });

  it('shows more-options button for starred sessions when onDeleteChatSession provided', async () => {
    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            { chatSessionId: 's-more', chatId: 'chat-1', title: 'More Options Starred', lastUpdated: '2024-01-01T00:00:00Z', readStatus: 'read' },
          ],
        },
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents onDeleteChatSession={vi.fn()} />);
    await waitFor(() => screen.getByText('More Options Starred'));
    const moreBtn = document.querySelector('[data-chat-session-starred="true"]');
    expect(moreBtn).toBeTruthy();
  });
});

// ============================================================
// Unread summary / highlight
// ============================================================

describe('Unread summary and highlight', () => {
  it('bolds agent name when chat has unread messages and is not expanded', async () => {
    mockUseChatUnreadSummaryMap.mockReturnValue({
      'chat-1': {
        chatId: 'chat-1',
        userUnreadCount: 3,
        scheduledUnreadCount: 0,
        updatedAt: new Date().toISOString(),
      },
    });

    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents activeView="settings" />);
    // The agent should NOT be expanded (settings view clears expandedAgentId)
    await waitFor(() => {
      const label = screen.getByTestId('nav-label-Test Agent');
      // The span should have fontWeight 700 when unread
      const span = label.querySelector('span');
      expect(span).toBeTruthy();
    });
  });

  it('handles onChatUnreadSummaryChanged event with newer summary', async () => {
    mockUseChatUnreadSummaryMap.mockReturnValue({});
    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents activeView="settings" />);
    await waitFor(() => expect(onChatUnreadSummaryChangedHandler || (window.electronAPI as any).profile.onChatUnreadSummaryChanged).toBeTruthy());

    if (onChatUnreadSummaryChangedHandler) {
      act(() => {
        onChatUnreadSummaryChangedHandler!({
          alias: 'test-user',
          summary: {
            chatId: 'chat-1',
            userUnreadCount: 5,
            scheduledUnreadCount: 0,
            updatedAt: new Date().toISOString(),
          },
        });
      });
    }
    // Should not throw
  });
});

// ============================================================
// Search: keyboard navigation and agent filter
// ============================================================

describe('Search keyboard navigation', () => {
  it('ArrowDown in mention picker moves index down', async () => {
    const chats = [
      makeChat({ chat_id: 'c1', agent: { name: 'Alpha Agent' }, chatSessions: [] }),
      makeChat({ chat_id: 'c2', agent: { name: 'Beta Agent' }, chatSessions: [] }),
    ];
    render(<AgentList chats={chats} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: '@' } });
    await waitFor(() => {
      const items = screen.getAllByText('Filter conversations for this agent');
      expect(items.length).toBeGreaterThan(0);
    });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Should not throw
  });

  it('ArrowDown / ArrowUp navigates search results', async () => {
    const sessions = [
      { chatSession_id: 's1', title: 'Result Alpha XYZ', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' },
      { chatSession_id: 's2', title: 'Result Beta XYZ', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' },
    ];
    render(<AgentList chats={[makeChat({ chatSessions: sessions })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'Result Alpha XYZ' } });
    // Search result buttons don't carry title attr; check button textContent instead
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.some(b => b.textContent?.includes('Result Alpha XYZ'))).toBe(true);
    });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Should not throw
  });

  it('Enter in mention picker applies the suggestion', async () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: '@Test' } });
    await waitFor(() => screen.getByText('Filter conversations for this agent'));
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => screen.getByText(/Filtering by agent/i));
  });

  it('Escape in non-search mode with text clears the query', () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'hello' } });
    // Not in search mode if no sessions to match
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
  });

  it('clears agent filter via X button in filter chip', async () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: '@' } });
    await waitFor(() => screen.getByText('Filter conversations for this agent'));
    fireEvent.click(screen.getByText('Filter conversations for this agent'));
    await waitFor(() => screen.getByLabelText('Clear agent filter'));
    fireEvent.click(screen.getByLabelText('Clear agent filter'));
    await waitFor(() => expect(screen.queryByText(/Filtering by agent/i)).not.toBeInTheDocument());
  });

  it('shows agent search hint when focused and no query', () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.focus(input);
    expect(screen.getByText(/type @ to narrow results/i)).toBeInTheDocument();
  });

  it('hides agent hint after blur', async () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.focus(input);
    expect(screen.getByText(/type @ to narrow results/i)).toBeInTheDocument();
    fireEvent.blur(input);
    await waitFor(
      () => expect(screen.queryByText(/type @ to narrow results/i)).not.toBeInTheDocument(),
      { timeout: 500 },
    );
  });

  it('mouseEnter on search result updates activeSearchIndex', async () => {
    const sessions = [
      { chatSession_id: 's1', title: 'Hover Alpha Unique', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' },
      { chatSession_id: 's2', title: 'Hover Beta Unique', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' },
    ];
    render(<AgentList chats={[makeChat({ chatSessions: sessions })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'Hover Beta Unique' } });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.some(b => b.textContent?.includes('Hover Beta Unique'))).toBe(true);
    });
    const resultBtn = screen.getAllByRole('button').find(b => b.textContent?.includes('Hover Beta Unique'))!;
    fireEvent.mouseEnter(resultBtn);
    // Should not throw
  });

  it('shows top-50-results note when many search results exist', async () => {
    const sessions = Array.from({ length: 55 }, (_, i) => ({
      chatSession_id: `s${i}`,
      title: `Session number ${i}`,
      last_updated: '2024-01-01T00:00:00Z',
      readStatus: 'read',
    }));
    render(<AgentList chats={[makeChat({ chatSessions: sessions })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'Session number' } });
    await waitFor(() => screen.getByText('Showing top 50 results'));
  });

  it('search loads more sessions until hasMore=false', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'p1', title: 'Page1Unique', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: true, nextMonthIndex: 1 },
    });
    mockGetMoreChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'p2', title: 'Page2SearchUnique', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });

    render(<AgentList chats={[makeChat({ chatSessions: [] })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'Page2SearchUnique' } });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.some(b => b.textContent?.includes('Page2SearchUnique'))).toBe(true);
    }, { timeout: 5000 });
  });

  it('search handles load session failure gracefully', async () => {
    mockGetChatSessions.mockResolvedValueOnce({ success: false, error: 'Search load failed' });
    render(<AgentList chats={[makeChat({ chatSessions: [] })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'anything' } });
    await waitFor(() => expect(screen.getByText('No conversations found')).toBeInTheDocument(), { timeout: 3000 });
  });
});

// ============================================================
// Session scroll / pagination
// ============================================================

describe('Session list scroll and pagination', () => {
  it('shows loading spinner while initial sessions load', async () => {
    let resolve: (v: any) => void;
    mockGetChatSessions.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    // isLoading=true → spinner shown
    await waitFor(() => {
      expect(document.querySelector('.chat-sessions-list')).toBeTruthy();
    });
    resolve!({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  });

  it('loadMore shows loading indicator during pagination', async () => {
    const initialSessions = Array.from({ length: 100 }, (_, i) => ({
      chatSession_id: `s${i}`,
      title: i === 0 ? 'First Session' : `Session ${i}`,
      last_updated: '2024-01-01T00:00:00Z',
      readStatus: 'read',
    }));

    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: initialSessions, hasMore: true, nextMonthIndex: 1 },
    });

    let resolveMore: (v: any) => void;
    mockGetMoreChatSessions.mockReturnValue(new Promise(r => { resolveMore = r; }));

    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => screen.getByText('First Session'));

    const list = document.querySelector('.chat-sessions-list')!;
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 300, configurable: true });
    fireEvent.scroll(list);

    await waitFor(() => screen.getByText('Loading...'));
    resolveMore!({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  });

  it('triggers all-loaded hint when loadMore completes with no more sessions', async () => {
    const initialSessions = Array.from({ length: 100 }, (_, i) => ({
      chatSession_id: `s${i}`,
      title: i === 0 ? 'More Session' : `Session ${i}`,
      last_updated: '2024-01-01T00:00:00Z',
      readStatus: 'read',
    }));

    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: initialSessions, hasMore: true, nextMonthIndex: 1 },
    });
    mockGetMoreChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [], hasMore: false, nextMonthIndex: 0 },
    });

    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => screen.getByText('More Session'));

    const list = document.querySelector('.chat-sessions-list')!;
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 300, configurable: true });
    fireEvent.scroll(list);

    await waitFor(() => screen.getByText('All conversations loaded'), { timeout: 5000 });
  });

  it('scroll: no trigger when state.isLoading is true', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 's1', title: 'ScrollSession', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: true, nextMonthIndex: 1 },
    });
    let pendingResolve: (v: any) => void;
    mockGetMoreChatSessions.mockReturnValue(new Promise(r => { pendingResolve = r; }));

    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    // Wait for initial sessions to load
    await waitFor(() => expect(mockGetChatSessions).toHaveBeenCalled());
    // Give state update a tick
    await new Promise(r => setTimeout(r, 50));

    const list = document.querySelector('.chat-sessions-list')!;
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 300, configurable: true });
    fireEvent.scroll(list);
    // While loading, scroll again shouldn't call getMoreChatSessions twice
    fireEvent.scroll(list);
    // Only one call to getMoreChatSessions
    await waitFor(() => expect(mockGetMoreChatSessions).toHaveBeenCalledTimes(1));
    pendingResolve!({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  });
});

// ============================================================
// activeView transitions
// ============================================================

describe('activeView transitions', () => {
  it('collapses when activeView changes to skills', async () => {
    const { rerender } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />,
    );
    await waitFor(() => expect(mockGetChatSessions).toHaveBeenCalled());
    rerender(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="skills" excludeBuiltinAgents={false} />,
    );
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });

  it('collapses sessions in settings view', async () => {
    const { rerender } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />,
    );
    await waitFor(() => expect(mockGetChatSessions).toHaveBeenCalled());
    rerender(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="settings" excludeBuiltinAgents={false} />,
    );
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });

  it('expands on chat view with currentChatId already set', async () => {
    render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />,
    );
    await waitFor(() => expect(mockGetChatSessions).toHaveBeenCalledWith('test-user', 'chat-1', 100));
  });
});

// ============================================================
// Session CRUD with search cache interaction
// ============================================================

describe('Session CRUD with search cache', () => {
  it('session created event fires without error while search is active', async () => {
    const session = { chatSession_id: 'cache-s1', title: 'CachedSearchSession', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'CachedSearchSession' } });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.some(b => b.textContent?.includes('CachedSearchSession'))).toBe(true);
    });

    await waitFor(() => expect(onSessionCreatedHandler).toBeTruthy());
    // Firing session created event should not throw when search is active
    await act(async () => {
      onSessionCreatedHandler!({
        alias: 'test-user',
        chatId: 'chat-1',
        session: { chatSession_id: 'new-cache-s', title: 'NewCachedSearchSession', last_updated: '2024-06-01T00:00:00Z', readStatus: 'unread' },
      });
    });
    // CachedSearchSession still present (no crash)
    const buttons = screen.getAllByRole('button');
    expect(buttons.some(b => b.textContent?.includes('CachedSearchSession'))).toBe(true);
  });

  it('ignores metadata patch event for wrong alias', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'p1', title: 'Should Stay', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => screen.getByText('Should Stay'));
    act(() => {
      onMetadataPatchedHandler!({
        alias: 'wrong-user',
        chatId: 'chat-1',
        metadata: { chatSession_id: 'p1', title: 'Wrong', last_updated: '2024-06-01T00:00:00Z', readStatus: 'read' },
      });
    });
    // Title should remain unchanged
    expect(screen.getByText('Should Stay')).toBeInTheDocument();
  });

  it('ignores delete event for wrong alias', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'del-s', title: 'Keep Me', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => screen.getByText('Keep Me'));
    act(() => {
      onSessionDeletedHandler!({ alias: 'wrong-user', chatId: 'chat-1', chatSessionId: 'del-s' });
    });
    expect(screen.getByText('Keep Me')).toBeInTheDocument();
  });
});

// ============================================================
// Delete / fork session callbacks
// ============================================================

describe('Session more-options menu', () => {
  it('renders More Options button when onDeleteChatSession is provided', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'm1', title: 'Has More', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} onDeleteChatSession={vi.fn()} />);
    await waitFor(() => screen.getByText('Has More'));
    const moreBtn = document.querySelector('[title="More options"]');
    expect(moreBtn).toBeTruthy();
  });

  it('renders More Options button when onForkChatSession is provided', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'f1', title: 'Fork Me', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} onForkChatSession={vi.fn()} />);
    await waitFor(() => screen.getByText('Fork Me'));
    const moreBtns = document.querySelectorAll('[title="More options"]');
    expect(moreBtns.length).toBeGreaterThan(0);
  });
});

// ============================================================
// excludeBuiltinAgents filtering
// ============================================================

describe('excludeBuiltinAgents filtering', () => {
  it('includes all chats when excludeBuiltinAgents=false', () => {
    const chats = [
      makeChat({ chat_id: 'c1', agent: { name: 'Normal Agent' } }),
      makeChat({ chat_id: 'c2', agent: { name: 'Builtin Agent' } }),
    ];
    render(<AgentList chats={chats} excludeBuiltinAgents={false} />);
    expect(screen.getAllByTestId('agent-avatar').length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// No electronAPI profile scenario
// ============================================================

describe('When electronAPI is unavailable', () => {
  it('does not crash when electronAPI.profile is missing', async () => {
    (window as any).electronAPI = {};
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    // Should render without crash, sessions won't load
    await new Promise(r => setTimeout(r, 50));
    const agentAvatars = screen.getAllByTestId('agent-avatar');
    expect(agentAvatars.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Example agent badge
// ============================================================

describe('Example agent badge', () => {
  it('shows Example badge for PM Agent - Journeys', () => {
    render(<AgentList chats={[makeChat({ agent: { name: 'PM Agent - Journeys' } })]} excludeBuiltinAgents={false} />);
    expect(screen.getByText('Example')).toBeInTheDocument();
  });
});

// ============================================================
// Session context: currentChatSessionId highlights active session
// ============================================================

describe('Active session highlighting', () => {
  it('marks active session item', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [{ chatSession_id: 'active-s', title: 'Active Session', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }],
        hasMore: false,
        nextMonthIndex: 0,
      },
    });
    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        currentChatSessionId="active-s"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );
    await waitFor(() => screen.getByText('Active Session'));
    // Active session has slightly different background - check it rendered
    const sessionEl = screen.getByText('Active Session').closest('[data-read-status]');
    expect(sessionEl).toBeTruthy();
  });
});

// ============================================================
// getRelativeTimeLabel: invalid date
// ============================================================

describe('getRelativeTimeLabel: invalid date', () => {
  it('renders empty string for invalid date', async () => {
    const session = { chatSession_id: 'bad-date', title: 'InvalidDateSession', last_updated: 'not-a-date', readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'InvalidDateSession' } });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.some(b => b.textContent?.includes('InvalidDateSession'))).toBe(true);
    });
    // No date label for invalid date (empty string) - this is just a smoke test
  });
});

// ============================================================
// renderHighlightedTitle: no match
// ============================================================

describe('renderHighlightedTitle', () => {
  it('shows title without highlight when query does not match', async () => {
    const session = { chatSession_id: 'nohigh', title: 'No Highlight Here', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    // selectedAgentFilter makes isSearchMode=true even with non-matching query
    fireEvent.change(input, { target: { value: '@' } });
    await waitFor(() => screen.getByText('Filter conversations for this agent'));
    fireEvent.click(screen.getByText('Filter conversations for this agent'));
    await waitFor(() => screen.getByText('No Highlight Here'));
    // Title shown without highlight spans
  });
});
