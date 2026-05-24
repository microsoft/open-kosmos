/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock Radix UI Dialog
vi.mock('../dialog', () => ({
  Dialog: ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
  DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../button', () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import ErrorDetailsDialog from '../ErrorDetailsDialog';

const defaultProps = {
  open: true,
  title: 'Error Occurred',
  details: 'Stack trace goes here',
  onOpenChange: vi.fn(),
};

describe('ErrorDetailsDialog — basic rendering', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders when open=true', () => {
    render(<ErrorDetailsDialog {...defaultProps} />);
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(screen.getByTestId('dialog-title').textContent).toBe('Error Occurred');
    expect(screen.getByText('Stack trace goes here')).toBeTruthy();
  });

  it('does not render when open=false', () => {
    render(<ErrorDetailsDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('renders subtitle when provided', () => {
    render(<ErrorDetailsDialog {...defaultProps} subtitle="Additional context" />);
    expect(screen.getByTestId('dialog-description').textContent).toBe('Additional context');
  });

  it('does not render subtitle when not provided', () => {
    render(<ErrorDetailsDialog {...defaultProps} />);
    expect(screen.queryByTestId('dialog-description')).toBeNull();
  });

  it('calls onOpenChange(false) when Close is clicked', () => {
    render(<ErrorDetailsDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Close'));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows Copied after successful clipboard write', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<ErrorDetailsDialog {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
    });
    expect(screen.getByText('Copied')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('stays on Copy when clipboard write fails', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<ErrorDetailsDialog {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
    });
    expect(screen.getByText('Copy')).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe('ErrorDetailsDialog — timer reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resets Copied back to Copy after 1500ms', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<ErrorDetailsDialog {...defaultProps} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy'));
    });
    expect(screen.getByText('Copied')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByText('Copy')).toBeTruthy();
  });
});
