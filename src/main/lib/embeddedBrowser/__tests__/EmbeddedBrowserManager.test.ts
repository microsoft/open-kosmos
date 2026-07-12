/**
 * Tests for EmbeddedBrowserManager.ts — owns the per-session native
 * WebContentsView lifecycle (foreground/background/destroy), the agent
 * automation API, and the shared Chrome-identity header rewriting.
 *
 * Strategy: this file declares its own `vi.mock('electron')` (overriding the
 * minimal global mock in tests/setup.ts) providing a stateful WebContentsView
 * whose webContents is a controllable event emitter, plus `session`/`shell`.
 * A vi.hoisted registry exposes every created view so tests can emit
 * webContents events (did-finish-load, did-stop-loading, …) and reach internal
 * state. `@shared/ipc/embeddedBrowser` and the logger are also mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted registry shared by the electron mock and the tests ──────────────────
const h = vi.hoisted(() => {
  const created: any[] = [];
  let identityCb: ((details: any, cb: (r: any) => void) => void) | null = null;
  let nextAttachError: Error | null = null;
  function makeEmitter() {
    const handlers: Record<string, Function[]> = {};
    return {
      handlers,
      on: vi.fn((evt: string, cb: Function) => {
        (handlers[evt] ||= []).push(cb);
      }),
      off: vi.fn((evt: string, cb: Function) => {
        handlers[evt] = (handlers[evt] || []).filter((f) => f !== cb);
      }),
      emit: (evt: string, ...args: any[]) => {
        (handlers[evt] || []).slice().forEach((f) => f(...args));
      },
    };
  }
  const partitionSession = makeEmitter();
  return {
    created,
    partitionSession,
    makeEmitter,
    setIdentityCb: (cb: any) => {
      identityCb = cb;
    },
    getIdentityCb: () => identityCb,
    failNextDebuggerAttach: (error: Error) => { nextAttachError = error; },
    consumeNextDebuggerAttachError: () => {
      const error = nextAttachError;
      nextAttachError = null;
      return error;
    },
  };
});

// ── electron mock (file-level override of the global one) ───────────────────────
vi.mock('electron', () => {
  class WebContentsView {
    public webContents: any;
    public _bounds = { x: 0, y: 0, width: 800, height: 600 };
    public setBounds = vi.fn((b: any) => {
      this._bounds = b;
    });
    public getBounds = vi.fn(() => this._bounds);
    constructor(_opts: any) {
      const em = h.makeEmitter();
      this.webContents = {
        id: h.created.length + 1,
        __em: em,
        on: em.on,
        off: em.off,
        loadURL: vi.fn(() => Promise.resolve()),
        setUserAgent: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        reload: vi.fn(),
        stop: vi.fn(),
        getURL: vi.fn(() => 'https://current.test'),
        getTitle: vi.fn(() => 'Current Title'),
        isLoading: vi.fn(() => false),
        isDestroyed: vi.fn(() => false),
        close: vi.fn(),
        capturePage: vi.fn(() => Promise.resolve({ toPNG: () => Buffer.from('PNGBYTES') })),
        executeJavaScript: vi.fn(() => Promise.resolve('js-result')),
        navigationHistory: {
          canGoBack: vi.fn(() => false),
          canGoForward: vi.fn(() => false),
          goBack: vi.fn(),
          goForward: vi.fn(),
        },
        debugger: {
          isAttached: vi.fn(() => false),
          attach: vi.fn(() => {
            const error = h.consumeNextDebuggerAttachError();
            if (error) throw error;
          }),
          detach: vi.fn(),
          on: vi.fn(),
          off: vi.fn(),
          sendCommand: vi.fn(() => Promise.resolve('cdp-result')),
        },
      };
      h.created.push(this);
    }
  }
  const sessionObj = {
    fromPartition: vi.fn(() => ({
      ...h.partitionSession,
      setUserAgent: vi.fn(),
      webRequest: {
        onBeforeSendHeaders: vi.fn((_filter: any, cb: any) => h.setIdentityCb(cb)),
      },
    })),
  };
  return {
    WebContentsView,
    session: sessionObj,
    shell: { openExternal: vi.fn() },
  };
});

// ── IPC + logger mocks ──────────────────────────────────────────────────────────
const navSpy = vi.hoisted(() => vi.fn());
const panelSpy = vi.hoisted(() => vi.fn());
vi.mock('@shared/ipc/embeddedBrowser', () => ({
  mainToRender: {
    bindWebContents: vi.fn(() => ({ navStateChanged: navSpy, panelOpenRequested: panelSpy })),
  },
}));
vi.mock('../unifiedLogger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── imports under test ──────────────────────────────────────────────────────────
import {
  EmbeddedBrowserManager,
  initEmbeddedBrowserManager,
  getEmbeddedBrowserManager,
  registerEmbeddedBrowserRuntimeCleanup,
  redactEmbeddedBrowserDiagnosticUrl,
} from '../EmbeddedBrowserManager';
import { session, shell } from 'electron';

// ── helpers ─────────────────────────────────────────────────────────────────────
function makeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { id: 1 },
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  };
}

/** webContents of the most recently created view. */
function lastWc() {
  return h.created[h.created.length - 1].webContents;
}
function lastView() {
  return h.created[h.created.length - 1];
}
async function waitForAutomationNavigationSetup(wc = lastWc()) {
  for (let i = 0; i < 10 && wc.loadURL.mock.calls.length === 0; i += 1) {
    await Promise.resolve();
  }
}

let win: ReturnType<typeof makeWindow>;
let manager: EmbeddedBrowserManager;

beforeEach(() => {
  vi.clearAllMocks();
  h.created.length = 0;
  win = makeWindow();
  manager = new EmbeddedBrowserManager(() => win as any);
  manager.setActiveSession('s1');
});

afterEach(() => {
  vi.useRealTimers();
});

// ── public API: open / navigate / show / hide ─────────────────────────────────────
describe('EmbeddedBrowserManager — open / navigate', () => {
  it('open creates a view, foregrounds it, and navigates', async () => {
    await manager.open('s1', 'https://a.test');
    expect(h.created).toHaveLength(1);
    expect(win.contentView.addChildView).toHaveBeenCalled();
    expect(lastWc().loadURL).toHaveBeenCalledWith('https://a.test');
  });

  it('redacts sensitive URL params for loadURL rejection warnings', async () => {
    await manager.open('s1', 'https://a.test');
    const rawUrl = 'https://a.test/reset?password=secret&pwd=short&pass=value&safe=1#frag';

    manager.navigate('s1', rawUrl);

    expect(lastWc().loadURL).toHaveBeenLastCalledWith(rawUrl);
    expect(redactEmbeddedBrowserDiagnosticUrl(rawUrl)).toBe(
      'https://a.test/reset?password=%5Bredacted%5D&pwd=%5Bredacted%5D&pass=%5Bredacted%5D&safe=1#[redacted]',
    );
  });

  describe('EmbeddedBrowserManager — download listener branches', () => {
    it('installDownloadListener is idempotent', () => {
      const fromPartition = vi.mocked(session.fromPartition);
      (manager as any).installDownloadListener();
      expect(fromPartition).toHaveBeenCalledTimes(1);
    });

    it('skips download listener when Electron session lookup fails', () => {
      const fromPartition = vi.mocked(session.fromPartition);
      fromPartition.mockImplementationOnce(() => {
        throw new Error('mock session unavailable');
      });
      expect(() => new EmbeddedBrowserManager(() => win as any)).not.toThrow();
    });

    it('skips download listener when Electron session is unavailable', () => {
      const fromPartition = vi.mocked(session.fromPartition);
      fromPartition.mockReturnValueOnce(null as any);
      expect(() => new EmbeddedBrowserManager(() => win as any)).not.toThrow();
    });

    it('ignores will-download events for unknown webContents', async () => {
      await manager.open('s1', 'https://download.test');
      h.partitionSession.emit('will-download', {}, {}, { id: 999 });
      expect(manager.getDiagnostics('s1').downloads).toEqual([]);
    });

    it('records download events when optional item methods are missing', async () => {
      await manager.open('s1', 'https://download.test');
      const item = {
        on: vi.fn(),
        once: vi.fn(),
      };
      h.partitionSession.emit('will-download', {}, item, lastWc());
      expect(manager.getDiagnostics('s1').downloads[0]).toMatchObject({
        type: 'started',
        filename: '',
        url: '',
      });
    });

    describe('EmbeddedBrowserManager — bounded event buffers', () => {
      it('ignores diagnostics and network events for unknown sessions', () => {
        expect(() => (manager as any).pushDiagnostic('missing', { type: 'info', message: 'x' })).not.toThrow();
        expect(() => (manager as any).pushNetworkEvent('missing', { url: 'https://x.test', method: 'GET', status: 200 })).not.toThrow();
      });

      it('trims diagnostic, network, and download event buffers', async () => {
        await manager.open('s1', 'https://events.test');
        for (let i = 0; i < 55; i += 1) {
          (manager as any).pushDiagnostic('s1', { type: 'console', message: String(i) });
        }
        for (let i = 0; i < 105; i += 1) {
          (manager as any).pushNetworkEvent('s1', { url: `https://n.test/${i}`, method: 'GET', status: 200 });
          (manager as any).pushDownloadEvent('s1', { url: `https://d.test/${i}`, filename: `${i}.txt`, state: 'completed' });
        }
        const diagnostics = manager.getDiagnostics('s1');
        expect(diagnostics.recentEvents).toHaveLength(50);
        expect(diagnostics.networkEvents).toHaveLength(100);
        expect(diagnostics.downloads).toHaveLength(100);
      });

      it('captures CDP network events when optional metadata is absent', async () => {
        await manager.open('s1', 'https://network.test');
        manager.ensureDebugger('s1');
        const listener = lastWc().debugger.on.mock.calls.find((call: any[]) => call[0] === 'message')?.[1];
        listener({}, 'Network.responseReceived', {});
        listener({}, 'Network.loadingFailed', {});
        const diagnostics = manager.getDiagnostics('s1');
        expect(diagnostics.networkEvents).toEqual([
          expect.objectContaining({ type: 'response', requestId: '', url: '' }),
          expect.objectContaining({ type: 'failure', requestId: '', url: '' }),
        ]);
      });
    });
  });

  it.each(['file:///Users/me/.ssh/id_rsa', 'javascript://alert(1)', 'data://text/plain,secret', 'ftp://example.com/file'])(
    'rejects non-web open url %s',
    async (url) => {
      await expect(manager.open('s1', url)).rejects.toThrow('only supports http and https URLs');
      expect(h.created).toHaveLength(0);
    },
  );

  it('allows about:blank as a safe blank bootstrap page', async () => {
    await manager.open('s1', 'about:blank');
    expect(h.created).toHaveLength(1);
    expect(lastWc().loadURL).toHaveBeenCalledWith('about:blank');
  });

  it('navigate is a no-op when the session has no view', () => {
    manager.navigate('ghost', 'https://x.test');
    expect(h.created).toHaveLength(0);
  });

  it('show and automation fail cleanly when no window exists', async () => {
    const noWindowManager = new EmbeddedBrowserManager(() => null as any);
    noWindowManager.setActiveSession('s1');
    await expect(noWindowManager.show('s1')).resolves.toBeUndefined();
  });

  it('automation reports a clear error if view creation returns null', async () => {
    vi.spyOn(manager as any, 'ensureView').mockReturnValueOnce(null);
    await expect(manager.ensureViewForAutomation('s1', undefined)).rejects.toThrow(
      'Embedded browser view could not be created',
    );
  });

  it('show is a no-op if view creation returns null', async () => {
    vi.spyOn(manager as any, 'ensureView').mockReturnValueOnce(null);
    await expect(manager.show('s1')).resolves.toBeUndefined();
  });

  it('open reuses an existing view rather than creating a second', async () => {
    await manager.open('s1', 'https://a.test');
    await manager.open('s1', 'https://b.test');
    expect(h.created).toHaveLength(1);
  });

  it('navigate swallows a loadURL rejection', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().loadURL.mockReturnValueOnce(Promise.reject(new Error('boom')));
    expect(() => manager.navigate('s1', 'https://c.test')).not.toThrow();
    await Promise.resolve();
  });

  it('rejects non-web navigate urls at the main-process boundary', async () => {
    await manager.open('s1', 'https://a.test');
    expect(() => manager.navigate('s1', 'file:///Users/me/.ssh/id_rsa')).toThrow(
      'only supports http and https URLs',
    );
    expect(lastWc().loadURL).toHaveBeenCalledTimes(1);
  });

  it('only forwards http and https popups to the system browser', async () => {
    await manager.open('s1', 'https://a.test');
    const popupHandler = lastWc().setWindowOpenHandler.mock.calls[0][0];

    expect(popupHandler({ url: 'https://safe.test' })).toEqual({ action: 'deny' });
    expect(popupHandler({ url: 'http://safe.test' })).toEqual({ action: 'deny' });
    expect(popupHandler({ url: 'httpx://unsafe.test' })).toEqual({ action: 'deny' });
    expect(popupHandler({ url: 'javascript://alert(1)' })).toEqual({ action: 'deny' });
    expect(popupHandler({ url: 'not a url' })).toEqual({ action: 'deny' });

    expect(shell.openExternal).toHaveBeenCalledTimes(2);
    expect(shell.openExternal).toHaveBeenNthCalledWith(1, 'https://safe.test');
    expect(shell.openExternal).toHaveBeenNthCalledWith(2, 'http://safe.test');
  });

  it('blocks non-web main-frame navigations initiated by a loaded page', async () => {
    await manager.open('s1', 'https://a.test');
    const event = { preventDefault: vi.fn() };

    lastWc().__em.emit('will-navigate', event, 'file:///Users/me/.ssh/id_rsa');

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('allows http and https main-frame navigations initiated by a loaded page', async () => {
    await manager.open('s1', 'https://a.test');
    const event = { preventDefault: vi.fn() };

    lastWc().__em.emit('will-navigate', event, 'https://safe.test');

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('cancels a non-navigation automation wait while the page is still loading', async () => {
    await manager.open('s1', 'https://a.test');
    const wc = lastWc();
    wc.isLoading.mockReturnValue(true);
    const controller = new AbortController();
    const promise = manager.ensureViewForAutomation('s1', undefined, controller.signal);
    expect(wc.on).toHaveBeenCalledWith('did-stop-loading', expect.any(Function));

    controller.abort();

    await expect(promise).rejects.toThrow('aborted');
    expect(wc.stop).toHaveBeenCalledTimes(1);
    expect(wc.off).toHaveBeenCalledWith('did-stop-loading', expect.any(Function));
  });

  it('blocks non-web main-frame redirects initiated by a loaded page', async () => {
    await manager.open('s1', 'https://a.test');
    const event = { preventDefault: vi.fn() };

    lastWc().__em.emit('will-redirect', event, 'custom-protocol://payload');

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('EmbeddedBrowserManager — show', () => {
  it('recreates a reclaimed view and reloads its last URL', async () => {
    vi.useFakeTimers();
    await manager.open('s1', 'https://a.test'); // remembers lastUrls[s1]
    lastWc().getURL.mockReturnValue('https://a.test');
    manager.hide('s1');
    vi.advanceTimersByTime(5 * 60 * 1000); // idle reclaim destroys the view, not remembered URL
    expect(h.created).toHaveLength(1);
    await manager.show('s1');
    expect(h.created).toHaveLength(2); // recreated
    expect(lastWc().loadURL).toHaveBeenCalledWith('https://a.test');
  });

  it('reuses a living view without reloading', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().loadURL.mockClear();
    await manager.show('s1');
    expect(h.created).toHaveLength(1);
    expect(lastWc().loadURL).not.toHaveBeenCalled();
  });
});

describe('EmbeddedBrowserManager — hide / setBounds', () => {
  it('hide detaches the foreground view and arms the idle timer', () => {
    vi.useFakeTimers();
    manager.open('s1', 'https://a.test');
    manager.hide('s1');
    expect(win.contentView.removeChildView).toHaveBeenCalled();
    // Idle timer destroys the view after IDLE_MS.
    vi.advanceTimersByTime(5 * 60 * 1000);
    // After destroy a later show must recreate.
  });

  it('hide on a non-foreground session only arms idle (no detach)', () => {
    manager.open('s1', 'https://a.test');
    win.contentView.removeChildView.mockClear();
    manager.hide('other');
    expect(win.contentView.removeChildView).not.toHaveBeenCalled();
  });

  it('setBounds remembers bounds even with no view', () => {
    manager.setBounds('s1', { x: 1, y: 2, width: 3, height: 4 });
    expect(h.created).toHaveLength(0);
  });

  it('setBounds applies rounded bounds to a foreground view', async () => {
    await manager.open('s1', 'https://a.test');
    lastView().setBounds.mockClear();
    manager.setBounds('s1', { x: 1.4, y: 2.6, width: 3.5, height: 4.5 });
    expect(lastView().setBounds).toHaveBeenCalledWith({ x: 1, y: 3, width: 4, height: 5 });
  });

  it('setBounds does not reposition a background view', async () => {
    await manager.open('s1', 'https://a.test');
    manager.hide('s1'); // background it
    lastView().setBounds.mockClear();
    manager.setBounds('s1', { x: 5, y: 5, width: 5, height: 5 });
    expect(lastView().setBounds).not.toHaveBeenCalled();
  });
});

describe('EmbeddedBrowserManager — back / forward / reload / stop', () => {
  it('goBack only navigates when history allows', async () => {
    await manager.open('s1', 'https://a.test');
    const wc = lastWc();
    wc.navigationHistory.canGoBack.mockReturnValue(false);
    manager.goBack('s1');
    expect(wc.navigationHistory.goBack).not.toHaveBeenCalled();
    wc.navigationHistory.canGoBack.mockReturnValue(true);
    manager.goBack('s1');
    expect(wc.navigationHistory.goBack).toHaveBeenCalled();
  });

  it('goForward only navigates when history allows', async () => {
    await manager.open('s1', 'https://a.test');
    const wc = lastWc();
    wc.navigationHistory.canGoForward.mockReturnValue(true);
    manager.goForward('s1');
    expect(wc.navigationHistory.goForward).toHaveBeenCalled();
  });

  it('goBack / goForward are safe no-ops without a view', () => {
    expect(() => manager.goBack('ghost')).not.toThrow();
    expect(() => manager.goForward('ghost')).not.toThrow();
  });

  it('reload / stop forward to the webContents (and no-op without a view)', async () => {
    await manager.open('s1', 'https://a.test');
    manager.reload('s1');
    manager.stop('s1');
    expect(lastWc().reload).toHaveBeenCalled();
    expect(lastWc().stop).toHaveBeenCalled();
    expect(() => manager.reload('ghost')).not.toThrow();
    expect(() => manager.stop('ghost')).not.toThrow();
  });
});

// ── foreground / detach edge cases ────────────────────────────────────────────────
describe('EmbeddedBrowserManager — foreground swapping', () => {
  it('foregrounding a second session detaches the first', async () => {
    await manager.open('s1', 'https://a.test');
    await manager.open('s2', 'https://b.test');
    // s1 detached when s2 foregrounded.
    expect(win.contentView.removeChildView).toHaveBeenCalled();
    expect(win.contentView.addChildView).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there is no window', async () => {
    const noWinManager = new EmbeddedBrowserManager(() => null);
    await noWinManager.open('s1', 'https://a.test');
    // View still created, but never attached.
    expect(h.created).toHaveLength(1);
  });

  it('does nothing when the window is destroyed', async () => {
    win.isDestroyed.mockReturnValue(true);
    await manager.open('s1', 'https://a.test');
    expect(win.contentView.addChildView).not.toHaveBeenCalled();
  });

  it('logs and swallows a removeChildView failure on detach', async () => {
    await manager.open('s1', 'https://a.test');
    win.contentView.removeChildView.mockImplementation(() => {
      throw new Error('detach boom');
    });
    expect(() => manager.hide('s1')).not.toThrow();
  });
});

// ── automation API ────────────────────────────────────────────────────────────────
describe('EmbeddedBrowserManager — ensureViewForAutomation', () => {
  it('navigates to a url and resolves nav state on did-finish-load', async () => {
    const p = manager.ensureViewForAutomation('s1', 'https://load.test');
    await waitForAutomationNavigationSetup();
    lastWc().__em.emit('did-finish-load');
    const nav = await p;
    expect(nav.sessionId).toBe('s1');
    expect(nav.url).toBe('https://current.test/');
    expect(panelSpy).toHaveBeenCalledWith({ sessionId: 's1', url: 'https://load.test' });
  });

  it('enables CDP network capture before automation navigation starts', async () => {
    const p = manager.ensureViewForAutomation('s1', 'https://network-first.test');
    const wc = lastWc();
    await waitForAutomationNavigationSetup();
    wc.__em.emit('did-finish-load');
    await p;

    expect(wc.debugger.sendCommand).toHaveBeenCalledWith('Network.enable', {});
    expect(wc.debugger.sendCommand.mock.invocationCallOrder[0]).toBeLessThan(wc.loadURL.mock.invocationCallOrder[0]);
  });

  it('continues automation navigation when CDP network capture cannot start', async () => {
    h.failNextDebuggerAttach(new Error('Another debugger is already attached'));
    const p = manager.ensureViewForAutomation('s1', 'https://debugger-busy.test');
    const wc = lastWc();
    await waitForAutomationNavigationSetup(wc);
    wc.__em.emit('did-finish-load');
    const nav = await p;

    expect(nav.sessionId).toBe('s1');
    expect(wc.loadURL).toHaveBeenCalledWith('https://debugger-busy.test');
    expect(manager.getDiagnostics('s1').recentEvents).toEqual([
      expect.objectContaining({
        type: 'console',
        level: 'warning',
        message: expect.stringContaining('Network diagnostics unavailable'),
      }),
    ]);
  });

  it('rejects automation for a non-active chat session before creating a view', async () => {
    manager.setActiveSession('other-session');

    await expect(manager.ensureViewForAutomation('s1', 'https://load.test')).rejects.toThrow(
      'active chat session',
    );
    expect(h.created).toHaveLength(0);
  });

  it('rejects automation if the user switches sessions while navigation is in flight', async () => {
    const p = manager.ensureViewForAutomation('s1', 'https://load.test');
    manager.setActiveSession('other-session');
    await waitForAutomationNavigationSetup();
    lastWc().__em.emit('did-finish-load');

    await expect(p).rejects.toThrow('active chat session');
  });

  it('aborts an in-flight automation navigation and stops the webContents load', async () => {
    const controller = new AbortController();
    const p = manager.ensureViewForAutomation('s1', 'https://slow.test', controller.signal);
    const wc = lastWc();

    await waitForAutomationNavigationSetup();
    controller.abort();

    await expect(p).rejects.toThrow('aborted');
    expect(wc.stop).toHaveBeenCalledTimes(1);
    expect(wc.off).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    expect(wc.off).toHaveBeenCalledWith('did-fail-load', expect.any(Function));
  });

  it('rejects immediately when automation navigation starts with an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(manager.ensureViewForAutomation('s1', 'https://slow.test', controller.signal)).rejects.toThrow('aborted');
    expect(lastWc().stop).toHaveBeenCalledTimes(1);
  });

  it('reloads the remembered URL when the view was idle-reclaimed', async () => {
    vi.useFakeTimers();
    await manager.open('s1', 'https://remembered.test');
    lastWc().getURL.mockReturnValue('https://remembered.test');
    manager.hide('s1');
    vi.advanceTimersByTime(5 * 60 * 1000);
    const p = manager.ensureViewForAutomation('s1'); // no url → reload lastUrls
    await waitForAutomationNavigationSetup();
    lastWc().__em.emit('did-finish-load');
    await p;
    expect(lastWc().loadURL).toHaveBeenCalledWith('https://remembered.test');
  });

  it('remembers the committed current URL before idle reclaim destroys a view', async () => {
    vi.useFakeTimers();
    await manager.open('s1', 'https://login.test');
    lastWc().getURL.mockReturnValue('https://login.test/dashboard');
    manager.hide('s1');
    vi.advanceTimersByTime(5 * 60 * 1000);
    const p = manager.ensureViewForAutomation('s1');
    await waitForAutomationNavigationSetup();
    lastWc().__em.emit('did-finish-load');
    await p;
    expect(lastWc().loadURL).toHaveBeenCalledWith('https://login.test/dashboard');
  });

  it('waits for readiness (no url) and resolves immediately when not loading', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().isLoading.mockReturnValue(false);
    const nav = await manager.ensureViewForAutomation('s1');
    expect(nav.sessionId).toBe('s1');
  });

  it('waits for readiness via did-stop-loading when the page is loading', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().isLoading.mockReturnValue(true);
    const p = manager.ensureViewForAutomation('s1');
    lastWc().__em.emit('did-stop-loading');
    const nav = await p;
    expect(nav.sessionId).toBe('s1');
  });
});

describe('EmbeddedBrowserManager — screenshots & JS', () => {
  it('hasNavigablePage reflects live view or remembered URL', async () => {
    vi.useFakeTimers();
    expect(manager.hasNavigablePage('s1')).toBe(false);
    await manager.open('s1', 'https://a.test');
    expect(manager.hasNavigablePage('s1')).toBe(true);
    manager.hide('s1');
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(manager.hasNavigablePage('s1')).toBe(true); // idle reclaim keeps lastUrls
  });

  it('destroyAll purges remembered URLs and bounds so disabled browser state cannot restore', async () => {
    const cleanup = vi.fn();
    registerEmbeddedBrowserRuntimeCleanup(cleanup);
    await manager.open('s1', 'https://a.test');
    manager.setBounds('s1', { x: 1, y: 2, width: 300, height: 200 });
    (manager as any).pushDownloadEvent('s1', { url: 'https://a.test/file.txt', filename: 'file.txt', type: 'done' });
    manager.destroyAll();
    expect(manager.hasNavigablePage('s1')).toBe(false);
    await manager.show('s1');
    expect(h.created).toHaveLength(2);
    expect(lastWc().loadURL).not.toHaveBeenCalled();
    await manager.open('s1', 'https://fresh.test');
    expect(manager.getDiagnostics('s1').downloads).toEqual([]);
    expect(cleanup).toHaveBeenCalledWith(undefined);
  });

  it('captureScreenshot returns raw base64 with no data: prefix', async () => {
    await manager.open('s1', 'https://a.test');
    const out = await manager.captureScreenshot('s1');
    expect(out.mimeType).toBe('image/png');
    expect(out.data).toBe(Buffer.from('PNGBYTES').toString('base64'));
    expect(out.data.startsWith('data:')).toBe(false);
  });

  it('captureScreenshot rounds an explicit capture rectangle', async () => {
    await manager.open('s1', 'https://a.test');
    await manager.captureScreenshot('s1', { x: 1.2, y: 2.7, width: 30.4, height: 40.8 });
    expect(lastWc().capturePage).toHaveBeenCalledWith({ x: 1, y: 3, width: 30, height: 41 });
  });

  it('captureScreenshot rejects when the session is no longer active', async () => {
    await manager.open('s1', 'https://a.test');
    manager.setActiveSession('other-session');

    await expect(manager.captureScreenshot('s1')).rejects.toThrow('active chat session');
  });

  it('captureScreenshot throws on a 0x0 (never-composited) view', async () => {
    await manager.open('s1', 'https://a.test');
    lastView().getBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
    await expect(manager.captureScreenshot('s1')).rejects.toThrow(/no visible page/i);
  });

  it('captureScreenshot throws when no view exists', async () => {
    manager.setActiveSession('ghost');
    await expect(manager.captureScreenshot('ghost')).rejects.toThrow(/navigate action first/i);
  });

  it('executeJs evaluates in the page main world', async () => {
    await manager.open('s1', 'https://a.test');
    const r = await manager.executeJs('s1', '1 + 1');
    expect(lastWc().executeJavaScript).toHaveBeenCalledWith('1 + 1', true);
    expect(r).toBe('js-result');
  });

  it('executeJs rejects when the session is no longer active', async () => {
    await manager.open('s1', 'https://a.test');
    manager.setActiveSession('other-session');

    await expect(manager.executeJs('s1', '1 + 1')).rejects.toThrow('active chat session');
    expect(lastWc().executeJavaScript).not.toHaveBeenCalledWith('1 + 1', true);
  });

  it('setAutomationViewport resizes the active view and remembers bounds', async () => {
    await manager.open('s1', 'https://a.test');
    const bounds = manager.setAutomationViewport('s1', 390, 844);
    expect(bounds).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(lastView().setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 390, height: 844 });
  });

  it('getNavState returns null without a live view and current state with one', async () => {
    expect(manager.getNavState('s1')).toBeNull();
    await manager.open('s1', 'https://a.test');
    expect(manager.getNavState('s1')).toEqual(expect.objectContaining({ sessionId: 's1' }));
  });

  it('redacts sensitive current URLs in nav state and diagnostics while preserving raw nav state internally', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().getURL.mockReturnValue('https://user:pass@a.test/callback?code=secret&safe=1#frag');

    expect(manager.getNavState('s1')).toEqual(expect.objectContaining({
      url: 'https://%5Bredacted%5D:%5Bredacted%5D@a.test/callback?code=%5Bredacted%5D&safe=1#[redacted]',
    }));
    expect(manager.getRawNavState('s1')).toEqual(expect.objectContaining({
      url: 'https://user:pass@a.test/callback?code=secret&safe=1#frag',
    }));
    expect(manager.getDiagnostics('s1')).toEqual(expect.objectContaining({
      url: 'https://%5Bredacted%5D:%5Bredacted%5D@a.test/callback?code=%5Bredacted%5D&safe=1#[redacted]',
    }));
  });

  it('captures recent diagnostics from console and load failures', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().__em.emit('console-message', {}, 0, 'debug ignored', 1, 'https://a.test/debug.js');
    lastWc().__em.emit('console-message', {}, 99, 'unknown numeric level https://user:pass@a.test/callback?code=secret#frag', 2, 'https://user:pass@a.test/unknown.js?session=secret');
    lastWc().__em.emit('console-message', {}, 2, 'console boom', 42, 'https://a.test/app.js?token=secret#frag');
    lastWc().__em.emit('console-message', {}, 'error', 'string level boom', undefined, undefined);
    lastWc().__em.emit('did-fail-load', {}, -100, 'ERR', 'https://a.test/callback?code=secret#frag', true);

    const diagnostics = manager.getDiagnostics('s1');

    expect(diagnostics.recentEvents).toEqual([
      expect.objectContaining({ type: 'console', level: '99', message: 'unknown numeric level https://%5Bredacted%5D:%5Bredacted%5D@a.test/callback?code=%5Bredacted%5D#[redacted]', line: 2, url: 'https://%5Bredacted%5D:%5Bredacted%5D@a.test/unknown.js?session=%5Bredacted%5D' }),
      expect.objectContaining({ type: 'console', level: 'warning', message: 'console boom', line: 42, url: 'https://a.test/app.js?token=%5Bredacted%5D#[redacted]' }),
      expect.objectContaining({ type: 'console', level: 'error', message: 'string level boom' }),
      expect.objectContaining({ type: 'load-failure', message: '-100 ERR', url: 'https://a.test/callback?code=%5Bredacted%5D#[redacted]' }),
    ]);
  });

  it('does not persist normal ERR_ABORTED navigation cancellations as load failures', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().__em.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.test', true);

    expect(manager.getDiagnostics('s1').recentEvents).toEqual([]);
  });

  it('captures download lifecycle diagnostics for the owning session', async () => {
    await manager.open('s1', 'https://a.test');
    const itemEmitter = h.makeEmitter();
    const item = {
      on: itemEmitter.on,
      once: itemEmitter.on,
      getFilename: vi.fn(() => 'report.csv'),
      getURL: vi.fn(() => 'https://a.test/report.csv?sig=secret&file=report'),
      getMimeType: vi.fn(() => 'text/csv'),
      getSavePath: vi.fn(() => '/tmp/report.csv'),
      getReceivedBytes: vi.fn(() => 10),
      getTotalBytes: vi.fn(() => 10),
    };
    h.partitionSession.emit('will-download', {}, item, lastWc());
    itemEmitter.emit('updated', {}, 'progressing');
    itemEmitter.emit('done', {}, 'completed');

    expect(manager.getDiagnostics('s1').downloads).toEqual([
      expect.objectContaining({ type: 'started', filename: 'report.csv', url: 'https://a.test/report.csv?sig=%5Bredacted%5D&file=report', savePath: undefined }),
      expect.objectContaining({ type: 'updated', state: 'progressing' }),
      expect.objectContaining({ type: 'done', state: 'completed', savePath: undefined }),
    ]);
  });
});

describe('EmbeddedBrowserManager — debugger / CDP', () => {
  it('ensureDebugger attaches once and is idempotent', async () => {
    await manager.open('s1', 'https://a.test');
    manager.ensureDebugger('s1');
    manager.ensureDebugger('s1'); // debuggerAttached → early return
    expect(lastWc().debugger.attach).toHaveBeenCalledTimes(1);
  });

  it('ensureDebugger skips attach when a client is already attached', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().debugger.isAttached.mockReturnValue(true);
    manager.ensureDebugger('s1');
    expect(lastWc().debugger.attach).not.toHaveBeenCalled();
  });

  it('sendCdpCommand auto-attaches then dispatches', async () => {
    await manager.open('s1', 'https://a.test');
    const r = await manager.sendCdpCommand('s1', 'Input.dispatchMouseEvent', { x: 1 });
    expect(lastWc().debugger.sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', { x: 1 });
    expect(r).toBe('cdp-result');
  });

  it('captures CDP network responses and failures with request metadata', async () => {
    await manager.open('s1', 'https://a.test');
    await manager.enableNetworkDiagnostics('s1');
    const listener = lastWc().debugger.on.mock.calls[0]?.[1];
    expect(listener).toBeTypeOf('function');
    listener({}, 'Network.requestWillBeSent', {
      requestId: 'r1',
      request: {
        url: 'https://a.test/app.js?access_token=secret&safe=1#frag',
        method: 'GET',
        headers: {
          Accept: 'text/javascript',
          Referer: 'https://login.test/callback?code=secret#frag',
          'api-key': 'secret',
          Authorization: 'Bearer secret',
          Cookie: 'sid=secret',
          'Ocp-Apim-Subscription-Key': 'secret',
          'X-Ms-Token-Aad-Id-Token': 'secret',
        },
      },
    });
    listener({}, 'Network.responseReceived', {
      requestId: 'r1',
      type: 'Script',
      response: {
        url: 'https://a.test/app.js?access_token=secret&safe=1#frag',
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': 'application/javascript',
          Location: 'https://login.test/redirect?session=secret#frag',
          'Set-Cookie': 'sid=secret',
          'X-Goog-Api-Key': 'secret',
          'X-Session-Id': 'secret',
        },
        timing: { receiveHeadersEnd: 12 },
      },
    });
    listener({}, 'Network.requestWillBeSent', {
      requestId: 'r2',
      request: { url: 'https://a.test/app.js', method: 'GET', headers: { Accept: 'text/javascript' } },
    });
    listener({}, 'Network.loadingFailed', {
      requestId: 'r2',
      type: 'Script',
      errorText: 'net::ERR_ABORTED',
    });
    expect(manager.getDiagnostics('s1').networkEvents).toEqual([
      expect.objectContaining({
        type: 'response',
        url: 'https://a.test/app.js?access_token=%5Bredacted%5D&safe=1#[redacted]',
        status: 200,
        method: 'GET',
        requestHeaders: {
          Accept: 'text/javascript',
          Referer: 'https://login.test/callback?code=%5Bredacted%5D#[redacted]',
          'api-key': '[redacted]',
          Authorization: '[redacted]',
          Cookie: '[redacted]',
          'Ocp-Apim-Subscription-Key': '[redacted]',
          'X-Ms-Token-Aad-Id-Token': '[redacted]',
        },
        responseHeaders: {
          'Content-Type': 'application/javascript',
          Location: 'https://login.test/redirect?session=%5Bredacted%5D#[redacted]',
          'Set-Cookie': '[redacted]',
          'X-Goog-Api-Key': '[redacted]',
          'X-Session-Id': '[redacted]',
        },
        timing: { receiveHeadersEnd: 12 },
      }),
      expect.objectContaining({
        type: 'failure',
        url: 'https://a.test/app.js',
        method: 'GET',
        errorText: 'net::ERR_ABORTED',
        requestHeaders: { Accept: 'text/javascript' },
      }),
    ]);
    expect((manager as any).views.get('s1').networkRequests.size).toBe(0);
  });

  it('caps pending CDP network request metadata', async () => {
    await manager.open('s1', 'https://a.test');
    await manager.enableNetworkDiagnostics('s1');
    const listener = lastWc().debugger.on.mock.calls[0]?.[1];
    listener({}, 'Network.requestWillBeSent', { requestId: 'missing-request' });
    listener({}, 'Network.requestWillBeSent', { requestId: 123, request: { url: 'https://a.test/ignored' } });
    for (let i = 0; i < 205; i += 1) {
      listener({}, 'Network.requestWillBeSent', {
        requestId: `r${i}`,
        request: { url: `https://a.test/${i}`, method: 'GET' },
      });
    }
    const requests = (manager as any).views.get('s1').networkRequests as Map<string, unknown>;
    expect(requests.size).toBe(200);
    expect(requests.has('missing-request')).toBe(false);
    expect(requests.has('r0')).toBe(false);
    expect(requests.has('r204')).toBe(true);
  });

  it('does not register duplicate CDP network listeners', async () => {
    await manager.open('s1', 'https://a.test');
    await manager.enableNetworkDiagnostics('s1');
    const listenerCount = lastWc().debugger.on.mock.calls.length;

    manager.ensureDebugger('s1');

    expect(lastWc().debugger.on).toHaveBeenCalledTimes(listenerCount);
  });

  it('sendCdpCommand rejects when the session is no longer active', async () => {
    await manager.open('s1', 'https://a.test');
    manager.setActiveSession('other-session');

    await expect(manager.sendCdpCommand('s1', 'Input.dispatchMouseEvent', { x: 1 })).rejects.toThrow(
      'active chat session',
    );
    expect(lastWc().debugger.sendCommand).not.toHaveBeenCalled();
  });
});

// ── destroy / teardown ────────────────────────────────────────────────────────────
describe('EmbeddedBrowserManager — destroyView paths', () => {
  it('destroyView detaches an attached debugger before closing', async () => {
    await manager.open('s1', 'https://a.test');
    manager.ensureDebugger('s1');
    lastWc().debugger.isAttached.mockReturnValue(true);
    const wc = lastWc();
    manager.destroyAll();
    expect(wc.debugger.detach).toHaveBeenCalled();
    expect(wc.close).toHaveBeenCalled();
  });

  it('destroyView swallows a close failure', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().close.mockImplementation(() => {
      throw new Error('close boom');
    });
    expect(() => manager.destroyAll()).not.toThrow();
  });

  it('destroyView skips close when webContents already destroyed', async () => {
    await manager.open('s1', 'https://a.test');
    lastWc().isDestroyed.mockReturnValue(true);
    manager.destroyAll();
    expect(lastWc().close).not.toHaveBeenCalled();
  });

  it('destroySession purges one session without clearing other remembered pages', async () => {
    const cleanup = vi.fn();
    registerEmbeddedBrowserRuntimeCleanup(cleanup);
    await manager.open('s1', 'https://a.test');
    await manager.open('s2', 'https://b.test');
    (manager as any).pushDownloadEvent('s1', { url: 'https://a.test/file.txt', filename: 'file.txt', type: 'done' });

    manager.destroySession('s1');

    expect(manager.hasNavigablePage('s1')).toBe(false);
    expect(manager.hasNavigablePage('s2')).toBe(true);
    manager.setActiveSession('s1');
    await manager.open('s1', 'https://fresh.test');
    expect(manager.getDiagnostics('s1').downloads).toEqual([]);
    expect(cleanup).toHaveBeenCalledWith('s1');
  });
});

// ── nav-event wiring & popups ──────────────────────────────────────────────────────
describe('EmbeddedBrowserManager — webContents wiring', () => {
  it('emits nav state to the renderer on did-navigate', async () => {
    await manager.open('s1', 'https://a.test');
    navSpy.mockClear();
    lastWc().__em.emit('did-navigate');
    expect(navSpy).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
  });

  it('logs main-frame load failures and pushes state', async () => {
    await manager.open('s1', 'https://a.test');
    navSpy.mockClear();
    // isMainFrame=false → ignored
    lastWc().__em.emit('did-fail-load', {}, -100, 'ERR', 'https://x', false);
    expect(navSpy).not.toHaveBeenCalled();
    // isMainFrame=true → logged + pushState
    lastWc().__em.emit('did-fail-load', {}, -100, 'ERR', 'https://x', true);
    expect(navSpy).toHaveBeenCalled();
  });

  it('routes in-page popups to the system browser and denies them', async () => {
    await manager.open('s1', 'https://a.test');
    const handler = lastWc().setWindowOpenHandler.mock.calls[0][0];
    expect(handler({ url: 'https://popup.test' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).toHaveBeenCalledWith('https://popup.test');
    // Non-http popups are denied without opening externally.
    (shell.openExternal as any).mockClear();
    expect(handler({ url: 'about:blank' })).toEqual({ action: 'deny' });
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('emitNavState guards when the window is destroyed', async () => {
    await manager.open('s1', 'https://a.test');
    navSpy.mockClear();
    win.isDestroyed.mockReturnValue(true);
    lastWc().__em.emit('did-navigate');
    expect(navSpy).not.toHaveBeenCalled();
  });
});

// ── loadAndWait timeout + double-settle ─────────────────────────────────────────────
describe('EmbeddedBrowserManager — loadAndWait edge cases', () => {
  it('resolves on the timeout when the load never settles', async () => {
    vi.useFakeTimers();
    await manager.open('s1', 'https://a.test');
    const p = manager.ensureViewForAutomation('s1', 'https://hang.test');
    await waitForAutomationNavigationSetup();
    await vi.advanceTimersByTimeAsync(30 * 1000);
    await expect(p).resolves.toBeDefined();
  });

  it('did-fail-load on a sub-frame does not settle the load', async () => {
    const p = manager.ensureViewForAutomation('s1', 'https://load.test');
    const wc = lastWc();
    await waitForAutomationNavigationSetup();
    wc.__em.emit('did-fail-load', {}, -1, 'x', 'u', false); // sub-frame: ignored
    wc.__em.emit('did-finish-load'); // main-frame finish: settles
    await expect(p).resolves.toBeDefined();
  });
});

// ── singleton accessor ──────────────────────────────────────────────────────────────
describe('EmbeddedBrowserManager — singleton accessor', () => {
  it('init stores and get returns the same instance', () => {
    const inst = initEmbeddedBrowserManager(() => win as any);
    expect(getEmbeddedBrowserManager()).toBe(inst);
  });
});

// ── Chrome identity header rewriting ─────────────────────────────────────────────────
describe('EmbeddedBrowserManager — Chrome identity headers', () => {
  it('rewrites UA + client-hint headers on outgoing requests', async () => {
    // Creating any view runs configureEmbeddedBrowserChromeIdentity once, which
    // registers the onBeforeSendHeaders callback captured by the mock.
    await manager.open('s1', 'https://a.test');
    const cb = h.getIdentityCb();
    expect(cb).toBeTypeOf('function');

    const callback = vi.fn();
    cb!(
      {
        requestHeaders: {
          // lowercase existing UA → setRequestHeader finds existingKey
          'user-agent': 'old-ua',
          // present optional hints → setRequestHeaderIfPresent updates them
          'sec-ch-ua-arch': '"old"',
          'sec-ch-ua-full-version': '"0"',
        },
      },
      callback,
    );
    expect(callback).toHaveBeenCalledTimes(1);
    const out = callback.mock.calls[0][0].requestHeaders;
    expect(out['user-agent']).toContain('Chrome/');
    expect(out['sec-ch-ua']).toContain('Google Chrome');
    expect(out['sec-ch-ua-mobile']).toBe('?0');
    // absent optional hints stay absent (setRequestHeaderIfPresent no-op)
    expect(out['sec-ch-ua-bitness']).toBeUndefined();
  });

  it('reflects a Windows / arm identity when the platform reports them', async () => {
    await manager.open('s1', 'https://a.test');
    const cb = h.getIdentityCb()!;

    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
    const origChrome = process.versions.chrome;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    Object.defineProperty(process.versions, 'chrome', { value: '120.0.6099.1', configurable: true });
    try {
      const callback = vi.fn();
      // Seed lowercase user-agent + arch so the case-insensitive header writes
      // land back on the lowercase keys we then assert.
      cb({ requestHeaders: { 'user-agent': 'old', 'sec-ch-ua-arch': '"x"' } }, callback);
      const out = callback.mock.calls[0][0].requestHeaders;
      expect(out['user-agent']).toContain('Windows NT 10.0');
      expect(out['user-agent']).toContain('ARM64');
      expect(out['user-agent']).not.toContain('Win64; x64');
      expect(out['sec-ch-ua-platform']).toBe('"Windows"');
      expect(out['sec-ch-ua-arch']).toBe('"arm"');
      expect(out['sec-ch-ua']).toContain('v="120"');
    } finally {
      if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
      if (origArch) Object.defineProperty(process, 'arch', origArch);
      Object.defineProperty(process.versions, 'chrome', {
        value: origChrome,
        configurable: true,
      });
    }
  });

  it('reflects a Windows x64 identity when process.arch is not arm64', async () => {
    await manager.open('s1', 'https://a.test');
    const cb = h.getIdentityCb()!;

    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    try {
      const callback = vi.fn();
      cb({ requestHeaders: { 'user-agent': 'old' } }, callback);
      expect(callback.mock.calls[0][0].requestHeaders['user-agent']).toContain('Win64; x64');
    } finally {
      if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
      if (origArch) Object.defineProperty(process, 'arch', origArch);
    }
  });

  it('reflects a macOS arm identity when process.arch is arm64', async () => {
    await manager.open('s1', 'https://a.test');
    const cb = h.getIdentityCb()!;

    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
    try {
      const callback = vi.fn();
      cb({ requestHeaders: { 'user-agent': 'old', 'sec-ch-ua-arch': '"x"' } }, callback);
      const out = callback.mock.calls[0][0].requestHeaders;
      expect(out['user-agent']).toContain('Macintosh; ARM Mac OS X');
      expect(out['user-agent']).not.toContain('Intel Mac OS X');
      expect(out['sec-ch-ua-platform']).toBe('"macOS"');
      expect(out['sec-ch-ua-arch']).toBe('"arm"');
    } finally {
      if (origPlatform) Object.defineProperty(process, 'platform', origPlatform);
      if (origArch) Object.defineProperty(process, 'arch', origArch);
    }
  });

  it('maps a non-arm64 architecture to x86 and falls back to a default Chrome major', async () => {
    await manager.open('s1', 'https://a.test');
    const cb = h.getIdentityCb()!;

    const origArch = Object.getOwnPropertyDescriptor(process, 'arch');
    const origChrome = process.versions.chrome;
    Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
    // Empty chrome version → getChromeFullVersion uses the fallback major.
    Object.defineProperty(process.versions, 'chrome', { value: '', configurable: true });
    try {
      const callback = vi.fn();
      cb({ requestHeaders: { 'sec-ch-ua-arch': '"x"' } }, callback);
      const out = callback.mock.calls[0][0].requestHeaders;
      expect(out['sec-ch-ua-arch']).toBe('"x86"');
      expect(out['sec-ch-ua']).toContain('v="149"'); // FALLBACK_CHROME_MAJOR_VERSION
    } finally {
      if (origArch) Object.defineProperty(process, 'arch', origArch);
      Object.defineProperty(process.versions, 'chrome', {
        value: origChrome,
        configurable: true,
      });
    }
  });
});

// ── internal guard branches reached through the public surface ───────────────────────
describe('EmbeddedBrowserManager — guard branches', () => {
  it('foreground applies remembered bounds reported before the view existed', async () => {
    // setBounds before any view → stored in lastBounds; ensureView seeds
    // sv.lastBounds from it, so foreground applies the rounded bounds.
    manager.setBounds('s1', { x: 11.4, y: 12.6, width: 13.5, height: 14.5 });
    await manager.open('s1', 'https://a.test');
    expect(lastView().setBounds).toHaveBeenCalledWith({ x: 11, y: 13, width: 14, height: 15 });
  });

  it('destroyView detach is a guarded no-op when the window is gone', async () => {
    const noWin = new EmbeddedBrowserManager(() => null);
    await noWin.open('s1', 'https://a.test'); // view created, never foregrounded
    expect(() => noWin.destroyAll()).not.toThrow();
    expect(lastWc().close).toHaveBeenCalled(); // still closed despite no window
  });

  it('ensureViewForAutomation skips the panel-open request when the window is gone', async () => {
    const noWin = new EmbeddedBrowserManager(() => null);
    noWin.setActiveSession('s1');
    panelSpy.mockClear();
    const p = noWin.ensureViewForAutomation('s1', 'https://load.test');
    await waitForAutomationNavigationSetup();
    lastWc().__em.emit('did-finish-load');
    await p;
    expect(panelSpy).not.toHaveBeenCalled(); // requestPanelOpen early-returned
  });

  it('loadAndWait ignores a second finish event (already settled)', async () => {
    const p = manager.ensureViewForAutomation('s1', 'https://load.test');
    const wc = lastWc();
    await waitForAutomationNavigationSetup();
    wc.__em.emit('did-finish-load');
    wc.__em.emit('did-finish-load'); // second emit hits the `settled` guard
    await expect(p).resolves.toBeDefined();
  });

  it('loadAndWait settles when the main frame fails to load', async () => {
    const p = manager.ensureViewForAutomation('s1', 'https://fail.test');
    await waitForAutomationNavigationSetup();
    lastWc().__em.emit('did-fail-load', {}, -100, 'ERR', 'https://fail.test', true);
    await expect(p).resolves.toBeDefined();
  });

  it('loadAndWait settles via the loadURL rejection catch', async () => {
    await manager.open('s1', 'https://a.test');
    const wc = lastWc();
    wc.loadURL.mockReturnValueOnce(Promise.reject(new Error('nav boom')));
    // No finish/fail event emitted; the rejected loadURL must settle the wait.
    await expect(manager.ensureViewForAutomation('s1', 'https://reject.test')).resolves.toBeDefined();
  });
});
