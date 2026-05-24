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

vi.mock('../../../userData/userDataProvider', async () => ({
  useProfileData: () => mockUseProfileData(),
}));

vi.mock('../../../ui/navigation/NavItem', () => ({ default: (props: any) => (
  <button type="button" onClick={props.onClick}>
    {props.icon}
    {props.ariaLabel || 'nav-item'}
    <span data-testid={`nav-label-${props.ariaLabel || 'nav-item'}`}>{props.label}</span>
    {props.rightContent}
  </button>
) }));

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
    onChatStatusChanged: vi.fn(() => vi.fn()),
  },
};

import AgentList from '../AgentList';

describe('AgentList starred sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onSessionCreatedHandler = null;
    onMetadataPatchedHandler = null;
    onSessionDeletedHandler = null;
    mockGetChatSessions.mockResolvedValue({
      success: true,
      data: {
        sessions: [],
        hasMore: false,
        nextMonthIndex: 0,
      },
    });
    mockGetMoreChatSessions.mockResolvedValue({
      success: true,
      data: {
        sessions: [],
        hasMore: false,
        nextMonthIndex: 0,
      },
    });
    mockGetChatUnreadSummary.mockResolvedValue({
      success: true,
      data: {
        chatId: 'chat-default',
        userUnreadCount: 0,
        scheduledUnreadCount: 0,
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
    });
    mockOnChatUnreadSummaryChanged.mockImplementation(() => vi.fn());
    HTMLElement.prototype.scrollIntoView = vi.fn();

    mockUseProfileData.mockReturnValue({
      data: {
        profile: {
          alias: 'test-user',
          'starred-chat-sessions': [
            {
              chatId: 'chat-pm-agent',
              chatSessionId: 'session-starred-1',
              title: 'Builtin PM Session',
              lastUpdated: '2026-03-20T12:00:00.000Z',
              readStatus: 'read',
              agentName: 'PM Agent',
              agentEmoji: '🦄',
              agentAvatar: '',
              agentSource: 'ON-DEVICE',
              agentVersion: '1.1.22',
              starredAt: '2026-03-20T11:59:00.000Z',
            },
          ],
        },
      },
    });
  });

  it('renders a starred session for a built-in PM Agent', async () => {
    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-pm-agent',
            chat_type: 'single_agent',
            agent: {
              name: 'PM Agent',
              role: 'assistant',
              emoji: '🦄',
              avatar: '',
              version: '1.1.22',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [],
          } as any,
        ]}
      />,
    );

    await waitFor(() => {
      expect(mockGetChatUnreadSummary).toHaveBeenCalled();
    });

    expect(screen.getByText('Starred')).toBeInTheDocument();
    expect(screen.getByText('Builtin PM Session')).toBeInTheDocument();
  });

  it('injects and scrolls the selected session into view when it is not in the loaded paginated list', async () => {
    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-kobi',
            chat_type: 'single_agent',
            agent: {
              name: 'Custom Research Agent',
              role: 'assistant',
              emoji: '🤖',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [
              {
                chatSession_id: 'session-target',
                title: 'Deep archived session',
                last_updated: '2026-03-20T10:00:00.000Z',
                readStatus: 'read',
              },
            ],
          } as any,
        ]}
        currentChatId="chat-kobi"
        currentChatSessionId="session-target"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Deep archived session')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it('filters scheduled sessions out of the agent list', async () => {
    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-scheduled-visible',
            chat_type: 'single_agent',
            agent: {
              name: 'Scheduled Friendly Agent',
              role: 'assistant',
              emoji: '⏰',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [
              {
                chatSession_id: 'session-scheduled',
                title: 'Scheduled run session',
                last_updated: '2026-03-20T10:00:00.000Z',
                readStatus: 'read',
                schedulerJobId: 'sched-job-1',
              },
              {
                chatSession_id: 'session-normal',
                title: 'Normal session',
                last_updated: '2026-03-20T09:00:00.000Z',
                readStatus: 'read',
              },
            ],
          } as any,
        ]}
        currentChatId="chat-scheduled-visible"
        currentChatSessionId="session-scheduled"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Normal session')).toBeInTheDocument();
    });

    expect(screen.queryByText('Scheduled run session')).not.toBeInTheDocument();

  });

  it('excludes scheduled sessions from conversation search results', async () => {
    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-search-scheduled',
            chat_type: 'single_agent',
            agent: {
              name: 'Search Agent',
              role: 'assistant',
              emoji: '🔎',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [
              {
                chatSession_id: 'session-scheduled-search',
                title: 'Scheduled digest result',
                last_updated: '2026-03-20T10:00:00.000Z',
                readStatus: 'read',
                schedulerJobId: 'sched-job-search-1',
              },
            ],
          } as any,
        ]}
        showSearch
        excludeBuiltinAgents={false}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'digest' },
    });

    await waitFor(() => {
      expect(screen.getByText('No conversations found')).toBeInTheDocument();
    });
  });

  it('keeps scheduled sessions excluded after search cache refresh on session created', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [],
        hasMore: false,
        nextMonthIndex: 0,
      },
    });

    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-live-search',
            chat_type: 'single_agent',
            agent: {
              name: 'Live Search Agent',
              role: 'assistant',
              emoji: '📡',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [],
          } as any,
        ]}
        showSearch
        excludeBuiltinAgents={false}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'digest' },
    });

    await waitFor(() => {
      expect(screen.getByText('No conversations found')).toBeInTheDocument();
    });

    expect(onSessionCreatedHandler).toBeTruthy();

    await act(async () => {
      onSessionCreatedHandler?.({
        alias: 'test-user',
        chatId: 'chat-live-search',
        session: {
          chatSession_id: 'session-live-scheduled',
          title: 'Fresh scheduled digest',
          last_updated: '2026-03-20T10:30:00.000Z',
          readStatus: 'read',
          schedulerJobId: 'sched-live-1',
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('No conversations found')).toBeInTheDocument();
    });
  });

  it('keeps scheduled sessions excluded after search cache refresh on metadata patched', async () => {
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [
          {
            chatSession_id: 'session-metadata-target',
            title: 'Normal digest result',
            last_updated: '2026-03-20T10:00:00.000Z',
            readStatus: 'read',
          },
        ],
        hasMore: false,
        nextMonthIndex: 0,
      },
    });

    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-metadata-search',
            chat_type: 'single_agent',
            agent: {
              name: 'Metadata Agent',
              role: 'assistant',
              emoji: '🧪',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [],
          } as any,
        ]}
        showSearch
        excludeBuiltinAgents={false}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'digest' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Metadata Agent/i })).toHaveTextContent('Normal digest result');
    });

    expect(onMetadataPatchedHandler).toBeTruthy();

    await act(async () => {
      onMetadataPatchedHandler?.({
        alias: 'test-user',
        chatId: 'chat-metadata-search',
        metadata: {
          chatSession_id: 'session-metadata-target',
          title: 'Scheduled digest result',
          last_updated: '2026-03-20T10:35:00.000Z',
          readStatus: 'read',
          schedulerJobId: 'sched-metadata-1',
        },
        timestamp: Date.now(),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('No conversations found')).toBeInTheDocument();
    });
  });

  it('scrolls when the selected session changes within an already loaded session list', async () => {
    const { rerender } = render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-existing',
            chat_type: 'single_agent',
            agent: {
              name: 'Custom Existing Agent',
              role: 'assistant',
              emoji: '🤖',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [
              {
                chatSession_id: 'session-a',
                title: 'Session A',
                last_updated: '2026-03-20T10:00:00.000Z',
                readStatus: 'read',
              },
              {
                chatSession_id: 'session-b',
                title: 'Session B',
                last_updated: '2026-03-20T09:00:00.000Z',
                readStatus: 'read',
              },
            ],
          } as any,
        ]}
        currentChatId="chat-existing"
        currentChatSessionId="session-a"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => {
      expect(mockGetChatSessions).toHaveBeenCalled();
    });

    (HTMLElement.prototype.scrollIntoView as Mock).mockClear();

    rerender(
      <AgentList
        chats={[
          {
            chat_id: 'chat-existing',
            chat_type: 'single_agent',
            agent: {
              name: 'Custom Existing Agent',
              role: 'assistant',
              emoji: '🤖',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [
              {
                chatSession_id: 'session-a',
                title: 'Session A',
                last_updated: '2026-03-20T10:00:00.000Z',
                readStatus: 'read',
              },
              {
                chatSession_id: 'session-b',
                title: 'Session B',
                last_updated: '2026-03-20T09:00:00.000Z',
                readStatus: 'read',
              },
            ],
          } as any,
        ]}
        currentChatId="chat-existing"
        currentChatSessionId="session-b"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => {
      expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it('bolds a collapsed agent name when unread count increases and clears bold after expansion', async () => {
    let unreadSummaryListener: ((payload: any) => void) | undefined;
    mockOnChatUnreadSummaryChanged.mockImplementation((listener) => {
      unreadSummaryListener = listener;
      return vi.fn();
    });
    mockGetChatUnreadSummary.mockResolvedValue({
      success: true,
      data: {
        chatId: 'chat-kobi',
        userUnreadCount: 1,
        scheduledUnreadCount: 0,
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
    });

    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-kobi',
            chat_type: 'single_agent',
            agent: {
              name: 'Custom Research Agent',
              role: 'assistant',
              emoji: '🤖',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [],
          } as any,
        ]}
        activeView="settings"
        excludeBuiltinAgents={false}
      />,
    );

    const label = await screen.findByTestId('nav-label-Custom Research Agent');

    await waitFor(() => {
      expect(mockGetChatUnreadSummary).toHaveBeenCalledWith('test-user', 'chat-kobi');
      expect(label.firstChild).toHaveStyle({ fontWeight: '400' });
    });
    expect(screen.queryByText('1')).not.toBeInTheDocument();

    await act(async () => {
      unreadSummaryListener?.({
        alias: 'test-user',
        summary: {
          chatId: 'chat-kobi',
          userUnreadCount: 3,
          scheduledUnreadCount: 0,
          updatedAt: '2026-03-20T10:05:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '700' });
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button')[0]);
    });

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '400' });
    });
  });

  it('ignores stale unread events when determining whether to bold a collapsed agent name', async () => {
    let unreadSummaryListener: ((payload: any) => void) | undefined;
    mockOnChatUnreadSummaryChanged.mockImplementation((listener) => {
      unreadSummaryListener = listener;
      return vi.fn();
    });
    mockGetChatUnreadSummary.mockResolvedValue({
      success: true,
      data: {
        chatId: 'chat-kobi',
        userUnreadCount: 2,
        scheduledUnreadCount: 0,
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
    });

    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-kobi',
            chat_type: 'single_agent',
            agent: {
              name: 'Custom Research Agent',
              role: 'assistant',
              emoji: '🤖',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [],
          } as any,
        ]}
        activeView="settings"
        excludeBuiltinAgents={false}
      />,
    );

    const label = await screen.findByTestId('nav-label-Custom Research Agent');

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '400' });
    });

    await act(async () => {
      unreadSummaryListener?.({
        alias: 'test-user',
        summary: {
          chatId: 'chat-kobi',
          userUnreadCount: 5,
          scheduledUnreadCount: 0,
          updatedAt: '2026-03-20T10:10:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '700' });
    });

    await act(async () => {
      unreadSummaryListener?.({
        alias: 'test-user',
        summary: {
          chatId: 'chat-kobi',
          userUnreadCount: 1,
          scheduledUnreadCount: 0,
          updatedAt: '2026-03-20T10:05:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '700' });
    });
  });

  it('clears bold emphasis when unread count drops to zero while the agent stays collapsed', async () => {
    let unreadSummaryListener: ((payload: any) => void) | undefined;
    mockOnChatUnreadSummaryChanged.mockImplementation((listener) => {
      unreadSummaryListener = listener;
      return vi.fn();
    });
    mockGetChatUnreadSummary.mockResolvedValue({
      success: true,
      data: {
        chatId: 'chat-kobi',
        userUnreadCount: 1,
        scheduledUnreadCount: 0,
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
    });

    render(
      <AgentList
        chats={[
          {
            chat_id: 'chat-kobi',
            chat_type: 'single_agent',
            agent: {
              name: 'Custom Research Agent',
              role: 'assistant',
              emoji: '🤖',
              avatar: '',
              version: '1.0.0',
              source: 'ON-DEVICE',
              workspace: '',
              mcp_servers: [],
              skills: [],
            },
            chatSessions: [],
          } as any,
        ]}
        activeView="settings"
        excludeBuiltinAgents={false}
      />,
    );

    const label = await screen.findByTestId('nav-label-Custom Research Agent');

    await waitFor(() => {
      expect(mockGetChatUnreadSummary).toHaveBeenCalledWith('test-user', 'chat-kobi');
      expect(label.firstChild).toHaveStyle({ fontWeight: '400' });
    });

    await act(async () => {
      unreadSummaryListener?.({
        alias: 'test-user',
        summary: {
          chatId: 'chat-kobi',
          userUnreadCount: 4,
          scheduledUnreadCount: 0,
          updatedAt: '2026-03-20T10:05:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '700' });
    });

    await act(async () => {
      unreadSummaryListener?.({
        alias: 'test-user',
        summary: {
          chatId: 'chat-kobi',
          userUnreadCount: 0,
          scheduledUnreadCount: 0,
          updatedAt: '2026-03-20T10:06:00.000Z',
        },
      });
    });

    await waitFor(() => {
      expect(label.firstChild).toHaveStyle({ fontWeight: '400' });
    });
  });
});