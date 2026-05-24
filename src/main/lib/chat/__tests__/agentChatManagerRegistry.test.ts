vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../cancellation', async () => ({
  CancellationTokenSource: vi.fn().mockImplementation(function(this: any) {
    this.token = { isCancellationRequested: false };
    this.dispose = vi.fn();
  }),
}));

import { AgentChatManagerRegistry } from '../agentChatManagerRegistry';

describe('AgentChatManagerRegistry', () => {
  it('stores and removes instances with runtime mode', () => {
    const registry = new AgentChatManagerRegistry();
    const instance = { getChatId: vi.fn(() => 'chat_1') } as any;

    registry.setInstance('session_1', instance, 'interactive');

    expect(registry.getInstance('session_1')).toBe(instance);
    expect(registry.getRuntimeMode('session_1')).toBe('interactive');

    expect(registry.removeInstance('session_1')).toBe(instance);
    expect(registry.getInstance('session_1')).toBeNull();
    expect(registry.getRuntimeMode('session_1')).toBeNull();
  });

  it('reuses active cancellation sources and replaces cancelled ones', () => {
    const registry = new AgentChatManagerRegistry();

    const first = registry.getOrCreateCancellationSource('session_1');
    const second = registry.getOrCreateCancellationSource('session_1');
    expect(second).toBe(first);

    (first.token as any).isCancellationRequested = true;
    const third = registry.getOrCreateCancellationSource('session_1');
    expect(third).not.toBe(first);
  });

  it('clears remaining registry state with clearAll', () => {
    const registry = new AgentChatManagerRegistry();
    registry.setInstance('session_1', { getChatId: vi.fn(() => 'chat_1') } as any, 'interactive');
    registry.getOrCreateCancellationSource('session_1');

    registry.clearAll();

    expect(registry.getInstance('session_1')).toBeNull();
    expect(registry.getRuntimeMode('session_1')).toBeNull();
    expect(registry.getCancellationSource('session_1')).toBeNull();
  });

  it('hasInstance returns correct boolean', () => {
    const registry = new AgentChatManagerRegistry();
    expect(registry.hasInstance('session_1')).toBe(false);
    registry.setInstance('session_1', { getChatId: vi.fn(() => 'chat_1') } as any, 'interactive');
    expect(registry.hasInstance('session_1')).toBe(true);
  });

  it('setRuntimeMode only updates mode when instance exists', () => {
    const registry = new AgentChatManagerRegistry();

    // Setting mode for non-existent session should be a no-op
    registry.setRuntimeMode('no-session', 'scheduled-silent');
    expect(registry.getRuntimeMode('no-session')).toBeNull();

    registry.setInstance('session_1', { getChatId: vi.fn(() => 'chat_1') } as any, 'interactive');
    registry.setRuntimeMode('session_1', 'scheduled-silent');
    expect(registry.getRuntimeMode('session_1')).toBe('scheduled-silent');
  });

  it('listCachedSessionIds and getInstanceCount reflect current state', () => {
    const registry = new AgentChatManagerRegistry();
    expect(registry.listCachedSessionIds()).toEqual([]);
    expect(registry.getInstanceCount()).toBe(0);

    registry.setInstance('s1', { getChatId: vi.fn(() => 'c1') } as any, 'interactive');
    registry.setInstance('s2', { getChatId: vi.fn(() => 'c2') } as any, 'interactive');

    expect(registry.getInstanceCount()).toBe(2);
    expect(registry.listCachedSessionIds()).toEqual(expect.arrayContaining(['s1', 's2']));
  });

  it('forEachInstance iterates all stored instances', () => {
    const registry = new AgentChatManagerRegistry();
    const inst1 = { getChatId: vi.fn(() => 'c1') } as any;
    const inst2 = { getChatId: vi.fn(() => 'c2') } as any;
    registry.setInstance('s1', inst1, 'interactive');
    registry.setInstance('s2', inst2, 'interactive');

    const collected: string[] = [];
    registry.forEachInstance((_, sessionId) => collected.push(sessionId));
    expect(collected).toEqual(expect.arrayContaining(['s1', 's2']));
  });

  it('disposeAllCancellationSources disposes and clears all sources', () => {
    const registry = new AgentChatManagerRegistry();
    const src1 = registry.getOrCreateCancellationSource('s1');
    const src2 = registry.getOrCreateCancellationSource('s2');

    registry.disposeAllCancellationSources();

    expect(registry.getCancellationSource('s1')).toBeNull();
    expect(registry.getCancellationSource('s2')).toBeNull();
    expect(src1.dispose).toHaveBeenCalled();
    expect(src2.dispose).toHaveBeenCalled();
  });

  it('disposeAllCancellationSources handles dispose errors without throwing', () => {
    const registry = new AgentChatManagerRegistry();
    const src = registry.getOrCreateCancellationSource('s1');
    (src.dispose as any).mockImplementation(() => { throw new Error('oops'); });

    expect(() => registry.disposeAllCancellationSources()).not.toThrow();
    expect(registry.getCancellationSource('s1')).toBeNull();
  });
});