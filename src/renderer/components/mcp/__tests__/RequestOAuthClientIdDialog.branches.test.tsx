/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockOnRequestClientIdRef = vi.hoisted(() => ({ current: null as null | ((data: any) => void) }));
const mockRespondClientId = vi.hoisted(() => vi.fn());

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? <div data-testid="dialog" onDoubleClick={() => onOpenChange(true)}>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Copy: () => <span />,
  ExternalLink: () => <span />,
}));

const makePayload = (overrides = {}) => ({
  requestId: 'req-branch',
  serverName: 'Server',
  providerLabel: 'Provider',
  redirectUri: 'https://localhost/callback',
  instructions: { steps: [] },
  ...overrides,
});

describe('RequestOAuthClientIdDialog branch coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockOnRequestClientIdRef.current = null;
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        mcpAuth: {
          onRequestClientId: (handler: (data: any) => void) => {
            mockOnRequestClientIdRef.current = handler;
            return vi.fn();
          },
          respondClientId: mockRespondClientId,
        },
      },
    });
  });

  it('ignores Dialog onOpenChange(true)', async () => {
    const { default: Dialog } = await import('../RequestOAuthClientIdDialog');
    render(<Dialog />);

    await act(async () => {
      mockOnRequestClientIdRef.current!(makePayload());
    });

    fireEvent.doubleClick(screen.getByTestId('dialog'));
    expect(mockRespondClientId).not.toHaveBeenCalled();
  });

  it('disables the submit button for a whitespace-only client id', async () => {
    const { default: Dialog } = await import('../RequestOAuthClientIdDialog');
    render(<Dialog />);

    await act(async () => {
      mockOnRequestClientIdRef.current!(makePayload());
    });

    fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: '   ' } });
    const submitButton = screen.getByRole('button', { name: 'Save & Continue' });
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(mockRespondClientId).not.toHaveBeenCalled();
  });
});
