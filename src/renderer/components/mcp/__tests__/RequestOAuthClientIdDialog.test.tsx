/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('lucide-react', async () => ({
  Copy: () => <span data-testid="icon-copy" />,
  ExternalLink: () => <span data-testid="icon-external-link" />,
}));

const makePayload = (overrides = {}) => ({
  requestId: 'req-1',
  serverName: 'TestServer',
  providerLabel: 'GitHub',
  redirectUri: 'https://localhost:3000/callback',
  instructions: { steps: ['Go to {serverName}', 'Set redirect to {redirectUri}'], setupUrl: 'https://github.com/settings/apps' },
  ...overrides,
});

async function renderComp() {
  const { default: Comp } = await import('../RequestOAuthClientIdDialog');
  return render(<Comp />);
}

describe('RequestOAuthClientIdDialog', () => {
  let mockOnRequestClientId: ((data: any) => void) | null = null;
  let mockRespondClientId: ReturnType<typeof vi.fn>;
  let mockCleanup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRespondClientId = vi.fn().mockResolvedValue(undefined);
    mockCleanup = vi.fn();

    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: {
        mcpAuth: {
          onRequestClientId: (handler: (data: any) => void) => {
            mockOnRequestClientId = handler;
            return mockCleanup;
          },
          respondClientId: mockRespondClientId,
        },
      },
    });

    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      writable: true, configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders nothing when no payload received', async () => {
    const { container } = await renderComp();
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it('shows dialog when payload is received', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    expect(screen.getAllByText(/TestServer/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GitHub/).length).toBeGreaterThan(0);
  });

  it('renders steps with substituted values', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    expect(screen.getByText('Go to TestServer')).toBeInTheDocument();
    expect(screen.getByText('Set redirect to https://localhost:3000/callback')).toBeInTheDocument();
  });

  it('shows redirect URI in code block', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    expect(screen.getByText('https://localhost:3000/callback')).toBeInTheDocument();
  });

  it('copies redirect URI to clipboard when Copy clicked', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://localhost:3000/callback');
    });

    // "Copied" text appears temporarily
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });

  it('shows setup URL button when setupUrl is provided', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    expect(screen.getByRole('button', { name: /Open GitHub app registration/ })).toBeInTheDocument();
  });

  it('calls window.open when setup URL button is clicked', async () => {
    const mockOpen = vi.fn();
    vi.stubGlobal('open', mockOpen);

    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.click(screen.getByRole('button', { name: /Open GitHub app registration/ }));

    expect(mockOpen).toHaveBeenCalledWith('https://github.com/settings/apps', '_blank', 'noopener,noreferrer');
    vi.unstubAllGlobals();
  });

  it('does not show setup URL button when no setupUrl', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload({
        instructions: { steps: ['Step 1'] },
      }));
    });

    expect(screen.queryByText(/Open/)).not.toBeInTheDocument();
  });

  it('does not render step list when steps are empty', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload({
        instructions: { steps: [] },
      }));
    });

    expect(screen.queryByText('How to register')).not.toBeInTheDocument();
  });

  it('calls Cancel and respondClientId with cancelled true on Cancel click', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockRespondClientId).toHaveBeenCalledWith('req-1', { cancelled: true });
  });

  it('closes dialog after Cancel', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('Save & Continue button is disabled when clientId is empty', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    expect(screen.getByRole('button', { name: 'Save & Continue' })).toBeDisabled();
  });

  it('Save & Continue button is enabled when clientId is filled', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'my-client-id' } });

    expect(screen.getByRole('button', { name: 'Save & Continue' })).not.toBeDisabled();
  });

  it('submits clientId on Save & Continue click', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'my-id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));

    expect(mockRespondClientId).toHaveBeenCalledWith('req-1', { clientId: 'my-id', clientSecret: undefined });
  });

  it('submits clientId and clientSecret when both provided', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'my-id' } });
    fireEvent.change(screen.getByLabelText(/Client Secret/), { target: { value: 'secret-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));

    expect(mockRespondClientId).toHaveBeenCalledWith('req-1', { clientId: 'my-id', clientSecret: 'secret-123' });
  });

  it('trims whitespace from clientId before submitting', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: '  trimmed  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));

    expect(mockRespondClientId).toHaveBeenCalledWith('req-1', expect.objectContaining({ clientId: 'trimmed' }));
  });

  it('does not submit when clientId is only whitespace', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Continue' }));

    expect(mockRespondClientId).not.toHaveBeenCalled();
  });

  it('queues second payload when dialog is already open', async () => {
    await renderComp();

    const p1 = makePayload({ requestId: 'r1', serverName: 'Server1' });
    const p2 = makePayload({ requestId: 'r2', serverName: 'Server2' });

    await act(async () => { mockOnRequestClientId!(p1); });
    await act(async () => { mockOnRequestClientId!(p2); });

    // Still showing first payload
    expect(screen.getAllByText(/Server1/).length).toBeGreaterThan(0);

    // Cancel first — second should appear
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getAllByText(/Server2/).length).toBeGreaterThan(0);
    });
  });

  it('ignores duplicate requestId in queue', async () => {
    await renderComp();

    const p1 = makePayload({ requestId: 'r1', serverName: 'Server1' });
    const p2 = makePayload({ requestId: 'r1', serverName: 'Server1-dup' });

    await act(async () => { mockOnRequestClientId!(p1); });
    await act(async () => { mockOnRequestClientId!(p2); });

    // Cancel first — no second dialog since duplicate requestId was rejected
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not show setup URL button when setup URL is missing entirely', async () => {
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload({
        instructions: { steps: ['Step 1'], setupUrl: undefined },
      }));
    });

    expect(screen.queryByRole('button', { name: /Open/ })).not.toBeInTheDocument();
  });

  it('calls cleanup on unmount', async () => {
    const { unmount } = await renderComp();
    unmount();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it('handles missing electronAPI gracefully', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: {},
    });
    const { container } = await renderComp();
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it('shows "Copied" label that reverts after 1.5s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    });

    expect(screen.getByText('Copied')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText('Copied')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('handles clipboard error gracefully', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      writable: true, configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('No permission')) },
    });

    await renderComp();

    await act(async () => {
      mockOnRequestClientId!(makePayload());
    });

    // Should not throw
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    });

    // "Copied" should NOT appear since clipboard failed
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });
});
