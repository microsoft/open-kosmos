// @vitest-environment happy-dom
/**
 * Tests for Badge component
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../badge';

describe('Badge', () => {
  it('renders with default variant', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-blue-600');
  });

  it('renders secondary variant', () => {
    render(<Badge variant="secondary">Secondary</Badge>);
    const badge = screen.getByText('Secondary');
    expect(badge.className).toContain('bg-gray-100');
  });

  it('renders destructive variant', () => {
    render(<Badge variant="destructive">Destructive</Badge>);
    const badge = screen.getByText('Destructive');
    expect(badge.className).toContain('bg-red-600');
  });

  it('renders outline variant', () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText('Outline');
    expect(badge.className).toContain('border-gray-300');
  });

  it('renders success variant', () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge.className).toContain('bg-green-600');
  });

  it('renders warning variant', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('bg-yellow-600');
  });

  it('renders normal variant with special class structure', () => {
    render(<Badge variant="normal">Normal</Badge>);
    const badge = screen.getByText('Normal');
    expect(badge.className).toContain('unified-badge-normal');
    // Normal variant does NOT include the standard inline-flex classes
    expect(badge.className).not.toContain('inline-flex');
  });

  it('applies custom className', () => {
    render(<Badge className="my-custom-class">Custom</Badge>);
    const badge = screen.getByText('Custom');
    expect(badge.className).toContain('my-custom-class');
  });

  it('passes through HTML attributes', () => {
    render(<Badge data-testid="my-badge" title="badge title">Content</Badge>);
    const badge = screen.getByTestId('my-badge');
    expect(badge.title).toBe('badge title');
  });

  it('normal variant also applies custom className', () => {
    render(<Badge variant="normal" className="extra-class">Normal</Badge>);
    const badge = screen.getByText('Normal');
    expect(badge.className).toContain('unified-badge-normal');
    expect(badge.className).toContain('extra-class');
  });
});
