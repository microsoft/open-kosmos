// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { RARITY_COLORS } from '../../../../main/lib/buddy/types';
import { BuddyXPBar } from '../BuddyXPBar';

function xpData(overrides = {}) {
  return {
    totalXP: 0,
    sessionXP: 0,
    lastXPGain: 0,
    xpHistory: [],
    ...overrides,
  };
}

describe('BuddyXPBar', () => {
  it('renders the Hatchling label, common fill, and zero progress before any milestone', () => {
    const { container } = render(<BuddyXPBar xpData={xpData({ totalXP: 0, sessionXP: 250 })} />);

    const label = screen.getByText('Hatchling');
    expect(label).toBeTruthy();
    expect(screen.getByText('+250 this session')).toBeTruthy();

    // Migrated inline color uses the neutral token, not the old cool-gray hex.
    expect((label.parentElement as HTMLElement).style.color).toBe('var(--color-neutral-400)');

    // No rarityColor prop -> falls back to RARITY_COLORS.common.
    const fill = container.querySelector('.buddy-xp-bar-fill') as HTMLElement;
    expect(fill.style.backgroundColor).toBe(RARITY_COLORS.common);
    expect(fill.style.width).toBe('0%');

    // lastXPGain is 0 -> the floating delta is never shown.
    expect(container.querySelector('.buddy-xp-float')).toBeNull();
  });

  it('uses the provided rarity color, current milestone name, and interpolated progress', () => {
    const { container } = render(
      <BuddyXPBar xpData={xpData({ totalXP: 5000 })} rarityColor="#abcdef" />,
    );

    expect(screen.getByText('Novice')).toBeTruthy();

    const fill = container.querySelector('.buddy-xp-bar-fill') as HTMLElement;
    expect(fill.style.backgroundColor).toBe('#abcdef');
    // (5000 - 1000) / (10000 - 1000) * 100 = 44.444...%
    expect(fill.style.width.startsWith('44.44')).toBe(true);
  });

  it('caps progress at 100% and labels the top milestone when past every threshold', () => {
    const { container } = render(<BuddyXPBar xpData={xpData({ totalXP: 20_000_000 })} />);

    expect(screen.getByText('Master')).toBeTruthy();
    const fill = container.querySelector('.buddy-xp-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  describe('XP gain float lifecycle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('shows the gain float then auto-dismisses it after 1500ms', () => {
      const { container, unmount } = render(
        <BuddyXPBar xpData={xpData({ totalXP: 5000, lastXPGain: 50 })} />,
      );

      const float = container.querySelector('.buddy-xp-float') as HTMLElement;
      expect(float).not.toBeNull();
      expect(float.textContent).toBe('+50 XP');

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      // The 1500ms timeout callback fires and hides the float (previously dead code).
      expect(container.querySelector('.buddy-xp-float')).toBeNull();

      // Unmount runs the effect cleanup (clearTimeout) without throwing.
      expect(() => unmount()).not.toThrow();
    });

    it('does not re-show the float when the gain returns to an already-seen value', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { container, rerender } = render(
        <BuddyXPBar xpData={xpData({ totalXP: 5000, lastXPGain: 50 })} />,
      );
      expect((container.querySelector('.buddy-xp-float') as HTMLElement).textContent).toBe('+50 XP');

      // Gain drops to 0: effect re-runs, clears the pending timer, takes the `> 0` false path.
      act(() => {
        rerender(<BuddyXPBar xpData={xpData({ totalXP: 5000, lastXPGain: 0 })} />);
      });
      expect(clearSpy).toHaveBeenCalled();

      // Gain returns to the previously-seen 50: effect runs but the `!== lastGainRef` guard is false,
      // so no new float/timer is scheduled.
      act(() => {
        rerender(<BuddyXPBar xpData={xpData({ totalXP: 5000, lastXPGain: 50 })} />);
      });

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      // showDelta was never reset (no fresh timer), so the float is still present.
      expect(container.querySelector('.buddy-xp-float')).not.toBeNull();

      clearSpy.mockRestore();
    });
  });
});
