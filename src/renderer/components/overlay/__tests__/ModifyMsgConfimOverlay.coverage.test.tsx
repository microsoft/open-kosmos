/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const mockUpdateConfirmationSettings = vi.fn(() => Promise.resolve({ success: true }));
(window as any).electronAPI = {
  profile: { updateConfirmationSettings: mockUpdateConfirmationSettings },
};

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ children, open, onOpenChange }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

const mockProfileData = {
  data: {
    profile: {
      alias: 'testuser',
      confirmationSettings: { inlineEditRegenerate: { skipConfirmation: false } },
    },
  },
};

vi.mock('../../userData/userDataProvider', () => ({
  useProfileData: () => mockProfileData,
}));

import ModifyMsgConfirmOverlay from '../ModifyMsgConfimOverlay';

describe('ModifyMsgConfirmOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing (dialog closed initially)', () => {
    const { container } = render(<ModifyMsgConfirmOverlay />);
    expect(screen.queryByTestId('dialog')).toBeNull();
    expect(container).toBeTruthy();
  });

  it('opens dialog on chatInput:confirmInlineEditRequest event', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-1', title: 'Confirm Edit', description: 'Are you sure?' },
      }));
    });
    expect(screen.getByText('Confirm Edit')).toBeTruthy();
    expect(screen.getByText('Are you sure?')).toBeTruthy();
  });

  it('uses default title when none provided', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-2' },
      }));
    });
    expect(screen.getByText('Confirm action')).toBeTruthy();
  });

  it('ignores event without requestId', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { title: 'No ID' },
      }));
    });
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('closes dialog when Confirm is clicked', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-3', title: 'Confirm?', description: 'desc' },
      }));
    });
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
  });

  it('closes dialog when Cancel is clicked', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-4', title: 'Confirm?', description: 'desc' },
      }));
    });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
  });

  it('toggles dontAskAgain checkbox and fires confirm', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-6', title: 'T', description: 'D' },
      }));
    });
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    fireEvent.change(checkbox, { target: { checked: true } });
    expect(checkbox.checked).toBe(true);
    // Confirm closes the dialog
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => expect(screen.queryByTestId('dialog')).toBeNull());
  });

  it('opens dialog (skipConfirmation=false)', async () => {
    render(<ModifyMsgConfirmOverlay />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('chatInput:confirmInlineEditRequest', {
        detail: { requestId: 'req-7', title: 'Test' },
      }));
    });
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });
});
