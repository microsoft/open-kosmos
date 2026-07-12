// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  xpToLevel: vi.fn(),
  levelToXP: vi.fn((level: number) => level * 100),
  roll: vi.fn(() => ({ bones: { stats: { DEBUGGING: 10, PATIENCE: 20, CHAOS: 30, WISDOM: 40, SNARK: 50 } } })),
}));

vi.mock('../../../../main/lib/buddy/types', () => ({
  ALL_STATS: ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'],
  RARITY_STARS: { common: '★', uncommon: '★★', rare: '★★★', epic: '★★★★', legendary: '★★★★★' },
  RARITY_COLORS: { common: '#888', uncommon: '#0a0', rare: '#06c', epic: '#a0f', legendary: '#fa0' },
  RARITY_MAX_LEVEL: { common: 10, uncommon: 20, rare: 30, epic: 50, legendary: 100 },
}));
vi.mock('../../../../main/lib/buddy/leveling', () => ({
  xpToLevel: mocks.xpToLevel,
  levelToXP: mocks.levelToXP,
}));
vi.mock('../../../../main/lib/buddy/companion', () => ({ roll: mocks.roll }));

import { BuddyStatsModal } from '../BuddyStatsModal';

function companion(overrides = {}) {
  return {
    name: 'Fido',
    species: 'duck',
    personality: 'grumpy',
    rarity: 'epic',
    stats: { DEBUGGING: 5, PATIENCE: 6, CHAOS: 7, WISDOM: 8, SNARK: 9 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.levelToXP.mockImplementation((level: number) => level * 100);
  mocks.roll.mockReturnValue({ bones: { stats: { DEBUGGING: 10, PATIENCE: 20, CHAOS: 30, WISDOM: 40, SNARK: 50 } } });
});

describe('BuddyStatsModal', () => {
  it('renders a mid-level buddy with XP progress and stat bonuses', () => {
    mocks.xpToLevel.mockReturnValue(5);
    render(
      <BuddyStatsModal
        companion={companion()}
        activeBuddy={{ rarity: 'epic', xp: 550, seed: 's', statBonuses: { DEBUGGING: 7 } }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Fido')).toBeTruthy();
    expect(screen.getByText(/Lv\.5 \/ 50/)).toBeTruthy();
    expect(screen.queryByText(/\(MAX\)/)).toBeNull();
    // base 10 + bonus 7 = 17 (+7) for DEBUGGING
    expect(screen.getByText('17 (+7)')).toBeTruthy();
    // not-max XP uses the "x / y XP" form
    expect(screen.getByText(/550 \/ 600 XP/)).toBeTruthy();
  });

  it('shows the merge hint at max level for non-legendary rarity', () => {
    mocks.xpToLevel.mockReturnValue(999);
    render(
      <BuddyStatsModal
        companion={companion()}
        activeBuddy={{ rarity: 'epic', xp: 99999, seed: 's', statBonuses: {} }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Lv\.50 \/ 50 \(MAX\)/)).toBeTruthy();
    expect(screen.getByText(/Merge with a same-species Epic to evolve/)).toBeTruthy();
    expect(screen.getByText(/99,999 XP/)).toBeTruthy();
  });

  it('hides the merge hint for a maxed legendary buddy', () => {
    mocks.xpToLevel.mockReturnValue(100);
    render(
      <BuddyStatsModal
        companion={companion({ rarity: 'legendary' })}
        activeBuddy={{ rarity: 'legendary', xp: 100000, seed: 's', statBonuses: {} }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Lv\.100 \/ 100 \(MAX\)/)).toBeTruthy();
    expect(screen.queryByText(/Merge with/)).toBeNull();
  });

  it('falls back to companion rarity/stats when no activeBuddy is given', () => {
    mocks.xpToLevel.mockReturnValue(0);
    render(<BuddyStatsModal companion={companion()} activeBuddy={null} onClose={vi.fn()} />);
    // companion.stats used (no bonuses), e.g. DEBUGGING base 5, no "(+n)"
    expect(screen.getByText('5')).toBeTruthy();
    expect(mocks.roll).not.toHaveBeenCalled();
  });

  it('handles a zero-width level (xpNeeded === 0 -> 0% progress)', () => {
    mocks.xpToLevel.mockReturnValue(3);
    mocks.levelToXP.mockReturnValue(1000); // currentLevelXP === nextLevelXP
    render(
      <BuddyStatsModal
        companion={companion()}
        activeBuddy={{ rarity: 'epic', xp: 1000, seed: 's', statBonuses: {} }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Lv\.3 \/ 50/)).toBeTruthy();
  });

  it('closes via overlay click and the Close button, but not via modal body click', () => {
    mocks.xpToLevel.mockReturnValue(1);
    const onClose = vi.fn();
    const { container } = render(
      <BuddyStatsModal
        companion={companion()}
        activeBuddy={{ rarity: 'epic', xp: 10, seed: 's', statBonuses: {} }}
        onClose={onClose}
      />,
    );
    fireEvent.click(container.querySelector('.buddy-stats-modal'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.buddy-stats-overlay'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
