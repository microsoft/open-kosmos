// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockShowToast = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockAddSkillFromDevice = vi.hoisted(() => vi.fn());
const mockSetSkill = vi.hoisted(() => vi.fn());
const mockContext = vi.hoisted(() => ({
  onSkillsAddMenuToggle: undefined,
  onSkillMenuToggle: vi.fn(),
}));
const mockSkills = vi.hoisted(() => [{ name: 'alpha', version: '1.0.0', source: 'ON-DEVICE' }]);

vi.mock('../ApplySkillToAgentsDialog', () => ({
  ApplySkillDialogAtom: {
    useChange: () => ({ setSkill: mockSetSkill }),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useOutletContext: () => mockContext,
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showInfo: vi.fn(),
    showToast: mockShowToast,
  }),
}));

vi.mock('../../userData/userDataProvider', () => ({
  useSkills: () => ({
    skills: [...mockSkills],
    stats: { totalSkills: mockSkills.length },
    isLoading: false,
  }),
  useProfileDataRefresh: () => ({ refresh: mockRefresh }),
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => `${key}:${params?.name ?? params?.error ?? ''}`,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../SkillsHeaderView', () => ({
  default: ({ onAddClick }: any) => (
    <button data-testid="add-click" onClick={() => onAddClick(document.body)} type="button">
      add
    </button>
  ),
}));

vi.mock('../SkillsContentView', () => ({
  default: ({ skills, selectedSkill, onSelectSkill }: any) => (
    <div>
      <div data-testid="selected-skill">{selectedSkill?.name ?? 'none'}</div>
      <button data-testid="select-first" onClick={() => onSelectSkill(skills[0] ?? null)} type="button">
        select-first
      </button>
      <button data-testid="select-second" onClick={() => onSelectSkill(skills[1] ?? null)} type="button">
        select-second
      </button>
      <button data-testid="clear-selection" onClick={() => onSelectSkill(null)} type="button">
        clear-selection
      </button>
    </div>
  ),
}));

import SkillsView from '../SkillsView';

describe('SkillsView supplemental selection and fallback coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSkills.splice(0, mockSkills.length, { name: 'alpha', version: '1.0.0', source: 'ON-DEVICE' });
    mockContext.onSkillsAddMenuToggle = undefined;
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'alpha',
      message: 'Installed alpha',
      resolution: 'updated',
      isOverwrite: false,
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

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('does nothing when the add button callback is unavailable', () => {
    render(<SkillsView />);
    fireEvent.click(screen.getByTestId('add-click'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('falls back to the translated success message when the API result omits a message', async () => {
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'beta',
      message: '',
      resolution: 'updated',
      isOverwrite: false,
    });

    render(<SkillsView />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
      await Promise.resolve();
    });

    expect(mockShowSuccess).toHaveBeenCalledWith('skills.add.success:beta');
  });

  it('runs the deferred refresh callback after a successful add', async () => {
    render(<SkillsView />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockRefresh).toHaveBeenCalled();
  });

  it('dispatches a folder refresh when the installed skill matches the current selection', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'alpha',
      message: 'Installed alpha',
      resolution: 'updated',
      isOverwrite: false,
    });

    render(<SkillsView />);
    fireEvent.click(screen.getByTestId('select-first'));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'skills:refreshFolderExplorer',
        detail: { skillName: 'alpha' },
      }),
    );

    dispatchSpy.mockRestore();
  });

  it('uses the generic translated error when addSkillFromDevice throws a non-Error value', async () => {
    mockAddSkillFromDevice.mockRejectedValue('boom');

    render(<SkillsView />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
      await Promise.resolve();
    });

    expect(mockShowError).toHaveBeenCalledWith('skills.add.failed:common.unknownError:');
  });

  it('preserves an intentional null selection when the skills list changes', async () => {
    const { rerender } = render(<SkillsView />);

    fireEvent.click(screen.getByTestId('clear-selection'));
    expect(screen.getByTestId('selected-skill')).toHaveTextContent('none');

    mockSkills.splice(0, mockSkills.length, { name: 'gamma', version: '1.0.0', source: 'ON-DEVICE' });
    rerender(<SkillsView />);

    expect(screen.getByTestId('selected-skill')).toHaveTextContent('none');
  });

  it('keeps the current selection when the skill still exists after the list changes', () => {
    mockSkills.splice(
      0,
      mockSkills.length,
      { name: 'alpha', version: '1.0.0', source: 'ON-DEVICE' },
      { name: 'beta', version: '1.0.0', source: 'ON-DEVICE' },
    );
    const { rerender } = render(<SkillsView />);

    fireEvent.click(screen.getByTestId('select-second'));
    expect(screen.getByTestId('selected-skill')).toHaveTextContent('beta');

    mockSkills.splice(
      0,
      mockSkills.length,
      { name: 'beta', version: '2.0.0', source: 'ON-DEVICE' },
      { name: 'gamma', version: '1.0.0', source: 'ON-DEVICE' },
    );
    rerender(<SkillsView />);

    expect(screen.getByTestId('selected-skill')).toHaveTextContent('beta');
  });

  it('falls back to the first remaining skill when the selected skill disappears', async () => {
    mockSkills.splice(
      0,
      mockSkills.length,
      { name: 'alpha', version: '1.0.0', source: 'ON-DEVICE' },
      { name: 'beta', version: '1.0.0', source: 'ON-DEVICE' },
    );
    const { rerender } = render(<SkillsView />);

    fireEvent.click(screen.getByTestId('select-second'));
    expect(screen.getByTestId('selected-skill')).toHaveTextContent('beta');

    mockSkills.splice(0, mockSkills.length, { name: 'alpha', version: '1.0.0', source: 'ON-DEVICE' });
    rerender(<SkillsView />);

    expect(screen.getByTestId('selected-skill')).toHaveTextContent('alpha');
  });

  it('clears the selection when the selected skill disappears and the list becomes empty', async () => {
    const { rerender } = render(<SkillsView />);

    fireEvent.click(screen.getByTestId('select-first'));
    expect(screen.getByTestId('selected-skill')).toHaveTextContent('alpha');

    mockSkills.splice(0, mockSkills.length);
    rerender(<SkillsView />);

    expect(screen.getByTestId('selected-skill')).toHaveTextContent('none');
  });
});
