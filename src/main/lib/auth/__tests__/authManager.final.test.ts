// Targeted tests for remaining uncovered catch blocks and branches
import type { AuthData } from '../types/authTypes';

const mocks = vi.hoisted(() => ({
  ghcRefreshMock: vi.fn(),
  forceNotifyMock: vi.fn().mockResolvedValue(undefined),
  handleProfileMock: vi.fn().mockResolvedValue({ version: '2.0.0' }),
  clearCacheMock: vi.fn(),
  startMonitoringMock: vi.fn(),
  stopMonitoringMock: vi.fn(),
  mcpResetMock: vi.fn().mockResolvedValue(undefined),
  agentDestroyMock: vi.fn(),
  resetExternalAgentMock: vi.fn().mockResolvedValue(undefined),
  appGetPathMock: vi.fn(() => '/tmp/test-userdata'),
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', () => ({
  app: { getPath: mocks.appGetPathMock },
  BrowserWindow: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    unlinkSync: vi.fn(),
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      readFile: vi.fn().mockRejectedValue(new Error('not found')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('../ghcAuth', () => ({
  GhcAuthManager: { getInstance: vi.fn(() => ({ refreshCopilotToken: mocks.ghcRefreshMock })) },
}));

vi.mock('../tokenMonitor', () => ({
  MainTokenMonitor: {
    getInstance: vi.fn(() => ({
      startMonitoring: mocks.startMonitoringMock,
      stopMonitoring: mocks.stopMonitoringMock,
    })),
  },
}));

vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    forceNotifyProfileDataManager: mocks.forceNotifyMock,
    handleProfile: mocks.handleProfileMock,
    clearCache: mocks.clearCacheMock,
  },
}));

vi.mock('../../../startup/lazy', () => ({ resetExternalAgentService: mocks.resetExternalAgentMock }));
vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: { resetForSignOut: mocks.mcpResetMock },
}));
vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: { destroy: mocks.agentDestroyMock },
}));

import { MainAuthManager } from '../authManager';
import * as fs from 'fs';

const mockFs = fs as any;

function makeAuthData(): AuthData {
  return {
    version: '3.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    authProvider: 'github-copilot',
    ghcAuth: {
      alias: 'testuser',
      user: {
        id: 'u1', login: 'testuser', email: 'test@example.com',
        name: 'Test User', avatarUrl: 'https://example.com/avatar.png',
        copilotPlan: 'individual',
      },
      gitHubTokens: {
        timestamp: '2026-01-01T00:00:00.000Z',
        api_url: 'https://github.com/login/oauth/access_token',
        access_token: 'gh-token', token_type: 'bearer', scope: 'read:user',
      },
      copilotTokens: {
        timestamp: '2026-01-01T00:00:00.000Z',
        api_url: 'https://api.github.com/copilot_internal/v2/token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token: 'copilot-token',
      },
      capabilities: ['chat'],
    },
  };
}

describe('MainAuthManager - signOut: renderer send throws (line 774)', () => {
  it('swallows renderer send error during signOut', async () => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
    const m = new MainAuthManager();
    let sendCallCount = 0;
    const sendMock = vi.fn().mockImplementation(() => {
      sendCallCount++;
      // throw on auth:signOut call
      if (sendCallCount > 1) throw new Error('IPC send error');
    });
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());

    // Should not throw even if send throws
    await m.signOut();
  });
});

describe('MainAuthManager - clearTokensForUser: writeAuthJson returns false (line 828)', () => {
  it('logs error when writeFile fails inside writeAuthJson', async () => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
    const m = new MainAuthManager();
    const authJson = JSON.stringify(makeAuthData());
    mockFs.promises.readFile.mockResolvedValue(authJson);
    // Make writeFile fail (writeAuthJson returns false)
    mockFs.promises.writeFile.mockRejectedValue(new Error('write failure'));

    const result = await (m as any).clearTokensForUser('testuser');
    expect(result).toBe(false);
  });
});

describe('MainAuthManager - updateAuthDataForCurrentAuth: writeAuthJson throws (line 854)', () => {
  it('logs error when app.getPath throws', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    await m.setCurrentAuth(makeAuthData());

    // Now make getPath throw to trigger catch in updateAuthDataForCurrentAuth
    mocks.appGetPathMock.mockImplementation(() => { throw new Error('electron getPath error'); });
    // Should not throw
    await (m as any).updateAuthDataForCurrentAuth();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
  });
});

describe('MainAuthManager - getValidAuthsForSignin: rethrows error from getBasicValidProfiles', () => {
  it('throws when getBasicValidProfiles throws', async () => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockRejectedValue(new Error('scan failed'));

    await expect(m.getValidAuthsForSignin()).rejects.toThrow('scan failed');
  });
});

describe('MainAuthManager - clearAuthTokens: catch block (line 1078)', () => {
  it('returns false when app.getPath throws in clearAuthTokens', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementation(() => { throw new Error('path error'); });

    const result = await m.clearAuthTokens('testuser');
    expect(result).toBe(false);
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
  });
});

describe('MainAuthManager - updateAuthJson: catch block (line 1112)', () => {
  it('returns false when app.getPath throws in updateAuthJson', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementation(() => { throw new Error('path error'); });

    const result = await m.updateAuthJson('testuser', makeAuthData());
    expect(result).toBe(false);
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
  });
});
