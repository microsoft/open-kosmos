import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockHandle = vi.hoisted(() => vi.fn());

const mockAuthManager = vi.hoisted(() => ({
  getLocalActiveAuths: vi.fn().mockResolvedValue([{ id: 'session1' }]),
  setCurrentAuth: vi.fn().mockResolvedValue(undefined),
  getCurrentAuth: vi.fn().mockReturnValue({ id: 'session1' }),
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

// ── tests ──────────────────────────────────────────────────────────────────────
describe('startup/ipc/auth', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockIsFeatureEnabled.mockReturnValue(false);
    ctx = makeCtx();
    const { default: registerAuthIPC } = await import('../auth');
    registerAuthIPC(ctx as any);
  });

  // ── auth:getLocalActiveSessions ──────────────────────────────────────────────
  describe('auth:getLocalActiveSessions', () => {
    it('returns sessions on success', async () => {
      const handler = getHandler('auth:getLocalActiveSessions');
      const result = await handler();
      expect(result).toEqual({ success: true, data: [{ id: 'session1' }] });
    });

    it('returns error on failure', async () => {
      mockAuthManager.getLocalActiveAuths.mockRejectedValueOnce(new Error('db error'));
      const handler = getHandler('auth:getLocalActiveSessions');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'db error' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockAuthManager.getLocalActiveAuths.mockRejectedValueOnce('string error');
      const handler = getHandler('auth:getLocalActiveSessions');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:setCurrentSession ───────────────────────────────────────────────────
  describe('auth:setCurrentSession', () => {
    const validAuthData = {
      ghcAuth: { user: { login: 'testuser' } },
    };

    it('returns error on invalid authData (null)', async () => {
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, null);
      expect(result.success).toBe(false);
    });

    it('returns error when ghcAuth missing', async () => {
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, {});
      expect(result.success).toBe(false);
    });

    it('returns error when user login missing', async () => {
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, { ghcAuth: {} });
      expect(result.success).toBe(false);
    });

    it('sets currentUserAlias on success', async () => {
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: true });
      expect(ctx.currentUserAlias).toBe('testuser');
    });

    it('calls setCurrentAuth', async () => {
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      expect(mockAuthManager.setCurrentAuth).toHaveBeenCalledWith(validAuthData);
    });

    it('calls registerGlobalShortcuts', async () => {
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      expect(ctx.registerGlobalShortcuts).toHaveBeenCalled();
    });

    it('chains scheduler init in background when feature enabled', async () => {
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      expect(ctx._schedulerInitPromise).toBeDefined();
      // Wait for background init
      await ctx._schedulerInitPromise;
      expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('testuser');
    });

    it('chains buddyManager init in background', async () => {
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      expect(ctx._buddyInitPromise).toBeDefined();
      await ctx._buddyInitPromise;
      expect(mockBuddyManagerInstance.initialize).toHaveBeenCalledWith('testuser');
    });

    it('keeps buddy init promise pending until initialization finishes', async () => {
      let resolveBuddy!: () => void;
      mockBuddyManagerInstance.initialize.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveBuddy = resolve;
        }),
      );

      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);

      let buddyPromiseSettled = false;
      ctx._buddyInitPromise?.then(() => {
        buddyPromiseSettled = true;
      });
      await new Promise((r) => setImmediate(r));
      expect(buddyPromiseSettled).toBe(false);

      resolveBuddy();
      await ctx._buddyInitPromise;
      expect(buddyPromiseSettled).toBe(true);
    });

    it('returns error when setCurrentAuth throws', async () => {
      mockAuthManager.setCurrentAuth.mockRejectedValueOnce(new Error('auth fail'));
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: false, error: 'auth fail' });
    });

    it('returns Unknown error when setCurrentAuth throws non-Error', async () => {
      mockAuthManager.setCurrentAuth.mockRejectedValueOnce('string error');
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('deduplicates concurrent calls for the same user (runs the flow once)', async () => {
      let resolveAuth!: () => void;
      mockAuthManager.setCurrentAuth.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveAuth = resolve;
        }),
      );

      const handler = getHandler('auth:setCurrentSession');
      const p1 = handler({}, validAuthData);
      const p2 = handler({}, validAuthData);
      await new Promise((r) => setImmediate(r));

      // The second call reuses the in-flight promise instead of re-running.
      expect(mockAuthManager.setCurrentAuth).toHaveBeenCalledTimes(1);

      resolveAuth();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual({ success: true });
      expect(r2).toEqual({ success: true });
    });

    it('runs the full flow again after the previous call has settled', async () => {
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      await handler({}, validAuthData);
      // The in-flight entry is cleared on completion, so each settled call re-runs.
      expect(mockAuthManager.setCurrentAuth).toHaveBeenCalledTimes(2);
    });

    it('handles scheduler initialization failure gracefully', async () => {
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      mockSchedulerManager.initialize.mockRejectedValueOnce(new Error('scheduler init error'));
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: true });
      // Wait for background init to complete
      await ctx._schedulerInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] SchedulerManager initialization failed',
        'auth:setCurrentSession',
        expect.objectContaining({ userLogin: 'testuser', error: 'scheduler init error' }),
      );
    });

    it('handles BuddyManager initialization failure gracefully', async () => {
      mockBuddyManagerInstance.initialize.mockRejectedValueOnce(new Error('buddy init error'));
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: true });
      // Wait for background init to complete
      await ctx._buddyInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] BuddyManager initialization failed',
        'auth:setCurrentSession',
        expect.objectContaining({ userLogin: 'testuser', error: 'buddy init error' }),
      );
    });

    it('handles non-Error scheduler initialization failure', async () => {
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      mockSchedulerManager.initialize.mockRejectedValueOnce('string error');
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: true });
      await ctx._schedulerInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] SchedulerManager initialization failed',
        'auth:setCurrentSession',
        expect.objectContaining({ userLogin: 'testuser', error: 'string error' }),
      );
    });

    it('handles non-Error BuddyManager initialization failure', async () => {
      mockBuddyManagerInstance.initialize.mockRejectedValueOnce('buddy string error');
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: true });
      await ctx._buddyInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] BuddyManager initialization failed',
        'auth:setCurrentSession',
        expect.objectContaining({ userLogin: 'testuser', error: 'buddy string error' }),
      );
    });

  });

  // ── auth:getCurrentSession ───────────────────────────────────────────────────
  describe('auth:getCurrentSession', () => {
    it('returns current session', async () => {
      const handler = getHandler('auth:getCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: true, data: { id: 'session1' } });
    });

    it('returns error on failure', async () => {
      mockAuthManager.getCurrentAuth.mockImplementationOnce(() => { throw new Error('no session'); });
      const handler = getHandler('auth:getCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'no session' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockAuthManager.getCurrentAuth.mockImplementationOnce(() => { throw 'string error'; });
      const handler = getHandler('auth:getCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:destroyCurrentSession ───────────────────────────────────────────────
  describe('auth:destroyCurrentSession', () => {
    it('destroys session and clears alias', async () => {
      ctx.currentUserAlias = 'testuser';
      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: true });
      expect(ctx.currentUserAlias).toBeNull();
      expect(mockAuthManager.destroyCurrentAuth).toHaveBeenCalled();
    });

    it('returns success even when no scheduler feature', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockReturnValue(false);
      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result.success).toBe(true);
    });

    it('disposes scheduler when feature enabled', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      const handler = getHandler('auth:destroyCurrentSession');
      await handler();
      expect(mockSchedulerManager.dispose).toHaveBeenCalled();
    });

    it('waits for pending scheduler init before disposing', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      let resolveInit!: () => void;
      ctx._schedulerInitPromise = new Promise<void>((r) => { resolveInit = r; });
      const handler = getHandler('auth:destroyCurrentSession');
      const destroyPromise = handler();
      // Not yet disposed
      await new Promise((r) => setImmediate(r));
      expect(mockSchedulerManager.dispose).not.toHaveBeenCalled();
      resolveInit();
      await destroyPromise;
      expect(mockSchedulerManager.dispose).toHaveBeenCalled();
    });

    it('aborts destroy when alias changed during init wait', async () => {
      ctx.currentUserAlias = 'userA';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      let resolveInit!: () => void;
      ctx._schedulerInitPromise = new Promise<void>((r) => { resolveInit = r; });
      const handler = getHandler('auth:destroyCurrentSession');
      const destroyPromise = handler();
      // Change alias before init resolves
      ctx.currentUserAlias = 'userB';
      resolveInit();
      const result = await destroyPromise;
      expect(result).toEqual({ success: true });
      expect(mockSchedulerManager.dispose).not.toHaveBeenCalled();
      expect(mockAuthManager.destroyCurrentAuth).not.toHaveBeenCalled();
    });

    it('returns error on unexpected exception', async () => {
      ctx.currentUserAlias = 'user1';
      mockAuthManager.destroyCurrentAuth.mockRejectedValueOnce(new Error('destroy fail'));
      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'destroy fail' });
    });

    it('handles scheduler dispose failure gracefully', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      mockSchedulerManager.dispose.mockRejectedValueOnce(new Error('dispose error'));
      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: true });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] SchedulerManager dispose failed during session destroy',
        'auth:destroyCurrentSession',
        expect.objectContaining({ error: 'dispose error' }),
      );
    });

    it('handles non-Error scheduler dispose failure', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      mockSchedulerManager.dispose.mockRejectedValueOnce('string dispose error');
      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: true });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] SchedulerManager dispose failed during session destroy',
        'auth:destroyCurrentSession',
        expect.objectContaining({ error: 'string dispose error' }),
      );
    });

    it('returns Unknown error on non-Error destroy exception', async () => {
      ctx.currentUserAlias = 'user1';
      mockAuthManager.destroyCurrentAuth.mockRejectedValueOnce('string destroy error');
      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('clears scheduler init promise only when unchanged during wait', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      const originalPromise = Promise.resolve();
      ctx._schedulerInitPromise = originalPromise;
      const handler = getHandler('auth:destroyCurrentSession');
      await handler();
      // Promise should be cleared since it was unchanged
      expect(ctx._schedulerInitPromise).toBeUndefined();
    });

    it('preserves new scheduler init promise if replaced during wait', async () => {
      ctx.currentUserAlias = 'user1';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');

      let resolveOriginal!: () => void;
      const originalPromise = new Promise<void>((r) => { resolveOriginal = r; });
      ctx._schedulerInitPromise = originalPromise;

      const handler = getHandler('auth:destroyCurrentSession');
      const destroyPromise = handler();

      // Replace the promise before original resolves (simulating a new login)
      const newPromise = Promise.resolve();
      ctx._schedulerInitPromise = newPromise;
      ctx.currentUserAlias = 'user2'; // Also change alias to trigger abort

      resolveOriginal();
      await destroyPromise;

      // New promise should be preserved
      expect(ctx._schedulerInitPromise).toBe(newPromise);
    });

    it('aborts session destroy when alias changes after scheduler dispose', async () => {
      ctx.currentUserAlias = 'userA';
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');

      // Make dispose slow enough to allow alias change
      mockSchedulerManager.dispose.mockImplementationOnce(async () => {
        // Simulate alias change during dispose
        ctx.currentUserAlias = 'userB';
      });

      const handler = getHandler('auth:destroyCurrentSession');
      const result = await handler();
      expect(result).toEqual({ success: true });
      // destroyCurrentAuth should not be called since alias changed
      expect(mockAuthManager.destroyCurrentAuth).not.toHaveBeenCalled();
    });
  });

  // ── auth:getAccessToken ──────────────────────────────────────────────────────
  describe('auth:getAccessToken', () => {
    it('returns access token', async () => {
      const handler = getHandler('auth:getAccessToken');
      const result = await handler();
      expect(result).toEqual({ success: true, data: 'tok-123' });
    });

    it('returns error on failure', async () => {
      mockAuthManager.getCopilotAccessToken.mockImplementationOnce(() => { throw new Error('no token'); });
      const handler = getHandler('auth:getAccessToken');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'no token' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockAuthManager.getCopilotAccessToken.mockImplementationOnce(() => { throw 'string error'; });
      const handler = getHandler('auth:getAccessToken');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:refreshCurrentSessionToken ─────────────────────────────────────────
  describe('auth:refreshCurrentSessionToken', () => {
    it('returns refreshed token data', async () => {
      const handler = getHandler('auth:refreshCurrentSessionToken');
      const result = await handler();
      expect(result).toEqual({ success: true, data: { token: 'refreshed' } });
    });

    it('returns error on failure', async () => {
      mockAuthManager.refreshCopilotToken.mockRejectedValueOnce(new Error('refresh fail'));
      const handler = getHandler('auth:refreshCurrentSessionToken');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'refresh fail' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockAuthManager.refreshCopilotToken.mockRejectedValueOnce('string error');
      const handler = getHandler('auth:refreshCurrentSessionToken');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:stopTokenMonitoring ─────────────────────────────────────────────────
  describe('auth:stopTokenMonitoring', () => {
    it('stops monitoring and returns success', async () => {
      const handler = getHandler('auth:stopTokenMonitoring');
      const result = await handler();
      expect(result).toEqual({ success: true });
      expect(mockTokenMonitor.stopMonitoring).toHaveBeenCalled();
    });

    it('returns error on failure', async () => {
      mockTokenMonitor.stopMonitoring.mockImplementationOnce(() => { throw new Error('stop fail'); });
      const handler = getHandler('auth:stopTokenMonitoring');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'stop fail' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockTokenMonitor.stopMonitoring.mockImplementationOnce(() => { throw 'string error'; });
      const handler = getHandler('auth:stopTokenMonitoring');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:getMonitoringStatus ─────────────────────────────────────────────────
  describe('auth:getMonitoringStatus', () => {
    it('returns monitoring status', async () => {
      const handler = getHandler('auth:getMonitoringStatus');
      const result = await handler();
      expect(result).toEqual({ success: true, data: { active: true } });
    });

    it('returns error on failure', async () => {
      mockTokenMonitor.getMonitoringStatus.mockImplementationOnce(() => { throw new Error('status fail'); });
      const handler = getHandler('auth:getMonitoringStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'status fail' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockTokenMonitor.getMonitoringStatus.mockImplementationOnce(() => { throw 'string error'; });
      const handler = getHandler('auth:getMonitoringStatus');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:manualTokenCheck ────────────────────────────────────────────────────
  describe('auth:manualTokenCheck', () => {
    it('triggers manual check and returns success', async () => {
      const handler = getHandler('auth:manualTokenCheck');
      const result = await handler();
      expect(result).toEqual({ success: true });
      expect(mockTokenMonitor.manualCheck).toHaveBeenCalled();
    });

    it('returns error on failure', async () => {
      mockTokenMonitor.manualCheck.mockRejectedValueOnce(new Error('check fail'));
      const handler = getHandler('auth:manualTokenCheck');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'check fail' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockTokenMonitor.manualCheck.mockRejectedValueOnce('string error');
      const handler = getHandler('auth:manualTokenCheck');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── auth:startGhcDeviceFlow ──────────────────────────────────────────────────
  describe('auth:startGhcDeviceFlow', () => {
    it('starts device flow and returns success message', async () => {
      const handler = getHandler('auth:startGhcDeviceFlow');
      const mockEvent = { sender: { isDestroyed: () => false, send: vi.fn() } };
      const result = await handler(mockEvent);
      expect(result).toEqual({
        success: true,
        message: 'Device Flow started, waiting for completion...',
      });
      expect(mockGhcAuthManager.performDeviceFlowAuthentication).toHaveBeenCalled();
    });

    it('returns error when device flow throws', async () => {
      mockGhcAuthManager.performDeviceFlowAuthentication.mockRejectedValueOnce(
        new Error('device flow failed'),
      );
      const handler = getHandler('auth:startGhcDeviceFlow');
      const mockEvent = { sender: { isDestroyed: () => false, send: vi.fn() } };
      const result = await handler(mockEvent);
      expect(result).toEqual({ success: false, error: 'device flow failed' });
    });

    it('returns Unknown error when device flow throws non-Error', async () => {
      mockGhcAuthManager.performDeviceFlowAuthentication.mockRejectedValueOnce({});
      const handler = getHandler('auth:startGhcDeviceFlow');
      const mockEvent = { sender: { isDestroyed: () => false, send: vi.fn() } };
      const result = await handler(mockEvent);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });

    it('invokes onSuccess callback and sends deviceFlowSuccess', async () => {
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any, onError: any, onSuccess: any) => {
          const authInfo = { ghcAuth: { user: { login: 'newuser' } } };
          await onSuccess(authInfo);
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      expect(mockAuthManager.setCurrentAuth).toHaveBeenCalled();
      expect(ctx.currentUserAlias).toBe('newuser');
      expect(senderSend).toHaveBeenCalledWith('auth:deviceFlowSuccess', expect.any(Object));
    });

    it('initializes scheduler on device flow success when feature enabled', async () => {
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any, onError: any, onSuccess: any) => {
          const authInfo = { ghcAuth: { user: { login: 'deviceuser' } } };
          await onSuccess(authInfo);
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      // Wait for background init
      expect(ctx._schedulerInitPromise).toBeDefined();
      await ctx._schedulerInitPromise;
      expect(mockSchedulerManager.initialize).toHaveBeenCalledWith('deviceuser');
    });

    it('initializes BuddyManager on device flow success', async () => {
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any, onError: any, onSuccess: any) => {
          const authInfo = { ghcAuth: { user: { login: 'buddyuser' } } };
          await onSuccess(authInfo);
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      // Wait for background init
      expect(ctx._buddyInitPromise).toBeDefined();
      await ctx._buddyInitPromise;
      expect(mockBuddyManagerInstance.initialize).toHaveBeenCalledWith('buddyuser');
    });

    it('handles scheduler initialization failure gracefully on device flow', async () => {
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'openkosmosFeatureScheduler');
      mockSchedulerManager.initialize.mockRejectedValueOnce(new Error('scheduler init failed'));
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any, onError: any, onSuccess: any) => {
          const authInfo = { ghcAuth: { user: { login: 'failuser' } } };
          await onSuccess(authInfo);
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      // Wait for background init to complete (should not throw)
      await ctx._schedulerInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] SchedulerManager initialization failed',
        'auth:startGhcDeviceFlow',
        expect.objectContaining({ userLogin: 'failuser', error: 'scheduler init failed' }),
      );
      // Device flow should still succeed
      expect(senderSend).toHaveBeenCalledWith('auth:deviceFlowSuccess', expect.any(Object));
    });

    it('handles BuddyManager initialization failure gracefully on device flow', async () => {
      mockBuddyManagerInstance.initialize.mockRejectedValueOnce(new Error('buddy init failed'));
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any, onError: any, onSuccess: any) => {
          const authInfo = { ghcAuth: { user: { login: 'buddyfailuser' } } };
          await onSuccess(authInfo);
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      // Wait for background init to complete (should not throw)
      await ctx._buddyInitPromise;
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[Startup] BuddyManager initialization failed',
        'auth:startGhcDeviceFlow',
        expect.objectContaining({ userLogin: 'buddyfailuser', error: 'buddy init failed' }),
      );
      // Device flow should still succeed
      expect(senderSend).toHaveBeenCalledWith('auth:deviceFlowSuccess', expect.any(Object));
    });


    it('sends deviceFlowError when onSuccess callback throws', async () => {
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockAuthManager.setCurrentAuth.mockRejectedValueOnce(new Error('session error'));

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any, onError: any, onSuccess: any) => {
          const authInfo = { ghcAuth: { user: { login: 'erroruser' } } };
          await onSuccess(authInfo);
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      expect(senderSend).toHaveBeenCalledWith('auth:deviceFlowError', { error: 'session error' });
    });

    it('invokes onDeviceCode callback and sends deviceCodeGenerated', async () => {
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any) => {
          onDeviceCode({ code: 'ABC123' });
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      expect(senderSend).toHaveBeenCalledWith('auth:deviceCodeGenerated', { code: 'ABC123' });
    });

    it('invokes onError callback and sends deviceFlowError', async () => {
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => false, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (_onDeviceCode: any, onError: any) => {
          onError('something went wrong');
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);

      expect(senderSend).toHaveBeenCalledWith('auth:deviceFlowError', { error: 'something went wrong' });
    });

    it('safeSend skips when sender is destroyed', async () => {
      const senderSend = vi.fn();
      const mockEvent = {
        sender: { isDestroyed: () => true, send: senderSend },
      };

      mockGhcAuthManager.performDeviceFlowAuthentication.mockImplementationOnce(
        async (onDeviceCode: any) => {
          onDeviceCode({ code: 'XYZ' });
        },
      );

      const handler = getHandler('auth:startGhcDeviceFlow');
      await handler(mockEvent);
      expect(senderSend).not.toHaveBeenCalled();
    });
  });

  // ── auth:signOut ─────────────────────────────────────────────────────────────
  describe('auth:signOut', () => {
    it('signs out and returns success', async () => {
      const handler = getHandler('auth:signOut');
      const result = await handler();
      expect(result).toEqual({ success: true });
      expect(mockAuthManager.signOut).toHaveBeenCalled();
    });

    it('returns error on failure', async () => {
      mockAuthManager.signOut.mockRejectedValueOnce(new Error('signout fail'));
      const handler = getHandler('auth:signOut');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'signout fail' });
    });

    it('returns Unknown error when non-Error thrown', async () => {
      mockAuthManager.signOut.mockRejectedValueOnce('string error');
      const handler = getHandler('auth:signOut');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });
});
