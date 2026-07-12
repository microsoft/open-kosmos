/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../styles/ChatZeroStates.css', () => ({}));

import ChatZeroStates from '../ChatZeroStates';
import type { ZeroStates } from '../../../lib/userData/types';

const quickStart = {
  id: 'local-card',
  title: 'Local Card',
  description: 'Start locally',
  prompt: 'Create a local agent',
  image: 'https://example.invalid/unused.png',
};

describe('ChatZeroStates', () => {
  it('renders nothing without a greeting or quick starts', () => {
    const { container } = render(
      <ChatZeroStates
        zeroStates={{ greeting: '  ', quick_starts: [] } as ZeroStates}
        onQuickStartClick={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders a greeting and text-only quick-start card', () => {
    render(
      <ChatZeroStates
        zeroStates={{ greeting: 'Welcome', quick_starts: [quickStart] } as ZeroStates}
        onQuickStartClick={vi.fn()}
      />,
    );

    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByText('Local Card')).toBeTruthy();
    expect(document.querySelector('.quick-start-card-image')).toBeNull();
  });

  it('invokes the prompt on click', () => {
    const onQuickStartClick = vi.fn();
    render(
      <ChatZeroStates
        zeroStates={{ greeting: '', quick_starts: [quickStart] } as ZeroStates}
        onQuickStartClick={onQuickStartClick}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onQuickStartClick).toHaveBeenCalledWith('Create a local agent');
  });

  it.each(['Enter', ' '])('supports keyboard activation with %s', (key) => {
    const onQuickStartClick = vi.fn();
    render(
      <ChatZeroStates
        zeroStates={{ greeting: '', quick_starts: [quickStart] } as ZeroStates}
        onQuickStartClick={onQuickStartClick}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button'), { key });
    expect(onQuickStartClick).toHaveBeenCalledWith('Create a local agent');
  });
});
