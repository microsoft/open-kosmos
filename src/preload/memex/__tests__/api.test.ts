/**
 * Tests for the memex preload API factory.
 *
 * createMemexPreloadApi(ipcRenderer) returns the renderer-facing bridge object:
 * a whitelisted `invoke` (the default export of ./invoke) plus a channel-specific
 * `onCardsChanged` subscription for the typed `memex:cardsChanged` push. We
 * verify the shape, binding, and unsubscribe behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import invokeMemex from '../invoke';
import { createMemexPreloadApi } from '../api';

describe('createMemexPreloadApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the whitelisted invoke plus a cardsChanged subscription', () => {
    const fakeIpc = { on: vi.fn(), off: vi.fn() } as any;
    const api = createMemexPreloadApi(fakeIpc);

    expect(api.invoke).toBe(invokeMemex);
    expect(typeof api.onCardsChanged).toBe('function');
    expect('on' in api).toBe(false);
    expect('off' in api).toBe(false);
  });

  it('binds onCardsChanged() to only the memex:cardsChanged channel', () => {
    const on = vi.fn();
    const fakeIpc = { on, off: vi.fn() } as any;
    const api = createMemexPreloadApi(fakeIpc);

    const listener = vi.fn();
    api.onCardsChanged(listener);

    expect(on).toHaveBeenCalledWith('memex:cardsChanged', expect.any(Function));
  });

  it('wraps cardsChanged so the renderer callback receives only the payload', () => {
    const on = vi.fn();
    const fakeIpc = { on, off: vi.fn() } as any;
    const api = createMemexPreloadApi(fakeIpc);
    const listener = vi.fn();
    const event = { sender: 'raw-ipc-event' };
    const payload = { scope: 'current-agent', chatId: 'chat-1' };

    api.onCardsChanged(listener);
    const wrapped = on.mock.calls[0][1];
    wrapped(event, payload);

    expect(listener).toHaveBeenCalledWith(payload);
    expect(listener).not.toHaveBeenCalledWith(event, payload);
  });

  it('returns an unsubscribe that removes only the memex:cardsChanged listener', () => {
    const off = vi.fn();
    const on = vi.fn();
    const fakeIpc = { on, off } as any;
    const api = createMemexPreloadApi(fakeIpc);

    const listener = vi.fn();
    const unsubscribe = api.onCardsChanged(listener);
    unsubscribe();

    const wrapped = on.mock.calls[0][1];
    expect(on).toHaveBeenCalledWith('memex:cardsChanged', expect.any(Function));
    expect(off).toHaveBeenCalledWith('memex:cardsChanged', wrapped);
  });
});
