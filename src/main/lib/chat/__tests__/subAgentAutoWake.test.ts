// @ts-nocheck
/**
 * Tests for SubAgentAutoWakeController
 * Achieves 100% coverage of src/main/lib/chat/subAgentAutoWake.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock SubAgentManager — the source does import('../subAgent/subAgentManager')
const mockOn = vi.fn();
vi.mock('../../subAgent/subAgentManager', () => ({
  SubAgentManager: { getInstance: () => ({ on: mockOn }) },
}));

// Mock the delivery ledger — recoverPendingForSession statically imports
// peekPendingDeliveries, so the factory is evaluated eagerly and the mock fn
// must be hoisted to be available when it runs.
const mockPeekPendingDeliveries = vi.hoisted(() => vi.fn(() => []));
vi.mock('../../subAgent/subAgentDeliveryLedger', () => ({
  peekPendingDeliveries: mockPeekPendingDeliveries,
}));

// Mock @shared/types/chatTypes
vi.mock('@shared/types/chatTypes', () => ({
  MessageHelper: {
    createTextMessage: vi.fn((text, role) => ({ id: 'msg-1', content: text, role })),
  },
}));

import { SubAgentAutoWakeController } from '../subAgentAutoWake';

function makeHost(overrides = {}) {
  return {
    getSessionInstance: vi.fn(),
    reattachEventSender: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

function makeInstance(status = 'idle') {
  return {
    getChatStatus: vi.fn(() => status),
    streamMessage: vi.fn(() => Promise.resolve()),
  };
}

async function setupAndGetListener(host) {
  const ctrl = new SubAgentAutoWakeController(host);
  ctrl.setup();
  // Wait for dynamic import to resolve
  await new Promise(r => setImmediate(r));
  const listener = mockOn.mock.calls[0]?.[1];
  return { ctrl, listener };
}

describe('SubAgentAutoWakeController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOn.mockReset();
    mockPeekPendingDeliveries.mockReset();
    mockPeekPendingDeliveries.mockReturnValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setup() registers subAgentResultReady listener', async () => {
    vi.useRealTimers();
    const host = makeHost();
    const ctrl = new SubAgentAutoWakeController(host);
    ctrl.setup();
    await new Promise(r => setImmediate(r));
    expect(mockOn).toHaveBeenCalledWith('subAgentResultReady', expect.any(Function));
    expect(host.log).toHaveBeenCalledWith('[SubAgentAutoWake] Listener registered');
  });

  it('setup() called twice only registers once', async () => {
    vi.useRealTimers();
    const host = makeHost();
    const ctrl = new SubAgentAutoWakeController(host);
    ctrl.setup();
    ctrl.setup();
    await new Promise(r => setImmediate(r));
    expect(mockOn).toHaveBeenCalledTimes(1);
  });

  it('setup() swallows errors when import fails', async () => {
    vi.useRealTimers();
    // Make .on throw so the .then callback throws, triggering the .catch
    mockOn.mockImplementationOnce(() => { throw new Error('boom'); });
    const host = makeHost();
    const ctrl = new SubAgentAutoWakeController(host);
    expect(() => ctrl.setup()).not.toThrow();
    await new Promise(r => setImmediate(r));
    // No error propagated — .catch swallowed it
  });

  it('debounces multiple calls within 500ms', async () => {
    vi.useRealTimers();
    const instance = makeInstance('idle');
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(200);
    listener({ parentSessionId: 's1' }); // resets timer
    vi.advanceTimersByTime(200);
    expect(instance.streamMessage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300); // 500ms from second call
    expect(instance.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('skips when session is already pending', async () => {
    vi.useRealTimers();
    const instance = makeInstance('idle');
    instance.streamMessage = vi.fn(() => new Promise(() => {})); // never resolves
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(instance.streamMessage).toHaveBeenCalledTimes(1);

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(instance.streamMessage).toHaveBeenCalledTimes(1); // still 1
  });

  it('skips when getSessionInstance returns undefined', async () => {
    vi.useRealTimers();
    const host = makeHost({ getSessionInstance: vi.fn(() => undefined) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(host.reattachEventSender).not.toHaveBeenCalled();
  });

  it('skips when session status is not idle', async () => {
    vi.useRealTimers();
    const instance = makeInstance('streaming');
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(instance.streamMessage).not.toHaveBeenCalled();
  });

  it('trigger success: reattaches and calls streamMessage', async () => {
    vi.useRealTimers();
    const instance = makeInstance('idle');
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);

    expect(host.reattachEventSender).toHaveBeenCalledWith(instance);
    expect(instance.streamMessage).toHaveBeenCalledWith(
      expect.anything(), undefined, undefined, {
        emitUserMessage: false,
        persistUserMessage: false,
        interactionPolicy: 'forbid',
      },
    );
    expect(host.log).toHaveBeenCalledWith(
      '[SubAgentAutoWake] Triggering parent turn', 'trigger', { sessionId: 's1' }
    );
  });

  it('clears pendingWakes after streamMessage resolves', async () => {
    vi.useRealTimers();
    let resolveStream;
    const streamPromise = new Promise(r => { resolveStream = r; });
    const instance = makeInstance('idle');
    instance.streamMessage = vi.fn(() => streamPromise);
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(instance.streamMessage).toHaveBeenCalledTimes(1);

    // Still pending — second trigger skipped
    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(instance.streamMessage).toHaveBeenCalledTimes(1);

    // Resolve → pendingWakes cleared
    vi.useRealTimers();
    resolveStream();
    await streamPromise;

    vi.useFakeTimers();
    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(instance.streamMessage).toHaveBeenCalledTimes(2);
  });

  it('re-arms the wake when the parent is busy and a result is still pending', async () => {
    vi.useRealTimers();
    let status = 'streaming';
    const instance = {
      getChatStatus: vi.fn(() => status),
      streamMessage: vi.fn(() => Promise.resolve()),
    };
    mockPeekPendingDeliveries.mockReturnValue([{ taskId: 't1' }]);
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500); // trigger: busy + pending → re-arm, no wake yet
    expect(instance.streamMessage).not.toHaveBeenCalled();

    status = 'idle'; // parent finishes its turn
    vi.advanceTimersByTime(500); // re-armed trigger: idle → wake fires
    expect(instance.streamMessage).toHaveBeenCalledTimes(1);
  });

  it('does not re-arm when the parent is busy and the ledger peek throws', async () => {
    vi.useRealTimers();
    const instance = makeInstance('streaming');
    mockPeekPendingDeliveries.mockImplementation(() => { throw new Error('boom'); });
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500); // trigger: busy + peek throws → no re-arm
    instance.getChatStatus.mockReturnValue('idle');
    vi.advanceTimersByTime(2000); // no re-armed timer → nothing fires
    expect(instance.streamMessage).not.toHaveBeenCalled();
  });

  describe('recoverPendingForSession', () => {
    it('wakes when the ledger has pending results', async () => {
      vi.useRealTimers();
      mockPeekPendingDeliveries.mockReturnValue([{ taskId: 't1' }]);
      const host = makeHost();
      const ctrl = new SubAgentAutoWakeController(host);
      const wakeSpy = vi.spyOn(ctrl, 'handleResultReady').mockImplementation(() => {});

      ctrl.recoverPendingForSession('s1');
      await new Promise(r => setImmediate(r));

      expect(mockPeekPendingDeliveries).toHaveBeenCalledWith('s1');
      expect(wakeSpy).toHaveBeenCalledWith('s1');
      expect(host.log).toHaveBeenCalledWith(
        '[SubAgentAutoWake] Recovering persisted results for session',
        'recoverPendingForSession',
        { sessionId: 's1' },
      );
    });

    it('does not wake when the ledger is empty', async () => {
      vi.useRealTimers();
      mockPeekPendingDeliveries.mockReturnValue([]);
      const host = makeHost();
      const ctrl = new SubAgentAutoWakeController(host);
      const wakeSpy = vi.spyOn(ctrl, 'handleResultReady').mockImplementation(() => {});

      ctrl.recoverPendingForSession('s1');
      await new Promise(r => setImmediate(r));

      expect(mockPeekPendingDeliveries).toHaveBeenCalledWith('s1');
      expect(wakeSpy).not.toHaveBeenCalled();
    });

    it('only attempts recovery once per session per app run', async () => {
      vi.useRealTimers();
      mockPeekPendingDeliveries.mockReturnValue([{ taskId: 't1' }]);
      const host = makeHost();
      const ctrl = new SubAgentAutoWakeController(host);
      const wakeSpy = vi.spyOn(ctrl, 'handleResultReady').mockImplementation(() => {});

      ctrl.recoverPendingForSession('s1');
      await new Promise(r => setImmediate(r));
      ctrl.recoverPendingForSession('s1'); // second call is a no-op
      await new Promise(r => setImmediate(r));

      expect(mockPeekPendingDeliveries).toHaveBeenCalledTimes(1);
      expect(wakeSpy).toHaveBeenCalledTimes(1);
    });

    it('re-checks on a later activation when the first peek is empty', async () => {
      vi.useRealTimers();
      const host = makeHost();
      const ctrl = new SubAgentAutoWakeController(host);
      const wakeSpy = vi.spyOn(ctrl, 'handleResultReady').mockImplementation(() => {});

      // First activation: ledger empty → no wake, and the one-shot guard is NOT
      // consumed so a result that arrives later this run can still be recovered.
      mockPeekPendingDeliveries.mockReturnValue([]);
      ctrl.recoverPendingForSession('s1');
      await new Promise(r => setImmediate(r));
      expect(wakeSpy).not.toHaveBeenCalled();

      // Later activation: a result is now pending → recovered.
      mockPeekPendingDeliveries.mockReturnValue([{ taskId: 't1' }]);
      ctrl.recoverPendingForSession('s1');
      await new Promise(r => setImmediate(r));
      expect(wakeSpy).toHaveBeenCalledTimes(1);
    });

    it('swallows ledger errors without throwing or waking', async () => {
      vi.useRealTimers();
      mockPeekPendingDeliveries.mockImplementation(() => { throw new Error('boom'); });
      const host = makeHost();
      const ctrl = new SubAgentAutoWakeController(host);
      const wakeSpy = vi.spyOn(ctrl, 'handleResultReady').mockImplementation(() => {});

      expect(() => ctrl.recoverPendingForSession('s1')).not.toThrow();
      await new Promise(r => setImmediate(r));

      expect(wakeSpy).not.toHaveBeenCalled();
    });
  });
});
