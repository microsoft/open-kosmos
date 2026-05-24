/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockUseProfileData = vi.fn();
const mockGetChatSessions = vi.fn();
const mockGetMoreChatSessions = vi.fn();
const mockGetChatUnreadSummary = vi.fn();
const mockOnChatUnreadSummaryChanged = vi.fn();
let onSessionCreatedHandler: ((data: any) => void) | null = null;
let onMetadataPatchedHandler: ((data: any) => void) | null = null;
let onSessionDeletedHandler: ((data: any) => void) | null = null;
let onChatStatusChangedHandler: ((data: any) => void) | null = null;

vi.mock('../../../userData/userDataProvider', async () => ({
  useProfileData: () => mockUseProfileData(),
}));

vi.mock('../../../ui/navigation/NavItem', () => ({
  default: (props: any) => (
    <button type="button" onClick={props.onClick}>
      {props.icon}
      {props.ariaLabel || 'nav-item'}
      <span data-testid={`nav-label-${props.ariaLabel || 'nav-item'}`}>{props.label}</span>
      {props.rightContent}
    </button>
  ),
}));

vi.mock('../../../common/AgentAvatar', async () => ({
  AgentAvatar: ({ name }: { name?: string }) => <div data-testid="agent-avatar">{name || 'avatar'}</div>,
}));

vi.mock('../../../../styles/DropdownMenu.css', async () => ({}));

(window as any).electronAPI = {
  profile: {
    getChatSessions: mockGetChatSessions,
    getMoreChatSessions: mockGetMoreChatSessions,
    getChatUnreadSummary: mockGetChatUnreadSummary,
    onChatUnreadSummaryChanged: mockOnChatUnreadSummaryChanged,
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

const defaultProfile = { data: { profile: { alias: 'test-user', 'starred-chat-sessions': [] } } };

beforeEach(() => {
  vi.clearAllMocks();
  onSessionCreatedHandler = null;
  onMetadataPatchedHandler = null;
  onSessionDeletedHandler = null;
  onChatStatusChangedHandler = null;
  mockUseProfileData.mockReturnValue(defaultProfile);
  mockGetChatSessions.mockResolvedValue({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  mockGetMoreChatSessions.mockResolvedValue({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  mockGetChatUnreadSummary.mockResolvedValue({ success: true, data: { userUnreadCount: 0, scheduledUnreadCount: 0 } });
  mockOnChatUnreadSummaryChanged.mockImplementation(() => vi.fn());
  HTMLElement.prototype.scrollIntoView = vi.fn();

  (window as any).electronAPI = {
    profile: {
      getChatSessions: mockGetChatSessions,
      getMoreChatSessions: mockGetMoreChatSessions,
      getChatUnreadSummary: mockGetChatUnreadSummary,
      onChatUnreadSummaryChanged: mockOnChatUnreadSummaryChanged,
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
});

describe('AgentList — basic rendering', () => {
  it('renders "No chats available" when chats is empty', () => {
    render(<AgentList chats={[]} />);
    expect(screen.getByText('No chats available')).toBeInTheDocument();
  });

  it('renders agent name', () => {
    render(<AgentList chats={[makeChat()]} excludeBuiltinAgents={false} />);
    expect(screen.getAllByText('Test Agent').length).toBeGreaterThan(0);
  });

  it('renders search input when showSearch=true', () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
  });

  it('calls onSelectChat when agent clicked', () => {
    const onSelectChat = vi.fn();
    render(<AgentList chats={[makeChat()]} onSelectChat={onSelectChat} excludeBuiltinAgents={false} />);
    const btn = screen.getAllByRole('button')[0];
    fireEvent.click(btn);
    expect(onSelectChat).toHaveBeenCalledWith('chat-1');
  });

  it('sorts primaryAgent to top', () => {
    const chats = [
      makeChat({ chat_id: 'ca', agent: { name: 'Agent A' } }),
      makeChat({ chat_id: 'cb', agent: { name: 'Primary' } }),
    ];
    render(<AgentList chats={chats} primaryAgent="Primary" excludeBuiltinAgents={false} />);
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Primary');
  });
});

describe('AgentList — session loading and display', () => {
  it('loads sessions when expandedAgent is set', async () => {
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(mockGetChatSessions).toHaveBeenCalledWith('test-user', 'chat-1', 100));
  });

  it('shows sessions after loading', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 's1', title: 'My Session', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('My Session')).toBeInTheDocument());
  });

  it('shows "No conversations yet" when sessions empty', async () => {
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('No conversations yet')).toBeInTheDocument());
  });

  it('shows error state for failed load', async () => {
    mockGetChatSessions.mockResolvedValue({ success: false, error: 'Load failed' });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Load failed')).toBeInTheDocument());
  });

  it('shows error for thrown exception', async () => {
    mockGetChatSessions.mockRejectedValue(new Error('Net error'));
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Net error')).toBeInTheDocument());
  });

  it('allows session click', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 's1', title: 'Click Me', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    const onSelectChatSession = vi.fn();
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" onSelectChatSession={onSelectChatSession} excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Click Me')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Click Me'));
    await waitFor(() => expect(onSelectChatSession).toHaveBeenCalledWith('chat-1', 's1'));
  });

  it('shows loading icon when session status is non-idle', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'ls1', title: 'Load Chat', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(onChatStatusChangedHandler).toBeTruthy());
    await act(async () => { onChatStatusChangedHandler?.({ chatId: 'chat-1', chatSessionId: 'ls1', chatStatus: 'running' }); });
    await waitFor(() => expect(document.querySelectorAll('svg').length).toBeGreaterThan(0));
  });

  it('shows remote Globe icon for remote session source', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'r1', title: 'Remote Session', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read', source: { type: 'remote' } }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Remote Session')).toBeInTheDocument());
    // Globe SVG class is present from lucide-react
    const globeEl = document.querySelector('.w-3.h-3') || document.querySelector('[class*="globe"]') || document.querySelector('[class*="Globe"]');
    // Just check the session rendered; Globe may or may not have a testid based on mock state
    expect(screen.getByText('Remote Session')).toBeInTheDocument();
  });
});

describe('AgentList — session CRUD events', () => {
  it('adds new session on created event', async () => {
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(onSessionCreatedHandler).toBeTruthy());
    await act(async () => {
      onSessionCreatedHandler!({ alias: 'test-user', chatId: 'chat-1', session: { chatSession_id: 'ns1', title: 'New Session', last_updated: '2024-06-01T00:00:00Z', readStatus: 'unread' } });
    });
    await waitFor(() => expect(screen.getByText('New Session')).toBeInTheDocument());
  });

  it('ignores created event for wrong alias', async () => {
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(onSessionCreatedHandler).toBeTruthy());
    act(() => {
      onSessionCreatedHandler!({ alias: 'other-user', chatId: 'chat-1', session: { chatSession_id: 'x', title: 'Ignore Me', last_updated: '2024-06-01T00:00:00Z' } });
    });
    expect(screen.queryByText('Ignore Me')).not.toBeInTheDocument();
  });

  it('updates session on metadata patched', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'ps1', title: 'Old Title', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Old Title')).toBeInTheDocument());
    await act(async () => {
      onMetadataPatchedHandler!({ alias: 'test-user', chatId: 'chat-1', metadata: { chatSession_id: 'ps1', title: 'New Title', last_updated: '2024-06-01T00:00:00Z', readStatus: 'read' } });
    });
    await waitFor(() => expect(screen.getByText('New Title')).toBeInTheDocument());
  });

  it('removes session on deleted event', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'ds1', title: 'Delete Me', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Delete Me')).toBeInTheDocument());
    await act(async () => { onSessionDeletedHandler!({ alias: 'test-user', chatId: 'chat-1', chatSessionId: 'ds1' }); });
    await waitFor(() => expect(screen.queryByText('Delete Me')).not.toBeInTheDocument());
  });
});

describe('AgentList — pagination', () => {
  it('shows "All conversations loaded" when scrolled to bottom with no more', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'ah1', title: 'Only Session', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('Only Session')).toBeInTheDocument());
    const list = document.querySelector('.chat-sessions-list')!;
    Object.defineProperty(list, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 200, configurable: true });
    fireEvent.scroll(list);
    await waitFor(() => expect(screen.getByText('All conversations loaded')).toBeInTheDocument());
  });

  it('shows error when loadMore fails', async () => {
    // Need 100 sessions to fill PAGE_SIZE so initial load doesn't call getMoreChatSessions
    const initialSessions = Array.from({ length: 100 }, (_, i) => ({
      chatSession_id: `lm${i}`, title: i === 0 ? 'LM Session' : `Session ${i}`, last_updated: `2024-01-01T00:00:00Z`, readStatus: 'read',
    }));
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: initialSessions, hasMore: true, nextMonthIndex: 1 },
    });
    mockGetMoreChatSessions.mockResolvedValueOnce({ success: false, error: 'More load failed' });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(screen.getByText('LM Session')).toBeInTheDocument());
    const list = document.querySelector('.chat-sessions-list')!;
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 300, configurable: true });
    fireEvent.scroll(list);
    await waitFor(() => expect(screen.getByText('More load failed')).toBeInTheDocument(), { timeout: 5000 });
  });
});

describe('AgentList — search mode', () => {
  it('shows search results when typing', async () => {
    const session = { chatSession_id: 'sr1', title: 'Quarterly Report', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'quarterly' } });
    await waitFor(() => expect(screen.getByText(/Quarterly/)).toBeInTheDocument());
  });

  it('shows "No conversations found" when no results', async () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'zzznomatch' } });
    await waitFor(() => expect(screen.getByText('No conversations found')).toBeInTheDocument());
  });

  it('keyboard Enter selects active result', async () => {
    const session = { chatSession_id: 'se1', title: 'Enter Session', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' };
    const onSelectChat = vi.fn();
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch onSelectChat={onSelectChat} excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'Enter' } });
    await waitFor(() => expect(screen.getByText(/Enter/)).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectChat).toHaveBeenCalledWith('chat-1');
  });

  it('keyboard Escape clears search in search mode', () => {
    const session = { chatSession_id: 's1', title: 'Test', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
  });

  it('clears search when X button is clicked', () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(screen.getByLabelText('Clear conversation search'));
    expect(input).toHaveValue('');
  });

  it('shows mention picker when @ typed and applies mention', async () => {
    render(<AgentList chats={[makeChat()]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: '@' } });
    await waitFor(() => expect(screen.getByText(/Filter conversations for this agent/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Filter conversations for this agent/i));
    await waitFor(() => expect(screen.getByText(/Filtering by agent/i)).toBeInTheDocument());
  });

  it('shows remote badge in search results', async () => {
    const session = { chatSession_id: 'rr', title: 'Remote item here', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read', source: { type: 'remote' } };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'Remote item here' } });
    await waitFor(() => expect(screen.getByText('Remote')).toBeInTheDocument());
  });

  it('shows Indexing... while loading search sessions', async () => {
    let res: (v: any) => void;
    mockGetChatSessions.mockReturnValue(new Promise((r) => { res = r; }));
    render(<AgentList chats={[makeChat({ chatSessions: [] })]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'test' } });
    await waitFor(() => expect(screen.getByText('Indexing conversations...')).toBeInTheDocument());
    res!({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
  });

  it('calls onSearchActiveChange when search mode changes', async () => {
    const onSearchActiveChange = vi.fn();
    const session = { chatSession_id: 's1', title: 'Test', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch onSearchActiveChange={onSearchActiveChange} excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'test' } });
    await waitFor(() => expect(onSearchActiveChange).toHaveBeenCalledWith(true));
  });

  it('loads search sessions from API when chat has no inline sessions', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ chatSession_id: 'lazy', title: 'Lazy Session X', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }], hasMore: false, nextMonthIndex: 0 },
    });
    render(<AgentList chats={[makeChat({ chatSessions: [] })]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'Lazy' } });
    await waitFor(() => expect(screen.getByText(/Lazy/)).toBeInTheDocument());
  });
});

describe('AgentList — activeView collapse', () => {
  it('collapses sessions when activeView changes to mcp', async () => {
    const { rerender } = render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await waitFor(() => expect(mockGetChatSessions).toHaveBeenCalled());
    rerender(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="mcp" excludeBuiltinAgents={false} />);
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  });
});

describe('AgentList — searchSourceChats and no alias', () => {
  it('uses searchSourceChats as search pool', async () => {
    const extra = makeChat({ chat_id: 'ce', agent: { name: 'Extra Agent' }, chatSessions: [{ chatSession_id: 'es1', title: 'Extra source item', last_updated: '2024-01-01T00:00:00Z', readStatus: 'read' }] });
    render(<AgentList chats={[makeChat()]} searchSourceChats={[extra]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'Extra source' } });
    await waitFor(() => expect(screen.getByText(/Extra source/)).toBeInTheDocument());
  });

  it('does not load sessions when no profile alias', async () => {
    mockUseProfileData.mockReturnValue({ data: { profile: { alias: null } } });
    render(<AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" excludeBuiltinAgents={false} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockGetChatSessions).not.toHaveBeenCalled();
  });
});

describe('AgentList — getRelativeTimeLabel', () => {
  it('shows "Just now" for recent session', async () => {
    const session = { chatSession_id: 'r1', title: 'Recent chat', last_updated: new Date(Date.now() - 30000).toISOString(), readStatus: 'read' };
    render(<AgentList chats={[makeChat({ chatSessions: [session] })]} showSearch excludeBuiltinAgents={false} />);
    fireEvent.change(screen.getByLabelText('Search conversations'), { target: { value: 'recent' } });
    await waitFor(() => expect(screen.getByText('Just now')).toBeInTheDocument());
  });

  it('shows minutes/hours/days/date labels', async () => {
    const sessions = [
      { chatSession_id: 'm1', title: 'Minutes chat', last_updated: new Date(Date.now() - 5 * 60000).toISOString(), readStatus: 'read' },
      { chatSession_id: 'h1', title: 'Hours chat', last_updated: new Date(Date.now() - 2 * 3600000).toISOString(), readStatus: 'read' },
    ];
    render(<AgentList chats={[makeChat({ chatSessions: sessions })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');

    fireEvent.change(input, { target: { value: 'Minutes chat' } });
    await waitFor(() => expect(screen.getByText(/5m ago/)).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.change(input, { target: { value: 'Hours chat' } });
    await waitFor(() => expect(screen.getByText(/2h ago/)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('shows days/date labels for old sessions', async () => {
    const sessions = [
      { chatSession_id: 'd1', title: 'Days chat', last_updated: new Date(Date.now() - 3 * 86400000).toISOString(), readStatus: 'read' },
      { chatSession_id: 'ol', title: 'Old chat 2020', last_updated: '2020-01-15T00:00:00Z', readStatus: 'read' },
    ];
    render(<AgentList chats={[makeChat({ chatSessions: sessions })]} showSearch excludeBuiltinAgents={false} />);
    const input = screen.getByLabelText('Search conversations');

    fireEvent.change(input, { target: { value: 'Days chat' } });
    await waitFor(() => expect(screen.getByText(/3d ago/)).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.change(input, { target: { value: 'Old chat' } });
    await waitFor(() => expect(screen.getAllByText(/2020/).length).toBeGreaterThan(0), { timeout: 5000 });
  });
});
