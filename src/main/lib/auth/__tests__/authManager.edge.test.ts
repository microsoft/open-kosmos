// Edge-case coverage tests for specific uncovered branches
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
}));

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/test-userdata') },
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
        id: 'u1',
        login: 'testuser',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        copilotPlan: 'individual',
      },
      gitHubTokens: {
        timestamp: '2026-01-01T00:00:00.000Z',
        api_url: 'https://github.com/login/oauth/access_token',
        access_token: 'gh-token',
        token_type: 'bearer',
        scope: 'read:user',
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

describe('MainAuthManager - setCurrentAuth: handlePostAuthentication returns failure', () => {
  it('logs error when handlePostAuthentication returns success: false', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({
      success: false,
      isNewUser: false,
      hasUpdates: false,
      message: 'something went wrong'
    });
    // Should not throw
    await m.setCurrentAuth(makeAuthData());
    expect(m.getCurrentAuth()).not.toBeNull();
  });
});

describe('MainAuthManager - handlePostAuthentication outer catch', () => {
  it('catches error thrown by unexpected exception in flow', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    // Make hasValidAuthForProfile throw by spying on the private method
    vi.spyOn(m as any, 'hasValidAuthForProfile').mockRejectedValue(new Error('unexpected IO error'));

    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Error handling post-authentication');
  });
});

describe('MainAuthManager - notifyRendererAuthChanged: send throws', () => {
  it('logs error when webContents.send throws', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    const sendMock = vi.fn().mockImplementation(() => { throw new Error('ipc error'); });
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    // Should not throw
    await m.setCurrentAuth(makeAuthData());
  });
});

describe('MainAuthManager - signOut: destroyCurrentAuth throws (re-throw)', () => {
  it('rethrows error from destroyCurrentAuth in signOut', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());

    // destroyCurrentAuth calls clearTokensForUser internally, make it throw on the real path
    // by making the real clearTokensForUser's readFile throw a non-caught error
    vi.spyOn(m as any, 'destroyCurrentAuth').mockRejectedValue(new Error('destroy failed'));

    await expect(m.signOut()).rejects.toThrow('destroy failed');
  });
});

describe('MainAuthManager - clearTokensForUser: writeFile fails returns false', () => {
  it('logs error and returns false when writeFile fails', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    const authJson = JSON.stringify(makeAuthData());
    mockFs.promises.readFile.mockResolvedValue(authJson);
    mockFs.promises.writeFile.mockRejectedValue(new Error('write error'));

    const result = await (m as any).clearTokensForUser('testuser');
    expect(result).toBe(false);
  });
});

describe('MainAuthManager - clearAuthTokens: error path', () => {
  it('returns false when readFile throws in clearAuthTokens', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue(new Error('io error'));
    const result = await m.clearAuthTokens('testuser');
    expect(result).toBe(false);
  });

  it('returns false when ghcAuth is missing', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    const badData = { version: '3.0.0', ghcAuth: null };
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(badData));
    const result = await m.clearAuthTokens('testuser');
    expect(result).toBe(false);
  });
});

describe('MainAuthManager - getValidAuthsForSignin: invalid auth structure in profile list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushes to invalidAuths when returned profile has null user', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();

    // Bypass getBasicValidProfiles to return a profile with missing user
    const badProfile: any = {
      ghcAuth: {
        alias: 'baduser',
        user: null,
        gitHubTokens: null,
        copilotTokens: null,
      },
    };
    vi.spyOn(m as any, 'getBasicValidProfiles').mockResolvedValue([badProfile]);

    const result = await m.getValidAuthsForSignin();
    expect(result.invalidAuths).toHaveLength(1);
    expect(result.invalidAuths[0].alias).toBe('baduser');
  });
});

describe('MainAuthManager - getBasicValidProfiles: scan-level readdir throws', () => {
  it('throws (wrapping) and getLocalActiveAuths returns empty', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockRejectedValue(new Error('EACCES'));

    // getLocalActiveAuths catches the thrown error and returns []
    const result = await m.getLocalActiveAuths();
    expect(result).toEqual([]);
  });
});
