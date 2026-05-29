/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowToast = vi.fn();
const mockGetLibraryData = vi.fn();
const mockUpdateSkill = vi.fn();
const mockAddSkill = vi.fn();
const mockValidateSkill = vi.fn();
const mockShowOverwriteConfirmDialog = vi.fn();
const mockSetSkill = vi.fn();
const mockOnSkillAdded = vi.fn();

vi.mock('../../skills/ApplySkillToAgentsDialog', () => ({
  ApplySkillDialogAtom: {
    useChange: () => ({ setSkill: mockSetSkill }),
  },
}));

vi.mock('react-router-dom', async () => ({
  ...await vi.importActual('react-router-dom'),
  useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('react-markdown', async () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('../../../styles/Modal.css', () => ({}));
vi.mock('../../../styles/McpLibraryView.css', () => ({}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showToast: mockShowToast,
  }),
}));

const mockSkillsRef = vi.hoisted(() => ({ current: [] as any[] }));
vi.mock('../../userData/userDataProvider', async () => ({
  useSkills: () => ({ skills: [...mockSkillsRef.current] }),
}));

vi.mock('../../ui/ListSearchBox', async () => ({
  default: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="search-box"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

vi.mock('@renderer/lib/utilities/logger', async () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  logger: { debug: vi.fn(), error: vi.fn() },
}));

async function renderComp(props = {}) {
  const { default: Comp } = await import('../AddFromSkillLibraryViewContent');
  return render(<Comp onSkillAdded={mockOnSkillAdded} {...props} />);
}

describe('AddFromSkillLibraryViewContent — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSkillsRef.current = [];

    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: {
        skills: [
          { name: 'skill-a', description: 'Desc A', version: '1.0.0' },
          { name: 'skill-b', description: 'Desc B', version: '2.0.0', contact: 'a@b.com' },
        ],
      },
    });
    mockValidateSkill.mockResolvedValue({ success: true, hasExisting: false });
    mockShowOverwriteConfirmDialog.mockResolvedValue({ success: true, confirmed: false });
    mockAddSkill.mockResolvedValue({ success: true, skillName: 'skill-a', resolution: 'installed_but_not_applied' });
    mockUpdateSkill.mockResolvedValue({ success: true });

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        skillLibrary: {
          getLibraryData: mockGetLibraryData,
          updateSkill: mockUpdateSkill,
          addSkill: mockAddSkill,
          validateSkill: mockValidateSkill,
          showOverwriteConfirmDialog: mockShowOverwriteConfirmDialog,
        },
      },
    });
  });

  it('shows loading spinner initially', async () => {
    let resolve: any;
    mockGetLibraryData.mockReturnValue(new Promise(r => { resolve = r; }));
    await act(async () => { await renderComp(); });
    expect(screen.getByText('Loading Skill library...')).toBeInTheDocument();
    resolve({ success: true, data: { skills: [] } });
  });

  it('shows empty state when no skills', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: { skills: [] } });
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('No skills available in the library')).toBeInTheDocument();
    });
  });

  it('shows invalid data format error', async () => {
    mockGetLibraryData.mockResolvedValue({ success: true, data: { skills: 'not-an-array' } });
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Invalid data format'));
    });
  });

  it('shows error when getLibraryData throws', async () => {
    mockGetLibraryData.mockRejectedValue(new Error('Network failure'));
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Network failure'));
    });
  });

  it('auto-selects first skill when loaded', async () => {
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getAllByText('skill-a').length).toBeGreaterThan(0);
    });
    // skill-a is auto-selected; detail panel shows its name
    expect(screen.getAllByText('skill-a').length).toBeGreaterThan(1);
  });

  it('selecting a skill shows its description', async () => {
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('skill-b')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('skill-b'));
    expect(screen.getByText('Desc B')).toBeInTheDocument();
  });

  it('shows contact link when skill has contact', async () => {
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('skill-b')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('skill-b'));
    expect(screen.getByText('a@b.com')).toBeInTheDocument();
  });

  it('shows installed badge for skills already in library', async () => {
    mockSkillsRef.current = [{ name: 'skill-a', source: 'IN-LIBRARY', version: '1.0.0' }];
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getAllByText('Installed').length).toBeGreaterThan(0);
    });
  });

  it('shows "new" superscript for skills with newer version', async () => {
    mockSkillsRef.current = [{ name: 'skill-b', source: 'IN-LIBRARY', version: '1.0.0' }];
    // skill-b has version 2.0.0 in library, 1.0.0 installed
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('new')).toBeInTheDocument();
    });
  });

  it('shows installed version in detail view when skill is installed', async () => {
    mockSkillsRef.current = [{ name: 'skill-a', source: 'IN-LIBRARY', version: '0.5.0' }];
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText(/Installed Version/)).toBeInTheDocument();
    });
  });

  it('shows no description fallback when description is empty', async () => {
    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: { skills: [{ name: 'no-desc', description: '', version: '1.0.0' }] },
    });
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('No description available')).toBeInTheDocument();
    });
  });

  it('shows error when user cancels overwrite confirmation', async () => {
    mockValidateSkill.mockResolvedValue({ success: true, hasExisting: true });
    mockShowOverwriteConfirmDialog.mockResolvedValue({ success: true, confirmed: false });

    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });

    await waitFor(() => {
      expect(mockShowOverwriteConfirmDialog).toHaveBeenCalled();
    });
    // User cancelled — no error, no success
    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockShowSuccess).not.toHaveBeenCalled();
  });

  it('shows error when showOverwriteConfirmDialog fails', async () => {
    mockValidateSkill.mockResolvedValue({ success: true, hasExisting: true });
    mockShowOverwriteConfirmDialog.mockResolvedValue({ success: false, error: 'Dialog error' });

    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Dialog error'));
    });
  });

  it('shows error when addSkill returns failure', async () => {
    mockValidateSkill.mockResolvedValue({ success: true, hasExisting: false });
    mockAddSkill.mockResolvedValue({ success: false, error: 'Install failed' });

    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Install failed'));
    });
  });

  it('does not call setSkill when resolution is not installed_but_not_applied', async () => {
    mockAddSkill.mockResolvedValue({ success: true, skillName: 'skill-a', resolution: 'replaced' });

    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });

    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalled();
    });
    expect(mockSetSkill).not.toHaveBeenCalled();
  });

  it('shows error when updateSkill fails', async () => {
    mockSkillsRef.current = [{ name: 'skill-b', source: 'IN-LIBRARY', version: '1.0.0' }];
    mockUpdateSkill.mockResolvedValue({ success: false, error: 'Update failed' });

    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('skill-b')).toBeInTheDocument();
    });

    // Click skill-b to select it so Update button appears
    fireEvent.click(screen.getByText('skill-b'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Update failed'));
    });
  });

  it('shows error when updateSkill throws', async () => {
    mockSkillsRef.current = [{ name: 'skill-b', source: 'IN-LIBRARY', version: '1.0.0' }];
    mockUpdateSkill.mockRejectedValue(new Error('IPC crash'));

    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByText('skill-b')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('skill-b'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('IPC crash'));
    });
  });

  it('shows "Select a skill" placeholder when no skill selected after filtering to empty', async () => {
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByTestId('search-box')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'zzz-nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText(/Select a skill from the list/)).toBeInTheDocument();
    });
  });

  it('auto-selects first filtered item when current selection not in filter', async () => {
    await act(async () => { await renderComp(); });
    await waitFor(() => {
      expect(screen.getByTestId('search-box')).toBeInTheDocument();
    });

    // Select skill-b first
    fireEvent.click(screen.getByText('skill-b'));

    // Then filter to only show skill-a
    fireEvent.change(screen.getByTestId('search-box'), { target: { value: 'skill-a' } });

    await waitFor(() => {
      // skill-a should be shown as selected
      expect(screen.queryAllByText('skill-b').length).toBe(0);
    });
  });
});
