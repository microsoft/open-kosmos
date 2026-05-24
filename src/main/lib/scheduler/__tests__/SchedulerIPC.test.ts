const capturedHandlers: Record<string, Function> = {};

vi.mock('electron', async () => ({
  ipcMain: {},
}));

vi.mock('@shared/ipc/scheduler', async () => ({
  renderToMain: {
    bindMain: vi.fn(() => {
      return new Proxy({}, {
        get(_target, methodName: string) {
          return (handler: Function) => {
            capturedHandlers[methodName] = handler;
          };
        },
      });
    }),
  },
}));

vi.mock('../SchedulerManager', async () => ({
  schedulerManager: {
    listJobs: vi.fn(async () => []),
    createJob: vi.fn(async () => true),
    deleteJob: vi.fn(async () => true),
    toggleJob: vi.fn(async () => true),
    updateJob: vi.fn(async () => true),
    runJobNow: vi.fn(async () => ({ success: true, chatSessionId: 'sess-1', messagesCount: 1 })),
    getJob: vi.fn(async () => null),
    getUserAlias: vi.fn(() => 'alice'),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', async () => ({
  profileCacheManager: {
    getChatSessionsAsync: vi.fn(async () => []),
  },
}));

describe('SchedulerIPC - registerSchedulerIPC', () => {
  beforeAll(async () => {
    const { registerSchedulerIPC } = await import('../SchedulerIPC');
    registerSchedulerIPC();
  });

  it('registers IPC handlers on first call', async () => {
    const { renderToMain } = await import('@shared/ipc/scheduler');
    expect(renderToMain.bindMain).toHaveBeenCalled();
  });

  it('is idempotent - second call is a no-op', async () => {
    const { renderToMain } = await import('@shared/ipc/scheduler');
    const { registerSchedulerIPC } = await import('../SchedulerIPC');
    registerSchedulerIPC();
    expect(renderToMain.bindMain).toHaveBeenCalledTimes(1);
  });

  it('listJobs handler returns jobs on success', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.listJobs).mockResolvedValue([]);
    const result = await capturedHandlers['listJobs']?.();
    expect(result).toEqual({ success: true, data: [] });
  });

  it('listJobs handler returns error on failure', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.listJobs).mockRejectedValue(new Error('db error'));
    const result = await capturedHandlers['listJobs']?.();
    expect(result).toEqual({ success: false, error: 'db error' });
  });

  it('createJob handler returns success', async () => {
    const job = { id: 'j1', name: 'J', description: '', scheduleType: 'cron' as const, cronExpression: '0 * * * *', enabled: true, agentId: 'a', message: 'm', status: 'pending' as const };
    const result = await capturedHandlers['createJob']?.({}, job);
    expect(result).toEqual({ success: true });
  });

  it('createJob handler returns error on failure', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.createJob).mockRejectedValue(new Error('create failed'));
    const result = await capturedHandlers['createJob']?.({}, {});
    expect(result).toEqual({ success: false, error: 'create failed' });
  });

  it('deleteJob handler returns success', async () => {
    const result = await capturedHandlers['deleteJob']?.({}, 'job-1');
    expect(result).toEqual({ success: true });
  });

  it('deleteJob handler returns error on failure', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.deleteJob).mockRejectedValue(new Error('delete failed'));
    const result = await capturedHandlers['deleteJob']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'delete failed' });
  });

  it('toggleJob handler returns success', async () => {
    const result = await capturedHandlers['toggleJob']?.({}, 'job-1', true);
    expect(result).toEqual({ success: true });
  });

  it('toggleJob handler returns error on failure', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.toggleJob).mockRejectedValue(new Error('toggle failed'));
    const result = await capturedHandlers['toggleJob']?.({}, 'job-1', true);
    expect(result).toEqual({ success: false, error: 'toggle failed' });
  });

  it('updateJob handler returns success', async () => {
    const result = await capturedHandlers['updateJob']?.({}, 'job-1', { name: 'New' });
    expect(result).toEqual({ success: true });
  });

  it('updateJob handler returns error on failure', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.updateJob).mockRejectedValue(new Error('update failed'));
    const result = await capturedHandlers['updateJob']?.({}, 'job-1', {});
    expect(result).toEqual({ success: false, error: 'update failed' });
  });

  it('runJobNow handler returns success with chatSessionId', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.runJobNow).mockResolvedValue({ success: true, chatSessionId: 'sess-1', messagesCount: 2 });
    const result = await capturedHandlers['runJobNow']?.({}, 'job-1');
    expect(result).toEqual({ success: true, data: { chatSessionId: 'sess-1', messagesCount: 2 } });
  });

  it('runJobNow handler returns error when result.success=false', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.runJobNow).mockResolvedValue({ success: false, error: 'not found' });
    const result = await capturedHandlers['runJobNow']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'not found' });
  });

  it('runJobNow handler returns default error message when result has no error', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.runJobNow).mockResolvedValue({ success: false });
    const result = await capturedHandlers['runJobNow']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'Failed to run schedule' });
  });

  it('runJobNow handler returns error on thrown exception', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.runJobNow).mockRejectedValue(new Error('boom'));
    const result = await capturedHandlers['runJobNow']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('getJobSessions handler returns error when job not found', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.getJob).mockResolvedValue(null);
    const result = await capturedHandlers['getJobSessions']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'Job not found' });
  });

  it('getJobSessions handler returns error when no user alias', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.getJob).mockResolvedValue({ id: 'j1', name: 'J', description: '', scheduleType: 'cron', cronExpression: '0 * * * *', enabled: true, agentId: 'a', message: 'm', status: 'pending' });
    vi.mocked(schedulerManager.getUserAlias).mockReturnValue(null);
    const result = await capturedHandlers['getJobSessions']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'No user alias' });
  });

  it('getJobSessions handler returns filtered sessions', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    const { profileCacheManager } = await import('../../userDataADO/profileCacheManager');
    const job = { id: 'j1', name: 'J', description: '', scheduleType: 'cron', cronExpression: '0 * * * *', enabled: true, agentId: 'agent-1', message: 'm', status: 'pending' };
    vi.mocked(schedulerManager.getJob).mockResolvedValue(job as any);
    vi.mocked(schedulerManager.getUserAlias).mockReturnValue('alice');
    vi.mocked(profileCacheManager.getChatSessionsAsync).mockResolvedValue([
      { chatSession_id: 's1', schedulerJobId: 'j1', title: 'T1', last_updated: '2026-05-10' } as any,
      { chatSession_id: 's2', schedulerJobId: 'other', title: 'T2', last_updated: '2026-05-11' } as any,
    ]);
    const result = await capturedHandlers['getJobSessions']?.({}, 'j1');
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].chatSession_id).toBe('s1');
  });

  it('getJobSessions handler returns error on thrown exception', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.getJob).mockRejectedValue(new Error('getJob failed'));
    const result = await capturedHandlers['getJobSessions']?.({}, 'j1');
    expect(result).toEqual({ success: false, error: 'getJob failed' });
  });

  it('listJobs handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.listJobs).mockRejectedValue('raw string error');
    const result = await capturedHandlers['listJobs']?.();
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('createJob handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.createJob).mockRejectedValue(42);
    const result = await capturedHandlers['createJob']?.({}, {});
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('deleteJob handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.deleteJob).mockRejectedValue(null);
    const result = await capturedHandlers['deleteJob']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('toggleJob handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.toggleJob).mockRejectedValue({});
    const result = await capturedHandlers['toggleJob']?.({}, 'job-1', true);
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('updateJob handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.updateJob).mockRejectedValue(undefined);
    const result = await capturedHandlers['updateJob']?.({}, 'job-1', {});
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('runJobNow handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.runJobNow).mockRejectedValue('oops');
    const result = await capturedHandlers['runJobNow']?.({}, 'job-1');
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('getJobSessions handler returns Unknown error when non-Error thrown', async () => {
    const { schedulerManager } = await import('../SchedulerManager');
    vi.mocked(schedulerManager.getJob).mockRejectedValue('not an error');
    const result = await capturedHandlers['getJobSessions']?.({}, 'j1');
    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });
});
