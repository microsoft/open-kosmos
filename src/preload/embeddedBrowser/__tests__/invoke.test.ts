import { ipcRenderer } from 'electron';
import invokeEmbeddedBrowser from '../invoke';

const mockInvoke = vi.mocked(ipcRenderer.invoke);

describe('invokeEmbeddedBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows destroyAll through the embedded browser preload whitelist', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });

    await invokeEmbeddedBrowser('embeddedBrowser:destroyAll');

    expect(mockInvoke).toHaveBeenCalledWith('embeddedBrowser:destroyAll');
  });

  it('allows setActiveSession through the embedded browser preload whitelist', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });

    await invokeEmbeddedBrowser('embeddedBrowser:setActiveSession', 'session-1');

    expect(mockInvoke).toHaveBeenCalledWith('embeddedBrowser:setActiveSession', 'session-1');
  });

  it('rejects channels outside the embedded browser whitelist', () => {
    expect(() => invokeEmbeddedBrowser('embeddedBrowser:unknown' as any)).toThrow(
      'Channel "embeddedBrowser:unknown" is not allowed',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
