/**
 * BuiltinToolsManager — capability parity regression tests
 *
 * Purpose:
 * - document the legacy built-in tool capability surface before the naming refactor
 * - verify the current built-in tool inventory still covers the same full capability set
 * - allow renames and merges at the tool-name level while keeping total capability coverage aligned
 */

const {
  mockSchedulerEnabled,
  createMockTool,
} = vi.hoisted(() => {
  const flags = {
    mockSchedulerEnabled: { value: true },
  };
  const createMockTool = (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  });
  return { ...flags, createMockTool };
});

vi.mock('../../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn((name: string) => {
    if (name === 'openkosmosFeatureScheduler') return mockSchedulerEnabled.value;
    return true;
  }),
}));

vi.mock('../../../../../shared/constants/branding', async () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'openkosmos',
  BRAND_CONFIG: {},
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: {
    getCurrentUserAlias: vi.fn(() => 'alice'),
    isHooksEnabled: vi.fn(() => true),
    getBrowserSettings: vi.fn(() => ({ enabled: true })),
    getComputerUseSettings: vi.fn(() => ({ enabled: true })),
    getMemexSettings: vi.fn(() => ({ enabled: true })),
    getCodingAgentSettings: vi.fn(() => ({ enabled: true, cli: 'claude' })),
  },
}));

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
vi.mock('../requestInteractiveInputTool', async () => ({ RequestInteractiveInputTool: createMockTool('request_interactive_input') }));
vi.mock('../createAgentFromConfigTool', async () => ({ CreateAgentFromConfigTool: createMockTool('create_agent_from_config') }));
vi.mock('../updateAgentTool', async () => ({ UpdateAgentTool: createMockTool('update_agent') }));
vi.mock('../getAgentStatusTool', async () => ({ GetAgentStatusTool: createMockTool('get_agent_status') }));
vi.mock('../listAgentsTool', async () => ({ ListAgentsTool: createMockTool('list_agents') }));
vi.mock('../setPrimaryAgentTool', async () => ({ SetPrimaryAgentTool: createMockTool('set_primary_agent') }));
vi.mock('../moveFileTool', async () => ({ MoveFileTool: createMockTool('move_file') }));
vi.mock('../presentDeliverablesTool', async () => ({ PresentTool: createMockTool('present_deliverables') }));
vi.mock('../createScheduleTool', async () => ({ CreateScheduleTool: createMockTool('create_schedule') }));
vi.mock('../getScheduleTool', async () => ({ GetScheduleTool: createMockTool('get_schedule') }));
vi.mock('../updateScheduleTool', async () => ({ UpdateScheduleTool: createMockTool('update_schedule') }));
vi.mock('../runScheduleTool', async () => ({ RunScheduleTool: createMockTool('run_schedule') }));
vi.mock('../facades/manageSkillsFacade', async () => ({ ManageSkillsFacade: createMockTool('manage_skills') }));
vi.mock('../facades/manageMcpFacade', async () => ({ ManageMcpFacade: createMockTool('manage_mcp') }));
vi.mock('../facades/manageAgentsFacade', async () => ({ ManageAgentsFacade: createMockTool('manage_agents') }));
vi.mock('../facades/manageHooksFacade', async () => ({ ManageHooksFacade: createMockTool('manage_hooks') }));
vi.mock('../subAgentTool', async () => ({
  SubAgentTool: createMockTool('sub_agent'),
}));
vi.mock('../memexMemoryTool', async () => ({ MemexMemoryTool: createMockTool('memex_memory') }));

import { BuiltinToolsManager } from '../builtinToolsManager';

interface CapabilityGroup {
  capability: string;
  legacyTools: string[];
  currentTools: string[];
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  { capability: 'Workspace file reading', legacyTools: ['read_file'], currentTools: ['read_file'] },
  { capability: 'HTML content reading', legacyTools: ['read_html'], currentTools: ['read_html'] },
  { capability: 'Workspace file writing', legacyTools: ['write_file'], currentTools: ['write_file'] },
  { capability: 'File content search', legacyTools: ['search_text_in_files'], currentTools: ['search_file_contents'] },
  { capability: 'File path search', legacyTools: ['search_files'], currentTools: ['search_files'] },
  { capability: 'Command execution', legacyTools: ['execute_command'], currentTools: ['execute_command'] },
  { capability: 'Current date and time lookup', legacyTools: ['get_current_datetime'], currentTools: ['get_current_datetime'] },
  { capability: 'MCP management (add/update/remove/connect/disconnect/reconnect/status)', legacyTools: ['add_mcp_by_config', 'update_mcp_by_config', 'check_mcp_status', 'toggle_mcp_by_name'], currentTools: ['manage_mcp'] },
  { capability: 'Skill search across sources', legacyTools: ['search_skills'], currentTools: ['search_skills'] },
  { capability: 'Skill management (install/uninstall/bind/unbind)', legacyTools: ['install_skill_for_current_agent', 'apply_skill_to_agents', 'delete_skill', 'remove_skill_from_agent'], currentTools: ['manage_skills'] },
  { capability: 'Agent management (create/update/remove/list/set_primary/status)', legacyTools: ['add_agent_by_config', 'update_agent_by_config', 'check_agent_status', 'get_all_agents', 'set_primary_agent'], currentTools: ['manage_agents'] },
  { capability: 'Agent Hooks management', legacyTools: [], currentTools: ['manage_hooks'] },
  { capability: 'Workspace file move', legacyTools: ['move_file'], currentTools: ['move_file'] },
  { capability: 'Deliverables presentation', legacyTools: ['present_deliverables'], currentTools: ['present_deliverables'] },
  { capability: 'Schedule creation', legacyTools: ['create_schedule'], currentTools: ['create_schedule'] },
  { capability: 'Schedule lookup', legacyTools: ['get_schedule'], currentTools: ['get_schedule'] },
  { capability: 'Schedule update', legacyTools: ['edit_schedule'], currentTools: ['update_schedule'] },
  { capability: 'Schedule immediate execution', legacyTools: ['run_schedule'], currentTools: ['run_schedule'] },
  { capability: 'Bing web search', legacyTools: ['bing_web_search'], currentTools: ['bing_web_search'] },
  { capability: 'Bing image search', legacyTools: ['bing_image_search'], currentTools: ['bing_image_search'] },
  { capability: 'Web content fetch', legacyTools: ['fetch_web_content'], currentTools: ['fetch_web_content'] },
  { capability: 'Office document reading', legacyTools: ['read_office_file'], currentTools: ['read_office_file'] },
  { capability: 'File download to local path', legacyTools: ['download_and_save_as'], currentTools: ['download_file'] },
  { capability: 'Ad-hoc sub-agent delegation', legacyTools: [], currentTools: ['sub_agent'] },
  { capability: 'Interactive user input request', legacyTools: ['request_interactive_input'], currentTools: ['request_interactive_input'] },
  { capability: 'Background process management', legacyTools: ['manage_process'], currentTools: ['manage_process'] },
  { capability: 'Coding agent execution', legacyTools: ['coding_agent'], currentTools: ['coding_agent'] },
  { capability: 'Per-agent persistent long-term memory', legacyTools: [], currentTools: ['memex_memory'] },
  { capability: 'On-demand tool discovery', legacyTools: [], currentTools: ['tool_search'] },
  { capability: 'Embedded browser automation (navigate/screenshot/read/click/type/wait)', legacyTools: [], currentTools: ['browser'] },
  { capability: 'Real local desktop control (screenshot/click/type/hotkey/focus)', legacyTools: [], currentTools: ['computer_use'] },
  { capability: 'Background sub-agent status check', legacyTools: [], currentTools: ['get_subagent_status'] },
  { capability: 'Parent notification from sub-agent', legacyTools: [], currentTools: ['notify_parent'] },
  { capability: 'Parent-to-subagent messaging', legacyTools: [], currentTools: ['send_to_subagent'] },
];

const EXPECTED_CURRENT_TOOL_INVENTORY = Array.from(
  new Set(CAPABILITY_GROUPS.flatMap(group => group.currentTools))
).sort();

describe('BuiltinToolsManager — capability parity', () => {
  let manager: BuiltinToolsManager;

  beforeEach(() => {
    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
    mockSchedulerEnabled.value = true;
  });

  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  it('keeps every legacy capability mapped to one or more current providers', async () => {
    await manager.initialize();

    const registeredToolNames = new Set(manager.getAllToolsInfo().map(tool => tool.name));

    for (const group of CAPABILITY_GROUPS) {
      expect(group.currentTools.length).toBeGreaterThan(0);

      for (const toolName of group.currentTools) {
        expect(registeredToolNames.has(toolName)).toBe(true);
      }
    }
  });

  it('accounts for the complete current built-in tool inventory in the capability baseline', async () => {
    await manager.initialize();

    const actualToolInventory = manager.getAllToolsInfo().map(tool => tool.name).sort();

    expect(actualToolInventory).toEqual(EXPECTED_CURRENT_TOOL_INVENTORY);
  });
});
