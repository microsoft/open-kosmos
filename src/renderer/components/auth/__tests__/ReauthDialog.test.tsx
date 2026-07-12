/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Minimal Dialog shim — renders children when open=true
vi.mock('../../ui/dialog', () => ({
  Dialog: ({
    open,
    children,
    onOpenChange,
  }: {
    open: boolean;
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open
      ? (
        <div
          data-testid="dialog"
          onClick={() => onOpenChange?.(false)}
          onDoubleClick={() => onOpenChange?.(true)}
        >
          {children}
        </div>
      )
      : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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

  it('prevents dismissal from Dialog onOpenChange(false)', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    fireEvent.click(screen.getByTestId('dialog'));
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(onGitHubCopilotLogin).not.toHaveBeenCalled();
  });

  it('ignores Dialog onOpenChange(true)', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    fireEvent.doubleClick(screen.getByTestId('dialog'));
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(onGitHubCopilotLogin).not.toHaveBeenCalled();
  });

  it('calls onGitHubCopilotLogin when button is clicked', () => {
    render(<ReauthDialog isOpen={true} onGitHubCopilotLogin={onGitHubCopilotLogin} />);
    fireEvent.click(screen.getByRole('button', { name: /Sign in via GitHub Copilot/ }));
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
