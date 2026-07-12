/**
 * @vitest-environment happy-dom
 */
import { agentHooksApi } from '../agentHooks';

describe('agentHooksApi', () => {
  const originalApi = (window as any).electronAPI;

  afterEach(() => {
    (window as any).electronAPI = originalApi;
  });

  it('routes a call through the preload bridge with the prefixed channel', async () => {
    const bridge = vi.fn().mockResolvedValue({ success: true, data: [] });
    (window as any).electronAPI = { agentHooks: { invoke: bridge } };

    await agentHooksApi.listHooks();

    expect(bridge).toHaveBeenCalledWith('agentHooks:listHooks');
  });

  it('forwards arguments through the bridge', async () => {
    const bridge = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { agentHooks: { invoke: bridge } };

    await agentHooksApi.setMasterSwitch(true);

    expect(bridge).toHaveBeenCalledWith('agentHooks:setMasterSwitch', true);
  });

  it('rejects when the preload bridge is unavailable', async () => {
    (window as any).electronAPI = undefined;

    await expect(agentHooksApi.listHooks()).rejects.toThrow('agentHooks IPC bridge is unavailable');
  });
});
