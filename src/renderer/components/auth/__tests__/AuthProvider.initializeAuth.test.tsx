// @vitest-environment happy-dom
/**
 * Tests for AuthProvider.initializeAuth() to ensure:
 * 1. Cold cache restore path calls setCurrentAuth (triggers main process init)
 * 2. Sign-in flow path (ghc:authSuccess) does NOT call setCurrentAuth (already done)
 *
 * This prevents double-initialization of SchedulerManager, UserTaskManager, etc.
 */

import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

// Mock functions must be defined before vi.mock calls
const getCurrentAuthAsyncMock = vi.fn();
const setCurrentAuthMock = vi.fn();
const onAuthChangedMock = vi.fn(() => vi.fn()); // returns unsubscribe
const signOutMock = vi.fn();

vi.mock('../../../lib/auth/authManagerProxy', () => {
  return {
    AuthManagerProxy: class {
      getCurrentAuthAsync = getCurrentAuthAsyncMock;
      setCurrentAuth = setCurrentAuthMock;
      onAuthChanged = onAuthChangedMock;
      signOut = signOutMock;
    },
  };
});

vi.mock('../../../lib/userData', () => ({
  profileDataManager: {
    cleanup: vi.fn(),
  },
}));

vi.mock('../../../lib/chat/agentChatSessionCacheManager', () => ({
  agentChatSessionCacheManager: {
    cleanup: vi.fn(),
  },
}));

vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({
  mcpClientCacheManager: {
    cleanup: vi.fn(),
  },
}));

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../lib/auth/authDataAdapter', () => ({
  extractUser: vi.fn((data: unknown) => (data as { user?: unknown })?.user ?? null),
  extractCopilotToken: vi.fn(() => 'token'),
  extractGitHubToken: vi.fn(() => 'gh-token'),
  isAuthDataValid: vi.fn((data: unknown) => !!data),
}));

import { AuthProvider, useAuthContext } from '../AuthProvider';

const validAuthData = {
  user: { login: 'testuser' },
  copilotToken: 'test-copilot-token',
  githubToken: 'test-github-token',
};

describe('AuthProvider.initializeAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentAuthMock.mockResolvedValue(undefined);
  });

  describe('cold cache restore path', () => {
    it('calls setCurrentAuth when restoring auth from cache on cold start', async () => {
      getCurrentAuthAsyncMock.mockResolvedValue(validAuthData);

      const TestConsumer: React.FC = () => {
        const { isAuthenticated } = useAuthContext();
        return <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>;
      };

      await act(async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );
      });

      // Cold cache restore should call setCurrentAuth to trigger main process init
      expect(setCurrentAuthMock).toHaveBeenCalledTimes(1);
      expect(setCurrentAuthMock).toHaveBeenCalledWith(validAuthData);
    });

    it('does not call setCurrentAuth when no cached auth exists', async () => {
      getCurrentAuthAsyncMock.mockResolvedValue(null);

      const TestConsumer: React.FC = () => {
        const { isAuthenticated } = useAuthContext();
        return <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>;
      };

      await act(async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );
      });

      // No cached auth, no setCurrentAuth call
      expect(setCurrentAuthMock).not.toHaveBeenCalled();
    });
  });

  describe('sign-in flow path (ghc:authSuccess)', () => {
    it('does NOT call setCurrentAuth after ghc:authSuccess event', async () => {
      // First call returns null (no cache), second call returns auth (after sign-in)
      getCurrentAuthAsyncMock
        .mockResolvedValueOnce(null) // cold start - no cache
        .mockResolvedValueOnce(validAuthData); // after ghc:authSuccess

      const TestConsumer: React.FC = () => {
        const { isAuthenticated } = useAuthContext();
        return <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>;
      };

      await act(async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );
      });

      // Cold start with no cache - no setCurrentAuth call
      expect(setCurrentAuthMock).not.toHaveBeenCalled();

      // Simulate sign-in flow dispatching ghc:authSuccess
      // (SignInPage/AutoLoginSingleUser already called setCurrentAuth before this)
      await act(async () => {
        window.dispatchEvent(new CustomEvent('ghc:authSuccess', {
          detail: { authData: validAuthData }
        }));
      });

      await waitFor(() => {
        expect(getCurrentAuthAsyncMock).toHaveBeenCalledTimes(2);
      });

      // After ghc:authSuccess, setCurrentAuth should NOT be called again
      // because SignInPage/AutoLoginSingleUser already called it
      expect(setCurrentAuthMock).not.toHaveBeenCalled();
    });
  });

  describe('regression: issue #670 fix without double-init', () => {
    it('only calls setCurrentAuth once for cold cache restore, not after subsequent ghc:authSuccess', async () => {
      // Simulate: user has cached auth, app starts, then user triggers a token refresh
      getCurrentAuthAsyncMock
        .mockResolvedValueOnce(validAuthData) // cold start - has cache
        .mockResolvedValueOnce(validAuthData); // after some auth event

      const TestConsumer: React.FC = () => {
        const { isAuthenticated } = useAuthContext();
        return <div data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>;
      };

      await act(async () => {
        render(
          <AuthProvider>
            <TestConsumer />
          </AuthProvider>
        );
      });

      // Cold start with cache - setCurrentAuth called once
      expect(setCurrentAuthMock).toHaveBeenCalledTimes(1);

      // Now simulate ghc:authSuccess (e.g., after token refresh or re-auth)
      await act(async () => {
        window.dispatchEvent(new CustomEvent('ghc:authSuccess', {
          detail: { authData: validAuthData }
        }));
      });

      await waitFor(() => {
        expect(getCurrentAuthAsyncMock).toHaveBeenCalledTimes(2);
      });

      // Still only 1 call - the ghc:authSuccess path should skip setCurrentAuth
      expect(setCurrentAuthMock).toHaveBeenCalledTimes(1);
    });
  });
});
