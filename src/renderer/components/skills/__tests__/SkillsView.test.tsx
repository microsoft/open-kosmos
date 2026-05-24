/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

import SkillsView from '../SkillsView';

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowInfo = vi.fn();
const mockShowToast = vi.fn();
const mockRefresh = vi.fn().mockResolvedValue(undefined);
const mockNavigate = vi.fn();
const mockAddSkillFromDevice = vi.fn();
const mockSetSkill = vi.fn();

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
    onSkillsAddMenuToggle: vi.fn(),
    onSkillMenuToggle: vi.fn(),
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

vi.mock('../../userData/userDataProvider', async () => ({
  useSkills: () => ({
    skills: [
      {
        name: 'pdf',
        version: '1.0.0',
        source: 'ON-DEVICE',
      },
    ],
    stats: { totalSkills: 1 },
    isLoading: false,
  }),
  useProfileDataRefresh: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock('../SkillsHeaderView', () => ({ default: () => <div>skills-header</div> }));
vi.mock('../SkillsContentView', () => ({ default: () => <div>skills-content</div> }));

describe('SkillsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAddSkillFromDevice.mockResolvedValue({
      success: true,
      skillName: 'pdf',
      resolution: 'installed_but_not_applied',
      isOverwrite: false,
      message: 'Skill "pdf" added successfully',
    });

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        skillLibrary: {
          addSkillFromDevice: mockAddSkillFromDevice,
        },
      },
    });
  });

  it('does not pass a hidden chat context and reopens agent selection after device install from settings', async () => {
    render(<SkillsView />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDevice'));
    });

    await waitFor(() => {
      expect(mockAddSkillFromDevice).toHaveBeenCalledWith(undefined, {
        requestSource: 'settings',
        selectionMode: undefined,
      });
      expect(mockSetSkill).toHaveBeenCalledWith('pdf');
    });
  });

  it('passes explicit artifact selection mode for split add menu events', async () => {
    render(<SkillsView />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDeviceArtifact'));
    });

    await waitFor(() => {
      expect(mockAddSkillFromDevice).toHaveBeenCalledWith(undefined, {
        requestSource: 'settings',
        selectionMode: 'artifact',
      });
    });
  });

  it('passes explicit folder selection mode for split add menu events', async () => {
    render(<SkillsView />);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('skills:addFromDeviceFolder'));
    });

    await waitFor(() => {
      expect(mockAddSkillFromDevice).toHaveBeenCalledWith(undefined, {
        requestSource: 'settings',
        selectionMode: 'folder',
      });
    });
  });
});
