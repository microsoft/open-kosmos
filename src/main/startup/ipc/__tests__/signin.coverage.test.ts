import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockHandle = vi.hoisted(() => vi.fn());

const mockAuthManager = vi.hoisted(() => ({
  getValidAuthsForSignin: vi.fn(),
  clearAuthTokens: vi.fn(),
  deleteAuthJson: vi.fn(),
  updateAuthJson: vi.fn(),
  getProfilesWithAuth: vi.fn(),
}));

const mockGetMainAuthManager = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  ipcMain: { handle: mockHandle },
}));

vi.mock('../../lazy', () => ({
  getMainAuthManager: mockGetMainAuthManager,
}));

// ── import SUT ─────────────────────────────────────────────────────────────────
import registerSigninIpc from '../signin';

// ── helpers ────────────────────────────────────────────────────────────────────

function getHandler(channel: string) {
  const call = mockHandle.mock.calls.find(([c]) => c === channel);
  if (!call) throw new Error(`Handler for "${channel}" not registered`);
  return call[1] as (...args: any[]) => Promise<any>;
}

const fakeEvent = {} as Electron.IpcMainInvokeEvent;

function makeCtx(alias: string | null = 'user1') {
  return { currentUserAlias: alias } as any;
}

// ── tests ──────────────────────────────────────────────────────────────────────
describe('signin IPC handlers', () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = makeCtx('user1');
    mockGetMainAuthManager.mockResolvedValue(mockAuthManager);
    registerSigninIpc(ctx);
  });

  // ── signin:getValidUsersForSignin ────────────────────────────────────────────
  describe('signin:getValidUsersForSignin', () => {
    it('returns success with user validation data', async () => {
      const data = [{ alias: 'user1', isValid: true }];
      mockAuthManager.getValidAuthsForSignin.mockResolvedValue(data);
      const handler = getHandler('signin:getValidUsersForSignin');
      const result = await handler(fakeEvent);
      expect(result).toEqual({ success: true, data });
    });

    it('returns error on exception', async () => {
      mockAuthManager.getValidAuthsForSignin.mockRejectedValue(new Error('auth error'));
      const handler = getHandler('signin:getValidUsersForSignin');
      const result = await handler(fakeEvent);
      expect(result).toEqual({ success: false, error: 'auth error' });
    });

    it('handles non-Error exception', async () => {
      mockAuthManager.getValidAuthsForSignin.mockRejectedValue('oops');
      const handler = getHandler('signin:getValidUsersForSignin');
      const result = await handler(fakeEvent);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ── signin:clearTokens ───────────────────────────────────────────────────────
  describe('signin:clearTokens', () => {
    it('returns success and clears currentUserAlias when alias matches', async () => {
      mockAuthManager.clearAuthTokens.mockResolvedValue(true);
      const handler = getHandler('signin:clearTokens');
      const result = await handler(fakeEvent, 'user1');
      expect(result).toEqual({ success: true, error: undefined });
      expect(ctx.currentUserAlias).toBeNull();
    });

    it('does not clear currentUserAlias when alias differs', async () => {
      mockAuthManager.clearAuthTokens.mockResolvedValue(true);
      const handler = getHandler('signin:clearTokens');
      const result = await handler(fakeEvent, 'other-user');
      expect(result).toEqual({ success: true, error: undefined });
      expect(ctx.currentUserAlias).toBe('user1');
    });

    it('returns failure when clearAuthTokens returns false', async () => {
      mockAuthManager.clearAuthTokens.mockResolvedValue(false);
      const handler = getHandler('signin:clearTokens');
      const result = await handler(fakeEvent, 'user1');
      expect(result).toEqual({ success: false, error: 'Failed to clear auth tokens' });
    });

    it('returns error on exception', async () => {
      mockAuthManager.clearAuthTokens.mockRejectedValue(new Error('clear failed'));
      const handler = getHandler('signin:clearTokens');
      const result = await handler(fakeEvent, 'user1');
      expect(result).toEqual({ success: false, error: 'clear failed' });
    });

    it('handles non-Error exception', async () => {
      mockAuthManager.clearAuthTokens.mockRejectedValue({ code: 500 });
      const handler = getHandler('signin:clearTokens');
      const result = await handler(fakeEvent, 'user1');
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });

  // ── signin:clearAuthData ─────────────────────────────────────────────────────
  describe('signin:clearAuthData', () => {
    it('returns success and clears alias when matching', async () => {
      mockAuthManager.deleteAuthJson.mockResolvedValue(true);
      const handler = getHandler('signin:clearAuthData');
      const result = await handler(fakeEvent, 'user1');
      expect(result).toEqual({ success: true, error: undefined });
      expect(ctx.currentUserAlias).toBeNull();
    });

    it('does not clear alias when non-matching', async () => {
      mockAuthManager.deleteAuthJson.mockResolvedValue(true);
      const handler = getHandler('signin:clearAuthData');
      await handler(fakeEvent, 'other');
      expect(ctx.currentUserAlias).toBe('user1');
    });

    it('returns failure when deleteAuthJson returns false', async () => {
      mockAuthManager.deleteAuthJson.mockResolvedValue(false);
      const handler = getHandler('signin:clearAuthData');
      const result = await handler(fakeEvent, 'user1');
      expect(result).toEqual({ success: false, error: 'Failed to clear auth.json file' });
    });

    it('returns error on exception', async () => {
      mockAuthManager.deleteAuthJson.mockRejectedValue(new Error('delete error'));
      const handler = getHandler('signin:clearAuthData');
      const result = await handler(fakeEvent, 'user1');
      expect(result).toEqual({ success: false, error: 'delete error' });
    });
  });

  // ── signin:updateAuthData ────────────────────────────────────────────────────
  describe('signin:updateAuthData', () => {
    it('returns success when updateAuthJson returns true', async () => {
      mockAuthManager.updateAuthJson.mockResolvedValue(true);
      const handler = getHandler('signin:updateAuthData');
      const result = await handler(fakeEvent, 'user1', { token: 'abc' });
      expect(result).toEqual({ success: true, error: undefined });
    });

    it('returns failure when updateAuthJson returns false', async () => {
      mockAuthManager.updateAuthJson.mockResolvedValue(false);
      const handler = getHandler('signin:updateAuthData');
      const result = await handler(fakeEvent, 'user1', {});
      expect(result).toEqual({ success: false, error: 'Failed to update auth data' });
    });

    it('returns error on exception', async () => {
      mockAuthManager.updateAuthJson.mockRejectedValue(new Error('update error'));
      const handler = getHandler('signin:updateAuthData');
      const result = await handler(fakeEvent, 'user1', {});
      expect(result).toEqual({ success: false, error: 'update error' });
    });
  });

  // ── signin:updateAuthJson ────────────────────────────────────────────────────
  describe('signin:updateAuthJson', () => {
    it('returns success when updateAuthJson returns true', async () => {
      mockAuthManager.updateAuthJson.mockResolvedValue(true);
      const handler = getHandler('signin:updateAuthJson');
      const result = await handler(fakeEvent, 'user1', { token: 'abc' });
      expect(result).toEqual({ success: true, error: undefined });
    });

    it('returns failure when updateAuthJson returns false', async () => {
      mockAuthManager.updateAuthJson.mockResolvedValue(false);
      const handler = getHandler('signin:updateAuthJson');
      const result = await handler(fakeEvent, 'user1', {});
      expect(result).toEqual({ success: false, error: 'Failed to update auth.json' });
    });

    it('returns error on exception', async () => {
      mockAuthManager.updateAuthJson.mockRejectedValue(new Error('json error'));
      const handler = getHandler('signin:updateAuthJson');
      const result = await handler(fakeEvent, 'user1', {});
      expect(result).toEqual({ success: false, error: 'json error' });
    });
  });

  // ── signin:getProfilesWithGhcAuth ────────────────────────────────────────────
  describe('signin:getProfilesWithGhcAuth', () => {
    it('returns success with profiles', async () => {
      const profiles = [{ alias: 'user1', hasAuth: true }];
      mockAuthManager.getProfilesWithAuth.mockResolvedValue(profiles);
      const handler = getHandler('signin:getProfilesWithGhcAuth');
      const result = await handler(fakeEvent);
      expect(result).toEqual({ success: true, data: profiles });
    });

    it('returns error on exception', async () => {
      mockAuthManager.getProfilesWithAuth.mockRejectedValue(new Error('profiles error'));
      const handler = getHandler('signin:getProfilesWithGhcAuth');
      const result = await handler(fakeEvent);
      expect(result).toEqual({ success: false, error: 'profiles error' });
    });

    it('handles non-Error exception', async () => {
      mockAuthManager.getProfilesWithAuth.mockRejectedValue('fail');
      const handler = getHandler('signin:getProfilesWithGhcAuth');
      const result = await handler(fakeEvent);
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });
});
