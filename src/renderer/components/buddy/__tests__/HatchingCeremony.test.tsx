// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../CompanionCard', () => ({
  CompanionCard: ({ companion }) => <div data-testid="companion-card">Revealed {companion.name}</div>,
}));

import { HatchingCeremony } from '../HatchingCeremony';

function companion(overrides = {}) {
  return {
    name: 'Comet',
    species: 'duck',
    personality: 'bold',
    rarity: 'rare',
    shiny: false,
    hatchedAt: 456,
    stats: { DEBUGGING: 1, PATIENCE: 2, CHAOS: 3, WISDOM: 4, SNARK: 5 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    vi.runOnlyPendingTimers();
  });
  vi.useRealTimers();
});

describe('HatchingCeremony', () => {
  it('renders wobble, crack, and reveal phases with tokenized neutral colors', () => {
    const onComplete = vi.fn();
    const { container } = render(<HatchingCeremony companion={companion()} onComplete={onComplete} />);

    const overlay = container.querySelector('.buddy-stats-overlay') as HTMLElement;
    expect(screen.getByText('Something is stirring...')).toBeTruthy();
    expect((screen.getByText('Something is stirring...') as HTMLElement).style.color).toBe('var(--color-neutral-400)');
    expect(overlay.style.cursor).toBe('default');

    fireEvent.click(overlay);
    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(160 * 12);
    });
    expect(screen.getByText("It's hatching!")).toBeTruthy();
    expect((screen.getByText("It's hatching!") as HTMLElement).style.color).toBe('var(--color-neutral-200)');

    act(() => {
      vi.advanceTimersByTime(160 * 7);
    });
    expect(screen.getByTestId('companion-card').textContent).toBe('Revealed Comet');
    expect(screen.getByText('Click anywhere to continue')).toBeTruthy();
    expect((screen.getByText('Click anywhere to continue') as HTMLElement).style.color).toBe('var(--color-neutral-400)');
    expect(overlay.style.cursor).toBe('pointer');
  });

  it('calls onComplete from reveal clicks but stops modal body propagation', () => {
    const onComplete = vi.fn();
    const { container } = render(<HatchingCeremony companion={companion()} onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(160 * 12);
    });
    act(() => {
      vi.advanceTimersByTime(160 * 7);
    });

    fireEvent.click(container.querySelector('.buddy-stats-modal') as HTMLElement);
    expect(onComplete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Click anywhere to continue'));
    expect(onComplete).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.buddy-stats-overlay') as HTMLElement);
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  it('cleans up the active timer when unmounted before reveal', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = render(<HatchingCeremony companion={companion()} onComplete={vi.fn()} />);

    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
