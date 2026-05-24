/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, act } from '@testing-library/react';
import { BuddySpriteDisplay } from '../BuddySpriteDisplay';
import { BuddyInfoPanel } from '../BuddyInfoPanel';
import { BuddyXPBar } from '../BuddyXPBar';
import { BuddySpeechBubble } from '../BuddySpeechBubble';
import { BuddyMainPanel } from '../BuddyMainPanel';
import type { CompanionBones, Companion, BuddyXPData, BuddyEntry } from '../../../../main/lib/buddy/types';

const mockBuddyEntry: BuddyEntry = {
  id: 'test-buddy-1',
  seed: 'test-seed-1',
  soul: { name: 'Test Duck', personality: 'cheerfully unhelpful', hatchedAt: Date.now() },
  xp: 500,
  rarity: 'common',
  statBonuses: { DEBUGGING: 0, PATIENCE: 0, CHAOS: 0, WISDOM: 0, SNARK: 0 },
};

// Mock the sprites module
vi.mock('../../../../main/lib/buddy/sprites', async () => ({
  renderSprite: () => ['      ', ' (··) ', '  <")> ', '  _/| ', ' (_)  '],
  renderFace: () => '(··)',
  spriteFrameCount: () => 3,
}));

vi.mock('../../../../main/lib/buddy/leveling', async () => ({
  xpToLevel: (xp: number) => Math.floor(xp / 100000) + 1,
  levelToXP: (level: number) => (level - 1) * 100000,
}));

vi.mock('../../../../main/lib/buddy/companion', async () => ({
  roll: () => ({
    bones: {
      rarity: 'common' as const,
      species: 'duck' as const,
      eye: '·' as const,
      hat: 'none' as const,
      shiny: false,
      stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
    },
    inspirationSeed: 12345,
  }),
}));

vi.mock('../../../../main/lib/buddy/merging', async () => ({
  validateMerge: () => ({ valid: false, error: 'Test mock' }),
}));

vi.mock('../buddy.atom', () => ({
  BuddyAtom: {
    use: () => [
      {
        companion: mockCompanion,
        xpData: mockXPData,
        reaction: null,
        milestone: null,
        petAt: 0,
        muted: false,
        minimized: false,
        hidden: false,
        loading: false,
        roster: [mockBuddyEntry],
        activeBuddyId: 'test-buddy-1',
        userTotalTokens: 12345,
        levelUp: null,
        rarityUpgrade: null,
        showMainPanel: false,
      },
      {
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
      },
    ],
  },
}));

const mockBones: CompanionBones = {
  rarity: 'common',
  species: 'duck',
  eye: '·',
  hat: 'none',
  shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 50, CHAOS: 50, WISDOM: 50, SNARK: 50 },
};

const mockCompanion: Companion = {
  ...mockBones,
  name: 'Test Duck',
  personality: 'cheerfully unhelpful',
  hatchedAt: Date.now(),
};

const mockXPData: BuddyXPData = {
  totalXP: 500,
  sessionXP: 100,
  lastXPGain: 42,
  xpHistory: [],
};

describe('BuddySpriteDisplay', () => {
  it('renders without crashing', () => {
    const { container } = render(<BuddySpriteDisplay bones={mockBones} />);
    expect(container.querySelector('.buddy-sprite')).toBeTruthy();
  });

  it('renders minimized face', () => {
    const { container } = render(<BuddySpriteDisplay bones={mockBones} minimized />);
    expect(container.textContent).toContain('(');
  });
});

describe('BuddyInfoPanel', () => {
  it('renders companion name', () => {
    const { getByText } = render(<BuddyInfoPanel companion={mockCompanion} />);
    expect(getByText('Test Duck')).toBeTruthy();
  });

  it('renders name with rarity color', () => {
    const { container } = render(<BuddyInfoPanel companion={mockCompanion} />);
    const nameEl = container.querySelector('.buddy-info-name');
    expect(nameEl).toBeTruthy();
    expect(nameEl?.textContent).toBe('Test Duck');
  });
});

describe('BuddyXPBar', () => {
  it('renders without crashing', () => {
    const { container } = render(<BuddyXPBar xpData={mockXPData} />);
    expect(container.querySelector('.buddy-xp-bar')).toBeTruthy();
  });

  it('shows session XP', () => {
    const { container } = render(<BuddyXPBar xpData={mockXPData} />);
    expect(container.textContent).toContain('100');
  });

  it('shows XP delta float when lastXPGain changes', () => {
    const { container, rerender } = render(
      <BuddyXPBar xpData={{ ...mockXPData, lastXPGain: 0 }} />
    );
    expect(container.querySelector('.buddy-xp-float')).toBeFalsy();

    // Update with a new XP gain triggers the delta display
    rerender(<BuddyXPBar xpData={{ ...mockXPData, lastXPGain: 75 }} />);
    expect(container.querySelector('.buddy-xp-float')).toBeTruthy();
    expect(container.textContent).toContain('+75 XP');
  });

  it('renders with rarityColor prop', () => {
    const { container } = render(<BuddyXPBar xpData={mockXPData} rarityColor="#ff00ff" />);
    const fill = container.querySelector('.buddy-xp-bar-fill') as HTMLElement;
    // happy-dom preserves inline style as-set (raw hex value)
    expect(fill?.style.backgroundColor).toBeTruthy();
  });

  it('uses 100% fill when at max milestone', () => {
    // XP at or above the last milestone's threshold (10_000_000) means getNextMilestone returns null
    // and progress = 100 by the fallback
    const { container } = render(
      <BuddyXPBar xpData={{ totalXP: 10_000_000, sessionXP: 0, lastXPGain: 0, xpHistory: [] }} />
    );
    const fill = container.querySelector('.buddy-xp-bar-fill') as HTMLElement;
    const width = parseFloat(fill?.style.width ?? '0');
    expect(width).toBe(100);
  });
});

describe('BuddySpeechBubble', () => {
  it('renders text', () => {
    const { getByText } = render(<BuddySpeechBubble text="quack!" onDismiss={() => {}} />);
    expect(getByText('quack!')).toBeTruthy();
  });
});

describe('BuddyMainPanel', () => {
  it('renders without crashing', () => {
    const { getByText } = render(
      <BuddyMainPanel
        onHatchNew={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(getByText('🎒 Backpack')).toBeTruthy();
  });

  it('shows active buddy name', () => {
    const { container } = render(
      <BuddyMainPanel
        onHatchNew={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const nameEl = container.querySelector('.buddy-main-player-name');
    expect(nameEl).toBeTruthy();
    expect(nameEl?.textContent).toBe('Test Duck');
  });

  it('shows token count', () => {
    const { container } = render(
      <BuddyMainPanel
        onHatchNew={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.textContent).toContain('12,345');
  });

  it('shows coming soon placeholder', () => {
    const { getByText } = render(
      <BuddyMainPanel
        onHatchNew={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(getByText(/Coming Soon/)).toBeTruthy();
  });
});
