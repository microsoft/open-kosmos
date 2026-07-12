import { SetPrimaryAgentTool } from '../setPrimaryAgentTool';

const mockGetCachedProfile = vi.fn();
const mockGetAllChatConfigs = vi.fn();
const mockUpdatePrimaryChat = vi.fn();
let currentUserAlias: string | null = 'test-user';

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    get currentUserAlias() {
      return currentUserAlias;
    },
    getCachedProfile: (...args: any[]) => mockGetCachedProfile(...args),
    getAllChatConfigs: (...args: any[]) => mockGetAllChatConfigs(...args),
    updatePrimaryChat: (...args: any[]) => mockUpdatePrimaryChat(...args),
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
    mockGetCachedProfile.mockReturnValue({ primaryChat: 'chat_kobi', mcp_servers: [] });
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'chat_kobi', agent: { name: 'Kobi' } }]);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(true);
    expect(result.primaryAgent).toBe('Kobi');
    expect(result.previousPrimaryAgent).toBe('Kobi');
    expect(result.message).toContain('already the primary agent');
    expect(mockUpdatePrimaryChat).not.toHaveBeenCalled();
  });

  it('reports empty previousPrimaryAgent when profile has no primaryChat', async () => {
    mockGetCachedProfile.mockReturnValue({ mcp_servers: [] }); // no primaryChat field
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'chat_new', agent: { name: 'NewAgent' } }]);
    mockUpdatePrimaryChat.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'NewAgent' });

    expect(result.previousPrimaryAgent).toBe('');
  });

  // ========== Successful update ==========

  it('returns success when updatePrimaryChat succeeds', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryChat: 'chat_old', mcp_servers: [] });
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat_old', agent: { name: 'OldAgent' } },
      { chat_id: 'chat_new', agent: { name: 'NewAgent' } },
    ]);
    mockUpdatePrimaryChat.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'NewAgent' });

    expect(result.success).toBe(true);
    expect(result.primaryAgent).toBe('NewAgent');
    expect(result.previousPrimaryAgent).toBe('OldAgent');
    expect(result.message).toContain('Successfully set "NewAgent"');
    expect(mockUpdatePrimaryChat).toHaveBeenCalledWith('test-user', 'chat_new');
  });

  it('maps a secondary agent name to the owning chat when setting primary chat', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryChat: 'chat_old', mcp_servers: [] });
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat_old', agent: { name: 'OldAgent' } },
      {
        chat_id: 'chat_multi',
        agents: [{ name: 'PrimaryAgent' }, { name: 'SecondaryAgent' }],
      },
    ]);
    mockUpdatePrimaryChat.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'SecondaryAgent' });

    expect(result.success).toBe(true);
    expect(result.primaryAgent).toBe('SecondaryAgent');
    expect(mockUpdatePrimaryChat).toHaveBeenCalledWith('test-user', 'chat_multi');
  });

  it('trims whitespace from agent_name', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryChat: 'chat_old', mcp_servers: [] });
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat_old', agent: { name: 'OldAgent' } },
      { chat_id: 'chat_new', agent: { name: 'NewAgent' } },
    ]);
    mockUpdatePrimaryChat.mockResolvedValue(true);

    const result = await SetPrimaryAgentTool.execute({ agent_name: '  NewAgent  ' });

    expect(result.success).toBe(true);
    expect(mockUpdatePrimaryChat).toHaveBeenCalledWith('test-user', 'chat_new');
  });

  // ========== Failed update ==========

  it('returns failure when agent_name matches no chat', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryChat: 'chat_old', mcp_servers: [] });
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat_old', agent: { name: 'OldAgent' } },
    ]);

    const result = await SetPrimaryAgentTool.execute({ agent_name: 'Ghost' });

    expect(result.success).toBe(false);
    expect(result.primaryAgent).toBe('OldAgent');
    expect(result.previousPrimaryAgent).toBe('OldAgent');
    expect(result.message).toContain('was not found');
    expect(mockUpdatePrimaryChat).not.toHaveBeenCalled();
  });

  it('returns failure when updatePrimaryChat returns false', async () => {
    mockGetCachedProfile.mockReturnValue({ primaryChat: 'chat_old', mcp_servers: [] });
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat_old', agent: { name: 'OldAgent' } },
      { chat_id: 'chat_ns', agent: { name: 'NoSuchAgent' } },
    ]);
    mockUpdatePrimaryChat.mockResolvedValue(false);

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
