// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WithStore } from '@/atom';

const mockAdjustAnchoredDropdownToViewport = vi.hoisted(() => vi.fn());
const mockGetAnchoredDropdownPosition = vi.hoisted(() => vi.fn(() => ({ top: 32, left: 48 })));
const mockUseScreenshotEnabled = vi.hoisted(() => ({ value: true }));
const mockUseScreenshotHotkey = vi.hoisted(() => ({ value: 'Cmd+Shift+S' }));

vi.mock('../../../lib/screenshot/useScreenshotEnabled', () => ({
  useScreenshotEnabled: () => mockUseScreenshotEnabled.value,
}));

vi.mock('../../../lib/screenshot/useScreenshotHotkey', () => ({
  useScreenshotHotkey: () => mockUseScreenshotHotkey.value,
}));

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: mockAdjustAnchoredDropdownToViewport,
  ANCHORED_DROPDOWN_SIZE_PRESETS: { attachMenu: { estimatedWidth: 200, estimatedHeight: 120 } },
  getAnchoredDropdownPosition: mockGetAnchoredDropdownPosition,
}));

vi.mock('../../ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}));

import AttachMenuDropdown, { AttachMenuAtom } from '../AttachMenuDropdown';

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function ToggleHarness() {
  const actions = AttachMenuAtom.useChange();

  return (
    <button
      data-testid="toggle"
      onClick={(event) => actions.toggle(event.currentTarget)}
      type="button"
    >
      toggle
    </button>
  );
}

describe('AttachMenuDropdown supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseScreenshotEnabled.value = true;
    mockUseScreenshotHotkey.value = 'Cmd+Shift+S';
  });

  it('closes the atom state when toggle is called while already open', () => {
    wrap(
      <>
        <ToggleHarness />
        <AttachMenuDropdown />
      </>,
    );

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('toggle'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
