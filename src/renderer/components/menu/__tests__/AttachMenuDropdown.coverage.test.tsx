/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';

vi.mock('../../../lib/screenshot/useScreenshotEnabled', () => ({
  useScreenshotEnabled: () => true,
}));
vi.mock('../../../lib/screenshot/useScreenshotHotkey', () => ({
  useScreenshotHotkey: () => 'Ctrl+Shift+S',
}));
vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  ANCHORED_DROPDOWN_SIZE_PRESETS: { attachMenu: { width: 200, height: 100 } },
  getAnchoredDropdownPosition: vi.fn(() => ({ top: 10, left: 20 })),
}));
vi.mock('../../ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));
vi.mock('@/atom', () => ({
  atom: (initial: any, create?: any) => {
    let state = initial;
    const listeners = new Set<() => void>();
    const get = () => state;
    const set = (val: any) => { state = val; listeners.forEach(l => l()); };
    const actions = create ? create(get, set) : {};
    return {
      use: () => [state, actions],
      useChange: () => actions,
    };
  },
}));

describe('AttachMenuDropdown', () => {
  it('module loads and AttachMenuAtom is exported', async () => {
    const mod = await import('../AttachMenuDropdown');
    expect(mod.AttachMenuAtom).toBeDefined();
  });

  it('default export renders null when closed', async () => {
    const mod = await import('../AttachMenuDropdown');
    const DefaultExport = mod.default;
    const { container } = render(<DefaultExport />);
    // When isOpen=false, renders null
    expect(container.firstChild).toBeNull();
  });
});
