import { SetPrimaryAgentTool } from '../setPrimaryAgentTool';

const mockGetCachedProfile = vi.fn();
const mockUpdatePrimaryAgent = vi.fn();
let currentUserAlias: string | null = 'test-user';

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    get currentUserAlias() {
      return currentUserAlias;
    },
    getCachedProfile: (...args: any[]) => mockGetCachedProfile(...args),
    updatePrimaryAgent: (...args: any[]) => mockUpdatePrimaryAgent(...args),
  },
}));

describe('SetPrimaryAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserAlias = 'test-user';
  });

  // ========== getDefinition ==========

  it('getDefinition returns correct schema', () => {
    const def = SetPrimaryAgentTool.getDefinition();
    expect(def.name).toBe('set_primary_agent');
    const props = (def.inputSchema as any).properties;
    expect(props.agent_name).toBeDefined();
    expect((def.inputSchema as any).required).toContain('agent_name');
  });

  // ========== Validation ==========

  it('returns failure when args is missing agent_name', async () => {
    const result = await SetPrimaryAgentTool.execute({ agent_name: '' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('agent_name is required');
  });

  it('returns failure when agent_name is whitespace-only', async () => {
    const result = await SetPrimaryAgentTool.execute({ agent_name: '   ' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('agent_name cannot be empty');
  });

  // ========== No active session ==========

  it('returns failure when no active user session', async () => {
    currentUserAlias = null;

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('No active user session');
    expect(result.primaryAgent).toBe('');
  });

  // ========== Profile not found ==========

  it('returns failure when profile is not cached', async () => {
    mockGetCachedProfile.mockReturnValue(null);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('User profile not found');
  });

  // ========== Already primary agent ==========

  it('returns success immediately when agent is already primary', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryAgent: 'Kobi', mcp_servers: [] });

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(true);
    expect(result.primaryAgent).toBe('Kobi');
    expect(result.previousPrimaryAgent).toBe('Kobi');
    expect(result.message).toContain('already the primary agent');
    expect(mockUpdatePrimaryAgent).not.toHaveBeenCalled();
  });

  it('uses "Kobi" as default previousPrimaryAgent when profile has no primaryAgent', async () => {
    mockGetCachedProfile.mockReturnValue({ mcp_servers: [] }); // no primaryAgent field
    mockUpdatePrimaryAgent.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'NewAgent' });

    expect(result.previousPrimaryAgent).toBe('Kobi');
  });

  // ========== Successful update ==========

  it('returns success when updatePrimaryAgent succeeds', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryAgent: 'OldAgent', mcp_servers: [] });
    mockUpdatePrimaryAgent.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'NewAgent' });

    expect(result.success).toBe(true);
    expect(result.primaryAgent).toBe('NewAgent');
    expect(result.previousPrimaryAgent).toBe('OldAgent');
    expect(result.message).toContain('Successfully set "NewAgent"');
    expect(mockUpdatePrimaryAgent).toHaveBeenCalledWith('test-user', 'NewAgent');
  });

  it('trims whitespace from agent_name', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryAgent: 'OldAgent', mcp_servers: [] });
    mockUpdatePrimaryAgent.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: '  NewAgent  ' });

    expect(result.success).toBe(true);
    expect(mockUpdatePrimaryAgent).toHaveBeenCalledWith('test-user', 'NewAgent');
  });

  // ========== Failed update ==========

  it('returns failure when updatePrimaryAgent returns false', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryAgent: 'OldAgent', mcp_servers: [] });
    mockUpdatePrimaryAgent.mockResolvedValue(false);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'NoSuchAgent' });

    expect(result.success).toBe(false);
    expect(result.primaryAgent).toBe('OldAgent');
    expect(result.message).toContain('Failed to set');
  });

  // ========== Error handling ==========

  it('returns failure on unexpected exception', async () => {
    mockGetCachedProfile.mockImplementation(() => {
      throw new Error('Cache crash');
    });

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('Cache crash');
    expect(result.primaryAgent).toBe('');
  });
});
