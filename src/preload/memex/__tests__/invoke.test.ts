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

  it('calls ipcRenderer.invoke with "memex:listCards"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: [] });
    await invokeMemex('memex:listCards', { scope: 'current-agent', chatId: 'chat-1' });
    expect(mockInvoke).toHaveBeenCalledWith('memex:listCards', { scope: 'current-agent', chatId: 'chat-1' });
  });

  it('calls ipcRenderer.invoke with "memex:readCard"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    await invokeMemex('memex:readCard', { scope: 'current-agent', chatId: 'chat-1' }, 'slug-1');
    expect(mockInvoke).toHaveBeenCalledWith('memex:readCard', { scope: 'current-agent', chatId: 'chat-1' }, 'slug-1');
  });

  it('calls ipcRenderer.invoke with "memex:getGraph"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });
    const result = await invokeMemex('memex:getGraph', { scope: 'current-agent', chatId: 'chat-1' });
    expect(mockInvoke).toHaveBeenCalledWith('memex:getGraph', { scope: 'current-agent', chatId: 'chat-1' });
    expect(result).toEqual({ success: true });
  });

  it('calls ipcRenderer.invoke with "memex:searchCards"', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: [] });
    await invokeMemex('memex:searchCards', { scope: 'current-agent', chatId: 'chat-1' }, 'query');
    expect(mockInvoke).toHaveBeenCalledWith('memex:searchCards', { scope: 'current-agent', chatId: 'chat-1' }, 'query');
  });

  it('allows profile-memory archive/delete channels', async () => {
    mockInvoke.mockResolvedValue({ success: true });
    await invokeMemex('memex:archiveProfileCard', 'slug-1');
    await invokeMemex('memex:deleteProfileCard', 'slug-1');
    expect(mockInvoke).toHaveBeenCalledWith('memex:archiveProfileCard', 'slug-1');
    expect(mockInvoke).toHaveBeenCalledWith('memex:deleteProfileCard', 'slug-1');
  });

  it('throws when channel is not in the allowed list', () => {
    expect(() => invokeMemex('memex:unknownOp' as any)).toThrow(
      'Channel "memex:unknownOp" is not allowed',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws when channel prefix does not match', () => {
    expect(() => invokeMemex('other:listCards' as any)).toThrow(
      'Channel "other:listCards" is not allowed',
    );
  });
});
