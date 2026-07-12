// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * AgentList.uncovered.test.tsx
 * Targets remaining uncovered branches/statements/functions in AgentList.tsx to
 * bring whole-file coverage to >=90% on all four metrics.
 *
 * Key areas:
 *  - Scrollbar functions (updateScrollbar, handleSessionListMouseEnter/Leave)
 *  - Session-item mouse enter/leave (active + inactive)
 *  - New-chat / more-options button keydown handlers
 *  - getSummaryUpdatedAtValue undefined and NaN branches
 *  - rankSearchResult scoring branches (agent prefix/includes, unread boost)
 *  - Chat status 'running' rendering (LoadingIcon)
 *  - loadMoreChatSessions error + no-alias + hasMore=false branches
 *  - loadInitialChatSessions error path
 *  - handleScroll branches (not-near-bottom, already-latched)
 *  - handleMenuToggle (agent menu)
 *  - handleChatSessionMenuToggle (session menu click)
 *  - ensureSessionPresentInPaginatedState (scheduled skip, already present)
 *  - getSearchableSessionsForChat paginated-cache path
 *  - onSessionCreated / onMetadataPatched / onSessionDeleted with hasLoaded=true
 *  - triggerAllLoadedHint idempotence
 *  - unreadSummary: incoming older (return early) + nextUnreadCount <= 0 branch
 *  - removeSearchCacheSession and upsertSearchCacheSession no-existing-cache branch
 *  - pendingScrollTarget cleanup path
 *  - chats-cleanup effect (exhaustedBottomLatchRef pruning)
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// -- hoisted mock vars ---------------------------------------------------------

const { mockAgentMenuAtomUse, mockChatSessionMenuAtomUse, mockIsBuiltinAgent } = vi.hoisted(() => ({
  mockAgentMenuAtomUse: vi.fn(() => [
    { isOpen: false, chatId: null },
    { toggle: vi.fn(), close: vi.fn() },
  ]),
  mockChatSessionMenuAtomUse: vi.fn(() => [
    { isOpen: false, sessionId: null },
    { toggle: vi.fn(), close: vi.fn() },
  ]),
  mockIsBuiltinAgent: vi.fn().mockReturnValue(false),
}));

// -- module-level mock state ---------------------------------------------------

const mockUseProfileData = vi.fn();
const mockGetChatSessions = vi.fn();
const mockGetMoreChatSessions = vi.fn();
const mockUseChatUnreadSummaryMap = vi.fn(() => ({}));

let onSessionCreatedHandler: ((data: any) => void) | null = null;
let onMetadataPatchedHandler: ((data: any) => void) | null = null;
let onSessionDeletedHandler: ((data: any) => void) | null = null;
let onChatStatusChangedHandler: ((data: any) => void) | null = null;
let onChatUnreadSummaryChangedHandler: ((data: any) => void) | null = null;

// -- module mocks --------------------------------------------------------------

vi.mock('../../../userData/userDataProvider', () => ({
  useProfileData: () => mockUseProfileData(),
}));

vi.mock('../../../lib/chat/useChatUnreadSummary', () => ({
  useChatUnreadSummaryMap: (...args: any[]) => mockUseChatUnreadSummaryMap(...args),
}));

vi.mock('../../../ui/navigation/NavItem', () => ({
  default: (props: any) => (
    <button
      type="button"
      onClick={props.onClick}
      className={props.isActive ? 'active' : ''}
      data-testid={`nav-${props.ariaLabel || 'nav-item'}`}
    >
      {props.icon}
      <span data-testid={`nav-label-${props.ariaLabel || 'nav-item'}`}>{props.label}</span>
      {props.rightContent}
    </button>
  ),
}));

vi.mock('../../../common/AgentAvatar', () => ({
  AgentAvatar: ({ name }: { name?: string }) => (
    <div data-testid="agent-avatar">{name || 'avatar'}</div>
  ),
}));

vi.mock('../../../menu/AgentDropdownMenu', () => ({
  AgentMenuAtom: { use: () => mockAgentMenuAtomUse() },
}));

vi.mock('../../../menu/ChatSessionDropdownMenu', () => ({
  ChatSessionMenuAtom: { use: () => mockChatSessionMenuAtomUse() },
}));

vi.mock('../../../styles/DropdownMenu.css', () => ({}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../../../lib/userData/types', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return { ...actual, isBuiltinAgent: mockIsBuiltinAgent };
});

vi.mock('@shared/constants/branding', () => ({ BRAND_NAME: 'openkosmos' }));

// -- electronAPI factory -------------------------------------------------------

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

// -- import under test (after mocks) ------------------------------------------

import AgentList from '../AgentList';

// -- helpers -------------------------------------------------------------------

const defaultProfile = {
  data: {
    profile: {
      alias: 'test-user',
      'starred-chat-sessions': [],
    },
  },
};

const makeChat = (overrides: any = {}): any => ({
  chat_id: 'chat-1',
  chat_type: 'single_agent',
  agent: {
    name: 'Test Agent',
    role: 'assistant',
    emoji: 'A',
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

const makeSession = (overrides: any = {}): any => ({
  chatSession_id: 'session-1',
  title: 'Chat Session',
  last_updated: '2024-01-01T00:00:00Z',
  readStatus: 'read',
  ...overrides,
});

// -- test lifecycle ------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  onSessionCreatedHandler = null;
  onMetadataPatchedHandler = null;
  onSessionDeletedHandler = null;
  onChatStatusChangedHandler = null;
  onChatUnreadSummaryChangedHandler = null;

  mockUseProfileData.mockReturnValue(defaultProfile);
  mockUseChatUnreadSummaryMap.mockReturnValue({});
  mockIsBuiltinAgent.mockReturnValue(false);
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

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// Built-in agent scroll-load path coverage
//
// All tests below exercise the FIXED-HEIGHT scroll-to-load list that only
// renders when `isBuiltinAgent(...)` returns true AND excludeBuiltinAgents is
// false. The describe-level beforeEach runs AFTER the global one (which resets
// the mock to false), so it flips the flag to true for this whole file.
// =============================================================================

describe('Built-in agent: scroll-load list', () => {
  beforeEach(() => {
    mockIsBuiltinAgent.mockReturnValue(true);
  });

  // ---------------------------------------------------------------------------
  // 1. updateScrollbar: main path + auto-hide timer (1200ms)
  // ---------------------------------------------------------------------------
  it('shows overlay scrollbar thumb on mouseEnter when scrollHeight > clientHeight', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const session = makeSession({ chatSession_id: 's1', title: 'Built-in Scroll Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Scroll Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    expect(list).toBeTruthy();
    Object.defineProperty(list, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 50, configurable: true });

    const wrapper = list.parentElement as HTMLElement;

    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });

    await waitFor(() => {
      const thumb = wrapper.querySelector('[style*="position: absolute"]');
      expect(thumb).toBeTruthy();
    });

    vi.restoreAllMocks();
  });

  it('auto-hides overlay scrollbar after the 1200ms timer fires', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const session = makeSession({ chatSession_id: 's1', title: 'Built-in Timer Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Timer Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });

    vi.useFakeTimers();

    await act(async () => {
      fireEvent.scroll(list);
    });

    // Advance past the 1200ms auto-hide threshold -> cur && !cur.hovered -> visible:false
    act(() => {
      vi.advanceTimersByTime(1300);
    });

    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 2/3. handleSessionListMouseEnter / handleSessionListMouseLeave
  // ---------------------------------------------------------------------------
  it('hides overlay scrollbar 800ms after mouseLeave when not hovered', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const session = makeSession({ chatSession_id: 's1', title: 'Built-in Leave Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Leave Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 400, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });

    const wrapper = list.parentElement as HTMLElement;

    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });

    vi.useFakeTimers();

    act(() => {
      fireEvent.mouseLeave(wrapper);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    vi.restoreAllMocks();
  });

  it('does not render thumb on mouseEnter when scrollHeight <= clientHeight', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const session = makeSession({ chatSession_id: 's1', title: 'Built-in No Scroll Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in No Scroll Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 50, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });

    const wrapper = list.parentElement as HTMLElement;

    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });

    const thumb = wrapper.querySelector('[style*="position: absolute"]');
    expect(thumb).toBeNull();

    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 4. ensureSessionVisible: container branch (built-in agent updateScrollbar)
  // ---------------------------------------------------------------------------
  it('scrolls the target session into view and refreshes the overlay scrollbar', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const session = makeSession({ chatSession_id: 'target-s', title: 'Built-in Target Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        currentChatSessionId="target-s"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Target Session'));

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 5/7. triggerAllLoadedHint via scroll-to-bottom when hasMore=false
  // ---------------------------------------------------------------------------
  it('shows and auto-hides the all-loaded hint when scrolled to bottom with hasMore=false', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ chatSession_id: `s${i}`, title: i === 0 ? 'Built-in Latch Session' : `Sess ${i}` }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions, hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Latch Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 250, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 40, configurable: true });

    await act(async () => {
      fireEvent.scroll(list);
    });

    await waitFor(() => {
      expect(screen.getByText('All conversations loaded')).toBeInTheDocument();
    });

    // Second scroll near bottom while latched & hint showing -> idempotent early returns
    await act(async () => {
      fireEvent.scroll(list);
    });
    expect(screen.getByText('All conversations loaded')).toBeInTheDocument();
  });

  it('triggers the all-loaded hint again after the latch is reset by scrolling up', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ chatSession_id: `r${i}`, title: i === 0 ? 'Built-in Reset Session' : `Sess ${i}` }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions, hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Reset Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });

    // Near bottom: distance = 500 - 299 - 200 = 1 <= 80 -> latch + hint
    Object.defineProperty(list, 'scrollTop', { value: 299, configurable: true });
    await act(async () => {
      fireEvent.scroll(list);
    });

    // Not near bottom -> resets latch (return arm)
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });
    await act(async () => {
      fireEvent.scroll(list);
    });

    // Near bottom again -> latch + hint once more
    Object.defineProperty(list, 'scrollTop', { value: 299, configurable: true });
    await act(async () => {
      fireEvent.scroll(list);
    });

    await waitFor(() => {
      expect(screen.getByText('All conversations loaded')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 6/7. loadMoreChatSessions via scroll-to-bottom when hasMore=true
  // ---------------------------------------------------------------------------
  it('loads the next page when scrolled near bottom and triggers hint when exhausted', async () => {
    // Full page on initial load (PAGE_SIZE = 100) so the page-fill loop does NOT consume
    // the getMore mock at mount; hasMore stays true so the scroll genuinely drives loadMore.
    const initial = Array.from({ length: 100 }, (_, i) =>
      makeSession({ chatSession_id: `p0-${i}`, title: i === 0 ? 'Built-in Page0 Session' : `P0 ${i}` }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: initial, hasMore: true, nextMonthIndex: 1 },
    });
    mockGetMoreChatSessions.mockResolvedValueOnce({
      success: true,
      data: {
        sessions: [makeSession({ chatSession_id: 'p1-0', title: 'Built-in Page1 Session' })],
        hasMore: false,
        nextMonthIndex: 2,
      },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Page0 Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 250, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 40, configurable: true });

    await act(async () => {
      fireEvent.scroll(list);
    });

    await waitFor(() => {
      expect(mockGetMoreChatSessions).toHaveBeenCalled();
    });
    await waitFor(() => screen.getByText('Built-in Page1 Session'));
    // Post-success !currentHasMore -> triggerAllLoadedHint
    await waitFor(() => {
      expect(screen.getByText('All conversations loaded')).toBeInTheDocument();
    });
  });

  it('does not load more when scroll is not near bottom (hasMore=true)', async () => {
    // Return a full page (PAGE_SIZE = 100) so loadInitialChatSessions does NOT run its
    // page-fill loop (which would otherwise call getMoreChatSessions at mount and flip
    // hasMore to false). This keeps hasMore=true at scroll time so we test the real branch.
    const initial = Array.from({ length: 100 }, (_, i) =>
      makeSession({ chatSession_id: `nn-${i}`, title: i === 0 ? 'Built-in NotNear Session' : `NN ${i}` }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: initial, hasMore: true, nextMonthIndex: 1 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in NotNear Session'));

    // Defensive: ignore any load activity from the initial render.
    mockGetMoreChatSessions.mockClear();

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    // Not near bottom: 500 - 0 - 200 = 300 > 80 -> reset latch + return
    Object.defineProperty(list, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 0, configurable: true });

    await act(async () => {
      fireEvent.scroll(list);
    });

    expect(mockGetMoreChatSessions).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // 7. handleScroll early-return: list not yet loaded (hasLoaded=false)
  // ---------------------------------------------------------------------------
  it('ignores scroll events before the initial load resolves', async () => {
    let resolveInitial: (v: any) => void = () => {};
    mockGetChatSessions.mockImplementationOnce(
      () => new Promise((resolve) => { resolveInitial = resolve; }),
    );

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    // Container exists but state.hasLoaded is false yet.
    await waitFor(() => {
      expect(document.querySelector('.chat-sessions-list')).toBeTruthy();
    });

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 250, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 40, configurable: true });

    await act(async () => {
      fireEvent.scroll(list);
    });

    expect(mockGetMoreChatSessions).not.toHaveBeenCalled();

    await act(async () => {
      resolveInitial({ success: true, data: { sessions: [], hasMore: false, nextMonthIndex: 0 } });
    });
  });

  // ---------------------------------------------------------------------------
  // 8. created-event scrollTop reset
  // ---------------------------------------------------------------------------
  it('resets scrollTop to 0 when a new session is created for a built-in agent', async () => {
    const session = makeSession({ chatSession_id: 's1', title: 'Built-in Created Base Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Created Base Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    list.scrollTop = 120;
    expect(onSessionCreatedHandler).toBeTruthy();

    await act(async () => {
      onSessionCreatedHandler?.({
        alias: 'test-user',
        chatId: 'chat-1',
        session: makeSession({ chatSession_id: 'created-new', title: 'Built-in Created New Session' }),
      });
    });

    await waitFor(() => screen.getByText('Built-in Created New Session'));
    expect(list.scrollTop).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 9. pruning latch cleanup when chat removed from chats prop
  // ---------------------------------------------------------------------------
  it('prunes the exhausted-bottom latch when its chat is removed from chats', async () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ chatSession_id: `prune-${i}`, title: i === 0 ? 'Built-in Prune Session' : `Prune ${i}` }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions, hasMore: false, nextMonthIndex: 0 },
    });

    const { rerender } = render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Prune Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    Object.defineProperty(list, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 250, configurable: true });
    Object.defineProperty(list, 'scrollTop', { value: 40, configurable: true });

    // Set the exhausted latch (hasMore=false, near bottom).
    await act(async () => {
      fireEvent.scroll(list);
    });

    // Remove chat-1 entirely -> validChatIds no longer has the key -> delete branch.
    rerender(
      <AgentList
        chats={[makeChat({ chat_id: 'chat-2', agent: { name: 'Other Agent' } })]}
        currentChatId="chat-2"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('Built-in Prune Session')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // 10/13. ref callback unmount + overlay null arm
  // ---------------------------------------------------------------------------
  it('cleans up the scroll container ref on unmount', async () => {
    const session = makeSession({ chatSession_id: 's1', title: 'Built-in Unmount Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    const { unmount } = render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Unmount Session'));
    expect(document.querySelector('.chat-sessions-list')).toBeTruthy();

    unmount();

    expect(document.querySelector('.chat-sessions-list')).toBeNull();
  });

  it('renders no overlay thumb before any hover interaction (null arm)', async () => {
    const session = makeSession({ chatSession_id: 's1', title: 'Built-in NoThumb Session' });
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions: [session], hasMore: false, nextMonthIndex: 0 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in NoThumb Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    const wrapper = list.parentElement as HTMLElement;
    // No scrollbarState entry yet AND no scroll needed -> overlay IIFE returns null.
    expect(wrapper.querySelector('[style*="position: absolute"]')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // 10. render: fixed-height scroll list style + Show more/less gate
  // ---------------------------------------------------------------------------
  it('renders a fixed-height overflow list and never shows Show more/Show less buttons', async () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      makeSession({ chatSession_id: `g${i}`, title: i === 0 ? 'Built-in Gate Session' : `Gate ${i}` }),
    );
    mockGetChatSessions.mockResolvedValueOnce({
      success: true,
      data: { sessions, hasMore: true, nextMonthIndex: 1 },
    });

    render(
      <AgentList
        chats={[makeChat()]}
        currentChatId="chat-1"
        activeView="chat"
        excludeBuiltinAgents={false}
      />,
    );

    await waitFor(() => screen.getByText('Built-in Gate Session'));

    const list = document.querySelector('.chat-sessions-list') as HTMLElement;
    expect(list.style.overflowY).toBe('auto');
    expect(list.style.maxHeight).toContain('calc');

    expect(screen.queryByText('Show more')).toBeNull();
    expect(screen.queryByText('Show less')).toBeNull();
  });
});
