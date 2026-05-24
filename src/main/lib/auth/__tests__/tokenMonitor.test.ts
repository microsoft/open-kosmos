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

function createMockAuth(overrides: { copilotExpiresInSeconds?: number; hasGitHubToken?: boolean; hasCopilotToken?: boolean } = {}) {
  const { copilotExpiresInSeconds = 600, hasGitHubToken = true, hasCopilotToken = true } = overrides;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    ghcAuth: {
      user: { login: 'test_user' },
      gitHubTokens: {
        access_token: hasGitHubToken ? 'gh-token-valid' : '',
      },
      copilotTokens: {
        token: hasCopilotToken ? 'copilot-token-valid' : '',
        expires_at: nowSeconds + copilotExpiresInSeconds,
      },
    },
  };
}

describe('MainTokenMonitor - logging behavior', () => {
  let monitor: MainTokenMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset singleton
    (MainTokenMonitor as any).instance = undefined;
    monitor = MainTokenMonitor.getInstance();
  });

  afterEach(() => {
    monitor.stopMonitoring();
    vi.useRealTimers();
  });

  it('does not log when token is healthy (normal path is silent)', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: 600 }));

    monitor.startMonitoring();
    // Wait for the immediate async check to complete
    await vi.advanceTimersByTimeAsync(10);

    // Normal healthy check should produce NO info/warn logs about token status
    const tokenInfoCalls = mockLogger.info.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('[MainTokenMonitor]')
    );
    const tokenWarnCalls = mockLogger.warn.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('[MainTokenMonitor]')
    );
    expect(tokenInfoCalls).toHaveLength(0);
    expect(tokenWarnCalls).toHaveLength(0);
  });

  it('logs a warning when copilot token is expired', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: -60 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({ success: true });

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const warnCalls = mockLogger.warn.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('expired')
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('logs info when copilot token is expiring soon and triggers refresh', async () => {
    // 3 minutes until expiry (within 5-minute threshold)
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ copilotExpiresInSeconds: 180 }));
    mockAuthManager.refreshCopilotToken.mockResolvedValue({ success: true });

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const infoCalls = mockLogger.info.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('expiring soon')
    );
    expect(infoCalls.length).toBeGreaterThanOrEqual(1);
    expect(mockAuthManager.refreshCopilotToken).toHaveBeenCalled();
  });

  it('logs a warning when GitHub token is missing', async () => {
    mockAuthManager.getCurrentAuth.mockReturnValue(createMockAuth({ hasGitHubToken: false }));

    monitor.startMonitoring();
    await vi.advanceTimersByTimeAsync(10);

    const warnCalls = mockLogger.warn.mock.calls.filter(
      (args: any[]) => typeof args[0] === 'string' && args[0].includes('Missing GitHub token')
    );
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });
});
