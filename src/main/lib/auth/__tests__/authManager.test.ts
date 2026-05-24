import type { AuthData } from '../types/authTypes';

const { ghcAuthMock, forceNotifyProfileDataManagerMock, handleProfileMock, startMonitoringMock } = vi.hoisted(() => ({
  ghcAuthMock: {
    refreshCopilotToken: vi.fn(),
  },
  forceNotifyProfileDataManagerMock: vi.fn().mockResolvedValue(undefined),
  handleProfileMock: vi.fn().mockResolvedValue({ version: '2.0.0' }),
  startMonitoringMock: vi.fn(),
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../ghcAuth', async () => ({
  GhcAuthManager: {
    getInstance: vi.fn(() => ghcAuthMock),
  },
}));

vi.mock('../tokenMonitor', async () => ({
  MainTokenMonitor: {
    getInstance: vi.fn(() => ({
      startMonitoring: startMonitoringMock,
      stopMonitoring: vi.fn(),
    })),
  },
}));

vi.mock('../../userDataADO', async () => ({
  profileCacheManager: {
    forceNotifyProfileDataManager: forceNotifyProfileDataManagerMock,
    handleProfile: handleProfileMock,
  },
}));

vi.mock('../../../startup/lazy', async () => ({
  resetExternalAgentService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../mcpRuntime/mcpClientManager', async () => ({
  mcpClientManager: {
    getRunningServers: vi.fn(() => []),
    stopServer: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../chat/agentChatManager', async () => ({
  agentChatManager: {
    setMainWindow: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock('../../mem0/openkosmos-adapters', async () => ({
  resetOpenKosmosMemory: vi.fn().mockResolvedValue(undefined),
}));

import { MainAuthManager } from '../authManager';

describe('MainAuthManager', () => {
  const createAuthData = (): AuthData => ({
    version: '3.0.0',
    createdAt: '2026-03-12T02:53:31.000Z',
    updatedAt: '2026-03-12T02:53:31.000Z',
    authProvider: 'github-copilot',
    ghcAuth: {
      alias: 'testuser',
      user: {
        id: 'user-1',
        login: 'testuser',
        email: 'testuser@example.com',
        name: 'Dale Xiao',
        avatarUrl: 'https://example.com/avatar.png',
        copilotPlan: 'business',
      },
      gitHubTokens: {
        timestamp: '2026-03-12T02:53:31.000Z',
        api_url: 'https://github.com/login/oauth/access_token',
        access_token: 'github-token',
        token_type: 'bearer',
        scope: 'read:user',
      },
      copilotTokens: {
        timestamp: '2026-03-12T02:53:31.000Z',
        api_url: 'https://api.github.com/copilot_internal/v2/token',
        expires_at: 1773285811,
        token: 'copilot-token',
      },
      capabilities: ['chat'],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    forceNotifyProfileDataManagerMock.mockResolvedValue(undefined);
    handleProfileMock.mockResolvedValue({ version: '2.0.0' });
  });

  it('sends auth_set before the initial profile sync notification', async () => {
    const manager = new MainAuthManager();
    const sendMock = vi.fn();

    manager.setMainWindow({
      isDestroyed: vi.fn(() => false),
      webContents: {
        send: sendMock,
      },
    } as any);

    vi.spyOn(manager as any, 'handlePostAuthentication').mockResolvedValue({
      success: true,
      isNewUser: false,
      hasUpdates: false,
    });

    await manager.setCurrentAuth(createAuthData());

    expect(sendMock).toHaveBeenCalledWith(
      'auth:authChanged',
      expect.objectContaining({ type: 'auth_set' }),
    );
    expect(forceNotifyProfileDataManagerMock).toHaveBeenCalledWith('testuser');
    expect(sendMock.mock.invocationCallOrder[0]).toBeLessThan(
      forceNotifyProfileDataManagerMock.mock.invocationCallOrder[0],
    );
    expect(startMonitoringMock).toHaveBeenCalledTimes(1);
  });

  it('initializes profile cache without notifying renderer before auth_set', async () => {
    const manager = new MainAuthManager();

    const result = await (manager as any).initializeProfileManager('testuser');

    expect(result).toEqual({
      success: true,
      message: 'Successfully initialized profile for user: testuser',
    });
    expect(handleProfileMock).toHaveBeenCalledWith('testuser', { notifyRenderer: false });
  });
});
