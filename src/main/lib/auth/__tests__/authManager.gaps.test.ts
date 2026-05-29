// Last gap coverage tests
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

describe('MainAuthManager - clearTokensForUser catch (line 833-834)', () => {
  it('returns false when getProfilesDirectoryPath throws', async () => {
    vi.clearAllMocks();
    const m = new MainAuthManager();
    mocks.appGetPathMock.mockImplementation(() => { throw new Error('userData path error'); });

    const result = await (m as any).clearTokensForUser('testuser');
    expect(result).toBe(false);
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
  });
});

describe('MainAuthManager - getBasicValidProfiles: empty/whitespace GitHub token (line 333-334)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
  });

  it('skips profile when hasValidGhcAuth passes but access_token is empty (defensive check)', async () => {
    const m = new MainAuthManager();
    const authData = makeAuthData();
    authData.ghcAuth.gitHubTokens.access_token = '';

    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(authData));

    // Force hasValidGhcAuth to return true even for empty token (to test the defensive check)
    vi.spyOn(m as any, 'hasValidGhcAuth').mockReturnValue(true);

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });
});

describe('MainAuthManager - getBasicValidProfiles: per-profile catch (line 369-370)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appGetPathMock.mockReturnValue('/tmp/test-userdata');
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips profile that throws in outer per-profile catch', async () => {
    const m = new MainAuthManager();

    mockFs.existsSync.mockReturnValue(true);
    mockFs.promises.readdir.mockResolvedValue([
      { name: 'testuser', isDirectory: () => true },
    ]);
    mockFs.promises.stat.mockResolvedValue({ isFile: () => true });

    // Return data with null ghcAuth so setting alias throws
    const badData = { version: '3.0.0', ghcAuth: null };
    mockFs.promises.readFile.mockResolvedValue(JSON.stringify(badData));

    // Force past hasValidGhcAuth and past the empty token check
    vi.spyOn(m as any, 'hasValidGhcAuth').mockReturnValue(true);

    // Return valid token so we get past the empty token check
    // but then fetch succeeds, and trying to do authData.ghcAuth.alias = alias will throw
    (global.fetch as any).mockResolvedValue({ ok: true, status: 200 });

    const result = await m.getLocalActiveAuths();
    expect(result).toHaveLength(0);
  });
});
