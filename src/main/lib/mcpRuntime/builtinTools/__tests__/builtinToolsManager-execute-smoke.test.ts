import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const {
  mockSubAgentFeatureEnabled,
  mockSchedulerEnabled,
  mockBrowserControlEnabled,
  profileCacheManagerMock,
  mcpClientManagerMock,
  searchFilesMock,
  createMockTool,
} = vi.hoisted(() => {
  const flags = {
    mockSubAgentFeatureEnabled: { value: false },
    mockSchedulerEnabled: { value: false },
    mockBrowserControlEnabled: { value: false },
  };

  const profileCacheManagerMock = {
    currentUserAlias: 'user-1',
    getAllChatConfigs: vi.fn(),
    getCachedProfile: vi.fn(),
    getMcpServerInfo: vi.fn(),
    getCachedAliases: vi.fn(),
    getChatConfig: vi.fn(),
  };

  const mcpClientManagerMock = {
    currentUserAlias: 'user-1',
  };

  const searchFilesMock = vi.fn();

  const createMockTool = (name: string) => ({
    getDefinition: () => ({
      name,
      description: `Mock ${name}`,
      inputSchema: { type: 'object', properties: {} },
    }),
    execute: vi.fn().mockResolvedValue({ success: true, tool: name }),
  });

  return {
    ...flags,
    profileCacheManagerMock,
    mcpClientManagerMock,
    searchFilesMock,
    createMockTool,
  };
});

vi.mock('electron', async () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') {
        return path.join(os.tmpdir(), 'openkosmos-vitest-userdata');
      }
      return os.tmpdir();
    }),
  },
}));

vi.mock('../../../featureFlags', async () => ({
  isFeatureEnabled: vi.fn((name: string) => {
    if (name === 'openkosmosFeatureSubAgent') return mockSubAgentFeatureEnabled.value;
    if (name === 'openkosmosFeatureScheduler') return mockSchedulerEnabled.value;
    if (name === 'browserControl') return mockBrowserControlEnabled.value;
    return true;
  }),
}));

vi.mock('../../../userDataADO', async () => ({
  profileCacheManager: profileCacheManagerMock,
}));

vi.mock('../../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: profileCacheManagerMock,
}));

vi.mock('../../mcpClientManager', async () => ({
  mcpClientManager: mcpClientManagerMock,
}));

vi.mock('../../../workspace/WorkspaceWatcher', async () => ({
  getWorkspaceWatcher: () => ({
    searchFiles: searchFilesMock,
  }),
}));

vi.mock('../../../unifiedLogger', async () => ({
  getUnifiedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../readHtmlTool', async () => ({ ReadHtmlTool: createMockTool('read_html') }));
vi.mock('../executeCommandTool', async () => ({ ExecuteCommandTool: createMockTool('execute_command') }));
vi.mock('../createMcpServerFromConfigTool', async () => ({ CreateMcpServerFromConfigTool: createMockTool('create_mcp_server_from_config') }));
vi.mock('../updateMcpServerTool', async () => ({ UpdateMcpServerTool: createMockTool('update_mcp_server') }));
vi.mock('../searchSkillsTool', async () => ({ SearchSkillsTool: createMockTool('search_skills') }));
vi.mock('../applySkillToAgentsTool', async () => ({ ApplySkillToAgentsTool: createMockTool('apply_skill_to_agents') }));
vi.mock('../uninstallSkillsTool', async () => ({ UninstallSkillsTool: createMockTool('uninstall_skills') }));
vi.mock('../removeSkillsFromAgentsTool', async () => ({ RemoveSkillsFromAgentsTool: createMockTool('remove_skills_from_agents') }));
vi.mock('../createAgentFromConfigTool', async () => ({ CreateAgentFromConfigTool: createMockTool('create_agent_from_config') }));
vi.mock('../updateAgentTool', async () => ({ UpdateAgentTool: createMockTool('update_agent') }));
vi.mock('../setPrimaryAgentTool', async () => ({ SetPrimaryAgentTool: createMockTool('set_primary_agent') }));
vi.mock('../moveFileTool', async () => ({ MoveFileTool: createMockTool('move_file') }));
vi.mock('../presentDeliverablesTool', async () => ({ PresentTool: createMockTool('present_deliverables') }));
vi.mock('../createScheduleTool', async () => ({ CreateScheduleTool: createMockTool('create_schedule') }));
vi.mock('../getScheduleTool', async () => ({ GetScheduleTool: createMockTool('get_schedule') }));
vi.mock('../updateScheduleTool', async () => ({ UpdateScheduleTool: createMockTool('update_schedule') }));
vi.mock('../runScheduleTool', async () => ({ RunScheduleTool: createMockTool('run_schedule') }));

import { BuiltinToolsManager } from '../builtinToolsManager';

describe('BuiltinToolsManager — execute smoke coverage', () => {
  let manager: BuiltinToolsManager;
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-builtin-smoke-'));

    profileCacheManagerMock.currentUserAlias = 'user-1';
    profileCacheManagerMock.getAllChatConfigs.mockReset();
    profileCacheManagerMock.getCachedProfile.mockReset();
    profileCacheManagerMock.getMcpServerInfo.mockReset();
    profileCacheManagerMock.getCachedAliases.mockReset();
    profileCacheManagerMock.getChatConfig.mockReset();

    searchFilesMock.mockReset();
    mcpClientManagerMock.currentUserAlias = 'user-1';

    BuiltinToolsManager.resetInstance();
    manager = BuiltinToolsManager.getInstance();
    await manager.initialize();
  });

  afterEach(async () => {
    BuiltinToolsManager.resetInstance();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('executes read_file against a real local file and returns the requested lines', async () => {
    const filePath = path.join(tempRoot, 'notes.txt');
    await fs.writeFile(filePath, ['alpha', 'beta', 'gamma', 'delta'].join('\n'), 'utf-8');

    const result = await manager.executeTool('read_file', {
      description: 'Read demo lines',
      filePath,
      startLine: 2,
      endLine: 3,
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.data || '{}');
    expect(payload.fileName).toBe('notes.txt');
    expect(payload.startLine).toBe(2);
    expect(payload.endLine).toBe(3);
    expect(payload.content).toContain('beta');
    expect(payload.content).toContain('gamma');
  });

  it('executes write_file against the real filesystem and persists content', async () => {
    const filePath = path.join(tempRoot, 'output.txt');

    const result = await manager.executeTool('write_file', {
      filePath,
      content: 'hello smoke test',
      mode: 'overwrite',
      createIfNotExists: true,
      createDirectories: true,
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.data || '{}');
    expect(payload.success).toBe(true);
    expect(payload.filePath).toBe(filePath);

    const savedContent = await fs.readFile(filePath, 'utf-8');
    expect(savedContent).toBe('hello smoke test');
  });

  it('executes search_file_contents and returns matching files and lines', async () => {
    const docsDir = path.join(tempRoot, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'a.txt'), 'alpha\nbeta keyword\ngamma\n', 'utf-8');
    await fs.writeFile(path.join(docsDir, 'b.txt'), 'no match here\n', 'utf-8');

    const result = await manager.executeTool('search_file_contents', {
      description: 'Find keyword usage',
      workspaceRoot: tempRoot,
      patterns: ['keyword'],
      paths: ['docs'],
      context: 1,
    });

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.data || '{}');
    expect(payload.success).toBe(true);
    expect(payload.patternResults).toHaveLength(1);
    expect(payload.patternResults[0].results).toHaveLength(1);
    expect(payload.patternResults[0].results[0].file).toBe('docs/a.txt');
    expect(payload.patternResults[0].results[0].matches[0].lines.some((line: string) => line.includes('keyword'))).toBe(true);
  });

  it('executes search_files through the real tool and returns normalized search output', async () => {
    searchFilesMock.mockResolvedValue({
      results: [
        { path: 'src/demo.ts', score: 0.97, isDirectory: false },
        { path: 'src/demo-folder', score: 0.66, isDirectory: true },
      ],
      limitHit: false,
      stats: { duration: 6, filesScanned: 12, cacheHit: true },
    });

    const result = await manager.executeTool('search_files', {
      description: 'Find demo paths',
      pattern: 'demo',
      workspaceRoot: tempRoot,
      searchTarget: 'both',
    });

    expect(result.success).toBe(true);
    expect(searchFilesMock).toHaveBeenCalledWith(expect.objectContaining({
      folder: tempRoot,
      pattern: 'demo',
      searchTarget: 'both',
    }));

    const payload = JSON.parse(result.data || '{}');
    expect(payload.success).toBe(true);
    expect(payload.results).toEqual([
      { path: 'src/demo.ts', score: 0.97, isDirectory: false },
      { path: 'src/demo-folder', score: 0.66, isDirectory: true },
    ]);
    expect(payload.stats.cacheHit).toBe(true);
  });

  it('executes get_current_datetime and returns formatted local time metadata', async () => {
    const result = await manager.executeTool('get_current_datetime', {});

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.data || '{}');
    expect(payload.local_datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(payload.local_timezone).toMatch(/UTC[+-]\d{2}:\d{2}/);
  });
});
