/**
 * Tests for embeddedBrowserIPC.ts — the type-safe IPC bridge that wires the
 * `embeddedBrowser:*` renderer→main channels to EmbeddedBrowserManager methods.
 *
 * Strategy: register the bridge against the globally-mocked electron `ipcMain`,
 * capture each `ipcMain.handle(key, fn)` registration, then invoke each captured
 * handler and assert it delegates to the matching manager method with the
 * session-scoped arguments threaded through.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { registerEmbeddedBrowserIPC } from '../embeddedBrowserIPC';
import type { EmbeddedBrowserManager } from '../EmbeddedBrowserManager';

const browserEnabled = vi.hoisted(() => ({ value: true }));
vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getCurrentUserAlias: vi.fn(() => 'alice'),
    getBrowserSettings: vi.fn(() => ({ enabled: browserEnabled.value })),
  },
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

/** Build a manager test double exposing every method the bridge delegates to. */
function buildManagerMock() {
  return {
    open: vi.fn(),
    navigate: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    setBounds: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    setActiveSession: vi.fn(),
    destroyAll: vi.fn(),
  } as unknown as EmbeddedBrowserManager & Record<string, ReturnType<typeof vi.fn>>;
}

/** Collect the registered handlers keyed by their full `embeddedBrowser:*` channel. */
function collectHandlers(): Record<string, Handler> {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
  const map: Record<string, Handler> = {};
  for (const [key, fn] of calls) map[key] = fn;
  return map;
}

const FAKE_EVENT = { sender: {} };

describe('registerEmbeddedBrowserIPC', () => {
  let manager: ReturnType<typeof buildManagerMock>;
  let handlers: Record<string, Handler>;

  beforeEach(() => {
    vi.clearAllMocks();
    browserEnabled.value = true;
    manager = buildManagerMock();
    registerEmbeddedBrowserIPC(manager);
    handlers = collectHandlers();
  });

  it('registers a handler for every renderer→main channel', () => {
    const expected = [
      'embeddedBrowser:open',
      'embeddedBrowser:navigate',
      'embeddedBrowser:show',
      'embeddedBrowser:hide',
      'embeddedBrowser:setBounds',
      'embeddedBrowser:goBack',
      'embeddedBrowser:goForward',
      'embeddedBrowser:reload',
      'embeddedBrowser:stop',
      'embeddedBrowser:setActiveSession',
      'embeddedBrowser:destroyAll',
    ];
    for (const key of expected) {
      expect(handlers[key], `missing handler for ${key}`).toBeTypeOf('function');
    }
    // Every registration first removes any stale handler to avoid duplicates.
    expect(ipcMain.removeHandler).toHaveBeenCalled();
  });

  it('open delegates to manager.open(sessionId, url)', async () => {
    await handlers['embeddedBrowser:open'](FAKE_EVENT, 's1', 'https://example.com');
    expect(manager.open).toHaveBeenCalledWith('s1', 'https://example.com');
  });

  it('navigate delegates to manager.navigate(sessionId, url)', async () => {
    await handlers['embeddedBrowser:navigate'](FAKE_EVENT, 's2', 'https://nav.test');
    expect(manager.navigate).toHaveBeenCalledWith('s2', 'https://nav.test');
  });

  it('show delegates to manager.show(sessionId)', async () => {
    await handlers['embeddedBrowser:show'](FAKE_EVENT, 's3');
    expect(manager.show).toHaveBeenCalledWith('s3');
  });

  it('hide delegates to manager.hide(sessionId)', async () => {
    await handlers['embeddedBrowser:hide'](FAKE_EVENT, 's4');
    expect(manager.hide).toHaveBeenCalledWith('s4');
  });

  it('setBounds delegates to manager.setBounds(sessionId, bounds)', async () => {
    const bounds = { x: 1, y: 2, width: 3, height: 4 };
    await handlers['embeddedBrowser:setBounds'](FAKE_EVENT, 's5', bounds);
    expect(manager.setBounds).toHaveBeenCalledWith('s5', bounds);
  });

  it('goBack delegates to manager.goBack(sessionId)', async () => {
    await handlers['embeddedBrowser:goBack'](FAKE_EVENT, 's6');
    expect(manager.goBack).toHaveBeenCalledWith('s6');
  });

  it('goForward delegates to manager.goForward(sessionId)', async () => {
    await handlers['embeddedBrowser:goForward'](FAKE_EVENT, 's7');
    expect(manager.goForward).toHaveBeenCalledWith('s7');
  });

  it('reload delegates to manager.reload(sessionId)', async () => {
    await handlers['embeddedBrowser:reload'](FAKE_EVENT, 's8');
    expect(manager.reload).toHaveBeenCalledWith('s8');
  });

  it('stop delegates to manager.stop(sessionId)', async () => {
    await handlers['embeddedBrowser:stop'](FAKE_EVENT, 's9');
    expect(manager.stop).toHaveBeenCalledWith('s9');
  });

  it('destroyAll delegates to manager.destroyAll()', async () => {
    await handlers['embeddedBrowser:destroyAll'](FAKE_EVENT);
    expect(manager.destroyAll).toHaveBeenCalledWith();
  });

  it('setActiveSession remains available when the browser is disabled', async () => {
    browserEnabled.value = false;
    await handlers['embeddedBrowser:setActiveSession'](FAKE_EVENT, null);
    expect(manager.setActiveSession).toHaveBeenCalledWith(null);
  });

  it('validates renderer-provided session IDs before delegating', async () => {
    await expect(handlers['embeddedBrowser:show'](FAKE_EVENT, '')).rejects.toThrow('non-empty sessionId');
    await expect(handlers['embeddedBrowser:hide'](FAKE_EVENT, 123)).rejects.toThrow('non-empty sessionId');
    await expect(handlers['embeddedBrowser:setActiveSession'](FAKE_EVENT, '   ')).rejects.toThrow('non-empty sessionId');
    expect(manager.show).not.toHaveBeenCalled();
    expect(manager.hide).not.toHaveBeenCalled();
    expect(manager.setActiveSession).not.toHaveBeenCalled();
  });

  it('validates renderer-provided URLs before delegating', async () => {
    await expect(handlers['embeddedBrowser:open'](FAKE_EVENT, 's1', 'not a url')).rejects.toThrow('valid URL');
    await expect(handlers['embeddedBrowser:navigate'](FAKE_EVENT, 's1', 'file:///tmp/report.html')).rejects.toThrow('http and https');
    expect(manager.open).not.toHaveBeenCalled();
    expect(manager.navigate).not.toHaveBeenCalled();
  });

  it('validates renderer-provided bounds before delegating', async () => {
    await expect(handlers['embeddedBrowser:setBounds'](FAKE_EVENT, 's1', { x: 0, y: 0, width: NaN, height: 100 })).rejects.toThrow('finite non-negative bounds');
    await expect(handlers['embeddedBrowser:setBounds'](FAKE_EVENT, 's1', { x: -1, y: 0, width: 100, height: 100 })).rejects.toThrow('finite non-negative bounds');
    await expect(handlers['embeddedBrowser:setBounds'](FAKE_EVENT, 's1', { x: 0, y: 0, width: 100 })).rejects.toThrow('finite non-negative bounds');
    expect(manager.setBounds).not.toHaveBeenCalled();
  });

  it('destroyAll remains available when the browser is disabled', async () => {
    browserEnabled.value = false;
    await handlers['embeddedBrowser:destroyAll'](FAKE_EVENT);
    expect(manager.destroyAll).toHaveBeenCalledWith();
  });

  it.each([
    ['embeddedBrowser:open', ['s1', 'https://example.com'], 'open'],
    ['embeddedBrowser:navigate', ['s1', 'https://example.com'], 'navigate'],
    ['embeddedBrowser:show', ['s1'], 'show'],
    ['embeddedBrowser:hide', ['s1'], 'hide'],
    ['embeddedBrowser:setBounds', ['s1', { x: 1, y: 2, width: 3, height: 4 }], 'setBounds'],
    ['embeddedBrowser:goBack', ['s1'], 'goBack'],
    ['embeddedBrowser:goForward', ['s1'], 'goForward'],
    ['embeddedBrowser:reload', ['s1'], 'reload'],
    ['embeddedBrowser:stop', ['s1'], 'stop'],
  ] as const)('rejects %s when the browser is disabled', async (channel, args, method) => {
    browserEnabled.value = false;
    await expect(handlers[channel](FAKE_EVENT, ...args)).rejects.toThrow('Embedded browser is disabled');
    expect(manager[method]).not.toHaveBeenCalled();
  });

  it('rejects browser actions when persisted enabled is a non-boolean truthy value', async () => {
    browserEnabled.value = 'false' as unknown as boolean;
    await expect(handlers['embeddedBrowser:open'](FAKE_EVENT, 's1', 'https://example.com')).rejects.toThrow('Embedded browser is disabled');
    expect(manager.open).not.toHaveBeenCalled();
  });
});
