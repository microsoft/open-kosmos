/**
 * @vitest-environment happy-dom
 *
 * Supplemental coverage tests for ChatSessionDropdownMenu.
 * Covers handlers, branches, and edge cases not exercised by the main test file.
 */

import React from 'react';
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import { WithStore } from '@/atom';

// ── Mocks ────────────────────────────────────────────────────────────

const mockAdjust = vi.fn();
const mockCancelChatSession = vi.fn();
const mockRunJobNow = vi.fn();
const mockShowError = vi.fn();
vi.mock('../../auth/AuthProvider', () => ({
  useAuthContext: () => ({
    authData: { ghcAuth: { alias: 'demo-user' } },
  }),
}));

vi.mock('../../../lib/chat/agentChatIpc', () => ({
  agentChatIpc: {
    cancelChatSession: (...args: unknown[]) => mockCancelChatSession(...args),
  },
}));

vi.mock('../../../ipc/scheduler', () => ({
  schedulerApi: {
    runJobNow: (...args: unknown[]) => mockRunJobNow(...args),
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    showSuccess: vi.fn(),
    showError: (...args: unknown[]) => mockShowError(...args),
  }),
}));

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: (...args: unknown[]) => mockAdjust(...args),
  getAnchoredDropdownPosition: vi.fn().mockReturnValue({ top: 10, left: 20, triggerTop: 5, triggerRight: 100 }),
  ANCHORED_DROPDOWN_SIZE_PRESETS: {
    chatSessionMenu: { estimatedWidth: 200, estimatedHeight: 200 },
    scheduledChatSessionMenu: { estimatedWidth: 200, estimatedHeight: 200 },
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────

async function importModule() {
  return import('../ChatSessionDropdownMenu');
}

async function renderMenu(overrides: {
  source?: 'default' | 'schedule';
  starred?: boolean;
  chatId?: string | null;
  scheduleRunning?: boolean;
  scheduleRetryable?: boolean;
  scheduleJobId?: string | null;
} = {}) {
  const {
    source = 'default',
    starred = false,
    chatId = 'chat-1',
    scheduleRunning = false,
    scheduleRetryable = false,
    scheduleJobId = null,
  } = overrides;
  const { default: ChatSessionDropdownMenu, ChatSessionMenuAtom } = await importModule();

  const Wrapper = () => {
    const actions = ChatSessionMenuAtom.useChange();
    React.useEffect(() => {
      const btn = document.createElement('button');
      if (source === 'schedule') {
        btn.dataset.chatSessionMenuSource = 'schedule';
      }
      if (starred) {
        btn.dataset.chatSessionStarred = 'true';
      }
      if (scheduleRunning) {
        btn.dataset.scheduleRunning = 'true';
      }
      if (scheduleRetryable) {
        btn.dataset.scheduleRetryable = 'true';
      }
      if (scheduleJobId !== null) {
        btn.dataset.scheduleJobId = scheduleJobId;
      }
      document.body.appendChild(btn);
      if (chatId !== null) {
        actions.toggle(chatId, 'session-1', 'My Session', btn);
      }
      return () => { document.body.removeChild(btn); };
    }, []);
    return <ChatSessionDropdownMenu />;
  };

  return render(<WithStore><Wrapper /></WithStore>);
}

function captureCustomEvent(eventName: string): () => CustomEvent | undefined {
  let captured: CustomEvent | undefined;
  const handler = (e: Event) => { captured = e as CustomEvent; };
  window.addEventListener(eventName, handler);
  // Return a getter that also cleans up
  return () => {
    window.removeEventListener(eventName, handler);
    return captured;
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ChatSessionDropdownMenu – handler coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancelChatSession.mockResolvedValue(undefined);
    mockRunJobNow.mockResolvedValue({ success: true });
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        chatSessionOps: {
          getChatSessionFilePath: vi.fn().mockResolvedValue({ success: true, filePath: '/tmp/x.json' }),
        },
      },
    });
    Object.defineProperty(global.navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  // ── Star / Unstar ────────────────────────────────────────────────

  it('dispatches chatSession:toggleStar when Star is clicked', async () => {
    const getEvent = captureCustomEvent('chatSession:toggleStar');
    await renderMenu();

    fireEvent.click(screen.getByText('Star'));
    const evt = getEvent();
    expect(evt).toBeDefined();
    expect(evt!.detail).toEqual({ chatId: 'chat-1', sessionId: 'session-1', starred: true });
  });

  it('shows "Unstar" with filled icon when starred is true', async () => {
    await renderMenu({ starred: true });
    expect(screen.getByText('Unstar')).toBeInTheDocument();
  });

  it('toggleStar early-returns when chatId is null', async () => {
    // When chatId is null, the !isScheduleMenu guard still shows the Star button
    // (chatId is not checked in the JSX guard for Star), but the handler should
    // early return without dispatching an event.
    const getEvent = captureCustomEvent('chatSession:toggleStar');

    const { default: ChatSessionDropdownMenu, ChatSessionMenuAtom } = await importModule();
    const Wrapper = () => {
      const actions = ChatSessionMenuAtom.useChange();
      React.useEffect(() => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        // Pass null chatId directly — toggle will set it in the atom
        actions.toggle(null as unknown as string, 'session-1', 'Title', btn);
        return () => { document.body.removeChild(btn); };
      }, []);
      return <ChatSessionDropdownMenu />;
    };
    render(<WithStore><Wrapper /></WithStore>);
    const starBtn = screen.queryByText('Star');
    if (starBtn) {
      fireEvent.click(starBtn);
    }
    const evt = getEvent();
    // If the guard works, no event is dispatched
    expect(evt).toBeUndefined();
  });

  // ── Rename ───────────────────────────────────────────────────────

  it('dispatches chatSession:rename when Rename is clicked', async () => {
    const getEvent = captureCustomEvent('chatSession:rename');
    await renderMenu();

    fireEvent.click(screen.getByText('Rename'));
    const evt = getEvent();
    expect(evt).toBeDefined();
    expect(evt!.detail).toEqual({ chatId: 'chat-1', sessionId: 'session-1', title: 'My Session' });
  });

  // ── Fork ─────────────────────────────────────────────────────────

  it('dispatches chatSession:fork when Fork is clicked', async () => {
    const getEvent = captureCustomEvent('chatSession:fork');
    await renderMenu();

    fireEvent.click(screen.getByText('Fork'));
    const evt = getEvent();
    expect(evt).toBeDefined();
    expect(evt!.detail).toEqual({ sessionId: 'session-1' });
  });

  // ── Download ─────────────────────────────────────────────────────

  it('dispatches chatSession:download when Download is clicked', async () => {
    const getEvent = captureCustomEvent('chatSession:download');
    await renderMenu();

    fireEvent.click(screen.getByText('Download'));
    const evt = getEvent();
    expect(evt).toBeDefined();
    expect(evt!.detail).toEqual({ chatId: 'chat-1', sessionId: 'session-1', title: 'My Session' });
  });

  // ── Delete ───────────────────────────────────────────────────────

  it('dispatches chatSession:delete when Delete is clicked', async () => {
    const getEvent = captureCustomEvent('chatSession:delete');
    await renderMenu();

    fireEvent.click(screen.getByText('Delete'));
    const evt = getEvent();
    expect(evt).toBeDefined();
    expect(evt!.detail).toEqual({ sessionId: 'session-1' });
  });

  // ── Schedule menu hides items ────────────────────────────────────

  it('hides Star, Rename, Fork in schedule menu', async () => {
    await renderMenu({ source: 'schedule' });
    expect(screen.queryByText('Star')).not.toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Fork')).not.toBeInTheDocument();
    // Download and Delete remain visible
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  // ── Cancel (running scheduled run) ───────────────────────────────

  it('shows Cancel only for a running schedule menu', async () => {
    await renderMenu({ source: 'schedule', scheduleRunning: true });
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('hides Cancel for a non-running schedule menu', async () => {
    await renderMenu({ source: 'schedule', scheduleRunning: false });
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('hides Cancel in the default menu even when scheduleRunning is set', async () => {
    await renderMenu({ source: 'default', scheduleRunning: true });
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('cancels the running scheduled session when Cancel is clicked', async () => {
    await renderMenu({ source: 'schedule', scheduleRunning: true });

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockCancelChatSession).toHaveBeenCalledWith('session-1');
  });

  it('swallows errors when cancelChatSession rejects', async () => {
    mockCancelChatSession.mockRejectedValueOnce(new Error('cancel failed'));
    await renderMenu({ source: 'schedule', scheduleRunning: true });

    // Should not throw — the rejection is caught internally
    fireEvent.click(screen.getByText('Cancel'));

    expect(mockCancelChatSession).toHaveBeenCalledWith('session-1');
    // Allow the rejected promise's .catch to settle
    await Promise.resolve();
  });

  // ── Retry (failed or interrupted scheduled run) ──────────────────

  it('shows Retry for a retryable (failed or interrupted) schedule menu', async () => {
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: 'job-9' });
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('hides Retry for a non-retryable schedule menu', async () => {
    await renderMenu({ source: 'schedule', scheduleRetryable: false });
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('hides Retry in the default menu even when scheduleRetryable is set', async () => {
    await renderMenu({ source: 'default', scheduleRetryable: true });
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('reruns the schedule job when Retry is clicked', async () => {
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: 'job-9' });

    fireEvent.click(screen.getByText('Retry'));

    expect(mockRunJobNow).toHaveBeenCalledWith('job-9', { isManualRetry: true });
  });

  it('does not call runJobNow when the schedule job id is missing', async () => {
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: null });

    fireEvent.click(screen.getByText('Retry'));

    expect(mockRunJobNow).not.toHaveBeenCalled();
  });

  it('logs and toasts when runJobNow resolves unsuccessfully', async () => {
    mockRunJobNow.mockResolvedValueOnce({ success: false, error: 'disabled' });
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: 'job-9' });

    fireEvent.click(screen.getByText('Retry'));

    expect(mockRunJobNow).toHaveBeenCalledWith('job-9', { isManualRetry: true });
    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('disabled')),
    );
  });

  it('toasts when runJobNow rejects', async () => {
    mockRunJobNow.mockRejectedValueOnce(new Error('retry failed'));
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: 'job-9' });

    // Should not throw — the rejection is caught internally
    fireEvent.click(screen.getByText('Retry'));

    expect(mockRunJobNow).toHaveBeenCalledWith('job-9', { isManualRetry: true });
    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('retry failed')),
    );
  });

  it('toasts a generic reason when runJobNow fails without an error message', async () => {
    mockRunJobNow.mockResolvedValueOnce({ success: false });
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: 'job-9' });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Unknown error')),
    );
  });

  it('toasts when runJobNow rejects with a non-Error value', async () => {
    mockRunJobNow.mockRejectedValueOnce('boom');
    await renderMenu({ source: 'schedule', scheduleRetryable: true, scheduleJobId: 'job-9' });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() =>
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('boom')),
    );
  });
});

describe('ChatSessionDropdownMenu – atom toggle coverage', () => {
  it('closes the menu when toggle is called twice with the same sessionId', async () => {
    const { default: ChatSessionDropdownMenu, ChatSessionMenuAtom } = await importModule();

    let atomState: { isOpen: boolean } | undefined;
    const Reader = () => {
      const [state] = ChatSessionMenuAtom.use();
      atomState = state;
      return null;
    };

    const Trigger = () => {
      const actions = ChatSessionMenuAtom.useChange();
      return (
        <button data-testid="toggle" onClick={() => {
          const btn = document.createElement('button');
          document.body.appendChild(btn);
          actions.toggle('chat-1', 'session-1', 'Title', btn);
          document.body.removeChild(btn);
        }} />
      );
    };

    render(
      <WithStore>
        <Reader />
        <Trigger />
        <ChatSessionDropdownMenu />
      </WithStore>,
    );

    const toggleBtn = screen.getByTestId('toggle');

    // First toggle — opens
    act(() => { fireEvent.click(toggleBtn); });
    expect(atomState!.isOpen).toBe(true);

    // Second toggle with same sessionId — closes
    act(() => { fireEvent.click(toggleBtn); });
    expect(atomState!.isOpen).toBe(false);
  });

  it('sets starred=true from button dataset', async () => {
    const { ChatSessionMenuAtom } = await importModule();

    let atomState: { starred: boolean } | undefined;
    const Reader = () => {
      const [state] = ChatSessionMenuAtom.use();
      atomState = state;
      return null;
    };

    const Trigger = () => {
      const actions = ChatSessionMenuAtom.useChange();
      return (
        <button data-testid="trigger" onClick={() => {
          const btn = document.createElement('button');
          btn.dataset.chatSessionStarred = 'true';
          document.body.appendChild(btn);
          actions.toggle('chat-1', 'session-1', 'Title', btn);
          document.body.removeChild(btn);
        }} />
      );
    };

    render(<WithStore><Reader /><Trigger /></WithStore>);
    act(() => { fireEvent.click(screen.getByTestId('trigger')); });
    expect(atomState!.starred).toBe(true);
  });

  it('sets scheduleRunning=true from button dataset', async () => {
    const { ChatSessionMenuAtom } = await importModule();

    let atomState: { scheduleRunning: boolean } | undefined;
    const Reader = () => {
      const [state] = ChatSessionMenuAtom.use();
      atomState = state;
      return null;
    };

    const Trigger = () => {
      const actions = ChatSessionMenuAtom.useChange();
      return (
        <button data-testid="trigger" onClick={() => {
          const btn = document.createElement('button');
          btn.dataset.chatSessionMenuSource = 'schedule';
          btn.dataset.scheduleRunning = 'true';
          document.body.appendChild(btn);
          actions.toggle('chat-1', 'session-1', 'Title', btn);
          document.body.removeChild(btn);
        }} />
      );
    };

    render(<WithStore><Reader /><Trigger /></WithStore>);
    act(() => { fireEvent.click(screen.getByTestId('trigger')); });
    expect(atomState!.scheduleRunning).toBe(true);
  });

  it('sets scheduleRetryable and scheduleJobId from button dataset', async () => {
    const { ChatSessionMenuAtom } = await importModule();

    let atomState: { scheduleRetryable: boolean; scheduleJobId: string | null } | undefined;
    const Reader = () => {
      const [state] = ChatSessionMenuAtom.use();
      atomState = state;
      return null;
    };

    const Trigger = () => {
      const actions = ChatSessionMenuAtom.useChange();
      return (
        <button data-testid="trigger" onClick={() => {
          const btn = document.createElement('button');
          btn.dataset.chatSessionMenuSource = 'schedule';
          btn.dataset.scheduleRetryable = 'true';
          btn.dataset.scheduleJobId = 'job-42';
          document.body.appendChild(btn);
          actions.toggle('chat-1', 'session-1', 'Title', btn);
          document.body.removeChild(btn);
        }} />
      );
    };

    render(<WithStore><Reader /><Trigger /></WithStore>);
    act(() => { fireEvent.click(screen.getByTestId('trigger')); });
    expect(atomState!.scheduleRetryable).toBe(true);
    expect(atomState!.scheduleJobId).toBe('job-42');
  });
});

describe('ChatSessionDropdownMenu – default export null guard', () => {
  it('renders nothing when the menu is not open', async () => {
    const { default: ChatSessionDropdownMenu } = await importModule();
    const { container } = render(
      <WithStore>
        <ChatSessionDropdownMenu />
      </WithStore>,
    );
    // The default export should return null — empty container
    expect(container.innerHTML).toBe('');
  });
});

describe('ChatSessionDropdownMenu – useLayoutEffect', () => {
  it('calls adjustAnchoredDropdownToViewport after render', async () => {
    await renderMenu();
    expect(mockAdjust).toHaveBeenCalled();
    // First arg should be an HTMLElement (the menu ref)
    expect(mockAdjust.mock.calls[0][0]).toBeInstanceOf(HTMLElement);
    // Second arg should be the position object
    expect(mockAdjust.mock.calls[0][1]).toEqual({ top: 10, left: 20, triggerTop: 5, triggerRight: 100 });
  });
});
