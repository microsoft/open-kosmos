/**
 * Tests for the MCP readiness preflight wired into SchedulerManager.executeJob and
 * the resolveJobMcpServers() resolver that scopes it to each job's bound MCP
 * servers.
 */

vi.mock('node-cron', async () => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
}));

const mcpMocks = vi.hoisted(() => ({
  waitForServersSettled: vi.fn(async () => undefined),
  getMcpServerRuntimeState: vi.fn<(name: string) => any>(() => undefined),
  getInUseServerNames: vi.fn(() => [] as string[]),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    waitForServersSettled: mcpMocks.waitForServersSettled,
    getMcpServerRuntimeState: mcpMocks.getMcpServerRuntimeState,
    getInUseServerNames: mcpMocks.getInUseServerNames,
  },
}));

vi.mock('../../mcpRuntime/builtinMcpClient', () => ({
  BUILTIN_SERVER_NAME: 'builtin-tools',
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: {
    runScheduledJob: vi.fn(async () => ({ success: true, chatSessionId: 'sess-1', messagesCount: 1 })),
  },
}));

vi.mock('../../chat/chatSessionStore', async () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn(),
    patchSchedulerMetadata: vi.fn(),
  },
}));

vi.mock('../scheduleStore', async () => ({
  scheduleStore: {
    initialize: vi.fn(async () => undefined),
    getJob: vi.fn(async () => null),
    listJobs: vi.fn(async () => []),
    markJobExecutionStarted: vi.fn(async () => undefined),
    markJobExecutionCompleted: vi.fn(async () => undefined),
    markJobExecutionFailed: vi.fn(async () => undefined),
    markJobExpired: vi.fn(async () => undefined),
    toggleJob: vi.fn(async () => null),
    updateJob: vi.fn(async () => null),
    deleteJob: vi.fn(async () => true),
  },
}));

const profileMocks = vi.hoisted(() => ({
  getChatConfig: vi.fn(() => null as any),
  getCachedProfile: vi.fn(() => null as any),
  getAllChatConfigs: vi.fn(() => [] as any[]),
}));

const mcpStore = vi.hoisted(() => ({ servers: [] as any[] }));

const mcpConfigMocks = vi.hoisted(() => {
  const getServers = vi.fn((_alias: string) => [] as any[]);
  return {
    getServers,
    getServerInfo: vi.fn((alias: string, name: string) => getServers(alias).find((s: any) => s.name === name) ?? null),
  };
});

vi.mock('../../userDataADO/mcpConfigManager', () => ({
  mcpConfigManager: mcpConfigMocks,
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getChatConfig: profileMocks.getChatConfig,
    getCachedProfile: profileMocks.getCachedProfile,
    getAllChatConfigs: profileMocks.getAllChatConfigs,
  },
}));

vi.mock('../schedulerRuntimeStateStore', async () => ({
  schedulerRuntimeStateStore: {
    readState: vi.fn(async () => ({ schemaVersion: 1, alias: 'alice', isActive: false })),
    markActivated: vi.fn(async () => undefined),
    markDeactivated: vi.fn(async () => undefined),
    markPendingColdStartCatchUp: vi.fn(async () => undefined),
    clearPendingColdStartCatchUp: vi.fn(async () => undefined),
  },
}));

vi.mock('../../userDataADO/pathUtils', async () => ({
  generateChatSessionId: vi.fn(() => 'preallocated-session-id'),
}));

import type { SchedulerJob } from '../types';

function makeJob(overrides?: Partial<SchedulerJob>): SchedulerJob {
  return {
    id: 'job-1',
    name: 'Test Job',
    description: '',
    scheduleType: 'cron',
    cronExpression: '*/5 * * * *',
    enabled: true,
    chat_id: 'chat-1',
    message: 'hello',
    status: 'pending',
    ...overrides,
  };
}

function singleAgentConfig(mcpServers: Array<{ name: string; tools?: string[] }>) {
  return {
    chat_id: 'chat-1',
    chat_type: 'single_agent',
    agent: { mcp_servers: mcpServers.map((s) => ({ name: s.name, tools: s.tools ?? [] })) },
  };
}

function connectedState() {
  return { serverName: 'x', status: 'connected', tools: [], lastError: null };
}

async function setupMocks() {
  const { scheduleStore } = await import('../scheduleStore');
  const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
  const { agentChatManager } = await import('../../chat/agentChatManager');

  vi.mocked(scheduleStore.initialize).mockResolvedValue(undefined);
  vi.mocked(scheduleStore.listJobs).mockResolvedValue([]);
  vi.mocked(scheduleStore.markJobExecutionStarted).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExecutionCompleted).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExecutionFailed).mockResolvedValue(undefined as any);

  vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({ schemaVersion: 1, alias: 'alice', isActive: false });
  vi.mocked(schedulerRuntimeStateStore.markActivated).mockResolvedValue(undefined as any);

  vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });

  mcpMocks.waitForServersSettled.mockResolvedValue(undefined);
  mcpMocks.getMcpServerRuntimeState.mockReturnValue(undefined as any);
  mcpMocks.getInUseServerNames.mockReturnValue([]);
  mcpStore.servers = [];
  mcpConfigMocks.getServers.mockImplementation((_alias: string) => {
    const profileServers = profileMocks.getCachedProfile()?.mcp_servers;
    return profileServers ?? mcpStore.servers;
  });
  mcpConfigMocks.getServerInfo.mockImplementation((alias: string, name: string) =>
    mcpConfigMocks.getServers(alias).find((s: any) => s.name === name) ?? null,
  );
  profileMocks.getChatConfig.mockReturnValue(null as any);
  profileMocks.getCachedProfile.mockReturnValue(null as any);
  profileMocks.getAllChatConfigs.mockReturnValue([]);

  return { scheduleStore, agentChatManager };
}

describe('SchedulerManager MCP readiness preflight', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    await setupMocks();
  });

  afterEach(async () => {
    try {
      const { schedulerManager } = await import('../SchedulerManager');
      await schedulerManager.dispose('manual-debug');
    } catch {
      // ignore
    }
    vi.useRealTimers();
  });

  it('formats disconnected MCP server failures for scheduler sessions', async () => {
    const { formatSchedulerMcpDisconnectedError } = await import('../schedulerMcpReadiness');

    expect(formatSchedulerMcpDisconnectedError(['teams'])).toBe('Required MCP server disconnected: teams');
    expect(formatSchedulerMcpDisconnectedError(['teams', 'github'])).toBe(
      'Required MCP servers disconnected: teams, github',
    );
    expect(formatSchedulerMcpDisconnectedError([])).toBe('Required MCP servers disconnected: unknown');
  });

  it('runs the job after waiting when the bound server is connected', async () => {
    const { agentChatManager, scheduleStore } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(connectedState());

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).toHaveBeenCalledWith(['github'], 30_000);
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('creates a failed scheduled run when a required server is not connected', async () => {
    const { agentChatManager, scheduleStore } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue({ status: 'connecting' } as any);
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({
      success: false,
      chatSessionId: 'sess-1',
      error: 'Required MCP server disconnected: github',
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result).toEqual({
      success: false,
      chatSessionId: 'sess-1',
      error: 'Required MCP server disconnected: github',
    });
    expect(mcpMocks.waitForServersSettled).toHaveBeenCalledWith(['github'], 30_000);
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalled();
    expect(scheduleStore.markJobExecutionFailed).toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledWith(makeJob(), expect.objectContaining({
      preflightError: 'Required MCP server disconnected: github',
    }));
  });

  it('bypasses the gate for manual triggers', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(undefined as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'manual');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('aborts without running when the alias changes during the MCP wait', async () => {
    const { agentChatManager, scheduleStore } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(connectedState());

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Simulate a sign-out / alias switch landing while the preflight awaits readiness.
    mcpMocks.waitForServersSettled.mockImplementation(async () => {
      (schedulerManager as any).currentUserAlias = 'bob';
    });

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result).toEqual({ success: false, error: 'skipped-alias-changed' });
    expect(scheduleStore.markJobExecutionStarted).not.toHaveBeenCalled();
    expect(scheduleStore.markJobExecutionFailed).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
  });

  it('aborts without running when the scheduler generation changes during the MCP wait', async () => {
    const { agentChatManager, scheduleStore } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(connectedState());

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Same alias, but a re-login bumps the generation while the preflight awaits readiness.
    mcpMocks.waitForServersSettled.mockImplementation(async () => {
      (schedulerManager as any).schedulerGeneration += 1;
    });

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result).toEqual({ success: false, error: 'skipped-alias-changed' });
    expect(scheduleStore.markJobExecutionStarted).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).not.toHaveBeenCalled();
  });

  it('does not wait when the agent has no configured mcp_servers', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([]));
    profileMocks.getCachedProfile.mockReturnValue({
      mcp_servers: [
        { name: 'github', in_use: true },
        { name: 'fs' },
        { name: 'disabled', in_use: false },
        { name: 'builtin-tools', in_use: true },
      ],
    });
    mcpMocks.getInUseServerNames.mockReturnValue([]);
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(undefined as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(mcpMocks.getInUseServerNames).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('unions bound servers across multiple agents', async () => {
    await setupMocks();
    profileMocks.getChatConfig.mockReturnValue({
      chat_id: 'chat-1',
      chat_type: 'multi_agent',
      agents: [
        { mcp_servers: [{ name: 'a', tools: [] }] },
        { mcp_servers: [{ name: 'b', tools: [] }] },
      ],
    });
    profileMocks.getCachedProfile.mockReturnValue({
      mcp_servers: [{ name: 'a', in_use: true }, { name: 'b', in_use: true }],
    });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(connectedState());

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).toHaveBeenCalledWith(['a', 'b'], 30_000);
  });

  it('excludes profile-disabled servers from the required set', async () => {
    await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'a' }, { name: 'disabled' }]));
    profileMocks.getCachedProfile.mockReturnValue({
      mcp_servers: [{ name: 'a', in_use: true }, { name: 'disabled', in_use: false }],
    });
    mcpMocks.getMcpServerRuntimeState.mockImplementation((name: string) =>
      name === 'a' ? (connectedState() as any) : ({ status: 'connecting' } as any),
    );

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).toHaveBeenCalledWith(['a'], 30_000);
  });

  it('excludes builtin-only bindings from the required set', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'builtin-tools' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'builtin-tools', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(undefined as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('disables the gate when the job has no chat config', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(null as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('disables the gate when the chat config resolves no agents', async () => {
    await setupMocks();
    profileMocks.getChatConfig.mockReturnValue({ chat_id: 'chat-1', chat_type: 'single_agent', agent: undefined });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
  });

  it('disables the gate when a multi-agent config has no agents array', async () => {
    await setupMocks();
    profileMocks.getChatConfig.mockReturnValue({ chat_id: 'chat-1', chat_type: 'multi_agent' } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
  });

  it('disables the gate when the profile cannot be resolved', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue(null as any);
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(connectedState());

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('ignores stale bound servers that are no longer present in the profile', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'deleted-server' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(undefined as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('waits only for bound servers that still exist in the profile', async () => {
    await setupMocks();
    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }, { name: 'deleted-server' }]));
    profileMocks.getCachedProfile.mockReturnValue({
      mcp_servers: [{ name: 'github', in_use: true }],
    });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue(connectedState());

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).toHaveBeenCalledWith(['github'], 30_000);
  });

  it('does not wait when the agent has missing mcp_servers', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockReturnValue({
      chat_id: 'chat-1',
      chat_type: 'single_agent',
      agent: {},
    } as any);
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getInUseServerNames.mockReturnValue([]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(mcpMocks.getInUseServerNames).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('disables the gate when server resolution throws', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockImplementation(() => {
      throw new Error('boom');
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });

  it('disables the gate when server resolution throws a non-Error value', async () => {
    const { agentChatManager } = await setupMocks();
    profileMocks.getChatConfig.mockImplementation(() => {
      throw 'boom';
    });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');

    expect(result.success).toBe(true);
    expect(mcpMocks.waitForServersSettled).not.toHaveBeenCalled();
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
  });


  it('creates a failed cold-start catch-up run when a required server is not connected', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

    const { scheduleStore } = await setupMocks();
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({
      success: false,
      chatSessionId: 'sess-1',
      error: 'Required MCP server disconnected: github',
    });

    const cronJob = makeJob({ id: 'job-1', cronExpression: '*/5 * * * *' });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([cronJob]);
    vi.mocked(scheduleStore.getJob).mockResolvedValue(cronJob);
    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: false,
      pendingColdStartCatchUps: {
        'job-1': { occurrenceAt: '2026-05-11T11:55:00.000Z', recordedAt: '2026-05-11T11:55:00.000Z' },
      },
    } as any);

    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    // Server not connected on cold start -> create a visible failed run.
    mcpMocks.getMcpServerRuntimeState.mockReturnValue({ status: 'connecting' } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    expect(agentChatManager.runScheduledJob).toHaveBeenCalledWith(cronJob, expect.objectContaining({
      preflightError: 'Required MCP server disconnected: github',
    }));
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalledWith('alice', 'job-1', expect.any(String));
    expect(scheduleStore.markJobExecutionFailed).toHaveBeenCalledWith('alice', 'job-1', expect.any(String));
    expect(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).not.toHaveBeenCalled();
  });


  it('fails a one-time job when the first fire requires a disconnected MCP server', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-05-11T12:00:00.000Z'));

    const { scheduleStore } = await setupMocks();
    const { agentChatManager } = await import('../../chat/agentChatManager');
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({
      success: false,
      chatSessionId: 'sess-1',
      error: 'Required MCP server disconnected: github',
    });

    profileMocks.getChatConfig.mockReturnValue(singleAgentConfig([{ name: 'github' }]));
    profileMocks.getCachedProfile.mockReturnValue({ mcp_servers: [{ name: 'github', in_use: true }] });
    mcpMocks.getMcpServerRuntimeState.mockReturnValue({ status: 'connecting' } as any);

    const onceJob = makeJob({
      id: 'once-job',
      scheduleType: 'once',
      cronExpression: undefined,
      runAt: '2026-05-11T12:00:01.000Z',
    });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([onceJob]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // First timer fire: server not connected -> create a failed run and unregister.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => {
      expect(agentChatManager.runScheduledJob).toHaveBeenCalledTimes(1);
    });
    expect(agentChatManager.runScheduledJob).toHaveBeenCalledWith(onceJob, expect.objectContaining({
      preflightError: 'Required MCP server disconnected: github',
    }));
    expect(scheduleStore.markJobExecutionStarted).toHaveBeenCalledWith('alice', 'once-job', expect.any(String));
    expect(scheduleStore.markJobExecutionFailed).toHaveBeenCalledWith('alice', 'once-job', expect.any(String));
    expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).not.toContain('once-job');
  });
});
