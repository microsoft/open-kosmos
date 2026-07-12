/** @vitest-environment happy-dom */
/**
 * Tests for the renderer-side memex IPC bridge.
 *
 * memex.ts binds the shared type-safe contract to `window.electronAPI.memex`:
 *  - memexApi   = renderToMain.bindRender(electronAPI.memex.invoke)
 *  - memexEvents = a channel-specific cardsChanged subscription bridge
 *
 * The global test setup (tests/setup.ts) installs a window.electronAPI proxy
 * whose `memex` namespace exposes spyable invoke/on/off, so we can assert the
 * bound proxies delegate to them with the prefixed channel names.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memexApi, memexEvents } from '../memex';

describe('renderer ipc/memex bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a read API and an events binder', () => {
    expect(memexApi).toBeTruthy();
    expect(memexEvents).toBeTruthy();
    expect(typeof memexApi.listCards).toBe('function');
    expect(typeof memexApi.listProfileCards).toBe('function');
    expect(typeof memexEvents.cardsChanged).toBe('function');
  });

  it('memexApi.listCards delegates to electronAPI.memex.invoke with the memex: channel', async () => {
    const invoke = (window as any).electronAPI.memex.invoke;
    await memexApi.listCards('chat-1');
    expect(invoke).toHaveBeenCalledWith('memex:listCards', { scope: 'current-agent', chatId: 'chat-1' });
  });

  it('current-agent read helpers delegate with current-agent targets', async () => {
    const invoke = (window as any).electronAPI.memex.invoke;
    await memexApi.readCard('chat-1', 'card-1');
    await memexApi.getGraph('chat-1');
    expect(invoke).toHaveBeenCalledWith('memex:readCard', { scope: 'current-agent', chatId: 'chat-1' }, 'card-1');
    expect(invoke).toHaveBeenCalledWith('memex:getGraph', { scope: 'current-agent', chatId: 'chat-1' });
  });

  it('memexApi.searchCards forwards the query argument', async () => {
    const invoke = (window as any).electronAPI.memex.invoke;
    await memexApi.searchCards('chat-1', 'hello');
    expect(invoke).toHaveBeenCalledWith('memex:searchCards', { scope: 'current-agent', chatId: 'chat-1' }, 'hello');
  });

  it('profile-memory helpers delegate with profile-memory targets', async () => {
    const invoke = (window as any).electronAPI.memex.invoke;
    await memexApi.listProfileCards();
    await memexApi.readProfileCard('card-1');
    await memexApi.getProfileGraph();
    await memexApi.searchProfileCards('hello');
    await memexApi.archiveProfileCard('card-1');
    await memexApi.deleteProfileCard('card-1');
    expect(invoke).toHaveBeenCalledWith('memex:listCards', { scope: 'profile-memory' });
    expect(invoke).toHaveBeenCalledWith('memex:readCard', { scope: 'profile-memory' }, 'card-1');
    expect(invoke).toHaveBeenCalledWith('memex:getGraph', { scope: 'profile-memory' });
    expect(invoke).toHaveBeenCalledWith('memex:searchCards', { scope: 'profile-memory' }, 'hello');
    expect(invoke).toHaveBeenCalledWith('memex:archiveProfileCard', 'card-1');
    expect(invoke).toHaveBeenCalledWith('memex:deleteProfileCard', 'card-1');
  });

  it('memexEvents.cardsChanged subscribes via electronAPI.memex.onCardsChanged and returns an unsubscribe', () => {
    const onCardsChanged = (window as any).electronAPI.memex.onCardsChanged;
    const listener = vi.fn();
    const unsub = memexEvents.cardsChanged(listener);
    expect(onCardsChanged).toHaveBeenCalledWith(listener);
    expect(typeof unsub).toBe('function');
  });

  it('memexEvents.cardsChanged falls back to a no-op unsubscribe when the bridge is missing', async () => {
    vi.resetModules();
    const originalElectronAPI = (window as any).electronAPI;
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      writable: true,
      value: { memex: undefined },
    });

    try {
      const { memexEvents: isolatedEvents } = await import('../memex');
      const listener = vi.fn();
      const unsub = isolatedEvents.cardsChanged(listener);
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        writable: true,
        value: originalElectronAPI,
      });
      vi.resetModules();
    }
  });
});
