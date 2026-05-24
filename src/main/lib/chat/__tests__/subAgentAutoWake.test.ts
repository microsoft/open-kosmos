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

// Mock featureFlags — no longer needed in source, but keep mock var for host
const mockIsFeatureEnabled = vi.fn();

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
    isFeatureEnabled: mockIsFeatureEnabled,
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
    mockIsFeatureEnabled.mockReset();
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

  it('does nothing when feature flag is disabled', async () => {
    vi.useRealTimers();
    mockIsFeatureEnabled.mockReturnValue(false);
    const host = makeHost();
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();
    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(600);
    expect(host.getSessionInstance).not.toHaveBeenCalled();
  });

  it('debounces multiple calls within 500ms', async () => {
    vi.useRealTimers();
    mockIsFeatureEnabled.mockReturnValue(true);
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
    mockIsFeatureEnabled.mockReturnValue(true);
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
    mockIsFeatureEnabled.mockReturnValue(true);
    const host = makeHost({ getSessionInstance: vi.fn(() => undefined) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);
    expect(host.reattachEventSender).not.toHaveBeenCalled();
  });

  it('skips when session status is not idle', async () => {
    vi.useRealTimers();
    mockIsFeatureEnabled.mockReturnValue(true);
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
    mockIsFeatureEnabled.mockReturnValue(true);
    const instance = makeInstance('idle');
    const host = makeHost({ getSessionInstance: vi.fn(() => instance) });
    const { listener } = await setupAndGetListener(host);
    vi.useFakeTimers();

    listener({ parentSessionId: 's1' });
    vi.advanceTimersByTime(500);

    expect(host.reattachEventSender).toHaveBeenCalledWith(instance);
    expect(instance.streamMessage).toHaveBeenCalledWith(
      expect.anything(), undefined, undefined, { emitUserMessage: false }
    );
    expect(host.log).toHaveBeenCalledWith(
      '[SubAgentAutoWake] Triggering parent turn', 'trigger', { sessionId: 's1' }
    );
  });

  it('clears pendingWakes after streamMessage resolves', async () => {
    vi.useRealTimers();
    mockIsFeatureEnabled.mockReturnValue(true);
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
});
