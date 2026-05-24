/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../lib/utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockSignOut = vi.fn();
vi.mock('../AuthProvider', () => ({
  useAuthContext: () => ({
    signOut: mockSignOut,
    authData: null,
    loading: false,
    isAuthenticated: false,
    user: null,
    getCopilotToken: vi.fn(),
    getGitHubToken: vi.fn(),
    signIn: vi.fn(),
  }),
}));

// Minimal Dialog that renders when open
vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="reauth-dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('../../ui/button', () => ({
  Button: ({ onClick, children }: any) => (
    <button data-testid="login-button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// ── Import ─────────────────────────────────────────────────────────────────

import { ReauthProvider } from '../ReauthProvider';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ReauthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
  });

  it('renders children without showing dialog initially', () => {
    render(
      <ReauthProvider>
        <span data-testid="child">hello</span>
      </ReauthProvider>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.queryByTestId('reauth-dialog')).toBeNull();
  });

  it('opens dialog when tokenMonitor:require_reauth event is dispatched', async () => {
    render(
      <ReauthProvider>
        <span />
      </ReauthProvider>,
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tokenMonitor:require_reauth', {
          detail: { reason: 'missing_access_token', userMessage: 'Token gone' },
        }),
      );
    });

    expect(screen.getByTestId('reauth-dialog')).toBeTruthy();
  });

  it('uses default reason when none provided in event', async () => {
    render(
      <ReauthProvider>
        <span />
      </ReauthProvider>,
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tokenMonitor:require_reauth', {
          detail: {},
        }),
      );
    });

    // Dialog should be visible
    expect(screen.getByTestId('reauth-dialog')).toBeTruthy();
  });

  it('calls signOut and closes dialog when login button is clicked', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <ReauthProvider>
        <span />
      </ReauthProvider>,
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tokenMonitor:require_reauth', {
          detail: { reason: 'missing_access_token' },
        }),
      );
    });

    expect(screen.getByTestId('reauth-dialog')).toBeTruthy();

    await act(async () => {
      screen.getByTestId('login-button').click();
    });

    expect(mockSignOut).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByTestId('reauth-dialog')).toBeNull();
    });

    const signOutEvent = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'auth:signOut',
    );
    expect(signOutEvent).toBeTruthy();
    expect((signOutEvent![0] as CustomEvent).detail.reason).toBe('reauth_initiated');
  });

  it('closes dialog and dispatches auth:signOut even when signOut throws', async () => {
    mockSignOut.mockRejectedValue(new Error('signout failed'));
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <ReauthProvider>
        <span />
      </ReauthProvider>,
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tokenMonitor:require_reauth', {
          detail: { reason: 'missing_access_token' },
        }),
      );
    });

    await act(async () => {
      screen.getByTestId('login-button').click();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('reauth-dialog')).toBeNull();
    });

    const signOutEvent = dispatchSpy.mock.calls.find(
      ([e]) => (e as CustomEvent).type === 'auth:signOut',
    );
    expect(signOutEvent).toBeTruthy();
    expect((signOutEvent![0] as CustomEvent).detail.reason).toBe('reauth_error');
  });

  it('removes event listener on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(
      <ReauthProvider>
        <span />
      </ReauthProvider>,
    );

    act(() => { unmount(); });

    expect(removeSpy).toHaveBeenCalledWith(
      'tokenMonitor:require_reauth',
      expect.any(Function),
    );
  });
});
