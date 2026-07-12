/**
 * Additional coverage for BuiltinToolsManager:
 * - Static execution context methods
 * - Static deferred tools context methods
 * - getToolInfo, getStats, isBuiltinTool
 * - executeTool when not initialized
 * - resetInstance with no existing instance
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

const {
  profileCacheManagerMock,
  readFileToolMock,
  skillsConfigManagerMock,
} = vi.hoisted(() => {
  const profileCacheManagerMock = {
    getCachedProfile: vi.fn(),
    getChatConfig: vi.fn(),
    getCurrentUserAlias: vi.fn(() => 'alice'),
    isHooksEnabled: vi.fn(() => true),
    getBrowserSettings: vi.fn(() => ({ enabled: true })),
    getComputerUseSettings: vi.fn(() => ({ enabled: true })),
    getMemexSettings: vi.fn(() => ({ enabled: true })),
    getCodingAgentSettings: vi.fn(() => ({ enabled: true, cli: 'claude' })),
  };


  const skillsConfigManagerMock = {
    getSkills: vi.fn((): any[] => []),
    getSkill: vi.fn((): any => undefined),
    hasSkill: vi.fn(() => false),
  };

  const readFileToolMock = {
    getDefinition: () => ({
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn(),
  };

  return { profileCacheManagerMock, readFileToolMock, skillsConfigManagerMock };
});
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(os.tmpdir(), 'openkosmos-vitest-btm-coverage');
      return os.tmpdir();
    }),
  },
}));

vi.mock('../../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => false),
}));

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: profileCacheManagerMock,
}));

vi.mock('../../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: skillsConfigManagerMock,
}));


vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createConsoleLogger: () => Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../readFileTool', () => ({ ReadFileTool: readFileToolMock }));
vi.mock('../readHtmlTool', () => ({ ReadHtmlTool: { getDefinition: () => ({ name: 'read_html', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../writeFileTool', () => ({ WriteFileTool: { getDefinition: () => ({ name: 'write_file', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../searchFileContentsTool', () => ({ SearchFileContentsTool: { getDefinition: () => ({ name: 'search_file_contents', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../searchFilesTool', () => ({ SearchFilesTool: { getDefinition: () => ({ name: 'search_files', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../executeCommandTool', () => ({ ExecuteCommandTool: { getDefinition: () => ({ name: 'execute_command', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../getCurrentDateTimeTool', () => ({ GetCurrentDateTimeTool: { getDefinition: () => ({ name: 'get_current_datetime', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../requestInteractiveInputTool', () => ({ RequestInteractiveInputTool: { getDefinition: () => ({ name: 'request_interactive_input', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../createMcpServerFromConfigTool', () => ({ CreateMcpServerFromConfigTool: { getDefinition: () => ({ name: 'create_mcp_server_from_config', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../updateMcpServerTool', () => ({ UpdateMcpServerTool: { getDefinition: () => ({ name: 'update_mcp_server', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../getMcpStatusTool', () => ({ GetMcpStatusTool: { getDefinition: () => ({ name: 'get_mcp_status', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../searchSkillsTool', () => ({ SearchSkillsTool: { getDefinition: () => ({ name: 'search_skills', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../applySkillToAgentsTool', () => ({ ApplySkillToAgentsTool: { getDefinition: () => ({ name: 'apply_skill_to_agents', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../uninstallSkillsTool', () => ({ UninstallSkillsTool: { getDefinition: () => ({ name: 'uninstall_skills', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../removeSkillsFromAgentsTool', () => ({ RemoveSkillsFromAgentsTool: { getDefinition: () => ({ name: 'remove_skills_from_agents', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../createAgentFromConfigTool', () => ({ CreateAgentFromConfigTool: { getDefinition: () => ({ name: 'create_agent_from_config', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../updateAgentTool', () => ({ UpdateAgentTool: { getDefinition: () => ({ name: 'update_agent', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../getAgentStatusTool', () => ({ GetAgentStatusTool: { getDefinition: () => ({ name: 'get_agent_status', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../listAgentsTool', () => ({ ListAgentsTool: { getDefinition: () => ({ name: 'list_agents', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../setPrimaryAgentTool', () => ({ SetPrimaryAgentTool: { getDefinition: () => ({ name: 'set_primary_agent', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../moveFileTool', () => ({ MoveFileTool: { getDefinition: () => ({ name: 'move_file', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../presentDeliverablesTool', () => ({ PresentTool: { getDefinition: () => ({ name: 'present_deliverables', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../createScheduleTool', () => ({ CreateScheduleTool: { getDefinition: () => ({ name: 'create_schedule', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../getScheduleTool', () => ({ GetScheduleTool: { getDefinition: () => ({ name: 'get_schedule', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../updateScheduleTool', () => ({ UpdateScheduleTool: { getDefinition: () => ({ name: 'update_schedule', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../runScheduleTool', () => ({ RunScheduleTool: { getDefinition: () => ({ name: 'run_schedule', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../codingAgentTool', () => ({ CodingAgentTool: { getDefinition: () => ({ name: 'coding_agent', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../toolSearchTool', () => ({ ToolSearchTool: { getDefinition: () => ({ name: 'tool_search', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../facades/manageSkillsFacade', () => ({ ManageSkillsFacade: { getDefinition: () => ({ name: 'manage_skills', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../facades/manageMcpFacade', () => ({ ManageMcpFacade: { getDefinition: () => ({ name: 'manage_mcp', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../facades/manageAgentsFacade', () => ({ ManageAgentsFacade: { getDefinition: () => ({ name: 'manage_agents', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../facades/manageHooksFacade', () => ({ ManageHooksFacade: { getDefinition: () => ({ name: 'manage_hooks', inputSchema: {} }), execute: vi.fn() } }));
vi.mock('../../../../shared/constants/branding', () => ({ APP_NAME: 'OpenKosmos' }));

import { BuiltinToolsManager } from '../builtinToolsManager';

describe('BuiltinToolsManager — static context methods', () => {
  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.clearDeferredToolsContext('session-1');
  });

  it('set/get/clear execution context', () => {
    expect(BuiltinToolsManager.getExecutionContext()).toBeNull();

    const ctx = { userAlias: 'alice', chatId: 'chat-1', chatSessionId: 'sess-1' } as any;
    BuiltinToolsManager.setExecutionContext(ctx);
    expect(BuiltinToolsManager.getExecutionContext()).toBe(ctx);

    BuiltinToolsManager.clearExecutionContext();
    expect(BuiltinToolsManager.getExecutionContext()).toBeNull();
  });

  it('set/get/clear deferred tools context by sessionId', () => {
    expect(BuiltinToolsManager.getDeferredToolsContext('session-1')).toBeNull();
    expect(BuiltinToolsManager.getDeferredToolsContext(undefined)).toBeNull();

    const tools = [{ name: 'tool-a' }] as any;
    BuiltinToolsManager.setDeferredToolsContext('session-1', tools);
    expect(BuiltinToolsManager.getDeferredToolsContext('session-1')).toBe(tools);
    expect(BuiltinToolsManager.getDeferredToolsContext('session-2')).toBeNull();

    BuiltinToolsManager.clearDeferredToolsContext('session-1');
    expect(BuiltinToolsManager.getDeferredToolsContext('session-1')).toBeNull();
  });
});

describe('BuiltinToolsManager — query methods', () => {
  let manager: BuiltinToolsManager;

  beforeEach(async () => {
    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
    await manager.initialize();
  });

  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  it('getToolInfo returns info for existing tool', () => {
    const info = manager.getToolInfo('read_file');
    expect(info).toBeDefined();
    expect(info?.name).toBe('read_file');
    expect(info?.serverId).toBe('builtin');
  });

  it('getToolInfo returns undefined for missing tool', () => {
    const info = manager.getToolInfo('nonexistent_tool');
    expect(info).toBeUndefined();
  });

  it('getStats returns total tool count and isInitialized', () => {
    const stats = manager.getStats();
    expect(stats.isInitialized).toBe(true);
    expect(stats.totalTools).toBeGreaterThan(0);
    expect(Array.isArray(stats.tools)).toBe(true);
  });

  it('isBuiltinTool returns true for registered tool', () => {
    expect(manager.isBuiltinTool('read_file')).toBe(true);
  });

  it('isBuiltinTool returns false for unregistered tool', () => {
    expect(manager.isBuiltinTool('nonexistent_tool')).toBe(false);
  });

  it('getTool returns undefined for missing tool', () => {
    expect(manager.getTool('nonexistent_tool')).toBeUndefined();
  });

  it('getOpenAIToolDefinitions returns type=function entries', () => {
    const defs = manager.getOpenAIToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBeDefined();
  });

  it('getAllToolsInfo returns entries with serverId=builtin', () => {
    const infos = manager.getAllToolsInfo();
    expect(infos.length).toBeGreaterThan(0);
    expect(infos.every(i => i.serverId === 'builtin')).toBe(true);
  });
});

describe('BuiltinToolsManager — executeTool guards', () => {
  beforeEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  it('throws when executeTool called before initialize', async () => {
    const manager = BuiltinToolsManager.getInstance();
    await expect(manager.executeTool('read_file', {})).rejects.toThrow('not initialized');
  });

  it('returns error for unknown tool after initialization', async () => {
    const manager = BuiltinToolsManager.getInstance();
    await manager.initialize();
    await expect(manager.executeTool('nonexistent_tool', {})).rejects.toThrow('not found');
  });

  it('initialize is idempotent (calling twice does not throw)', async () => {
    const manager = BuiltinToolsManager.getInstance();
    await manager.initialize();
    await manager.initialize(); // second call should be a no-op
    expect(manager.getStats().isInitialized).toBe(true);
  });

  it('resetInstance when no instance exists is safe', () => {
    // Reset twice to ensure no crash when instance is null
    BuiltinToolsManager.resetInstance();
    expect(() => BuiltinToolsManager.resetInstance()).not.toThrow();
  });
});
