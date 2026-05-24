/**
 * @vitest-environment happy-dom
 *
 * Coverage-focused tests for ChatView.tsx — exercises branches not covered by
 * the existing sessionSwitching / contextMenuDefaults test suites.
 */

import React from 'react';
import { act, render } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockNavigate,
  mockShowSuccess,
  mockShowError,
  mockEffectiveShow,
  mockSetCurrentChatSessionId,
  mockGetCurrentChatId,
  mockGetCurrentChatSessionId,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowError: vi.fn(),
  mockEffectiveShow: vi.fn(),
  mockSetCurrentChatSessionId: vi.fn(),
  mockGetCurrentChatId: vi.fn(() => null as string | null),
  mockGetCurrentChatSessionId: vi.fn(() => null as string | null),
}));

// ---------------------------------------------------------------------------
// Module-level prop capture stores (populated by mocks below)
// ---------------------------------------------------------------------------

let capturedChatViewHeaderProps: any = null;
let capturedChatViewContentProps: any = null;

// Mutable route state
let routeChatId: string | undefined = 'chat-1';
let routeSessionId: string | undefined = 'session-a';
let routePathname = '/agent/chat/chat-1/session-a';
let routeNavState: Record<string, unknown> | null = null;

let mockChatId: string | null = 'chat-1';
let mockChatSessionId: string | null = 'session-a';
let mockChatStatus = 'idle';
let mockHasCache = true;
let mockIsMinimalMode = false;

// ---------------------------------------------------------------------------
// vi.mock — all at module scope, factories capture state via closures
// ---------------------------------------------------------------------------

vi.mock('react-router-dom', () => ({
  useParams: () => ({ chatId: routeChatId, sessionId: routeSessionId }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: routePathname, state: routeNavState }),
}));

vi.mock('../ChatViewHeader', () => ({
  default: (props: any) => {
    capturedChatViewHeaderProps = props;
    return React.createElement('div', { 'data-testid': 'chat-view-header' });
  },
}));

vi.mock('../ChatViewContent', () => ({
  default: (props: any) => {
    capturedChatViewContentProps = props;
    return React.createElement('div', {
      'data-testid': 'chat-view-content',
      'data-is-session-switching': String(props.isSessionSwitching),
    });
  },
}));

vi.mock('../chat-input/ContextMenu', () => ({ ContextMenu: () => null }));

vi.mock('../../userData/userDataProvider', () => ({
  useAgentConfig: () => ({ agent: { id: 'agent-1', name: 'Test Agent', zero_states: undefined } }),
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../../layout/LayoutProvider', () => ({
  useLayout: () => ({ isMinimalMode: mockIsMinimalMode }),
}));

vi.mock('../../../lib/audio/useAutoTts', () => ({ useAutoTts: vi.fn() }));

vi.mock('../chat-side.atom', () => ({
  ScheduleSidepaneAtom: {
    useChange: () => ({ effectiveShow: mockEffectiveShow, hide: vi.fn() }),
    useData: () => false,
  },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  CurrentSessionStatus: {
    use: () => ({
      chatId: mockChatId,
      chatSessionId: mockChatSessionId,
      chatStatus: mockChatStatus,
    }),
  },
  useHasChatSessionCache: () => mockHasCache,
  agentChatSessionCacheManager: {
    getCurrentChatId: () => mockGetCurrentChatId(),
    getCurrentChatSessionId: () => mockGetCurrentChatSessionId(),
    setCurrentChatSessionId: mockSetCurrentChatSessionId,
  },
}));

vi.mock('../../../lib/userData', () => ({
  profileDataManager: {
    getCurrentChat: vi.fn(() => ({
      chatSessions: [
        { chatSession_id: 'session-a' },
        { chatSession_id: 'session-b', schedulerJobId: 'job-1' },
      ],
    })),
  },
}));

vi.mock('../../../lib/chat/pmAgentSayHi', () => ({
  getPmAgentSayHiMessageConfig: vi.fn(() => null),
}));

vi.mock('../../../lib/chat/startNewChatFor', () => ({
  startNewChatFor: vi.fn().mockResolvedValue({ success: true, chatSessionId: 'session-new' }),
}));

// ---------------------------------------------------------------------------
// Import under test — AFTER all mocks
// ---------------------------------------------------------------------------

import ChatView from '../ChatView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupElectronAPI(agentChatOverrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      agentChat: {
        getCurrentChatSession: vi.fn().mockResolvedValue({ success: false }),
        switchToChatSession: vi.fn().mockResolvedValue({ success: true }),
        forkChatSession: vi.fn().mockResolvedValue({ success: true, chatSessionId: 'session-forked' }),
        ...agentChatOverrides,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  routeChatId = 'chat-1';
  routeSessionId = 'session-a';
  routePathname = '/agent/chat/chat-1/session-a';
  routeNavState = null;
  mockChatId = 'chat-1';
  mockChatSessionId = 'session-a';
  mockChatStatus = 'idle';
  mockHasCache = true;
  mockIsMinimalMode = false;
  mockGetCurrentChatId.mockReturnValue(null);
  mockGetCurrentChatSessionId.mockReturnValue(null);
  capturedChatViewHeaderProps = null;
  capturedChatViewContentProps = null;
  setupElectronAPI();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Initial fetch — no cached session
// ---------------------------------------------------------------------------

describe('ChatView — initial-fetch when cache is empty', () => {
  it('calls getCurrentChatSession after 100 ms when cache has no current session', async () => {
    mockGetCurrentChatSessionId.mockReturnValue(null);
    const getCurrentChatSession = vi.fn().mockResolvedValue({
      success: true,
      data: { chatId: 'chat-1', chatSessionId: 'session-a' },
    });
    setupElectronAPI({ getCurrentChatSession });

    render(<ChatView />);

    expect(getCurrentChatSession).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(getCurrentChatSession).toHaveBeenCalledTimes(1);
    expect(mockSetCurrentChatSessionId).toHaveBeenCalledWith('chat-1', 'session-a');
  });

  it('skips fetch when cache already has a current session', async () => {
    mockGetCurrentChatSessionId.mockReturnValue('session-a');
    const getCurrentChatSession = vi.fn();
    setupElectronAPI({ getCurrentChatSession });

    render(<ChatView />);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(getCurrentChatSession).not.toHaveBeenCalled();
  });

  it('handles failure from getCurrentChatSession without throwing', async () => {
    mockGetCurrentChatSessionId.mockReturnValue(null);
    const getCurrentChatSession = vi.fn().mockRejectedValue(new Error('network error'));
    setupElectronAPI({ getCurrentChatSession });

    render(<ChatView />);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mockSetCurrentChatSessionId).not.toHaveBeenCalled();
  });

  it('handles unsuccessful response without calling setCurrentChatSessionId', async () => {
    mockGetCurrentChatSessionId.mockReturnValue(null);
    const getCurrentChatSession = vi.fn().mockResolvedValue({ success: false });
    setupElectronAPI({ getCurrentChatSession });

    render(<ChatView />);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mockSetCurrentChatSessionId).not.toHaveBeenCalled();
  });

  it('does nothing when electronAPI.agentChat.getCurrentChatSession is absent', async () => {
    mockGetCurrentChatSessionId.mockReturnValue(null);
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { agentChat: {} },
    });

    render(<ChatView />);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(mockSetCurrentChatSessionId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Route sync — no IDs case (redirect to cached session)
// ---------------------------------------------------------------------------

describe('ChatView — route sync: no IDs', () => {
  it('redirects to cached session when no IDs in route and cache has session', async () => {
    routeChatId = undefined;
    routeSessionId = undefined;
    routePathname = '/agent/chat';
    mockGetCurrentChatId.mockReturnValue('chat-1');
    mockGetCurrentChatSessionId.mockReturnValue('session-a');

    render(<ChatView />);

    await act(async () => { await Promise.resolve(); });

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/session-a', { replace: true });
  });

  it('does not navigate when no IDs in route and cache is empty', async () => {
    routeChatId = undefined;
    routeSessionId = undefined;
    mockGetCurrentChatId.mockReturnValue(null);
    mockGetCurrentChatSessionId.mockReturnValue(null);

    render(<ChatView />);

    await act(async () => { await Promise.resolve(); });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Route sync — chatId only
// ---------------------------------------------------------------------------

describe('ChatView — route sync: chatId only', () => {
  it('starts a new chat and navigates when intent is new-chat', async () => {
    routeChatId = 'chat-1';
    routeSessionId = undefined;
    routeNavState = { intent: 'new-chat', source: 'sidebar' };
    const { startNewChatFor } = await import('../../../lib/chat/startNewChatFor');
    (startNewChatFor as any).mockResolvedValue({ success: true, chatSessionId: 'session-new' });

    render(<ChatView />);

    await act(async () => { await Promise.resolve(); });

    expect(mockNavigate).toHaveBeenCalledWith(
      '/agent/chat/chat-1/session-new',
      expect.objectContaining({ replace: true }),
    );
  });

  it('skips new-chat when intent is missing (chatId only, no intent)', async () => {
    routeChatId = 'chat-1';
    routeSessionId = undefined;
    routeNavState = null;

    render(<ChatView />);

    await act(async () => { await Promise.resolve(); });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('skips new-chat when startNewChatFor returns no chatSessionId', async () => {
    routeChatId = 'chat-1';
    routeSessionId = undefined;
    routeNavState = { intent: 'new-chat' };
    const { startNewChatFor } = await import('../../../lib/chat/startNewChatFor');
    (startNewChatFor as any).mockResolvedValue({ success: false });

    render(<ChatView />);

    await act(async () => { await Promise.resolve(); });

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// selectedText in navigation state
// ---------------------------------------------------------------------------

describe('ChatView — selectedText navigation state', () => {
  it('dispatches agent:fillInput and clears state when selectedText is present', () => {
    routeNavState = { selectedText: 'hello world' };
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('agent:fillInput', listener);

    render(<ChatView />);

    expect(events).toHaveLength(1);
    expect(events[0].detail.text).toBe('hello world');
    expect(mockNavigate).toHaveBeenCalledWith(routePathname, { replace: true, state: {} });

    window.removeEventListener('agent:fillInput', listener);
  });
});

// ---------------------------------------------------------------------------
// fork chat session branches
// ---------------------------------------------------------------------------

describe('ChatView — fork chat session', () => {
  async function triggerFork(sessionId = 'session-a') {
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatSession:fork', { detail: { sessionId } }));
      await Promise.resolve();
    });
  }

  it('shows error when chatId is null during fork', async () => {
    mockChatId = null;
    render(<ChatView />);
    await triggerFork();
    expect(mockShowError).toHaveBeenCalledWith('No current agent chat available');
  });

  it('shows error when forkChatSession API is unavailable', async () => {
    mockChatId = 'chat-1';
    setupElectronAPI({}); // forkChatSession will be present by default — remove it
    Object.defineProperty(window, 'electronAPI', {
      configurable: true, writable: true,
      value: { agentChat: { switchToChatSession: vi.fn().mockResolvedValue({ success: true }) } },
    });

    render(<ChatView />);
    await triggerFork();
    expect(mockShowError).toHaveBeenCalledWith('Fork API not available');
  });

  it('shows error when forkChatSession returns failure', async () => {
    const forkChatSession = vi.fn().mockResolvedValue({ success: false, error: 'disk full' });
    setupElectronAPI({ forkChatSession });
    render(<ChatView />);
    await triggerFork();
    expect(mockShowError).toHaveBeenCalledWith('Failed to fork session: disk full');
  });

  it('shows success when fork succeeds', async () => {
    const forkChatSession = vi.fn().mockResolvedValue({ success: true, chatSessionId: 'session-forked' });
    setupElectronAPI({ forkChatSession });
    render(<ChatView />);
    await triggerFork();
    expect(mockShowSuccess).toHaveBeenCalledWith('Session forked successfully, switched to new session');
  });

  it('shows error with message when forkChatSession throws an Error', async () => {
    const forkChatSession = vi.fn().mockRejectedValue(new Error('timeout'));
    setupElectronAPI({ forkChatSession });
    render(<ChatView />);
    await triggerFork();
    expect(mockShowError).toHaveBeenCalledWith('Failed to fork session: timeout');
  });

  it('shows generic error when forkChatSession throws a non-Error value', async () => {
    const forkChatSession = vi.fn().mockRejectedValue('bad string');
    setupElectronAPI({ forkChatSession });
    render(<ChatView />);
    await triggerFork();
    expect(mockShowError).toHaveBeenCalledWith('Failed to fork session: Unknown error');
  });

  it('ignores chatSession:fork events without sessionId', async () => {
    render(<ChatView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatSession:fork', { detail: {} }));
      await Promise.resolve();
    });
    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// minimal mode class
// ---------------------------------------------------------------------------

describe('ChatView — minimal mode class', () => {
  it('adds minimal-mode class when isMinimalMode is true', () => {
    mockIsMinimalMode = true;
    const { container } = render(<ChatView />);
    expect(container.querySelector('.chat-view')?.classList.contains('minimal-mode')).toBe(true);
  });

  it('does not add minimal-mode class when isMinimalMode is false', () => {
    mockIsMinimalMode = false;
    const { container } = render(<ChatView />);
    expect(container.querySelector('.chat-view')?.classList.contains('minimal-mode')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// agent:editAgent dispatching via ChatViewHeader callbacks
// ---------------------------------------------------------------------------

describe('ChatView — agent:editAgent dispatching', () => {
  it('dispatches agent:editAgent with mcp tab via onOpenMcpTools', () => {
    render(<ChatView />);

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('agent:editAgent', listener);

    capturedChatViewHeaderProps?.onOpenMcpTools();

    expect(events[0]?.detail).toEqual({ chatId: 'chat-1', initialTab: 'mcp' });
    window.removeEventListener('agent:editAgent', listener);
  });

  it('dispatches agent:editAgent with skills tab via onOpenSkills', () => {
    render(<ChatView />);

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('agent:editAgent', listener);

    capturedChatViewHeaderProps?.onOpenSkills();

    expect(events[0]?.detail).toEqual({ chatId: 'chat-1', initialTab: 'skills' });
    window.removeEventListener('agent:editAgent', listener);
  });

  it('does not dispatch agent:editAgent when chatId is null', () => {
    mockChatId = null;
    render(<ChatView />);

    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('agent:editAgent', listener);

    capturedChatViewHeaderProps?.onOpenMcpTools();

    expect(events).toHaveLength(0);
    window.removeEventListener('agent:editAgent', listener);
  });
});

// ---------------------------------------------------------------------------
// isReadOnly prop for remote vs non-remote sessions
// ---------------------------------------------------------------------------

describe('ChatView — isReadOnly prop', () => {
  it('passes isReadOnly=false when session source is not remote', () => {
    render(<ChatView />);
    expect(capturedChatViewContentProps?.isReadOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleSessionSelect navigates correctly
// ---------------------------------------------------------------------------

describe('ChatView — handleSessionSelect', () => {
  it('navigates to target session when a different session is selected', async () => {
    render(<ChatView />);

    await act(async () => {
      capturedChatViewContentProps?.onSelectScheduledSession?.('session-b');
      await Promise.resolve();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/agent/chat/chat-1/session-b');
  });

  it('does not navigate when selecting the already-active session', async () => {
    render(<ChatView />);

    await act(async () => {
      capturedChatViewContentProps?.onSelectScheduledSession?.('session-a');
      await Promise.resolve();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows error when chatId is null during session select', async () => {
    mockChatId = null;
    render(<ChatView />);

    await act(async () => {
      capturedChatViewContentProps?.onSelectScheduledSession?.('session-b');
      await Promise.resolve();
    });

    expect(mockShowError).toHaveBeenCalledWith('Cannot switch chat session: current chat does not exist');
  });
});
