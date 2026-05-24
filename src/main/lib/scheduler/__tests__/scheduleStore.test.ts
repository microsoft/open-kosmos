vi.mock('electron', async () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('node-cron', async () => ({
  validate: vi.fn((expr: string) => {
    // Only basic validation - reject obviously invalid
    return expr !== 'INVALID';
  }),
}));

vi.mock('../../unifiedLogger', async () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../../userDataADO/scheduleSettingsManager', async () => ({
  scheduleSettingsManager: {
    ensureSchedulesDir: vi.fn(async () => '/tmp/test'),
    listScheduleMonths: vi.fn(async () => []),
    readScheduleMonth: vi.fn(async () => ({ schedulerJobs: [] })),
    writeScheduleMonth: vi.fn(async () => undefined),
    upsertScheduleJob: vi.fn(async () => undefined),
    findJobLocation: vi.fn(async () => null),
    deleteScheduleJob: vi.fn(async () => true),
  },
}));

const cronJob = {
  id: 'sched_20260401000000_device_abc123456',
  name: 'Test Cron',
  description: 'desc',
  scheduleType: 'cron' as const,
  cronExpression: '0 * * * *',
  enabled: true,
  agentId: 'agent-1',
  message: 'hello',
  status: 'pending' as const,
};

const onceJob = {
  id: 'sched_20260501000000_device_xyz789012',
  name: 'Test Once',
  description: '',
  scheduleType: 'once' as const,
  runAt: '2026-05-01T12:00:00.000Z',
  enabled: true,
  agentId: 'agent-1',
  message: 'hello',
  status: 'pending' as const,
};

describe('ScheduleStore', () => {
  let store: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();

    const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
    vi.mocked(scheduleSettingsManager.ensureSchedulesDir).mockResolvedValue('/tmp/test');
    vi.mocked(scheduleSettingsManager.listScheduleMonths).mockResolvedValue([]);
    vi.mocked(scheduleSettingsManager.readScheduleMonth).mockResolvedValue({ schedulerJobs: [] });
    vi.mocked(scheduleSettingsManager.writeScheduleMonth).mockResolvedValue(undefined);
    vi.mocked(scheduleSettingsManager.findJobLocation).mockResolvedValue(null);
    vi.mocked(scheduleSettingsManager.upsertScheduleJob as any).mockResolvedValue(undefined);
    vi.mocked(scheduleSettingsManager.deleteScheduleJob as any).mockResolvedValue(true);

    const cron = await import('node-cron');
    vi.mocked(cron.validate).mockReturnValue(true);

    const { ScheduleStore } = await import('../scheduleStore');
    store = new (ScheduleStore as any)();
  });

  describe('initialize', () => {
    it('initializes with no months', async () => {
      await expect(store.initialize('alice')).resolves.toBeUndefined();
      expect(store.getCurrentAlias()).toBe('alice');
    });

    it('loads existing months on initialize', async () => {
      const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
      vi.mocked(scheduleSettingsManager.listScheduleMonths).mockResolvedValue(['202604']);
      vi.mocked(scheduleSettingsManager.readScheduleMonth).mockResolvedValue({
        schedulerJobs: [cronJob],
      });

      await store.initialize('alice');
      const jobs = await store.listJobs('alice');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe(cronJob.id);
    });
  });

  describe('createJob', () => {
    it('creates a cron job', async () => {
      await store.initialize('alice');
      const result = await store.createJob('alice', { ...cronJob });
      expect(result.id).toBe(cronJob.id);
      expect(result.name).toBe(cronJob.name);
    });

    it('creates a once job', async () => {
      await store.initialize('alice');
      const result = await store.createJob('alice', { ...onceJob });
      expect(result.id).toBe(onceJob.id);
    });

    it('generates an id when not provided', async () => {
      await store.initialize('alice');
      const { name, description, scheduleType, cronExpression, enabled, agentId, message, status } = cronJob;
      const result = await store.createJob('alice', { name, description, scheduleType, cronExpression, enabled, agentId, message, status });
      expect(result.id).toMatch(/^sched_/);
    });

    it('throws when job already exists', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      await expect(store.createJob('alice', { ...cronJob })).rejects.toThrow('already exists');
    });

    it('throws on invalid job id', async () => {
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...cronJob, id: 'bad-id' })).rejects.toThrow('Invalid');
    });

    it('throws on missing name', async () => {
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...cronJob, name: '  ' })).rejects.toThrow('name is required');
    });

    it('throws on empty message', async () => {
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...cronJob, message: '  ' })).rejects.toThrow('message is required');
    });

    it('throws on empty agentId', async () => {
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...cronJob, agentId: '  ' })).rejects.toThrow('agentId is required');
    });

    it('throws on invalid cron expression', async () => {
      const cron = await import('node-cron');
      vi.mocked(cron.validate).mockReturnValue(false);
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...cronJob, cronExpression: 'INVALID' })).rejects.toThrow('Invalid cron');
    });

    it('throws on missing runAt for once job', async () => {
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...onceJob, runAt: undefined })).rejects.toThrow('runAt is required');
    });

    it('throws on invalid runAt date', async () => {
      await store.initialize('alice');
      await expect(store.createJob('alice', { ...onceJob, runAt: 'not-a-date' })).rejects.toThrow('Invalid runAt');
    });
  });

  describe('getJob', () => {
    it('returns null when job not found', async () => {
      await store.initialize('alice');
      const result = await store.getJob('alice', 'sched_20260401000000_device_abc123456');
      expect(result).toBeNull();
    });

    it('returns null for invalid job id', async () => {
      await store.initialize('alice');
      const result = await store.getJob('alice', 'bad-id');
      expect(result).toBeNull();
    });

    it('returns job from cache after creation', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.getJob('alice', cronJob.id);
      expect(result?.id).toBe(cronJob.id);
    });

    it('loads job from store if not in cache', async () => {
      const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
      vi.mocked(scheduleSettingsManager.findJobLocation).mockResolvedValue({
        monthKey: '202604',
        job: cronJob,
      } as any);

      await store.initialize('alice');
      const result = await store.getJob('alice', cronJob.id);
      expect(result?.id).toBe(cronJob.id);
    });
  });

  describe('updateJob', () => {
    it('returns null when job not found', async () => {
      await store.initialize('alice');
      const result = await store.updateJob('alice', cronJob.id, { name: 'New' });
      expect(result).toBeNull();
    });

    it('updates an existing job', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.updateJob('alice', cronJob.id, { name: 'Updated Name' });
      expect(result?.name).toBe('Updated Name');
    });

    it('moves a once job to a different month when runAt changes month', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...onceJob });
      // Update runAt to a different month
      const result = await store.updateJob('alice', onceJob.id, { runAt: '2026-06-15T10:00:00.000Z' });
      expect(result?.runAt).toBe('2026-06-15T10:00:00.000Z');
    });
  });

  describe('toggleJob', () => {
    it('toggles a job', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob, enabled: true });
      const result = await store.toggleJob('alice', cronJob.id, false);
      expect(result?.enabled).toBe(false);
    });
  });

  describe('deleteJob', () => {
    it('returns false when job not found', async () => {
      await store.initialize('alice');
      const result = await store.deleteJob('alice', cronJob.id);
      expect(result).toBe(false);
    });

    it('deletes an existing job', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.deleteJob('alice', cronJob.id);
      expect(result).toBe(true);
    });

    it('deletes one of two jobs in the same month (multiple remaining)', async () => {
      const cronJob2 = { ...cronJob, id: 'sched_20260415120000_device_def789012', name: 'Job 2' };
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      await store.createJob('alice', { ...cronJob2 });
      const result = await store.deleteJob('alice', cronJob.id);
      expect(result).toBe(true);
      const remaining = await store.listJobs('alice');
      expect(remaining).toHaveLength(1);
    });

    it('returns false when deleteScheduleJob returns false', async () => {
      const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
      vi.mocked(scheduleSettingsManager.deleteScheduleJob as any).mockResolvedValue(false);
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.deleteJob('alice', cronJob.id);
      expect(result).toBe(false);
    });
  });

  describe('markJobExecutionStarted', () => {
    it('marks a job as started', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.markJobExecutionStarted('alice', cronJob.id, '2026-05-11T12:00:00.000Z');
      expect(result?.lastRunAt).toBe('2026-05-11T12:00:00.000Z');
    });
  });

  describe('markJobExecutionCompleted', () => {
    it('returns null when job not found', async () => {
      await store.initialize('alice');
      const result = await store.markJobExecutionCompleted('alice', cronJob.id, '2026-05-11T12:00:00.000Z');
      expect(result).toBeNull();
    });

    it('marks a cron job as completed (keeps pending)', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.markJobExecutionCompleted('alice', cronJob.id, '2026-05-11T12:00:00.000Z');
      expect(result?.status).toBe('pending');
      expect(result?.lastFinishedAt).toBe('2026-05-11T12:00:00.000Z');
    });

    it('marks a once job as completed (sets completed)', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...onceJob });
      const result = await store.markJobExecutionCompleted('alice', onceJob.id, '2026-05-01T12:05:00.000Z');
      expect(result?.status).toBe('completed');
      expect(result?.enabled).toBe(false);
    });
  });

  describe('markJobExecutionFailed', () => {
    it('returns null when job not found', async () => {
      await store.initialize('alice');
      const result = await store.markJobExecutionFailed('alice', cronJob.id, '2026-05-11T12:00:00.000Z');
      expect(result).toBeNull();
    });

    it('marks a cron job as failed', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.markJobExecutionFailed('alice', cronJob.id, '2026-05-11T12:00:00.000Z');
      expect(result?.status).toBe('failed');
    });

    it('marks a once job as failed', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...onceJob });
      const result = await store.markJobExecutionFailed('alice', onceJob.id, '2026-05-01T12:05:00.000Z');
      expect(result?.status).toBe('failed');
      expect(result?.enabled).toBe(false);
    });
  });

  describe('markJobExpired', () => {
    it('returns null when job not found', async () => {
      await store.initialize('alice');
      const result = await store.markJobExpired('alice', cronJob.id);
      expect(result).toBeNull();
    });

    it('marks a job as expired', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      const result = await store.markJobExpired('alice', cronJob.id);
      expect(result?.status).toBe('expired');
      expect(result?.enabled).toBe(false);
    });
  });

  describe('listJobs', () => {
    it('returns empty array when no jobs', async () => {
      await store.initialize('alice');
      const jobs = await store.listJobs('alice');
      expect(jobs).toEqual([]);
    });

    it('filters by agentId', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob, agentId: 'agent-1' });
      const all = await store.listJobs('alice');
      const filtered = await store.listJobs('alice', 'agent-x');
      expect(all).toHaveLength(1);
      expect(filtered).toHaveLength(0);
    });

    it('sorts multiple jobs newest-id first', async () => {
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      await store.createJob('alice', { ...onceJob });
      const jobs = await store.listJobs('alice');
      expect(jobs).toHaveLength(2);
      // onceJob id starts with sched_20260501 which is > cronJob sched_20260401
      expect(jobs[0].id).toBe(onceJob.id);
    });
  });

  describe('clearAliasState', () => {
    it('clears cached jobs when re-initializing with the same alias', async () => {
      const { scheduleSettingsManager } = await import('../../userDataADO/scheduleSettingsManager');
      vi.mocked(scheduleSettingsManager.listScheduleMonths).mockResolvedValue(['202604']);
      vi.mocked(scheduleSettingsManager.readScheduleMonth).mockResolvedValue({
        schedulerJobs: [cronJob],
      });

      await store.initialize('alice');
      expect(await store.listJobs('alice')).toHaveLength(1);

      // Re-initialize: should clear the old cache
      vi.mocked(scheduleSettingsManager.readScheduleMonth).mockResolvedValue({ schedulerJobs: [] });
      await store.initialize('alice');
      expect(await store.listJobs('alice')).toHaveLength(0);
    });
  });

  describe('setMainWindow and notifications', () => {
    it('sets the main window without error', () => {
      store.setMainWindow({} as any);
      expect(store.mainWindow).toBeDefined();
    });

    it('clears the main window with null', () => {
      store.setMainWindow(null);
      expect(store.mainWindow).toBeNull();
    });

    it('notifies via window when window has webContents', async () => {
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend },
      };
      store.setMainWindow(mockWindow as any);

      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });

      expect(mockSend).toHaveBeenCalledWith('scheduleStore:jobCreated', expect.objectContaining({ alias: 'alice' }));
    });

    it('notifies via BrowserWindow.getAllWindows when mainWindow is null', async () => {
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend },
      };
      const electron = await import('electron');
      vi.mocked(electron.BrowserWindow.getAllWindows).mockReturnValue([mockWindow as any]);

      store.setMainWindow(null);
      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });

      expect(mockSend).toHaveBeenCalledWith('scheduleStore:jobCreated', expect.objectContaining({ alias: 'alice' }));
    });

    it('sends jobPatched notification on update', async () => {
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend },
      };
      store.setMainWindow(mockWindow as any);

      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      mockSend.mockClear();
      await store.updateJob('alice', cronJob.id, { name: 'Updated' });

      expect(mockSend).toHaveBeenCalledWith('scheduleStore:jobPatched', expect.objectContaining({ jobId: cronJob.id }));
    });

    it('sends jobDeleted notification on delete', async () => {
      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: () => false,
        webContents: { send: mockSend },
      };
      store.setMainWindow(mockWindow as any);

      await store.initialize('alice');
      await store.createJob('alice', { ...cronJob });
      mockSend.mockClear();
      await store.deleteJob('alice', cronJob.id);

      expect(mockSend).toHaveBeenCalledWith('scheduleStore:jobDeleted', expect.objectContaining({ jobId: cronJob.id }));
    });
  });
});
