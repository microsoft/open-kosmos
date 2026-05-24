/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { WithStore } from '@/atom';

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
  getAnchoredDropdownPosition: vi.fn().mockReturnValue({ top: 100, left: 100 }),
  ANCHORED_DROPDOWN_SIZE_PRESETS: { workspaceMenu: { estimatedWidth: 200, estimatedHeight: 200 } },
}));

describe('WorkspaceMenuDropdown', () => {
  let mockWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('copies workspace path to clipboard when "Copy Path" is clicked', async () => {
    const { default: WorkspaceMenuDropdown, WorkspaceMenuAtom } = await import('../WorkspaceMenuDropdown');

    const mockActions = {
      onOpenInExplorer: vi.fn(),
      onAddFiles: vi.fn(),
      onAddFolder: vi.fn(),
      onPasteToWorkspace: vi.fn(),
      canOpenInExplorer: true,
      canAddFiles: false,
      canAddFolder: false,
      canPasteToWorkspace: false,
      workspacePath: '/Users/test/workspace',
    };

    const Wrapper = () => {
      const { toggle } = WorkspaceMenuAtom.useChange();
      const btnRef = React.useRef<HTMLButtonElement>(null);

      React.useEffect(() => {
        if (btnRef.current) {
          toggle(btnRef.current, mockActions);
        }
      }, []);

      return (
        <>
          <button ref={btnRef}>trigger</button>
          <WorkspaceMenuDropdown />
        </>
      );
    };

    render(<WithStore><Wrapper /></WithStore>);

    const copyBtn = screen.getByText('Copy Path');
    expect(copyBtn).toBeInTheDocument();

    fireEvent.click(copyBtn);
    expect(mockWriteText).toHaveBeenCalledWith('/Users/test/workspace');
  });
});
