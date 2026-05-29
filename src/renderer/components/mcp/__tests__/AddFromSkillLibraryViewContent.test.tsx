/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AddFromSkillLibraryViewContent from '../AddFromSkillLibraryViewContent';

const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowToast = vi.fn();
const mockOnSkillAdded = vi.fn();
const mockGetLibraryData = vi.fn();
const mockUpdateSkill = vi.fn();
const mockAddSkill = vi.fn();
const mockValidateSkill = vi.fn();
const mockShowOverwriteConfirmDialog = vi.fn();
const mockSetSkill = vi.fn();

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
  default: function MockReactMarkdown(props: { children: React.ReactNode }) {
    return <>{props.children}</>;
  },
}));

vi.mock('remark-gfm', () => ({ default: vi.fn() }));

vi.mock('../../../styles/Modal.css', async () => ({}));
vi.mock('../../../styles/McpLibraryView.css', async () => ({}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showToast: mockShowToast,
  }),
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useSkills: () => ({
    skills: [
      {
        name: 'pdf',
        version: '1.0.0',
        source: 'IN-LIBRARY',
      },
    ],
  }),
}));

describe('AddFromSkillLibraryViewContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGetLibraryData.mockResolvedValue({
      success: true,
      data: {
        skills: [
          {
            name: 'pdf',
            description: 'PDF skill',
            version: '2.0.0',
          },
        ],
      },
    });
    mockUpdateSkill.mockResolvedValue({ success: true });
    mockAddSkill.mockResolvedValue({
      success: true,
      skillName: 'web-search',
      resolution: 'installed_but_not_applied',
    });
    mockValidateSkill.mockResolvedValue({ success: true, hasExisting: false });
    mockShowOverwriteConfirmDialog.mockResolvedValue({ success: true, confirmed: true });

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

  it('does not dispatch apply-to-agents after a successful library update', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getAllByText('pdf').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(mockUpdateSkill).toHaveBeenCalledWith('pdf');
      expect(mockShowSuccess).toHaveBeenCalledWith('Skill "pdf" updated successfully!');
      expect(mockOnSkillAdded).toHaveBeenCalledWith(1);
    });

    expect(dispatchEventSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'skills:applyToAgents',
      }),
    );

    dispatchEventSpy.mockRestore();
  });

  it('opens apply-to-agents dialog after a successful fresh library install from settings', async () => {
    mockGetLibraryData.mockResolvedValueOnce({
      success: true,
      data: {
        skills: [
          {
            name: 'web-search',
            description: 'Web search skill',
            version: '1.0.0',
          },
        ],
      },
    });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getAllByText('web-search').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(mockAddSkill).toHaveBeenCalledWith('web-search', {
        overwrite: false,
        requestSource: 'skill-library',
      });
      expect(mockShowSuccess).toHaveBeenCalledWith('Skill "web-search" added successfully!');
    });

    expect(mockSetSkill).toHaveBeenCalledWith('web-search');
  });

  it('shows error state when library data load fails', async () => {
    mockGetLibraryData.mockResolvedValueOnce({ success: false, error: 'Network timeout' });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getByText(/Network timeout/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
  });

  it('retries loading library data on Retry button click', async () => {
    mockGetLibraryData
      .mockResolvedValueOnce({ success: false, error: 'Network timeout' })
      .mockResolvedValueOnce({
        success: true,
        data: { skills: [{ name: 'web-search', description: 'Search', version: '1.0.0' }] },
      });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getAllByText('web-search').length).toBeGreaterThan(0);
    });

    expect(mockGetLibraryData).toHaveBeenCalledTimes(2);
  });

  it('shows error when validation fails', async () => {
    // Reset validateSkill to clear any queued Once values from earlier tests
    mockValidateSkill.mockReset();
    mockValidateSkill.mockResolvedValue({ success: false, error: 'Skill is not compliant' });

    mockGetLibraryData.mockResolvedValueOnce({
      success: true,
      data: { skills: [{ name: 'bad-skill', description: 'Desc', version: '1.0.0' }] },
    });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getAllByText('bad-skill').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(mockValidateSkill).toHaveBeenCalledWith('bad-skill');
      expect(mockShowToast).toHaveBeenCalledWith(
        'Skill is not compliant',
        'error',
        0,
        { persistent: true }
      );
    });
  });

  it('handles overwrite flow when existing skill is found', async () => {
    mockGetLibraryData.mockResolvedValueOnce({
      success: true,
      data: { skills: [{ name: 'pdf', description: 'PDF skill', version: '3.0.0' }] },
    });
    mockValidateSkill.mockResolvedValueOnce({ success: true, hasExisting: true });
    mockShowOverwriteConfirmDialog.mockResolvedValueOnce({ success: true, confirmed: true });
    mockAddSkill.mockResolvedValueOnce({
      success: true,
      skillName: 'pdf',
      resolution: 'overwritten',
    });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    // The pdf skill with version 3.0.0 has a newer version than installed 1.0.0
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument();
    });

    // Click Install on the 'pdf' skill (it appears as Update since hasNewerVersion)
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(mockUpdateSkill).toHaveBeenCalledWith('pdf');
    });
  });

  it('shows error when addSkill throws an exception during installation', async () => {
    // Reset to ensure no queued Once values from previous tests
    mockValidateSkill.mockReset();
    mockAddSkill.mockReset();
    mockValidateSkill.mockResolvedValue({ success: true, hasExisting: false });
    mockAddSkill.mockRejectedValue(new Error('Install crash'));

    mockGetLibraryData.mockResolvedValueOnce({
      success: true,
      data: { skills: [{ name: 'other-skill', description: 'Other', version: '1.0.0' }] },
    });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getAllByText('other-skill').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Install crash'));
    });
  });

  it('filters skills list based on search query', async () => {
    mockGetLibraryData.mockResolvedValueOnce({
      success: true,
      data: {
        skills: [
          { name: 'pdf-reader', description: 'Read PDFs', version: '1.0.0' },
          { name: 'web-search', description: 'Search web', version: '1.0.0' },
        ],
      },
    });

    render(<AddFromSkillLibraryViewContent onSkillAdded={mockOnSkillAdded} />);

    await waitFor(() => {
      expect(screen.getAllByText('pdf-reader').length).toBeGreaterThan(0);
      expect(screen.getAllByText('web-search').length).toBeGreaterThan(0);
    });

    const searchBox = screen.getByPlaceholderText('Search skills...');
    fireEvent.change(searchBox, { target: { value: 'pdf' } });

    await waitFor(() => {
      expect(screen.queryAllByText('web-search').length).toBe(0);
    });
    expect(screen.getAllByText('pdf-reader').length).toBeGreaterThan(0);
  });
});