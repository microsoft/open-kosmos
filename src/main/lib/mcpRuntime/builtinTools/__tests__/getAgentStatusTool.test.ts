import { GetAgentStatusTool } from '../getAgentStatusTool';

const mockGetAllChatConfigs = vi.fn();
let currentUserAlias: string | null = 'test-user';

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    get currentUserAlias() {
      return currentUserAlias;
    },
    getAllChatConfigs: (...args: any[]) => mockGetAllChatConfigs(...args),
  },
}));

describe('GetAgentStatusTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUserAlias = 'test-user';
  });

  // ========== getDefinition ==========

  it('getDefinition returns correct schema', () => {
    const def = GetAgentStatusTool.getDefinition();
    expect(def.name).toBe('get_agent_status');
    const props = (def.inputSchema as any).properties;
    expect(props.agent_name).toBeDefined();
    expect((def.inputSchema as any).required).toContain('agent_name');
  });

  // ========== Validation ==========

  it('returns failure for missing agent_name', async () => {
    const result = await GetAgentStatusTool.execute({ agent_name: '' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('agent_name is required');
  });

  it('returns failure for whitespace-only agent_name', async () => {
    const result = await GetAgentStatusTool.execute({ agent_name: '   ' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('agent_name is required');
  });

  // ========== No active session ==========

  it('returns failure when no active user session', async () => {
    currentUserAlias = null;

    const result = await GetAgentStatusTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(false);
    expect(result.status).toBe('NotAdded');
    expect(result.message).toContain('No active user session');
  });

  // ========== No chats ==========

  it('returns NotAdded when no chats found', async () => {
    mockGetAllChatConfigs.mockReturnValue(null);

    const result = await GetAgentStatusTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(true);
    expect(result.status).toBe('NotAdded');
    expect(result.agent_name).toBe('Kobi');
  });

  it('returns NotAdded when chats array is empty', async () => {
    mockGetAllChatConfigs.mockReturnValue([]);

    const result = await GetAgentStatusTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(true);
    expect(result.status).toBe('NotAdded');
  });

  // ========== Agent not found ==========

  it('returns NotAdded when agent name does not match any chat', async () => {
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'c1', agent: { name: 'OtherAgent', role: 'assistant', emoji: '🤖', model: 'gpt-4' } },
    ]);

    const result = await GetAgentStatusTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(true);
    expect(result.status).toBe('NotAdded');
    expect(result.message).toContain('"Kobi" is not added');
  });

  // ========== Agent found ==========

  it('returns Added with details when agent is found', async () => {
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'chat-42', agent: { name: 'Kobi', role: 'assistant', emoji: '🌟', model: 'gpt-4o' } },
    ]);

    const result = await GetAgentStatusTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(true);
    expect(result.status).toBe('Added');
    expect(result.details?.chat_id).toBe('chat-42');
    expect(result.details?.role).toBe('assistant');
    expect(result.details?.emoji).toBe('🌟');
    expect(result.details?.model).toBe('gpt-4o');
    expect(result.message).toContain('"Kobi" is added');
  });

  it('trims whitespace from agent_name before lookup', async () => {
    mockGetAllChatConfigs.mockReturnValue([
      { chat_id: 'c1', agent: { name: 'Kobi', role: 'assistant' } },
    ]);

    const result = await GetAgentStatusTool.execute({ agent_name: '  Kobi  ' });

    expect(result.status).toBe('Added');
    expect(result.agent_name).toBe('Kobi');
  });

  // ========== Error handling ==========

  it('returns failure on unexpected exception', async () => {
    mockGetAllChatConfigs.mockImplementation(() => {
      throw new Error('DB error');
    });

    const result = await GetAgentStatusTool.execute({ agent_name: 'Kobi' });

    expect(result.success).toBe(false);
    expect(result.status).toBe('NotAdded');
    expect(result.message).toContain('DB error');
  });
});
