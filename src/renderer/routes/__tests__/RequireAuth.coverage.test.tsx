// @vitest-environment happy-dom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  isAuthenticated: false,
  loading: false,
}));

vi.mock('../../components/auth/AuthProvider', () => ({
  useAuthContext: () => authState,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to, state, replace }: { to: string; state: unknown; replace: boolean }) => (
      <div data-testid="navigate" data-to={to} data-replace={String(replace)}>
        {JSON.stringify(state)}
      </div>
    ),
    Outlet: () => <div data-testid="outlet" />,
    useLocation: () => ({ pathname: '/private', search: '?q=1', hash: '', state: null, key: 'test' }),
  };
});

import { RequireAuth } from '../RequireAuth';

describe('RequireAuth', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.loading = false;
  });

  it('renders the localized loading state while auth is loading', () => {
    authState.loading = true;

    render(<RequireAuth />);

    expect(screen.getByText('Loading...')).toBeTruthy();
    expect(screen.getByText('Verifying authentication...')).toBeTruthy();
  });

  it('redirects unauthenticated users to login with the current location', () => {
    render(<RequireAuth />);

    const navigate = screen.getByTestId('navigate');
    expect(navigate.getAttribute('data-to')).toBe('/login');
    expect(navigate.getAttribute('data-replace')).toBe('true');
    expect(navigate.textContent).toContain('/private');
  });

  it('renders the protected route outlet for authenticated users', () => {
    authState.isAuthenticated = true;

    render(<RequireAuth />);

    expect(screen.getByTestId('outlet')).toBeTruthy();
  });
});
