import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { BrowserWindowMock, appMock } = vi.hoisted(() => {
  const bw = Object.assign(vi.fn(), { getAllWindows: vi.fn(() => [] as unknown[]) });
  return { BrowserWindowMock: bw, appMock: { on: vi.fn(), dock: { show: vi.fn() } as { show: unknown } } };
});

vi.mock('electron', () => ({ BrowserWindow: BrowserWindowMock, app: appMock }));
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  BOOTSTRAP_SCRIPT,
  CursorOverlay,
  IDLE_HIDE_MS,
  NoopCursorIndicator,
  buildPayload,
  createOverlayWindow,
  cursorInvocation,
  getCursorIndicator,
  setCursorIndicatorForTesting,
  toLocalCss,
  watchHostWindowsForShutdown,
  type CursorSignal,
  type OverlayWindow,
} from '../cursorOverlay';

const DISPLAY = { id: 1, bounds: { x: 100, y: 50, width: 1440, height: 900 } };

function moveSignal(x = 720, y = 450): CursorSignal {
  return { kind: 'move', point: { x, y }, display: DISPLAY };
}

/** Flush pending microtasks (promise chains) without advancing fake timers. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface FakeOpts {
  loadReject?: boolean;
  execImpl?: (code: string) => Promise<unknown>;
}

function makeFakeWindow(opts: FakeOpts = {}) {
  let destroyed = false;
  let visible = false;
  let finishCb: (() => void) | null = null;
  const exec = vi.fn((code: string) =>
    opts.execImpl ? opts.execImpl(code) : Promise.resolve(undefined),
  );
  const win = {
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => visible),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 })),
    setBounds: vi.fn(),
    showInactive: vi.fn(() => {
      visible = true;
    }),
    moveTop: vi.fn(),
    hide: vi.fn(() => {
      visible = false;
    }),
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    loadURL: vi.fn(() =>
      opts.loadReject ? Promise.reject(new Error('load fail')) : Promise.resolve(),
    ),
    setIgnoreMouseEvents: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    webContents: {
      executeJavaScript: exec,
      once: vi.fn((_event: 'did-finish-load', cb: () => void) => {
        finishCb = cb;
      }),
    },
    fireFinish: () => finishCb?.(),
    kill: () => {
      destroyed = true;
    },
  };
  return win;
}

type FakeWindow = ReturnType<typeof makeFakeWindow>;

/** Factory that hands out a queue of fake windows (for recreate scenarios). */
function factoryOf(...wins: FakeWindow[]): { factory: () => OverlayWindow; created: FakeWindow[] } {
  const created: FakeWindow[] = [];
  let i = 0;
  const factory = (): OverlayWindow => {
    const w = wins[Math.min(i, wins.length - 1)];
    i += 1;
    created.push(w);
    return w as unknown as OverlayWindow;
  };
  return { factory, created };
}

beforeEach(() => {
  BrowserWindowMock.mockReset();
  BrowserWindowMock.getAllWindows.mockReset();
  BrowserWindowMock.getAllWindows.mockReturnValue([]);
  appMock.on.mockReset();
  appMock.dock = { show: vi.fn() };
  setCursorIndicatorForTesting(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pure helpers', () => {
  it('toLocalCss subtracts the display origin', () => {
    expect(toLocalCss({ x: 130, y: 80 }, { x: 100, y: 50, width: 10, height: 10 })).toEqual({
      x: 30,
      y: 30,
    });
  });

  it('buildPayload projects move with neither button nor drag end', () => {
    expect(buildPayload(moveSignal(720, 450))).toEqual({ kind: 'move', x: 620, y: 400 });
  });

  it('buildPayload includes the button for clicks', () => {
    const sig: CursorSignal = {
      kind: 'click',
      point: { x: 720, y: 450 },
      button: 'right',
      display: DISPLAY,
    };
    expect(buildPayload(sig)).toEqual({ kind: 'click', x: 620, y: 400, button: 'right' });
  });

  it('buildPayload includes the drag end point', () => {
    const sig: CursorSignal = {
      kind: 'drag',
      point: { x: 100, y: 50 },
      to: { x: 1540, y: 950 },
      display: DISPLAY,
    };
    expect(buildPayload(sig)).toEqual({ kind: 'drag', x: 0, y: 0, x2: 1440, y2: 900 });
  });

  it('cursorInvocation guards the global and serializes the payload', () => {
    expect(cursorInvocation({ kind: 'move', x: 1, y: 2 })).toBe(
      'window.__cu && window.__cu({"kind":"move","x":1,"y":2});',
    );
  });
});

describe('NoopCursorIndicator', () => {
  it('does nothing and never throws', async () => {
    const noop = new NoopCursorIndicator();
    expect(() => {
      noop.signal();
      noop.ping();
      noop.hide();
      noop.dispose();
    }).not.toThrow();
    await expect(noop.settle()).resolves.toBeUndefined();
  });
});

describe('createOverlayWindow', () => {
  it('constructs a transparent, click-through, non-focusable window', () => {
    const fakeWin = { tag: 'real' };
    BrowserWindowMock.mockImplementation(function () {
      return fakeWin;
    } as unknown as () => unknown);
    const win = createOverlayWindow();
    expect(win).toBe(fakeWin);
    const opts = BrowserWindowMock.mock.calls[0][0] as Record<string, unknown> & {
      webPreferences: Record<string, unknown>;
    };
    expect(opts).toMatchObject({
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
    });
    expect(opts.webPreferences.backgroundThrottling).toBe(false);
    expect(opts.webPreferences.sandbox).toBe(true);
    expect((fakeWin as Record<string, unknown>).__cuCursorOverlay).toBe(true);
  });
});

describe('watchHostWindowsForShutdown', () => {
  function hostLikeWindow(opts: { tagged?: boolean; destroyed?: boolean } = {}) {
    const win: {
      isDestroyed: ReturnType<typeof vi.fn>;
      once: ReturnType<typeof vi.fn>;
      __cuCursorOverlay?: boolean;
    } = {
      isDestroyed: vi.fn(() => !!opts.destroyed),
      once: vi.fn(),
    };
    if (opts.tagged) {
      win.__cuCursorOverlay = true;
    }
    return win;
  }

  it('attaches a close listener to each real window, skipping the overlay and destroyed ones', () => {
    const host = hostLikeWindow();
    const overlay = hostLikeWindow({ tagged: true });
    const dead = hostLikeWindow({ destroyed: true });
    BrowserWindowMock.getAllWindows.mockReturnValue([host, overlay, dead]);
    const onAll = vi.fn();

    watchHostWindowsForShutdown(onAll);

    expect(host.once).toHaveBeenCalledWith('closed', expect.any(Function));
    expect(overlay.once).not.toHaveBeenCalled();
    expect(dead.once).not.toHaveBeenCalled();
    expect(onAll).not.toHaveBeenCalled();
  });

  it('fires the teardown only once the last real window has closed', () => {
    const host = hostLikeWindow();
    BrowserWindowMock.getAllWindows.mockReturnValue([host]);
    const onAll = vi.fn();

    watchHostWindowsForShutdown(onAll);
    const check = host.once.mock.calls[0][1] as () => void;

    // A real window is still open → no teardown.
    BrowserWindowMock.getAllWindows.mockReturnValue([host]);
    check();
    expect(onAll).not.toHaveBeenCalled();

    // Only the overlay window remains → tear down so the app can quit.
    BrowserWindowMock.getAllWindows.mockReturnValue([hostLikeWindow({ tagged: true })]);
    check();
    expect(onAll).toHaveBeenCalledTimes(1);
  });

  it('watches windows opened after arming via browser-window-created', () => {
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    const onAll = vi.fn();

    watchHostWindowsForShutdown(onAll);

    expect(appMock.on).toHaveBeenCalledWith('browser-window-created', expect.any(Function));
    const onCreated = appMock.on.mock.calls[0][1] as (event: unknown, win: unknown) => void;

    const late = hostLikeWindow();
    onCreated({}, late);
    expect(late.once).toHaveBeenCalledWith('closed', expect.any(Function));

    // A late overlay window is ignored.
    const lateOverlay = hostLikeWindow({ tagged: true });
    onCreated({}, lateOverlay);
    expect(lateOverlay.once).not.toHaveBeenCalled();
  });
});

describe('CursorOverlay shutdown teardown', () => {
  it('arms the shutdown watch once when the window is first created', () => {
    const watch = vi.fn();
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory, watch);

    overlay.signal(moveSignal());
    overlay.signal(moveSignal());

    expect(watch).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it('does not re-arm after the window is recreated', () => {
    const watch = vi.fn();
    const first = makeFakeWindow();
    const second = makeFakeWindow();
    const { factory } = factoryOf(first, second);
    const overlay = new CursorOverlay(factory, watch);

    overlay.signal(moveSignal());
    first.kill();
    overlay.signal(moveSignal());

    expect(watch).toHaveBeenCalledTimes(1);
    overlay.dispose();
  });

  it('disposes the overlay when all host windows have closed', () => {
    let onAll: () => void = () => undefined;
    const watch = vi.fn((cb: () => void) => {
      onAll = cb;
    });
    const { factory, created } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory, watch);

    overlay.signal(moveSignal());
    expect(created[0].destroy).not.toHaveBeenCalled();

    onAll();
    expect(created[0].destroy).toHaveBeenCalledTimes(1);

    // Inert after teardown: a late signal never spawns a fresh window.
    overlay.signal(moveSignal());
    expect(created).toHaveLength(1);
  });

  it('survives a watcher that throws while arming', () => {
    const watch = vi.fn(() => {
      throw new Error('boom');
    });
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory, watch);

    expect(() => overlay.signal(moveSignal())).not.toThrow();
    overlay.dispose();
  });
});

describe('CursorOverlay lifecycle', () => {
  it('lazily creates the window, wires it click-through/non-focusable, and queues the first signal until ready', async () => {
    const win = makeFakeWindow();
    const { factory, created } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    expect(created).toHaveLength(1);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: false });
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
    // Must NOT set content protection: on Windows it makes the transparent
    // overlay invisible, hiding the AI cursor from the user.
    expect(
      (win as unknown as { setContentProtection?: unknown }).setContentProtection,
    ).toBeUndefined();
    expect(win.loadURL).toHaveBeenCalledWith('about:blank');
    expect(win.setBounds).toHaveBeenCalledWith(DISPLAY.bounds);
    expect(win.showInactive).toHaveBeenCalled();
    // Not ready yet: nothing injected.
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();

    win.fireFinish();
    await flush();
    // Bootstrap first, then the queued invocation.
    const calls = win.webContents.executeJavaScript.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe(BOOTSTRAP_SCRIPT);
    expect(calls[1]).toBe(cursorInvocation({ kind: 'move', x: 620, y: 400 }));
  });

  it('reuses the window and injects immediately once ready', async () => {
    const win = makeFakeWindow();
    const { factory, created } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    win.webContents.executeJavaScript.mockClear();

    overlay.signal({ kind: 'click', point: { x: 200, y: 100 }, button: 'left', display: DISPLAY });
    expect(created).toHaveLength(1); // reused
    await flush();
    expect(win.webContents.executeJavaScript).toHaveBeenCalledWith(
      cursorInvocation({ kind: 'click', x: 100, y: 50, button: 'left' }),
    );
  });

  it('recreates the window when the previous one was destroyed', () => {
    const first = makeFakeWindow();
    const second = makeFakeWindow();
    const { factory, created } = factoryOf(first, second);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    expect(created).toHaveLength(1);
    first.kill();
    overlay.signal(moveSignal());
    expect(created).toHaveLength(2);
    expect(created[1]).toBe(second);
  });

  it('re-raises the overlay to the top on every show so a foreground app cannot occlude it', () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    // First show: hidden -> visible (exercises the diagnostic-log branch).
    overlay.signal(moveSignal());
    expect(win.showInactive).toHaveBeenCalledTimes(1);
    expect(win.moveTop).toHaveBeenCalledTimes(1);
    // setAlwaysOnTop is asserted once at creation AND re-asserted on the show.
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(win.setAlwaysOnTop.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(win.isVisible()).toBe(true);
    expect(win.getBounds).toHaveBeenCalled();

    // Second show while still visible re-raises again (exercises the
    // already-visible branch that skips the diagnostic log).
    overlay.signal(moveSignal());
    expect(win.moveTop).toHaveBeenCalledTimes(2);
  });

  it('hides the window after the idle timeout', () => {
    vi.useFakeTimers();
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    expect(win.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it('ping re-shows the window and refreshes the idle-hide timer (stays alive across think-time)', () => {
    vi.useFakeTimers();
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal()); // shows + arms idle-hide
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    win.showInactive.mockClear();
    overlay.ping(); // re-show + re-arm just before the original would fire
    expect(win.showInactive).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    expect(win.hide).not.toHaveBeenCalled(); // timer was refreshed by ping
    vi.advanceTimersByTime(1);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it('ping is a no-op before any window exists', () => {
    const { factory, created } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);
    expect(() => overlay.ping()).not.toThrow();
    expect(created).toHaveLength(0);
  });

  it('ping is a no-op after dispose', () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    overlay.dispose();
    win.showInactive.mockClear();
    overlay.ping();
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it('ping skips a destroyed window', () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    win.showInactive.mockClear();
    win.kill();
    overlay.ping();
    expect(win.showInactive).not.toHaveBeenCalled();
  });

  it('ping swallows a failing showInactive', () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    win.showInactive.mockImplementation(() => {
      throw new Error('show boom');
    });
    expect(() => overlay.ping()).not.toThrow();
  });

  it('settle resolves immediately when no window exists yet', async () => {
    const { factory, created } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);
    await expect(overlay.settle()).resolves.toBeUndefined();
    expect(created).toHaveLength(0);
  });

  it('settle is a no-op after dispose', async () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    win.webContents.executeJavaScript.mockClear();
    overlay.dispose();
    await overlay.settle();
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('settle skips a destroyed window', async () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    win.webContents.executeJavaScript.mockClear();
    win.kill();
    await overlay.settle();
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('settle waits for the first overlay window to become ready before resolving', async () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal()); // window created but did-finish-load not fired → not ready
    const settlePromise = overlay.settle();
    await flush();
    expect(win.webContents.executeJavaScript.mock.calls.map((c) => c[0])).not.toContain(
      'window.__cuSettle ? window.__cuSettle() : 0;',
    );

    win.fireFinish();
    await flush();
    await settlePromise;

    const calls = win.webContents.executeJavaScript.mock.calls.map((c) => c[0]);
    expect(calls).toContain('window.__cuSettle ? window.__cuSettle() : 0;');
  });

  it('settle gives up after a bounded wait if the first overlay never becomes ready', async () => {
    vi.useFakeTimers();
    try {
      const win = makeFakeWindow();
      const { factory } = factoryOf(win);
      const overlay = new CursorOverlay(factory);
      overlay.signal(moveSignal());

      const settlePromise = overlay.settle();
      await vi.advanceTimersByTimeAsync(1000);
      await settlePromise;

      const calls = win.webContents.executeJavaScript.mock.calls.map((c) => c[0]);
      expect(calls).not.toContain('window.__cuSettle ? window.__cuSettle() : 0;');
    } finally {
      vi.useRealTimers();
    }
  });

  it('settle awaits the in-page glide once ready', async () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    win.webContents.executeJavaScript.mockClear();
    await overlay.settle();
    expect(win.webContents.executeJavaScript).toHaveBeenCalledWith(
      'window.__cuSettle ? window.__cuSettle() : 0;',
    );
  });

  it('settle swallows a failing executeJavaScript', async () => {
    const win = makeFakeWindow({
      execImpl: (code: string) =>
        code === 'window.__cuSettle ? window.__cuSettle() : 0;'
          ? Promise.reject(new Error('settle boom'))
          : Promise.resolve(undefined),
    });
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    await expect(overlay.settle()).resolves.toBeUndefined();
  });

  it('ignores a ready callback for a stale (replaced) window and one for a destroyed window', async () => {
    const first = makeFakeWindow();
    const second = makeFakeWindow();
    const { factory } = factoryOf(first, second);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    first.kill();
    overlay.signal(moveSignal()); // swaps to `second`
    // Late did-finish-load from the replaced first window must be ignored.
    first.fireFinish();
    await flush();
    expect(first.webContents.executeJavaScript).not.toHaveBeenCalled();

    // Destroy the live window, then fire its ready callback: also ignored.
    second.kill();
    second.fireFinish();
    await flush();
    expect(second.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('skips re-flushing on a second did-finish-load (defensive double load)', async () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    const afterFirst = win.webContents.executeJavaScript.mock.calls.length;

    win.fireFinish(); // bootstrap again, but no pending payload to flush
    await flush();
    const calls = win.webContents.executeJavaScript.mock.calls.map((c) => c[0]);
    // One more bootstrap, but NOT another invocation.
    expect(win.webContents.executeJavaScript.mock.calls.length).toBe(afterFirst + 1);
    expect(calls[calls.length - 1]).toBe(BOOTSTRAP_SCRIPT);
  });

  it('does not inject into a destroyed window when already ready', async () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    win.webContents.executeJavaScript.mockClear();

    win.kill();
    overlay.signal(moveSignal());
    await flush();
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('hide() is a no-op before any window exists and skips a destroyed window', () => {
    const win = makeFakeWindow();
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    expect(() => overlay.hide()).not.toThrow(); // no window yet

    overlay.signal(moveSignal());
    overlay.hide();
    expect(win.hide).toHaveBeenCalledTimes(1);

    win.hide.mockClear();
    win.kill();
    overlay.hide(); // destroyed -> skipped
    expect(win.hide).not.toHaveBeenCalled();
  });

  it('dispose() destroys the window and makes further signals no-ops', () => {
    const win = makeFakeWindow();
    const { factory, created } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    overlay.dispose();
    expect(win.destroy).toHaveBeenCalledTimes(1);

    overlay.signal(moveSignal()); // disposed -> ignored
    expect(created).toHaveLength(1);
  });

  it('dispose() before any window exists is a no-op', () => {
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);
    expect(() => overlay.dispose()).not.toThrow();
  });

  it('swallows a synchronous failure while signaling', () => {
    const win = makeFakeWindow();
    win.setBounds.mockImplementation(() => {
      throw new Error('setBounds boom');
    });
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    expect(() => overlay.signal(moveSignal())).not.toThrow();
  });

  it('swallows a failing hide() and a failing destroy()', () => {
    const win = makeFakeWindow();
    win.hide.mockImplementation(() => {
      throw new Error('hide boom');
    });
    win.destroy.mockImplementation(() => {
      throw new Error('destroy boom');
    });
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);
    overlay.signal(moveSignal());
    expect(() => overlay.hide()).not.toThrow();
    expect(() => overlay.dispose()).not.toThrow();
  });

  it('swallows a rejected loadURL, a rejected bootstrap, and a rejected invocation', async () => {
    const win = makeFakeWindow({
      loadReject: true,
      execImpl: () => Promise.reject(new Error('exec boom')),
    });
    const { factory } = factoryOf(win);
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    win.fireFinish();
    await flush();
    // ready never flips (bootstrap rejected); a later signal stays queued, no throw.
    expect(() => overlay.signal(moveSignal())).not.toThrow();
    await flush();
  });
});

describe('getCursorIndicator', () => {
  it('returns a lazily-created singleton', () => {
    const a = getCursorIndicator();
    const b = getCursorIndicator();
    expect(a).toBeInstanceOf(CursorOverlay);
    expect(b).toBe(a);
  });

  it('honors the test override', () => {
    const fake = new NoopCursorIndicator();
    setCursorIndicatorForTesting(fake);
    expect(getCursorIndicator()).toBe(fake);
  });
});

describe('CursorOverlay restores the macOS Dock icon on show', () => {
  const origPlatform = process.platform;
  const setPlatform = (value: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  };
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
  });

  it('re-asserts app.dock.show on every overlay show on darwin', () => {
    setPlatform('darwin');
    const dockShow = vi.fn();
    appMock.dock = { show: dockShow };
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    expect(dockShow).toHaveBeenCalledTimes(1);
    // ping() routes through raise() too, so the Dock icon is re-asserted between actions.
    overlay.ping();
    expect(dockShow).toHaveBeenCalledTimes(2);
  });

  it('never touches the Dock off macOS', () => {
    setPlatform('win32');
    const dockShow = vi.fn();
    appMock.dock = { show: dockShow };
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);

    overlay.signal(moveSignal());
    expect(dockShow).not.toHaveBeenCalled();
  });

  it('tolerates a platform with no app.dock (optional chain)', () => {
    setPlatform('darwin');
    (appMock as { dock?: unknown }).dock = undefined;
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);

    expect(() => overlay.signal(moveSignal())).not.toThrow();
  });

  it('swallows a throwing dock.show so a Dock hiccup never breaks the cursor', () => {
    setPlatform('darwin');
    const dockShow = vi.fn(() => {
      throw new Error('dock boom');
    });
    appMock.dock = { show: dockShow };
    const { factory } = factoryOf(makeFakeWindow());
    const overlay = new CursorOverlay(factory);

    expect(() => overlay.signal(moveSignal())).not.toThrow();
    expect(dockShow).toHaveBeenCalled();
  });
});
