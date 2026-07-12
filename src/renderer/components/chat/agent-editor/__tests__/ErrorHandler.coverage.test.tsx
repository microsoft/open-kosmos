// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for ErrorHandler.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../styles/Agent.css', () => ({}));

import ErrorHandler from '../ErrorHandler';

describe('ErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when error is null', () => {
    const { container } = render(<ErrorHandler error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when error is empty string', () => {
    // Empty string is falsy, so should return null
    const { container } = render(<ErrorHandler error="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the error message', () => {
    render(<ErrorHandler error="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders dismiss button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(<ErrorHandler error="An error" onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: 'common.dismissError' });
    expect(btn).toBeTruthy();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorHandler error="An error" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.dismissError' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not render dismiss button when onDismiss is not provided', () => {
    render(<ErrorHandler error="An error" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<ErrorHandler error="err" className="my-class" />);
    expect(container.querySelector('.error-handler.my-class')).toBeTruthy();
  });

  it('uses empty className by default', () => {
    const { container } = render(<ErrorHandler error="err" />);
    expect(container.querySelector('.error-handler')).toBeTruthy();
  });
});
