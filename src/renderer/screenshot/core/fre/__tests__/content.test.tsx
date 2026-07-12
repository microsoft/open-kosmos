// @ts-nocheck
/** @vitest-environment happy-dom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { Content } from '../content';

function getInsertedCss() {
  return Array.from(document.styleSheets)
    .flatMap(sheet => Array.from(sheet.cssRules).map(rule => rule.cssText))
    .join('\n');
}

describe('Content', () => {
  it('renders the screenshot shortcut guidance and calls both actions', () => {
    const onGoToSettings = vi.fn();
    const onDismiss = vi.fn();

    render(<Content onGoToSettings={onGoToSettings} onDismiss={onDismiss} />);

    expect(screen.getByText('Quick screenshot with a shortcut')).toBeTruthy();
    expect(screen.getByText('Enable in')).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Go to enable shortcut' }));
    fireEvent.click(screen.getByRole('button', { name: "Don't show me again" }));

    expect(onGoToSettings).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses neutral design tokens for migrated secondary button gray styles', () => {
    render(<Content onGoToSettings={vi.fn()} onDismiss={vi.fn()} />);

    const cssText = getInsertedCss();
    expect(cssText).toContain('var(--color-neutral-300)');
    expect(cssText).toContain('var(--color-neutral-50)');
    expect(cssText).toContain('var(--color-neutral-400)');
    expect(cssText).toContain('var(--color-neutral-100)');
    expect(cssText).not.toMatch(/#(?:f9fafb|f3f4f6|d1d5db|9ca3af)/i);
  });
});
