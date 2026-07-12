// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { BuddyEntry, Companion, BuddyXPData } from '../../../../main/lib/buddy/types';

const mockActions = vi.hoisted(() => ({
  set: vi.fn(),
  hatch: vi.fn(),
  rename: vi.fn(),
  pet: vi.fn(),
  setMuted: vi.fn(),
  setMinimized: vi.fn(),
  setHidden: vi.fn(),
  dismissReaction: vi.fn(),
  dismissMilestone: vi.fn(),
  refresh: vi.fn(),
  setActiveBuddy: vi.fn(),
  mergeBuddies: vi.fn(),
  releaseBuddy: vi.fn(),
  refreshRoster: vi.fn(),
  dismissLevelUp: vi.fn(),
  dismissRarityUpgrade: vi.fn(),
  setShowMainPanel: vi.fn(),
}));

const mockBuddyState = vi.hoisted(() => ({
  companion: null as Companion | null,
  xpData: null as BuddyXPData | null,
  reaction: null,
  milestone: null,
  petAt: 0,
  muted: false,
  minimized: false,
  hidden: false,
  loading: false,
  roster: [] as BuddyEntry[],
  activeBuddyId: '',
  userTotalTokens: 0,
  levelUp: null,
  rarityUpgrade: null,
  showMainPanel: false,
}));

const mockValidateMerge = vi.hoisted(() => vi.fn(() => ({ valid: false, error: 'Mismatched species' })));

vi.mock('../BuddyMainPanel.css', () => ({}));
vi.mock('../BuddySpriteDisplay', () => ({
  BuddySpriteDisplay: ({ rarityColor }: any) => <div data-testid="buddy-sprite" data-rarity-color={rarityColor} />,
}));
vi.mock('../BuddyPetEffect', () => ({
  BuddyPetEffect: () => <div data-testid="pet-effect" />,
}));
vi.mock('../BuddyXPBar', () => ({
  BuddyXPBar: ({ rarityColor }: any) => <div data-testid="xp-bar" data-rarity-color={rarityColor} />,
}));
vi.mock('../BuddyCard', () => ({
  BuddyCard: ({ entry, onActivate, onSelect, onShowStats, isSelected }: any) => (
    <div data-testid={`buddy-card-${entry.id}`} data-selected={String(isSelected)}>
      <button onClick={() => onActivate(entry.id)}>activate-{entry.id}</button>
      <button onClick={() => onSelect(entry.id)}>select-{entry.id}</button>
      <button onClick={() => onShowStats(entry.id)}>stats-{entry.id}</button>
    </div>
  ),
}));
vi.mock('../BuddyStatsModal', () => ({
  BuddyStatsModal: ({ companion, activeBuddy, onClose }: any) => (
    <div data-testid="stats-modal" data-name={companion.name} data-active-id={activeBuddy.id}>
      <button onClick={onClose}>close-stats</button>
    </div>
  ),
}));
vi.mock('../../../../main/lib/buddy/sprites', () => ({
  renderSprite: () => [],
  renderFace: () => '(·)',
  spriteFrameCount: () => 1,
}));
vi.mock('../../../../main/lib/buddy/leveling', () => ({
  xpToLevel: (xp: number) => Math.floor(xp / 100) + 1,
  levelToXP: (lvl: number) => (lvl - 1) * 100,
}));
vi.mock('../../../../main/lib/buddy/companion', () => ({
  roll: (_seed: string) => ({
    bones: {
      rarity: 'common',
      species: 'duck',
      eye: '·',
      hat: 'none',
      shiny: false,
      stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    },
    inspirationSeed: 0,
  }),
}));
vi.mock('../../../../main/lib/buddy/merging', () => ({
  validateMerge: (...args: unknown[]) => mockValidateMerge(...args),
}));
vi.mock('../buddy.atom', () => ({
  BuddyAtom: {
    use: () => [mockBuddyState, mockActions],
  },
}));

import { BuddyMainPanel } from '../BuddyMainPanel';

const makeEntry = (id: string, rarity: BuddyEntry['rarity'] = 'common'): BuddyEntry => ({
  id,
  seed: `seed-${id}`,
  soul: { name: `Buddy ${id}`, personality: 'brave', hatchedAt: 1234 },
  xp: 200,
  rarity,
  statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
});

const mockCompanion: Companion = {
  rarity: 'common',
  species: 'duck',
  eye: '·',
  hat: 'none',
  shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
  name: 'Quackers',
  personality: 'cheerful',
  hatchedAt: 1234,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateMerge.mockReset();
  mockValidateMerge.mockReturnValue({ valid: false, error: 'Mismatched species' });
  mockBuddyState.companion = mockCompanion;
  mockBuddyState.xpData = null;
  mockBuddyState.roster = [makeEntry('a'), makeEntry('b'), makeEntry('c')];
  mockBuddyState.activeBuddyId = 'a';
  mockBuddyState.userTotalTokens = 0;
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BuddyMainPanel hex and branch coverage', () => {
  it('uses the neutral-400 token when no companion supplies a rarity color', () => {
    mockBuddyState.companion = null;
    mockBuddyState.roster = [];

    const { container } = render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);

    expect((container.querySelector('.buddy-main-milestone-fill') as HTMLElement).style.backgroundColor)
      .toBe('var(--color-neutral-400)');
  });

  it('validates forward, reverse, and invalid merge directions from selected roster entries', () => {
    mockValidateMerge.mockImplementation((from: BuddyEntry, to: BuddyEntry) => {
      if (from.id === 'a' && to.id === 'b') return { valid: true, error: undefined };
      if (from.id === 'b' && to.id === 'c') return { valid: true, error: undefined };
      return { valid: false, error: 'Cannot merge these buddies' };
    });

    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('select-a'));
    fireEvent.click(screen.getByText('select-b'));
    expect(screen.getByText('🔮 Merge').closest('button')).not.toBeDisabled();
    expect(screen.getByText('Ready to merge!')).toBeInTheDocument();

    fireEvent.click(screen.getByText('select-a'));
    fireEvent.click(screen.getByText('select-c'));
    expect(screen.getByText('🔮 Merge').closest('button')).not.toBeDisabled();

    fireEvent.click(screen.getByText('select-b'));
    fireEvent.click(screen.getByText('select-a'));
    expect(screen.getByText('Cannot merge these buddies')).toBeInTheDocument();
    expect(screen.getByText('🔮 Merge').closest('button')).toBeDisabled();
  });

  it('returns from merge click when selection is incomplete', () => {
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    const mergeButton = screen.getByText('🔮 Merge').closest('button')!;
    mergeButton.disabled = false;

    fireEvent.click(mergeButton);

    expect(mockActions.mergeBuddies).not.toHaveBeenCalled();
  });

  it('returns from merge click when a selected id is no longer in the roster', () => {
    mockValidateMerge.mockReturnValue({ valid: true, error: undefined });
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('select-a'));
    fireEvent.click(screen.getByText('select-b'));
    mockBuddyState.roster = [];

    fireEvent.click(screen.getByText('🔮 Merge').closest('button')!);

    expect(mockActions.mergeBuddies).not.toHaveBeenCalled();
  });

  it('returns from merge click when neither direction can keep a buddy', () => {
    mockValidateMerge.mockReturnValue({ valid: true, error: undefined });
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('select-a'));
    fireEvent.click(screen.getByText('select-b'));
    const mergeButton = screen.getByText('🔮 Merge').closest('button')!;
    expect(mergeButton).not.toBeDisabled();
    mockValidateMerge.mockReturnValue({ valid: false, error: 'No compatible direction' });

    fireEvent.click(mergeButton);

    expect(mockActions.mergeBuddies).not.toHaveBeenCalled();
  });

  it('merges using the reverse valid direction after confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockValidateMerge.mockImplementation((from: BuddyEntry, to: BuddyEntry) => (
      from.id === 'b' && to.id === 'a'
        ? { valid: true, error: undefined }
        : { valid: false, error: 'Forward mismatch' }
    ));

    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('select-a'));
    fireEvent.click(screen.getByText('select-b'));
    fireEvent.click(screen.getByText('🔮 Merge').closest('button')!);

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Merge Buddy a into Buddy b?'));
    expect(mockActions.mergeBuddies).toHaveBeenCalledWith('b', 'a');
  });

  it('does not release when the selected roster entry disappears before click', () => {
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('select-b'));
    mockBuddyState.roster = [makeEntry('a')];

    fireEvent.click(screen.getByText('Release'));

    expect(mockActions.releaseBuddy).not.toHaveBeenCalled();
  });

  it('alerts instead of releasing when the selected buddy becomes active before click', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('select-b'));
    mockBuddyState.activeBuddyId = 'b';

    fireEvent.click(screen.getByText('Release'));

    expect(alertSpy).toHaveBeenCalledWith('Cannot release the active buddy!');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockActions.releaseBuddy).not.toHaveBeenCalled();
  });

  it('clears the previous pet timer when petting twice', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('❤️ Pet'));
    fireEvent.click(screen.getByText('❤️ Pet'));

    expect(mockActions.pet).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pet-effect')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2600));
    expect(screen.queryByTestId('pet-effect')).not.toBeInTheDocument();
  });

  it('starts rename with an empty value when the companion disappears before click', () => {
    render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    mockBuddyState.companion = null;

    fireEvent.click(screen.getByText('✏️ Rename'));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mockActions.rename).not.toHaveBeenCalled();
  });

  it('closes the stats modal by returning null when the stats buddy disappears', () => {
    const { rerender } = render(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('stats-b'));
    expect(screen.getByTestId('stats-modal')).toHaveAttribute('data-active-id', 'b');

    mockBuddyState.roster = [makeEntry('a')];
    rerender(<BuddyMainPanel onHatchNew={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByTestId('stats-modal')).not.toBeInTheDocument();
  });
});
