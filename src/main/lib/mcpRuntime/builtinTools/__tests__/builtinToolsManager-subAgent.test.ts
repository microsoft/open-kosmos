/**
 * BuiltinToolsManager — Sub-Agent tools unit tests
 *
 * Covers always-registered sub_agent and inline-dispatched sub-agent tools.
 */

// ─── Mock all tool modules to avoid heavy dependencies ───

const { createMockTool, mockSubAgentManager } = vi.hoisted(() => ({
  createMockTool: (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  }),
  mockSubAgentManager: {
    getBackgroundTaskStatus: vi.fn().mockReturnValue({ running: [], completed: [], failed: [] }),
    handleNotification: vi.fn(),
    sendMessageToSubAgent: vi.fn().mockReturnValue({ success: true }),
    getInstance: vi.fn(),
  },
}));

vi.mock('../../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

// Mock all lightweight tool imports with minimal stubs
// Tools use static getDefinition() for registration and static execute() for execution

vi.mock('../readFileTool', async () => ({ ReadFileTool: createMockTool('read_file') }));
vi.mock('../readHtmlTool', async () => ({ ReadHtmlTool: createMockTool('read_html') }));
vi.mock('../writeFileTool', async () => ({ WriteFileTool: createMockTool('write_file') }));
vi.mock('../searchFileContentsTool', async () => ({ SearchFileContentsTool: createMockTool('search_file_contents') }));
vi.mock('../searchFilesTool', async () => ({ SearchFilesTool: createMockTool('search_files') }));
vi.mock('../executeCommandTool', async () => ({ ExecuteCommandTool: createMockTool('execute_command') }));
vi.mock('../getCurrentDateTimeTool', async () => ({ GetCurrentDateTimeTool: createMockTool('get_current_datetime') }));
vi.mock('../createMcpServerFromConfigTool', async () => ({ CreateMcpServerFromConfigTool: createMockTool('create_mcp_server_from_config') }));
vi.mock('../updateMcpServerTool', async () => ({ UpdateMcpServerTool: createMockTool('update_mcp_server') }));
vi.mock('../getMcpStatusTool', async () => ({ GetMcpStatusTool: createMockTool('get_mcp_status') }));
vi.mock('../searchSkillsTool', async () => ({ SearchSkillsTool: createMockTool('search_skills') }));
vi.mock('../applySkillToAgentsTool', async () => ({ ApplySkillToAgentsTool: createMockTool('apply_skill_to_agents') }));
vi.mock('../uninstallSkillsTool', async () => ({ UninstallSkillsTool: createMockTool('uninstall_skills') }));
vi.mock('../removeSkillsFromAgentsTool', async () => ({ RemoveSkillsFromAgentsTool: createMockTool('remove_skills_from_agents') }));
vi.mock('../createAgentFromConfigTool', async () => ({ CreateAgentFromConfigTool: createMockTool('create_agent_from_config') }));
vi.mock('../updateAgentTool', async () => ({ UpdateAgentTool: createMockTool('update_agent') }));
vi.mock('../getAgentStatusTool', async () => ({ GetAgentStatusTool: createMockTool('get_agent_status') }));
vi.mock('../listAgentsTool', async () => ({ ListAgentsTool: createMockTool('list_agents') }));
vi.mock('../setPrimaryAgentTool', async () => ({ SetPrimaryAgentTool: createMockTool('set_primary_agent') }));
vi.mock('../moveFileTool', async () => ({ MoveFileTool: createMockTool('move_file') }));
vi.mock('../presentDeliverablesTool', async () => ({ PresentTool: createMockTool('present_deliverables') }));

// Mock SubAgentManager for inline-dispatched tool tests
mockSubAgentManager.getInstance.mockReturnValue(mockSubAgentManager);
vi.mock('../../../subAgent/subAgentManager', async () => ({
  SubAgentManager: mockSubAgentManager,
}));

// Mock lazy-loaded sub-agent tool
vi.mock('../subAgentTool', async () => ({
  SubAgentTool: {
    getDefinition: () => ({
      name: 'sub_agent',
      description: 'Launch a sub-agent to handle a task.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task' },
          run_in_background: { type: 'boolean', description: 'Run in background' },
        },
        required: ['prompt'],
      },
    }),
    execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sub-agent spawned' }] }),
  },
}));

import { BuiltinToolsManager } from '../builtinToolsManager';

// ─── Tests ───

describe('BuiltinToolsManager — Sub-Agent tools', () => {
  let manager: BuiltinToolsManager;

  beforeEach(() => {
    // Reset singleton and create fresh instance for each test
    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
  });

  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.resetInstance();
    mockSubAgentManager.getBackgroundTaskStatus.mockClear();
    mockSubAgentManager.handleNotification.mockClear();
    mockSubAgentManager.sendMessageToSubAgent.mockClear();
  });

  // ─── Tool Registration ───

  describe('tool registration (initialize)', () => {
    it('should register sub_agent', async () => {
      await manager.initialize();

      expect(manager.hasTool('sub_agent')).toBe(true);
      expect(manager.hasTool('get_subagent_status')).toBe(true);
    });

    it('should still register other tools', async () => {
      await manager.initialize();

      // Core tools should still be registered
      expect(manager.hasTool('read_file')).toBe(true);
      expect(manager.hasTool('write_file')).toBe(true);
      expect(manager.hasTool('execute_command')).toBe(true);
      expect(manager.hasTool('get_current_datetime')).toBe(true);
      expect(manager.hasTool('search_files')).toBe(true);
      expect(manager.hasTool('search_file_contents')).toBe(true);
    });

  });

  // ─── OpenAI Tool Definitions ───

  describe('getOpenAIToolDefinitions', () => {
    it('should always include sub_agent in OpenAI definitions', async () => {
      await manager.initialize();

      const definitions = manager.getOpenAIToolDefinitions();
      const toolNames = definitions.map((d: any) => d.function.name);

      expect(toolNames).toContain('sub_agent');
    });
  });

  // ─── getAllToolsInfo (MCP format) ───

  describe('getAllToolsInfo', () => {
    it('should always include sub_agent in MCP info', async () => {
      await manager.initialize();

      const toolsInfo = manager.getAllToolsInfo();
      const toolNames = toolsInfo.map(t => t.name);

      expect(toolNames).toContain('sub_agent');
    });
  });

  // ─── Tool Execution ───

  describe('executeTool — sub_agent', () => {
    it('should execute sub_agent successfully', async () => {
      await manager.initialize();

      const result = await manager.executeTool('sub_agent', {
        prompt: 'test task',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should execute adhoc sub_agent', async () => {
      await manager.initialize();

      const result = await manager.executeTool('sub_agent', {
        prompt: 'test task',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const innerResult = JSON.parse(result.data);
      expect(innerResult.isError).toBeFalsy();
    });
  });

  // ─── Tool schema validation ───

  describe('sub_agent tool schema', () => {
    it('sub_agent should expose ad-hoc schema', async () => {
      await manager.initialize();

      const tool = manager.getTool('sub_agent');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.inputSchema.required).toContain('prompt');
      expect(tool!.inputSchema.properties).toHaveProperty('prompt');
      expect(tool!.inputSchema.properties).toHaveProperty('run_in_background');
    });
  });

  // ─── isBuiltinTool ───

  describe('isBuiltinTool', () => {
    it('should always return true for sub_agent', async () => {
      await manager.initialize();

      expect(manager.isBuiltinTool('sub_agent')).toBe(true);
    });
  });

  // ─── getStats ───

  describe('getStats', () => {
    it('should always include sub_agent in stats', async () => {
      await manager.initialize();

      const stats = manager.getStats();
      expect(stats.tools).toContain('sub_agent');
    });
  });

  // ─── Inline-dispatched sub-agent tools ───

  describe('get_subagent_status execution', () => {
    it('should return error when no execution context is set', async () => {
      await manager.initialize();
      BuiltinToolsManager.clearExecutionContext();

      const result = await manager.executeTool('get_subagent_status', {});
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(true);
      expect(inner.content[0].text).toContain('No execution context');
    });

    it('should return background task status when context is set', async () => {
      await manager.initialize();
      BuiltinToolsManager.setExecutionContext({
        userAlias: 'alice', chatId: 'c1', chatSessionId: 'sess-1',
      } as any);

      const result = await manager.executeTool('get_subagent_status', {});
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(false);
      expect(mockSubAgentManager.getBackgroundTaskStatus).toHaveBeenCalledWith('sess-1');
    });
  });

  describe('notify_parent execution', () => {
    it('should return error when no execution context is set', async () => {
      await manager.initialize();
      BuiltinToolsManager.clearExecutionContext();

      const result = await manager.executeTool('notify_parent', { message: 'hi' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(true);
      expect(inner.content[0].text).toContain('No execution context');
    });

    it('should return error when called from a non-sub-agent context', async () => {
      await manager.initialize();
      BuiltinToolsManager.setExecutionContext({
        userAlias: 'alice', chatId: 'c1', chatSessionId: 'sess-1', isSubAgent: false,
      } as any);

      const result = await manager.executeTool('notify_parent', { message: 'hi' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(true);
      expect(inner.content[0].text).toContain('only be called from within a sub-agent');
    });

    it('should send notification when called from a sub-agent context', async () => {
      await manager.initialize();
      BuiltinToolsManager.setExecutionContext({
        userAlias: 'alice', chatId: 'c1', chatSessionId: 'sess-1',
        isSubAgent: true, currentToolCallId: 'tool-42',
      } as any);

      const result = await manager.executeTool('notify_parent', { message: 'done', type: 'success' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(false);
      expect(mockSubAgentManager.handleNotification).toHaveBeenCalledWith('sess-1', expect.objectContaining({
        taskId: 'tool-42',
        type: 'success',
        message: 'done',
      }));
    });
  });

  describe('send_to_subagent execution', () => {
    it('should return error when no execution context is set', async () => {
      await manager.initialize();
      BuiltinToolsManager.clearExecutionContext();

      const result = await manager.executeTool('send_to_subagent', { task_id: 't1', message: 'go' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(true);
      expect(inner.content[0].text).toContain('No execution context');
    });

    it('should return error when called from a sub-agent context', async () => {
      await manager.initialize();
      BuiltinToolsManager.setExecutionContext({
        userAlias: 'alice', chatId: 'c1', chatSessionId: 'sess-1', isSubAgent: true,
      } as any);

      const result = await manager.executeTool('send_to_subagent', { task_id: 't1', message: 'go' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(true);
      expect(inner.content[0].text).toContain('only be called by the parent agent');
    });

    it('should deliver message when called from parent context', async () => {
      await manager.initialize();
      BuiltinToolsManager.setExecutionContext({
        userAlias: 'alice', chatId: 'c1', chatSessionId: 'sess-1', isSubAgent: false,
      } as any);
      mockSubAgentManager.sendMessageToSubAgent.mockReturnValue({ success: true });

      const result = await manager.executeTool('send_to_subagent', { task_id: 't1', message: 'go' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(false);
      expect(inner.content[0].text).toContain('Message delivered');
    });

    it('should return error when send fails', async () => {
      await manager.initialize();
      BuiltinToolsManager.setExecutionContext({
        userAlias: 'alice', chatId: 'c1', chatSessionId: 'sess-1', isSubAgent: false,
      } as any);
      mockSubAgentManager.sendMessageToSubAgent.mockReturnValue({ success: false, error: 'Task not found' });

      const result = await manager.executeTool('send_to_subagent', { task_id: 't1', message: 'go' });
      expect(result.success).toBe(true);
      const inner = JSON.parse(result.data);
      expect(inner.isError).toBe(true);
      expect(inner.content[0].text).toContain('Task not found');
    });
  });
});
