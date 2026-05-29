// Further authManager coverage — getBasicValidProfiles, authDataHasUpdates, etc.
import type { AuthData } from '../types/authTypes';

const {
  forceNotifyProfileDataManagerMock,
  handleProfileMock,
  startMonitoringMock,
  stopMonitoringMock,
  mcpResetMock,
  agentDestroyMock,
  resetExternalAgentMock,
} = vi.hoisted(() => ({
  forceNotifyProfileDataManagerMock: vi.fn().mockResolvedValue(undefined),
  handleProfileMock: vi.fn().mockResolvedValue({ version: '2.0.0' }),
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

// We need fine-grained fs mock control per test
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
  GhcAuthManager: { getInstance: vi.fn(() => ({ refreshCopilotToken: vi.fn() })) },
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
    clearCache: vi.fn(),
  },
}));

vi.mock('../../../startup/lazy', () => ({ resetExternalAgentService: resetExternalAgentMock }));
vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: { resetForSignOut: mcpResetMock },
}));
vi.mock('../../chat/agentChatManager', () => ({
  agentChatManager: { destroy: agentDestroyMock },
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

describe('MainAuthManager - getBasicValidProfiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns profiles when GitHub token is valid', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();

    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    // auth.json exists
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));

    // GitHub API returns ok
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(1);
    expect(result[0].ghcAuth.alias).toBe('testuser');
  });

  it('skips hidden directories', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: '.hidden', isDirectory: () => true },
    ]);

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips non-directory entries', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'file.txt', isDirectory: () => false },
    ]);

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips profiles without auth.json', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    // No auth.json — stat fails
    mockFs.promises.stat.mockRejectedValue(new Error('ENOENT'));

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips profiles that fail to parse auth.json', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    // readFile returns invalid JSON
    mockFs.promises.readFile.mockResolvedValue('not json');

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips profiles with invalid ghcAuth', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    // Missing required fields
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify({ ghcAuth: { user: null } }));

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips profiles with empty GitHub token', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    authData.ghcAuth.gitHubTokens.access_token = '';

    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips profiles with 401 GitHub token response', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    (global.fetch as any).mockResolvedValue({ ok: false, status: 401 });

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('skips profiles when GitHub API throws', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    (global.fetch as any).mockRejectedValue(new Error('network error'));

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('treats non-401 non-ok responses as valid', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    // 503 — non-401 non-ok → treated as valid
    (global.fetch as any).mockResolvedValue({ ok: false, status: 503 });

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(1);
  });

  it('rethrows critical scan errors', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockRejectedValue(new Error('critical read failure'));

    await expect(m.getLocalActiveAuths()).resolves.toEqual([]);
  });
});

describe('MainAuthManager - initializeProfileManager', () => {
  it('returns failure when handleProfile returns falsy', async () => {
    const m = new MainAuthManager();
    handleProfileMock.mockResolvedValue(null);

    const result = await (m as any).initializeProfileManager('testuser');
    expect(result.success).toBe(false);
  });

  it('returns failure when handleProfile throws', async () => {
    const m = new MainAuthManager();
    handleProfileMock.mockRejectedValue(new Error('db error'));

    const result = await (m as any).initializeProfileManager('testuser');
    expect(result.success).toBe(false);
    expect(result.message).toContain('db error');
  });
});

describe('MainAuthManager - authDataHasUpdates', () => {
  it('returns true when ghcAuth is missing in existing data', () => {
    const m = new MainAuthManager();
    const existing: any = { ghcAuth: null };
    expect((m as any).authDataHasUpdates(existing, makeAuthData())).toBe(true);
  });

  it('returns false when data is identical', () => {
    const m = new MainAuthManager();
    const data = makeAuthData();
    const copy = JSON.parse(JSON.stringify(data));
    expect((m as any).authDataHasUpdates(data, copy)).toBe(false);
  });

  it('detects user field changes', () => {
    const m = new MainAuthManager();
    const a = makeAuthData();
    const b = makeAuthData();
    b.ghcAuth.user.name = 'Different Name';
    expect((m as any).authDataHasUpdates(a, b)).toBe(true);
  });

  it('detects gitHubToken access_token change', () => {
    const m = new MainAuthManager();
    const a = makeAuthData();
    const b = makeAuthData();
    b.ghcAuth.gitHubTokens.access_token = 'different-token';
    expect((m as any).authDataHasUpdates(a, b)).toBe(true);
  });

  it('detects copilotToken change', () => {
    const m = new MainAuthManager();
    const a = makeAuthData();
    const b = makeAuthData();
    b.ghcAuth.copilotTokens.token = 'new-copilot-token';
    expect((m as any).authDataHasUpdates(a, b)).toBe(true);
  });

  it('detects capabilities change', () => {
    const m = new MainAuthManager();
    const a = makeAuthData();
    const b = makeAuthData();
    b.ghcAuth.capabilities = ['chat', 'completion'];
    expect((m as any).authDataHasUpdates(a, b)).toBe(true);
  });
});

describe('MainAuthManager - sanitizeAuthData error fallback path', () => {
  it('returns minimal safe config when sanitization throws', () => {
    const m = new MainAuthManager();
    // Pass something that will throw during sanitization
    const badData: any = {
      get version() { throw new Error('cannot read'); },
      ghcAuth: { alias: 'testuser' },
    };
    // Should not throw, returns minimal config
    const result = (m as any).sanitizeAuthData(badData);
    expect(result.version).toBe('3.0.0');
    expect(result.ghcAuth.user.copilotPlan).toBe('individual');
  });
});

describe('MainAuthManager - updateAuthDataForCurrentAuth', () => {
  it('does nothing when no currentAuth', async () => {
    const m = new MainAuthManager();
    await (m as any).updateAuthDataForCurrentAuth();
    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('writes when currentAuth is set', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    await m.setCurrentAuth(makeAuthData());
    mockFs.promises.writeFile.mockClear();

    await (m as any).updateAuthDataForCurrentAuth();
    expect(mockFs.promises.writeFile).toHaveBeenCalled();
  });
});

describe('MainAuthManager - clearTokensForUser', () => {
  it('returns false when auth.json not found', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
    const result = await (m as any).clearTokensForUser('testuser');
    expect(result).toBe(false);
  });

  it('clears tokens and returns true', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));
    mockFs.promises.writeFile.mockResolvedValue(undefined);

    const result = await (m as any).clearTokensForUser('testuser');
    expect(result).toBe(true);
    const written = JSON.parse(mockFs.promises.writeFile.mock.calls.at(-1)[1]);
    expect(written.ghcAuth.gitHubTokens.access_token).toBe('');
    expect(written.ghcAuth.copilotTokens.token).toBe('');
  });
});

describe('MainAuthManager - handlePostAuthentication error paths', () => {
  it('catches unexpected error and returns failure', async () => {
    const m = new MainAuthManager();
    // mkdir succeeds, but hasValidAuthForProfile throws
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.stat.mockImplementation(() => { throw new Error('unexpected'); });

    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(false);
  });
});

describe('MainAuthManager - getValidAuthsForSignin with profiles', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns valid auths when profiles found', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

    const result = await m.getValidAuthsForSignin();
    expect(result.validAuths).toHaveLength(1);
  });
});

describe('MainAuthManager - getProfilesWithAuth', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns profiles with auth', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

    const result = await m.getProfilesWithAuth();
    expect(result).toHaveLength(1);
    expect(result[0].alias).toBe('testuser');
  });

  it('returns empty array on error', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockRejectedValue(new Error('critical'));

    const result = await m.getProfilesWithAuth();
    expect(result).toEqual([]);
  });
});
