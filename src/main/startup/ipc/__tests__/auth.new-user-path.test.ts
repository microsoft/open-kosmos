/**
 * New-user critical path tests.
 *
 * Validates the complete journey a new user takes from first app launch:
 *   Device Flow login → background services init → subsystems usable
 *
 * These tests exist because PR #807 discovered that device flow login
 * bypassed background service initialization (scheduler/buddy),
 * causing "Scheduler is not initialized" errors for first-time users.
 *
 * Key guarantees tested:
 *   1. Device flow login initializes ALL background services
 *   2. Services are initialized with the correct user identifier
 *   3. Initialization failures don't block the login flow (v2.7.10 regression guard)
 *   4. Session restore path initializes the same services
 *   5. Account switch properly disposes old → inits new
 *   6. Non-blocking semantics: IPC handler returns BEFORE background init completes
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockHandle = vi.hoisted(() => vi.fn());

const mockAuthManager = vi.hoisted(() => ({
  getLocalActiveAuths: vi.fn().mockResolvedValue([]),
  setCurrentAuth: vi.fn().mockResolvedValue(undefined),
  getCurrentAuth: vi.fn().mockReturnValue(null),
  destroyCurrentAuth: vi.fn().mockResolvedValue(undefined),
  getCopilotAccessToken: vi.fn().mockReturnValue('tok-123'),
  refreshCopilotToken: vi.fn().mockResolvedValue({ token: 'refreshed' }),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

const mockTokenMonitor = vi.hoisted(() => ({
  stopMonitoring: vi.fn(),
  getMonitoringStatus: vi.fn().mockReturnValue({ active: true }),
  manualCheck: vi.fn().mockResolvedValue(undefined),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockSchedulerManager = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  getRuntimeDiagnostics: vi.fn().mockReturnValue({}),
}));

const mockBuddyManagerInstance = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
}));

const mockGhcAuthManager = vi.hoisted(() => ({
  performDeviceFlowAuthentication: vi.fn().mockResolvedValue(undefined),
}));

const mockIsFeatureEnabled = vi.hoisted(() => vi.fn().mockReturnValue(false));

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/test-userData',
    getVersion: () => '1.0.0',
    getName: () => 'openkosmos',
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
  },
  ipcMain: { handle: (...args: any[]) => mockHandle(...args) },
  ipcRenderer: { on: vi.fn(), send: vi.fn() },
  BrowserWindow: vi.fn(),
  shell: { openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
  screen: { getPrimaryDisplay: vi.fn(() => ({ workAreaSize: { width: 1920, height: 1080 } })) },
  systemPreferences: { getMediaAccessStatus: vi.fn() },
  globalShortcut: { register: vi.fn(), unregisterAll: vi.fn() },
  Notification: vi.fn(),
}));

vi.mock('../../../lib/featureFlags', () => ({
  isFeatureEnabled: (...args: any[]) => mockIsFeatureEnabled(...args),
}));

vi.mock('../../lazy', () => ({
  getMainAuthManager: vi.fn().mockResolvedValue(mockAuthManager),
  getMainTokenMonitor: vi.fn().mockResolvedValue(mockTokenMonitor),
  getAdvancedLogger: () => mockLogger,
}));

vi.mock('../../../lib/scheduler/SchedulerManager', () => ({
  schedulerManager: mockSchedulerManager,
}));

vi.mock('../../../lib/auth/ghcAuth', () => ({
  ghcAuthManager: mockGhcAuthManager,
}));

vi.mock('../../../lib/buddy/BuddyManager', () => ({
  BuddyManager: {
    getInstance: () => mockBuddyManagerInstance,
  },
}));

// ── helpers ────────────────────────────────────────────────────────────────────
function getHandler(channel: string): (...args: any[]) => Promise<any> {
  const call = mockHandle.mock.calls.find(([name]: any[]) => name === channel);
  if (!call) throw new Error(`Handler not registered for channel: ${channel}`);
  return call[1];
}

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    currentUserAlias: null as string | null,
    _schedulerInitPromise: undefined as Promise<void> | undefined,
    _buddyInitPromise: undefined as Promise<void> | undefined,
    registerGlobalShortcuts: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockEvent() {
  return {
    sender: { isDestroyed: () => false, send: vi.fn() },
  };
}

function setupDeviceFlowLogin(userLogin: string) {
  const authInfo = { ghcAuth: { user: { login: userLogin }, alias: userLogin } };
  mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
    async (_onDeviceCode: any, _onError: any, onSuccess: any) => {
      await onSuccess(authInfo);
    },
  );
  return authInfo;
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('New user critical path — Device Flow login', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
    ctx = makeCtx();
    const { default: registerAuthIPC } = await import('../auth');
    registerAuthIPC(ctx as any);
  });

  describe('all background services initialize after device flow login', () => {
    it('SchedulerManager.initialize is called with correct user', async () => {
      setupDeviceFlowLogin('newuser');
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(makeMockEvent());
      await ctx._schedulerInitPromise;
      expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('newuser');
    });

    it('BuddyManager.initialize is called with correct user', async () => {
      setupDeviceFlowLogin('newuser');
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(makeMockEvent());
      await ctx._buddyInitPromise;
      expect(mockBuddyManagerInstance.initialize).toHaveBeenCalledWith('newuser');
    });

    it('currentUserAlias is set correctly', async () => {
      setupDeviceFlowLogin('newuser');
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(makeMockEvent());
      expect(ctx.currentUserAlias).toBe('newuser');
    });

    it('renderer is notified of success after init', async () => {
      setupDeviceFlowLogin('newuser');
      const mockEvent = makeMockEvent();
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);
      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        'auth:deviceFlowSuccess',
        expect.objectContaining({ authInfo: expect.any(Object) }),
      );
    });
  });

  describe('non-blocking semantics (v2.7.10 regression guard)', () => {
    it('device flow handler returns before scheduler init completes', async () => {
      let resolveScheduler!: () => void;
      mockSchedulerManager.initialize.mockReturnValueOnce(
        new Promise<void>((resolve) => { resolveScheduler = resolve; }),
      );

      setupDeviceFlowLogin('newuser');
      const mockEvent = makeMockEvent();
      const handler = getHandler('auth:startGhcDeviceFlow');

      // Handler should return immediately, not wait for scheduler
      const result = await handler(mockEvent);
      expect(result).toEqual({ success: true, message: expect.any(String) });

      // deviceFlowSuccess should have been sent already
      expect(mockEvent.sender.send).toHaveBeenCalledWith('auth:deviceFlowSuccess', expect.any(Object));

      // Scheduler is still initializing
      expect(mockSchedulerManager.initialize).toHaveBeenCalled();

      // Clean up
      resolveScheduler();
      await ctx._schedulerInitPromise;
    });

    it('session restore handler returns before scheduler init completes', async () => {
      let resolveScheduler!: () => void;
      mockSchedulerManager.initialize.mockReturnValueOnce(
        new Promise<void>((resolve) => { resolveScheduler = resolve; }),
      );

      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, { ghcAuth: { user: { login: 'restoreuser' } } });

      // Handler should return immediately
      expect(result).toEqual({ success: true });

      // Scheduler init is still pending
      let schedulerDone = false;
      ctx._schedulerInitPromise?.then(() => { schedulerDone = true; });
      await new Promise((r) => setImmediate(r));
      expect(schedulerDone).toBe(false);

      // Clean up
      resolveScheduler();
      await ctx._schedulerInitPromise;
    });

    it('device flow handler returns before buddy init completes', async () => {
      let resolveBuddy!: () => void;
      mockBuddyManagerInstance.initialize.mockReturnValueOnce(
        new Promise<void>((resolve) => { resolveBuddy = resolve; }),
      );

      setupDeviceFlowLogin('newuser');
      const handler = getHandler('auth:startGhcDeviceFlow');
      const result = await handler(makeMockEvent());
      expect(result).toEqual({ success: true, message: expect.any(String) });

      // Buddy is still initializing
      let buddyDone = false;
      ctx._buddyInitPromise?.then(() => { buddyDone = true; });
      await new Promise((r) => setImmediate(r));
      expect(buddyDone).toBe(false);

      resolveBuddy();
      await ctx._buddyInitPromise;
    });

  });

  describe('service initialization failures do not block login', () => {
    it('login succeeds when SchedulerManager.initialize fails', async () => {
      mockSchedulerManager.initialize.mockRejectedValueOnce(new Error('scheduler init failed'));
      setupDeviceFlowLogin('newuser');
      const mockEvent = makeMockEvent();
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      expect(ctx.currentUserAlias).toBe('newuser');
      expect(mockEvent.sender.send).toHaveBeenCalledWith('auth:deviceFlowSuccess', expect.any(Object));
      await ctx._schedulerInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] SchedulerManager initialization failed',
        expect.any(String),
        expect.objectContaining({ error: 'scheduler init failed' }),
      );
    });

    it('login succeeds when BuddyManager.initialize fails', async () => {
      mockBuddyManagerInstance.initialize.mockRejectedValueOnce(new Error('buddy init failed'));
      setupDeviceFlowLogin('newuser');
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(makeMockEvent());

      expect(ctx.currentUserAlias).toBe('newuser');
      await ctx._buddyInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] BuddyManager initialization failed',
        expect.any(String),
        expect.objectContaining({ error: 'buddy init failed' }),
      );
    });

    it('login succeeds when background services fail simultaneously', async () => {
      mockSchedulerManager.initialize.mockRejectedValueOnce(new Error('sched fail'));
      mockBuddyManagerInstance.initialize.mockRejectedValueOnce(new Error('buddy fail'));

      setupDeviceFlowLogin('newuser');
      const mockEvent = makeMockEvent();
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      expect(ctx.currentUserAlias).toBe('newuser');
      expect(mockEvent.sender.send).toHaveBeenCalledWith('auth:deviceFlowSuccess', expect.any(Object));
      await ctx._schedulerInitPromise;
      await ctx._buddyInitPromise;
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('device flow and session restore parity', () => {
    it('session restore initializes all the same services', async () => {
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, { ghcAuth: { user: { login: 'restoreuser' } } });

      await ctx._schedulerInitPromise;
      await ctx._buddyInitPromise;
      await new Promise((r) => setImmediate(r));

      expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('restoreuser');
      expect(mockBuddyManagerInstance.initialize).toHaveBeenCalledWith('restoreuser');
    });

    it('device flow initializes all the same services', async () => {
      setupDeviceFlowLogin('flowuser');
      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(makeMockEvent());

      await ctx._schedulerInitPromise;
      await ctx._buddyInitPromise;
      await new Promise((r) => setImmediate(r));

      expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('flowuser');
      expect(mockBuddyManagerInstance.initialize).toHaveBeenCalledWith('flowuser');
    });
  });
});

describe('New user critical path — account switch', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
    ctx = makeCtx();
    const { default: registerAuthIPC } = await import('../auth');
    registerAuthIPC(ctx as any);
  });

  it('destroy disposes scheduler before new login re-initializes', async () => {
    // First login via device flow
    setupDeviceFlowLogin('alice');
    const flowHandler = getHandler('auth:startGhcDeviceFlow');
    await flowHandler(makeMockEvent());
    await ctx._schedulerInitPromise;
    expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('alice');

    // Destroy session
    const destroyHandler = getHandler('auth:destroyCurrentSession');
    await destroyHandler();
    expect(mockSchedulerManager.dispose).toHaveBeenCalled();
    expect(ctx.currentUserAlias).toBeNull();

    // Second login via session restore
    const sessionHandler = getHandler('auth:setCurrentSession');
    await sessionHandler({}, { ghcAuth: { user: { login: 'bob' } } });
    await ctx._schedulerInitPromise;
    expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('bob');
    expect(ctx.currentUserAlias).toBe('bob');
  });

  it('rapid account switch chains scheduler init promises correctly', async () => {
    const initOrder: string[] = [];
    mockSchedulerManager.initialize.mockImplementation(async (alias: string) => {
      initOrder.push(alias);
    });

    const sessionHandler = getHandler('auth:setCurrentSession');
    await sessionHandler({}, { ghcAuth: { user: { login: 'userA' } } });
    await sessionHandler({}, { ghcAuth: { user: { login: 'userB' } } });

    await ctx._schedulerInitPromise;
    expect(initOrder).toEqual(['userA', 'userB']);
  });
});

describe('New user critical path — feature flag disabled', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsFeatureEnabled.mockReturnValue(false);
    ctx = makeCtx();
    const { default: registerAuthIPC } = await import('../auth');
    registerAuthIPC(ctx as any);
  });

  it('device flow login succeeds even with scheduler feature disabled', async () => {
    setupDeviceFlowLogin('newuser');
    const handler = getHandler('auth:startGhcDeviceFlow');
    await handler(makeMockEvent());

    expect(ctx.currentUserAlias).toBe('newuser');
    expect(mockSchedulerManager.initialize).not.toHaveBeenCalled();
    await ctx._buddyInitPromise;
    await new Promise((r) => setImmediate(r));
    expect(mockBuddyManagerInstance.initialize).toHaveBeenCalledWith('newuser');
  });

});
