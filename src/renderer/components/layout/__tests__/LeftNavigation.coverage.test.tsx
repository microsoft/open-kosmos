// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for LeftNavigation.tsx
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../styles/LeftNavigation.css', () => ({}));
vi.mock('../../../styles/LeftNavigation.css', () => ({}));

vi.mock('../NavigationSection', () => ({
  default: () => <div data-testid="navigation-section" />,
}));

vi.mock('../UserSection', () => ({
  default: () => <div data-testid="user-section" />,
}));

import LeftNavigation from '../LeftNavigation';

describe('LeftNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders NavigationSection and UserSection', () => {
    render(<LeftNavigation leftPanelCollapsed={false} />);
    expect(screen.getByTestId('navigation-section')).toBeTruthy();
    expect(screen.getByTestId('user-section')).toBeTruthy();
  });

  it('has role navigation with correct aria-label', () => {
    render(<LeftNavigation leftPanelCollapsed={false} />);
    const nav = screen.getByRole('navigation');
    expect(nav.getAttribute('aria-label')).toBe('layout.navigation.main');
  });

  it('adds collapsed class when leftPanelCollapsed=true', () => {
    render(<LeftNavigation leftPanelCollapsed={true} />);
    const nav = screen.getByRole('navigation');
    expect(nav.className).toContain('collapsed');
  });

  it('does not add collapsed class when leftPanelCollapsed=false', () => {
    render(<LeftNavigation leftPanelCollapsed={false} />);
    const nav = screen.getByRole('navigation');
    expect(nav.className).not.toContain('collapsed');
  });

  it('applies sidebarWidth style when provided', () => {
    render(<LeftNavigation leftPanelCollapsed={false} sidebarWidth={240} />);
    const nav = screen.getByRole('navigation');
    expect(nav.style.width).toBe('240px');
    expect(nav.style.minWidth).toBe('240px');
  });

  it('does not apply inline width style when sidebarWidth is not provided', () => {
    render(<LeftNavigation leftPanelCollapsed={false} />);
    const nav = screen.getByRole('navigation');
    expect(nav.style.width).toBe('');
  });
});
