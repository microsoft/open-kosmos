// @ts-nocheck
/** @vitest-environment happy-dom */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Reset the singleton before each test
import { AuthManagerProxy } from '../authManagerProxy';

function makeAuthData(login = 'octocat') {
  return {
    version: '3.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    authProvider: 'ghc',
    ghcAuth: {
      alias: login,
      aadAccount: `${login}@github.com`,
      user: { id: '1', login, name: login, email: '', avatarUrl: '', copilotPlan: 'individual' as const },
      gitHubTokens: { timestamp: '', api_url: '', access_token: 'gh-tok', token_type: 'bearer', scope: '' },
      copilotTokens: { timestamp: '', api_url: '', expires_at: 9999999999, token: 'cplt' },
      capabilities: ['chat'],
    },
  } as const;
}

function buildElectronAPI(overrides: Record<string, any> = {}) {
  return {
    auth: {
      setCurrentAuth: vi.fn().mockResolvedValue({ success: true }),
      getCurrentAuth: vi.fn().mockResolvedValue({ success: true, data: makeAuthData() }),
      destroyCurrentAuth: vi.fn().mockResolvedValue({ success: true }),
      signOut: vi.fn().mockResolvedValue({ success: true }),
      getCopilotToken: vi.fn().mockResolvedValue({ success: true, data: 'cplt-tok' }),
      getGitHubToken: vi.fn().mockResolvedValue({ success: true, data: 'gh-tok' }),
      getLocalActiveAuths: vi.fn().mockResolvedValue({ success: true, data: [makeAuthData()] }),
      refreshCopilotToken: vi.fn().mockResolvedValue({ success: true, data: { authData: makeAuthData() } }),
      onAuthChanged: vi.fn().mockReturnValue(() => {}),
      stopTokenMonitoring: vi.fn().mockResolvedValue({ success: true }),
      manualTokenCheck: vi.fn().mockResolvedValue({ success: true }),
      onTokenMonitor: vi.fn().mockReturnValue(() => {}),
      ...overrides,
    },
  };
}

beforeEach(() => {
  AuthManagerProxy.resetInstance();
  (window as any).electronAPI = buildElectronAPI();
});

afterEach(() => {
  delete (window as any).electronAPI;
  AuthManagerProxy.resetInstance();
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe('AuthManagerProxy singleton', () => {
  it('getInstance returns same instance', () => {
    const a = AuthManagerProxy.getInstance();
    const b = AuthManagerProxy.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance allows a fresh instance', () => {
    const a = AuthManagerProxy.getInstance();
    AuthManagerProxy.resetInstance();
    const b = AuthManagerProxy.getInstance();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// setCurrentAuth
// ---------------------------------------------------------------------------

describe('setCurrentAuth', () => {
  it('calls IPC and caches authData on success', async () => {
    const proxy = new AuthManagerProxy();
    const authData = makeAuthData();
    await proxy.setCurrentAuth(authData);
    expect((window as any).electronAPI.auth.setCurrentAuth).toHaveBeenCalledWith(authData);
    expect(proxy.getCurrentAuth()).toBe(authData);
  });

  it('throws when electronAPI.auth.setCurrentAuth is unavailable', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    await expect(proxy.setCurrentAuth(makeAuthData())).rejects.toThrow('Auth API not available');
  });

  it('throws when IPC returns success=false', async () => {
    (window as any).electronAPI.auth.setCurrentAuth = vi.fn().mockResolvedValue({ success: false, error: 'bad creds' });
    const proxy = new AuthManagerProxy();
    await expect(proxy.setCurrentAuth(makeAuthData())).rejects.toThrow('bad creds');
  });

  it('uses fallback message when error field is absent', async () => {
    (window as any).electronAPI.auth.setCurrentAuth = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    await expect(proxy.setCurrentAuth(makeAuthData())).rejects.toThrow('Failed to set current auth');
  });
});

// ---------------------------------------------------------------------------
// getCurrentAuth (sync)
// ---------------------------------------------------------------------------

describe('getCurrentAuth', () => {
  it('returns null initially', () => {
    const proxy = new AuthManagerProxy();
    expect(proxy.getCurrentAuth()).toBeNull();
  });

  it('returns cached value after setCurrentAuth', async () => {
    const proxy = new AuthManagerProxy();
    const auth = makeAuthData();
    await proxy.setCurrentAuth(auth);
    expect(proxy.getCurrentAuth()).toBe(auth);
  });
});

// ---------------------------------------------------------------------------
// getCurrentAuthAsync
// ---------------------------------------------------------------------------

describe('getCurrentAuthAsync', () => {
  it('fetches and caches auth data', async () => {
    const proxy = new AuthManagerProxy();
    const result = await proxy.getCurrentAuthAsync();
    expect(result).not.toBeNull();
    expect(proxy.getCurrentAuth()).toBe(result);
  });

  it('returns null when electronAPI is absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    const result = await proxy.getCurrentAuthAsync();
    expect(result).toBeNull();
  });

  it('returns null when IPC returns success=false', async () => {
    (window as any).electronAPI.auth.getCurrentAuth = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    const result = await proxy.getCurrentAuthAsync();
    expect(result).toBeNull();
  });

  it('returns null when result.data is falsy', async () => {
    (window as any).electronAPI.auth.getCurrentAuth = vi.fn().mockResolvedValue({ success: true, data: null });
    const proxy = new AuthManagerProxy();
    const result = await proxy.getCurrentAuthAsync();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// destroyCurrentAuth
// ---------------------------------------------------------------------------

describe('destroyCurrentAuth', () => {
  it('clears cache on success', async () => {
    const proxy = new AuthManagerProxy();
    const auth = makeAuthData();
    await proxy.setCurrentAuth(auth);
    await proxy.destroyCurrentAuth();
    expect(proxy.getCurrentAuth()).toBeNull();
  });

  it('throws when electronAPI is absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    await expect(proxy.destroyCurrentAuth()).rejects.toThrow('Auth API not available');
  });

  it('throws when IPC returns success=false', async () => {
    (window as any).electronAPI.auth.destroyCurrentAuth = vi.fn().mockResolvedValue({ success: false, error: 'fail' });
    const proxy = new AuthManagerProxy();
    await expect(proxy.destroyCurrentAuth()).rejects.toThrow('fail');
  });

  it('uses fallback message when error is absent', async () => {
    (window as any).electronAPI.auth.destroyCurrentAuth = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    await expect(proxy.destroyCurrentAuth()).rejects.toThrow('Failed to destroy current auth');
  });
});

// ---------------------------------------------------------------------------
// signOut
// ---------------------------------------------------------------------------

describe('signOut', () => {
  it('clears cache on success', async () => {
    const proxy = new AuthManagerProxy();
    await proxy.setCurrentAuth(makeAuthData());
    await proxy.signOut();
    expect(proxy.getCurrentAuth()).toBeNull();
  });

  it('throws when electronAPI is absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    await expect(proxy.signOut()).rejects.toThrow('Auth API not available');
  });

  it('throws when IPC fails', async () => {
    (window as any).electronAPI.auth.signOut = vi.fn().mockResolvedValue({ success: false, error: 'sign-out error' });
    const proxy = new AuthManagerProxy();
    await expect(proxy.signOut()).rejects.toThrow('sign-out error');
  });

  it('uses fallback message', async () => {
    (window as any).electronAPI.auth.signOut = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    await expect(proxy.signOut()).rejects.toThrow('signOut failed');
  });
});

// ---------------------------------------------------------------------------
// getCopilotAccessToken
// ---------------------------------------------------------------------------

describe('getCopilotAccessToken', () => {
  it('returns token string on success', async () => {
    const proxy = new AuthManagerProxy();
    const tok = await proxy.getCopilotAccessToken();
    expect(tok).toBe('cplt-tok');
  });

  it('returns null when electronAPI is absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    expect(await proxy.getCopilotAccessToken()).toBeNull();
  });

  it('returns null when IPC returns success=false', async () => {
    (window as any).electronAPI.auth.getCopilotToken = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    expect(await proxy.getCopilotAccessToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getGitHubAccessToken
// ---------------------------------------------------------------------------

describe('getGitHubAccessToken', () => {
  it('returns token on success', async () => {
    const proxy = new AuthManagerProxy();
    const tok = await proxy.getGitHubAccessToken();
    expect(tok).toBe('gh-tok');
  });

  it('returns null when electronAPI absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    expect(await proxy.getGitHubAccessToken()).toBeNull();
  });

  it('returns null when IPC fails', async () => {
    (window as any).electronAPI.auth.getGitHubToken = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    expect(await proxy.getGitHubAccessToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getLocalActiveAuths
// ---------------------------------------------------------------------------

describe('getLocalActiveAuths', () => {
  it('returns auth array on success', async () => {
    const proxy = new AuthManagerProxy();
    const auths = await proxy.getLocalActiveAuths();
    expect(auths).toHaveLength(1);
  });

  it('throws when electronAPI absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    await expect(proxy.getLocalActiveAuths()).rejects.toThrow('Auth API not available');
  });

  it('throws when IPC fails', async () => {
    (window as any).electronAPI.auth.getLocalActiveAuths = vi.fn().mockResolvedValue({ success: false, error: 'oops' });
    const proxy = new AuthManagerProxy();
    await expect(proxy.getLocalActiveAuths()).rejects.toThrow('oops');
  });

  it('returns empty array when data field absent', async () => {
    (window as any).electronAPI.auth.getLocalActiveAuths = vi.fn().mockResolvedValue({ success: true });
    const proxy = new AuthManagerProxy();
    const auths = await proxy.getLocalActiveAuths();
    expect(auths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// refreshCopilotToken
// ---------------------------------------------------------------------------

describe('refreshCopilotToken', () => {
  it('returns data object and updates cache', async () => {
    const proxy = new AuthManagerProxy();
    const result = await proxy.refreshCopilotToken();
    // refreshCopilotToken returns result.data (which has authData inside) on success
    expect((result as any).authData).toBeDefined();
    expect(proxy.getCurrentAuth()).not.toBeNull();
  });

  it('returns the raw data object when authData is absent — does not crash', async () => {
    (window as any).electronAPI.auth.refreshCopilotToken = vi.fn().mockResolvedValue({ success: true, data: {} });
    const proxy = new AuthManagerProxy();
    // result.data is {} — no .success field, but no throw
    const result = await proxy.refreshCopilotToken();
    expect(result).toEqual({});
  });

  it('returns failure result when electronAPI absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    const result = await proxy.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.requiresReauth).toBe(true);
  });

  it('returns failure when IPC returns success=false', async () => {
    (window as any).electronAPI.auth.refreshCopilotToken = vi.fn().mockResolvedValue({ success: false, error: 'expired' });
    const proxy = new AuthManagerProxy();
    const result = await proxy.refreshCopilotToken();
    expect(result.success).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('uses fallback error when error field absent', async () => {
    (window as any).electronAPI.auth.refreshCopilotToken = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    const result = await proxy.refreshCopilotToken();
    expect(result.error).toBe('Failed to refresh token');
  });
});

// ---------------------------------------------------------------------------
// onAuthChanged
// ---------------------------------------------------------------------------

describe('onAuthChanged', () => {
  it('registers callback and returns unsubscribe function', () => {
    const proxy = new AuthManagerProxy();
    const cb = vi.fn();
    const unsub = proxy.onAuthChanged(cb);
    expect(typeof unsub).toBe('function');
  });

  it('returns no-op unsubscribe when electronAPI absent', () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    const unsub = proxy.onAuthChanged(vi.fn());
    expect(() => unsub()).not.toThrow();
  });

  it('updates cache on auth_set event', () => {
    const proxy = new AuthManagerProxy();
    let capturedCallback: ((data: any) => void) | undefined;
    (window as any).electronAPI.auth.onAuthChanged = vi.fn((cb: any) => {
      capturedCallback = cb;
      return () => {};
    });

    const userCb = vi.fn();
    proxy.onAuthChanged(userCb);

    const auth = makeAuthData('newuser');
    capturedCallback!({ type: 'auth_set', authData: auth });

    expect(proxy.getCurrentAuth()).toBe(auth);
    expect(userCb).toHaveBeenCalledWith({ type: 'auth_set', authData: auth });
  });

  it('updates cache on copilot_token_refreshed event', () => {
    const proxy = new AuthManagerProxy();
    let capturedCallback: ((data: any) => void) | undefined;
    (window as any).electronAPI.auth.onAuthChanged = vi.fn((cb: any) => {
      capturedCallback = cb;
      return () => {};
    });

    proxy.onAuthChanged(vi.fn());
    const auth = makeAuthData('refreshed');
    capturedCallback!({ type: 'copilot_token_refreshed', authData: auth });
    expect(proxy.getCurrentAuth()).toBe(auth);
  });

  it('clears cache on auth_destroyed event', async () => {
    const proxy = new AuthManagerProxy();
    await proxy.setCurrentAuth(makeAuthData());

    let capturedCallback: ((data: any) => void) | undefined;
    (window as any).electronAPI.auth.onAuthChanged = vi.fn((cb: any) => {
      capturedCallback = cb;
      return () => {};
    });

    proxy.onAuthChanged(vi.fn());
    capturedCallback!({ type: 'auth_destroyed', authData: null });
    expect(proxy.getCurrentAuth()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// stopTokenMonitoring
// ---------------------------------------------------------------------------

describe('stopTokenMonitoring', () => {
  it('resolves on success', async () => {
    const proxy = new AuthManagerProxy();
    await expect(proxy.stopTokenMonitoring()).resolves.toBeUndefined();
  });

  it('throws when electronAPI absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    await expect(proxy.stopTokenMonitoring()).rejects.toThrow('Auth API not available');
  });

  it('throws when IPC fails', async () => {
    (window as any).electronAPI.auth.stopTokenMonitoring = vi.fn().mockResolvedValue({ success: false, error: 'err' });
    const proxy = new AuthManagerProxy();
    await expect(proxy.stopTokenMonitoring()).rejects.toThrow('err');
  });

  it('uses fallback message', async () => {
    (window as any).electronAPI.auth.stopTokenMonitoring = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    await expect(proxy.stopTokenMonitoring()).rejects.toThrow('Failed to stop token monitoring');
  });
});

// ---------------------------------------------------------------------------
// manualTokenCheck
// ---------------------------------------------------------------------------

describe('manualTokenCheck', () => {
  it('resolves on success', async () => {
    const proxy = new AuthManagerProxy();
    await expect(proxy.manualTokenCheck()).resolves.toBeUndefined();
  });

  it('throws when electronAPI absent', async () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    await expect(proxy.manualTokenCheck()).rejects.toThrow('Auth API not available');
  });

  it('throws when IPC fails', async () => {
    (window as any).electronAPI.auth.manualTokenCheck = vi.fn().mockResolvedValue({ success: false, error: 'chk err' });
    const proxy = new AuthManagerProxy();
    await expect(proxy.manualTokenCheck()).rejects.toThrow('chk err');
  });

  it('uses fallback message', async () => {
    (window as any).electronAPI.auth.manualTokenCheck = vi.fn().mockResolvedValue({ success: false });
    const proxy = new AuthManagerProxy();
    await expect(proxy.manualTokenCheck()).rejects.toThrow('Manual token check failed');
  });
});

// ---------------------------------------------------------------------------
// onTokenMonitor
// ---------------------------------------------------------------------------

describe('onTokenMonitor', () => {
  it('registers and returns unsubscribe', () => {
    const proxy = new AuthManagerProxy();
    const unsub = proxy.onTokenMonitor(vi.fn());
    expect(typeof unsub).toBe('function');
  });

  it('returns no-op when electronAPI absent', () => {
    delete (window as any).electronAPI;
    const proxy = new AuthManagerProxy();
    const unsub = proxy.onTokenMonitor(vi.fn());
    expect(() => unsub()).not.toThrow();
  });

  it('forwards events to callback', () => {
    const proxy = new AuthManagerProxy();
    let captured: ((data: any) => void) | undefined;
    (window as any).electronAPI.auth.onTokenMonitor = vi.fn((cb: any) => {
      captured = cb;
      return () => {};
    });

    const cb = vi.fn();
    proxy.onTokenMonitor(cb);
    captured!({ type: 'token_refreshed' });
    expect(cb).toHaveBeenCalledWith({ type: 'token_refreshed' });
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('initialize', () => {
  it('fetches current auth and populates cache', async () => {
    const proxy = new AuthManagerProxy();
    await proxy.initialize();
    expect(proxy.getCurrentAuth()).not.toBeNull();
  });

  it('does not throw when getCurrentAuthAsync fails', async () => {
    (window as any).electronAPI.auth.getCurrentAuth = vi.fn().mockRejectedValue(new Error('ipc failure'));
    const proxy = new AuthManagerProxy();
    await expect(proxy.initialize()).resolves.toBeUndefined();
  });
});
