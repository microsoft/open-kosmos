// Coverage-targeted tests for authManager.ts — branches at 83%, need >=90%
import type { AuthData } from '../types/authTypes';

const mocks = vi.hoisted(() => ({
  ghcRefreshMock: vi.fn(),
  forceNotifyMock: vi.fn().mockResolvedValue(undefined),
  handleProfileMock: vi.fn().mockResolvedValue({ version: '3.0.0' }),
  clearCacheMock: vi.fn(),
  startMonitoringMock: vi.fn(),
  stopMonitoringMock: vi.fn(),
  mcpResetMock: vi.fn().mockResolvedValue(undefined),
  agentDestroyMock: vi.fn(),
  resetExternalAgentMock: vi.fn().mockResolvedValue(undefined),
  appGetPathMock: vi.fn(() => '/tmp/test-coverage-userdata'),
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

function makeAuthData(overrides: Partial<AuthData> = {}): AuthData {
  return {
    version: '3.0.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    authProvider: 'github-copilot',
    ghcAuth: {
      alias: 'covuser',
      user: {
        id: 'u1', login: 'covuser', email: 'cov@example.com',
        name: 'Cov User', avatarUrl: 'https://example.com/av.png',
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
    ...overrides,
  };
}

// ── sanitizeAuthData branch coverage ─────────────────────────────────────────

describe('MainAuthManager - sanitizeAuthData branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('uses "individual" fallback when copilotPlan is invalid (line 105 alternate branch)', () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    (authData.ghcAuth as any).user.copilotPlan = 'unknown-plan';
    const result = (m as any).sanitizeAuthData(authData);
    expect(result.ghcAuth.user.copilotPlan).toBe('individual');
  });

  it('uses valid enterprise plan without fallback', () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    authData.ghcAuth.user.copilotPlan = 'enterprise';
    const result = (m as any).sanitizeAuthData(authData);
    expect(result.ghcAuth.user.copilotPlan).toBe('enterprise');
  });

  it('defaults capabilities to chat/completion/inline_completion when not array (line 133-135)', () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    (authData.ghcAuth as any).capabilities = 'not-an-array';
    const result = (m as any).sanitizeAuthData(authData);
    expect(result.ghcAuth.capabilities).toEqual(['chat', 'completion', 'inline_completion']);
  });

  it('uses numeric expires_at when 0 (falsy but valid type) — line 127-129 false branch', () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    authData.ghcAuth.copilotTokens.expires_at = 0;
    const result = (m as any).sanitizeAuthData(authData);
    expect(result.ghcAuth.copilotTokens.expires_at).toBe(0);
  });

  it('enters error catch path when sanitization throws (line 155 branch)', () => {
    const m = new MainAuthManager();
    // Provide a minimal object that will fail inside try (user.id is a getter that throws)
    // but allows the catch block to read ghcAuth?.alias safely.
    const badData: any = {
      version: '3.0.0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      authProvider: 'ghc',
      ghcAuth: {
        alias: 'erruser',
        user: null, // null user so ghcAuth.user.id throws inside the try block
        gitHubTokens: {},
        copilotTokens: {},
        capabilities: null,
      },
    };
    const result = (m as any).sanitizeAuthData(badData);
    expect(result.version).toBe('3.0.0');
  });
});

// ── readAuthJson error path (line 93) ────────────────────────────────────────

describe('MainAuthManager - readAuthJson migration and error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
    mockFs.promises.readFile.mockRejectedValue(new Error('read failure'));
    mockFs.promises.writeFile.mockResolvedValue(undefined);
  });

  it('returns null on read error', async () => {
    const m = new MainAuthManager();
    const result = await (m as any).readAuthJson('/some/path');
    expect(result).toBeNull();
  });

  it('strips and persists obsolete aadAccount data during local auth load', async () => {
    const m = new MainAuthManager();
    const legacyAuth = makeAuthData();
    (legacyAuth.ghcAuth as AuthData['ghcAuth'] & { aadAccount: string }).aadAccount =
      'legacy@example.com';
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(legacyAuth));

    const result = await (m as any).readAuthJson('/some/path');

    expect(result.ghcAuth).not.toHaveProperty('aadAccount');
    expect(result.ghcAuth.gitHubTokens.access_token).toBe('gh-token');
    expect(mockFs.promises.writeFile).toHaveBeenCalledOnce();
    const persisted = JSON.parse(mockFs.promises.writeFile.mock.calls[0][1]);
    expect(persisted.ghcAuth).not.toHaveProperty('aadAccount');
    expect(persisted.ghcAuth.gitHubTokens.access_token).toBe('gh-token');
  });

  it('does not rewrite current auth data during local load', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));

    const result = await (m as any).readAuthJson('/some/path');

    expect(result.ghcAuth.alias).toBe('covuser');
    expect(mockFs.promises.writeFile).not.toHaveBeenCalled();
  });
});

// ── writeAuthJson error path (line 207) ──────────────────────────────────────

describe('MainAuthManager - writeAuthJson error path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
    mockFs.promises.writeFile.mockRejectedValue(new Error('write failure'));
  });

  it('returns false on write error', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    const result = await (m as any).writeAuthJson('/some/path', authData);
    expect(result).toBe(false);
  });
});

// ── shouldClearAuthSession branches (lines 930,931,932,946,947,951) ──────────

describe('MainAuthManager - shouldClearAuthSession branches', () => {
  it('returns true when success=false and requiresReauth=true (line 930-932)', () => {
    const m = new MainAuthManager();
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: true })).toBe(true);
  });

  it('returns false when success=true even if requiresReauth=true (line 964 false arm)', () => {
    const m = new MainAuthManager();
    expect(m.shouldClearAuthSession({ success: true, requiresReauth: true } as any)).toBe(false);
  });

  it('returns true when errorType=TOKEN_INVALID (line 969)', () => {
    const m = new MainAuthManager();
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: false, errorType: 'TOKEN_INVALID' })).toBe(true);
  });

  it('returns true when httpStatus=401 and errorType=TOKEN_EXPIRED (line 970)', () => {
    const m = new MainAuthManager();
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: false, httpStatus: 401, errorType: 'TOKEN_EXPIRED' })).toBe(true);
  });

  it('returns false for a successful refresh with no special error fields (line 974)', () => {
    const m = new MainAuthManager();
    expect(m.shouldClearAuthSession({ success: true, requiresReauth: false })).toBe(false);
  });

  it('returns false when httpStatus=403 even with TOKEN_EXPIRED (line 970 false side)', () => {
    const m = new MainAuthManager();
    expect(m.shouldClearAuthSession({ success: false, requiresReauth: false, httpStatus: 403, errorType: 'TOKEN_EXPIRED' })).toBe(false);
  });
});

// ── refreshCopilotToken: no current auth (line 898-904) ──────────────────────

describe('MainAuthManager - refreshCopilotToken with no currentAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns { success: false, requiresReauth: false } when no currentAuth', async () => {
    const m = new MainAuthManager();
    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.requiresReauth).toBe(false);
  });
});

// ── refreshCopilotToken: error path (lines 930,931,932,946,947,951) ──────────

describe('MainAuthManager - refreshCopilotToken error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns requiresReauth=true when shouldClearSession=true (line 945)', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    mocks.ghcRefreshMock.mockRejectedValue(
      Object.assign(new Error('invalid'), { shouldClearSession: true, analysis: { errorType: 'TOKEN_INVALID' }, httpStatus: 401 })
    );
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.requiresReauth).toBe(true);
  });

  it('returns requiresReauth=false for a generic network error (no shouldClearSession)', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    mocks.ghcRefreshMock.mockRejectedValue(new Error('network error'));
    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.requiresReauth).toBe(false);
  });
});

// ── getCopilotAccessToken / getGitHubAccessToken null branches ────────────────

describe('MainAuthManager - token getters null paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('getCopilotAccessToken returns null when no currentAuth (line 883)', () => {
    const m = new MainAuthManager();
    expect(m.getCopilotAccessToken()).toBeNull();
  });

  it('getGitHubAccessToken returns null when no currentAuth (line 890)', () => {
    const m = new MainAuthManager();
    expect(m.getGitHubAccessToken()).toBeNull();
  });

  it('getCopilotAccessToken returns token when currentAuth set', () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    expect(m.getCopilotAccessToken()).toBe('copilot-token');
  });
});

// ── getValidAuthsForSignin: invalid auth data guard (line 998) ────────────────

describe('MainAuthManager - getValidAuthsForSignin invalid auth structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pushes to invalidAuths when authData is incomplete (line 998)', async () => {
    const m = new MainAuthManager();
    // Mock getBasicValidProfiles to return an incomplete auth
    vi.spyOn(m as any, 'getBasicValidProfiles').mockResolvedValue([
      { version: '3.0.0', ghcAuth: null } as any,
    ]);
    const result = await m.getValidAuthsForSignin();
    expect(result.invalidAuths.length).toBeGreaterThan(0);
  });

  it('throws when getBasicValidProfiles throws (line 1011)', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockRejectedValue(new Error('scan failed'));
    await expect(m.getValidAuthsForSignin()).rejects.toThrow('scan failed');
  });
});

// ── getProfilesWithAuth: error path (line 1027) ──────────────────────────────

describe('MainAuthManager - getProfilesWithAuth error path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns [] when getBasicValidProfiles throws (line 1027)', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockRejectedValue(new Error('fail'));
    const result = await m.getProfilesWithAuth();
    expect(result).toEqual([]);
  });
});

// ── clearAuthTokens: no ghcAuth path (line 1066) ─────────────────────────────

describe('MainAuthManager - clearAuthTokens no ghcAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns false when readAuthJson returns null (line 1066)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
    const result = await m.clearAuthTokens('nobody');
    expect(result).toBe(false);
  });

  it('returns false when readAuthJson returns data without ghcAuth (line 1064)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify({ version: '3.0.0' }));
    const result = await m.clearAuthTokens('nobody');
    expect(result).toBe(false);
  });

  it('returns false on thrown error (line 1068)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue(new Error('fs error'));
    mocks.appGetPathMock.mockImplementationOnce(() => { throw new Error('path error'); });
    const result = await m.clearAuthTokens('covuser');
    expect(result).toBe(false);
  });
});

// ── deleteAuthJson: file not exists (line 1086) ──────────────────────────────

describe('MainAuthManager - deleteAuthJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns false when auth.json does not exist (line 1086)', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(false);
    const result = await m.deleteAuthJson('noone');
    expect(result).toBe(false);
  });

  it('returns true when file exists and is deleted (line 1083)', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.unlinkSync.mockReturnValue(undefined);
    const result = await m.deleteAuthJson('covuser');
    expect(result).toBe(true);
  });

  it('returns false on error (line 1088)', async () => {
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw new Error('path error'); });
    const result = await m.deleteAuthJson('covuser');
    expect(result).toBe(false);
  });
});

// ── updateAuthJson: error path (line 1102) ───────────────────────────────────

describe('MainAuthManager - updateAuthJson error path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns false when writeAuthJson throws (line 1102)', async () => {
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw new Error('path error'); });
    const result = await m.updateAuthJson('covuser', makeAuthData());
    expect(result).toBe(false);
  });
});

// ── notifyRendererAuthChanged: no mainWindow (line 874-876) ──────────────────

describe('MainAuthManager - notifyRendererAuthChanged no mainWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('does not throw when mainWindow is null (line 874 false branch)', () => {
    const m = new MainAuthManager();
    (m as any).mainWindow = null;
    expect(() => (m as any).notifyRendererAuthChanged('test', null)).not.toThrow();
  });
});

// ── authDataHasUpdates: missing ghcAuth (line 597) ───────────────────────────

describe('MainAuthManager - authDataHasUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage-userdata');
  });

  it('returns true when existingAuth has no ghcAuth (line 597)', () => {
    const m = new MainAuthManager();
    const result = (m as any).authDataHasUpdates({ version: '3.0.0' }, makeAuthData());
    expect(result).toBe(true);
  });

  it('returns false when auth data is identical', () => {
    const m = new MainAuthManager();
    const a = makeAuthData();
    const b = makeAuthData();
    expect((m as any).authDataHasUpdates(a, b)).toBe(false);
  });

  it('returns true when copilot token differs', () => {
    const m = new MainAuthManager();
    const a = makeAuthData();
    const b = makeAuthData();
    b.ghcAuth.copilotTokens.token = 'different-token';
    expect((m as any).authDataHasUpdates(a, b)).toBe(true);
  });
});
