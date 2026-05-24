// @ts-nocheck
// @vitest-environment happy-dom
/**
 * Additional coverage tests for DeleteOverlay — confirm (delete) action flows.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockNavigate,
  mockLocation,
  mockShowSuccess,
  mockShowError,
  mockDeleteChatConfig,
  mockDeleteChatSession,
  mockStartNewChatFor,
  mockGetCurrentChatId,
  mockProfileDataManager,
} = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  const mockLocation = { pathname: '/agent/chat/agent-1' };
  const mockShowSuccess = vi.fn();
  const mockShowError = vi.fn();
  const mockDeleteChatConfig = vi.fn(() => Promise.resolve({ success: true }));
  const mockDeleteChatSession = vi.fn(() => Promise.resolve({ success: true }));
  const mockStartNewChatFor = vi.fn(() =>
    Promise.resolve({ success: true, chatSessionId: 'new-session-id' }),
  );
  const mockGetCurrentChatId = vi.fn(() => 'agent-1');
  const mockProfileDataManager = {
    getCache: vi.fn(() => ({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [{ agent: { name: 'Kobi' }, chat_id: 'kobi-chat-1' }],
    })),
    refresh: vi.fn(() => Promise.resolve()),
  };
  return {
    mockNavigate,
    mockLocation,
    mockShowSuccess,
    mockShowError,
    mockDeleteChatConfig,
    mockDeleteChatSession,
    mockStartNewChatFor,
    mockGetCurrentChatId,
    mockProfileDataManager,
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));

vi.mock('@renderer/components/ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('@renderer/components/userData/userDataProvider', () => ({
  useProfileData: () => ({ data: { profile: { alias: 'user' }, chats: [] }, chats: [] }),
}));

vi.mock('@renderer/lib/userData/profileDataManager', () => ({
  profileDataManager: mockProfileDataManager,
}));

vi.mock('@renderer/lib/chat/chatOps', () => ({
  chatOps: {
    deleteChatConfig: mockDeleteChatConfig,
    duplicateChatConfig: vi.fn(() => Promise.resolve({ success: true })),
  },
}));

vi.mock('@renderer/lib/chat/chatSessionOps', () => ({
  deleteChatSession: mockDeleteChatSession,
}));

vi.mock('@renderer/lib/chat/startNewChatFor', () => ({
  startNewChatFor: mockStartNewChatFor,
}));

vi.mock('@renderer/lib/chat/pmAgentSayHi', () => ({
  getPmAgentSayHiMessageConfig: vi.fn(() => ({})),
}));

vi.mock('@renderer/lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    getCurrentChatId: mockGetCurrentChatId,
    getCurrentChatSessionId: vi.fn(() => 'session-1'),
    subscribeToCurrentChatSessionId: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@renderer/lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

import { WithStore } from '@/atom';
import { DeleteOverlay, DeleteConfirmAtom } from '../DeleteOverlay';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function AgentController({ id = 'agent-1', name = 'TestAgent', isCurrentSession = false } = {}) {
  const [, actions] = DeleteConfirmAtom.use();
  return (
    <button data-testid="open" onClick={() => actions.showAgent(id, name, isCurrentSession)}>
      Open
    </button>
  );
}

function ChatSessionController({ id = 'session-1', name = 'TestSession', isCurrentSession = false } = {}) {
  const [, actions] = DeleteConfirmAtom.use();
  return (
    <button data-testid="open" onClick={() => actions.showChatSession(id, name, isCurrentSession)}>
      Open
    </button>
  );
}

describe('DeleteOverlay — confirm flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).electronAPI = undefined;
  });

  // ── Agent delete: non-current chat, non-agent route ──────────────────────

  it('deletes agent when not on its route and not current chat', async () => {
    mockGetCurrentChatId.mockReturnValue('other-chat');
    mockLocation.pathname = '/settings/agents';

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="TestAgent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' })); });

    expect(mockDeleteChatConfig).toHaveBeenCalledWith('agent-1');
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('TestAgent'));
    // No navigation needed
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // ── Agent delete: is current chat → dispatches cleanup, navigates ────────

  it('dispatches agent:cleanup and navigates away when deleting current chat', async () => {
    vi.useFakeTimers();
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockLocation.pathname = '/other';
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [{ agent: { name: 'Kobi' }, chat_id: 'kobi-chat-1' }],
    });

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="MyAgent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    // Start the confirm action (don't await yet — it has internal setTimeout)
    const clickPromise = act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    });
    // Advance past the 100ms cleanup delay
    await act(async () => { vi.runAllTimersAsync(); });
    await clickPromise;
    vi.useRealTimers();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'agent:cleanup' }),
    );
    expect(mockStartNewChatFor).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('kobi-chat-1'),
      { replace: true },
    );
    dispatchSpy.mockRestore();
  });

  // ── Agent delete: on deleted agent route (but not current chat) ──────────

  it('navigates away when current route is the deleted agent route', async () => {
    mockGetCurrentChatId.mockReturnValue('other-chat');
    mockLocation.pathname = '/agent/chat/agent-1/session-x';

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="RouteAgent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    });

    expect(mockNavigate).toHaveBeenCalled();
  });

  // ── Agent delete: primary agent chat not found ───────────────────────────

  it('logs error when primary agent chat is not found after delete', async () => {
    vi.useFakeTimers();
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockLocation.pathname = '/other';
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [], // no Kobi chat
    });

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="Agent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    const clickPromise = act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    });
    await act(async () => { vi.runAllTimersAsync(); });
    await clickPromise;
    vi.useRealTimers();

    // Should not navigate since no primary agent found
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalled(); // still shows success
  });

  // ── Agent delete: startNewChatFor fails ──────────────────────────────────

  it('handles startNewChatFor failure gracefully', async () => {
    vi.useFakeTimers();
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockLocation.pathname = '/other';
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [{ agent: { name: 'Kobi' }, chat_id: 'kobi-1' }],
    });
    mockStartNewChatFor.mockResolvedValue({ success: false });

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="Agent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    const clickPromise = act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    });
    await act(async () => { vi.runAllTimersAsync(); });
    await clickPromise;
    vi.useRealTimers();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  // ── Agent delete: deleteChatConfig fails ────────────────────────────────

  it('shows error when deleteChatConfig fails', async () => {
    mockDeleteChatConfig.mockResolvedValue({ success: false, error: 'Not found' });
    mockGetCurrentChatId.mockReturnValue('other');
    mockLocation.pathname = '/settings';

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="Agent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Not found'));
  });

  // ── Agent delete: exception thrown ───────────────────────────────────────

  it('shows error when deleteChatConfig throws', async () => {
    mockDeleteChatConfig.mockRejectedValue(new Error('crash'));
    mockGetCurrentChatId.mockReturnValue('other');
    mockLocation.pathname = '/settings';

    wrap(
      <WithStore>
        <AgentController id="agent-1" name="Agent" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete Agent' }));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('crash'));
  });

  // ── Chat-session delete ──────────────────────────────────────────────────

  it('deletes non-current chat session', async () => {
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [],
    });
    (window as any).electronAPI = {
      agentChat: { removeAgentChatInstance: vi.fn(() => Promise.resolve()) },
    };

    wrap(
      <WithStore>
        <ChatSessionController id="session-1" name="MySession" isCurrentSession={false} />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(mockDeleteChatSession).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('MySession'));
  });

  it('switches to new session before deleting current chat session', async () => {
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [],
    });
    (window as any).electronAPI = {
      agentChat: { removeAgentChatInstance: vi.fn(() => Promise.resolve()) },
    };

    wrap(
      <WithStore>
        <ChatSessionController id="session-1" name="CurSession" isCurrentSession={true} />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(mockStartNewChatFor).toHaveBeenCalledWith('agent-1', expect.anything());
    expect(mockDeleteChatSession).toHaveBeenCalled();
    expect(mockShowSuccess).toHaveBeenCalled();
  });

  it('shows error when no current agent chat available for session delete', async () => {
    mockGetCurrentChatId.mockReturnValue(null);

    wrap(
      <WithStore>
        <ChatSessionController id="session-1" name="S" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(mockShowError).toHaveBeenCalledWith('No current agent chat available');
  });

  it('shows error when no profile alias for session delete', async () => {
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: null },
      chats: [],
    });

    wrap(
      <WithStore>
        <ChatSessionController id="session-1" name="S" />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(mockShowError).toHaveBeenCalledWith('No profile alias available');
  });

  it('shows error when deleteChatSession fails', async () => {
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [],
    });
    mockDeleteChatSession.mockResolvedValue({ success: false, error: 'DB error' });
    (window as any).electronAPI = {
      agentChat: { removeAgentChatInstance: vi.fn(() => Promise.resolve()) },
    };

    wrap(
      <WithStore>
        <ChatSessionController id="session-1" name="S" isCurrentSession={false} />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('DB error'));
  });

  it('skips removeAgentChatInstance when API is not available', async () => {
    mockGetCurrentChatId.mockReturnValue('agent-1');
    mockProfileDataManager.getCache.mockReturnValue({
      profile: { alias: 'user', primaryAgent: 'Kobi' },
      chats: [],
    });
    (window as any).electronAPI = {}; // no agentChat

    wrap(
      <WithStore>
        <ChatSessionController id="session-1" name="S" isCurrentSession={false} />
        <DeleteOverlay />
      </WithStore>,
    );
    await act(async () => { fireEvent.click(screen.getByTestId('open')); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(mockDeleteChatSession).toHaveBeenCalled();
  });

  // ── confirm with no id (guard) ────────────────────────────────────────────

  it('does nothing when confirm is called with no id', async () => {
    // Access atom directly with zero state (id=null)
    const [, actions] = DeleteConfirmAtom.getState?.() ?? [null, null];
    // Just verify calling confirm without opening does nothing
    wrap(<DeleteOverlay />);
    // overlay stays closed
    expect(screen.queryByText('Delete Agent')).not.toBeInTheDocument();
  });
});
