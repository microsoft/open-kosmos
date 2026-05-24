/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── Hoisted mock variables ─────────────────────────────────────────────────

const {
  mockGetCurrentAuthAsync,
  mockSignOut,
  mockOnAuthChanged,
  mockProfileDataManagerCleanup,
  mockAgentChatSessionCacheManagerCleanup,
  mockMcpClientCacheManagerCleanup,
  mockIsAuthDataValid,
  mockExtractUser,
  mockExtractCopilotToken,
  mockExtractGitHubToken,
} = vi.hoisted(() => ({
  mockGetCurrentAuthAsync: vi.fn(),
  mockSignOut: vi.fn(),
  mockOnAuthChanged: vi.fn(),
  mockProfileDataManagerCleanup: vi.fn(),
  mockAgentChatSessionCacheManagerCleanup: vi.fn(),
  mockMcpClientCacheManagerCleanup: vi.fn(),
  mockIsAuthDataValid: vi.fn(),
  mockExtractUser: vi.fn(),
  mockExtractCopilotToken: vi.fn(),
  mockExtractGitHubToken: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../lib/auth/authManagerProxy', () => {
  // Use a regular function so it can be called with `new`
  function AuthManagerProxy(this: any) {
    this.getCurrentAuthAsync = mockGetCurrentAuthAsync;
    this.signOut = mockSignOut;
    this.onAuthChanged = mockOnAuthChanged;
    this.setCurrentAuth = vi.fn().mockResolvedValue(undefined);
  }
  return { AuthManagerProxy };
});

vi.mock('../../../lib/userData', () => ({
  profileDataManager: { cleanup: mockProfileDataManagerCleanup },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: { cleanup: mockAgentChatSessionCacheManagerCleanup },
}));

vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: { cleanup: mockMcpClientCacheManagerCleanup },
}));

vi.mock('../../../lib/auth/authDataAdapter', () => ({
  isAuthDataValid: (...args: any[]) => mockIsAuthDataValid(...args),
  extractUser: (...args: any[]) => mockExtractUser(...args),
  extractCopilotToken: (...args: any[]) => mockExtractCopilotToken(...args),
  extractGitHubToken: (...args: any[]) => mockExtractGitHubToken(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

import { AuthProvider, useAuthContext } from '../AuthProvider';

function Consumer() {
  const ctx = useAuthContext();
  return (
    <div>
      <span data-testid="loading">{String(ctx.loading)}</span>
      <span data-testid="isAuthenticated">{String(ctx.isAuthenticated)}</span>
      <span data-testid="user">{ctx.user?.login ?? 'null'}</span>
    </div>
  );
}

const fakeAuthData = {
  version: '1',
  createdAt: '',
  updatedAt: '',
  authProvider: 'github',
  ghcAuth: {
    alias: 'a',
    user: {
      id: '1',
      login: 'octocat',
      email: 'octocat@github.com',
      name: 'Octocat',
      avatarUrl: '',
      copilotPlan: 'individual' as const,
    },
    gitHubTokens: { timestamp: '', api_url: '', access_token: 'tok', token_type: 'bearer', scope: '' },
    copilotTokens: { timestamp: '', api_url: '', expires_at: 9999999999, token: 'coptok' },
    capabilities: [],
  },
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthProvider', () => {
  let unsubscribeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribeMock = vi.fn();
    mockOnAuthChanged.mockReturnValue(unsubscribeMock);
    mockGetCurrentAuthAsync.mockResolvedValue(null);
    mockIsAuthDataValid.mockReturnValue(false);
    mockExtractUser.mockReturnValue(null);
    mockExtractCopilotToken.mockReturnValue(null);
    mockExtractGitHubToken.mockReturnValue(null);
  });

  it('renders children', async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <span data-testid="child">hello</span>
        </AuthProvider>,
      );
    });
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('sets loading=false after initialization', async () => {
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('sets isAuthenticated=false when no auth data returned', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(null);
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });
    expect(screen.getByTestId('isAuthenticated').textContent).toBe('false');
  });

  it('sets isAuthenticated=true when valid auth data returned', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(fakeAuthData);
    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });
    expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('octocat');
  });

  it('sets authData=null when getCurrentAuthAsync throws', async () => {
    mockGetCurrentAuthAsync.mockRejectedValue(new Error('network'));
    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('isAuthenticated').textContent).toBe('false');
  });

  it('updates authData on auth_set event', async () => {
    let capturedCallback: ((data: any) => void) | undefined;
    mockOnAuthChanged.mockImplementation((cb: (data: any) => void) => {
      capturedCallback = cb;
      return unsubscribeMock;
    });
    mockGetCurrentAuthAsync.mockResolvedValue(null);

    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('false');

    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    await act(async () => {
      capturedCallback?.({ type: 'auth_set', authData: fakeAuthData });
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');
  });

  it('clears authData on auth_destroyed event', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(fakeAuthData);
    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    let capturedCallback: ((data: any) => void) | undefined;
    mockOnAuthChanged.mockImplementation((cb: (data: any) => void) => {
      capturedCallback = cb;
      return unsubscribeMock;
    });

    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');

    mockIsAuthDataValid.mockReturnValue(false);
    mockExtractUser.mockReturnValue(null);

    await act(async () => {
      capturedCallback?.({ type: 'auth_destroyed' });
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('false');
  });

  it('updates authData on copilot_token_refreshed event', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(null);
    let capturedCallback: ((data: any) => void) | undefined;
    mockOnAuthChanged.mockImplementation((cb: (data: any) => void) => {
      capturedCallback = cb;
      return unsubscribeMock;
    });

    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });

    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    await act(async () => {
      capturedCallback?.({ type: 'copilot_token_refreshed', authData: fakeAuthData });
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');
  });

  it('clears authData when auth:signOut window event fires', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(fakeAuthData);
    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');

    mockIsAuthDataValid.mockReturnValue(false);
    mockExtractUser.mockReturnValue(null);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('auth:signOut'));
    });

    expect(screen.getByTestId('isAuthenticated').textContent).toBe('false');
    expect(mockProfileDataManagerCleanup).toHaveBeenCalled();
    expect(mockAgentChatSessionCacheManagerCleanup).toHaveBeenCalled();
    expect(mockMcpClientCacheManagerCleanup).toHaveBeenCalled();
  });

  it('re-initializes auth when ghc:authSuccess fires', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(null);

    await act(async () => {
      render(
        <AuthProvider>
          <Consumer />
        </AuthProvider>,
      );
    });

    mockGetCurrentAuthAsync.mockResolvedValue(fakeAuthData);
    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ghc:authSuccess'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('isAuthenticated').textContent).toBe('true');
    });
  });

  it('provides getCopilotToken and getGitHubToken via context', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(fakeAuthData);
    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractCopilotToken.mockReturnValue('coptok');
    mockExtractGitHubToken.mockReturnValue('ghtok');
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);

    function TokenConsumer() {
      const ctx = useAuthContext();
      return (
        <div>
          <span data-testid="copilot">{ctx.getCopilotToken()}</span>
          <span data-testid="github">{ctx.getGitHubToken()}</span>
        </div>
      );
    }

    await act(async () => {
      render(
        <AuthProvider>
          <TokenConsumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId('copilot').textContent).toBe('coptok');
    expect(screen.getByTestId('github').textContent).toBe('ghtok');
  });

  it('cleans up caches on signOut', async () => {
    mockGetCurrentAuthAsync.mockResolvedValue(fakeAuthData);
    mockIsAuthDataValid.mockReturnValue(true);
    mockExtractUser.mockReturnValue(fakeAuthData.ghcAuth.user);
    mockSignOut.mockResolvedValue(undefined);

    function SignOutConsumer() {
      const ctx = useAuthContext();
      return <button data-testid="signout" onClick={ctx.signOut}>Sign out</button>;
    }

    await act(async () => {
      render(
        <AuthProvider>
          <SignOutConsumer />
        </AuthProvider>,
      );
    });

    await act(async () => {
      screen.getByTestId('signout').click();
    });

    expect(mockSignOut).toHaveBeenCalled();
    expect(mockProfileDataManagerCleanup).toHaveBeenCalled();
    expect(mockAgentChatSessionCacheManagerCleanup).toHaveBeenCalled();
    expect(mockMcpClientCacheManagerCleanup).toHaveBeenCalled();
  });

  it('unsubscribes from onAuthChanged on unmount', async () => {
    let comp: ReturnType<typeof render>;
    await act(async () => {
      comp = render(
        <AuthProvider>
          <span />
        </AuthProvider>,
      );
    });
    act(() => { comp!.unmount(); });
    expect(unsubscribeMock).toHaveBeenCalled();
  });
});

describe('useAuthContext outside AuthProvider', () => {
  it('throws an error', () => {
    function Broken() {
      useAuthContext();
      return null;
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Broken />)).toThrow('useAuthContext must be used inside AuthProvider');
    err.mockRestore();
  });
});
