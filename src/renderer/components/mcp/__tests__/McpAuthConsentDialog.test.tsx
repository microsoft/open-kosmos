/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockOnShowConsentRef = vi.hoisted(() => ({ current: null as null | ((data: any) => void) }));
const mockRespondConsent = vi.hoisted(() => vi.fn());
const mockCleanup = vi.hoisted(() => vi.fn());

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: any) =>
    open ? (
      <div data-testid="dialog">
        <button data-testid="open-change-true" onClick={() => onOpenChange(true)}>t</button>
        <button data-testid="open-change-false" onClick={() => onOpenChange(false)}>f</button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

const makePayload = (overrides = {}) => ({
  requestId: 'req-1',
  serverName: 'Test Server',
  providerLabel: 'GitHub',
  ...overrides,
});

type ApiShape = 'full' | 'no-respond' | 'no-onshow' | 'no-mcpauth' | 'no-api';

function setElectronAPI(shape: ApiShape = 'full') {
  let value: unknown;
  if (shape === 'no-api') {
    value = undefined;
  } else if (shape === 'no-mcpauth') {
    value = {};
  } else {
    const mcpAuth: Record<string, unknown> = {};
    if (shape !== 'no-onshow') {
      mcpAuth.onShowConsent = (handler: (data: any) => void) => {
        mockOnShowConsentRef.current = handler;
        return mockCleanup;
      };
    }
    if (shape !== 'no-respond') {
      mcpAuth.respondConsent = mockRespondConsent;
    }
    value = { mcpAuth };
  }
  Object.defineProperty(window, 'electronAPI', { writable: true, configurable: true, value });
}

async function renderDialog() {
  const { default: Comp } = await import('../McpAuthConsentDialog');
  return render(<Comp />);
}

async function openDialog() {
  await act(async () => {
    mockOnShowConsentRef.current!(makePayload());
  });
}

describe('McpAuthConsentDialog', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockOnShowConsentRef.current = null;
    setElectronAPI('full');
  });

  it('renders nothing while closed', async () => {
    await renderDialog();
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('opens with server and provider details on a consent event', async () => {
    await renderDialog();
    await openDialog();
    expect(screen.getByText('Allow sign-in to GitHub?')).toBeInTheDocument();
    expect(screen.getByText(/Test Server/)).toBeInTheDocument();
  });

  it('responds "allow-this-time" and closes when Allow is clicked', async () => {
    await renderDialog();
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    });
    expect(mockRespondConsent).toHaveBeenCalledWith('req-1', 'allow-this-time');
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('responds "cancel" when Not now is clicked', async () => {
    await renderDialog();
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    });
    expect(mockRespondConsent).toHaveBeenCalledWith('req-1', 'cancel');
  });

  it('responds "cancel" when the dialog requests close', async () => {
    await renderDialog();
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-change-false'));
    });
    expect(mockRespondConsent).toHaveBeenCalledWith('req-1', 'cancel');
  });

  it('ignores an open-state change to true', async () => {
    await renderDialog();
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-change-true'));
    });
    expect(mockRespondConsent).not.toHaveBeenCalled();
  });

  it('unsubscribes from the consent channel on unmount', async () => {
    const { unmount } = await renderDialog();
    unmount();
    expect(mockCleanup).toHaveBeenCalledTimes(1);
  });

  it('does not throw when respondConsent is unavailable', async () => {
    setElectronAPI('no-respond');
    await renderDialog();
    await openDialog();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    });
    expect(mockRespondConsent).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('does not subscribe when onShowConsent is unavailable', async () => {
    setElectronAPI('no-onshow');
    const { unmount } = await renderDialog();
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(() => unmount()).not.toThrow();
  });

  it('does not throw when mcpAuth is unavailable', async () => {
    setElectronAPI('no-mcpauth');
    const { unmount } = await renderDialog();
    expect(() => unmount()).not.toThrow();
  });

  it('does not throw when electronAPI is unavailable', async () => {
    setElectronAPI('no-api');
    const { unmount } = await renderDialog();
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
