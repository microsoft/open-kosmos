/**
 * New-user critical path — real filesystem initialization tests.
 *
 * Unlike the IPC-layer tests in auth.new-user-path.test.ts (which mock subsystems),
 * these tests run the REAL subsystem initialization against a temp directory to verify
 * that first-time directory creation, file writes, and empty-state handling all work.
 *
 * Covers Issue #811 scenarios (partial — scheduler/store layer):
 *   - Fresh machine: scheduleStore / runtimeStateStore on empty dir
 *   - New user on existing machine: profile isolation and alias collision
 *
 * Not covered here (follow-up work for #811):
 *   - profileCacheManager.handleProfile() real-FS initialization
 *   - Full SchedulerManager.initialize() chain against real FS
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

// ── mock electron app to use temp dir ──────────────────────────────────────────
const testUserDataPath = vi.hoisted(() => ({ value: '' }));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return testUserDataPath.value;
      return `/tmp/test-electron-${name}`;
    },
    getVersion: () => '1.0.0',
    getName: () => 'openkosmos',
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    setPath: vi.fn(),
    setName: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows: vi.fn().mockReturnValue([]) }),
  shell: { openExternal: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock chat dependencies that runtimeStateStore / scheduleStore don't need
vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: {
    runScheduledJob: vi.fn(),
  },
}));

vi.mock('../../chat/chatSessionStore', () => ({
  chatSessionStore: {
    getChatSessionsProjection: vi.fn().mockResolvedValue({ sessions: [] }),
    patchSchedulerMetadata: vi.fn(),
  },
}));

vi.mock('../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    getAllChatConfigs: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('node-cron', () => ({
  schedule: vi.fn(() => ({ stop: vi.fn() })),
  validate: (expr: string) => /^[\d*\/,-]+( [\d*\/,-]+){4,5}$/.test(expr.trim()),
}));

// ── tests ──────────────────────────────────────────────────────────────────────

describe('New user critical path — fresh filesystem initialization', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-fresh-install-'));
    testUserDataPath.value = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('scheduleStore on empty profile', () => {
    it('creates schedules directory on first initialize', async () => {
      const { scheduleStore } = await import('../../scheduler/scheduleStore');
      await scheduleStore.initialize('newuser');

      const schedulesDir = path.join(tempDir, 'profiles', 'newuser', 'schedules');
      expect(fs.existsSync(schedulesDir)).toBe(true);
    });

    it('listJobs returns empty array on fresh profile', async () => {
      const { scheduleStore } = await import('../../scheduler/scheduleStore');
      await scheduleStore.initialize('newuser');

      const jobs = await scheduleStore.listJobs('newuser');
      expect(jobs).toEqual([]);
    });

    it('createJob succeeds on fresh profile', async () => {
      const { scheduleStore } = await import('../../scheduler/scheduleStore');
      await scheduleStore.initialize('newuser');

      const { generateScheduleJobId } = await import('../../scheduler/id');
      const job = await scheduleStore.createJob('newuser', {
        id: generateScheduleJobId(),
        name: 'Test Schedule',
        description: 'First schedule',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        message: 'hello',
        chat_id: 'agent-1',
        status: 'pending',
        enabled: true,
      });

      expect(job).toBeDefined();
      expect(job.name).toBe('Test Schedule');

      // Verify persisted to disk
      const jobs = await scheduleStore.listJobs('newuser');
      expect(jobs.length).toBe(1);
      expect(jobs[0].name).toBe('Test Schedule');
    });
  });

  describe('schedulerRuntimeStateStore on empty profile', () => {
    it('readState returns default state when no runtime-state.json exists', async () => {
      const { SchedulerRuntimeStateStore } = await import('../../scheduler/schedulerRuntimeStateStore');
      const store = new (SchedulerRuntimeStateStore as any)();

      const state = await store.readState('freshuser');
      expect(state.alias).toBe('freshuser');
      expect(state.isActive).toBe(false);
      expect(state.schemaVersion).toBe(1);
    });

    it('markActivated creates runtime-state.json on first call', async () => {
      const { SchedulerRuntimeStateStore } = await import('../../scheduler/schedulerRuntimeStateStore');
      const store = new (SchedulerRuntimeStateStore as any)();

      const result = await store.markActivated('freshuser', '2026-06-15T12:00:00.000Z');
      expect(result.isActive).toBe(true);

      // Verify file was created on disk
      const stateFile = path.join(tempDir, 'profiles', 'freshuser', 'schedules', 'runtime-state.json');
      expect(fs.existsSync(stateFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      expect(content.isActive).toBe(true);
      expect(content.lastActivatedAt).toBe('2026-06-15T12:00:00.000Z');
    });

    it('state survives read-after-write cycle', async () => {
      const { SchedulerRuntimeStateStore } = await import('../../scheduler/schedulerRuntimeStateStore');
      const store = new (SchedulerRuntimeStateStore as any)();

      await store.markActivated('freshuser', '2026-06-15T12:00:00.000Z');
      await store.markDeactivated('freshuser', '2026-06-15T13:00:00.000Z');

      const state = await store.readState('freshuser');
      expect(state.isActive).toBe(false);
      expect(state.lastActivatedAt).toBe('2026-06-15T12:00:00.000Z');
      expect(state.lastDeactivatedAt).toBe('2026-06-15T13:00:00.000Z');
    });
  });

  describe('profile directory creation', () => {
    it('getProfileDirectoryPath creates nested directory tree on first call', async () => {
      const { getProfileDirectoryPath } = await import('../../userDataADO/pathUtils');

      const profileDir = getProfileDirectoryPath('brand-new-user');

      expect(fs.existsSync(profileDir)).toBe(true);
      expect(profileDir).toContain(path.join('profiles', 'brand-new-user'));
    });

    it('getProfileDirectoryPath is idempotent', async () => {
      const { getProfileDirectoryPath } = await import('../../userDataADO/pathUtils');

      const dir1 = getProfileDirectoryPath('testuser');
      const dir2 = getProfileDirectoryPath('testuser');

      expect(dir1).toBe(dir2);
      expect(fs.existsSync(dir1)).toBe(true);
    });

    it('getProfileDirectoryPath throws on empty alias', async () => {
      const { getProfileDirectoryPath } = await import('../../userDataADO/pathUtils');

      expect(() => getProfileDirectoryPath('')).toThrow('Profile alias is required');
    });
  });
});

describe('New user critical path — multi-user isolation', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openkosmos-multi-user-'));
    testUserDataPath.value = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('two users get isolated profile directories', async () => {
    const { getProfileDirectoryPath } = await import('../../userDataADO/pathUtils');

    const aliceDir = getProfileDirectoryPath('alice');
    const bobDir = getProfileDirectoryPath('bob');

    expect(aliceDir).not.toBe(bobDir);
    expect(fs.existsSync(aliceDir)).toBe(true);
    expect(fs.existsSync(bobDir)).toBe(true);
  });

  it('two users get isolated schedule stores', async () => {
    const { scheduleStore } = await import('../../scheduler/scheduleStore');

    await scheduleStore.initialize('alice');
    await scheduleStore.initialize('bob');

    // Alice creates a job
    const { generateScheduleJobId } = await import('../../scheduler/id');
    await scheduleStore.createJob('alice', {
      id: generateScheduleJobId(),
      name: 'Alice Schedule',
      description: '',
      scheduleType: 'cron',
      cronExpression: '0 9 * * *',
      message: 'alice msg',
      chat_id: 'agent-1',
      status: 'pending',
      enabled: true,
    });

    // Bob should see no jobs
    const bobJobs = await scheduleStore.listJobs('bob');
    expect(bobJobs).toEqual([]);

    // Alice should see her job
    const aliceJobs = await scheduleStore.listJobs('alice');
    expect(aliceJobs.length).toBe(1);
    expect(aliceJobs[0].name).toBe('Alice Schedule');
  });

  it('two users get isolated runtime state', async () => {
    const { SchedulerRuntimeStateStore } = await import('../../scheduler/schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();

    await store.markActivated('alice', '2026-06-15T10:00:00.000Z');

    // Bob's state should be independent
    const bobState = await store.readState('bob');
    expect(bobState.isActive).toBe(false);

    // Alice's state is still active
    const aliceState = await store.readState('alice');
    expect(aliceState.isActive).toBe(true);
  });

  it('alias collision: new user with same alias inherits old data (known risk)', async () => {
    const { scheduleStore } = await import('../../scheduler/scheduleStore');
    const { SchedulerRuntimeStateStore } = await import('../../scheduler/schedulerRuntimeStateStore');
    const store = new (SchedulerRuntimeStateStore as any)();

    // First "alice" creates data
    await scheduleStore.initialize('alice');
    const { generateScheduleJobId } = await import('../../scheduler/id');
    await scheduleStore.createJob('alice', {
      id: generateScheduleJobId(),
      name: 'Old Alice Job',
      description: '',
      scheduleType: 'cron',
      cronExpression: '0 9 * * *',
      message: 'old',
      chat_id: 'agent-1',
      status: 'pending',
      enabled: true,
    });
    await store.markActivated('alice', '2026-01-01T00:00:00.000Z');
    await store.markDeactivated('alice', '2026-01-01T01:00:00.000Z');

    // "New alice" signs in — same alias, sees OLD data (this is the risk!)
    await scheduleStore.initialize('alice');
    const jobs = await scheduleStore.listJobs('alice');
    const state = await store.readState('alice');

    // Document the current behavior: old data persists across alias reuse
    // This is the alias collision risk identified in Issue #811
    expect(jobs.length).toBe(1);
    expect(jobs[0].name).toBe('Old Alice Job');
    expect(state.lastDeactivatedAt).toBe('2026-01-01T01:00:00.000Z');
  });
});
