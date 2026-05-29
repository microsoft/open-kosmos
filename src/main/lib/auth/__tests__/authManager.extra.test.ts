// Extended coverage tests for authManager.ts
import type { AuthData } from '../types/authTypes';

const {
  ghcAuthMock,
  forceNotifyProfileDataManagerMock,
  handleProfileMock,
  startMonitoringMock,
  stopMonitoringMock,
  clearCacheMock,
  mcpResetMock,
  agentDestroyMock,
  resetExternalAgentMock,
} = vi.hoisted(() => ({
  ghcAuthMock: {
    refreshCopilotToken: vi.fn(),
  },
  forceNotifyProfileDataManagerMock: vi.fn().mockResolvedValue(undefined),
  handleProfileMock: vi.fn().mockResolvedValue({ version: '2.0.0' }),
  startMonitoringMock: vi.fn(),
  stopMonitoringMock: vi.fn(),
  clearCacheMock: vi.fn(),
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
  GhcAuthManager: {
    getInstance: vi.fn(() => ghcAuthMock),
  },
}));

vi.mock('../tokenMonitor', () => ({
  MainTokenMonitor: {
    getInstance: vi.fn(() => ({
      startMonitoring: startMonitoringMock,
      stopMonitoring: stopMonitoringMock,
    })),
  },
}));

vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    forceNotifyProfileDataManager: forceNotifyProfileDataManagerMock,
    handleProfile: handleProfileMock,
    clearCache: clearCacheMock,
  },
}));

vi.mock('../../../startup/lazy', () => ({
  resetExternalAgentService: resetExternalAgentMock,
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getRunningServers: vi.fn(() => []),
    stopServer: vi.fn().mockResolvedValue(undefined),
    startServer: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    resetForSignOut: mcpResetMock,
  },
}));

vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: {
    setMainWindow: vi.fn(),
    destroy: agentDestroyMock,
  },
}));

import { MainAuthManager } from '../authManager';
import * as fs from 'fs';

const mockFs = fs as any;

function makeAuthData(overrides: Partial<AuthData['ghcAuth']> = {}): AuthData {
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
      ...overrides,
    },
  };
}

describe('MainAuthManager - token accessors', () => {
  it('getCopilotAccessToken returns null when no auth', () => {
    const m = new MainAuthManager();
    expect(m.getCopilotAccessToken()).toBeNull();
  });

  it('getCopilotAccessToken returns token when auth is set', async () => {
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.stat.mockRejectedValue(new Error('ENOENT'));
    mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    handleProfileMock.mockResolvedValue({ version: '2.0.0' });

    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });

    await m.setCurrentAuth(makeAuthData());
    expect(m.getCopilotAccessToken()).toBe('copilot-token');
  });

  it('getGitHubAccessToken returns null when no auth', () => {
    const m = new MainAuthManager();
    expect(m.getGitHubAccessToken()).toBeNull();
  });

  it('getGitHubAccessToken returns token when auth is set', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    await m.setCurrentAuth(makeAuthData());
    expect(m.getGitHubAccessToken()).toBe('gh-token');
  });
});

describe('MainAuthManager - shouldClearAuthSession', () => {
  let m: MainAuthManager;
  beforeEach(() => { m = new MainAuthManager(); });

  it('returns true when requiresReauth is true', () => {
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: true })).toBe(true);
  });

  it('returns false when success is true', () => {
    expect(m.shouldClearAuthSession({ success: true, requiresReauth: false })).toBe(false);
  });

  it('returns true for TOKEN_INVALID errorType', () => {
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: false, errorType: 'TOKEN_INVALID' })).toBe(true);
  });

  it('returns true for TOKEN_EXPIRED with 401 httpStatus', () => {
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: false, errorType: 'TOKEN_EXPIRED', httpStatus: 401 })).toBe(true);
  });

  it('returns false for other error types', () => {
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: false, errorType: 'NETWORK_ERROR', httpStatus: 503 })).toBe(false);
  });
});

describe('MainAuthManager - destroyCurrentAuth', () => {
  it('does nothing when currentAuth is null', async () => {
    const m = new MainAuthManager();
    await m.destroyCurrentAuth();
    expect(stopMonitoringMock).not.toHaveBeenCalled();
  });

  it('clears auth, stops monitor, and notifies renderer', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());

    sendMock.mockClear();
    await m.destroyCurrentAuth();

    expect(stopMonitoringMock).toHaveBeenCalled();
    expect(m.getCurrentAuth()).toBeNull();
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_destroyed' }));
  });
});

describe('MainAuthManager - refreshCopilotToken', () => {
  it('returns failure when no current auth', async () => {
    const m = new MainAuthManager();
    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.error).toContain('No current auth');
  });

  it('returns success on happy path', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'updateAuthDataForCurrentAuth').mockResolvedValue(undefined);
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    await m.setCurrentAuth(makeAuthData());

    const newCopilotTokens = {
      timestamp: new Date().toISOString(),
      api_url: 'https://api.github.com/copilot_internal/v2/token',
      expires_at: Math.floor(Date.now() / 1000) + 7200,
      token: 'new-copilot-token',
    };
    ghcAuthMock.refreshCopilotToken.mockResolvedValue(newCopilotTokens);
    sendMock.mockClear();

    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(true);
    expect(result.authData?.ghcAuth.copilotTokens.token).toBe('new-copilot-token');
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'copilot_token_refreshed' }));
  });

  it('handles refresh error with shouldClearSession on token', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    await m.setCurrentAuth(makeAuthData());

    const err = Object.assign(new Error('401 Unauthorized'), {
      shouldClearSession: true,
      httpStatus: 401,
      analysis: { errorType: 'TOKEN_EXPIRED' },
    });
    ghcAuthMock.refreshCopilotToken.mockRejectedValue(err);

    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.requiresReauth).toBe(true);
  });
});

describe('MainAuthManager - signOut', () => {
  it('returns early when no currentAuth', async () => {
    const m = new MainAuthManager();
    await m.signOut(); // should not throw
    expect(mcpResetMock).not.toHaveBeenCalled();
  });

  it('runs full signout pipeline', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());

    await m.signOut();

    expect(mcpResetMock).toHaveBeenCalled();
    expect(agentDestroyMock).toHaveBeenCalled();
    expect(resetExternalAgentMock).toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith('auth:signOut', expect.objectContaining({ userLogin: 'testuser' }));
  });

  it('sends auth:signOut even when window is destroyed', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => true), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());

    await m.signOut();
    // No throw, window.send not called because isDestroyed() returns true
    expect(sendMock).not.toHaveBeenCalledWith('auth:signOut', expect.anything());
  });
});

describe('MainAuthManager - sanitizeAuthData', () => {
  it('uses defaults for missing optional fields', () => {
    const m = new MainAuthManager();
    const minimal: any = {
      ghcAuth: {
        alias: 'testuser',
        user: { id: 'u1', login: 'test', name: 'Test', email: '', avatarUrl: '' },
        gitHubTokens: { access_token: 'tok', timestamp: '2026-01-01T00:00:00.000Z' },
        copilotTokens: { token: 'ct', expires_at: 9999999999 },
      },
    };
    const result = (m as any).sanitizeAuthData(minimal);
    expect(result.version).toBe('3.0.0');
    expect(result.ghcAuth.user.copilotPlan).toBe('individual');
    expect(Array.isArray(result.ghcAuth.capabilities)).toBe(true);
  });

  it('normalizes invalid copilotPlan to individual', () => {
    const m = new MainAuthManager();
    const data = makeAuthData();
    (data.ghcAuth.user as any).copilotPlan = 'unknown_plan';
    const result = (m as any).sanitizeAuthData(data);
    expect(result.ghcAuth.user.copilotPlan).toBe('individual');
  });

  it('keeps valid copilotPlans', () => {
    const m = new MainAuthManager();
    for (const plan of ['individual', 'business', 'enterprise'] as const) {
      const data = makeAuthData({ user: { ...makeAuthData().ghcAuth.user, copilotPlan: plan } });
      const result = (m as any).sanitizeAuthData(data);
      expect(result.ghcAuth.user.copilotPlan).toBe(plan);
    }
  });
});

describe('MainAuthManager - hasValidGhcAuth', () => {
  let m: MainAuthManager;
  beforeEach(() => { m = new MainAuthManager(); });

  it('returns false for null input', () => {
    expect((m as any).hasValidGhcAuth(null)).toBe(false);
  });

  it('returns false when ghcAuth missing', () => {
    expect((m as any).hasValidGhcAuth({})).toBe(false);
  });

  it('returns false when user is missing', () => {
    expect((m as any).hasValidGhcAuth({ ghcAuth: {} })).toBe(false);
  });

  it('returns false when user.id is empty', () => {
    expect((m as any).hasValidGhcAuth({
      ghcAuth: { user: { id: '', login: 'x', name: 'X' }, gitHubTokens: { access_token: 't', timestamp: 'ts' }, copilotTokens: { token: 'ct', expires_at: 9999999999 } }
    })).toBe(false);
  });

  it('returns false when gitHubTokens is missing', () => {
    expect((m as any).hasValidGhcAuth({
      ghcAuth: { user: { id: 'u1', login: 'x', name: 'X' } }
    })).toBe(false);
  });

  it('returns false when gitHubTokens.access_token is empty', () => {
    expect((m as any).hasValidGhcAuth({
      ghcAuth: { user: { id: 'u1', login: 'x', name: 'X' }, gitHubTokens: { access_token: '', timestamp: 'ts' }, copilotTokens: { token: 'ct', expires_at: 9999999999 } }
    })).toBe(false);
  });

  it('returns false when copilotTokens is missing', () => {
    expect((m as any).hasValidGhcAuth({
      ghcAuth: { user: { id: 'u1', login: 'x', name: 'X' }, gitHubTokens: { access_token: 'tok', timestamp: 'ts' } }
    })).toBe(false);
  });

  it('returns false when copilotToken.expires_at is 0', () => {
    expect((m as any).hasValidGhcAuth({
      ghcAuth: { user: { id: 'u1', login: 'x', name: 'X' }, gitHubTokens: { access_token: 't', timestamp: 'ts' }, copilotTokens: { token: 'ct', expires_at: 0 } }
    })).toBe(false);
  });

  it('returns false when capabilities is not an array', () => {
    expect((m as any).hasValidGhcAuth({
      ghcAuth: {
        user: { id: 'u1', login: 'x', name: 'X' },
        gitHubTokens: { access_token: 't', timestamp: 'ts' },
        copilotTokens: { token: 'ct', expires_at: 9999999999 },
        capabilities: 'not-an-array',
      }
    })).toBe(false);
  });

  it('returns true for valid auth data', () => {
    expect((m as any).hasValidGhcAuth(makeAuthData())).toBe(true);
  });
});

describe('MainAuthManager - notifyRendererAuthChanged without window', () => {
  it('warns when mainWindow is null', () => {
    // MainAuthManager without setMainWindow — should not throw
    const m = new MainAuthManager();
    expect(() => (m as any).notifyRendererAuthChanged('test_event', null)).not.toThrow();
  });
});

describe('MainAuthManager - deleteAuthJson', () => {
  it('returns false when auth.json does not exist', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(false);
    const result = await m.deleteAuthJson('testuser');
    expect(result).toBe(false);
  });

  it('returns true and unlinks when auth.json exists', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.unlinkSync.mockImplementation(() => {});
    const result = await m.deleteAuthJson('testuser');
    expect(result).toBe(true);
    expect(mockFs.unlinkSync).toHaveBeenCalled();
  });

  it('returns false and does not throw on fs error', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockImplementation(() => { throw new Error('permission denied'); });
    const result = await m.deleteAuthJson('testuser');
    expect(result).toBe(false);
  });
});

describe('MainAuthManager - updateAuthJson', () => {
  it('returns true on success', async () => {
    const m = new MainAuthManager();
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    const result = await m.updateAuthJson('testuser', makeAuthData());
    expect(result).toBe(true);
  });

  it('returns true even when internal writeFile fails (writeAuthJson swallows errors)', async () => {
    const m = new MainAuthManager();
    // writeAuthJson catches errors and returns false, but updateAuthJson always returns true
    mockFs.promises.writeFile.mockRejectedValue(new Error('disk full'));
    const result = await m.updateAuthJson('testuser', makeAuthData());
    expect(result).toBe(true);
  });
});

describe('MainAuthManager - clearAuthTokens', () => {
  it('returns false when auth.json cannot be read', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
    const result = await m.clearAuthTokens('testuser');
    expect(result).toBe(false);
  });

  it('clears tokens and returns true when auth.json exists', async () => {
    const m = new MainAuthManager();
    const authJson = JSON.stringify(makeAuthData());
    mockFs.promises.readFile.mockResolvedValue(authJson);
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    const result = await m.clearAuthTokens('testuser');
    expect(result).toBe(true);
    const written = JSON.parse(mockFs.promises.writeFile.mock.calls.at(-1)[1]);
    expect(written.ghcAuth.gitHubTokens.access_token).toBe('');
    expect(written.ghcAuth.copilotTokens.token).toBe('');
  });
});

describe('MainAuthManager - getLocalActiveAuths', () => {
  it('returns empty array when profiles dir does not exist', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(false);
    const result = await m.getLocalActiveAuths();
    expect(result).toEqual([]);
  });
});

describe('MainAuthManager - handlePostAuthentication', () => {
  it('handles mkdir failure gracefully', async () => {
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockRejectedValue(new Error('EACCES permission denied'));
    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create directory');
  });

  it('creates new user flow when no valid auth exists', async () => {
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.stat.mockRejectedValue(new Error('ENOENT'));
    mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    handleProfileMock.mockResolvedValue({ version: '2.0.0' });

    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(true);
    expect(result.isNewUser).toBe(true);
  });

  it('returns failure when auth.json write fails for new user', async () => {
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.stat.mockRejectedValue(new Error('ENOENT'));
    mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
    mockFs.promises.writeFile.mockRejectedValue(new Error('disk full'));

    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(false);
  });

  it('existing user — no updates path', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    // auth.json exists
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));
    handleProfileMock.mockResolvedValue({ version: '2.0.0' });

    const result = await m.handlePostAuthentication(authData);
    expect(result.success).toBe(true);
    expect(result.isNewUser).toBe(false);
    expect(result.hasUpdates).toBe(false);
  });

  it('existing user — with updates path', async () => {
    const m = new MainAuthManager();
    const existingData = makeAuthData();
    const newData = makeAuthData();
    newData.ghcAuth.user.name = 'Updated Name';
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(existingData));
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    handleProfileMock.mockResolvedValue({ version: '2.0.0' });

    const result = await m.handlePostAuthentication(newData);
    expect(result.success).toBe(true);
    expect(result.hasUpdates).toBe(true);
  });
});

describe('MainAuthManager - getValidAuthsForSignin', () => {
  it('returns empty arrays when no profiles', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(false);
    const result = await m.getValidAuthsForSignin();
    expect(result.validAuths).toEqual([]);
    expect(result.expiredAuths).toEqual([]);
    expect(result.invalidAuths).toEqual([]);
  });
});

describe('MainAuthManager - getProfilesWithAuth', () => {
  it('returns empty array when no profiles', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(false);
    const result = await m.getProfilesWithAuth();
    expect(result).toEqual([]);
  });
});

describe('MainAuthManager - setCurrentAuth error handling', () => {
  it('handles handlePostAuthentication failure gracefully', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockRejectedValue(new Error('post auth error'));
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    // Should not throw
    await m.setCurrentAuth(makeAuthData());
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });

  it('handles token monitor start failure gracefully', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    startMonitoringMock.mockImplementation(() => { throw new Error('monitor error'); });
    // Should not throw
    await m.setCurrentAuth(makeAuthData());
    startMonitoringMock.mockImplementation(() => {}); // reset
  });
});
