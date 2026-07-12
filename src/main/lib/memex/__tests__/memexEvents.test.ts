import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  memexEvents,
  emitCardsChanged,
  MEMEX_CARDS_CHANGED,
  type MemexCardsChangedPayload,
} from '../memexEvents';

afterEach(() => {
  memexEvents.removeAllListeners();
});

describe('memexEvents', () => {
  it('emits cardsChanged with the agent payload', () => {
    const listener = vi.fn();
    memexEvents.on(MEMEX_CARDS_CHANGED, listener);
    emitCardsChanged({ userAlias: 'alice', agentId: 'agent-1', chatId: 'chat-1' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'current-agent', agentId: 'agent-1', chatId: 'chat-1' } satisfies MemexCardsChangedPayload);
  });

  it('emits profile-memory changes without an agentId', () => {
    const listener = vi.fn();
    memexEvents.on(MEMEX_CARDS_CHANGED, listener);
    emitCardsChanged({ userAlias: 'alice', scope: 'profile-memory' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'profile-memory' });
  });

  it('does not emit for an empty alias or missing current-agent agentId', () => {
    const listener = vi.fn();
    memexEvents.on(MEMEX_CARDS_CHANGED, listener);
    emitCardsChanged({ userAlias: '', agentId: 'agent-1', chatId: 'chat-1' });
    emitCardsChanged({ userAlias: 'alice', scope: 'current-agent', chatId: 'chat-1' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    memexEvents.on(MEMEX_CARDS_CHANGED, a);
    memexEvents.on(MEMEX_CARDS_CHANGED, b);
    emitCardsChanged({ userAlias: 'alice', agentId: 'agent-x', chatId: 'chat-x' });
    expect(a).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'current-agent', agentId: 'agent-x', chatId: 'chat-x' });
    expect(b).toHaveBeenCalledWith({ userAlias: 'alice', scope: 'current-agent', agentId: 'agent-x', chatId: 'chat-x' });
  });
});
