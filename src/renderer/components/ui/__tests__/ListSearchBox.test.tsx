// @vitest-environment happy-dom
/**
 * Tests for ListSearchBox component
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ListSearchBox from '../ListSearchBox';

describe('ListSearchBox', () => {
  it('renders input with provided value', () => {
    render(<ListSearchBox value="hello" onChange={vi.fn()} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('hello');
  });

  it('shows default placeholder', () => {
    render(<ListSearchBox value="" onChange={vi.fn()} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Search...');
  });

  it('shows custom placeholder', () => {
    render(<ListSearchBox value="" onChange={vi.fn()} placeholder="Find agents..." />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('placeholder', 'Find agents...');
  });

  it('calls onChange when input changes', () => {
    const onChange = vi.fn();
    render(<ListSearchBox value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });
    expect(onChange).toHaveBeenCalledWith('test');
  });

  it('does not show clear button when value is empty', () => {
    render(<ListSearchBox value="" onChange={vi.fn()} />);
    expect(screen.queryByTitle('Clear search')).not.toBeInTheDocument();
  });

  it('shows clear button when value is non-empty', () => {
    render(<ListSearchBox value="abc" onChange={vi.fn()} />);
    expect(screen.getByTitle('Clear search')).toBeInTheDocument();
  });

  it('calls onChange with empty string when clear button is clicked', () => {
    const onChange = vi.fn();
    render(<ListSearchBox value="abc" onChange={onChange} />);
    fireEvent.click(screen.getByTitle('Clear search'));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
