const mockUpdateChatAgent = vi.fn();
const mockGetAllChatConfigs = vi.fn();

vi.mock('../../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    currentUserAlias: 'tester',
    getAllChatConfigs: (...args: unknown[]) => mockGetAllChatConfigs(...args),
    updateChatAgent: (...args: unknown[]) => mockUpdateChatAgent(...args),
  },
}));

vi.mock('../../../startupUpdate/startupUpdateService', async () => ({
  mergeAgentMcpServers: (local: any[], remote: any[]) => [...local, ...remote.filter(r => !local.find((l: any) => l.name === r.name))],
  mergeAgentSkills: (local: string[], remote: string[]) => Array.from(new Set([...local, ...remote])),
}));

import { UpdateAgentTool } from '../updateAgentTool';

function makeAgent(overrides: any = {}) {
  return {
    name: 'demo-agent',
    source: 'ON-DEVICE',
    version: '1.0.0',
    role: 'demo role',
    model: 'gpt-4',
    system_prompt: 'demo prompt',
    knowledge: { knowledgeBase: '/kb' },
    mcp_servers: [],
    skills: [],
    emoji: '🤖',
    avatar: '',
    workspace: '/ws',
    context_enhancement: {
      search_memory: { enabled: true, semantic_similarity_threshold: 0.8, semantic_top_n: 5 },
      generate_memory: { enabled: false },
    },
    ...overrides,
  };
}

function makeChats(agent: any) {
  return [{ chat_id: 'chat-1', agent }];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent()));
  mockUpdateChatAgent.mockResolvedValue(true);
});

describe('UpdateAgentTool knowledge settings', () => {
  it('keeps existing knowledge settings when no knowledge update is provided', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', role: 'updated role' },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent).toHaveBeenCalledWith(
      'tester', 'chat-1',
      expect.objectContaining({ role: 'updated role', knowledge: expect.objectContaining({ knowledgeBase: '/kb' }) })
    );
  });
});

describe('UpdateAgentTool.getDefinition', () => {
  it('returns a valid tool definition', () => {
    const def = UpdateAgentTool.getDefinition();
    expect(def.name).toBe('update_agent');
    expect(def.inputSchema.required).toContain('agent_config');
  });
});

describe('UpdateAgentTool.validateConfigForUpdate', () => {
  const existingAgent = makeAgent() as any;

  it('returns invalid for non-object config', () => {
    expect(UpdateAgentTool.validateConfigForUpdate(null, existingAgent).valid).toBe(false);
    expect(UpdateAgentTool.validateConfigForUpdate('string', existingAgent).valid).toBe(false);
  });

  it('returns invalid when name is missing', () => {
    expect(UpdateAgentTool.validateConfigForUpdate({}, existingAgent).valid).toBe(false);
  });

  it('returns invalid when name does not match existing agent', () => {
    const result = UpdateAgentTool.validateConfigForUpdate({ name: 'other-agent' }, existingAgent);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Cannot change agent name');
  });

  it('returns invalid when source is invalid', () => {
    const result = UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent', source: 'UNKNOWN' }, existingAgent);
    expect(result.valid).toBe(false);
  });

  it('returns valid for correct config', () => {
    expect(UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent' }, existingAgent).valid).toBe(true);
  });

  it('returns valid for IN-LIBRARY source', () => {
    expect(UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent', source: 'IN-LIBRARY' }, existingAgent).valid).toBe(true);
  });
});

describe('UpdateAgentTool.execute – input validation', () => {
  it('returns INVALID_INPUT when agent_config is missing', async () => {
    const result = await UpdateAgentTool.execute({} as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when agent_config is not an object', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: 'bad' as any });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when name is missing', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: {} as any });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });

  it('returns INVALID_INPUT when name is whitespace only', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: '   ' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
  });
});

describe('UpdateAgentTool.execute – NO_USER_SESSION', () => {
  it('returns NO_USER_SESSION when currentUserAlias is null', async () => {
    const { profileCacheManager } = await import('../../../userDataADO/profileCacheManager');
    (profileCacheManager as any).currentUserAlias = null;
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');
    (profileCacheManager as any).currentUserAlias = 'tester';
  });
});

describe('UpdateAgentTool.execute – NOT_INSTALLED', () => {
  it('returns NOT_INSTALLED when agent not found', async () => {
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'c2', agent: { name: 'other-agent' } }]);
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_INSTALLED');
  });

  it('returns NOT_INSTALLED when chat has no agent', async () => {
    mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'c2' }]);
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_INSTALLED');
  });
});

describe('UpdateAgentTool.execute – ON-DEVICE source rules', () => {
  it('auto-increments version when no source provided (2.1.3)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(true);
    expect(result.new_version).toBe('1.0.1');
    expect(result.new_source).toBe('ON-DEVICE');
  });

  it('auto-increments version when new source is ON-DEVICE (2.1.1)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'ON-DEVICE' } });
    expect(result.success).toBe(true);
    expect(result.new_version).toBe('1.0.1');
  });

  it('requires version when changing to IN-LIBRARY (2.1.2)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'IN-LIBRARY' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('VERSION_REQUIRED');
  });

  it('requires new version > old version when changing to IN-LIBRARY', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '0.9.0' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('VERSION_NOT_GREATER');
  });

  it('succeeds when changing to IN-LIBRARY with greater version', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '2.0.0' } });
    expect(result.success).toBe(true);
    expect(result.new_source).toBe('IN-LIBRARY');
    expect(result.new_version).toBe('2.0.0');
  });
});

describe('UpdateAgentTool.execute – IN-LIBRARY source rules', () => {
  beforeEach(() => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ source: 'IN-LIBRARY', version: '1.5.0' })));
  });

  it('prevents ON-DEVICE override of IN-LIBRARY (2.2.1)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'ON-DEVICE' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('SOURCE_OVERRIDE_NOT_ALLOWED');
  });

  it('requires source and version when no source provided (2.2.3)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('SOURCE_AND_VERSION_REQUIRED');
  });

  it('requires version when IN-LIBRARY updates IN-LIBRARY (2.2.2)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'IN-LIBRARY' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('VERSION_REQUIRED');
  });

  it('requires new version > old version for IN-LIBRARY update', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '1.4.0' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('VERSION_NOT_GREATER');
  });

  it('succeeds when IN-LIBRARY updates with greater version', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '2.0.0' } });
    expect(result.success).toBe(true);
    expect(result.new_version).toBe('2.0.0');
  });
});

describe('UpdateAgentTool.execute – optional field handling', () => {
  it('uses new mcp_servers (ON-DEVICE: full replacement)', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        mcp_servers: [{ name: 'new-server', tools: ['tool1'] }],
      },
    });
    expect(result.success).toBe(true);
    const call = mockUpdateChatAgent.mock.calls[0][2];
    expect(call.mcp_servers).toHaveLength(1);
    expect(call.mcp_servers[0].name).toBe('new-server');
  });

  it('merges mcp_servers for IN-LIBRARY', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      source: 'IN-LIBRARY', version: '1.0.0',
      mcp_servers: [{ name: 'existing', tools: [] }],
    })));
    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        source: 'IN-LIBRARY',
        version: '2.0.0',
        mcp_servers: [{ name: 'new-server' }],
      },
    });
    expect(result.success).toBe(true);
    const call = mockUpdateChatAgent.mock.calls[0][2];
    expect(call.mcp_servers.some((s: any) => s.name === 'existing')).toBe(true);
    expect(call.mcp_servers.some((s: any) => s.name === 'new-server')).toBe(true);
  });

  it('uses new skills (ON-DEVICE: full replacement)', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', skills: ['skill-a'] },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].skills).toEqual(['skill-a']);
  });

  it('merges skills for IN-LIBRARY', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      source: 'IN-LIBRARY', version: '1.0.0',
      skills: ['existing-skill'],
    })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '2.0.0', skills: ['new-skill'] },
    });
    expect(result.success).toBe(true);
    const skills = mockUpdateChatAgent.mock.calls[0][2].skills;
    expect(skills).toContain('existing-skill');
    expect(skills).toContain('new-skill');
  });

  it('updates context_enhancement when provided', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        context_enhancement: {
          search_memory: { enabled: false },
          generate_memory: { enabled: true },
        },
      },
    });
    expect(result.success).toBe(true);
    const ce = mockUpdateChatAgent.mock.calls[0][2].context_enhancement;
    expect(ce.search_memory.enabled).toBe(false);
    expect(ce.generate_memory.enabled).toBe(true);
  });

  it('uses existing context_enhancement when agent has none', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ context_enhancement: undefined })));
    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        context_enhancement: { search_memory: { enabled: true } },
      },
    });
    expect(result.success).toBe(true);
  });

  it('updates zero_states when provided', async () => {
    const zeroStates = { greeting: 'Hello', quick_starts: [] };
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', zero_states: zeroStates },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].zero_states).toEqual(zeroStates);
  });

  it('sets remoteVersion for IN-LIBRARY', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ source: 'IN-LIBRARY', version: '1.0.0' })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '2.0.0', remoteVersion: 'v2-cdn' },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].remoteVersion).toBe('v2-cdn');
  });

  it('clears remoteVersion for ON-DEVICE', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].remoteVersion).toBe('');
  });

  it('uses knowledge.knowledgeBase when provided', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', knowledge: { knowledgeBase: '/new-kb' } },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].knowledge.knowledgeBase).toBe('/new-kb');
  });

  it('uses top-level knowledgeBase when knowledge.knowledgeBase not provided', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', knowledgeBase: '/top-level-kb' },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].knowledge.knowledgeBase).toBe('/top-level-kb');
  });

  it('prefers IN-LIBRARY model from existing agent', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ source: 'IN-LIBRARY', version: '1.0.0', model: 'local-model' })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '2.0.0', model: 'remote-model' },
    });
    expect(result.success).toBe(true);
    // For IN-LIBRARY: existing model takes precedence
    expect(mockUpdateChatAgent.mock.calls[0][2].model).toBe('local-model');
  });
});

describe('UpdateAgentTool.execute – UPDATE_FAILED', () => {
  it('returns UPDATE_FAILED when profileCacheManager returns false', async () => {
    mockUpdateChatAgent.mockResolvedValue(false);
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('UPDATE_FAILED');
  });
});

describe('UpdateAgentTool.execute – EXECUTION_ERROR', () => {
  it('returns EXECUTION_ERROR when exception is thrown', async () => {
    mockGetAllChatConfigs.mockImplementation(() => { throw new Error('db crash'); });
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('EXECUTION_ERROR');
    expect(result.message).toContain('db crash');
  });
});

describe('incrementPatchVersion – invalid format (coverage line 141)', () => {
  it('uses invalid version format to trigger the ".1" fallback path', async () => {
    // Agent with version not in x.y.z format — should auto-increment via "version.1" fallback
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ version: 'invalid' })));
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(true);
    expect(result.new_version).toBe('invalid.1');
  });
});

describe('compareVersions – equal versions (coverage line 175)', () => {
  it('equal version strings trigger VERSION_NOT_GREATER', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ source: 'ON-DEVICE', version: '1.0.0' })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '1.0.0' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('VERSION_NOT_GREATER');
  });
});
