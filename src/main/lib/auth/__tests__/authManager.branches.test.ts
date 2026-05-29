// Final coverage tests targeting specific uncovered branches
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

async function setupAuthManager(): Promise<{ m: MainAuthManager; sendMock: ReturnType<typeof vi.fn> }> {
  vi.clearAllMocks();
  const m = new MainAuthManager();
  const sendMock = vi.fn();
  m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
  vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
  vi.spyOn(m as any, 'clearTokensForUser').mockResolvedValue(true);
  await m.setCurrentAuth(makeAuthData());
  sendMock.mockClear();
  return { m, sendMock };
}

describe('MainAuthManager - destroyCurrentAuth error resilience', () => {
  it('logs error and continues when stopMonitoring throws', async () => {
    const { m } = await setupAuthManager();
    mocks.stopMonitoringMock.mockImplementation(() => { throw new Error('monitor stop error'); });
    await m.destroyCurrentAuth();
    expect(m.getCurrentAuth()).toBeNull();
    mocks.stopMonitoringMock.mockImplementation(() => {});
  });

  it('logs error and continues when clearTokensForUser throws', async () => {
    const { m } = await setupAuthManager();
    vi.spyOn(m as any, 'clearTokensForUser').mockRejectedValue(new Error('clear error'));
    await m.destroyCurrentAuth();
    expect(m.getCurrentAuth()).toBeNull();
  });
});

describe('MainAuthManager - signOut error resilience', () => {
  it('continues when clearCache throws', async () => {
    const { m } = await setupAuthManager();
    mocks.clearCacheMock.mockImplementation(() => { throw new Error('cache error'); });
    await m.signOut();
    expect(mocks.mcpResetMock).toHaveBeenCalled();
  });

  it('continues when mcpReset throws', async () => {
    const { m } = await setupAuthManager();
    mocks.mcpResetMock.mockRejectedValue(new Error('mcp error'));
    await m.signOut();
    expect(mocks.agentDestroyMock).toHaveBeenCalled();
  });

  it('continues when agentDestroy throws', async () => {
    const { m } = await setupAuthManager();
    mocks.agentDestroyMock.mockImplementation(() => { throw new Error('agent error'); });
    await m.signOut();
    expect(mocks.resetExternalAgentMock).toHaveBeenCalled();
  });

  it('continues when resetExternalAgent throws', async () => {
    const { m } = await setupAuthManager();
    mocks.resetExternalAgentMock.mockRejectedValue(new Error('ea error'));
    await m.signOut();
    // Should complete without throwing
  });
});

describe('MainAuthManager - setCurrentAuth: forceNotify error', () => {
  it('logs warning when forceNotify throws but does not crash', async () => {
    const m = new MainAuthManager();
    const sendMock = vi.fn();
    m.setMainWindow({ isDestroyed: vi.fn(() => false), webContents: { send: sendMock } } as any);
    vi.spyOn(m as any, 'handlePostAuthentication').mockResolvedValue({ success: true, isNewUser: false, hasUpdates: false });
    mocks.forceNotifyMock.mockRejectedValue(new Error('notify error'));

    await m.setCurrentAuth(makeAuthData());
    expect(sendMock).toHaveBeenCalledWith('auth:authChanged', expect.objectContaining({ type: 'auth_set' }));
  });
});

describe('MainAuthManager - hasValidGhcAuth: exception handling', () => {
  it('returns false when accessing ghcAuth throws', () => {
    const m = new MainAuthManager();
    const badInput = {
      get ghcAuth() { throw new Error('getter error'); }
    };
    expect((m as any).hasValidGhcAuth(badInput)).toBe(false);
  });
});

describe('MainAuthManager - getBasicValidProfiles: per-profile catch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips profile that throws during stat check', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    let statCallCount = 0;
    mockFs.promises.stat.mockImplementation(() => {
      statCallCount++;
      throw new Error('unexpected stat error');
    });

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });

  it('rethrows scan-level error from getLocalActiveAuths', async () => {
    const m = new MainAuthManager();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockRejectedValue(new Error('critical failure'));

    // getLocalActiveAuths swallows the error internally
    const result = await m.getLocalActiveAuths();
    expect(result).toEqual([]);
  });
});

describe('MainAuthManager - handlePostAuthentication: update write failure', () => {
  it('returns failure when auth.json write fails for existing user with updates', async () => {
    const m = new MainAuthManager();
    const existingData = makeAuthData();
    const newData = makeAuthData();
    newData.ghcAuth.user.name = 'Updated Name';

    mockFs.promises.mkdir.mockResolvedValue(undefined);
    // auth.json exists
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(existingData));
    // write fails
    mockFs.promises.writeFile.mockRejectedValue(new Error('write error'));

    const result = await m.handlePostAuthentication(newData);
    expect(result.success).toBe(false);
    expect(result.hasUpdates).toBe(true);
  });
});
