/**
 * Coverage tests for ManageRemoteChannelTool
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────────

const {
  mockGetInstance,
  mockGetChannelStatus,
  mockStartChannel,
  mockStopChannel,
  mockBind,
  mockUnbind,
  mockGetCachedProfile,
  mockGetCredential,
  currentUserAliasRef,
} = vi.hoisted(() => {
  const mockGetChannelStatus = vi.fn().mockReturnValue({ status: 'stopped' });
  const mockStartChannel = vi.fn().mockResolvedValue(undefined);
  const mockStopChannel = vi.fn().mockResolvedValue(undefined);
  const mockBind = vi.fn().mockResolvedValue({ userId: 'user-123' });
  const mockUnbind = vi.fn().mockResolvedValue(undefined);
  const mockGetCachedProfile = vi.fn().mockReturnValue({ remoteChannels: { teams: {} } });
  const mockGetCredential = vi.fn().mockResolvedValue(null);

  const instance = {
    getChannelStatus: mockGetChannelStatus,
    startChannel: mockStartChannel,
    stopChannel: mockStopChannel,
    bind: mockBind,
    unbind: mockUnbind,
  };

  // A mutable ref so we can toggle alias across tests
  const currentUserAliasRef = { value: 'testuser' as string | null };

  return {
    mockGetInstance: vi.fn().mockReturnValue(instance),
    mockGetChannelStatus,
    mockStartChannel,
    mockStopChannel,
    mockBind,
    mockUnbind,
    mockGetCachedProfile,
    mockGetCredential,
    currentUserAliasRef,
  };
});

vi.mock('../../../remoteChannel/channelManager', () => ({
  RemoteChannelManager: {
    getInstance: mockGetInstance,
  },
}));

vi.mock('../../../userDataADO', () => ({
  profileCacheManager: {
    get currentUserAlias() { return currentUserAliasRef.value; },
    getCachedProfile: mockGetCachedProfile,
  },
}));

vi.mock('../../../remoteChannel/credentialStore', () => ({
  credentialStore: {
    getCredential: mockGetCredential,
  },
}));

vi.mock('../../../../shared/constants/branding', () => ({
  APP_NAME: 'OpenKosmos',
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  app: { getPath: vi.fn(() => '/tmp') },
}));

import { ManageRemoteChannelTool } from '../manageRemoteChannelTool';

beforeEach(() => {
  vi.clearAllMocks();
  currentUserAliasRef.value = 'testuser';
  // Re-establish instance after clearAllMocks clears mockGetInstance
  const instance = {
    getChannelStatus: mockGetChannelStatus,
    startChannel: mockStartChannel,
    stopChannel: mockStopChannel,
    bind: mockBind,
    unbind: mockUnbind,
  };
  mockGetInstance.mockReturnValue(instance);
  mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
  mockGetCredential.mockResolvedValue(null);
  mockStartChannel.mockResolvedValue(undefined);
  mockStopChannel.mockResolvedValue(undefined);
  mockBind.mockResolvedValue({ userId: 'user-123' });
  mockUnbind.mockResolvedValue(undefined);
  mockGetCachedProfile.mockReturnValue({ remoteChannels: { teams: { boundChatId: 'chat-123' } } });
});

describe('ManageRemoteChannelTool.execute - invalid action', () => {
  it('returns error for invalid action', async () => {
    const result = await ManageRemoteChannelTool.execute({ action: 'invalid' as any });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_ACTION');
  });

  it('returns error for missing action', async () => {
    const result = await ManageRemoteChannelTool.execute({ action: undefined as any });
    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_ACTION');
  });
});

describe('ManageRemoteChannelTool.execute - no user session', () => {
  it('returns NO_USER_SESSION when alias is null', async () => {
    currentUserAliasRef.value = null;
    const result = await ManageRemoteChannelTool.execute({ action: 'status' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_USER_SESSION');
  });
});

describe('ManageRemoteChannelTool.execute - status', () => {
  it('returns status info for stopped channel', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
    const result = await ManageRemoteChannelTool.execute({ action: 'status', channel_id: 'teams' });
    expect(result.success).toBe(true);
    expect(result.action).toBe('status');
    expect(result.status).toBe('stopped');
  });

  it('returns status info for running channel with bound user', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    mockGetCredential
      .mockResolvedValueOnce('binding-token')
      .mockResolvedValueOnce('user-456');
    const result = await ManageRemoteChannelTool.execute({ action: 'status', channel_id: 'teams' });
    expect(result.success).toBe(true);
    expect(result.bound).toBe(true);
    expect(result.bound_user_id).toBe('user-456');
  });
});

describe('ManageRemoteChannelTool.execute - start', () => {
  it('starts channel when stopped', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
    const result = await ManageRemoteChannelTool.execute({ action: 'start' });
    expect(result.success).toBe(true);
    expect(mockStartChannel).toHaveBeenCalled();
    expect(result.hint).toMatch(/not bound/);
  });

  it('returns already running message if channel is running', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    const result = await ManageRemoteChannelTool.execute({ action: 'start' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/already running/);
    expect(mockStartChannel).not.toHaveBeenCalled();
  });

  it('returns already starting message if channel is starting', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'starting' });
    const result = await ManageRemoteChannelTool.execute({ action: 'start' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/already starting/);
    expect(mockStartChannel).not.toHaveBeenCalled();
  });

  it('returns already reconnecting message if channel is reconnecting', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'reconnecting' });
    const result = await ManageRemoteChannelTool.execute({ action: 'start' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/already reconnecting/);
  });

  it('does not include hint if channel is bound after start', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
    // First getContext (pre-start): no token. After startChannel, second getContext: has token.
    mockGetCredential
      .mockResolvedValueOnce(null)  // bound? call #1 (pre-start getContext)
      .mockResolvedValueOnce(null)  // userId call #1
      .mockResolvedValueOnce('binding-token') // bound? call #2 (after start getContext)
      .mockResolvedValueOnce('user-xyz');
    const result = await ManageRemoteChannelTool.execute({ action: 'start' });
    expect(result.hint).toBeUndefined();
  });
});

describe('ManageRemoteChannelTool.execute - stop', () => {
  it('stops a running channel', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    const result = await ManageRemoteChannelTool.execute({ action: 'stop' });
    expect(result.success).toBe(true);
    expect(mockStopChannel).toHaveBeenCalled();
  });

  it('returns already stopped message if channel is stopped', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
    const result = await ManageRemoteChannelTool.execute({ action: 'stop' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/already stopped/);
    expect(mockStopChannel).not.toHaveBeenCalled();
  });
});

describe('ManageRemoteChannelTool.execute - bind', () => {
  it('returns MISSING_BIND_CODE if no bind_code', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    const result = await ManageRemoteChannelTool.execute({ action: 'bind' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_BIND_CODE');
    expect(result.hint).toMatch(/send .bind/);
  });

  it('returns MISSING_BIND_CODE if whitespace bind_code', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    const result = await ManageRemoteChannelTool.execute({ action: 'bind', bind_code: '   ' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('MISSING_BIND_CODE');
  });

  it('returns NOT_RUNNING if channel is stopped', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'stopped' });
    const result = await ManageRemoteChannelTool.execute({ action: 'bind', bind_code: 'ABC123' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_RUNNING');
    expect(result.hint).toMatch(/Start the channel/);
  });

  it('binds successfully when running', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    mockBind.mockResolvedValueOnce({ userId: 'user-999' });
    const result = await ManageRemoteChannelTool.execute({ action: 'bind', bind_code: 'ABC123' });
    expect(result.success).toBe(true);
    expect(result.bound_user_id).toBe('user-999');
  });

  it('returns error if bind throws', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    mockBind.mockRejectedValueOnce(new Error('Code expired'));
    const result = await ManageRemoteChannelTool.execute({ action: 'bind', bind_code: 'ZZZZZZ' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Code expired');
    expect(result.hint).toMatch(/expired/);
  });
});

describe('ManageRemoteChannelTool.execute - unbind', () => {
  it('returns NOT_BOUND if channel is not bound', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    mockGetCredential.mockResolvedValue(null);
    const result = await ManageRemoteChannelTool.execute({ action: 'unbind' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_BOUND');
  });

  it('unbinds successfully', async () => {
    mockGetChannelStatus.mockReturnValue({ status: 'running' });
    mockGetCredential
      .mockResolvedValueOnce('binding-token') // token for bound check
      .mockResolvedValueOnce(null)           // userId
      .mockResolvedValueOnce(null)           // after-unbind token
      .mockResolvedValueOnce(null);          // after-unbind userId
    const result = await ManageRemoteChannelTool.execute({ action: 'unbind' });
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/unbound/);
    expect(mockUnbind).toHaveBeenCalled();
  });
});

describe('ManageRemoteChannelTool.execute - exception handling', () => {
  it('returns error when manager.getInstance throws', async () => {
    mockGetInstance.mockImplementationOnce(() => {
      throw new Error('Manager init failed');
    });
    const result = await ManageRemoteChannelTool.execute({ action: 'status' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Manager init failed');
  });
});

describe('ManageRemoteChannelTool.execute - defaults', () => {
  it('defaults channel_id to "teams"', async () => {
    const result = await ManageRemoteChannelTool.execute({ action: 'status' });
    expect(result.channel_id).toBe('teams');
  });
});
