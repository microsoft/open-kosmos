// @vitest-environment happy-dom
/**
 * Tests for ExperimentTag component
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExperimentTag } from '../ExperimentTag';

describe('ExperimentTag', () => {
  it('renders "Experiment" text for normal size (default)', () => {
    render(<ExperimentTag />);
    expect(screen.getByText('Experiment')).toBeInTheDocument();
  });

  it('renders "Exp" for small size', () => {
    render(<ExperimentTag size="small" />);
    expect(screen.getByText('Exp')).toBeInTheDocument();
  });

  it('renders "Experiment" for explicit normal size', () => {
    render(<ExperimentTag size="normal" />);
    expect(screen.getByText('Experiment')).toBeInTheDocument();
  });

  it('has the correct title attribute', () => {
    render(<ExperimentTag />);
    const tag = screen.getByText('Experiment');
    expect(tag).toHaveAttribute('title', 'This is an experimental feature');
  });

  it('applies experiment-tag class', () => {
    render(<ExperimentTag />);
    const tag = screen.getByText('Experiment');
    expect(tag).toHaveClass('experiment-tag');
  });

  it('applies size-specific class for normal', () => {
    render(<ExperimentTag size="normal" />);
    const tag = screen.getByText('Experiment');
    expect(tag).toHaveClass('experiment-tag-normal');
  });

  it('applies size-specific class for small', () => {
    render(<ExperimentTag size="small" />);
    const tag = screen.getByText('Exp');
    expect(tag).toHaveClass('experiment-tag-small');
  });

  it('applies custom className', () => {
    render(<ExperimentTag className="my-custom" />);
    const tag = screen.getByText('Experiment');
    expect(tag).toHaveClass('my-custom');
  });

  it('renders as span', () => {
    render(<ExperimentTag />);
    const tag = screen.getByText('Experiment');
    expect(tag.tagName).toBe('SPAN');
  });
});
