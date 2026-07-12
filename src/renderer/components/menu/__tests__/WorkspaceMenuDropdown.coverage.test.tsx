// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Comprehensive coverage tests for WorkspaceMenuDropdown.tsx
 * Supplements the existing WorkspaceMenuDropdown.test.tsx
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WithStore } from '@/atom';

const mockAdjust = vi.hoisted(() => vi.fn());
const mockGetPosition = vi.hoisted(() => vi.fn(() => ({ top: 100, left: 200 })));

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: mockAdjust,
  getAnchoredDropdownPosition: mockGetPosition,
  ANCHORED_DROPDOWN_SIZE_PRESETS: { workspaceMenu: { estimatedWidth: 200, estimatedHeight: 200 } },
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../ui/use-click-out', () => ({
  useClickOut: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  FolderOpen: () => <svg data-testid="folder-open-icon" />,
  File: () => <svg data-testid="file-icon" />,
  FolderPlus: () => <svg data-testid="folder-plus-icon" />,
  Clipboard: () => <svg data-testid="clipboard-icon" />,
  CloudDownload: () => <svg data-testid="cloud-download-icon" />,
  Copy: () => <svg data-testid="copy-icon" />,
}));

import { WorkspaceMenuAtom } from '../WorkspaceMenuDropdown';
import WorkspaceMenuDefault from '../WorkspaceMenuDropdown';

function makeActions(overrides = {}) {
  return {
    onOpenInExplorer: vi.fn(),
    onAddFiles: vi.fn(),
    onAddFolder: vi.fn(),
    onPasteToWorkspace: vi.fn(),
    canOpenInExplorer: false,
    canAddFiles: false,
    canAddFolder: false,
    canPasteToWorkspace: false,
    workspacePath: '',
    ...overrides,
  };
}

function wrap(ui: React.ReactElement) {
  return render(<WithStore>{ui}</WithStore>);
}

function openMenu(actions: any) {
  const Wrapper = () => {
    const { toggle } = WorkspaceMenuAtom.useChange();
    const btnRef = React.useRef<HTMLButtonElement>(null);
    React.useEffect(() => {
      if (btnRef.current) toggle(btnRef.current, actions);
    }, []);
    return (
      <>
        <button ref={btnRef}>trigger</button>
        <WorkspaceMenuDefault />
      </>
    );
  };
  return wrap(<Wrapper />);
}

describe('WorkspaceMenuDropdown', () => {
  let mockWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      writable: true,
      configurable: true,
      value: { writeText: mockWriteText },
    });
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { platform: 'darwin' },
    });
  });

  it('renders null when menu is closed', () => {
    const { container } = wrap(<WorkspaceMenuDefault />);
    expect(container.firstChild).toBeNull();
  });

  it('shows menu with role=menu when opened', async () => {
    openMenu(makeActions());
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  });

  it('calls onAddFiles when canAddFiles=true and button clicked', async () => {
    const actions = makeActions({ canAddFiles: true });
    openMenu(actions);
    await waitFor(() => screen.getByText('workspace.explorer.addFiles'));
    fireEvent.click(screen.getByText('workspace.explorer.addFiles'));
    expect(actions.onAddFiles).toHaveBeenCalled();
  });

  it('calls onAddFolder when canAddFolder=true and button clicked', async () => {
    const actions = makeActions({ canAddFolder: true });
    openMenu(actions);
    await waitFor(() => screen.getByText('workspace.explorer.addFolder'));
    fireEvent.click(screen.getByText('workspace.explorer.addFolder'));
    expect(actions.onAddFolder).toHaveBeenCalled();
  });

  it('calls onPasteToWorkspace when canPasteToWorkspace=true and button clicked', async () => {
    const actions = makeActions({ canPasteToWorkspace: true });
    openMenu(actions);
    await waitFor(() => screen.getByText('workspace.explorer.pasteText'));
    fireEvent.click(screen.getByText('workspace.explorer.pasteText'));
    expect(actions.onPasteToWorkspace).toHaveBeenCalled();
  });

  it('calls onOpenInExplorer when canOpenInExplorer=true and button clicked (macOS)', async () => {
    const actions = makeActions({ canOpenInExplorer: true });
    openMenu(actions);
    await waitFor(() => screen.getByText('workspace.menu.openInFinder'));
    fireEvent.click(screen.getByText('workspace.menu.openInFinder'));
    expect(actions.onOpenInExplorer).toHaveBeenCalled();
  });

  it('shows "Open in File Explorer" text on Windows', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { platform: 'win32' },
    });
    const actions = makeActions({ canOpenInExplorer: true });
    openMenu(actions);
    await waitFor(() => screen.getByText('workspace.menu.openInFileExplorer'));
    expect(screen.getByText('workspace.menu.openInFileExplorer')).toBeTruthy();
  });

  it('shows "Open in File Manager" text on Linux', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { platform: 'linux' },
    });
    const actions = makeActions({ canOpenInExplorer: true });
    openMenu(actions);
    await waitFor(() => screen.getByText('workspace.menu.openInFileManager'));
    expect(screen.getByText('workspace.menu.openInFileManager')).toBeTruthy();
  });

  it('shows copy path button when workspacePath is set', async () => {
    const actions = makeActions({ workspacePath: '/some/path' });
    openMenu(actions);
    await waitFor(() => screen.getByText('common.copyPath'));
    fireEvent.click(screen.getByText('common.copyPath'));
    expect(mockWriteText).toHaveBeenCalledWith('/some/path');
  });

  it('shows divider when both file actions and canOpenInExplorer are true', async () => {
    const actions = makeActions({ canAddFiles: true, canOpenInExplorer: true });
    openMenu(actions);
    await waitFor(() => screen.getByRole('menu'));
    const menu = screen.getByRole('menu');
    expect(menu.querySelector('.dropdown-menu-divider')).toBeTruthy();
  });

  it('does NOT show divider when only canOpenInExplorer=true without file actions', async () => {
    const actions = makeActions({ canOpenInExplorer: true });
    openMenu(actions);
    await waitFor(() => screen.getByRole('menu'));
    const menu = screen.getByRole('menu');
    expect(menu.querySelector('.dropdown-menu-divider')).toBeNull();
  });

  it('WorkspaceMenuAtom.close returns menu to closed state', async () => {
    const actions = makeActions();
    const Wrapper = () => {
      const { toggle, close } = WorkspaceMenuAtom.useChange();
      const [state] = WorkspaceMenuAtom.use();
      const btnRef = React.useRef<HTMLButtonElement>(null);
      return (
        <div>
          <button ref={btnRef} data-testid="open-btn" onClick={() => { if (btnRef.current) toggle(btnRef.current, actions); }}>
            open
          </button>
          <button data-testid="close-btn" onClick={close}>close</button>
          <span data-testid="state">{state.isOpen ? 'open' : 'closed'}</span>
          <WorkspaceMenuDefault />
        </div>
      );
    };
    wrap(<Wrapper />);
    expect(screen.getByTestId('state').textContent).toBe('closed');
    // Open
    await act(async () => {
      fireEvent.click(screen.getByTestId('open-btn'));
    });
    expect(screen.getByTestId('state').textContent).toBe('open');
    // Close
    await act(async () => {
      fireEvent.click(screen.getByTestId('close-btn'));
    });
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });
});
