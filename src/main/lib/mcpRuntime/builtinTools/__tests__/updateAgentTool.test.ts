const mockUpdateChatAgent = vi.fn();
const mockUpdateChatConfig = vi.fn();
const mockGetAllChatConfigs = vi.fn();

vi.mock('../../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    currentUserAlias: 'tester',
    getAllChatConfigs: (...args: unknown[]) => mockGetAllChatConfigs(...args),
    updateChatAgent: (...args: unknown[]) => mockUpdateChatAgent(...args),
    updateChatConfig: (...args: unknown[]) => mockUpdateChatConfig(...args),
  },
}));

import { UpdateAgentTool } from '../updateAgentTool';

function makeAgent(overrides: any = {}) {
  return {
    name: 'demo-agent',
    source: 'ON-DEVICE',
    version: '1.0.0',
    role: 'demo role',
    model: 'gpt-4',
    system_prompt: { 'Base.md': 'demo prompt', 'AGENTS.md': 'project context' },
    knowledge: { knowledgeBase: '/kb' },
    mcp_servers: [],
    skills: [],
    hooks: [],
    emoji: '🤖',
    avatar: '',
    workspace: '/ws',
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
  mockUpdateChatConfig.mockResolvedValue(true);
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

  it('accepts removed source metadata without special validation', () => {
    const result = UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent', source: 'UNKNOWN' }, existingAgent);
    expect(result.valid).toBe(true);
  });

  it('returns valid for correct config', () => {
    expect(UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent' }, existingAgent).valid).toBe(true);
  });

  it('accepts legacy source metadata without special validation', () => {
    expect(UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent', source: 'IN-LIBRARY' }, existingAgent).valid).toBe(true);
  });

  it('returns invalid when workspace is provided', () => {
    const result = UpdateAgentTool.validateConfigForUpdate({ name: 'demo-agent', workspace: '/tmp/ws' }, existingAgent);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('workspace is chat-owned');
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

  it('rejects workspace instead of accepting a no-op chat workspace update', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', workspace: '/tmp/ws' } as any,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_INPUT');
    expect(result.message).toContain('workspace is chat-owned');
    expect(mockUpdateChatAgent).not.toHaveBeenCalled();
    expect(mockUpdateChatConfig).not.toHaveBeenCalled();
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

  describe('UpdateAgentTool.execute – multi-agent chats', () => {
    it('updates a secondary agent through the plural store-aware chat update path', async () => {
      const primary = makeAgent({ id: 'agent_primary', name: 'primary-agent', model: 'old-primary' });
      const secondary = makeAgent({ id: 'agent_secondary', name: 'secondary-agent', model: 'old-secondary' });
      mockGetAllChatConfigs.mockReturnValue([{ chat_id: 'chat-multi', agents: [primary, secondary] }]);

      const result = await UpdateAgentTool.execute({
        agent_config: { name: 'secondary-agent', model: 'new-secondary' },
      });

      expect(result.success).toBe(true);
      expect(mockUpdateChatAgent).not.toHaveBeenCalled();
      expect(mockUpdateChatConfig).toHaveBeenCalledWith(
        'tester',
        'chat-multi',
        expect.objectContaining({
          agent: primary,
          agents: [
            primary,
            expect.objectContaining({ id: 'agent_secondary', name: 'secondary-agent', model: 'new-secondary' }),
          ],
        }),
      );
    });
  });

  it('auto-increments version when new source is ON-DEVICE (2.1.1)', async () => {
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent', source: 'ON-DEVICE' } });
    expect(result.success).toBe(true);
    expect(result.new_version).toBe('1.0.1');
  });

});


describe('UpdateAgentTool.execute – optional field handling', () => {
  it('merges new mcp_servers by default for ON-DEVICE agents', async () => {
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

  it('replaces mcp_servers for ON-DEVICE agents when replace mode is explicit', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      mcp_servers: [{ name: 'existing-server', tools: ['old-tool'] }],
    })));

    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        mcp_servers: [{ name: 'new-server', tools: ['new-tool'] }],
        mcp_servers_mode: 'replace',
      },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].mcp_servers).toEqual([
      { name: 'new-server', tools: ['new-tool'] },
    ]);
  });

  it('uses normal MCP merge behavior with legacy source metadata', async () => {
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
    expect(call.source).toBe('ON-DEVICE');
    expect(call.mcp_servers.some((s: any) => s.name === 'existing')).toBe(true);
    expect(call.mcp_servers.some((s: any) => s.name === 'new-server')).toBe(true);
  });

  it('merges new skills by default for ON-DEVICE agents', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', skills: ['skill-a'] },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].skills).toEqual(['skill-a']);
  });

  it('replaces skills for ON-DEVICE agents when replace mode is explicit', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ skills: ['existing-skill'] })));

    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        skills: ['new-skill'],
        skills_mode: 'replace',
      },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].skills).toEqual(['new-skill']);
  });

  it('uses normal skill merge behavior with legacy source metadata', async () => {
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

  it('updates zero_states when provided', async () => {
    const zeroStates = { greeting: 'Hello', quick_starts: [] };
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', zero_states: zeroStates },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].zero_states).toEqual(zeroStates);
  });

  it('preserves quick_starts when only zero_states.greeting is provided', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      zero_states: {
        greeting: 'Old greeting',
        quick_starts: [{ id: 'card-1', title: 'Card', description: 'Desc', prompt: 'Prompt' }],
      },
    })));

    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', zero_states: { greeting: 'New greeting' } },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].zero_states).toEqual({
      greeting: 'New greeting',
      quick_starts: [{ id: 'card-1', title: 'Card', description: 'Desc', prompt: 'Prompt' }],
    });
  });

  it('updates Base.md from legacy string without dropping AGENTS.md', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', system_prompt: 'new base' },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].system_prompt).toEqual({
      'Base.md': 'new base',
      'AGENTS.md': 'project context',
    });
  });

  it('updates AGENTS.md without dropping Base.md', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', project_context_prompt: 'new context' },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].system_prompt).toEqual({
      'Base.md': 'demo prompt',
      'AGENTS.md': 'new context',
    });
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

  it('uses provided avatar and model for an agent with legacy source metadata', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      source: 'IN-LIBRARY',
      version: '1.0.0',
      model: undefined,
    })));

    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        source: 'IN-LIBRARY',
        version: '2.0.0',
        avatar: 'https://example.com/avatar.png',
        model: 'remote-model',
      },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2]).toEqual(expect.objectContaining({
      avatar: 'https://example.com/avatar.png',
      model: 'remote-model',
    }));
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

describe('UpdateAgentTool.execute – additional branch coverage', () => {
  it('normalizeKnowledgeInput with undefined input uses existingAgent.knowledgeBase as fallback', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ knowledge: undefined, knowledgeBase: '/agent-kb' })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent' },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].knowledge.knowledgeBase).toBe('/agent-kb');
  });

  it('normalises mcp_servers tools to [] when tools is not an array', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        mcp_servers: [{ name: 'srv', tools: 'bad' as any }],
      },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].mcp_servers[0].tools).toEqual([]);
  });

  it('handles non-Error thrown value (EXECUTION_ERROR)', async () => {
    mockGetAllChatConfigs.mockImplementation(() => { throw 'string error'; });
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(false);
    expect(result.error).toBe('EXECUTION_ERROR');
    expect(result.message).toContain('string error');
  });

  it('does not override mcp_servers when config.mcp_servers is undefined', async () => {
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent' },
    });
    expect(result.success).toBe(true);
    const call = mockUpdateChatAgent.mock.calls[0][2];
    expect(call.mcp_servers).toEqual([]);
  });

  it('does not override skills when config.skills is undefined', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ skills: ['orig'] })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent' },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].skills).toEqual(['orig']);
  });

  it('increments patch for version with non-numeric parts', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ version: 'a.b.c' })));
    const result = await UpdateAgentTool.execute({ agent_config: { name: 'demo-agent' } });
    expect(result.success).toBe(true);
    expect(result.new_version).toBe('0.0.1');
  });

  it('keeps existing skills for legacy source metadata when incoming skills are empty', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      source: 'IN-LIBRARY', version: '1.0.0',
      skills: ['existing'],
    })));
    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', source: 'IN-LIBRARY', version: '2.0.0', skills: [] },
    });
    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].skills).toContain('existing');
  });

  it('merges hooks by default for ON-DEVICE agents', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ hooks: ['existing-hook'] })));

    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', hooks: ['new-hook'] },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].hooks).toEqual(['existing-hook', 'new-hook']);
  });

  it('replaces hooks for ON-DEVICE agents when replace mode is explicit', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({ hooks: ['existing-hook'] })));

    const result = await UpdateAgentTool.execute({
      agent_config: { name: 'demo-agent', hooks: ['new-hook'], hooks_mode: 'replace' },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].hooks).toEqual(['new-hook']);
  });

  it('uses empty fallback lists when existing mcp_servers and incoming skills are nullish', async () => {
    mockGetAllChatConfigs.mockReturnValue(makeChats(makeAgent({
      mcp_servers: undefined,
      skills: undefined,
    })));

    const result = await UpdateAgentTool.execute({
      agent_config: {
        name: 'demo-agent',
        mcp_servers: [{ name: 'new-server' }],
        skills: null as any,
      },
    });

    expect(result.success).toBe(true);
    expect(mockUpdateChatAgent.mock.calls[0][2].mcp_servers).toEqual([
      { name: 'new-server', tools: [] },
    ]);
    expect(mockUpdateChatAgent.mock.calls[0][2].skills).toEqual([]);
  });
});
