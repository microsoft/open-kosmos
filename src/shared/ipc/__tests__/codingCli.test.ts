/**
 * Shared coding-CLI IPC contract: the renderToMain proxy binds prefixed channels.
 */

import { renderToMain } from '../codingCli';

describe('codingCli renderToMain contract', () => {
  it('exposes bind helpers', () => {
    expect(typeof renderToMain.bindRender).toBe('function');
    expect(typeof renderToMain.bindMain).toBe('function');
    expect(typeof renderToMain.provideInvokeForPreload).toBe('function');
  });

  it('bindRender invokes the prefixed channel', async () => {
    const invoke = vi.fn(async () => ({ success: true }));
    const api = renderToMain.bindRender(invoke);
    await api.getSettings();
    expect(invoke).toHaveBeenCalledWith('codingCli:getSettings');
  });
});
