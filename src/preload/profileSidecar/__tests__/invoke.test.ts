import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcRenderer } from 'electron';

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import { createProfileSidecarBridge } from '../invoke';

describe('preload/profileSidecar/invoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the six sidecar methods', () => {
    const bridge = createProfileSidecarBridge();
    expect(typeof bridge.getRegisteredAgents).toBe('function');
    expect(typeof bridge.getSkillsForAlias).toBe('function');
    expect(typeof bridge.getHooksForAlias).toBe('function');
    expect(typeof bridge.onAgentsChanged).toBe('function');
    expect(typeof bridge.onSkillsChanged).toBe('function');
    expect(typeof bridge.onHooksChanged).toBe('function');
  });

  it.each([
    ['getRegisteredAgents', 'agents:getAll'],
    ['getSkillsForAlias', 'skills:getAll'],
    ['getHooksForAlias', 'hooks:getAll'],
  ] as const)('%s invokes %s with the alias', async (method, channel) => {
    const mockInvoke = vi.mocked(ipcRenderer.invoke);
    mockInvoke.mockResolvedValueOnce({ success: true, data: [] });
    const bridge = createProfileSidecarBridge();
    const result = await (bridge as any)[method]('alice');
    expect(mockInvoke).toHaveBeenCalledWith(channel, 'alice');
    expect(result).toEqual({ success: true, data: [] });
  });

  it.each([
    ['onAgentsChanged', 'agents:changed'],
    ['onSkillsChanged', 'skills:changed'],
    ['onHooksChanged', 'hooks:changed'],
  ] as const)('%s subscribes to %s and forwards payload, unsubscribe removes the listener', (method, channel) => {
    const on = vi.mocked(ipcRenderer.on);
    const removeListener = vi.mocked(ipcRenderer.removeListener);
    const bridge = createProfileSidecarBridge();

    const callback = vi.fn();
    const unsubscribe = (bridge as any)[method](callback);

    expect(on).toHaveBeenCalledWith(channel, expect.any(Function));
    // The registered listener strips the IPC event arg and forwards data only.
    const listener = on.mock.calls[0][1] as (event: unknown, data: unknown) => void;
    const payload = { alias: 'alice', timestamp: 1 };
    listener({ senderId: 1 }, payload);
    expect(callback).toHaveBeenCalledWith(payload);

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(channel, listener);
  });
});
