import { ipcRenderer } from 'electron';
import invokeAgentHooks from '../invoke';

const mockInvoke = vi.mocked(ipcRenderer.invoke);

describe('invokeAgentHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows listHooks through the agent hooks preload whitelist', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true, data: [] });

    await invokeAgentHooks('agentHooks:listHooks');

    expect(mockInvoke).toHaveBeenCalledWith('agentHooks:listHooks');
  });

  it('allows setMasterSwitch with arguments', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });

    await invokeAgentHooks('agentHooks:setMasterSwitch', true);

    expect(mockInvoke).toHaveBeenCalledWith('agentHooks:setMasterSwitch', true);
  });

  it('rejects channels outside the agent hooks whitelist', () => {
    expect(() => invokeAgentHooks('agentHooks:unknown' as any)).toThrow(
      'Channel "agentHooks:unknown" is not allowed',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects channels with a different prefix', () => {
    expect(() => invokeAgentHooks('scheduler:listHooks' as any)).toThrow(
      'Channel "scheduler:listHooks" is not allowed',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
