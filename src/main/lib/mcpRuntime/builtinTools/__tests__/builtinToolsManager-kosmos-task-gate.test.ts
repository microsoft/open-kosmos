/**
 * BuiltinToolsManager — verifies Task tools are gated for OpenKosmos brand.
 *
 * Task tools (create_user_task, update_user_task, list_user_tasks, delete_user_task)
 * should NOT be registered and should return an error when executed under the OpenKosmos brand.
 */

const { createMockTool } = vi.hoisted(() => {
  const createMockTool = (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ tool: name, ok: true }),
  });
  return { createMockTool };
});

// Mock branding as openkosmos
vi.mock('../../../../../shared/constants/branding', async () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'openkosmos',
  BRAND_CONFIG: {},
}));

vi.mock('../../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

// Mock all tool modules to prevent real imports
vi.mock('../readFileTool', async () => ({ ReadFileTool: createMockTool('read_file') }));
vi.mock('../readHtmlTool', async () => ({ ReadHtmlTool: createMockTool('read_html') }));
vi.mock('../writeFileTool', async () => ({ WriteFileTool: createMockTool('write_file') }));
vi.mock('../searchFileContentsTool', async () => ({ SearchFileContentsTool: createMockTool('search_file_contents') }));
vi.mock('../searchFilesTool', async () => ({ SearchFilesTool: createMockTool('search_files') }));
vi.mock('../executeCommandTool', async () => ({ ExecuteCommandTool: createMockTool('execute_command') }));
vi.mock('../getCurrentDateTimeTool', async () => ({ GetCurrentDateTimeTool: createMockTool('get_current_datetime') }));
vi.mock('../getMcpTemplateFromLibraryTool', async () => ({ GetMcpTemplateFromLibraryTool: createMockTool('get_mcp_template_from_library') }));
vi.mock('../getAgentTemplateFromLibraryTool', async () => ({ GetAgentTemplateFromLibraryTool: createMockTool('get_agent_template_from_library') }));
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
vi.mock('../presentTool', async () => ({ PresentTool: createMockTool('present_deliverables') }));
vi.mock('../createScheduleTool', async () => ({ CreateScheduleTool: createMockTool('create_schedule') }));
vi.mock('../getScheduleTool', async () => ({ GetScheduleTool: createMockTool('get_schedule') }));
vi.mock('../updateScheduleTool', async () => ({ UpdateScheduleTool: createMockTool('update_schedule') }));
vi.mock('../runScheduleTool', async () => ({ RunScheduleTool: createMockTool('run_schedule') }));
vi.mock('../createTeamsCalendarEventTool', async () => ({ CreateTeamsCalendarEventTool: createMockTool('create_teams_calendar_event') }));
vi.mock('../orgLookupTool', async () => ({ OrgLookupTool: createMockTool('org_lookup') }));
vi.mock('../createUserTaskTool', async () => ({ CreateUserTaskTool: createMockTool('create_user_task') }));
vi.mock('../updateUserTaskTool', async () => ({ UpdateUserTaskTool: createMockTool('update_user_task') }));
vi.mock('../listUserTasksTool', async () => ({ ListUserTasksTool: createMockTool('list_user_tasks') }));
vi.mock('../deleteUserTaskTool', async () => ({ DeleteUserTaskTool: createMockTool('delete_user_task') }));
vi.mock('../facades/manageSkillsFacade', async () => ({ ManageSkillsFacade: createMockTool('manage_skills') }));
vi.mock('../facades/manageMcpFacade', async () => ({ ManageMcpFacade: createMockTool('manage_mcp') }));
vi.mock('../facades/manageAgentsFacade', async () => ({ ManageAgentsFacade: createMockTool('manage_agents') }));
vi.mock('../facades/searchMcpFacade', async () => ({ SearchMcpFacade: createMockTool('search_mcp') }));
vi.mock('../facades/searchAgentsFacade', async () => ({ SearchAgentsFacade: createMockTool('search_agents') }));
vi.mock('../toolSearchTool', async () => ({
  ToolSearchTool: {
    getDefinition: () => ({ name: 'tool_search', description: 'Mock', inputSchema: { type: 'object', properties: {} } }),
    execute: vi.fn().mockReturnValue({ tool: 'tool_search', ok: true }),
  },
}));
vi.mock('../codingAgentTool', async () => ({ CodingAgentTool: createMockTool('coding_agent') }));
vi.mock('../azureCliExecuteTool', async () => ({ AzureCliExecuteTool: createMockTool('azure_cli_execute') }));

// Lazy-loaded heavy tools
vi.mock('../bingWebSearchTool', async () => ({ BingWebSearchTool: createMockTool('bing_web_search') }));
vi.mock('../bingImageSearchTool', async () => ({ BingImageSearchTool: createMockTool('bing_image_search') }));
vi.mock('../fetchWebContentTool', async () => ({ FetchWebContentTool: createMockTool('fetch_web_content') }));
vi.mock('../readOfficeFileTool', async () => ({ ReadOfficeFileTool: createMockTool('read_office_file') }));
vi.mock('../downloadFileTool', async () => ({ DownloadFileTool: createMockTool('download_file') }));
vi.mock('../setMcpConnectionStateTool', async () => ({ SetMcpConnectionStateTool: createMockTool('set_mcp_connection_state') }));
vi.mock('../readSharePointDocumentTool', async () => ({ ReadSharePointDocumentTool: createMockTool('read_sharepoint_document') }));
vi.mock('../searchSharePointDocumentsTool', async () => ({ SearchSharePointDocumentsTool: createMockTool('search_sharepoint_documents') }));
vi.mock('../listTeamsChatsTool', async () => ({ ListTeamsChatsTool: createMockTool('list_teams_chats') }));
vi.mock('../readTeamsChatTool', async () => ({ ReadTeamsChatTool: createMockTool('read_teams_chat') }));
vi.mock('../listOutlookEmailsTool', async () => ({ ListOutlookEmailsTool: createMockTool('list_outlook_emails') }));
vi.mock('../readOutlookEmailTool', async () => ({ ReadOutlookEmailTool: createMockTool('read_outlook_email') }));
vi.mock('../listTeamsCalendarEventsTool', async () => ({ ListTeamsCalendarEventsTool: createMockTool('list_teams_calendar_events') }));
vi.mock('../readTeamsCalendarEventTool', async () => ({ ReadTeamsCalendarEventTool: createMockTool('read_teams_calendar_event') }));
vi.mock('../listTeamsChannelsTool', async () => ({ ListTeamsChannelsTool: createMockTool('list_teams_channels') }));
vi.mock('../readTeamsChannelMessagesTool', async () => ({ ReadTeamsChannelMessagesTool: createMockTool('read_teams_channel_messages') }));
vi.mock('../searchTeamsUsersTool', async () => ({ SearchTeamsUsersTool: createMockTool('search_teams_users') }));
vi.mock('../sendTeamsMessageTool', async () => ({ SendTeamsMessageTool: createMockTool('send_teams_message') }));
vi.mock('../sendOutlookEmailTool', async () => ({ SendOutlookEmailTool: createMockTool('send_outlook_email') }));
vi.mock('../downloadTeamsImageTool', async () => ({ DownloadTeamsImageTool: createMockTool('download_teams_image') }));
vi.mock('../getMeetingTranscriptTool', async () => ({ GetMeetingTranscriptTool: createMockTool('get_meeting_transcript') }));
vi.mock('../manageRemoteChannelTool', async () => ({ ManageRemoteChannelTool: createMockTool('manage_remote_channel') }));
vi.mock('../spawnSubAgentTool', async () => ({ SpawnSubAgentTool: createMockTool('spawn_subagent') }));
vi.mock('../spawnSubagentsTool', async () => ({ SpawnSubagentsTool: createMockTool('spawn_subagents') }));
vi.mock('../manageProcessTool', async () => ({ ManageProcessTool: createMockTool('manage_process') }));

import { BuiltinToolsManager } from '../builtinToolsManager';

const TASK_TOOLS = ['create_user_task', 'update_user_task', 'list_user_tasks', 'delete_user_task'];

describe('BuiltinToolsManager — OpenKosmos brand task tool gating', () => {
  let manager: BuiltinToolsManager;

  beforeEach(() => {
    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
  });

  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  it('does not register task tools under openkosmos brand', async () => {
    await manager.initialize();

    const registeredTools = manager.getAllToolsInfo().map(t => t.name);
    for (const toolName of TASK_TOOLS) {
      expect(registeredTools).not.toContain(toolName);
    }
  });

  it.each(TASK_TOOLS)('rejects execution of %s under openkosmos brand', async (toolName) => {
    await manager.initialize();

    await expect(manager.executeTool(toolName, {})).rejects.toThrow(/not found/i);
  });
});
