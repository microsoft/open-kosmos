// @ts-nocheck
/** @vitest-environment happy-dom */

import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowToast = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showToast: mockShowToast,
  }),
}));

const mockSkills = vi.fn(() => [{ name: 'pdf', source: 'ON-DEVICE', version: '1.0.0' }]);

vi.mock('../../userData/userDataProvider', async () => ({
  useProfileDataRefresh: () => ({ refresh: mockRefresh }),
  useSkills: () => ({ skills: mockSkills() }),
}));

vi.mock('../../../../shared/constants/builtinSkills', async () => ({
  isBuiltinSkill: (name: string) => name === 'builtin-skill',
}));

vi.mock('lucide-react', async () => ({
  FolderOpen: () => <span data-testid="icon-folder-open" />,
  Trash2: () => <span data-testid="icon-trash2" />,
  RefreshCw: () => <span data-testid="icon-refresh-cw" />,
}));

async function importComp() {
  const mod = await import('../SkillDropdownMenu');
  return mod.default;
}

const defaultPosition = { top: 0, left: 0, triggerTop: 0, triggerRight: 0 };

describe('SkillDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSkills.mockReturnValue([{ name: 'pdf', source: 'ON-DEVICE', version: '1.0.0' }]);

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        isDev: vi.fn().mockResolvedValue(false),
        platform: 'darwin',
        skillLibrary: {
          updateSkillFromDevice: vi.fn().mockResolvedValue({ success: true, skillName: 'pdf' }),
        },
        skills: {
          openSkillFolder: vi.fn().mockResolvedValue({ success: true }),
        },
      },
    });
  });

  it('returns null for plugin skills', async () => {
    mockSkills.mockReturnValue([{ name: 'plugin--foo', source: 'PLUGIN' }]);
    const SkillDropdownMenu = await importComp();
    const { container } = render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="plugin--foo"
        position={defaultPosition}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null for skills with plugin-- prefix', async () => {
    mockSkills.mockReturnValue([]);
    const SkillDropdownMenu = await importComp();
    const { container } = render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="plugin--myskill"
        position={defaultPosition}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not show Delete button for builtin skills', async () => {
    mockSkills.mockReturnValue([{ name: 'builtin-skill', source: 'SOME_SOURCE' }]);
    const SkillDropdownMenu = await importComp();
    render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="builtin-skill"
        position={defaultPosition}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows Delete button for non-builtin skills', async () => {
    const SkillDropdownMenu = await importComp();
    render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="pdf"
        position={defaultPosition}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows Update from Device only for ON-DEVICE source', async () => {
    const SkillDropdownMenu = await importComp();
    render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="pdf"
        position={defaultPosition}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Update from Device...')).toBeInTheDocument();
  });

  it('does not show Update from Device for IN-LIBRARY source', async () => {
    mockSkills.mockReturnValue([{ name: 'web', source: 'IN-LIBRARY' }]);
    const SkillDropdownMenu = await importComp();
    render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="web"
        position={defaultPosition}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText('Update from Device...')).not.toBeInTheDocument();
  });

  it('dispatches skill:delete event and calls onClose when Delete is clicked', async () => {
    const onClose = vi.fn();
    const SkillDropdownMenu = await importComp();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <SkillDropdownMenu
        skillMenuRef={createRef<HTMLDivElement>()}
        skillName="pdf"
        position={defaultPosition}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByText('Delete'));

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'skill:delete' }),
    );
    expect(onClose).toHaveBeenCalled();
    dispatchSpy.mockRestore();
  });

  it('shows success toast and refreshes on successful update', async () => {
    const onClose = vi.fn();
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={onClose}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Update from Device...'));
    });

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('pdf'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error when updateSkillFromDevice API is not available', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: { isDev: vi.fn().mockResolvedValue(false), platform: 'darwin', skillLibrary: {}, skills: {} },
    });
    const onClose = vi.fn();
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={onClose}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Update from Device...'));
    });

    expect(mockShowError).toHaveBeenCalledWith('Update skill from device API not available');
  });

  it('shows no toast when user cancels file selection', async () => {
    (window.electronAPI.skillLibrary.updateSkillFromDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false, error: 'File selection canceled',
    });
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Update from Device...'));
    });

    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('shows persistent toast on validation error from updateSkillFromDevice', async () => {
    (window.electronAPI.skillLibrary.updateSkillFromDevice as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false, error: 'Validation failed: bad schema',
    });
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Update from Device...'));
    });

    expect(mockShowToast).toHaveBeenCalledWith(
      'Validation failed: bad schema',
      'error',
      undefined,
      { persistent: true },
    );
  });

  it('shows error when updateSkillFromDevice throws', async () => {
    (window.electronAPI.skillLibrary.updateSkillFromDevice as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error'),
    );
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Update from Device...'));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });

  it('shows Open in Finder in dev mode on mac', async () => {
    (window.electronAPI.isDev as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    expect(screen.getByText('Open in Finder')).toBeInTheDocument();
  });

  it('shows Open in File Explorer on Windows', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: {
        isDev: vi.fn().mockResolvedValue(true),
        platform: 'win32',
        skillLibrary: { updateSkillFromDevice: vi.fn().mockResolvedValue({ success: true, skillName: 'pdf' }) },
        skills: { openSkillFolder: vi.fn().mockResolvedValue({ success: true }) },
      },
    });
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    expect(screen.getByText('Open in File Explorer')).toBeInTheDocument();
  });

  it('shows Open in File Manager on Linux', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: {
        isDev: vi.fn().mockResolvedValue(true),
        platform: 'linux',
        skillLibrary: { updateSkillFromDevice: vi.fn().mockResolvedValue({ success: true, skillName: 'pdf' }) },
        skills: { openSkillFolder: vi.fn().mockResolvedValue({ success: true }) },
      },
    });
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    expect(screen.getByText('Open in File Manager')).toBeInTheDocument();
  });

  it('opens skill folder via IPC on Open in Finder click', async () => {
    (window.electronAPI.isDev as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const onClose = vi.fn();
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={onClose}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder'));
    });

    expect(window.electronAPI.skills.openSkillFolder).toHaveBeenCalledWith('pdf');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error when openSkillFolder API not available', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true, configurable: true,
      value: {
        isDev: vi.fn().mockResolvedValue(true),
        platform: 'darwin',
        skillLibrary: { updateSkillFromDevice: vi.fn() },
        skills: {},
      },
    });
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder'));
    });

    expect(mockShowError).toHaveBeenCalledWith('Open folder API not available');
  });

  it('shows error when openSkillFolder returns failure', async () => {
    (window.electronAPI.isDev as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (window.electronAPI.skills.openSkillFolder as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false, error: 'Folder not found',
    });
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder'));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Folder not found'));
  });

  it('shows error when openSkillFolder throws', async () => {
    (window.electronAPI.isDev as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (window.electronAPI.skills.openSkillFolder as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('IPC crash'),
    );
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Open in Finder'));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('IPC crash'));
  });

  it('does not show Open in Explorer in non-dev mode', async () => {
    (window.electronAPI.isDev as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const SkillDropdownMenu = await importComp();

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={defaultPosition}
          onClose={vi.fn()}
        />,
      );
    });

    expect(screen.queryByText('Open in Finder')).not.toBeInTheDocument();
  });
});
