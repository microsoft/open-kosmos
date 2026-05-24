// Additional coverage tests for tokenMonitor.ts

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  updateConfig: vi.fn(),
}));

const mockAuthManager = vi.hoisted(() => ({
  getCurrentAuth: vi.fn(),
  refreshCopilotToken: vi.fn(),
  shouldClearAuthSession: vi.fn(() => false),
  destroyCurrentAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: vi.fn(() => mockLogger),
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

vi.mock('../authManager', () => ({
  MainAuthManager: {
    getInstance: vi.fn(() => mockAuthManager),
  },
}));

import { MainTokenMonitor } from '../tokenMonitor';

function createMockAuth(opts: { copilotExpiresInSeconds?: number; hasGitHubToken?: boolean; hasCopilotToken?: boolean } = {}) {
  const { copilotExpiresInSeconds = 600, hasGitHubToken = true, hasCopilotToken = true } = opts;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    ghcAuth: {
      user: { login: 'test_user' },
      gitHubTokens: { access_token: hasGitHubToken ? 'gh-token' : '' },
      copilotTokens: {
        token: hasCopilotToken ? 'copilot-token' : '',
        expires_at: nowSeconds + copilotExpiresInSeconds,
      },
    },
  };
}

describe('MainTokenMonitor - extended coverage', () => {
  let monitor: MainTokenMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (MainTokenMonitor as any).instance = undefined;
    monitor = MainTokenMonitor.getInstance();
  });

  afterEach(() => {
    monitor.stopMonitoring();
    vi.useRealTimers();
  });

  it('returns singleton from getInstance', () => {
    const a = MainTokenMonitor.getInstance();
    const b = MainTokenMonitor.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance allows new singleton creation', () => {
    const a = MainTokenMonitor.getInstance();
    MainTokenMonitor.resetInstance();
    (MainTokenMonitor as any).instance = undefined;
    const b = MainTokenMonitor.getInstance();
    expect(a).not.toBe(b);
  });

  it('getMonitoringStatus reflects running state', () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    expect(monitor.getMonitoringStatus().isRunning).toBe(false);
    monitor.startMonitoring();
    expect(monitor.getMonitoringStatus().isRunning).toBe(true);
    monitor.stopMonitoring();
    expect(monitor.getMonitoringStatus().isRunning).toBe(false);
  });

  it('getMonitoringStatus returns check interval and refresh threshold', () => {
    const status = monitor.getMonitoringStatus();
    expect(status.checkInterval).toBeGreaterThan(0);
    expect(status.copilotRefreshThreshold).toBeGreaterThan(0);
  });

  it('does not start monitoring twice (duplicate start guarded)', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    monitor.startMonitoring();
    monitor.startMonitoring(); // second call should warn and return early
    await vi.advanceTimersByTimeAsync(10);
    const warnCalls = mockLogger.warn.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('already running')
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('cleans up residual interval when isMonitoring is false but interval exists', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    // Simulate a residual interval state
    (monitor as any).monitorInterval = setInterval(() => {}, 999999);
    (monitor as any).isMonitoring = false;

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const warnCalls = mockLogger.warn.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('residual interval')
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('notifies renderer via setMainWindow when window is set', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    // Should have sent monitor_started event
    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'monitor_started' })
    );
  });

  it('does not send to renderer when window is null', async () => {
    // No mainWindow set
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);
    // No crash; just verify no error thrown
  });

  it('does not send to renderer when window is destroyed', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => true), // destroyed
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const tokenMonitorCalls = sendMock.mock.calls.filter(
      (args: any[]) => args[0] === 'auth:tokenMonitor'
    );
    expect(tokenMonitorCalls.length).toBe(0);
  });

  it('handles null auth gracefully (debug log, no error)', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(null);
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('logs missing copilot token and attempts refresh', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ hasCopilotToken: false }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({ success: true });

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const warnCalls = mockLogger.warn.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('Missing Copilot token')
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockAuthManager.refreshCopilotToken).toHaveBeenCalled();
  });

  it('sends require_reauth when GitHub token missing', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ hasGitHubToken: false }));
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'require_reauth' })
    );
  });

  it('sends copilot_token_refresh_success on successful refresh', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    // Token expired
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: -60 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({ success: true });

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'copilot_token_refresh_success' })
    );
  });

  it('logs error and sends require_reauth when refresh fails with 401', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: -60 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
      httpStatus: 401,
    });
    mockAuthManager.shouldClearAuthSession.mockReturnValue(false);

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockAuthManager.destroyCurrentAuth).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'require_reauth' })
    );
  });

  it('sends require_reauth when shouldClearAuthSession returns true', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: -60 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({
      success: false,
      error: 'Token invalid',
      errorType: 'TOKEN_INVALID',
      httpStatus: 403,
    });
    mockAuthManager.shouldClearAuthSession.mockReturnValue(true);

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'require_reauth' })
    );
  });

  it('sends copilot_token_refresh_failed when refresh fails with recoverable error', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: -60 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({
      success: false,
      error: 'Network error',
      httpStatus: 503,
    });
    mockAuthManager.shouldClearAuthSession.mockReturnValue(false);

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'copilot_token_refresh_failed' })
    );
  });

  it('sends TOKEN_EXPIRED errorType triggers require_reauth', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: -60 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({
      success: false,
      error: 'Token expired',
      errorType: 'TOKEN_EXPIRED',
      httpStatus: 0,
    });
    mockAuthManager.shouldClearAuthSession.mockReturnValue(false);

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    expect(mockAuthManager.destroyCurrentAuth).toHaveBeenCalled();
  });

  it('manualCheck triggers token check', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    await monitor.manualCheck();
    expect(mockAuthManager.getCurrentAuth).toHaveBeenCalled();
  });

  it('triggerImmediateCheck schedules a check after 100ms', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    monitor.triggerImmediateCheck();
    await vi.advanceTimersByTimeAsync(110);
    expect(mockAuthManager.getCurrentAuth).toHaveBeenCalled();
  });

  it('periodic interval triggers subsequent checks', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: 600 }));
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);
    const callCount = mockAuthManager.getCurrentAuth.mock.calls.length;

    // Advance by CHECK_INTERVAL (120 seconds)
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mockAuthManager.getCurrentAuth.mock.calls.length).toBeGreaterThan(callCount);
  });

  it('stopMonitoring sends monitor_stopped event', async () => {
    const sendMock = vi.fn();
    const mockWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: sendMock },
    };
    monitor.setMainWindow(mockWindow as any);

    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth());
    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);
    monitor.stopMonitoring();

    expect(sendMock).toHaveBeenCalledWith(
      'auth:tokenMonitor',
      expect.objectContaining({ event: 'monitor_stopped' })
    );
  });

  it('checkAndRefreshToken error is caught and logged', async () => {
    mockAuthManager.getCurrentAuth.mockImplementation(() => {
      throw new Error('unexpected error');
    });

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const errorCalls = mockLogger.error.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('Error during monitor check')
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('handles non-Error thrown object in first token check', async () => {
    mockAuthManager.getCurrentAuth.mockImplementation(() => {
      throw 'string error'; // non-Error object
    });

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);
    // Should not throw; String(error) branch in catch is exercised
  });

  it('logs error when checkAndRefreshToken rejects on first call (line 63)', async () => {
    // Spy on the private method via prototype to force a rejection
    const proto = Object.getPrototypeOf(monitor);
    const spy = vi.spyOn(proto, 'checkAndRefreshToken').mockRejectedValueOnce(new Error('forced rejection'));

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    // The .catch() on line 62-66 should have logged the error
    const errorCalls = mockLogger.error.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('First token check failed')
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it('uses String(error) branch when non-Error rejection on first call (line 64)', async () => {
    const proto = Object.getPrototypeOf(monitor);
    const spy = vi.spyOn(proto, 'checkAndRefreshToken').mockRejectedValueOnce('string error');

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const errorCalls = mockLogger.error.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('First token check failed')
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });
});
