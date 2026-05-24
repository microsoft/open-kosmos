/**
 * Tests for memex preload invoke bridge.
 *
 * invoke.ts calls renderToMain.provideInvokeForPreload(ipcRenderer, [...keys]).
 * The electron mock in tests/setup.ts provides a stub ipcRenderer, so we just
 * verify that the exported function delegates to ipcRenderer.invoke with the
 * correct prefixed channel names and rejects blocked channels.
 */

import { ipcRenderer } from 'electron';
import invokeMemex from '../invoke';

const mockInvoke = vi.mocked(ipcRenderer.invoke);

describe('invokeMemex (memex preload invoke bridge)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ipcRenderer.invoke with "memex:enable"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    await invokeMemex('memex:enable');
    expect(mockInvoke).toHaveBeenCalledWith('memex:enable');
  });

  it('calls ipcRenderer.invoke with "memex:disable"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    await invokeMemex('memex:disable');
    expect(mockInvoke).toHaveBeenCalledWith('memex:disable');
  });

  it('calls ipcRenderer.invoke with "memex:getStatus"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: { enabled: false } });
    const result = await invokeMemex('memex:getStatus');
    expect(mockInvoke).toHaveBeenCalledWith('memex:getStatus');
    expect(result).toEqual({ success: true, data: { enabled: false } });
  });

  it('throws when channel is not in the allowed list', () => {
    expect(() => invokeMemex('memex:unknownOp' as any)).toThrow(
      'Channel "memex:unknownOp" is not allowed',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws when channel prefix does not match', () => {
    expect(() => invokeMemex('other:enable' as any)).toThrow(
      'Channel "other:enable" is not allowed',
    );
  });
});
