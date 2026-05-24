/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Minimal Dialog shim — renders children when open=true
vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('../../ui/button', () => ({
  Button: ({ onClick, children, disabled }: any) => (
    <button onClick={onClick} disabled={disabled} data-testid="reauth-button">
      {children}
    </button>
  ),
}));

// ── Import ─────────────────────────────────────────────────────────────────

import { ReauthDialog } from '../ReauthDialog';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ReauthDialog', () => {
  const onGitHubCopilotLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen=false', () => {
    render(<ReauthDialog isOpen={false} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('renders dialog when isOpen=true', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(screen.getByText('Re-authentication Required')).toBeTruthy();
  });

  it('calls onGitHubCopilotLogin when button is clicked', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    fireEvent.click(screen.getByTestId('reauth-button'));
    expect(onGitHubCopilotLogin).toHaveBeenCalledOnce();
  });

  it('shows "Access token missing" for missing_access_token reason', () => {
    render(
      <ReauthDialog
        isOpen={true}
        reason="missing_access_token"
        onGitHubCopilotLogin={onGitHubCopilotLogin}
      />,
    );
    expect(screen.getByText('Access token missing')).toBeTruthy();
  });

  it('shows "Refresh token missing" for missing_refresh_token reason', () => {
    render(
      <ReauthDialog
        isOpen={true}
        reason="missing_refresh_token"
        onGitHubCopilotLogin={onGitHubCopilotLogin}
      />,
    );
    expect(screen.getByText('Refresh token missing')).toBeTruthy();
  });

  it('shows "Token refresh failed, session has expired" for token_refresh_failed_should_clear_session', () => {
    render(
      <ReauthDialog
        isOpen={true}
        reason="token_refresh_failed_should_clear_session"
        onGitHubCopilotLogin={onGitHubCopilotLogin}
      />,
    );
    expect(screen.getByText('Token refresh failed, session has expired')).toBeTruthy();
  });

  it('shows "Authentication expired" for unknown reason', () => {
    render(
      <ReauthDialog
        isOpen={true}
        reason="some_unknown_reason"
        onGitHubCopilotLogin={onGitHubCopilotLogin}
      />,
    );
    expect(screen.getByText('Authentication expired')).toBeTruthy();
  });

  it('shows default reason text when no reason provided', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    expect(screen.getByText('Authentication expired')).toBeTruthy();
  });

  it('shows custom userMessage when provided', () => {
    render(
      <ReauthDialog
        isOpen={true}
        userMessage="Custom expiry message"
        onGitHubCopilotLogin={onGitHubCopilotLogin}
      />,
    );
    expect(screen.getByText('Custom expiry message')).toBeTruthy();
  });

  it('shows default userMessage when none provided', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    expect(
      screen.getByText(
        'Your authentication token has expired or is invalid. Please sign in again to continue using the app.',
      ),
    ).toBeTruthy();
  });
});
