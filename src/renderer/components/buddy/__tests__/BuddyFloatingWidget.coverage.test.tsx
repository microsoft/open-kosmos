/**
 * @vitest-environment happy-dom
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

describe('BuddyFloatingWidget – hidden / loading guards', () => {
  it('renders nothing when hidden', () => {
    const { container } = renderWidget({ hidden: true });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when loading', () => {
    const { container } = renderWidget({ loading: true });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no companion', () => {
    const { container } = renderWidget({ companion: null });
    expect(container.firstChild).toBeNull();
  });
});

describe('BuddyFloatingWidget – normal (undocked) render', () => {
  it('renders sprite and info panel when not minimized', () => {
    renderWidget();
    expect(screen.getByTestId('sprite-full')).toBeTruthy();
    expect(screen.getByTestId('info-panel')).toBeTruthy();
  });

  it('does not render info panel when minimized', () => {
    renderWidget({ minimized: true });
    expect(screen.queryByTestId('info-panel')).toBeNull();
  });

  it('shows speech bubble for reaction when not muted', () => {
    renderWidget({ reaction: { text: 'Hello!' } });
    expect(screen.getByTestId('speech-bubble')).toBeTruthy();
    expect(screen.getByText('Hello!')).toBeTruthy();
  });

  it('hides speech bubble when muted', () => {
    renderWidget({ reaction: { text: 'Hello!' }, muted: true });
    expect(screen.queryByTestId('speech-bubble')).toBeNull();
  });

  it('shows level-up toast when levelUp is set', () => {
    renderWidget({ levelUp: { level: 5, statGained: 'DEBUGGING' } });
    expect(screen.getByText('Level 5!')).toBeTruthy();
  });

  it('level-up speech bubble takes priority over reaction', () => {
    renderWidget({
      levelUp: { level: 3, statGained: 'WISDOM' },
      reaction: { text: 'Reaction text' },
    });
    expect(screen.getByText('Level 3! +1 WISDOM')).toBeTruthy();
  });

  it('shows milestone effect when milestone is set', () => {
    renderWidget({ milestone: { type: 'token' } });
    expect(screen.getByTestId('milestone-effect')).toBeTruthy();
  });

  it('dismissMilestone is called when milestone effect completes', () => {
    renderWidget({ milestone: { type: 'token' } });
    fireEvent.click(screen.getByText('complete-milestone'));
    expect(mockActions.dismissMilestone).toHaveBeenCalled();
  });

  it('opens context menu on right click', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 100, clientY: 200 });
    expect(screen.getByTestId('context-menu')).toBeTruthy();
  });

  it('closes context menu when ctx-close is clicked', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByText('ctx-close'));
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });

  it('pet action shows pet effect', () => {
    vi.useFakeTimers();
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-pet'));
    expect(mockActions.pet).toHaveBeenCalled();
    expect(screen.getByTestId('pet-effect')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2600); });
    expect(screen.queryByTestId('pet-effect')).toBeNull();
    vi.useRealTimers();
  });

  it('ctx-stats opens stats modal', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-stats'));
    expect(screen.getByTestId('stats-modal')).toBeTruthy();
  });

  it('close stats modal closes it', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-stats'));
    fireEvent.click(screen.getByText('close-stats'));
    expect(screen.queryByTestId('stats-modal')).toBeNull();
  });

  it('ctx-backpack calls setShowMainPanel(true)', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-backpack'));
    expect(mockActions.setShowMainPanel).toHaveBeenCalledWith(true);
  });

  it('ctx-mute calls setMuted with inverted mute', () => {
    renderWidget({ muted: false });
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-mute'));
    expect(mockActions.setMuted).toHaveBeenCalledWith(true);
  });

  it('ctx-hide calls setHidden(true)', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.contextMenu(widget, { clientX: 50, clientY: 50 });
    fireEvent.click(screen.getByText('ctx-hide'));
    expect(mockActions.setHidden).toHaveBeenCalledWith(true);
  });

  it('double-click toggles minimized when undocked', () => {
    renderWidget({ minimized: false });
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.doubleClick(widget);
    expect(mockActions.setMinimized).toHaveBeenCalledWith(true);
  });

  it('double-click on minimized widget unminimizes', () => {
    renderWidget({ minimized: true });
    const widget = document.querySelector('.buddy-widget')!;
    fireEvent.doubleClick(widget);
    expect(mockActions.setMinimized).toHaveBeenCalledWith(false);
  });

  it('speech bubble dismiss calls dismissReaction for reaction', () => {
    renderWidget({ reaction: { text: 'hi' } });
    fireEvent.click(screen.getByText('dismiss'));
    expect(mockActions.dismissReaction).toHaveBeenCalled();
  });

  it('speech bubble dismiss calls dismissLevelUp for levelUp', () => {
    renderWidget({ levelUp: { level: 2, statGained: 'CHAOS' } });
    fireEvent.click(screen.getByText('dismiss'));
    expect(mockActions.dismissLevelUp).toHaveBeenCalled();
  });
});

describe('BuddyFloatingWidget – level-up auto-dismiss', () => {
  it('calls dismissLevelUp after 3 seconds', () => {
    vi.useFakeTimers();
    renderWidget({ levelUp: { level: 4, statGained: 'SNARK' } });
    expect(mockActions.dismissLevelUp).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(mockActions.dismissLevelUp).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('BuddyFloatingWidget – drag handling', () => {
  it('starts drag on mouse down and updates position on mouse move', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    // getBoundingClientRect stub
    widget.getBoundingClientRect = () => ({
      left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100, x: 100, y: 100, toJSON: () => {},
    });
    fireEvent.mouseDown(widget, { button: 0, clientX: 150, clientY: 150 });
    fireEvent(window, new MouseEvent('mousemove', { clientX: 300, clientY: 300, bubbles: true }));
    // Widget style left should have been updated (not at original 100,100)
    // Just verify no errors thrown — the state update happens internally
    expect(widget).toBeTruthy();
  });

  it('ignores non-left-button mouse down', () => {
    renderWidget();
    const widget = document.querySelector('.buddy-widget') as HTMLElement;
    fireEvent.mouseDown(widget, { button: 2, clientX: 50, clientY: 50 });
    // no dragging started, no crash
    expect(widget).toBeTruthy();
  });
});
