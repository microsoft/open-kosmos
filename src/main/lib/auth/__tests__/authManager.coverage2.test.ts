// Coverage2 tests for authManager.ts — targets the remaining uncovered branches
// after authManager.coverage.test.ts: almost all are non-Error catch sides
// (`error instanceof Error ? error.message : String(error)`) plus a few `||`
// fallback sides. These do NOT modify source; they only drive existing branches.
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
  appGetPathMock: vi.fn(() => '/tmp/test-coverage2-userdata'),
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
      alias: 'cov2user',
      user: {
        id: 'u1', login: 'cov2user', email: 'cov2@example.com',
        name: 'Cov2 User', avatarUrl: 'https://example.com/av.png',
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appGetPathMock.mockReturnValue('/tmp/test-coverage2-userdata');
  mocks.forceNotifyMock.mockResolvedValue(undefined);
  mocks.handleProfileMock.mockResolvedValue({ version: '3.0.0' });
  mocks.mcpResetMock.mockResolvedValue(undefined);
  mocks.resetExternalAgentMock.mockResolvedValue(undefined);
  mockFs.existsSync.mockReturnValue(false);
  mockFs.promises.mkdir.mockResolvedValue(undefined);
  mockFs.promises.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  mockFs.promises.readFile.mockRejectedValue(new Error('not found'));
  mockFs.promises.writeFile.mockResolvedValue(undefined);
  mockFs.promises.readdir.mockResolvedValue([]);
});

// ── getInstance: instance-already-exists false side (line 53) ─────────────────

describe('MainAuthManager - getInstance singleton (line 53 false side)', () => {
  it('returns the same instance on a second call (skips construction)', () => {
    const a = MainAuthManager.getInstance();
    const b = MainAuthManager.getInstance();
    expect(a).toBe(b);
  });
});

// ── readAuthJson non-Error catch (line 93) ───────────────────────────────────

describe('MainAuthManager - readAuthJson non-Error rejection (line 93)', () => {
  it('returns null and stringifies a non-Error rejection value', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue('plain string read failure');
    const result = await (m as any).readAuthJson('/some/path');
    expect(result).toBeNull();
  });
});

// ── sanitizeAuthData: cleanAlias '' side + catch non-Error (137, 155, 163, 164)

describe('MainAuthManager - sanitizeAuthData alias + catch branches', () => {
  it('cleanAlias falls back to "" when alias is missing (line 137 || side)', () => {
    const m = new MainAuthManager();
    const data: any = makeAuthData();
    delete data.ghcAuth.alias;
    const result = (m as any).sanitizeAuthData(data);
    expect(result.ghcAuth.alias).toBe('');
  });

  it('catch path reads ghcAuth?.alias || "" when alias present but inner throws (163/164)', () => {
    const m = new MainAuthManager();
    // user getter throws a string → enters catch; ghcAuth.alias is present so the
    // catch-side String(authData.ghcAuth?.alias || '') uses the truthy alias.
    const data: any = {
      version: '3.0.0',
      ghcAuth: {
        alias: 'fallback-alias',
        get user() { throw 'plain string sanitize failure'; },
        gitHubTokens: {}, copilotTokens: {}, capabilities: null,
      },
    };
    const result = (m as any).sanitizeAuthData(data);
    expect(result.ghcAuth.alias).toBe('fallback-alias');
  });

  it('catch path falls back to "" when alias missing in catch (163/164 || side)', () => {
    const m = new MainAuthManager();
    const data: any = {
      version: '3.0.0',
      ghcAuth: {
        get user() { throw new Error('boom'); },
        gitHubTokens: {}, copilotTokens: {}, capabilities: null,
      },
    };
    const result = (m as any).sanitizeAuthData(data);
    expect(result.ghcAuth.alias).toBe('');
  });
});

// ── writeAuthJson non-Error catch (line 207) ─────────────────────────────────

describe('MainAuthManager - writeAuthJson non-Error rejection (line 207)', () => {
  it('returns false and stringifies a non-Error rejection value', async () => {
    const m = new MainAuthManager();
    mockFs.promises.writeFile.mockRejectedValue('plain string write failure');
    const result = await (m as any).writeAuthJson('/some/path', makeAuthData());
    expect(result).toBe(false);
  });
});

// ── hasValidGhcAuth non-Error catch (line 273) ───────────────────────────────

describe('MainAuthManager - hasValidGhcAuth non-Error throw (line 273)', () => {
  it('returns false when accessing fields throws a non-Error value', () => {
    const m = new MainAuthManager();
    const badInput = {
      get ghcAuth() { throw 'plain string ghcAuth failure'; },
    };
    expect((m as any).hasValidGhcAuth(badInput)).toBe(false);
  });
});

// ── getBasicValidProfiles: apiError / per-profile / scan catch non-Error ──────

describe('MainAuthManager - getBasicValidProfiles non-Error catch branches', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('apiError catch stringifies non-Error fetch rejection (line 358)', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([{ name: 'cov2user', isDirectory: () => true }]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    (global.fetch as any).mockRejectedValue('plain string fetch failure');
    const result = await (m as any).getBasicValidProfiles();
    // profile is skipped on network error
    expect(result).toHaveLength(0);
  });

  it('per-profile catch stringifies a non-Error throw (line 368 false arm)', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([{ name: 'cov2user', isDirectory: () => true }]);
    // Pass the inner guards (hasValidAuthJson true, readAuthJson valid), then make
    // hasValidGhcAuth — called inside the per-profile try — throw a non-Error string
    // so the outer catch at 368 takes the String(error) arm.
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    vi.spyOn(m as any, 'hasValidGhcAuth').mockImplementation(() => { throw 'plain string profile failure'; });
    const result = await (m as any).getBasicValidProfiles();
    expect(result).toHaveLength(0);
  });

  it('per-profile catch stringifies an Error throw (line 368 true arm)', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([{ name: 'cov2user', isDirectory: () => true }]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    vi.spyOn(m as any, 'hasValidGhcAuth').mockImplementation(() => { throw new Error('profile error'); });
    const result = await (m as any).getBasicValidProfiles();
    expect(result).toHaveLength(0);
  });

  it('scan-level catch stringifies a non-Error readdir rejection (line 376/377)', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockRejectedValue('plain string readdir failure');
    await expect((m as any).getBasicValidProfiles()).rejects.toThrow(/Unknown error/);
  });
});

// ── setCurrentAuth: userLogin 'unknown' (400) + catch branches (428,438,453) ──

describe('MainAuthManager - setCurrentAuth fallback + non-Error catches', () => {
  it('userLogin falls back to "unknown" when login missing (line 400 || side)', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    const data: any = makeAuthData();
    delete data.ghcAuth.user.login; // userLogin = authData?.ghcAuth?.user?.login || 'unknown'
    await m.setCurrentAuth(data);
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });

  it('handlePostAuthentication non-Error rejection is caught (line 428)', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockRejectedValue('plain string postauth failure');
    await m.setCurrentAuth(makeAuthData());
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });

  it('startMonitoring non-Error throw is caught (line 438)', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    mocks.startMonitoringMock.mockImplementationOnce(() => { throw 'plain string monitor failure'; });
    await m.setCurrentAuth(makeAuthData());
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });

  it('forceNotify non-Error rejection is caught (line 453)', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    mocks.forceNotifyMock.mockRejectedValue('plain string notify failure');
    await m.setCurrentAuth(makeAuthData());
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });

  it('logs failure detail when post-auth result.success is false (line 418 else)', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: false, isNewUser: false, hasUpdates: false, message: 'nope' });
    await m.setCurrentAuth(makeAuthData());
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });
});

// ── handlePostAuthentication: mkdir catch (479) + outer catch (554/559) ───────

describe('MainAuthManager - handlePostAuthentication non-Error catches', () => {
  it('mkdir non-Error rejection returns failure (line 479)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockRejectedValue('plain string mkdir failure');
    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to create directory');
  });

  it('outer catch stringifies a non-Error throw (line 554/559)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    // hasValidAuthForProfile -> readAuthJson -> stat is fine, but force readFile to throw
    // non-Error after mkdir to reach the outer catch via hasValidAuthForProfile path.
    vi.spyOn(m as any, 'hasValidAuthForProfile').mockImplementation(() => { throw 'plain string outer failure'; });
    const result = await m.handlePostAuthentication(makeAuthData());
    expect(result.success).toBe(false);
    expect(result.message).toContain('Error handling post-authentication');
  });
});

// ── initializeProfileManager: non-Error catch (583/586) ──────────────────────

describe('MainAuthManager - initializeProfileManager non-Error catch (583/586)', () => {
  it('returns failure when handleProfile rejects with a non-Error value', async () => {
    const m = new MainAuthManager();
    mocks.handleProfileMock.mockRejectedValue('plain string profile failure');
    const result = await (m as any).initializeProfileManager('cov2user');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Error initializing profile');
  });

  it('returns failure when handleProfile resolves falsy (line 576 else)', async () => {
    const m = new MainAuthManager();
    mocks.handleProfileMock.mockResolvedValue(false);
    const result = await (m as any).initializeProfileManager('cov2user');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed to initialize profile');
  });
});

// ── destroyCurrentAuth: non-Error catches (683/693) ──────────────────────────

describe('MainAuthManager - destroyCurrentAuth non-Error catches', () => {
  async function setup(): Promise<MainAuthManager> {
    const m = new MainAuthManager();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());
    return m;
  }

  it('stopMonitoring non-Error throw is caught (line 683)', async () => {
    const m = await setup();
    mocks.stopMonitoringMock.mockImplementationOnce(() => { throw 'plain string stop failure'; });
    await m.destroyCurrentAuth();
    expect(m.getCurrentAuth()).toBeNull();
  });

  it('clearTokensForUser non-Error rejection is caught (line 693)', async () => {
    const m = await setup();
    vi.spyOn(m as any, 'clearTokensForUser').mockRejectedValue('plain string clear failure');
    await m.destroyCurrentAuth();
    expect(m.getCurrentAuth()).toBeNull();
  });
});

// ── signOut: phase catches (728/735/743/751/764) + outer catch (771) ─────────

describe('MainAuthManager - signOut non-Error phase catches', () => {
  async function setup(): Promise<{ m: MainAuthManager; sendMock: ReturnType<typeof vi.fn> }> {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
    await m.setCurrentAuth(makeAuthData());
    sendMock.mockClear();
    return { m, sendMock };
  }

  it('clearCache non-Error throw is caught (line 728)', async () => {
    const { m } = await setup();
    mocks.clearCacheMock.mockImplementationOnce(() => { throw 'plain string cache failure'; });
    await m.signOut();
    expect(mocks.mcpResetMock).toHaveBeenCalled();
  });

  it('mcpReset non-Error rejection is caught (line 735)', async () => {
    const { m } = await setup();
    mocks.mcpResetMock.mockRejectedValue('plain string mcp failure');
    await m.signOut();
    expect(mocks.agentDestroyMock).toHaveBeenCalled();
  });

  it('agentDestroy non-Error throw is caught (line 743)', async () => {
    const { m } = await setup();
    mocks.agentDestroyMock.mockImplementationOnce(() => { throw 'plain string agent failure'; });
    await m.signOut();
    expect(mocks.resetExternalAgentMock).toHaveBeenCalled();
  });

  it('resetExternalAgent non-Error rejection is caught (line 751)', async () => {
    const { m, sendMock } = await setup();
    mocks.resetExternalAgentMock.mockRejectedValue('plain string ea failure');
    await m.signOut();
    expect(sendMock).toHaveBeenCalledWith('auth:signOut', expect.any(Object));
  });

  it('renderer notify non-Error throw is caught (line 764)', async () => {
    const { m } = await setup();
    // webContents.send throws a non-Error during the Phase 5 notify
    (m as any).mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn(() => { throw 'plain string send failure'; }) },
    };
    await m.signOut();
    expect(mocks.resetExternalAgentMock).toHaveBeenCalled();
  });

  it('outer catch stringifies a non-Error throw and rethrows (line 771)', async () => {
    const { m } = await setup();
    vi.spyOn(m as any, 'destroyCurrentAuth').mockRejectedValue('plain string signout failure');
    await expect(m.signOut()).rejects.toBe('plain string signout failure');
  });
});

// ── clearTokensForUser error branches ────────────────────────────────────────

describe('MainAuthManager - clearTokensForUser branches', () => {
  it('returns false when readAuthJson returns null (line 785)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockRejectedValue(new Error('missing'));
    const result = await (m as any).clearTokensForUser('cov2user');
    expect(result).toBe(false);
  });

  it('non-Error throw is caught and returns false (line 823)', async () => {
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw 'plain string path failure'; });
    const result = await (m as any).clearTokensForUser('cov2user');
    expect(result).toBe(false);
  });

  it('returns false when writeAuthJson reports failure (line 818 else)', async () => {
    const m = new MainAuthManager();
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    mockFs.promises.writeFile.mockRejectedValue(new Error('write fail'));
    const result = await (m as any).clearTokensForUser('cov2user');
    expect(result).toBe(false);
  });
});

// ── updateAuthDataForCurrentAuth: non-Error catch (844) ──────────────────────

describe('MainAuthManager - updateAuthDataForCurrentAuth non-Error catch (844)', () => {
  it('swallows a non-Error throw when writeAuthJson fails', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw 'plain string update failure'; });
    await expect((m as any).updateAuthDataForCurrentAuth()).resolves.toBeUndefined();
  });

  it('returns early when no currentAuth (line 832)', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = null;
    await expect((m as any).updateAuthDataForCurrentAuth()).resolves.toBeUndefined();
  });
});

// ── getLocalActiveAuths: non-Error catch (855) ───────────────────────────────

describe('MainAuthManager - getLocalActiveAuths non-Error catch (855)', () => {
  it('returns [] when getBasicValidProfiles rejects with a non-Error', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockRejectedValue('plain string scan failure');
    const result = await m.getLocalActiveAuths();
    expect(result).toEqual([]);
  });
});

// ── notifyRendererAuthChanged: non-Error catch (872) ─────────────────────────

describe('MainAuthManager - notifyRendererAuthChanged non-Error catch (872)', () => {
  it('swallows a non-Error throw from webContents.send', () => {
    const m = new MainAuthManager();
    (m as any).mainWindow = {
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn(() => { throw 'plain string send failure'; }) },
    };
    expect(() => (m as any).notifyRendererAuthChanged('test', null)).not.toThrow();
  });
});

// ── refreshCopilotToken: compound requiresReauth (945) + error.message || (951)

describe('MainAuthManager - refreshCopilotToken branch tails', () => {
  it('requiresReauth via httpStatus=401 && TOKEN_EXPIRED only (line 945 third arm)', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(makeAuthData()));
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    mocks.ghcRefreshMock.mockRejectedValue(
      Object.assign(new Error('expired'), {
        shouldClearSession: false,
        analysis: { errorType: 'TOKEN_EXPIRED' },
        httpStatus: 401,
      })
    );
    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.requiresReauth).toBe(true);
  });

  it('error.message falls back to "Unknown error..." when message empty (line 951 || side)', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    // Reject with an object that has no message property → error.message is undefined.
    mocks.ghcRefreshMock.mockRejectedValue({ shouldClearSession: false });
    const result = await m.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error during token refresh');
    expect(result.requiresReauth).toBe(false);
  });

  it('requiresReauth false when httpStatus not 401 even with TOKEN_EXPIRED (945 false)', async () => {
    const m = new MainAuthManager();
    (m as any).currentAuth = makeAuthData();
    mocks.ghcRefreshMock.mockRejectedValue(
      Object.assign(new Error('expired'), {
        shouldClearSession: false,
        analysis: { errorType: 'TOKEN_EXPIRED' },
        httpStatus: 500,
      })
    );
    const result = await m.refreshCopilotToken();
    expect(result.requiresReauth).toBe(false);
  });
});

// ── getValidAuthsForSignin: non-Error rethrow (1011) ─────────────────────────

describe('MainAuthManager - getValidAuthsForSignin non-Error rethrow (1011)', () => {
  it('rethrows a non-Error scan failure', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockRejectedValue('plain string signin failure');
    await expect(m.getValidAuthsForSignin()).rejects.toBe('plain string signin failure');
  });

  it('invalidAuths uses "unknown" alias fallback (line 998 || side)', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockResolvedValue([
      { version: '3.0.0', ghcAuth: null } as any,
    ]);
    const result = await m.getValidAuthsForSignin();
    expect(result.invalidAuths[0].alias).toBe('unknown');
  });
});

// ── getProfilesWithAuth: non-Error catch (1027) ──────────────────────────────

describe('MainAuthManager - getProfilesWithAuth non-Error catch (1027)', () => {
  it('returns [] on non-Error rejection', async () => {
    const m = new MainAuthManager();
    vi.spyOn(m as any, 'getBasicValidProfiles').mockRejectedValue('plain string profiles failure');
    const result = await m.getProfilesWithAuth();
    expect(result).toEqual([]);
  });
});

// ── clearAuthTokens: non-Error catch (1068) ──────────────────────────────────

describe('MainAuthManager - clearAuthTokens non-Error catch (1068)', () => {
  it('returns false on a non-Error throw', async () => {
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw 'plain string cleartok failure'; });
    const result = await m.clearAuthTokens('cov2user');
    expect(result).toBe(false);
  });
});

// ── deleteAuthJson: non-Error catch (1088) ───────────────────────────────────

describe('MainAuthManager - deleteAuthJson non-Error catch (1088)', () => {
  it('returns false on a non-Error throw', async () => {
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw 'plain string delete failure'; });
    const result = await m.deleteAuthJson('cov2user');
    expect(result).toBe(false);
  });
});

// ── updateAuthJson: non-Error catch (1102) ───────────────────────────────────

describe('MainAuthManager - updateAuthJson non-Error catch (1102)', () => {
  it('returns false on a non-Error throw', async () => {
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementationOnce(() => { throw 'plain string updatejson failure'; });
    const result = await m.updateAuthJson('cov2user', makeAuthData());
    expect(result).toBe(false);
  });
});
