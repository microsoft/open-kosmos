# Test Plan: Skill / MCP / Agent Built-in Tools Refactoring

<!-- Last verified: 2026-05-12 -->

## 1. Test Strategy Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Core Principle: Same input → Same output during parallel period  │
│  Verification: Shadow Mode + Capability Parity + E2E Coverage    │
└──────────────────────────────────────────────────────────────────┘
```

### Test Pyramid

```
          ┌─────────────┐
          │  AI Eval    │  ← Phase 4: LLM tool-call accuracy
          │  (50+ cases)│
          ├─────────────┤
          │ Integration │  ← Phase 2: Full lifecycle tests
          │ (3 suites)  │
          ├─────────────┤
          │ Shadow Mode │  ← Phase 3: Dual-write comparison
          │ (runtime)   │
          ├─────────────┤
          │  Unit Tests │  ← Phase 1: Parameter mapping + errors
          │ (5 suites)  │
          ├─────────────┤
          │  Baseline   │  ← Phase 0: Lock existing behavior
          │ (golden)    │
          └─────────────┘
```

---

## 2. Phase 0: Baseline Lock (Before Any New Code)

### 2.1 Goal

Establish a test safety net for existing tools that currently lack dedicated test files.

### 2.2 New Test Files to Create

| File | Target Tool | Coverage |
|---|---|---|
| `createMcpServerFromConfigTool.test.ts` | `create_mcp_server_from_config` | stdio/sse/StreamableHttp transports, missing field errors, duplicate name handling |
| `updateMcpServerTool.test.ts` | `update_mcp_server` | All 5 source/version state transitions (see matrix below) |
| `createAgentFromConfigTool.test.ts` | `create_agent_from_config` | Minimal params, full params, mcp_servers binding, memory config, skills array |
| `applySkillToAgentsTool.test.ts` | `apply_skill_to_agents` | device source, missing path error, multi-agent targeting |

### 2.3 Source/Version State Machine Test Matrix (`updateMcpServerTool`)

| # | Existing Source | New Source | New Version | Expected Result |
|---|---|---|---|---|
| 1 | ON-DEVICE | ON-DEVICE | (any) | ✅ Success, version auto-incremented |
| 2 | ON-DEVICE | omitted | (any) | ✅ Success, stays ON-DEVICE, version auto-incremented |

### 2.4 Golden Snapshot Archive

File: `__fixtures__/golden-snapshots.json`

```jsonc
{
  "create_mcp_server_from_config": [
    {
      "id": "stdio-basic",
      "input": {
        "mcp_config": { "name": "test-server", "transport": "stdio", "command": "node", "args": ["server.js"] }
      },
      "expected_side_effects": ["profileCacheManager.addMcpServer({ name: 'test-server', transport: 'stdio' })"],
      "expected_result_pattern": "success.*test-server"
    },
    {
      "id": "sse-basic",
      "input": {
        "mcp_config": { "name": "remote-server", "transport": "sse", "url": "http://localhost:3000/sse" }
      },
      "expected_side_effects": ["profileCacheManager.addMcpServer({ name: 'remote-server', transport: 'sse' })"],
      "expected_result_pattern": "success.*remote-server"
    },
    {
      "id": "stdio-missing-command",
      "input": {
        "mcp_config": { "name": "bad", "transport": "stdio" }
      },
      "expected_error_pattern": "command.*required"
    }
  ],
  "create_agent_from_config": [
    {
      "id": "minimal",
      "input": { "name": "TestBot" },
      "expected_side_effects": ["profileCacheManager.addAgent({ name: 'TestBot' })"],
      "expected_result_pattern": "success.*TestBot"
    },
    {
      "id": "full-config",
      "input": {
        "name": "FullBot", "model": "gpt-4o", "role": "Researcher",
        "mcp_servers": [{ "name": "github", "tools": [] }],
        "context_enhancement": { "search_memory": { "enabled": true }, "generate_memory": { "enabled": true } },
        "skills": ["code-review"], "workspace": "/tmp/ws"
      },
      "expected_side_effects": ["profileCacheManager.addAgent({ name: 'FullBot', model: 'gpt-4o', skills: ['code-review'] })"],
      "expected_result_pattern": "success.*FullBot"
    }
  ],
  "apply_skill_to_agents": [
    {
      "id": "device-missing-path",
      "input": { "skill_name": "custom", "source": "device" },
      "expected_error_pattern": "path.*required|not found"
    }
  ]
}
```

---

## 3. Phase 1: Facade Unit Tests

### 3.1 Parameter Mapping Tests

File: `facades/__tests__/manageMcpFacade.test.ts`

```typescript
describe('manage_mcp facade', () => {
  describe('action=add, from_library=true', () => {
    it('fetches template from library and merges env overrides', async () => {
      mockLibrary.getTemplate.mockResolvedValue({
        name: 'github', transport: 'stdio', command: 'npx',
        args: ['-y', '@mcp/server-github'], env: { TOKEN: '' }
      });

      await facade.execute({ action: 'add', name: 'github', from_library: true, env: { TOKEN: 'my-token' } });

      expect(mockCreateMcp).toHaveBeenCalledWith({
        mcp_config: expect.objectContaining({
          name: 'github', transport: 'stdio', command: 'npx',
          env: { TOKEN: 'my-token' },
          source: 'IN-LIBRARY'
        })
      });
    });

    it('returns error when library template not found', async () => {
      mockLibrary.getTemplate.mockResolvedValue(null);
      const result = await facade.execute({ action: 'add', name: 'unknown', from_library: true });
      expect(result).toMatchObject({ error: true, message: expect.stringContaining('not found in library') });
    });
  });

  describe('action=add, direct (no library)', () => {
    it('creates MCP with ON-DEVICE source and version 1.0.0', async () => {
      await facade.execute({ action: 'add', name: 'local', transport: 'stdio', command: 'node', args: ['s.js'] });

      expect(mockCreateMcp).toHaveBeenCalledWith({
        mcp_config: expect.objectContaining({
          name: 'local', transport: 'stdio', command: 'node', args: ['s.js'],
          source: 'ON-DEVICE', version: '1.0.0'
        })
      });
    });
  });

  describe('action=update', () => {
    it('auto-manages version when updating ON-DEVICE server', async () => {
      mockProfileCache.getMcpServer.mockReturnValue({ name: 'local', source: 'ON-DEVICE', version: '1.0.0' });
      await facade.execute({ action: 'update', name: 'local', env: { NEW: 'val' } });

      expect(mockUpdateMcp).toHaveBeenCalledWith({
        mcp_config: expect.objectContaining({ name: 'local', version: '1.0.1', source: 'ON-DEVICE', env: { NEW: 'val' } })
      });
    });
  });

  describe('action=connect/disconnect/reconnect', () => {
    it('maps to setMcpConnectionState with correct field names', async () => {
      await facade.execute({ action: 'reconnect', name: 'github' });
      expect(mockSetConnState).toHaveBeenCalledWith({ name: 'github', action: 'reconnect' });
    });
  });

  describe('action=status', () => {
    it('maps name → mcp_name for getMcpStatus', async () => {
      await facade.execute({ action: 'status', name: 'github' });
      expect(mockGetStatus).toHaveBeenCalledWith({ mcp_name: 'github' });
    });
  });
});
```

File: `facades/__tests__/manageAgentsFacade.test.ts`

```typescript
describe('manage_agents facade', () => {
  describe('action=create, basic', () => {
    it('converts mcp_servers string array to object array', async () => {
      await facade.execute({ action: 'create', name: 'Bot', mcp_servers: ['github', 'bing'] });

      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        mcp_servers: [
          { name: 'github', tools: [] },
          { name: 'bing', tools: [] }
        ]
      }));
    });

    it('merges mcp_tool_filter into mcp_servers objects', async () => {
      await facade.execute({
        action: 'create', name: 'Bot',
        mcp_servers: ['github', 'bing'],
        mcp_tool_filter: { github: ['search_repos', 'get_file'] }
      });

      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        mcp_servers: [
          { name: 'github', tools: ['search_repos', 'get_file'] },
          { name: 'bing', tools: [] }
        ]
      }));
    });

    it('expands memory_enabled=true to full context_enhancement', async () => {
      await facade.execute({ action: 'create', name: 'Bot', memory_enabled: true });

      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        context_enhancement: {
          search_memory: { enabled: true, semantic_similarity_threshold: 0.7, semantic_top_n: 5 },
          generate_memory: { enabled: true }
        }
      }));
    });

    it('expands memory_enabled=false to disabled context_enhancement', async () => {
      await facade.execute({ action: 'create', name: 'Bot', memory_enabled: false });

      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        context_enhancement: {
          search_memory: { enabled: false },
          generate_memory: { enabled: false }
        }
      }));
    });

    it('maps knowledge_base to knowledgeBase field', async () => {
      await facade.execute({ action: 'create', name: 'Bot', knowledge_base: '/data/kb' });
      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBase: '/data/kb' }));
    });
  });

  describe('action=create, from_library', () => {
    it('fetches library template then applies overrides', async () => {
      mockLibrary.getAgentTemplate.mockResolvedValue({
        name: 'Research Agent', model: 'gpt-4', role: 'Researcher', mcp_servers: [{ name: 'bing', tools: [] }]
      });

      await facade.execute({ action: 'create', name: 'Research Agent', from_library: true, model: 'gpt-4o' });

      expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Research Agent', model: 'gpt-4o', role: 'Researcher'
      }));
    });
  });

  describe('action=update', () => {
    it('wraps in agent_config for legacy updateAgent tool', async () => {
      mockProfileCache.getAgent.mockReturnValue({ name: 'Bot', source: 'ON-DEVICE', version: '1.0.0' });
      await facade.execute({ action: 'update', name: 'Bot', model: 'claude-sonnet-4-20250514' });

      expect(mockUpdateAgent).toHaveBeenCalledWith({
        agent_config: expect.objectContaining({ name: 'Bot', model: 'claude-sonnet-4-20250514', version: '1.0.1' })
      });
    });
  });

  describe('action=list', () => {
    it('requires no additional params', async () => {
      await facade.execute({ action: 'list' });
      expect(mockListAgents).toHaveBeenCalledWith({});
    });
  });

  describe('action=set_primary', () => {
    it('maps name → agent_name', async () => {
      await facade.execute({ action: 'set_primary', name: 'Bot' });
      expect(mockSetPrimary).toHaveBeenCalledWith({ agent_name: 'Bot' });
    });
  });

  describe('action=status', () => {
    it('maps name → agent_name', async () => {
      await facade.execute({ action: 'status', name: 'Bot' });
      expect(mockGetStatus).toHaveBeenCalledWith({ agent_name: 'Bot' });
    });
  });
});
```

File: `facades/__tests__/manageSkillsFacade.test.ts`

```typescript
describe('manage_skills facade', () => {
  describe('action=install, source=library', () => {
    it('calls installAndActivateSkill for each skill_name', async () => {
      await facade.execute({ action: 'install', skill_names: ['web-search', 'code-review'], source: 'library' });

      expect(mockInstallSkill).toHaveBeenCalledTimes(2);
      expect(mockInstallSkill).toHaveBeenCalledWith('web-search', 'library', undefined);
      expect(mockInstallSkill).toHaveBeenCalledWith('code-review', 'library', undefined);
    });
  });

  describe('action=install, source=device', () => {
    it('calls updateSkillFromDevice with path', async () => {
      await facade.execute({ action: 'install', skill_names: ['custom'], source: 'device', path: '/tmp/skill.zip' });
      expect(mockInstallFromDevice).toHaveBeenCalledWith('/tmp/skill.zip');
    });

    it('returns error when path is missing', async () => {
      const result = await facade.execute({ action: 'install', skill_names: ['custom'], source: 'device' });
      expect(result).toMatchObject({ error: true, message: expect.stringContaining('path') });
    });
  });

  describe('action=bind', () => {
    it('binds skills to specified agents', async () => {
      await facade.execute({ action: 'bind', skill_names: ['web-search'], agent_names: ['Bot1', 'Bot2'] });

      expect(mockApplySkill).toHaveBeenCalledWith({ skill_name: 'web-search', agent_names: ['Bot1', 'Bot2'] });
    });

    it('binds to all agents when all_agents=true', async () => {
      await facade.execute({ action: 'bind', skill_names: ['web-search'], all_agents: true });

      expect(mockApplySkill).toHaveBeenCalledWith({ skill_name: 'web-search', apply_to_all: true });
    });

    it('defaults to current agent when no targeting specified', async () => {
      await facade.execute({ action: 'bind', skill_names: ['web-search'] });

      expect(mockApplySkill).toHaveBeenCalledWith({ skill_name: 'web-search' });
    });
  });

  describe('action=unbind', () => {
    it('delegates to removeSkillsFromAgents', async () => {
      await facade.execute({ action: 'unbind', skill_names: ['web-search'], agent_names: ['Bot'] });

      expect(mockRemoveSkills).toHaveBeenCalledWith({ skill_names: ['web-search'], agent_names: ['Bot'] });
    });
  });

  describe('action=uninstall', () => {
    it('delegates to uninstallSkills', async () => {
      await facade.execute({ action: 'uninstall', skill_names: ['web-search', 'old-skill'] });
      expect(mockUninstall).toHaveBeenCalledWith({ skill_names: ['web-search', 'old-skill'] });
    });
  });
});
```

### 3.2 Input Validation Tests

File: `facades/__tests__/inputValidation.test.ts`

```typescript
describe('Facade input validation', () => {
  describe('manage_mcp', () => {
    it.each([
      [{ action: 'add' }, 'name is required'],
      [{ name: 'x' }, 'action is required'],
      [{ action: 'add', name: 'x', transport: 'stdio' }, 'command is required for stdio'],
      [{ action: 'add', name: 'x', transport: 'sse' }, 'url is required for sse'],
      [{ action: 'add', name: 'x', transport: 'StreamableHttp' }, 'url is required for StreamableHttp'],
      [{ action: 'invalid', name: 'x' }, 'invalid action'],
    ])('rejects %j with message containing "%s"', async (input, expectedMsg) => {
      const result = await manageMcpFacade.execute(input);
      expect(result.error).toBe(true);
      expect(result.message.toLowerCase()).toContain(expectedMsg.toLowerCase());
    });
  });

  describe('manage_agents', () => {
    it.each([
      [{ action: 'create' }, 'name is required'],
      [{ action: 'update' }, 'name is required'],
      [{ action: 'set_primary' }, 'name is required'],
      [{ action: 'status' }, 'name is required'],
      [{ action: 'remove' }, 'name is required'],
      [{ action: 'invalid', name: 'x' }, 'invalid action'],
      // action=list does NOT require name
    ])('rejects %j with message containing "%s"', async (input, expectedMsg) => {
      const result = await manageAgentsFacade.execute(input);
      expect(result.error).toBe(true);
      expect(result.message.toLowerCase()).toContain(expectedMsg.toLowerCase());
    });

    it('action=list does not require name', async () => {
      const result = await manageAgentsFacade.execute({ action: 'list' });
      expect(result.error).toBeUndefined();
    });
  });

  describe('manage_skills', () => {
    it.each([
      [{ action: 'install' }, 'skill_names is required'],
      [{ skill_names: ['x'] }, 'action is required'],
      [{ action: 'install', skill_names: [] }, 'skill_names must not be empty'],
      [{ action: 'install', skill_names: ['x'], source: 'device' }, 'path is required when source=device'],
      [{ action: 'invalid', skill_names: ['x'] }, 'invalid action'],
    ])('rejects %j with message containing "%s"', async (input, expectedMsg) => {
      const result = await manageSkillsFacade.execute(input);
      expect(result.error).toBe(true);
      expect(result.message.toLowerCase()).toContain(expectedMsg.toLowerCase());
    });
  });
});
```

---

## 4. Phase 2: Integration Tests (Full Lifecycle)

### 4.1 MCP Lifecycle

File: `facades/__tests__/manageMcpFacade.integration.test.ts`

```typescript
describe('MCP full lifecycle via manage_mcp', () => {
  let profileStore: InMemoryProfileStore;

  beforeEach(() => {
    profileStore = createInMemoryProfileStore();
  });

  it('add from library → status → update env → reconnect → remove', async () => {
    // 1. Add from library
    const addResult = await execute('manage_mcp', {
      action: 'add', name: 'github', from_library: true,
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123' }
    });
    expect(addResult.error).toBeUndefined();

    const server = profileStore.getMcpServer('github');
    expect(server).toMatchObject({
      name: 'github', transport: 'stdio', source: 'IN-LIBRARY',
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abc123' }
    });

    // 2. Check status
    const statusResult = await execute('manage_mcp', { action: 'status', name: 'github' });
    expect(statusResult.status).toMatch(/Connected|Disconnected/);

    // 3. Update env
    const updateResult = await execute('manage_mcp', {
      action: 'update', name: 'github',
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_new456' }
    });
    expect(updateResult.error).toBeUndefined();
    expect(profileStore.getMcpServer('github').env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_new456');

    // 4. Reconnect
    const reconnResult = await execute('manage_mcp', { action: 'reconnect', name: 'github' });
    expect(reconnResult.error).toBeUndefined();

    // 5. Remove
    const removeResult = await execute('manage_mcp', { action: 'remove', name: 'github' });
    expect(removeResult.error).toBeUndefined();
    expect(profileStore.getMcpServer('github')).toBeUndefined();
  });

  it('add direct stdio → update args → verify version auto-incremented', async () => {
    await execute('manage_mcp', {
      action: 'add', name: 'local', transport: 'stdio', command: 'node', args: ['v1.js']
    });
    expect(profileStore.getMcpServer('local').version).toBe('1.0.0');

    await execute('manage_mcp', { action: 'update', name: 'local', args: ['v2.js'] });
    expect(profileStore.getMcpServer('local').version).toBe('1.0.1');
    expect(profileStore.getMcpServer('local').args).toEqual(['v2.js']);
  });

  it('add direct sse server', async () => {
    await execute('manage_mcp', {
      action: 'add', name: 'remote', transport: 'sse', url: 'http://localhost:3000/sse'
    });
    expect(profileStore.getMcpServer('remote')).toMatchObject({
      name: 'remote', transport: 'sse', url: 'http://localhost:3000/sse'
    });
  });

  it('error: add duplicate name', async () => {
    await execute('manage_mcp', { action: 'add', name: 'dup', transport: 'stdio', command: 'x' });
    const result = await execute('manage_mcp', { action: 'add', name: 'dup', transport: 'stdio', command: 'y' });
    expect(result.error).toBe(true);
    expect(result.message).toContain('already exists');
  });

  it('error: update non-existent server', async () => {
    const result = await execute('manage_mcp', { action: 'update', name: 'ghost', command: 'x' });
    expect(result.error).toBe(true);
    expect(result.message).toContain('not found');
  });

  it('error: remove non-existent server', async () => {
    const result = await execute('manage_mcp', { action: 'remove', name: 'ghost' });
    expect(result.error).toBe(true);
    expect(result.message).toContain('not found');
  });
});
```

### 4.2 Agent Lifecycle

File: `facades/__tests__/manageAgentsFacade.integration.test.ts`

```typescript
describe('Agent full lifecycle via manage_agents', () => {
  let profileStore: InMemoryProfileStore;

  beforeEach(() => {
    profileStore = createInMemoryProfileStore();
  });

  it('create → update model → bind mcp → set_primary → list → remove', async () => {
    // Create
    await execute('manage_agents', {
      action: 'create', name: 'TestBot', role: 'Tester', model: 'gpt-4o',
      mcp_servers: ['github'], memory_enabled: true
    });
    const agent = profileStore.getAgent('TestBot');
    expect(agent).toMatchObject({ name: 'TestBot', model: 'gpt-4o', role: 'Tester' });
    expect(agent.mcp_servers).toEqual([{ name: 'github', tools: [] }]);
    expect(agent.context_enhancement.search_memory.enabled).toBe(true);
    expect(agent.context_enhancement.generate_memory.enabled).toBe(true);

    // Update model
    await execute('manage_agents', { action: 'update', name: 'TestBot', model: 'claude-sonnet-4-20250514' });
    expect(profileStore.getAgent('TestBot').model).toBe('claude-sonnet-4-20250514');

    // Add more mcp_servers
    await execute('manage_agents', { action: 'update', name: 'TestBot', mcp_servers: ['github', 'bing'] });
    expect(profileStore.getAgent('TestBot').mcp_servers).toHaveLength(2);

    // Set primary
    await execute('manage_agents', { action: 'set_primary', name: 'TestBot' });
    expect(profileStore.getPrimaryAgent()).toBe('TestBot');

    // List
    const listResult = await execute('manage_agents', { action: 'list' });
    expect(listResult).toContain('TestBot');

    // Remove
    await execute('manage_agents', { action: 'remove', name: 'TestBot' });
    const listAfter = await execute('manage_agents', { action: 'list' });
    expect(listAfter).not.toContain('TestBot');
  });

  it('create from library with overrides', async () => {
    mockLibrary.getAgentTemplate.mockResolvedValue({
      name: 'Research Agent', model: 'gpt-4', role: 'Researcher',
      mcp_servers: [{ name: 'bing', tools: [] }],
      context_enhancement: { search_memory: { enabled: true }, generate_memory: { enabled: true } }
    });

    await execute('manage_agents', {
      action: 'create', name: 'Research Agent', from_library: true,
      model: 'gpt-4o', mcp_servers: ['bing', 'github']
    });

    const agent = profileStore.getAgent('Research Agent');
    expect(agent.model).toBe('gpt-4o'); // overridden
    expect(agent.role).toBe('Researcher'); // from template
    expect(agent.mcp_servers).toEqual([
      { name: 'bing', tools: [] },
      { name: 'github', tools: [] }
    ]); // overridden
  });

  it('create with mcp_tool_filter limits specific tools', async () => {
    await execute('manage_agents', {
      action: 'create', name: 'Filtered',
      mcp_servers: ['github', 'bing'],
      mcp_tool_filter: { github: ['search_repos'] }
    });

    const agent = profileStore.getAgent('Filtered');
    expect(agent.mcp_servers).toEqual([
      { name: 'github', tools: ['search_repos'] },
      { name: 'bing', tools: [] }
    ]);
  });

  it('disable memory on existing agent', async () => {
    await execute('manage_agents', { action: 'create', name: 'Bot' });
    await execute('manage_agents', { action: 'update', name: 'Bot', memory_enabled: false });

    const agent = profileStore.getAgent('Bot');
    expect(agent.context_enhancement.search_memory.enabled).toBe(false);
    expect(agent.context_enhancement.generate_memory.enabled).toBe(false);
  });
});
```

### 4.3 Skill Lifecycle

File: `facades/__tests__/manageSkillsFacade.integration.test.ts`

```typescript
describe('Skill full lifecycle via manage_skills', () => {
  let profileStore: InMemoryProfileStore;

  beforeEach(() => {
    profileStore = createInMemoryProfileStore();
    profileStore.addAgent({ name: 'Default' });
    profileStore.addAgent({ name: 'Research' });
  });

  it('install from library → bind to agent → unbind → uninstall', async () => {
    // Install
    await execute('manage_skills', { action: 'install', skill_names: ['code-review'], source: 'library' });
    expect(profileStore.getInstalledSkills()).toContain('code-review');

    // Bind to specific agent
    await execute('manage_skills', { action: 'bind', skill_names: ['code-review'], agent_names: ['Default'] });
    expect(profileStore.getAgent('Default').skills).toContain('code-review');
    expect(profileStore.getAgent('Research').skills || []).not.toContain('code-review');

    // Unbind
    await execute('manage_skills', { action: 'unbind', skill_names: ['code-review'], agent_names: ['Default'] });
    expect(profileStore.getAgent('Default').skills || []).not.toContain('code-review');

    // Uninstall
    await execute('manage_skills', { action: 'uninstall', skill_names: ['code-review'] });
    expect(profileStore.getInstalledSkills()).not.toContain('code-review');
  });

  it('install from device with path', async () => {
    mockFs.existsSync.mockReturnValue(true);
    await execute('manage_skills', { action: 'install', skill_names: ['custom'], source: 'device', path: '/tmp/my-skill.zip' });
    expect(mockInstallFromDevice).toHaveBeenCalledWith('/tmp/my-skill.zip');
    expect(profileStore.getInstalledSkills()).toContain('custom');
  });

  it('bind to all agents', async () => {
    profileStore.installSkill('web-search');
    await execute('manage_skills', { action: 'bind', skill_names: ['web-search'], all_agents: true });

    expect(profileStore.getAgent('Default').skills).toContain('web-search');
    expect(profileStore.getAgent('Research').skills).toContain('web-search');
  });

  it('install multiple skills at once', async () => {
    await execute('manage_skills', { action: 'install', skill_names: ['skill-a', 'skill-b', 'skill-c'], source: 'library' });
    expect(profileStore.getInstalledSkills()).toEqual(expect.arrayContaining(['skill-a', 'skill-b', 'skill-c']));
  });

  it('error: uninstall non-existent skill', async () => {
    const result = await execute('manage_skills', { action: 'uninstall', skill_names: ['ghost'] });
    expect(result.error).toBe(true);
    expect(result.message).toContain('not installed');
  });

  it('error: bind non-installed skill', async () => {
    const result = await execute('manage_skills', { action: 'bind', skill_names: ['not-installed'], agent_names: ['Default'] });
    expect(result.error).toBe(true);
    expect(result.message).toContain('not installed');
  });
});
```

---

## 5. Phase 3: Shadow Mode (Dual-Write Verification)

### 5.1 Implementation

```typescript
// src/main/lib/mcpRuntime/builtinTools/facades/shadowExecutionMiddleware.ts
// Enabled only when: process.env.NODE_ENV === 'development' || process.env.SHADOW_MODE === '1'

interface ShadowResult {
  tool: string;
  input: any;
  newResult: any;
  legacyResult: any;
  match: boolean;
  diff?: any[];
}

export async function shadowExecute(
  facadeName: string,
  facadeInput: any,
  facadeExecute: (input: any) => Promise<any>,
  legacyMapping: { toolName: string; input: any },
  legacyExecute: (toolName: string, input: any) => Promise<any>
): Promise<{ result: any; shadow: ShadowResult }> {
  const [newResult, legacyResult] = await Promise.allSettled([
    facadeExecute(facadeInput),
    legacyExecute(legacyMapping.toolName, legacyMapping.input),
  ]);

  const newValue = newResult.status === 'fulfilled' ? newResult.value : { error: newResult.reason };
  const legacyValue = legacyResult.status === 'fulfilled' ? legacyResult.value : { error: legacyResult.reason };

  const diff = deepDiff(normalize(newValue), normalize(legacyValue));
  const match = diff.length === 0;

  if (!match) {
    logger.warn('[Shadow] Mismatch detected', { facadeName, diff });
    telemetry.track('shadow_mismatch', { tool: facadeName, diff_count: diff.length, diff_summary: diff.slice(0, 3) });
  }

  return { result: newValue, shadow: { tool: facadeName, input: facadeInput, newResult: newValue, legacyResult: legacyValue, match, diff } };
}

function normalize(result: any): any {
  // Strip unstable fields: timestamps, generated IDs, version auto-increments
  const clone = JSON.parse(JSON.stringify(result));
  delete clone.timestamp;
  delete clone.id;
  // Normalize version field (both should agree on semantics, not exact value during transition)
  return clone;
}
```

### 5.2 Shadow Coverage Matrix

| Facade Call | Legacy Equivalent | Fields Compared |
|---|---|---|
| `manage_mcp({action:"add", name, from_library, env})` | `get_mcp_template` + `create_mcp_server_from_config` | result.success, side effect on profile |
| `manage_mcp({action:"update", name, env})` | `update_mcp_server({mcp_config:{name, env}})` | result.success, updated fields |
| `manage_mcp({action:"status", name})` | `get_mcp_status({mcp_name: name})` | result.status (exact match) |
| `manage_mcp({action:"reconnect", name})` | `set_mcp_connection_state({name, action:"reconnect"})` | result.success |
| `manage_agents({action:"create", name, ...})` | `create_agent_from_config({name, ...expanded})` | profile agent config equality |
| `manage_agents({action:"update", name, ...})` | `update_agent({agent_config:{name, ...}})` | profile agent config equality |
| `manage_agents({action:"list"})` | `list_agents({})` | result array equality |
| `manage_skills({action:"bind", skill_names, agent_names})` | `apply_skill_to_agents({skill_name, agent_names})` | profile agent skills equality |
| `manage_skills({action:"uninstall", skill_names})` | `uninstall_skills({skill_names})` | installed skills list equality |

### 5.3 CI Gate

```yaml
# .github/workflows/shadow-check.yml (or equivalent)
- name: Run shadow mode tests
  env:
    SHADOW_MODE: "1"
  run: npm test -- --grep "shadow"

- name: Verify zero mismatches
  run: |
    MISMATCHES=$(grep -c "shadow_mismatch" test-output.log || echo "0")
    if [ "$MISMATCHES" -ne "0" ]; then
      echo "❌ Shadow mismatches detected: $MISMATCHES"
      exit 1
    fi
```

---

## 6. Phase 4: AI Behavior Evaluation

### 6.1 Eval Dataset (50+ cases)

File: `facades/__tests__/__fixtures__/ai-eval-prompts.json`

```jsonc
[
  {
    "id": "mcp-add-library-basic",
    "user_message": "Add a GitHub MCP server with token ghp_xxx",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "add", "name": "github", "from_library": true },
    "required_fields": ["env"],
    "must_not_contain": ["mcp_config", "source", "version", "remoteVersion"]
  },
  {
    "id": "mcp-add-library-brave",
    "user_message": "Install the brave-search MCP server, my API key is bsk_123",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "add", "name": "brave-search", "from_library": true }
  },
  {
    "id": "mcp-add-custom-stdio",
    "user_message": "Add a custom MCP server called 'my-db', command is 'python3 db_server.py', with args ['--port', '5432']",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "add", "name": "my-db", "transport": "stdio", "command": "python3" }
  },
  {
    "id": "mcp-add-custom-sse",
    "user_message": "Add an SSE MCP server named 'remote-api' at http://api.example.com/mcp",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "add", "name": "remote-api", "transport": "sse", "url": "http://api.example.com/mcp" }
  },
  {
    "id": "mcp-disconnect",
    "user_message": "Disconnect the filesystem MCP server",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "disconnect", "name": "filesystem" }
  },
  {
    "id": "mcp-reconnect",
    "user_message": "Reconnect the github server",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "reconnect", "name": "github" }
  },
  {
    "id": "mcp-status",
    "user_message": "Check if the brave-search server is connected",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "status", "name": "brave-search" }
  },
  {
    "id": "mcp-update-env",
    "user_message": "Update the github server token to ghp_new",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "update", "name": "github" }
  },
  {
    "id": "mcp-remove",
    "user_message": "Remove the old-server MCP",
    "expected_tool": "manage_mcp",
    "expected_input_subset": { "action": "remove", "name": "old-server" }
  },
  {
    "id": "mcp-search-library",
    "user_message": "What MCP servers are available in the library?",
    "expected_tool": "search_mcp",
    "expected_input_subset": { "installed": false }
  },
  {
    "id": "mcp-list-installed",
    "user_message": "Show me all my installed MCP servers and their status",
    "expected_tool": "search_mcp",
    "expected_input_subset": { "installed": true }
  },
  {
    "id": "agent-create-basic",
    "user_message": "Create a Research Agent using gpt-4o",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "create", "name": "Research Agent", "model": "gpt-4o" },
    "must_not_contain": ["agent_config", "context_enhancement", "source", "version"]
  },
  {
    "id": "agent-create-with-mcp",
    "user_message": "Create a coding agent with github and filesystem MCP servers",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "create", "mcp_servers": ["github", "filesystem"] }
  },
  {
    "id": "agent-create-with-tool-filter",
    "user_message": "Create an agent with github MCP but only allow search_repos and get_file tools",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "create", "mcp_servers": ["github"], "mcp_tool_filter": { "github": ["search_repos", "get_file"] } }
  },
  {
    "id": "agent-create-no-memory",
    "user_message": "Create a simple calculator agent without memory",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "create", "memory_enabled": false }
  },
  {
    "id": "agent-create-from-library",
    "user_message": "Install PM Agent from the library",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "create", "name": "PM Agent", "from_library": true }
  },
  {
    "id": "agent-update-model",
    "user_message": "Change Research Agent's model to claude-sonnet-4-20250514",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "update", "name": "Research Agent", "model": "claude-sonnet-4-20250514" }
  },
  {
    "id": "agent-update-system-prompt",
    "user_message": "Update TestBot's system prompt to 'You are a helpful coding assistant'",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "update", "name": "TestBot", "system_prompt": "You are a helpful coding assistant" }
  },
  {
    "id": "agent-list",
    "user_message": "List all agents",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "list" }
  },
  {
    "id": "agent-set-primary",
    "user_message": "Set Research Agent as the default agent",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "set_primary", "name": "Research Agent" }
  },
  {
    "id": "agent-remove",
    "user_message": "Delete the old TestBot agent",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "remove", "name": "TestBot" }
  },
  {
    "id": "agent-status",
    "user_message": "Is the Research Agent configured?",
    "expected_tool": "manage_agents",
    "expected_input_subset": { "action": "status", "name": "Research Agent" }
  },
  {
    "id": "agent-search-library",
    "user_message": "What agents are available in the library?",
    "expected_tool": "search_agents",
    "expected_input_subset": {}
  },
  {
    "id": "skill-install-library",
    "user_message": "Install the code-review skill",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "install", "skill_names": ["code-review"], "source": "library" }
  },
  {
    "id": "skill-install-device",
    "user_message": "Install the skill from /Users/me/skills/custom.zip",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "install", "source": "device", "path": "/Users/me/skills/custom.zip" }
  },
  {
    "id": "skill-bind-specific",
    "user_message": "Bind the web-search skill to Research Agent",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "bind", "skill_names": ["web-search"], "agent_names": ["Research Agent"] }
  },
  {
    "id": "skill-bind-all",
    "user_message": "Apply the code-review skill to all agents",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "bind", "skill_names": ["code-review"], "all_agents": true }
  },
  {
    "id": "skill-unbind",
    "user_message": "Remove web-search skill from the Default agent",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "unbind", "skill_names": ["web-search"], "agent_names": ["Default"] }
  },
  {
    "id": "skill-uninstall",
    "user_message": "Uninstall old-skill",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "uninstall", "skill_names": ["old-skill"] }
  },
  {
    "id": "skill-search",
    "user_message": "Search for skills related to web scraping",
    "expected_tool": "search_skills",
    "expected_input_subset": { "query": "web scraping" }
  },
  {
    "id": "skill-install-multiple",
    "user_message": "Install web-search, code-review, and data-analysis skills",
    "expected_tool": "manage_skills",
    "expected_input_subset": { "action": "install", "skill_names": ["web-search", "code-review", "data-analysis"] }
  }
]
```

### 6.2 Eval Runner

```typescript
// scripts/eval-tool-calls.ts
import evalCases from '../facades/__tests__/__fixtures__/ai-eval-prompts.json';

async function runEval() {
  let pass = 0, fail = 0;
  const failures: any[] = [];

  for (const c of evalCases) {
    const toolCall = await simulateAIToolCall(c.user_message, availableTools);

    const toolMatch = toolCall.tool === c.expected_tool;
    const subsetMatch = isSubset(c.expected_input_subset, toolCall.input);
    const noForbidden = !(c.must_not_contain || []).some(f => JSON.stringify(toolCall.input).includes(f));

    if (toolMatch && subsetMatch && noForbidden) {
      pass++;
    } else {
      fail++;
      failures.push({ id: c.id, expected: c, actual: toolCall, toolMatch, subsetMatch, noForbidden });
    }
  }

  console.log(`\n✅ Pass: ${pass}/${evalCases.length} (${(pass/evalCases.length*100).toFixed(1)}%)`);
  console.log(`❌ Fail: ${fail}/${evalCases.length}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f.id}: tool=${f.actual.tool}, expected=${f.expected.expected_tool}`));
  }

  return pass / evalCases.length >= 0.95; // 95% threshold
}
```

---

## 7. Regression Matrix (Complete)

### 7.1 Functional Parity Checklist

| # | Capability | Old Tool | New Tool Equivalent | Test File | Status |
|---|---|---|---|---|---|
| 1 | Search skills (4 sources) | `search_skills({query})` | `search_skills({query})` (unchanged) | `searchSkillsTool.test.ts` | ✅ existing |
| 2 | Install skill from library | `apply_skill_to_agents({skill_name, source:"library"})` | `manage_skills({action:"install", skill_names:[x], source:"library"})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 3 | Install skill from device | `apply_skill_to_agents({skill_name, path, source:"device"})` | `manage_skills({action:"install", skill_names:[x], source:"device", path})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 4 | Bind skill to specific agents | `apply_skill_to_agents({skill_name, agent_names})` | `manage_skills({action:"bind", skill_names:[x], agent_names})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 5 | Bind skill to all agents | `apply_skill_to_agents({skill_name, apply_to_all:true})` | `manage_skills({action:"bind", skill_names:[x], all_agents:true})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 6 | Bind skill to current agent (default) | `apply_skill_to_agents({skill_name})` | `manage_skills({action:"bind", skill_names:[x]})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 7 | Unbind skill from agents | `remove_skills_from_agents({skill_names, agent_names})` | `manage_skills({action:"unbind", skill_names, agent_names})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 8 | Unbind skill from all agents | `remove_skills_from_agents({skill_names, remove_from_all:true})` | `manage_skills({action:"unbind", skill_names, all_agents:true})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 9 | Uninstall skills | `uninstall_skills({skill_names})` | `manage_skills({action:"uninstall", skill_names})` | `manageSkillsFacade.test.ts` | ⬜ new |
| 10 | Get MCP library template | `get_mcp_template_from_library({mcp_name})` | `search_mcp({query:name})` | `searchMcpFacade.test.ts` | ⬜ new |
| 11 | List installed MCP servers | `get_mcp_status({mcp_name})` (one-by-one) | `search_mcp({installed:true})` | `searchMcpFacade.test.ts` | ⬜ new |
| 12 | Create MCP (stdio, direct) | `create_mcp_server_from_config({mcp_config:{..stdio}})` | `manage_mcp({action:"add", transport:"stdio", command, args})` | `manageMcpFacade.test.ts` | ⬜ new |
| 13 | Create MCP (sse, direct) | `create_mcp_server_from_config({mcp_config:{..sse}})` | `manage_mcp({action:"add", transport:"sse", url})` | `manageMcpFacade.test.ts` | ⬜ new |
| 14 | Create MCP (StreamableHttp) | `create_mcp_server_from_config({mcp_config:{..http}})` | `manage_mcp({action:"add", transport:"StreamableHttp", url})` | `manageMcpFacade.test.ts` | ⬜ new |
| 15 | Create MCP (from library) | `get_template` + `create_from_config` | `manage_mcp({action:"add", from_library:true, env})` | `manageMcpFacade.test.ts` | ⬜ new |
| 16 | Update MCP config | `update_mcp_server({mcp_config:{name, ...}})` | `manage_mcp({action:"update", name, ...})` | `manageMcpFacade.test.ts` | ⬜ new |
| 17 | MCP status query | `get_mcp_status({mcp_name})` | `manage_mcp({action:"status", name})` | `manageMcpFacade.test.ts` | ⬜ new |
| 18 | MCP connect | `set_mcp_connection_state({name, action:"connect"})` | `manage_mcp({action:"connect", name})` | `manageMcpFacade.test.ts` | ⬜ new |
| 19 | MCP disconnect | `set_mcp_connection_state({name, action:"disconnect"})` | `manage_mcp({action:"disconnect", name})` | `manageMcpFacade.test.ts` | ⬜ new |
| 20 | MCP reconnect | `set_mcp_connection_state({name, action:"reconnect"})` | `manage_mcp({action:"reconnect", name})` | `manageMcpFacade.test.ts` | ⬜ new |
| 21 | Remove MCP | *(new capability)* | `manage_mcp({action:"remove", name})` | `manageMcpFacade.test.ts` | ⬜ new |
| 22 | Get agent library template | `get_agent_template_from_library({agent_name})` | `search_agents({query:name})` | `searchAgentsFacade.test.ts` | ⬜ new |
| 23 | List installed agents | `list_agents({})` | `manage_agents({action:"list"})` or `search_agents({installed:true})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 24 | Create agent (minimal) | `create_agent_from_config({name})` | `manage_agents({action:"create", name})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 25 | Create agent (full config) | `create_agent_from_config({name, model, mcp_servers, ...})` | `manage_agents({action:"create", name, model, mcp_servers, ...})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 26 | Create agent (from library) | `get_template` + `create_from_config` | `manage_agents({action:"create", from_library:true, ...overrides})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 27 | Update agent config | `update_agent({agent_config:{name, ...}})` | `manage_agents({action:"update", name, ...})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 28 | Agent status | `get_agent_status({agent_name})` | `manage_agents({action:"status", name})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 29 | Set primary agent | `set_primary_agent({agent_name})` | `manage_agents({action:"set_primary", name})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 30 | Remove agent | *(new capability)* | `manage_agents({action:"remove", name})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 31 | Agent memory toggle | `create/update({context_enhancement:{...}})` | `manage_agents({memory_enabled: bool})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 32 | Agent MCP tool filtering | `create/update({mcp_servers:[{name,tools}]})` | `manage_agents({mcp_servers, mcp_tool_filter})` | `manageAgentsFacade.test.ts` | ⬜ new |
| 33 | Agent knowledge base | `create/update({knowledgeBase})` or `({knowledge:{knowledgeBase}})` | `manage_agents({knowledge_base})` | `manageAgentsFacade.test.ts` | ⬜ new |

### 7.2 Error Handling Parity

| # | Error Scenario | Old Behavior | New Behavior (must match or improve) |
|---|---|---|---|
| 1 | stdio without command | Runtime error, cryptic message | Eager validation, clear message: "command is required for stdio transport" |
| 2 | sse without url | Runtime error | Eager validation: "url is required for sse/StreamableHttp transport" |
| 3 | Duplicate MCP name | Error from profileCache | Same error, passed through |
| 4 | Update non-existent server | Error from profileCache | Same error: "MCP server 'xxx' not found" |
| 5 | Update non-existent agent | Error from profileCache | Same error: "Agent 'xxx' not found" |
| 6 | Device skill without path | `SKILL_NOT_INSTALLED` at runtime | Eager validation: "path is required when source=device" |
| 7 | Uninstall non-existent skill | Error from skillManager | Same error: "skill 'xxx' not installed" |
| 8 | IN-LIBRARY→ON-DEVICE downgrade | Error from updateMcp | Same error (hidden from AI — facades never expose this path) |

---

## 8. Execution Commands

```bash
# Phase 0: Create baseline tests
npm test -- --run src/main/lib/mcpRuntime/builtinTools/__tests__/createMcpServerFromConfigTool.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/__tests__/updateMcpServerTool.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/__tests__/createAgentFromConfigTool.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/__tests__/applySkillToAgentsTool.test.ts

# Phase 1: Facade unit tests
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/manageMcpFacade.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/manageAgentsFacade.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/manageSkillsFacade.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/searchMcpFacade.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/searchAgentsFacade.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/inputValidation.test.ts

# Phase 2: Integration tests
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/manageMcpFacade.integration.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/manageAgentsFacade.integration.test.ts
npm test -- --run src/main/lib/mcpRuntime/builtinTools/facades/__tests__/manageSkillsFacade.integration.test.ts

# Phase 3: Shadow mode (during dev runs)
SHADOW_MODE=1 npm run dev

# Phase 4: AI eval
npx tsx scripts/eval-tool-calls.ts

# Full regression
npm test && npm run typecheck && npm run build:vite

# Capability parity check
npm test -- --run src/main/lib/mcpRuntime/builtinTools/__tests__/builtinToolsManager-capability-parity.test.ts
```

---

## 9. Definition of Done

| Metric | Threshold | Verification |
|---|---|---|
| Regression matrix (33 items) all pass | 100% | All ⬜ → ✅ |
| Shadow mode mismatches | 0 | CI gate + 1 week dev usage |
| Input validation coverage | 100% of boundary conditions | `inputValidation.test.ts` |
| AI tool-call accuracy (30+ eval cases) | ≥ 95% | `eval-tool-calls.ts` |
| `npm test` | All green | CI |
| `npm run typecheck` | 0 errors | CI |
| `npm run build:vite` | 0 errors | CI |
| No regression in existing `builtinToolsManager-*.test.ts` suites | All pass | CI |
| Legacy tools still functional during Phase 1-2 | Verified by routing tests | `builtinToolsManager-execute-routing.test.ts` |
