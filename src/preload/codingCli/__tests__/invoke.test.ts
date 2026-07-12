/**
 * Tests for the coding-CLI preload invoke bridge.
 *
 * invoke.ts whitelists the three coding-CLI channels via provideInvokeForPreload. We verify it
 * delegates allowed channels to ipcRenderer.invoke and rejects channels outside the whitelist.
 */

import { ipcRenderer } from 'electron';
import invokeCodingCli from '../invoke';

const mockInvoke = vi.mocked(ipcRenderer.invoke);

describe('invokeCodingCli (preload bridge)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates codingCli:getSettings to ipcRenderer.invoke', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: { cli: 'claude' } });
    await invokeCodingCli('codingCli:getSettings');
    expect(mockInvoke).toHaveBeenCalledWith('codingCli:getSettings');
  });

  it('delegates codingCli:updateSettings with args', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    await invokeCodingCli('codingCli:updateSettings', { cli: 'codex' });
    expect(mockInvoke).toHaveBeenCalledWith('codingCli:updateSettings', { cli: 'codex' });
  });

  it('delegates codingCli:detectAvailability', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: { clis: [] } });
    const res = await invokeCodingCli('codingCli:detectAvailability');
    expect(mockInvoke).toHaveBeenCalledWith('codingCli:detectAvailability');
    expect(res).toEqual({ success: true, data: { clis: [] } });
  });

  it('throws for a channel outside the whitelist', () => {
    expect(() => invokeCodingCli('codingCli:unknown' as any)).toThrow(
      'Channel "codingCli:unknown" is not allowed',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws when the channel prefix does not match', () => {
    expect(() => invokeCodingCli('other:getSettings' as any)).toThrow(
      'Channel "other:getSettings" is not allowed',
    );
  });
});
