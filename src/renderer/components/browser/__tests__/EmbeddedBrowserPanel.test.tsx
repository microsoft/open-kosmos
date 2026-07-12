/**
 * @vitest-environment happy-dom
 *
 * Tests for EmbeddedBrowserPanel.tsx — the renderer chrome (toolbar + bounds
 * placeholder) for the per-session embedded browser. The native page lives in a
 * main-process WebContentsView, so this component only renders controls and
 * reports placeholder bounds via IPC.
 *
 * Strategy: mock the atom (EmbeddedBrowserAtom) to expose a controllable session
 * + spy actions, and mock the IPC facade (embeddedBrowserApi/Events) so we can
 * assert the show/hide lifecycle, nav-state subscription routing, and bounds
 * reporting without electron.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── mocks (before imports) ────────────────────────────────────────────────────

const actions = vi.hoisted(() => ({
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  applyNavState: vi.fn(),
  startResize: vi.fn(),
}));

// Mutable atom state the mocked hook returns; tests tweak `atomState` per case.
const atomState = vi.hoisted(() => ({
  current: { sessions: {} as Record<string, any>, width: undefined as number | undefined, resizing: false },
}));

vi.mock('../embeddedBrowser.atom', () => ({
  EmbeddedBrowserAtom: {
    use: () => [atomState.current, actions],
  },
}));

const api = vi.hoisted(() => ({
  show: vi.fn(),
  hide: vi.fn(),
  setBounds: vi.fn(),
}));
const events = vi.hoisted(() => {
  const handlers: Array<(e: unknown, nav: any) => void> = [];
  return {
    handlers,
    navStateChanged: vi.fn((cb: (e: unknown, nav: any) => void) => {
      handlers.push(cb);
      return () => {
        const i = handlers.indexOf(cb);
        if (i >= 0) handlers.splice(i, 1);
      };
    }),
  };
});
vi.mock('@/ipc/embeddedBrowser', () => ({
  embeddedBrowserApi: api,
  embeddedBrowserEvents: { navStateChanged: events.navStateChanged },
}));

// ── imports ────────────────────────────────────────────────────────────────────

import { EmbeddedBrowserPanel, EmbeddedBrowserDivider } from '../EmbeddedBrowserPanel';

const SID = 'sess-1';

function setSession(patch: Record<string, any> = {}) {
  atomState.current = {
    sessions: {
      [SID]: {
        isOpen: true,
        url: 'https://example.com',
        title: 'Example',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        ...patch,
      },
    },
    width: undefined,
    resizing: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  events.handlers.length = 0;
  setSession();
  // happy-dom lacks ResizeObserver; provide a minimal stub.
  (globalThis as any).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  // Deterministic: no reduced-motion, no matchMedia animation tracking surprises.
  (window as any).matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // getBoundingClientRect for the placeholder.
  Element.prototype.getBoundingClientRect = vi.fn(() => ({ left: 10, top: 20, width: 300, height: 400, right: 0, bottom: 0, x: 10, y: 20, toJSON: () => ({}) })) as any;
});

afterEach(() => cleanup());

describe('EmbeddedBrowserPanel — lifecycle', () => {
  it('calls show on mount and hide on unmount', () => {
    const { unmount } = render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(api.show).toHaveBeenCalledWith(SID);
    unmount();
    expect(api.hide).toHaveBeenCalledWith(SID);
  });

  it('reports placeholder bounds to main on mount', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(api.setBounds).toHaveBeenCalledWith(SID, { x: 10, y: 20, width: 300, height: 400 });
  });

  it('subscribes to navStateChanged and routes matching session events', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(events.navStateChanged).toHaveBeenCalled();
    act(() => {
      events.handlers[0]({}, { sessionId: SID, url: 'https://n.test', title: 'N', canGoBack: true, canGoForward: false, isLoading: true });
    });
    expect(actions.applyNavState).toHaveBeenCalledWith(SID, {
      url: 'https://n.test', title: 'N', canGoBack: true, canGoForward: false, isLoading: true,
    });
  });

  it('ignores navStateChanged events for other sessions', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    act(() => {
      events.handlers[0]({}, { sessionId: 'OTHER', url: 'x', title: 'y', canGoBack: false, canGoForward: false, isLoading: false });
    });
    expect(actions.applyNavState).not.toHaveBeenCalled();
  });
});

describe('EmbeddedBrowserPanel — toolbar buttons', () => {
  it('back / forward are disabled until nav state allows them', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(screen.getByTitle('Back')).toBeDisabled();
    expect(screen.getByTitle('Forward')).toBeDisabled();
  });

  it('back / forward fire their actions when enabled', () => {
    setSession({ canGoBack: true, canGoForward: true });
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    fireEvent.click(screen.getByTitle('Back'));
    fireEvent.click(screen.getByTitle('Forward'));
    expect(actions.goBack).toHaveBeenCalledWith(SID);
    expect(actions.goForward).toHaveBeenCalledWith(SID);
  });

  it('shows Reload when not loading and fires reload', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    fireEvent.click(screen.getByTitle('Reload'));
    expect(actions.reload).toHaveBeenCalledWith(SID);
  });

  it('shows Stop (and progress bar) while loading and fires stop', () => {
    setSession({ isLoading: true });
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Stop'));
    expect(actions.stop).toHaveBeenCalledWith(SID);
  });

  it('close fires the close action', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    fireEvent.click(screen.getByTitle('Close'));
    expect(actions.close).toHaveBeenCalledWith(SID);
  });

  it('open-in-system-browser uses window.open with the live url', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    fireEvent.click(screen.getByTitle('Open in system browser'));
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('open-in-system-browser is a no-op when there is no url', () => {
    setSession({ url: '' });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    fireEvent.click(screen.getByTitle('Open in system browser'));
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe('EmbeddedBrowserPanel — address bar', () => {
  function getAddress() {
    return screen.getByPlaceholderText('Search or enter address') as HTMLInputElement;
  }

  it('normalizes a bare host to https and navigates on Enter', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'docs.test' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.navigate).toHaveBeenCalledWith(SID, 'https://docs.test');
  });

  it('keeps an explicit http scheme as-is', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'http://localhost:3000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.navigate).toHaveBeenCalledWith(SID, 'http://localhost:3000');
  });

  it.each([
    ['localhost:3000', 'http://localhost:3000'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080'],
    ['0.0.0.0:5173', 'http://0.0.0.0:5173'],
    ['::1', 'http://[::1]'],
    ['::1:9229', 'http://[::1]:9229'],
    ['::1/debug', 'http://[::1]/debug'],
    ['[::1]:9229', 'http://[::1]:9229'],
  ])('normalizes loopback shorthand %s to %s', (address, expected) => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: address } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.navigate).toHaveBeenCalledWith(SID, expected);
  });

  it.each(['file:///tmp/page.html', 'javascript://alert(1)', 'data://text/plain,secret'])(
    'does not navigate non-web scheme %s',
    (address) => {
      render(<EmbeddedBrowserPanel sessionId={SID} />);
      const input = getAddress();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: address } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(actions.navigate).not.toHaveBeenCalled();
    },
  );

  it('turns a non-host query into a Bing search', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'hello world' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.navigate).toHaveBeenCalledWith(SID, expect.stringContaining('bing.com/search?q='));
  });

  it('does not navigate when the address is empty', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it('Escape restores the live url and blurs', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'typing...' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('https://example.com');
    expect(actions.navigate).not.toHaveBeenCalled();
  });

  it('blur resets the input back to the live url', () => {
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    const input = getAddress();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'half-typed' } });
    fireEvent.blur(input);
    expect(input.value).toBe('https://example.com');
  });
});

describe('EmbeddedBrowserPanel — width + reduced motion', () => {
  it('pins an explicit pixel width when the atom has one', () => {
    atomState.current = { ...atomState.current, width: 480 };
    const { container } = render(<EmbeddedBrowserPanel sessionId={SID} />);
    const panel = container.querySelector('.embedded-browser-panel') as HTMLElement;
    expect(panel.style.flex).toBe('0 0 480px');
  });

  it('reports bounds once under reduced motion (no rAF loop)', () => {
    (window as any).matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(api.setBounds).toHaveBeenCalled();
  });

  it('treats missing matchMedia as no reduced-motion preference', () => {
    (window as any).matchMedia = undefined;
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    expect(api.setBounds).toHaveBeenCalled();
  });

  it('renders with no session entry (all optional chains fall back)', () => {
    atomState.current = { sessions: {}, width: undefined, resizing: false };
    render(<EmbeddedBrowserPanel sessionId={SID} />);
    // Back/forward disabled, Reload shown (not loading), address empty.
    expect(screen.getByTitle('Back')).toBeDisabled();
    expect(screen.getByTitle('Reload')).toBeTruthy();
    const input = screen.getByPlaceholderText('Search or enter address') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('runs the slide-in animation rAF tick and settles on animationend', () => {
    // Controllable rAF: collect callbacks, flush once manually (tick re-schedules
    // into the queue without recursing synchronously).
    const rafQueue: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { container } = render(<EmbeddedBrowserPanel sessionId={SID} />);
    const panel = container.querySelector('.embedded-browser-panel') as HTMLElement;

    api.setBounds.mockClear();
    // Flush one frame → runs `tick` (report + reschedule).
    act(() => {
      const cbs = rafQueue.splice(0);
      cbs.forEach((cb) => cb(0));
    });
    expect(api.setBounds).toHaveBeenCalled();

    // Fire animationend → runs `stop` (settles final bounds, removes listener).
    api.setBounds.mockClear();
    act(() => {
      panel.dispatchEvent(new Event('animationend'));
    });
    expect(api.setBounds).toHaveBeenCalled();

    // Any rAF frame still queued after stop must early-return on the `stopped`
    // guard (no further bounds reports).
    api.setBounds.mockClear();
    act(() => {
      const cbs = rafQueue.splice(0);
      cbs.forEach((cb) => cb(0));
    });
    expect(api.setBounds).not.toHaveBeenCalled();

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });
});

describe('EmbeddedBrowserDivider', () => {
  it('wires startResize on mousedown and reflects the dragging class', () => {
    atomState.current = { ...atomState.current, resizing: true };
    const { container } = render(<EmbeddedBrowserDivider />);
    const divider = container.querySelector('.resizable-divider') as HTMLElement;
    expect(divider.className).toContain('dragging');
    fireEvent.mouseDown(divider);
    expect(actions.startResize).toHaveBeenCalled();
  });

  it('omits the dragging class when not resizing', () => {
    atomState.current = { ...atomState.current, resizing: false };
    const { container } = render(<EmbeddedBrowserDivider />);
    const divider = container.querySelector('.resizable-divider') as HTMLElement;
    expect(divider.className).not.toContain('dragging');
  });
});
