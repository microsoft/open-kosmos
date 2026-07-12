// @ts-nocheck
/**
 * @vitest-environment happy-dom
 * Coverage tests for BuddyCard.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────
const mockRoll = vi.hoisted(() => vi.fn(() => ({
  bones: { species: 'duck', rarity: 'common', eye: '·', hat: 'none', shiny: false, stats: {} },
  inspirationSeed: 1,
})));
const mockRenderFace = vi.hoisted(() => vi.fn(() => '(o.o)'));
const mockXpToLevel = vi.hoisted(() => vi.fn(() => 3));
const mockT = vi.hoisted(() => vi.fn((key: string, params?: Record<string, unknown>) => {
  if (key === 'buddy.levelCompact') return `Lv.${params?.level}`;
  if (key === 'buddy.species.duck') return 'Duck';
  return key;
}));

vi.mock('../../../../main/lib/buddy/companion', () => ({ roll: (...a: any[]) => mockRoll(...a) }));
vi.mock('../../../../main/lib/buddy/sprites', () => ({ renderFace: (...a: any[]) => mockRenderFace(...a) }));
vi.mock('../../../../main/lib/buddy/leveling', () => ({ xpToLevel: (...a: any[]) => mockXpToLevel(...a) }));
vi.mock('../../../../main/lib/buddy/types', () => ({
  RARITY_COLORS: { common: '#aaa', rare: '#00f', epic: '#a0f', legendary: '#ff0' },
  RARITY_MAX_LEVEL: { common: 10, rare: 20, epic: 30, legendary: 50 },
}));
vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: mockT }),
}));

import { BuddyCard } from '../BuddyCard';

function makeBuddyEntry(overrides = {}) {
  return {
    id: 'buddy-1',
    seed: 'seed-abc',
    soul: { name: 'Quackers', personality: 'cheerful', hatchedAt: 0 },
    xp: 500,
    rarity: 'common' as const,
    statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
    ...overrides,
  };
}

describe('BuddyCard', () => {
  const onActivate = vi.fn();
  const onSelect = vi.fn();
  const onShowStats = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders buddy name and level', () => {
    const entry = makeBuddyEntry();
    render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Quackers')).toBeTruthy();
    expect(screen.getByText('Lv.3')).toBeTruthy();
    expect(screen.getByText('Duck')).toBeTruthy();
  });

  it('shows active badge when isActive=true', () => {
    const entry = makeBuddyEntry();
    render(
      <BuddyCard
        entry={entry}
        isActive={true}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    expect(mockT).toHaveBeenCalledWith('buddy.active');
  });

  it('does not show active badge when isActive=false', () => {
    const entry = makeBuddyEntry();
    const { container } = render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    expect(container.querySelector('.buddy-card-active-badge')).toBeNull();
  });

  it('applies selected class when isSelected=true', () => {
    const entry = makeBuddyEntry();
    const { container } = render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={true}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    expect(container.firstChild).toHaveClass('selected');
  });

  it('calls onActivate on normal click', () => {
    const entry = makeBuddyEntry();
    const { container } = render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(container.firstChild as Element);
    expect(onActivate).toHaveBeenCalledWith('buddy-1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('calls onSelect on shift+click', () => {
    const entry = makeBuddyEntry();
    const { container } = render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(container.firstChild as Element, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith('buddy-1');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('calls onShowStats on double click', () => {
    const entry = makeBuddyEntry();
    const { container } = render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
        onShowStats={onShowStats}
      />,
    );
    fireEvent.dblClick(container.firstChild as Element);
    expect(onShowStats).toHaveBeenCalledWith('buddy-1');
  });

  it('does not throw on double click without onShowStats', () => {
    const entry = makeBuddyEntry();
    const { container } = render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    expect(() => fireEvent.dblClick(container.firstChild as Element)).not.toThrow();
  });

  it('caps level at RARITY_MAX_LEVEL', () => {
    mockXpToLevel.mockReturnValueOnce(100); // beyond max
    const entry = makeBuddyEntry({ rarity: 'common' });
    render(
      <BuddyCard
        entry={entry}
        isActive={false}
        isSelected={false}
        onActivate={onActivate}
        onSelect={onSelect}
      />,
    );
    // RARITY_MAX_LEVEL.common = 10, so level should be capped at 10
    expect(screen.getByText('Lv.10')).toBeTruthy();
  });
});
