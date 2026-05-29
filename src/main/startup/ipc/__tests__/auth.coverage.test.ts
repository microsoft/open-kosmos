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
}));

const mockSchedulerManager = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
  getRuntimeDiagnostics: vi.fn().mockReturnValue({}),
}));

const mockBuddyManagerInstance = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
}));

const mockBrowserControlHttpServer = vi.hoisted(() => ({
  ensureStarted: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../../lib/browserControl/browserControlHttpServer', () => ({
  browserControlHttpServer: mockBrowserControlHttpServer,
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

    it('starts browserControl when feature flag enabled', async () => {
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'browserControl');
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      expect(mockBrowserControlHttpServer.ensureStarted).toHaveBeenCalled();
    });

    it('does not start browserControl when flag disabled', async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const handler = getHandler('auth:setCurrentSession');
      await handler({}, validAuthData);
      expect(mockBrowserControlHttpServer.ensureStarted).not.toHaveBeenCalled();
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

    it('returns error when setCurrentAuth throws', async () => {
      mockAuthManager.setCurrentAuth.mockRejectedValueOnce(new Error('auth fail'));
      const handler = getHandler('auth:setCurrentSession');
      const result = await handler({}, validAuthData);
      expect(result).toEqual({ success: false, error: 'auth fail' });
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
  });

  // ── auth:getMonitoringStatus ─────────────────────────────────────────────────
  describe('auth:getMonitoringStatus', () => {
    it('returns monitoring status', async () => {
      const handler = getHandler('auth:getMonitoringStatus');
      const result = await handler();
      expect(result).toEqual({ success: true, data: { active: true } });
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

    it('stops browserControl server on win32/darwin when feature enabled', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      mockIsFeatureEnabled.mockImplementation((flag: string) => flag === 'browserControl');

      const handler = getHandler('auth:signOut');
      await handler();
      expect(mockBrowserControlHttpServer.stop).toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('returns error on failure', async () => {
      mockAuthManager.signOut.mockRejectedValueOnce(new Error('signout fail'));
      const handler = getHandler('auth:signOut');
      const result = await handler();
      expect(result).toEqual({ success: false, error: 'signout fail' });
    });
  });
});
