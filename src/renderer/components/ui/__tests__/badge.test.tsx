// @vitest-environment happy-dom
/**
 * Tests for Badge component
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../badge';
import { cn } from '../../../lib/utilities/utils';

describe('Badge', () => {
  it('renders with default variant', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-primary-600');
  });

  it('renders secondary variant', () => {
    render(<Badge variant="secondary">Secondary</Badge>);
    const badge = screen.getByText('Secondary');
    expect(badge.className).toContain('bg-neutral-100');
  });

  it('renders destructive variant', () => {
    render(<Badge variant="destructive">Destructive</Badge>);
    const badge = screen.getByText('Destructive');
    expect(badge.className).toContain('bg-danger-600');
  });

  it('renders outline variant', () => {
    render(<Badge variant="outline">Outline</Badge>);
    const badge = screen.getByText('Outline');
    expect(badge.className).toContain('border-neutral-300');
  });

  it('renders success variant', () => {
    render(<Badge variant="success">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge.className).toContain('bg-success-600');
  });

  it('renders warning variant', () => {
    render(<Badge variant="warning">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge.className).toContain('bg-warning-600');
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

describe('Badge cva emits the expected variant classes', () => {
  const EXPECTED_BASE =
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary-500 focus:ring-offset-2';
  const EXPECTED_VARIANTS: Record<string, string> = {
    default: 'border-transparent bg-primary-600 text-white',
    secondary: 'border-transparent bg-neutral-100 text-neutral-900',
    destructive: 'border-transparent bg-danger-600 text-white',
    outline: 'text-neutral-900 border-neutral-300',
    success: 'border-transparent bg-success-600 text-white',
    warning: 'border-transparent bg-warning-600 text-white'
  };
  const variants = ['default', 'secondary', 'destructive', 'outline', 'success', 'warning'] as const;

  it('emits the expected classes for every non-normal variant', () => {
    for (const variant of variants) {
      const { container, unmount } = render(<Badge variant={variant}>x</Badge>);
      const el = container.firstChild as HTMLElement;
      expect(el.className).toBe(cn(EXPECTED_BASE, EXPECTED_VARIANTS[variant]));
      unmount();
    }
  });

  it('normal variant emits only the unified class (legacy early return preserved)', () => {
    const { container } = render(<Badge variant="normal">x</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toBe(cn('unified-badge-normal'));
  });

  it('merges a custom className into the expected output', () => {
    const { container } = render(<Badge className="custom">x</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toBe(cn(EXPECTED_BASE, EXPECTED_VARIANTS.default, 'custom'));
  });
});
