/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  featureEnabled: true,
  isHatchingCeremony: false,
  buddyState: {
    companion: null as any,
    showMainPanel: false,
    roster: [] as any[],
  },
}));

const actions = vi.hoisted(() => ({
  hatch: vi.fn(),
  setShowMainPanel: vi.fn(),
}));

const mockSetIsHatchingCeremony = vi.hoisted(() => vi.fn());

vi.mock('@/lib/featureFlags', () => ({
  useFeatureFlag: () => state.featureEnabled,
}));

vi.mock('../useBuddyIPC', () => ({
  useBuddyIPC: () => ({
    state: state.buddyState,
    actions,
  }),
}));

vi.mock('../buddy.atom', () => ({
  BuddyAtom: {
    use: () => [state.buddyState, actions],
  },
  HatchingCeremonyAtom: {
    use: () => [state.isHatchingCeremony, mockSetIsHatchingCeremony],
    useChange: () => mockSetIsHatchingCeremony,
  },
}));

vi.mock('../HatchingCeremony', () => ({
  HatchingCeremony: ({ onComplete }: { onComplete: () => void }) => (
    <button onClick={onComplete}>complete ceremony</button>
  ),
}));

vi.mock('../BuddyMainPanel', () => ({
  BuddyMainPanel: ({
    onHatchNew,
    onClose,
  }: {
    onHatchNew: () => Promise<void>;
    onClose: () => void;
  }) => (
    <div data-testid="buddy-main-panel">
      <button onClick={onHatchNew}>hatch new</button>
      <button onClick={onClose}>close panel</button>
    </div>
  ),
}));

vi.mock('../BuddyFloatingWidget', () => ({
  BuddyFloatingWidget: () => <div data-testid="buddy-floating-widget" />,
}));

vi.mock('../../../lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import Buddy, { BuddyEntryButton } from '../index';

describe('Buddy entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.featureEnabled = true;
    state.isHatchingCeremony = false;
    state.buddyState = {
      companion: null,
      showMainPanel: false,
      roster: [],
    };
    actions.hatch.mockResolvedValue({ id: 'buddy-1' });
  });

  it('does not render when the buddy feature flag is disabled', () => {
    state.featureEnabled = false;

    const { container } = render(<Buddy />);

    expect(container.textContent).toBe('');
  });

  it('renders the floating widget when enabled and not hatching', () => {
    render(<Buddy />);

    expect(screen.getByTestId('buddy-floating-widget')).toBeTruthy();
  });

  it('completes the hatching ceremony by returning to the main panel', () => {
    state.isHatchingCeremony = true;
    state.buddyState.companion = { id: 'buddy-1' };

    render(<Buddy />);
    fireEvent.click(screen.getByText('complete ceremony'));

    expect(mockSetIsHatchingCeremony).toHaveBeenCalledWith(false);
    expect(actions.setShowMainPanel).toHaveBeenCalledWith(true);
  });

  it('opens and closes the main panel and starts a new hatching ceremony', async () => {
    state.buddyState.showMainPanel = true;

    render(<Buddy />);
    fireEvent.click(screen.getByText('hatch new'));

    await waitFor(() => {
      expect(actions.setShowMainPanel).toHaveBeenCalledWith(false);
    });
    expect(mockSetIsHatchingCeremony).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText('close panel'));
    expect(actions.setShowMainPanel).toHaveBeenCalledWith(false);
  });

  it('hatches the first buddy from the entry button when no roster exists', async () => {
    render(<BuddyEntryButton />);

    fireEvent.click(screen.getByRole('button', { name: 'buddy.hatchFirstBuddyAria' }));

    await waitFor(() => {
      expect(actions.hatch).toHaveBeenCalledOnce();
    });
    expect(mockSetIsHatchingCeremony).toHaveBeenCalledWith(true);
  });

  it('opens the backpack from the entry button when a roster exists', () => {
    state.buddyState.roster = [{ id: 'buddy-1' }];
    state.buddyState.companion = { rarity: 'rare' };

    render(<BuddyEntryButton />);

    fireEvent.click(screen.getByRole('button', { name: 'buddy.openBackpackAria' }));

    expect(actions.setShowMainPanel).toHaveBeenCalledWith(true);
  });

  it('does not enter ceremony when first hatch is cancelled', async () => {
    actions.hatch.mockResolvedValueOnce(null);

    render(<BuddyEntryButton />);
    fireEvent.click(screen.getByRole('button', { name: 'buddy.hatchFirstBuddyAria' }));

    await waitFor(() => {
      expect(actions.hatch).toHaveBeenCalledOnce();
    });
    expect(mockSetIsHatchingCeremony).not.toHaveBeenCalled();
  });
});
