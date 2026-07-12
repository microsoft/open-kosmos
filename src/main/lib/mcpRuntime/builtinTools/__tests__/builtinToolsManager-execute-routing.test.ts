/**
 * BuiltinToolsManager — executeTool routing regression tests
 *
 * Purpose:
 * - verify every currently registered built-in tool has a working executeTool dispatch path
 * - catch regressions where a tool remains registered but its executeTool branch is missing or miswired
 */

const {
  mockSchedulerEnabled,
  mockAgentHooksEnabled,
  mockComputerUsePlatformSupported,
  mockComputerUseUnsupportedReason,
  createMockTool,
  readFileToolMock,
  readHtmlToolMock,
  writeFileToolMock,
  searchFileContentsToolMock,
  searchFilesToolMock,
  executeCommandToolMock,
  getCurrentDateTimeToolMock,
  createMcpServerFromConfigToolMock,
  updateMcpServerToolMock,
  getMcpStatusToolMock,
  searchSkillsToolMock,
  applySkillToAgentsToolMock,
  uninstallSkillsToolMock,
  removeSkillsFromAgentsToolMock,
  requestInteractiveInputToolMock,
  createAgentFromConfigToolMock,
  updateAgentToolMock,
  getAgentStatusToolMock,
  listAgentsToolMock,
  setPrimaryAgentToolMock,
  moveFileToolMock,
  presentToolMock,
  createScheduleToolMock,
  getScheduleToolMock,
  updateScheduleToolMock,
  runScheduleToolMock,
  bingWebSearchToolMock,
  bingImageSearchToolMock,
  fetchWebContentToolMock,
  readOfficeFileToolMock,
  downloadFileToolMock,
  setMcpConnectionStateToolMock,
  subAgentToolMock,
  manageProcessToolMock,
  codingAgentToolMock,
  browserToolMock,
  computerUseToolMock,
  memexMemoryToolMock,
  toolSearchToolMock,
  manageSkillsFacadeMock,
  manageMcpFacadeMock,
  manageAgentsFacadeMock,
  manageHooksFacadeMock,
} = vi.hoisted(() => {
  const flags = {
    mockSchedulerEnabled: { value: true },
    mockAgentHooksEnabled: { value: true },
    mockComputerUsePlatformSupported: { value: true },
    mockComputerUseUnsupportedReason: { value: null as string | null },
  };

  const createMockTool = (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ tool: name, ok: true }),
  });

  return {
    ...flags,
    createMockTool,
    readFileToolMock: createMockTool('read_file'),
    readHtmlToolMock: createMockTool('read_html'),
    writeFileToolMock: createMockTool('write_file'),
    searchFileContentsToolMock: createMockTool('search_file_contents'),
    searchFilesToolMock: createMockTool('search_files'),
    executeCommandToolMock: createMockTool('execute_command'),
    getCurrentDateTimeToolMock: createMockTool('get_current_datetime'),
    createMcpServerFromConfigToolMock: createMockTool('create_mcp_server_from_config'),
    updateMcpServerToolMock: createMockTool('update_mcp_server'),
    getMcpStatusToolMock: createMockTool('get_mcp_status'),
    searchSkillsToolMock: createMockTool('search_skills'),
    applySkillToAgentsToolMock: createMockTool('apply_skill_to_agents'),
    uninstallSkillsToolMock: createMockTool('uninstall_skills'),
    removeSkillsFromAgentsToolMock: createMockTool('remove_skills_from_agents'),
    requestInteractiveInputToolMock: createMockTool('request_interactive_input'),
    createAgentFromConfigToolMock: createMockTool('create_agent_from_config'),
    updateAgentToolMock: createMockTool('update_agent'),
    getAgentStatusToolMock: createMockTool('get_agent_status'),
    listAgentsToolMock: createMockTool('list_agents'),
    setPrimaryAgentToolMock: createMockTool('set_primary_agent'),
    moveFileToolMock: createMockTool('move_file'),
    presentToolMock: createMockTool('present_deliverables'),
    createScheduleToolMock: createMockTool('create_schedule'),
    getScheduleToolMock: createMockTool('get_schedule'),
    updateScheduleToolMock: createMockTool('update_schedule'),
    runScheduleToolMock: createMockTool('run_schedule'),
    bingWebSearchToolMock: createMockTool('bing_web_search'),
    bingImageSearchToolMock: createMockTool('bing_image_search'),
    fetchWebContentToolMock: createMockTool('fetch_web_content'),
    readOfficeFileToolMock: createMockTool('read_office_file'),
    downloadFileToolMock: createMockTool('download_file'),
    setMcpConnectionStateToolMock: createMockTool('set_mcp_connection_state'),
    subAgentToolMock: createMockTool('sub_agent'),
    manageProcessToolMock: createMockTool('manage_process'),
    codingAgentToolMock: createMockTool('coding_agent'),
    browserToolMock: createMockTool('browser'),
    computerUseToolMock: createMockTool('computer_use'),
    memexMemoryToolMock: createMockTool('memex_memory'),
    toolSearchToolMock: {
      getDefinition: () => ({
        name: 'tool_search',
        description: 'Mock tool_search',
        inputSchema: { type: 'object', properties: {} },
      }),
      // tool_search is synchronous — use mockReturnValue, not mockResolvedValue
      execute: vi.fn().mockReturnValue({ tool: 'tool_search', ok: true }),
    },
    manageSkillsFacadeMock: createMockTool('manage_skills'),
    manageMcpFacadeMock: createMockTool('manage_mcp'),
    manageAgentsFacadeMock: createMockTool('manage_agents'),
    manageHooksFacadeMock: createMockTool('manage_hooks'),
  };
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
    getChatConfig: vi.fn(() => ({ agent_ids: ['agent-captured'], agent: { id: 'agent-captured', name: 'Captured Agent' } })),
    getCurrentUserAlias: vi.fn(() => 'alice'),
    isHooksEnabled: vi.fn(() => mockAgentHooksEnabled.value),
    getBrowserSettings: vi.fn(() => ({ enabled: true })),
    getComputerUseSettings: vi.fn(() => ({ enabled: true })),
    getMemexSettings: vi.fn(() => ({ enabled: true })),
    getCodingAgentSettings: vi.fn(() => ({ enabled: true, cli: 'claude' })),
  },
}));

vi.mock('../../../computerUse/platformSupport', async () => ({
  isComputerUsePlatformSupported: vi.fn(() => mockComputerUsePlatformSupported.value),
  getComputerUseUnsupportedReason: vi.fn(() => mockComputerUseUnsupportedReason.value),
}));

vi.mock('../readFileTool', async () => ({ ReadFileTool: readFileToolMock }));
vi.mock('../readHtmlTool', async () => ({ ReadHtmlTool: readHtmlToolMock }));
vi.mock('../writeFileTool', async () => ({ WriteFileTool: writeFileToolMock }));
vi.mock('../searchFileContentsTool', async () => ({ SearchFileContentsTool: searchFileContentsToolMock }));
vi.mock('../searchFilesTool', async () => ({ SearchFilesTool: searchFilesToolMock }));
vi.mock('../executeCommandTool', async () => ({ ExecuteCommandTool: executeCommandToolMock }));
vi.mock('../getCurrentDateTimeTool', async () => ({ GetCurrentDateTimeTool: getCurrentDateTimeToolMock }));
vi.mock('../createMcpServerFromConfigTool', async () => ({ CreateMcpServerFromConfigTool: createMcpServerFromConfigToolMock }));
vi.mock('../updateMcpServerTool', async () => ({ UpdateMcpServerTool: updateMcpServerToolMock }));
vi.mock('../getMcpStatusTool', async () => ({ GetMcpStatusTool: getMcpStatusToolMock }));
vi.mock('../searchSkillsTool', async () => ({ SearchSkillsTool: searchSkillsToolMock }));
vi.mock('../applySkillToAgentsTool', async () => ({ ApplySkillToAgentsTool: applySkillToAgentsToolMock }));
vi.mock('../uninstallSkillsTool', async () => ({ UninstallSkillsTool: uninstallSkillsToolMock }));
vi.mock('../removeSkillsFromAgentsTool', async () => ({ RemoveSkillsFromAgentsTool: removeSkillsFromAgentsToolMock }));
vi.mock('../createAgentFromConfigTool', async () => ({ CreateAgentFromConfigTool: createAgentFromConfigToolMock }));
vi.mock('../updateAgentTool', async () => ({ UpdateAgentTool: updateAgentToolMock }));
vi.mock('../getAgentStatusTool', async () => ({ GetAgentStatusTool: getAgentStatusToolMock }));
vi.mock('../listAgentsTool', async () => ({ ListAgentsTool: listAgentsToolMock }));
vi.mock('../setPrimaryAgentTool', async () => ({ SetPrimaryAgentTool: setPrimaryAgentToolMock }));
vi.mock('../moveFileTool', async () => ({ MoveFileTool: moveFileToolMock }));
vi.mock('../presentDeliverablesTool', async () => ({ PresentTool: presentToolMock }));
vi.mock('../createScheduleTool', async () => ({ CreateScheduleTool: createScheduleToolMock }));
vi.mock('../getScheduleTool', async () => ({ GetScheduleTool: getScheduleToolMock }));
vi.mock('../updateScheduleTool', async () => ({ UpdateScheduleTool: updateScheduleToolMock }));
vi.mock('../runScheduleTool', async () => ({ RunScheduleTool: runScheduleToolMock }));

vi.mock('../bingWebSearchTool', async () => ({ BingWebSearchTool: bingWebSearchToolMock }));
vi.mock('../bingImageSearchTool', async () => ({ BingImageSearchTool: bingImageSearchToolMock }));
vi.mock('../fetchWebContentTool', async () => ({ FetchWebContentTool: fetchWebContentToolMock }));
vi.mock('../readOfficeFileTool', async () => ({ ReadOfficeFileTool: readOfficeFileToolMock }));
vi.mock('../downloadFileTool', async () => ({ DownloadFileTool: downloadFileToolMock }));
vi.mock('../setMcpConnectionStateTool', async () => ({ SetMcpConnectionStateTool: setMcpConnectionStateToolMock }));
vi.mock('../subAgentTool', async () => ({
  SubAgentTool: subAgentToolMock,
}));
vi.mock('../requestInteractiveInputTool', async () => ({ RequestInteractiveInputTool: requestInteractiveInputToolMock }));
vi.mock('../manageProcessTool', async () => ({ ManageProcessTool: manageProcessToolMock }));
vi.mock('../codingAgentTool', async () => ({ CodingAgentTool: codingAgentToolMock }));
vi.mock('../embeddedBrowserTool', async () => ({ EmbeddedBrowserTool: browserToolMock }));
vi.mock('../computerUseTool', async () => ({ ComputerUseTool: computerUseToolMock }));
vi.mock('../memexMemoryTool', async () => ({ MemexMemoryTool: memexMemoryToolMock }));
vi.mock('../toolSearchTool', async () => ({ ToolSearchTool: toolSearchToolMock }));
vi.mock('../facades/manageSkillsFacade', async () => ({ ManageSkillsFacade: manageSkillsFacadeMock }));
vi.mock('../facades/manageMcpFacade', async () => ({ ManageMcpFacade: manageMcpFacadeMock }));
vi.mock('../facades/manageAgentsFacade', async () => ({ ManageAgentsFacade: manageAgentsFacadeMock }));
vi.mock('../facades/manageHooksFacade', async () => ({ ManageHooksFacade: manageHooksFacadeMock }));

import { BuiltinToolsManager } from '../builtinToolsManager';
import { CancellationTokenStatic } from '../../../cancellation';
import type { ToolExecutionContext } from '../../../subAgent/types';

interface RoutingCase {
  toolName: string;
  args: Record<string, unknown>;
  executeMock: Mock;
  expectsArgs?: boolean;
  executionContext?: ToolExecutionContext;
}

const MAIN_AGENT_CONTEXT: ToolExecutionContext = {
  userAlias: 'alice',
  chatId: 'chat-a',
  chatSessionId: 'session-a',
  cancellationToken: CancellationTokenStatic.None,
  isSubAgent: false,
  interactionPolicy: 'allow-ui',
  getParentContextSummary: async () => '',
};

const ROUTING_CASES: RoutingCase[] = [
  { toolName: 'read_file', args: { filePath: '/tmp/demo.txt' }, executeMock: readFileToolMock.execute },
  { toolName: 'read_html', args: { filePath: '/tmp/demo.html' }, executeMock: readHtmlToolMock.execute },
  { toolName: 'write_file', args: { filePath: '/tmp/out.txt', content: 'demo' }, executeMock: writeFileToolMock.execute },
  { toolName: 'search_file_contents', args: { description: 'search', patterns: ['demo'], workspaceRoot: '/tmp' }, executeMock: searchFileContentsToolMock.execute },
  { toolName: 'search_files', args: { path: '/tmp', pattern: 'demo' }, executeMock: searchFilesToolMock.execute },
  { toolName: 'execute_command', args: { command: 'pwd' }, executeMock: executeCommandToolMock.execute },
  { toolName: 'get_current_datetime', args: {}, executeMock: getCurrentDateTimeToolMock.execute },
  { toolName: 'search_skills', args: { query: 'code review' }, executeMock: searchSkillsToolMock.execute },
  { toolName: 'request_interactive_input', args: { prompt: 'test' }, executeMock: requestInteractiveInputToolMock.execute },
  { toolName: 'manage_skills', args: { action: 'install', skill_names: ['demo-skill'] }, executeMock: manageSkillsFacadeMock.execute },
  { toolName: 'manage_mcp', args: { action: 'status', name: 'demo' }, executeMock: manageMcpFacadeMock.execute },
  { toolName: 'manage_agents', args: { action: 'list' }, executeMock: manageAgentsFacadeMock.execute },
  { toolName: 'manage_hooks', args: { action: 'list' }, executeMock: manageHooksFacadeMock.execute },
  { toolName: 'move_file', args: { sourcePath: '/tmp/a', targetPath: '/tmp/b' }, executeMock: moveFileToolMock.execute },
  { toolName: 'present_deliverables', args: { summary: 'done' }, executeMock: presentToolMock.execute },
  { toolName: 'create_schedule', args: { name: 'demo', description: 'demo', schedule_type: 'once', run_at: '2026-03-25T12:00:00Z', message: 'hello' }, executeMock: createScheduleToolMock.execute },
  { toolName: 'get_schedule', args: { description: 'demo' }, executeMock: getScheduleToolMock.execute },
  { toolName: 'update_schedule', args: { description: 'demo', job_id: 'job-1' }, executeMock: updateScheduleToolMock.execute },
  { toolName: 'run_schedule', args: { job_id: 'job-1' }, executeMock: runScheduleToolMock.execute },
  { toolName: 'bing_web_search', args: { description: 'demo', queries: ['openkosmos'], lang: 'en', locale: 'us' }, executeMock: bingWebSearchToolMock.execute },
  { toolName: 'bing_image_search', args: { description: 'demo', queries: ['openkosmos'] }, executeMock: bingImageSearchToolMock.execute },
  { toolName: 'fetch_web_content', args: { description: 'demo', urls: ['https://example.com'] }, executeMock: fetchWebContentToolMock.execute },
  { toolName: 'read_office_file', args: { filePath: '/tmp/demo.docx' }, executeMock: readOfficeFileToolMock.execute },
  { toolName: 'download_file', args: { url: 'https://example.com/demo.txt', filename: 'demo.txt' }, executeMock: downloadFileToolMock.execute },
  { toolName: 'sub_agent', args: { prompt: 'research something' }, executeMock: subAgentToolMock.execute },
  { toolName: 'manage_process', args: { action: 'list' }, executeMock: manageProcessToolMock.execute },
  { toolName: 'coding_agent', args: { task: 'demo task', cwd: '/tmp' }, executeMock: codingAgentToolMock.execute },
  { toolName: 'browser', args: { action: 'read_page' }, executeMock: browserToolMock.execute },
  { toolName: 'computer_use', args: { action: 'screenshot' }, executeMock: computerUseToolMock.execute, executionContext: MAIN_AGENT_CONTEXT },
  { toolName: 'tool_search', args: { query: 'test' }, executeMock: toolSearchToolMock.execute },
];

// Internal-only tools: routed by executeTool() but not in getAllToolsInfo()
const INTERNAL_ROUTING_CASES: RoutingCase[] = [
  { toolName: 'create_mcp_server_from_config', args: { name: 'demo', config: {} }, executeMock: createMcpServerFromConfigToolMock.execute },
  { toolName: 'create_agent_from_config', args: { name: 'demo', config: {} }, executeMock: createAgentFromConfigToolMock.execute },
  { toolName: 'list_agents', args: {}, executeMock: listAgentsToolMock.execute, expectsArgs: false },
];

const ALL_ROUTING_CASES = [...ROUTING_CASES, ...INTERNAL_ROUTING_CASES];

// These tools are dispatched inline (not via separate tool classes) and tested separately
const INLINE_DISPATCHED_TOOLS = ['get_subagent_status', 'notify_parent', 'send_to_subagent', 'memex_memory'];

const EXPECTED_TOOL_INVENTORY = Array.from(new Set([
  ...ROUTING_CASES.map(item => item.toolName),
  ...INLINE_DISPATCHED_TOOLS,
])).sort();

describe('BuiltinToolsManager — executeTool routing', () => {
  let manager: BuiltinToolsManager;

  beforeEach(() => {
    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
    mockSchedulerEnabled.value = true;
    mockAgentHooksEnabled.value = true;
    mockComputerUsePlatformSupported.value = true;
    mockComputerUseUnsupportedReason.value = null;

    for (const entry of ALL_ROUTING_CASES) {
      entry.executeMock.mockClear();
    }
  });

  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  it('covers the complete current built-in tool inventory with routing cases', async () => {
    await manager.initialize();

    const actualToolInventory = manager.getAllToolsInfo().map(tool => tool.name).sort();

    expect(actualToolInventory).toEqual(EXPECTED_TOOL_INVENTORY);
  });

  it.each(ALL_ROUTING_CASES)('routes $toolName through executeTool to the expected implementation', async ({ toolName, args, executeMock, expectsArgs = true, executionContext }) => {
    await manager.initialize();

    const result = await manager.executeTool(toolName, args, undefined, 'session_1', executionContext);

    expect(result.success).toBe(true);
    expect(executeMock).toHaveBeenCalledTimes(1);
    if (expectsArgs) {
      // Network-IO tools receive (args, { signal }) while local tools receive just (args)
      const call = executeMock.mock.calls[0];
      expect(call[0]).toEqual(args);
    } else {
      expect(executeMock).toHaveBeenCalledWith();
    }

    expect(result.data).toBe(JSON.stringify({ tool: toolName, ok: true }));
  });

  it('blocks computer_use execution from sub-agent contexts', async () => {
    await manager.initialize();
    const subAgentContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: true,
    } as any;

    const result = await manager.executeTool('computer_use', { action: 'screenshot' }, undefined, 'session-a', subAgentContext);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.data)).toMatchObject({
      ok: false,
      error: expect.stringContaining('unavailable to sub-agents'),
    });
    expect(computerUseToolMock.execute).not.toHaveBeenCalled();
  });

  it('blocks computer_use execution without an explicit agent execution context', async () => {
    await manager.initialize();

    const result = await manager.executeTool('computer_use', { action: 'screenshot' }, undefined, 'session-a');

    expect(result.success).toBe(true);
    expect(JSON.parse(result.data)).toMatchObject({
      ok: false,
      error: expect.stringContaining('active main-agent execution context'),
    });
    expect(computerUseToolMock.execute).not.toHaveBeenCalled();
  });

  it('blocks computer_use direct calls even if a static execution context is present', async () => {
    await manager.initialize();
    BuiltinToolsManager.setExecutionContext(MAIN_AGENT_CONTEXT);

    try {
      const result = await manager.executeTool('computer_use', { action: 'screenshot' }, undefined, 'session-a');

      expect(JSON.parse(result.data)).toMatchObject({
        ok: false,
        error: expect.stringContaining('active main-agent execution context'),
      });
      expect(computerUseToolMock.execute).not.toHaveBeenCalled();
    } finally {
      BuiltinToolsManager.clearExecutionContext();
    }
  });

  it('blocks computer_use execution when runtime interaction policy forbids UI', async () => {
    await manager.initialize();
    const nonInteractiveContext: ToolExecutionContext = {
      ...MAIN_AGENT_CONTEXT,
      interactionPolicy: 'forbid',
    };

    const result = await manager.executeTool('computer_use', { action: 'screenshot' }, undefined, 'session-a', nonInteractiveContext);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.data)).toMatchObject({
      ok: false,
      error: expect.stringContaining('non-interactive runs'),
    });
    expect(computerUseToolMock.execute).not.toHaveBeenCalled();
  });

  it('hides computer_use from inventory on unsupported platforms', async () => {
    mockComputerUsePlatformSupported.value = false;
    await manager.initialize();

    const actualToolInventory = manager.getAllToolsInfo().map(tool => tool.name);

    expect(actualToolInventory).not.toContain('computer_use');
  });

  it('blocks computer_use execution on unsupported platforms', async () => {
    mockComputerUseUnsupportedReason.value = 'Computer Use is unavailable on Windows ARM64.';
    await manager.initialize();

    const result = await manager.executeTool('computer_use', { action: 'screenshot' }, undefined, 'session-a', MAIN_AGENT_CONTEXT);

    expect(JSON.parse(result.data)).toEqual({
      ok: false,
      error: 'Computer Use is unavailable on Windows ARM64.',
    });
    expect(computerUseToolMock.execute).not.toHaveBeenCalled();
  });

  it('returns error immediately when signal is already aborted', async () => {
    await manager.initialize();
    const controller = new AbortController();
    controller.abort();

    const result = await manager.executeTool('get_current_datetime', { description: 'test' }, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abort/i);
  });

  it('passes signal through to tool execute method', async () => {
    await manager.initialize();
    const controller = new AbortController();

    await manager.executeTool('write_file', { description: 'test', filePath: '/tmp/a', content: 'x' }, controller.signal);

    const call = writeFileToolMock.execute.mock.calls[0];
    expect(call[0]).toEqual({ description: 'test', filePath: '/tmp/a', content: 'x' });
    expect(call[1]).toEqual({ signal: controller.signal });
  });

  it('passes signal through to execute_command tool', async () => {
    await manager.initialize();
    const controller = new AbortController();
    const capturedContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: false,
      cancellationToken: { isCancellationRequested: false },
      getParentContextSummary: vi.fn(),
    } as any;

    await manager.executeTool(
      'execute_command',
      { description: 'test', command: 'echo hi' },
      controller.signal,
      undefined,
      capturedContext,
    );

    const call = executeCommandToolMock.execute.mock.calls[0];
    expect(call[0]).toEqual({ description: 'test', command: 'echo hi' });
    expect(call[1]).toEqual({ signal: controller.signal, executionContext: capturedContext });
  });

  it('routes fetch_web_content with the captured execution context for body progress', async () => {
    await manager.initialize();
    const controller = new AbortController();
    const capturedContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: false,
      reportActivity: vi.fn(),
    } as any;
    const args = { description: 'fetch docs', urls: ['https://example.com/docs'] };

    const result = await manager.executeTool('fetch_web_content', args, controller.signal, 'session-a', capturedContext);

    expect(result.success).toBe(true);
    expect(fetchWebContentToolMock.execute).toHaveBeenCalledWith(
      args,
      { signal: controller.signal, executionContext: capturedContext },
    );
  });

  it('routes sub_agent with the captured execution context instead of the mutable static context', async () => {
    await manager.initialize();
    const controller = new AbortController();
    const capturedContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: false,
      reportActivity: vi.fn(),
    } as any;
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'bob',
      chatId: 'chat-b',
      chatSessionId: 'session-b',
      isSubAgent: false,
    } as any);
    const args = { prompt: 'research something' };

    const result = await manager.executeTool('sub_agent', args, controller.signal, 'session-a', capturedContext);

    expect(result.success).toBe(true);
    expect(subAgentToolMock.execute).toHaveBeenCalledWith(
      args,
      { signal: controller.signal, executionContext: capturedContext },
    );
  });

  it('routes memex_memory with the captured execution context instead of the mutable static context', async () => {
    await manager.initialize();
    const capturedContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: false,
    } as any;
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'bob',
      chatId: 'chat-b',
      chatSessionId: 'session-b',
      isSubAgent: false,
    } as any);

    const result = await manager.executeTool(
      'memex_memory',
      { operation: 'recall', description: 'recall memory' },
      undefined,
      'session-a',
      capturedContext,
    );

    expect(result.success).toBe(true);
    expect(memexMemoryToolMock.execute).toHaveBeenCalledWith(
      { operation: 'recall', description: 'recall memory' },
      expect.objectContaining({ userAlias: 'alice', agentId: 'agent-captured', chatId: 'chat-a', agentName: 'Captured Agent' }),
    );
  });

  it('routes manage_hooks with the same captured alias used for the Hooks gate', async () => {
    await manager.initialize();
    const capturedContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: false,
    } as any;
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'bob',
      chatId: 'chat-b',
      chatSessionId: 'session-b',
      isSubAgent: false,
    } as any);

    const result = await manager.executeTool(
      'manage_hooks',
      { action: 'list' },
      undefined,
      'session-a',
      capturedContext,
    );

    expect(result.success).toBe(true);
    expect(manageHooksFacadeMock.execute).toHaveBeenCalledWith(
      { action: 'list' },
      { userAlias: 'alice' },
    );
  });

  it('routes create_schedule with the captured execution context instead of the mutable static context', async () => {
    await manager.initialize();
    const capturedContext = {
      userAlias: 'alice',
      chatId: 'chat-a',
      chatSessionId: 'session-a',
      isSubAgent: false,
    } as any;
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'bob',
      chatId: 'chat-b',
      chatSessionId: 'session-b',
      isSubAgent: false,
    } as any);

    const args = {
      name: 'demo',
      description: 'demo',
      run_at: '2026-03-25T12:00:00Z',
      message: 'hello',
    };
    const result = await manager.executeTool('create_schedule', args, undefined, 'session-a', capturedContext);

    expect(result.success).toBe(true);
    expect(createScheduleToolMock.execute).toHaveBeenCalledWith(args, { executionContext: capturedContext });
  });

  it('hides manage_hooks from public inventories while keeping stale execution recoverable', async () => {
    mockAgentHooksEnabled.value = false;
    await manager.initialize();

    expect(manager.hasTool('manage_hooks')).toBe(true);
    expect(manager.getTool('manage_hooks')).toBeUndefined();
    expect(manager.getToolInfo('manage_hooks')).toBeUndefined();
    expect(manager.getAllTools().map(tool => tool.name)).not.toContain('manage_hooks');
    expect(manager.getAllToolsInfo().map(tool => tool.name)).not.toContain('manage_hooks');
    expect(manager.getOpenAIToolDefinitions().map(tool => tool.function.name)).not.toContain('manage_hooks');
    expect(manager.getStats().totalTools).toBe(manager.getAllToolsInfo().length);

    const result = await manager.executeTool('manage_hooks', { action: 'list' }, undefined, 'session_1');

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.data ?? '{}');
    expect(payload.isError).toBe(true);
    expect(payload.content[0].text).toContain('manage_hooks tool is disabled');
    expect(manageHooksFacadeMock.execute).not.toHaveBeenCalled();
  });
});
