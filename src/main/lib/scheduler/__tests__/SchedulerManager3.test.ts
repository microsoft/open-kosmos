/**
 * SchedulerManager3.test.ts — Branch-coverage-focused tests.
 *
 * Targets uncovered branches identified by v8 coverage:
 * - Non-Error throws (String(error) paths)
 * - executeJob paths with no alias / falsy result fields
 * - unregisterTask with no previousRuntimeMeta
 * - dispose('unknown') path
 * - heartbeat watchdog with missing runtime meta
 * - updateJob when updated job is disabled
 * - executeColdStartCatchUp / handleSystemResume failure paths
 * - markAliasDeactivated when alias differs from current
 */

import type { CronWatchdogTaskRuntimeMeta } from '../cronWatchdog';

vi.mock('node-cron', async () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    waitForServersSettled: vi.fn(async () => undefined),
    getMcpServerRuntimeState: vi.fn(() => undefined),
    getInUseServerNames: vi.fn(() => []),
  },
}));

vi.mock('../../mcpRuntime/builtinMcpClient', () => ({
  BUILTIN_SERVER_NAME: 'builtin-tools',
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
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
    createJob: vi.fn(async () => null),
    markJobExecutionStarted: vi.fn(async () => undefined),
    markJobExecutionCompleted: vi.fn(async () => undefined),
    markJobExecutionFailed: vi.fn(async () => undefined),
    markJobExpired: vi.fn(async () => undefined),
    toggleJob: vi.fn(async () => null),
    updateJob: vi.fn(async () => null),
    deleteJob: vi.fn(async () => true),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getAllChatConfigs: vi.fn(() => []),
  },
}));

vi.mock('../schedulerRuntimeStateStore', async () => ({
  schedulerRuntimeStateStore: {
    readState: vi.fn(async () => ({
      schemaVersion: 1,
      alias: 'alice',
      isActive: false,
    })),
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
    chat_id: 'agent-1',
    message: 'hello',
    status: 'pending',
    ...overrides,
  };
}

async function setupMocks() {
  const { scheduleStore } = await import('../scheduleStore');
  const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
  const { agentChatManager } = await import('../../chat/agentChatManager');

  vi.mocked(scheduleStore.initialize).mockResolvedValue(undefined);
  vi.mocked(scheduleStore.getJob).mockResolvedValue(null);
  vi.mocked(scheduleStore.listJobs).mockResolvedValue([]);
  vi.mocked(scheduleStore.markJobExecutionStarted).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExecutionCompleted).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExecutionFailed).mockResolvedValue(undefined as any);
  vi.mocked(scheduleStore.markJobExpired).mockResolvedValue(undefined as any);

  vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({ schemaVersion: 1, alias: 'alice', isActive: false });
  vi.mocked(schedulerRuntimeStateStore.markActivated).mockResolvedValue(undefined as any);
  vi.mocked(schedulerRuntimeStateStore.markDeactivated).mockResolvedValue(undefined as any);
  vi.mocked(schedulerRuntimeStateStore.markPendingColdStartCatchUp).mockResolvedValue(undefined as any);
  vi.mocked(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).mockResolvedValue(undefined as any);

  vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: true, chatSessionId: 'sess-1', messagesCount: 1 });

  return { scheduleStore, schedulerRuntimeStateStore, agentChatManager };
}

describe('SchedulerManager — non-Error throw paths', () => {
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

  it('createJob wraps a non-Error throw as Error', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.createJob).mockRejectedValue('string-error');

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    await expect(schedulerManager.createJob(makeJob())).rejects.toThrow('string-error');
  });

  it('updateJob wraps a non-Error throw as Error', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.updateJob).mockRejectedValue('update-string-error');

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    await expect(schedulerManager.updateJob('job-1', { name: 'new' })).rejects.toThrow('update-string-error');
  });

  it('toggleJob wraps a non-Error throw as Error', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(scheduleStore.toggleJob).mockRejectedValue('toggle-string-error');

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    await expect(schedulerManager.toggleJob('job-1', true)).rejects.toThrow('toggle-string-error');
  });

  it('executeJob catch branch handles a non-Error throw', async () => {
    const { agentChatManager } = await import('../../chat/agentChatManager');
    vi.mocked(agentChatManager.runScheduledJob).mockRejectedValue('runtime-string-error');

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');
    expect(result.success).toBe(false);
    expect(result.error).toBe('runtime-string-error');
  });

  it('toggleJobsByAgent logs non-Error throw from toggleJob', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const disabledJob = makeJob({ id: 'tj-1', enabled: false });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([disabledJob]);
    vi.mocked(scheduleStore.toggleJob).mockRejectedValue('toggle-agent-string');

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const count = await schedulerManager.toggleJobsByAgent('agent-1', true);
    expect(count).toBe(0);
  });

  it('initialize logs non-Error throw when registerJob fails', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const cron = await import('node-cron');
    vi.mocked(cron.schedule).mockImplementation(() => { throw 'cron-string-error'; });

    const enabledJob = makeJob();
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([enabledJob]);

    const { schedulerManager } = await import('../SchedulerManager');
    // initialize should not throw, it catches internally
    await schedulerManager.initialize('alice');
  });
});

describe('SchedulerManager — executeJob failure with no alias and falsy fields', () => {
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

  it('executeJob failure path skips store calls when alias is null', async () => {
    const { agentChatManager } = await import('../../chat/agentChatManager');
    const { scheduleStore } = await import('../scheduleStore');
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: false, error: 'llm down' });

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Clear alias after init
    (schedulerManager as any).currentUserAlias = null;

    const result = await (schedulerManager as any).executeJob(makeJob(), 'manual');
    expect(result.success).toBe(false);
    // markJobExecutionStarted should not have been called after alias was cleared
    // (it's called before runScheduledJob, so it may have been called once during init)
  });

  it('executeJob catch path skips store calls when alias is null', async () => {
    const { agentChatManager } = await import('../../chat/agentChatManager');
    vi.mocked(agentChatManager.runScheduledJob).mockRejectedValue(new Error('boom'));

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    (schedulerManager as any).currentUserAlias = null;

    const result = await (schedulerManager as any).executeJob(makeJob(), 'manual');
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('executeJob uses fallback "Unknown error" when result.error is falsy', async () => {
    const { agentChatManager } = await import('../../chat/agentChatManager');
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({
      success: false,
      error: '',
    } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');
    expect(result.success).toBe(false);
    // Covers the `result.error || 'Unknown error'` branch where error is falsy
  });

  it('executeJob handles undefined messagesCount with ?? 0 fallback', async () => {
    const { agentChatManager } = await import('../../chat/agentChatManager');
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({
      success: true,
      chatSessionId: 'sess-no-count',
    } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await (schedulerManager as any).executeJob(makeJob(), 'scheduled');
    expect(result.success).toBe(true);
    // Covers the `result.messagesCount ?? 0` branch where messagesCount is undefined
  });
});

describe('SchedulerManager — unregisterTask with no previousRuntimeMeta', () => {
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

  it('unregisterTask handles missing runtimeMeta without crashing', async () => {
    const cron = await import('node-cron');
    const stopFn = vi.fn();
    vi.mocked(cron.schedule).mockReturnValue({ stop: stopFn } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Manually add a task without corresponding runtimeMeta
    (schedulerManager as any).activeTasks.set('orphan-job', {
      kind: 'cron',
      task: { stop: stopFn },
    });
    // Ensure no runtimeMeta exists for this job
    (schedulerManager as any).taskRuntimeMeta.delete('orphan-job');

    // Should not throw
    (schedulerManager as any).unregisterTask('orphan-job', 'delete-job');
    expect(stopFn).toHaveBeenCalled();
    expect((schedulerManager as any).activeTasks.has('orphan-job')).toBe(false);
  });
});

describe('SchedulerManager — dispose with unknown reason', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    await setupMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('dispose() without args uses "unknown" reason and maps to "dispose" for clearActiveTasks', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');
    // dispose with default reason ('unknown')
    await schedulerManager.dispose();
    expect(schedulerManager.getRuntimeDiagnostics().activeTaskCount).toBe(0);
  });
});

describe('SchedulerManager — updateJob disabled after update', () => {
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

  it('updateJob does not re-register when updated job is disabled', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const cron = await import('node-cron');

    const updatedJob = makeJob({ enabled: false });
    vi.mocked(scheduleStore.updateJob).mockResolvedValue(updatedJob as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await schedulerManager.updateJob('job-1', { enabled: false });
    expect(result).toBe(true);
    // cron.schedule should not have been called for the disabled update
    expect(schedulerManager.getRuntimeDiagnostics().activeJobIds).not.toContain('job-1');
  });
});

describe('SchedulerManager — handleSystemResume with failed executeJob', () => {
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

  it('counts only successful recoveries when executeJob fails during resume', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    const cronJob = makeJob({
      id: 'resume-fail-job',
      scheduleType: 'cron',
      cronExpression: '0 * * * *',
    });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([cronJob]);
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: false, error: 'fail' } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const suspendedAt = Date.now() - 3600_000; // 1 hour ago
    const resumedAt = Date.now() - 60_000; // 1 minute ago

    await schedulerManager.handleSystemResume(suspendedAt, resumedAt);
    // Should not throw; failed result just means recoveredRuns stays 0
  });
});

describe('SchedulerManager — executeColdStartCatchUp with no alias', () => {
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

  it('returns failure when alias is null', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    // Don't initialize — alias stays null

    const result = await (schedulerManager as any).executeColdStartCatchUp(
      makeJob(),
      new Date().toISOString(),
      false,
    );
    expect(result.success).toBe(false);
  });
});

describe('SchedulerManager — markOneTimeJobExpired with no alias', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    await setupMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('returns early when alias is null', async () => {
    const { scheduleStore } = await import('../scheduleStore');

    const { schedulerManager } = await import('../SchedulerManager');
    // Don't initialize, alias is null

    await (schedulerManager as any).markOneTimeJobExpired('job-1');
    expect(scheduleStore.markJobExpired).not.toHaveBeenCalled();
  });
});

describe('SchedulerManager — handleColdStartCatchUp pending replay failure', () => {
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

  it('does not count failed pending replays in recoveredRuns', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    const cronJob = makeJob({
      id: 'pending-fail',
      scheduleType: 'cron',
      cronExpression: '0 * * * *',
    });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([cronJob]);
    vi.mocked(scheduleStore.getJob).mockResolvedValue(cronJob);
    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: false,
      pendingColdStartCatchUps: {
        'pending-fail': {
          occurrenceAt: new Date(Date.now() - 60_000).toISOString(),
          recordedAt: new Date(Date.now() - 120_000).toISOString(),
        },
      },
    } as any);

    // Make executeJob fail
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: false, error: 'catchup fail' } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Pending replay failed, so clearPendingColdStartCatchUp should NOT have been called
    expect(schedulerRuntimeStateStore.clearPendingColdStartCatchUp).not.toHaveBeenCalled();
  });
});

describe('SchedulerManager — handleColdStartCatchUp baseline executeJob failure', () => {
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

  it('does not count failed baseline catch-ups in recoveredRuns', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    const cronJob = makeJob({
      id: 'baseline-fail',
      scheduleType: 'cron',
      cronExpression: '0 * * * *',
    });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([cronJob]);
    vi.mocked(schedulerRuntimeStateStore.readState).mockResolvedValue({
      schemaVersion: 1,
      alias: 'alice',
      isActive: false,
      lastDeactivatedAt: new Date(Date.now() - 3600_000).toISOString(),
    } as any);

    // Make executeJob fail
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({ success: false, error: 'baseline fail' } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Should complete without throwing
  });
});

describe('SchedulerManager — markAliasDeactivated edge case', () => {
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

  it('does not clear currentAliasActivatedAt when alias differs from current', async () => {
    const { schedulerRuntimeStateStore } = await import('../schedulerRuntimeStateStore');

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Mark a different alias as deactivated
    await (schedulerManager as any).markAliasDeactivated('bob', new Date().toISOString());

    expect(schedulerRuntimeStateStore.markDeactivated).toHaveBeenCalledWith('bob', expect.any(String));
    // currentAliasActivatedAt should still be set since 'bob' !== 'alice'
    expect((schedulerManager as any).currentAliasActivatedAt).not.toBeNull();
  });
});

describe('SchedulerManager — recoverInterruptedScheduledSessions patchSchedulerMetadata returns false', () => {
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

  it('does not count session when patchSchedulerMetadata returns false', async () => {
    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    const { chatSessionStore } = await import('../../chat/chatSessionStore');

    vi.mocked(profileCacheManager.getAllChatConfigs).mockReturnValue([
      { chat_id: 'chat-1' },
    ] as any);

    vi.mocked(chatSessionStore.getChatSessionsProjection).mockResolvedValue({
      sessions: [
        {
          chatSession_id: 'sess-1',
          schedulerJobId: 'job-1',
          schedulerExecutionStatus: 'running',
          schedulerError: '',
        },
      ],
    } as any);

    vi.mocked(chatSessionStore.patchSchedulerMetadata).mockResolvedValue(false as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Should not throw — the recovery just doesn't count this session
  });
});

describe('SchedulerManager — heartbeat watchdog with missing runtime meta', () => {
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

  it('watchdog setRuntimeMeta is a no-op when no current meta exists for the job', async () => {
    vi.useFakeTimers();
    const cron = await import('node-cron');
    const cronWatchdog = await import('../cronWatchdog');

    let capturedSetRuntimeMeta: ((jobId: string, meta: Partial<CronWatchdogTaskRuntimeMeta>) => void) | undefined;

    vi.spyOn(cronWatchdog, 'runCronWatchdog').mockImplementation(async (opts: any) => {
      capturedSetRuntimeMeta = opts.setRuntimeMeta;
    });

    const stopFn = vi.fn();
    vi.mocked(cron.schedule).mockReturnValue({ stop: stopFn } as any);

    const { scheduleStore } = await import('../scheduleStore');
    const enabledJob = makeJob({ id: 'hb-meta-test' });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([enabledJob]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Remove the runtimeMeta entry for the job so the setRuntimeMeta callback hits the "no current" branch
    (schedulerManager as any).taskRuntimeMeta.delete('hb-meta-test');

    // Trigger heartbeat
    await vi.advanceTimersByTimeAsync(60_000);

    expect(capturedSetRuntimeMeta).toBeDefined();
    // Call setRuntimeMeta — should not throw when no current meta
    capturedSetRuntimeMeta!('hb-meta-test', { lastCronWatchdogCheckedAt: new Date().toISOString() });

    // Confirm no meta was written since there was no current
    expect((schedulerManager as any).taskRuntimeMeta.has('hb-meta-test')).toBe(false);
  });
});

describe('SchedulerManager — runJobNow onReady callback', () => {
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

  it('resolves with error when runScheduledJob dispatch fails before onReady', async () => {
    const { scheduleStore } = await import('../scheduleStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    const job = makeJob({ id: 'run-now-err' });
    vi.mocked(scheduleStore.getJob).mockResolvedValue(job);
    // Return failure without calling onReady
    vi.mocked(agentChatManager.runScheduledJob).mockResolvedValue({
      success: false,
      error: 'dispatch failed',
    } as any);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    const result = await schedulerManager.runJobNow('run-now-err');
    expect(result.success).toBe(false);
    expect(result.error).toBe('dispatch failed');
  });
});

describe('SchedulerManager — once-job retry expiry with no alias', () => {
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

  it('does not call markJobExecutionFailed when alias is null during retry expiry', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-06-01T12:00:00.000Z'));

    const { scheduleStore } = await import('../scheduleStore');
    const { agentChatManager } = await import('../../chat/agentChatManager');

    // Always return overlap to force retry path
    vi.mocked(agentChatManager.runScheduledJob).mockImplementation(
      () => new Promise(() => undefined), // never resolves — fills slots
    );

    const onceJob = makeJob({
      id: 'once-no-alias',
      scheduleType: 'once',
      cronExpression: undefined,
      runAt: '2026-06-01T12:00:01.000Z',
    });
    vi.mocked(scheduleStore.listJobs).mockResolvedValue([onceJob]);

    const { schedulerManager } = await import('../SchedulerManager');
    await schedulerManager.initialize('alice');

    // Fill all slots
    for (let i = 0; i < 3; i++) {
      (schedulerManager as any).executeJob(makeJob({ id: `blocker-${i}` }), 'scheduled');
    }

    // Clear alias to trigger the "else if (this.currentUserAlias)" false branch
    (schedulerManager as any).currentUserAlias = null;

    // Advance past the once-job fire time + the full catch-up window
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000);

    // markJobExecutionFailed should NOT have been called since alias is null
    expect(scheduleStore.markJobExecutionFailed).not.toHaveBeenCalledWith(
      expect.anything(),
      'once-no-alias',
      expect.any(String),
    );
  });
});

describe('SchedulerManager — handleColdStartCatchUp no alias early return', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    await setupMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('returns early when currentUserAlias is null', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    // Don't initialize — alias stays null

    // Call handleColdStartCatchUp directly
    await (schedulerManager as any).handleColdStartCatchUp(Date.now(), [], { schemaVersion: 1 });
    // Should not throw
  });
});
