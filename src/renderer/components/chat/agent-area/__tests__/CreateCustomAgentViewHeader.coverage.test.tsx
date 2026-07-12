// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for CreateCustomAgentViewHeader.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../styles/Header.css', () => ({}));

import CreateCustomAgentViewHeader from '../CreateCustomAgentViewHeader';

describe('CreateCustomAgentViewHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the header name', () => {
    render(<CreateCustomAgentViewHeader />);
    expect(screen.getByText('agent.create.createCustomAgent')).toBeTruthy();
  });

  it('shows back button when onBack is provided', () => {
    const onBack = vi.fn();
    render(<CreateCustomAgentViewHeader onBack={onBack} />);
    const btn = screen.getByRole('button', { name: 'common.back' });
    expect(btn).toBeTruthy();
  });

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn();
    render(<CreateCustomAgentViewHeader onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not show back button when onBack is not provided', () => {
    render(<CreateCustomAgentViewHeader />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders as a header element', () => {
    const { container } = render(<CreateCustomAgentViewHeader />);
    expect(container.querySelector('header.unified-header')).toBeTruthy();
  });
});
