/**
 * @vitest-environment happy-dom
 *
 * Tests for ChatSide.tsx — the right-side panel slot orchestrator. It picks ONE
 * occupant for the slot via a priority chain (per-session embedded browser wins
 * over the three singleton sidepanes), wires the capture-phase `fileViewer:open`
 * CustomEvent to the Workspace Explorer's Preview mode, and enforces mutual
 * exclusion between the singleton sidepanes and the browser.
 *
 * Strategy: mock every child component (render as markers), the four atoms
 * (controllable state + spy actions via vi.hoisted), the `isBrowserOpenFor`
 * read helper, the session-id hook, and the embeddedBrowser IPC events facade.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

// ── mutable mock state (hoisted so vi.mock factories can close over them) ──────

const workspaceActions = vi.hoisted(() => ({ openPreview: vi.fn() }));
const browserActions = vi.hoisted(() => ({ close: vi.fn(), revealForAutomation: vi.fn() }));

const state = vi.hoisted(() => ({
  sessionId: 'sess-1' as string | null,
  workspaceVisible: false,
  scheduleVisible: false,
  subAgentVisible: false,
  memexVisible: false,
  browserOpen: false,
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  useCurrentChatSessionId: () => state.sessionId,
}));

vi.mock('../chat-side.atom', () => ({
  WorkspaceExplorerAtom: { use: () => [{ visible: state.workspaceVisible }, workspaceActions] },
  ScheduleSidepaneAtom: { use: () => [state.scheduleVisible] },
  SubAgentTasksSidepaneAtom: { use: () => [{ visible: state.subAgentVisible }] },
  MemexMemorySidepaneAtom: { use: () => [{ visible: state.memexVisible }] },
}));

vi.mock('../../browser/embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: { use: () => [{ sessions: {} }, browserActions] },
  isBrowserOpenFor: () => state.browserOpen,
}));

// Child components: render simple markers so we can assert which branch rendered.
vi.mock('../SchedulesSidepane', () => ({ default: () => <div data-testid="schedules" /> }));
vi.mock('../SubAgentTasksSidepane', () => ({ default: () => <div data-testid="subagent" /> }));
vi.mock('../MemexMemorySidepane', () => ({ default: () => <div data-testid="memex" /> }));
vi.mock('../workspace/WorkspaceExplorerSidepane', () => ({ default: () => <div data-testid="workspace" /> }));
vi.mock('../../browser/EmbeddedBrowserPanel', () => ({
  EmbeddedBrowserPanel: ({ sessionId }: { sessionId: string }) => <div data-testid="browser-panel">{sessionId}</div>,
  EmbeddedBrowserDivider: () => <div data-testid="browser-divider" />,
}));

const panelOpen = vi.hoisted(() => {
  const cbs: Array<(e: unknown, req: any) => void> = [];
  return {
    cbs,
    panelOpenRequested: vi.fn((cb: (e: unknown, req: any) => void) => {
      cbs.push(cb);
      return () => {
        const i = cbs.indexOf(cb);
        if (i >= 0) cbs.splice(i, 1);
      };
    }),
  };
});
const embeddedBrowserApi = vi.hoisted(() => ({
  setActiveSession: vi.fn(),
}));
vi.mock('../../../ipc/embeddedBrowser', () => ({
  embeddedBrowserApi,
  embeddedBrowserEvents: { panelOpenRequested: panelOpen.panelOpenRequested },
}));

// ── import after mocks ───────────────────────────────────────────────────────

import ChatSide from '../ChatSide';

function resetState() {
  state.sessionId = 'sess-1';
  state.workspaceVisible = false;
  state.scheduleVisible = false;
  state.subAgentVisible = false;
  state.browserOpen = false;
}

beforeEach(() => {
  vi.clearAllMocks();
  panelOpen.cbs.length = 0;
  resetState();
});

afterEach(() => cleanup());

describe('ChatSide — slot priority', () => {
  it('renders the three singleton sidepanes when the browser is closed', () => {
    render(<ChatSide />);
    expect(screen.getByTestId('subagent')).toBeTruthy();
    expect(screen.getByTestId('schedules')).toBeTruthy();
    expect(screen.getByTestId('workspace')).toBeTruthy();
    expect(screen.queryByTestId('browser-panel')).toBeNull();
  });

  it('renders the browser panel (over the sidepanes) when the browser is open', () => {
    state.browserOpen = true;
    render(<ChatSide />);
    expect(screen.getByTestId('browser-panel').textContent).toBe('sess-1');
    expect(screen.getByTestId('browser-divider')).toBeTruthy();
    expect(screen.queryByTestId('workspace')).toBeNull();
  });

  it('falls back to the sidepanes when browserOpen but there is no sessionId', () => {
    state.browserOpen = true;
    state.sessionId = null;
    render(<ChatSide />);
    expect(screen.queryByTestId('browser-panel')).toBeNull();
    expect(screen.getByTestId('workspace')).toBeTruthy();
  });
});

describe('ChatSide — fileViewer:open routing', () => {
  it('routes a tree-origin event to openPreview(file, "tree")', () => {
    render(<ChatSide />);
    const file = { name: 'a.md', url: 'file:///a.md' };
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file, origin: 'tree' } }));
    });
    expect(workspaceActions.openPreview).toHaveBeenCalledWith(file, 'tree');
  });

  it('routes a non-tree origin to openPreview(file, "chat")', () => {
    render(<ChatSide />);
    const file = { name: 'b.md', url: 'file:///b.md' };
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file, origin: 'chat' } }));
    });
    expect(workspaceActions.openPreview).toHaveBeenCalledWith(file, 'chat');
  });

  it('defaults a missing origin to "chat"', () => {
    render(<ChatSide />);
    const file = { name: 'c.md', url: 'file:///c.md' };
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file } }));
    });
    expect(workspaceActions.openPreview).toHaveBeenCalledWith(file, 'chat');
  });

  it('ignores an event whose detail lacks a complete file (no name/url)', () => {
    render(<ChatSide />);
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file: { name: 'x' } } }));
    });
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open', { detail: {} }));
    });
    expect(workspaceActions.openPreview).not.toHaveBeenCalled();
  });

  it('tolerates an event with no detail at all (|| {} fallback)', () => {
    render(<ChatSide />);
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open'));
    });
    expect(workspaceActions.openPreview).not.toHaveBeenCalled();
  });

  it('sets and clears the __inlineFilePreviewEnabled flag on mount/unmount', () => {
    const { unmount } = render(<ChatSide />);
    expect((window as any).__inlineFilePreviewEnabled).toBe(true);
    unmount();
    expect((window as any).__inlineFilePreviewEnabled).toBe(false);
  });

  it('stops listening after unmount', () => {
    const { unmount } = render(<ChatSide />);
    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent('fileViewer:open', { detail: { file: { name: 'a', url: 'u' } } }));
    });
    expect(workspaceActions.openPreview).not.toHaveBeenCalled();
  });
});

describe('ChatSide — mutual exclusion (singleton open closes browser)', () => {
  it('closes the browser when a singleton is visible AND the browser is open', () => {
    state.workspaceVisible = true;
    state.browserOpen = true;
    render(<ChatSide />);
    expect(browserActions.close).toHaveBeenCalledWith('sess-1');
  });

  it('does not close the browser when no singleton is visible', () => {
    state.browserOpen = true;
    render(<ChatSide />);
    expect(browserActions.close).not.toHaveBeenCalled();
  });

  it('does not close the browser when the browser is not open', () => {
    state.scheduleVisible = true;
    render(<ChatSide />);
    expect(browserActions.close).not.toHaveBeenCalled();
  });

  it('does not close when there is no current session', () => {
    state.subAgentVisible = true;
    state.browserOpen = true;
    state.sessionId = null;
    render(<ChatSide />);
    expect(browserActions.close).not.toHaveBeenCalled();
  });
});

describe('ChatSide — panelOpenRequested automation', () => {
  it('subscribes and reveals the panel for automation requests', () => {
    render(<ChatSide />);
    expect(panelOpen.panelOpenRequested).toHaveBeenCalled();
    act(() => {
      panelOpen.cbs[0]({}, { sessionId: 'auto-1', url: 'https://auto.test' });
    });
    expect(browserActions.revealForAutomation).toHaveBeenCalledWith('auto-1', 'https://auto.test');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ChatSide />);
    expect(panelOpen.cbs.length).toBe(1);
    unmount();
    expect(panelOpen.cbs.length).toBe(0);
  });
});

describe('ChatSide — active session reporting', () => {
  it('reports the current session on mount and clears it on unmount', () => {
    const { unmount } = render(<ChatSide />);
    expect(embeddedBrowserApi.setActiveSession).toHaveBeenCalledWith('sess-1');

    unmount();
    expect(embeddedBrowserApi.setActiveSession).toHaveBeenLastCalledWith(null);
  });

  it('reports null when there is no current session', () => {
    state.sessionId = null;

    render(<ChatSide />);

    expect(embeddedBrowserApi.setActiveSession).toHaveBeenCalledWith(null);
  });
});
