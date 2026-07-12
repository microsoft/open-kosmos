// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Comprehensive coverage tests for AttachMenuDropdown.tsx
 * This supplements the minimal existing coverage test.
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────
const mockAdjustAnchored = vi.hoisted(() => vi.fn());
const mockGetPosition = vi.hoisted(() => vi.fn(() => ({ top: 100, left: 200 })));
const mockScreenshotEnabled = vi.hoisted(() => ({ value: true }));
const mockScreenshotHotkey = vi.hoisted(() => ({ value: 'Ctrl+Shift+S' }));

// Simulate open/close atom state
const atomState = vi.hoisted(() => ({ isOpen: false, position: null as any }));
const mockClose = vi.hoisted(() => vi.fn(() => { atomState.isOpen = false; atomState.position = null; }));
const mockToggle = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/screenshot/useScreenshotEnabled', () => ({
  useScreenshotEnabled: () => mockScreenshotEnabled.value,
}));
vi.mock('../../../lib/screenshot/useScreenshotHotkey', () => ({
  useScreenshotHotkey: () => mockScreenshotHotkey.value,
}));
vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: mockAdjustAnchored,
  ANCHORED_DROPDOWN_SIZE_PRESETS: { attachMenu: { estimatedWidth: 200, estimatedHeight: 150 } },
  getAnchoredDropdownPosition: mockGetPosition,
}));
vi.mock('../../ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));
vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Mock @/atom so we can control open state
vi.mock('@/atom', () => ({
  atom: (_initial: any, create?: any) => {
    const get = () => atomState;
    const set = (val: any) => { Object.assign(atomState, val); };
    const actions = create ? create(get, set) : {};
    // Store actions on our mocks so we can control them
    if (actions.close) mockClose.mockImplementation(actions.close);
    if (actions.toggle) mockToggle.mockImplementation(actions.toggle);
    return {
      use: () => [atomState, actions],
      useChange: () => actions,
    };
  },
}));

vi.mock('lucide-react', () => ({
  Camera: (props: any) => <svg data-testid="camera-icon" className={props.className} />,
}));

// We need to lazy import after the atom is set up
let AttachMenuDropdownModule: any;

describe('AttachMenuDropdown (inner component via open state)', () => {
  const position = { top: 100, left: 200 };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockScreenshotEnabled.value = true;
    mockScreenshotHotkey.value = 'Ctrl+Shift+S';
    // Reset to closed state
    atomState.isOpen = false;
    atomState.position = null;
    // Dynamically import after mocks are set
    AttachMenuDropdownModule = await import('../AttachMenuDropdown');
  });

  it('renders null when atom is closed', () => {
    const DefaultExport = AttachMenuDropdownModule.default;
    const { container } = render(<DefaultExport />);
    expect(container.firstChild).toBeNull();
  });

  it('renders dropdown content when atom is open', () => {
    atomState.isOpen = true;
    atomState.position = position;
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('shows "Add Files and Images" button when open', () => {
    atomState.isOpen = true;
    atomState.position = position;
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    expect(screen.getByText('chat.attachments.addFilesAndImages')).toBeTruthy();
  });

  it('shows screenshot button when enableScreenshot=true', () => {
    atomState.isOpen = true;
    atomState.position = position;
    mockScreenshotEnabled.value = true;
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    expect(screen.getByText('chat.attachments.addScreenshot')).toBeTruthy();
  });

  it('hides screenshot button when enableScreenshot=false', () => {
    atomState.isOpen = true;
    atomState.position = position;
    mockScreenshotEnabled.value = false;
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    expect(screen.queryByText('chat.attachments.addScreenshot')).toBeNull();
  });

  it('dispatches chatInput:selectFiles event when files button clicked', () => {
    atomState.isOpen = true;
    atomState.position = position;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    fireEvent.click(screen.getByText('chat.attachments.addFilesAndImages'));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chatInput:selectFiles' }),
    );
    dispatchSpy.mockRestore();
  });

  it('dispatches chatInput:screenshot event when screenshot button clicked', () => {
    atomState.isOpen = true;
    atomState.position = position;
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    fireEvent.click(screen.getByText('chat.attachments.addScreenshot'));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chatInput:screenshot' }),
    );
    dispatchSpy.mockRestore();
  });

  it('shows hotkey label when screenshotHotkey is provided', () => {
    atomState.isOpen = true;
    atomState.position = position;
    mockScreenshotHotkey.value = 'Cmd+Shift+X';
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    expect(screen.getByText('(Cmd+Shift+X)')).toBeTruthy();
  });

  it('does not show hotkey label when screenshotHotkey is null', () => {
    atomState.isOpen = true;
    atomState.position = position;
    mockScreenshotHotkey.value = null;
    const DefaultExport = AttachMenuDropdownModule.default;
    render(<DefaultExport />);
    // Hotkey span should not be in the DOM
    const dropdownText = document.body.textContent || '';
    expect(dropdownText).not.toContain('(null)');
  });

  it('AttachMenuAtom is exported', () => {
    expect(AttachMenuDropdownModule.AttachMenuAtom).toBeDefined();
  });
});
