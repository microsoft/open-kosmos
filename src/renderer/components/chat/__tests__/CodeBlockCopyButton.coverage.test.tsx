// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for CodeBlockCopyButton.tsx
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('lucide-react', () => ({
  Copy: () => <svg data-testid="copy-icon" />,
  Check: () => <svg data-testid="check-icon" />,
}));

import CodeBlockCopyButton from '../CodeBlockCopyButton';

describe('CodeBlockCopyButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('renders the copy icon by default', () => {
    render(<CodeBlockCopyButton code="console.log('hello')" />);
    expect(screen.getByTestId('copy-icon')).toBeTruthy();
    expect(screen.queryByTestId('check-icon')).toBeNull();
  });

  it('has correct title from i18n', () => {
    render(<CodeBlockCopyButton code="const x = 1" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('title')).toBe('common.copyCode');
  });

  it('copies code and shows check icon on click', async () => {
    vi.useFakeTimers();
    render(<CodeBlockCopyButton code="hello world" />);
    const btn = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve(); // flush microtasks
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world');
    expect(screen.getByTestId('check-icon')).toBeTruthy();

    // After 2s timeout the copy icon returns
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('copy-icon')).toBeTruthy();

    vi.useRealTimers();
  });

  it('calls writeText with the correct code prop', async () => {
    render(<CodeBlockCopyButton code="my code" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await Promise.resolve();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('my code');
  });
});
