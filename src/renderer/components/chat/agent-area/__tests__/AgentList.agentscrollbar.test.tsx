// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * AgentList.agentscrollbar.test.tsx
 * Covers the REGULAR (searchable) agent list's own hover overlay scrollbar
 * (Task 4). This scrollbar only renders for the main list instance, which is
 * the one rendered with `showSearch` true. It reuses the same scrollbar
 * machinery as the built-in session lists, keyed by AGENT_LIST_SCROLLBAR_KEY.
 *
 * Areas exercised:
 *  - Inner scroll viewport ref registration (showSearch true)
 *  - handleSessionListMouseEnter -> requestAnimationFrame -> updateScrollbar
 *  - Overlay thumb render (sb && needsScroll true)
 *  - No thumb when content does not overflow (needsScroll false)
 *  - onScroll -> updateScrollbar reposition + 1200ms auto-hide timer
 *  - mouseLeave 800ms hide timer
 *  - Pinned built-in instance (showSearch false) uses display:contents and
 *    renders no agent-list overlay thumb / no viewport className
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

/** The outer position:relative wrapper rendered by AgentList. */
const getRoot = (container: HTMLElement): HTMLElement => container.firstChild as HTMLElement;

/**
 * The scroller viewport's parent. The search header now lives OUTSIDE the
 * scroller; the viewport + overlay thumb are wrapped in this position:relative
 * container so only the starred/regular agents scroll under the thumb.
 */
const getViewportWrapper = (container: HTMLElement): HTMLElement =>
  (container.querySelector('.agent-list-scroll-viewport') as HTMLElement).parentElement as HTMLElement;

/** The agent-list overlay thumb is the only absolute-positioned DIRECT child of a parent. */
const getAgentThumb = (parent: HTMLElement): HTMLElement | null =>
  (Array.from(parent.children).find((c) =>
    (c.getAttribute('style') || '').includes('position: absolute'),
  ) as HTMLElement) || null;

const overflow = (el: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop = 0) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true });
};

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
  vi.restoreAllMocks();
});

// =============================================================================
// Regular (searchable) agent list: hover overlay scrollbar
// =============================================================================

describe('Regular agent list: hover overlay scrollbar (showSearch)', () => {
  it('shows the overlay thumb on mouseEnter when the agent list overflows', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const { container } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" showSearch />,
    );

    await waitFor(() => screen.getByTestId('agent-avatar'));

    const viewport = document.querySelector('.agent-list-scroll-viewport') as HTMLElement;
    expect(viewport).toBeTruthy();
    overflow(viewport, 400, 100, 0);

    const wrapper = getViewportWrapper(container);
    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });

    await waitFor(() => {
      const thumb = getAgentThumb(wrapper);
      expect(thumb).toBeTruthy();
      expect(thumb!.getAttribute('style')).toContain('opacity: 1');
    });
  });

  it('does not render a thumb when the agent list does not overflow', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const { container } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" showSearch />,
    );

    await waitFor(() => screen.getByTestId('agent-avatar'));

    const viewport = document.querySelector('.agent-list-scroll-viewport') as HTMLElement;
    overflow(viewport, 50, 200, 0);

    const wrapper = getViewportWrapper(container);
    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });

    expect(getAgentThumb(wrapper)).toBeNull();
  });

  it('repositions and keeps the thumb visible on scroll', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const { container } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" showSearch />,
    );

    await waitFor(() => screen.getByTestId('agent-avatar'));

    const viewport = document.querySelector('.agent-list-scroll-viewport') as HTMLElement;
    overflow(viewport, 400, 100, 120);

    const wrapper = getViewportWrapper(container);
    await act(async () => {
      fireEvent.scroll(viewport);
    });

    await waitFor(() => {
      const thumb = getAgentThumb(wrapper);
      expect(thumb).toBeTruthy();
      expect(thumb!.getAttribute('style')).toContain('opacity: 1');
    });
  });

  it('auto-hides the thumb 1200ms after a scroll when not hovered', async () => {
    const { container } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" showSearch />,
    );

    await waitFor(() => screen.getByTestId('agent-avatar'));

    const viewport = document.querySelector('.agent-list-scroll-viewport') as HTMLElement;
    overflow(viewport, 400, 100, 0);

    const wrapper = getViewportWrapper(container);

    // Fake timers must be active BEFORE the scroll so updateScrollbar's 1200ms
    // auto-hide timer is schedulable via advanceTimersByTime.
    vi.useFakeTimers();

    act(() => {
      fireEvent.scroll(viewport);
    });

    expect(getAgentThumb(wrapper)!.getAttribute('style')).toContain('opacity: 1');

    act(() => {
      vi.advanceTimersByTime(1300);
    });

    expect(getAgentThumb(wrapper)!.getAttribute('style')).toContain('opacity: 0');

    vi.useRealTimers();
  });

  it('hides the thumb 800ms after mouseLeave', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const { container } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" showSearch />,
    );

    await waitFor(() => screen.getByTestId('agent-avatar'));

    const viewport = document.querySelector('.agent-list-scroll-viewport') as HTMLElement;
    overflow(viewport, 400, 100, 0);

    const wrapper = getViewportWrapper(container);

    await act(async () => {
      fireEvent.mouseEnter(wrapper);
    });
    await waitFor(() => {
      expect(getAgentThumb(wrapper)!.getAttribute('style')).toContain('opacity: 1');
    });

    vi.useFakeTimers();
    act(() => {
      fireEvent.mouseLeave(wrapper);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(getAgentThumb(wrapper)!.getAttribute('style')).toContain('opacity: 0');
    });
  });
});

// =============================================================================
// Pinned built-in instance (showSearch false): no agent-list scrollbar
// =============================================================================

describe('Pinned built-in instance: no agent-list overlay scrollbar', () => {
  it('uses display:contents and renders no agent-list viewport or overlay thumb', async () => {
    vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 0; });

    const { container } = render(
      <AgentList chats={[makeChat()]} currentChatId="chat-1" activeView="chat" />,
    );

    await waitFor(() => screen.getByTestId('agent-avatar'));

    // No searchable viewport, and the inner wrapper is layout-neutral.
    expect(document.querySelector('.agent-list-scroll-viewport')).toBeNull();

    const root = getRoot(container);
    const innerWrapper = root.firstElementChild as HTMLElement;
    expect(innerWrapper.getAttribute('style')).toContain('display: contents');

    // mouseEnter is a no-op (no handler wired) -> no thumb appears.
    await act(async () => {
      fireEvent.mouseEnter(root);
    });
    expect(getAgentThumb(root)).toBeNull();
  });
});
