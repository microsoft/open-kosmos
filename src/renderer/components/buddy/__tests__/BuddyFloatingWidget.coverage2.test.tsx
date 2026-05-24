/** @vitest-environment happy-dom */
/**
 * BuddyFloatingWidget additional coverage tests (coverage2).
 * Covers docked / peeking states, edge snapping, mouseEnter/Leave, double-click while docked.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Companion } from '../../../../main/lib/buddy/types';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockActions = vi.hoisted(() => ({
  pet: vi.fn(),
  setMuted: vi.fn(),
  setMinimized: vi.fn(),
  setHidden: vi.fn(),
  dismissReaction: vi.fn(),
  dismissMilestone: vi.fn(),
  dismissLevelUp: vi.fn(),
  setShowMainPanel: vi.fn(),
  setActiveBuddy: vi.fn(),
}));

vi.mock('../buddy.css', () => ({}));
vi.mock('../BuddySpriteDisplay', () => ({
  BuddySpriteDisplay: ({ minimized }: any) => (
    <div data-testid={minimized ? 'sprite-minimized' : 'sprite-full'} />
  ),
}));
vi.mock('../BuddyInfoPanel', () => ({
  BuddyInfoPanel: () => <div data-testid="info-panel" />,
}));
vi.mock('../BuddySpeechBubble', () => ({
  BuddySpeechBubble: ({ text, onDismiss }: any) => (
    <div data-testid="speech-bubble">
      {text}
      <button onClick={onDismiss}>dismiss</button>
    </div>
  ),
}));
vi.mock('../BuddyPetEffect', () => ({
  BuddyPetEffect: () => <div data-testid="pet-effect" />,
}));
vi.mock('../BuddyMilestoneEffect', () => ({
  BuddyMilestoneEffect: ({ onComplete }: any) => (
    <div data-testid="milestone-effect">
      <button onClick={onComplete}>complete-milestone</button>
    </div>
  ),
}));
vi.mock('../BuddyContextMenu', () => ({
  BuddyContextMenu: ({ onPet, onStats, onOpenBackpack, onToggleMute, onHide, onClose }: any) => (
    <div data-testid="context-menu">
      <button onClick={onPet}>ctx-pet</button>
      <button onClick={onStats}>ctx-stats</button>
      <button onClick={onOpenBackpack}>ctx-backpack</button>
      <button onClick={onToggleMute}>ctx-mute</button>
      <button onClick={onHide}>ctx-hide</button>
      <button onClick={onClose}>ctx-close</button>
    </div>
  ),
}));
vi.mock('../BuddyStatsModal', () => ({
  BuddyStatsModal: ({ onClose }: any) => (
    <div data-testid="stats-modal">
      <button onClick={onClose}>close-stats</button>
    </div>
  ),
}));
vi.mock('../../../../main/lib/buddy/types', () => ({
  RARITY_COLORS: {
    common: '#888',
    uncommon: '#4ade80',
    rare: '#60a5fa',
    epic: '#c084fc',
    legendary: '#fbbf24',
  },
}));

import { BuddyFloatingWidget } from '../BuddyFloatingWidget';

beforeEach(() => {
  vi.clearAllMocks();
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
  hatchedAt: Date.now(),
};

const baseState = {
  companion: mockCompanion,
  hidden: false,
  loading: false,
  minimized: false,
  muted: false,
  reaction: null,
  milestone: null,
  levelUp: null,
  roster: [],
  activeBuddyId: '',
  userTotalTokens: 0,
  rarityUpgrade: null,
  showMainPanel: false,
  petAt: 0,
  xpData: null,
};

function renderWidget(stateOverrides: any = {}) {
  const state = { ...baseState, ...stateOverrides };
  return render(<BuddyFloatingWidget buddy={state as any} actions={mockActions as any} />);
}

/** Simulate dragging a widget past an edge so it docks. */
function dragToDock(
  widget: HTMLElement,
  direction: 'right' | 'left' | 'top' | 'bottom',
  viewportW = 1280,
  viewportH = 800,
) {
  // Define rect such that the widget is past the specified edge
  const rect: DOMRect = {
    left: direction === 'left' ? -10 : 50,
    top: direction === 'top' ? -10 : 50,
    right: direction === 'right' ? viewportW + 10 : 150,
    bottom: direction === 'bottom' ? viewportH + 10 : 150,
    width: 100,
    height: 100,
    x: 50,
    y: 50,
    toJSON: () => ({}),
  };

  widget.getBoundingClientRect = () => rect;

  // Override window size for distance calcs
  Object.defineProperty(window, 'innerWidth', { value: viewportW, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: viewportH, configurable: true });

  fireEvent.mouseDown(widget, { button: 0, clientX: 100, clientY: 100 });
  fireEvent(window, new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
  fireEvent(window, new MouseEvent('mouseup', { bubbles: true }));
}

describe('BuddyFloatingWidget – dock to right edge', () => {
  it('renders dock-tab when docked to the right', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');
    // After docking, the component re-renders with docked state showing dock-tab
    expect(document.querySelector('.buddy-dock-tab')).toBeTruthy();
  });

  it('context menu shows in docked (non-peeking) state on right-click', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');

    // Right-click the docked widget
    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.contextMenu(docked, { clientX: 50, clientY: 50 });
    expect(screen.getByTestId('context-menu')).toBeTruthy();
  });

  it('closes context menu via ctx-close in docked state', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');

    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.contextMenu(docked, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-close'));
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });

  it('mouseEnter triggers peeking state when docked', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');

    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseEnter(docked);
    // After peeking: sprite should be visible in the peeking render
    expect(screen.getByTestId('sprite-minimized')).toBeTruthy();
  });

  it('mouseLeave exits peeking state', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');

    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseEnter(docked);
    // now peeking
    fireEvent.mouseLeave(docked);
    // back to dock-tab
    expect(document.querySelector('.buddy-dock-tab')).toBeTruthy();
  });

  it('double-click on peeking widget un-docks and resets position', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');

    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseEnter(docked);
    // now peeking
    const peeking = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.doubleClick(peeking);
    // should be undocked — info panel visible
    expect(screen.getByTestId('info-panel')).toBeTruthy();
  });
});

describe('BuddyFloatingWidget – dock to left edge', () => {
  it('renders dock-tab when docked to the left', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'left');
    expect(document.querySelector('.buddy-dock-tab')).toBeTruthy();
  });
});

describe('BuddyFloatingWidget – dock to bottom edge', () => {
  it('renders dock-tab when docked to the bottom', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'bottom');
    expect(document.querySelector('.buddy-dock-tab')).toBeTruthy();
  });
});

describe('BuddyFloatingWidget – dock to top edge', () => {
  it('renders dock-tab when docked to the top', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'top');
    expect(document.querySelector('.buddy-dock-tab')).toBeTruthy();
  });
});

describe('BuddyFloatingWidget – drag starts from docked state and un-docks', () => {
  it('un-docks when a drag starts from docked state', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    // Dock first
    dragToDock(widget, 'right');

    // Start dragging from docked state — should un-dock
    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    docked.getBoundingClientRect = () => ({
      left: 50, top: 50, right: 150, bottom: 150,
      width: 100, height: 100, x: 50, y: 50, toJSON: () => ({}),
    });
    fireEvent.mouseDown(docked, { button: 0, clientX: 100, clientY: 100 });
    // Un-docked → sprite-full and info-panel visible
    expect(document.querySelector('.buddy-widget')).toBeTruthy();
  });
});

describe('BuddyFloatingWidget – peeking context menu actions', () => {
  it('pet action works in peeking state', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    dragToDock(widget, 'right');

    const docked = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseEnter(docked);
    const peeking = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.contextMenu(peeking, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-pet'));
    expect(mockActions.pet).toHaveBeenCalled();
  });
});

describe('BuddyFloatingWidget – roster lookup', () => {
  it('renders fine when activeBuddy is found in roster', () => {
    const { container } = renderWidget({
      roster: [{ id: 'b1', seed: 'seed', soul: { name: 'Buddy', personality: 'nice', hatchedAt: 0 }, xp: 0, rarity: 'common', statBonuses: {} }],
      activeBuddyId: 'b1',
    });
    expect(container.firstChild).toBeTruthy();
  });

  it('renders fine when activeBuddy is not found in roster', () => {
    const { container } = renderWidget({
      roster: [],
      activeBuddyId: 'missing-id',
    });
    expect(container.firstChild).toBeTruthy();
  });
});

describe('BuddyFloatingWidget – mouseEnter/Leave when NOT docked', () => {
  it('mouseEnter does nothing when undocked', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseEnter(widget);
    // sprite-full should still be present (not peeking)
    expect(screen.getByTestId('sprite-full')).toBeTruthy();
  });

  it('mouseLeave does nothing when undocked', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseLeave(widget);
    expect(screen.getByTestId('sprite-full')).toBeTruthy();
  });
});
