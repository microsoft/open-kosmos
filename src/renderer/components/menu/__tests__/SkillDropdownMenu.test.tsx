/**
 * @vitest-environment happy-dom
 */

import React, { createRef } from 'react';
import { act, render, screen } from '@testing-library/react';

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
}));

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowToast = vi.fn();
const mockRefresh = vi.fn();

vi.mock('../../ui/ToastProvider', async () => ({
  useToast: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showToast: mockShowToast,
  }),
}));

vi.mock('../../userData/userDataProvider', async () => ({
  useProfileDataRefresh: () => ({
    refresh: mockRefresh,
  }),
  useSkills: () => ({
    skills: [
      { name: 'pdf', source: 'ON-DEVICE' },
    ],
  }),
}));

describe('SkillDropdownMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(window, 'electronAPI', {
      writable: true,
      configurable: true,
      value: {
        isDev: vi.fn().mockResolvedValue(true),
        platform: 'darwin',
        skillLibrary: {
          updateSkillFromDevice: vi.fn(),
        },
        skills: {
          openSkillFolder: vi.fn(),
        },
      },
    });
  });

  it('shows an explicit update label for on-device skills', async () => {
    const { default: SkillDropdownMenu } = await import('../SkillDropdownMenu');

    await act(async () => {
      render(
        <SkillDropdownMenu
          skillMenuRef={createRef<HTMLDivElement>()}
          skillName="pdf"
          position={{ top: 0, left: 0, triggerTop: 0, triggerRight: 0 }}
          onClose={vi.fn()}
        />,
      );
    });

    expect(screen.getByText('Update from Device...')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Update from Device...' })).toHaveAttribute(
      'title',
      'Update from a local .zip, .skill, folder, or SKILL.md artifact',
    );
  });
});