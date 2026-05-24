/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../styles/SayHiCard.css', () => ({}));

import SayHiCard from '../SayHiCard';

describe('SayHiCard', () => {
  const defaultProps = {
    emoji: '💬',
    title: 'Test Title',
    description: 'Test description text',
    onClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders emoji, title and description', () => {
    render(<SayHiCard {...defaultProps} />);
    expect(screen.getByText('💬')).toBeInTheDocument();
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test description text')).toBeInTheDocument();
  });

  it('calls onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<SayHiCard {...defaultProps} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick when Enter key is pressed', () => {
    const onClick = vi.fn();
    render(<SayHiCard {...defaultProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick when Space key is pressed', () => {
    const onClick = vi.fn();
    render(<SayHiCard {...defaultProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick for other keys', () => {
    const onClick = vi.fn();
    render(<SayHiCard {...defaultProps} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has role=button and tabIndex=0 for accessibility', () => {
    render(<SayHiCard {...defaultProps} />);
    const card = screen.getByRole('button');
    expect(card).toHaveAttribute('tabindex', '0');
  });
});
