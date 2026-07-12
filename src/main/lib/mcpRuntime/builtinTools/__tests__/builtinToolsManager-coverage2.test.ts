/**
 * builtinToolsManager-coverage2.test.ts
 *
 * Targets uncovered branches/lines:
 * - feature/app gates (coding_agent, browser) — disabled branches
 * - sub-agent routing branches
 * - 982-986: get_subagent_status null context
 * - 992-1008: notify_parent null context + !isSubAgent branch + success branch
 * - 1010-1024: send_to_subagent null context + isSubAgent branch + success/failure branches
 * - 1026: unknown tool → throws → caught as error
 * - 1041: catch block with non-Error throw (String(error))
 * - 1205: getBuiltinToolsManager exported function
 */

import * as os from 'os';
import * as path from 'path';

// ─── hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockBrowserFeatureEnabled,
  subAgentManagerMock,
  profileCacheManagerMock,
  readFileToolMock,
  codingAgentToolMock,
  moveFileToolMock,
  skillsConfigManagerMock,
} = vi.hoisted(() => {
  const flags = {
    mockBrowserFeatureEnabled: { value: true },
  };

  const subAgentManagerMock = {
    getBackgroundTaskStatus: vi.fn().mockReturnValue({ tasks: [] }),
    handleNotification: vi.fn(),
    sendMessageToSubAgent: vi.fn().mockReturnValue({ success: true }),
  };

  const profileCacheManagerMock = {
    getCachedProfile: vi.fn(),
    getChatConfig: vi.fn(),
    getCurrentUserAlias: vi.fn(() => 'alice'),
    isHooksEnabled: vi.fn(() => true),
    getBrowserSettings: vi.fn(() => ({ enabled: mockBrowserFeatureEnabled.value })),
    getComputerUseSettings: vi.fn(() => ({ enabled: false })),
    getMemexSettings: vi.fn(() => ({ enabled: true })),
    getCodingAgentSettings: vi.fn(() => ({ enabled: true, cli: 'claude' })),
  };

  const skillsConfigManagerMock = {
    getSkills: vi.fn((): any[] => []),
    getSkill: vi.fn((): any => undefined),
    hasSkill: vi.fn(() => false),
  };

  const createMockTool = (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ tool: name, ok: true }),
  });

  const readFileToolMock = createMockTool('read_file');
  const codingAgentToolMock = createMockTool('coding_agent');
  const moveFileToolMock = createMockTool('move_file');

  return {
    ...flags,
    subAgentManagerMock,
    profileCacheManagerMock,
    readFileToolMock,
    codingAgentToolMock,
    moveFileToolMock,
    skillsConfigManagerMock,
  };
});

// ─── module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../../featureFlags', () => ({
  isFeatureEnabled: vi.fn(() => true),
}));

// Brand = openkosmos so user task tools are gated
vi.mock('../../../../../shared/constants/branding', () => ({
  APP_NAME: 'OpenKosmos',
  BRAND_NAME: 'openkosmos',
  BRAND_CONFIG: {},
}));

vi.mock('../../../subAgent/subAgentManager', () => ({
  SubAgentManager: {
    getInstance: () => subAgentManagerMock,
  },
}));

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: profileCacheManagerMock,
}));

vi.mock('../../../userDataADO/skillsConfigManager', () => ({
  skillsConfigManager: skillsConfigManagerMock,
}));

// The embedded-browser tool gate now reads the per-profile `browser.enabled`
// switch via profileCacheManager (mocked above). The memex_memory tool is gated
// by the per-profile `memex.enabled` switch the same way — keep it enabled so it
// stays in the advertised inventory.
vi.mock('../../../userDataADO/appCacheManager', () => ({
  appCacheManager: {
    getConfig: vi.fn(() => ({ browser: { enabled: mockBrowserFeatureEnabled.value }, memex: { enabled: true } })),
    getBrowserSettings: vi.fn(() => ({ enabled: mockBrowserFeatureEnabled.value })),
    getMemexSettings: vi.fn(() => ({ enabled: true })),
  },
}));

vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  createConsoleLogger: () => Promise.resolve({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Tool mocks
vi.mock('../readFileTool', () => ({ ReadFileTool: readFileToolMock }));
vi.mock('../readHtmlTool', () => ({ ReadHtmlTool: { getDefinition: () => ({ name: 'read_html', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../writeFileTool', () => ({ WriteFileTool: { getDefinition: () => ({ name: 'write_file', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../searchFileContentsTool', () => ({ SearchFileContentsTool: { getDefinition: () => ({ name: 'search_file_contents', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../searchFilesTool', () => ({ SearchFilesTool: { getDefinition: () => ({ name: 'search_files', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../executeCommandTool', () => ({ ExecuteCommandTool: { getDefinition: () => ({ name: 'execute_command', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../getCurrentDateTimeTool', () => ({ GetCurrentDateTimeTool: { getDefinition: () => ({ name: 'get_current_datetime', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../requestInteractiveInputTool', () => ({ RequestInteractiveInputTool: { getDefinition: () => ({ name: 'request_interactive_input', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../createMcpServerFromConfigTool', () => ({ CreateMcpServerFromConfigTool: { getDefinition: () => ({ name: 'create_mcp_server_from_config', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../updateMcpServerTool', () => ({ UpdateMcpServerTool: { getDefinition: () => ({ name: 'update_mcp_server', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../getMcpStatusTool', () => ({ GetMcpStatusTool: { getDefinition: () => ({ name: 'get_mcp_status', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../searchSkillsTool', () => ({ SearchSkillsTool: { getDefinition: () => ({ name: 'search_skills', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../applySkillToAgentsTool', () => ({ ApplySkillToAgentsTool: { getDefinition: () => ({ name: 'apply_skill_to_agents', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../uninstallSkillsTool', () => ({ UninstallSkillsTool: { getDefinition: () => ({ name: 'uninstall_skills', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../removeSkillsFromAgentsTool', () => ({ RemoveSkillsFromAgentsTool: { getDefinition: () => ({ name: 'remove_skills_from_agents', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../createAgentFromConfigTool', () => ({ CreateAgentFromConfigTool: { getDefinition: () => ({ name: 'create_agent_from_config', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../updateAgentTool', () => ({ UpdateAgentTool: { getDefinition: () => ({ name: 'update_agent', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../getAgentStatusTool', () => ({ GetAgentStatusTool: { getDefinition: () => ({ name: 'get_agent_status', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../listAgentsTool', () => ({ ListAgentsTool: { getDefinition: () => ({ name: 'list_agents', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../setPrimaryAgentTool', () => ({ SetPrimaryAgentTool: { getDefinition: () => ({ name: 'set_primary_agent', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../moveFileTool', () => ({ MoveFileTool: moveFileToolMock }));
vi.mock('../presentDeliverablesTool', () => ({ PresentTool: { getDefinition: () => ({ name: 'present_deliverables', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../createScheduleTool', () => ({ CreateScheduleTool: { getDefinition: () => ({ name: 'create_schedule', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../getScheduleTool', () => ({ GetScheduleTool: { getDefinition: () => ({ name: 'get_schedule', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../updateScheduleTool', () => ({ UpdateScheduleTool: { getDefinition: () => ({ name: 'update_schedule', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../runScheduleTool', () => ({ RunScheduleTool: { getDefinition: () => ({ name: 'run_schedule', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../codingAgentTool', () => ({ CodingAgentTool: codingAgentToolMock }));
vi.mock('../embeddedBrowserTool', () => ({ EmbeddedBrowserTool: { getDefinition: () => ({ name: 'browser', inputSchema: {} }), execute: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('../toolSearchTool', () => ({ ToolSearchTool: { getDefinition: () => ({ name: 'tool_search', inputSchema: {} }), execute: vi.fn().mockReturnValue({ ok: true }) } }));
vi.mock('../facades/manageSkillsFacade', () => ({ ManageSkillsFacade: { getDefinition: () => ({ name: 'manage_skills', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../facades/manageMcpFacade', () => ({ ManageMcpFacade: { getDefinition: () => ({ name: 'manage_mcp', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../facades/manageAgentsFacade', () => ({ ManageAgentsFacade: { getDefinition: () => ({ name: 'manage_agents', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../facades/manageHooksFacade', () => ({ ManageHooksFacade: { getDefinition: () => ({ name: 'manage_hooks', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../subAgentTool', () => ({ SubAgentTool: { getDefinition: () => ({ name: 'sub_agent', inputSchema: { type: 'object', properties: { prompt: {}, run_in_background: {} }, required: ['prompt'] } }), execute: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }) } }));
vi.mock('../manageProcessTool', () => ({ ManageProcessTool: { getDefinition: () => ({ name: 'manage_process', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../bingWebSearchTool', () => ({ BingWebSearchTool: { getDefinition: () => ({ name: 'bing_web_search', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../bingImageSearchTool', () => ({ BingImageSearchTool: { getDefinition: () => ({ name: 'bing_image_search', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../fetchWebContentTool', () => ({ FetchWebContentTool: { getDefinition: () => ({ name: 'fetch_web_content', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../readOfficeFileTool', () => ({ ReadOfficeFileTool: { getDefinition: () => ({ name: 'read_office_file', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../downloadFileTool', () => ({ DownloadFileTool: { getDefinition: () => ({ name: 'download_file', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('../setMcpConnectionStateTool', () => ({ SetMcpConnectionStateTool: { getDefinition: () => ({ name: 'set_mcp_connection_state', inputSchema: {} }), execute: vi.fn().mockResolvedValue({}) } }));
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(os.tmpdir(), 'openkosmos-vitest-btm-cov2');
      return os.tmpdir();
    }),
  },
}));

// ─── imports ─────────────────────────────────────────────────────────────────

import { BuiltinToolsManager, getBuiltinToolsManager } from '../builtinToolsManager';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function freshManager(): Promise<BuiltinToolsManager> {
  BuiltinToolsManager.resetInstance();
  const m = BuiltinToolsManager.getInstance();
  await m.initialize();
  return m;
}

// ─── feature-flag disabled branches ──────────────────────────────────────────

describe('BuiltinToolsManager — feature-flag disabled branches', () => {
  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.resetInstance();
    mockBrowserFeatureEnabled.value = true;
    profileCacheManagerMock.getCodingAgentSettings.mockReturnValue({ enabled: true, cli: 'claude' });
  });

  it('coding_agent: delegates to CodingAgentTool when the profile master switch is on', async () => {
    const manager = await freshManager();
    const result = await manager.executeTool('coding_agent', { task: 'demo', cwd: '/tmp' });
    expect(result.success).toBe(true);
    expect(codingAgentToolMock.execute).toHaveBeenCalled();
  });

  it('coding_agent: checks and forwards the captured execution context', async () => {
    profileCacheManagerMock.getCurrentUserAlias.mockReturnValue('bob');
    (profileCacheManagerMock.getCodingAgentSettings as Mock).mockImplementation((alias: string) => ({ enabled: alias === 'alice', cli: 'gemini' }));
    const manager = await freshManager();
    const capturedContext = { userAlias: 'alice', chatId: 'chat-1', chatSessionId: 'session-1' } as any;

    const result = await manager.executeTool('coding_agent', { task: 'demo', cwd: '/tmp' }, undefined, undefined, capturedContext);

    expect(result.success).toBe(true);
    expect(profileCacheManagerMock.getCodingAgentSettings).toHaveBeenCalledWith('alice');
    expect(codingAgentToolMock.execute).toHaveBeenCalledWith(
      { task: 'demo', cwd: '/tmp' },
      { signal: undefined, executionContext: capturedContext },
    );
  });

  it('coding_agent: returns isError when the profile master switch is off', async () => {
    profileCacheManagerMock.getCodingAgentSettings.mockReturnValue({ enabled: false, cli: 'claude' });
    const manager = await freshManager();
    const result = await manager.executeTool('coding_agent', { task: 'demo', cwd: '/tmp' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('Settings → Coding CLI');
  });

  it('coding_agent: hidden from the advertised inventory when the profile master switch is off', async () => {
    profileCacheManagerMock.getCodingAgentSettings.mockReturnValue({ enabled: false, cli: 'claude' });
    const manager = await freshManager();
    const names = manager.getAllToolsInfo().map((t) => t.name);
    expect(names).not.toContain('coding_agent');
  });

  it('coding_agent: appears in the advertised inventory when the profile master switch is on', async () => {
    profileCacheManagerMock.getCodingAgentSettings.mockReturnValue({ enabled: true, cli: 'claude' });
    const manager = await freshManager();
    const names = manager.getAllToolsInfo().map((t) => t.name);
    expect(names).toContain('coding_agent');
  });

  it('browser: returns disabled result when app-level browser.enabled is off at exec time', async () => {
    // Enable for registration, disable for execution
    mockBrowserFeatureEnabled.value = true;
    const manager = await freshManager();
    mockBrowserFeatureEnabled.value = false;
    const result = await manager.executeTool('browser', { action: 'read_page' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.ok).toBe(false);
    expect(inner.error).toContain('Settings → Browser');
  });

  it('browser: treats non-boolean truthy enabled values as disabled at exec time', async () => {
    mockBrowserFeatureEnabled.value = true;
    const manager = await freshManager();
    mockBrowserFeatureEnabled.value = 'false' as unknown as boolean;
    const result = await manager.executeTool('browser', { action: 'read_page' });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.data).ok).toBe(false);
  });

  it('browser: appears in advertised inventory immediately after browser.enabled turns on', async () => {
    mockBrowserFeatureEnabled.value = false;
    const manager = await freshManager();

    expect(manager.getAllTools().some((tool) => tool.name === 'browser')).toBe(false);
    expect(manager.getAllToolsInfo().some((tool) => tool.name === 'browser')).toBe(false);
    expect(manager.getOpenAIToolDefinitions().some((tool) => tool.function.name === 'browser')).toBe(false);
    expect(manager.getToolInfo('browser')).toBeUndefined();
    expect(manager.hasTool('browser')).toBe(true);

    mockBrowserFeatureEnabled.value = true;

    expect(manager.getAllTools().some((tool) => tool.name === 'browser')).toBe(true);
    expect(manager.getAllToolsInfo().some((tool) => tool.name === 'browser')).toBe(true);
    expect(manager.getOpenAIToolDefinitions().some((tool) => tool.function.name === 'browser')).toBe(true);
    expect(manager.getToolInfo('browser')?.name).toBe('browser');
    expect(manager.hasTool('browser')).toBe(true);
  });

  it('browser: hides every public inventory accessor while browser.enabled is off', async () => {
    mockBrowserFeatureEnabled.value = false;
    const manager = await freshManager();

    expect(manager.getTool('browser')).toBeUndefined();
    expect(manager.getToolInfo('browser')).toBeUndefined();
    expect(manager.hasTool('browser')).toBe(true);
    expect(manager.getStats().tools).not.toContain('browser');
    expect(manager.getStats().totalTools).toBe(manager.getAllTools().length);
    expect(manager.getTool('bing_web_search')?.name).toBe('bing_web_search');
  });

  it('move_file remains available when the independent browser tool is disabled', async () => {
    mockBrowserFeatureEnabled.value = false;
    const manager = await freshManager();

    expect(manager.getTool('move_file')?.name).toBe('move_file');
    expect(manager.getAllToolsInfo().some((tool) => tool.name === 'move_file')).toBe(true);
  });

  it('browser: delegates when app-level browser.enabled is on', async () => {
    mockBrowserFeatureEnabled.value = true;
    const manager = await freshManager();
    const result = await manager.executeTool('browser', { action: 'read_page' });
    expect(result.success).toBe(true);
  });

});

// ─── get_subagent_status ──────────────────────────────────────────────────────

describe('BuiltinToolsManager — get_subagent_status branches', () => {
  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.resetInstance();
  });

  it('returns no-context error when execution context is null', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.clearExecutionContext();
    const result = await manager.executeTool('get_subagent_status', {});
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('No execution context available');
  });

  it('returns status when execution context is set', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-1',
      isSubAgent: false,
    } as any);
    subAgentManagerMock.getBackgroundTaskStatus.mockReturnValueOnce({ tasks: [{ id: 'task-1' }] });
    const result = await manager.executeTool('get_subagent_status', {});
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(false);
    const statusText = inner.content[0].text;
    const status = JSON.parse(statusText);
    expect(status.tasks[0].id).toBe('task-1');
  });
});

// ─── notify_parent ────────────────────────────────────────────────────────────

describe('BuiltinToolsManager — notify_parent branches', () => {
  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.resetInstance();
  });

  it('returns no-context error when execution context is null', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.clearExecutionContext();
    const result = await manager.executeTool('notify_parent', { type: 'info', message: 'hello' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('No execution context available');
  });

  it('returns error when not called from a sub-agent (isSubAgent=false)', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-1',
      isSubAgent: false,
    } as any);
    const result = await manager.executeTool('notify_parent', { type: 'info', message: 'hello' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('can only be called from within a sub-agent');
  });

  it('sends notification when isSubAgent=true', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-42',
      isSubAgent: true,
      currentToolCallId: 'tc-1',
    } as any);
    const result = await manager.executeTool('notify_parent', { type: 'progress', message: 'step done' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(false);
    expect(inner.content[0].text).toContain('Notification sent');
    expect(subAgentManagerMock.handleNotification).toHaveBeenCalledWith(
      'sess-42',
      expect.objectContaining({ taskId: 'tc-1', type: 'progress', message: 'step done' }),
    );
  });

  it('uses "unknown" taskId when currentToolCallId is absent', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-99',
      isSubAgent: true,
      // no currentToolCallId
    } as any);
    await manager.executeTool('notify_parent', { type: 'info', message: 'hi' });
    expect(subAgentManagerMock.handleNotification).toHaveBeenCalledWith(
      'sess-99',
      expect.objectContaining({ taskId: 'unknown' }),
    );
  });
});

// ─── send_to_subagent ─────────────────────────────────────────────────────────

describe('BuiltinToolsManager — send_to_subagent branches', () => {
  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.resetInstance();
  });

  it('returns no-context error when execution context is null', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.clearExecutionContext();
    const result = await manager.executeTool('send_to_subagent', { task_id: 't1', message: 'hi' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('No execution context available');
  });

  it('returns error when called from within a sub-agent (isSubAgent=true)', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-1',
      isSubAgent: true,
    } as any);
    const result = await manager.executeTool('send_to_subagent', { task_id: 't1', message: 'hi' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('can only be called by the parent agent');
  });

  it('returns success when sendResult.success=true', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-1',
      isSubAgent: false,
    } as any);
    subAgentManagerMock.sendMessageToSubAgent.mockReturnValue({ success: true });
    const result = await manager.executeTool('send_to_subagent', { task_id: 'task-42', message: 'proceed' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(false);
    expect(inner.content[0].text).toContain('task-42');
  });

  it('returns failure message when sendResult.success=false', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-1',
      isSubAgent: false,
    } as any);
    subAgentManagerMock.sendMessageToSubAgent.mockReturnValue({ success: false, error: 'Task not found' });
    const result = await manager.executeTool('send_to_subagent', { task_id: 'bad-task', message: 'hey' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('Task not found');
  });

  it('falls back to "Failed to send message." when sendResult has no error field', async () => {
    const manager = await freshManager();
    BuiltinToolsManager.setExecutionContext({
      userAlias: 'alice',
      chatId: 'c1',
      chatSessionId: 'sess-1',
      isSubAgent: false,
    } as any);
    subAgentManagerMock.sendMessageToSubAgent.mockReturnValue({ success: false });
    const result = await manager.executeTool('send_to_subagent', { task_id: 'bad-task', message: 'hey' });
    expect(result.success).toBe(true);
    const inner = JSON.parse(result.data);
    expect(inner.isError).toBe(true);
    expect(inner.content[0].text).toContain('Failed to send message.');
  });
});

// ─── unknown tool / catch with non-Error ─────────────────────────────────────

describe('BuiltinToolsManager — catch block with non-Error throw', () => {
  afterEach(() => {
    BuiltinToolsManager.clearExecutionContext();
    BuiltinToolsManager.resetInstance();
  });

  it('formats error string via String(error) when thrown value is not an Error instance', async () => {
    // Force read_file tool to throw a plain string (non-Error)
    readFileToolMock.execute.mockRejectedValueOnce('something went wrong badly');
    const manager = await freshManager();
    const result = await manager.executeTool('read_file', { filePath: '/tmp/test.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('something went wrong badly');
  });

  it('formats error message via error.message when thrown value is an Error', async () => {
    readFileToolMock.execute.mockRejectedValueOnce(new Error('file read failed'));
    const manager = await freshManager();
    const result = await manager.executeTool('read_file', { filePath: '/tmp/test.txt' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('file read failed');
  });
});

// ─── getBuiltinToolsManager exported function ─────────────────────────────────

describe('getBuiltinToolsManager', () => {
  afterEach(() => {
    BuiltinToolsManager.resetInstance();
  });

  it('returns the singleton BuiltinToolsManager instance', () => {
    const m1 = getBuiltinToolsManager();
    const m2 = BuiltinToolsManager.getInstance();
    expect(m1).toBe(m2);
    expect(m1).toBeInstanceOf(BuiltinToolsManager);
  });
});
