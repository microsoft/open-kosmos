/**
 * BuiltinToolsManager — Sub-Agent Feature Flag unit tests
 *
 * Covers Phase 4 Step 4.2:
 * - flag=true: spawn_subagent / spawn_subagents tools are registered normally
 * - flag=false: spawn_subagent / spawn_subagents tools are not registered
 * - flag=false: executeTool returns disabled error (defensive check)
 * - Other tools are not affected by the flag
 */

// ─── Mock all tool modules to avoid heavy dependencies ───

const { createMockTool } = vi.hoisted(() => ({
  createMockTool: (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  }),
}));

// Mock featureFlags — mutable flag for per-test toggling
let mockSubAgentFeatureEnabled = true;
vi.mock('../../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn((name: string) => {
    if (name === 'openkosmosFeatureSubAgent') return mockSubAgentFeatureEnabled;
    if (name === 'browserControl') return true;
    return true;
  }),
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

// Mock lazy-loaded sub-agent tool
vi.mock('../subAgentTool', async () => ({
  SubAgentTool: {
    getDefinition: () => ({
      name: 'sub_agent',
      description: 'Mock sub_agent',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task' },
          subagent_type: { type: 'string', description: 'Named agent type' },
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

describe('BuiltinToolsManager — Sub-Agent Feature Flag', () => {
  let manager: BuiltinToolsManager;

  beforeEach(() => {
    // Reset singleton and create fresh instance for each test
    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
    // Reset default flag state
    mockSubAgentFeatureEnabled = true;
  });

  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  // ─── Tool Registration ───

  describe('tool registration (initialize)', () => {
    it('should always register sub_agent regardless of flag', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      expect(manager.hasTool('sub_agent')).toBe(true);
      expect(manager.hasTool('get_subagent_status')).toBe(true);
    });

    it('should still register other tools when sub-agent flag is disabled', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      // Core tools should still be registered
      expect(manager.hasTool('read_file')).toBe(true);
      expect(manager.hasTool('write_file')).toBe(true);
      expect(manager.hasTool('execute_command')).toBe(true);
      expect(manager.hasTool('get_current_datetime')).toBe(true);
      expect(manager.hasTool('search_files')).toBe(true);
      expect(manager.hasTool('search_file_contents')).toBe(true);
    });

    it('should have same tool count regardless of sub-agent flag', async () => {
      mockSubAgentFeatureEnabled = true;
      await manager.initialize();
      const enabledCount = manager.getAllTools().length;

      // Reset and re-initialize with flag disabled
      BuiltinToolsManager.resetInstance();
      manager = BuiltinToolsManager.getInstance();
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();
      const disabledCount = manager.getAllTools().length;

      // sub_agent tools are always registered now
      expect(enabledCount).toBe(disabledCount);
    });
  });

  // ─── OpenAI Tool Definitions ───

  describe('getOpenAIToolDefinitions', () => {
    it('should always include sub_agent in OpenAI definitions', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      const definitions = manager.getOpenAIToolDefinitions();
      const toolNames = definitions.map((d: any) => d.function.name);

      expect(toolNames).toContain('sub_agent');
    });
  });

  // ─── getAllToolsInfo (MCP format) ───

  describe('getAllToolsInfo', () => {
    it('should always include sub_agent in MCP info', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      const toolsInfo = manager.getAllToolsInfo();
      const toolNames = toolsInfo.map(t => t.name);

      expect(toolNames).toContain('sub_agent');
    });
  });

  // ─── Tool Execution (defensive guard) ───

  describe('executeTool — defensive feature flag guard', () => {
    it('should execute sub_agent successfully when flag is enabled', async () => {
      mockSubAgentFeatureEnabled = true;
      await manager.initialize();

      const result = await manager.executeTool('sub_agent', {
        prompt: 'test task',
        subagent_type: 'test-agent',
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should return disabled error for named sub_agent when flag is disabled at execution time', async () => {
      mockSubAgentFeatureEnabled = true;
      await manager.initialize();

      // Then disable at execution time (defensive guard)
      mockSubAgentFeatureEnabled = false;
      const result = await manager.executeTool('sub_agent', {
        prompt: 'test task',
        subagent_type: 'test-agent',
      });

      expect(result.success).toBe(true);
      const innerResult = JSON.parse(result.data);
      expect(innerResult.isError).toBe(true);
      expect(innerResult.content[0].text).toContain('Named Sub-Agent feature is disabled');
    });

    it('should execute adhoc sub_agent even when flag is disabled', async () => {
      mockSubAgentFeatureEnabled = false;
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
    it('sub_agent should have correct input schema', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      const tool = manager.getTool('sub_agent');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.type).toBe('object');
      expect(tool!.inputSchema.required).toContain('prompt');
      expect(tool!.inputSchema.properties).toHaveProperty('prompt');
      expect(tool!.inputSchema.properties).toHaveProperty('subagent_type');
      expect(tool!.inputSchema.properties).toHaveProperty('run_in_background');
    });
  });

  // ─── isBuiltinTool ───

  describe('isBuiltinTool', () => {
    it('should always return true for sub_agent', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      expect(manager.isBuiltinTool('sub_agent')).toBe(true);
    });
  });

  // ─── getStats ───

  describe('getStats', () => {
    it('should always include sub_agent in stats', async () => {
      mockSubAgentFeatureEnabled = false;
      await manager.initialize();

      const stats = manager.getStats();
      expect(stats.tools).toContain('sub_agent');
    });
  });
});
