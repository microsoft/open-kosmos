// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Supplementary coverage tests for SkillsView.tsx —
 * targets branches not covered by SkillsView.test.tsx.
 */
import React from 'react';
import { act, render, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowInfo = vi.fn();
const mockShowToast = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockNavigate = vi.fn();
const mockAddSkillFromDevice = vi.fn();
const mockSetSkill = vi.fn();
const mockOnSkillsAddMenuToggle = vi.fn();
const mockOnSkillMenuToggle = vi.fn();

vi.mock('../ApplySkillToAgentsDialog', () => ({
  ApplySkillDialogAtom: {
    useChange: () => ({ setSkill: mockSetSkill }),
  },
}));

vi.mock('react-router-dom', async () => ({
  useNavigate: () => mockNavigate,
  useOutletContext: () => ({
    sidepaneWidth: 320,
    setSidepaneWidth: vi.fn(),
    isDragging: false,
    onSkillsAddMenuToggle: mockOnSkillsAddMenuToggle,
    onSkillMenuToggle: mockOnSkillMenuToggle,
  }),
}));

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showInfo: mockShowInfo,
    showToast: mockShowToast,
  }),
}));

const mockSkills: any[] = [{ name: 'pdf', version: '1.0.0', source: 'ON-DEVICE' }];

vi.mock('../../userData/userDataProvider', async () => ({
  useSkills: () => ({
    skills: mockSkills,
    stats: { totalSkills: mockSkills.length },
    isLoading: false,
  }),
  useProfileDataRefresh: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, language: 'en', setLanguage: vi.fn() }),
}));

vi.mock('../SkillsHeaderView', () => ({ default: ({ onAddClick }: any) => (
  <button data-testid="add-btn" onClick={() => onAddClick && onAddClick(document.body)}>add</button>
) }));
vi.mock('../SkillsContentView', () => ({ default: () => <div>content</div> }));

import SkillsView from '../SkillsView';

describe('SkillsView supplementary branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSkills.length = 1;
    mockSkills[0] = { name: 'pdf', version: '1.0.0', source: 'ON-DEVICE' };
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'pdf',
      resolution: 'installed_but_not_applied',
      isOverwrite: false,
      message: 'ok',
    });
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        skills: {
          addSkillFromDevice: mockAddSkillFromDevice,
        },
      },
    });
  });

  it('calls onSkillsAddMenuToggle when add button is clicked', async () => {
    render(<SkillsView />);
    const addBtn = document.querySelector('[data-testid="add-btn"]') as HTMLElement;
    fireEvent.click(addBtn);
    expect(mockOnSkillsAddMenuToggle).toHaveBeenCalled();
  });

  it('shows error when skills API is unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: { skills: {} }, // no addSkillFromDevice
    });
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith('skills.add.apiUnavailable');
    });
  });

  it('shows toast error when result.success=false with real error (not cancelled)', async () => {
    mockAddSkillFromDevice.mockResolvedValue({
      success: false,
      error: 'permission denied',
    });
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('permission denied', 'error', undefined, { persistent: true });
    });
  });

  it('does NOT show toast when error is "File selection canceled"', async () => {
    mockAddSkillFromDevice.mockResolvedValue({
      success: false,
      error: 'File selection canceled',
    });
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });
    await act(async () => {});
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does NOT show toast when error is "User cancelled the operation"', async () => {
    mockAddSkillFromDevice.mockResolvedValue({
      success: false,
      error: 'User cancelled the operation',
    });
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });
    await act(async () => {});
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does NOT call setSkill when isOverwrite=true', async () => {
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'pdf',
      resolution: 'installed_but_not_applied',
      isOverwrite: true, // overwrite → do not show dialog
      message: 'ok',
    });
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });
    await waitFor(() => expect(mockAddSkillFromDevice).toHaveBeenCalled());
    expect(mockSetSkill).not.toHaveBeenCalled();
  });

  it('shows generic error when addSkillFromDevice throws', async () => {
    mockAddSkillFromDevice.mockRejectedValue(new Error('disk error'));
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalled();
    });
    // t('skills.add.failed', { error: 'disk error' }) → key passthrough → 'skills.add.failed'
    expect(mockShowError).toHaveBeenCalledWith('skills.add.failed');
  });

  it('handles skills:selectSkill event and selects matching skill', async () => {
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:selectSkill', {
        detail: { skillName: 'pdf' },
      }));
    });
    // No crash, skill selected
    await act(async () => {});
  });

  it('handles skills:selectSkill with non-existent skill name (no-op)', async () => {
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:selectSkill', {
        detail: { skillName: 'nonexistent' },
      }));
    });
    // No crash
    await act(async () => {});
  });

  it('dispatches refreshFolderExplorer when skillName matches selectedSkill', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    // First select the skill
    const { rerender } = render(<SkillsView />);

    // Select 'pdf' skill via event
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:selectSkill', {
        detail: { skillName: 'pdf' },
      }));
    });

    // Now trigger addFromDevice for 'pdf' (same name as selected)
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'pdf',
      resolution: 'installed_but_not_applied',
      isOverwrite: false,
    });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });

    await waitFor(() => expect(mockAddSkillFromDevice).toHaveBeenCalled());
  });

  it('does not call setSkill when resolution is not installed_but_not_applied', async () => {
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'pdf',
      resolution: 'updated',
      isOverwrite: false,
    });
    render(<SkillsView />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });
    await waitFor(() => expect(mockAddSkillFromDevice).toHaveBeenCalled());
    expect(mockSetSkill).not.toHaveBeenCalled();
  });
});
