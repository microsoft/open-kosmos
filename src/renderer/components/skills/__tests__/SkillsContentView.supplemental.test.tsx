// @ts-nocheck
/** @vitest-environment happy-dom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../SkillListPanel', () => ({
  default: ({ skills, onSelectSkill }: any) => (
    <button data-testid="skill-list" onClick={() => onSelectSkill(skills[0] ?? null)} type="button">
      skill-list
    </button>
  ),
}));

vi.mock('../SkillViewPanel', () => ({
  default: ({ skill }: any) => <div data-testid="skill-view">{skill?.name ?? 'none'}</div>,
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'skills.addFromDeviceArtifact': 'Add from Device Artifact',
      'skills.addFromDeviceFolder': 'Add from Device Folder',
      'skills.emptyDescription': 'No skills yet',
    }[key] ?? key),
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

import SkillsContentView from '../SkillsContentView';

describe('SkillsContentView supplemental coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the list and viewer layout instead of the empty state while loading', () => {
    const onSelectSkill = vi.fn();
    const skills = [{ name: 'pdf', version: '1.0.0', source: 'ON-DEVICE' }];

    render(
      <SkillsContentView
        skills={skills as any}
        selectedSkill={skills[0] as any}
        isLoading={true}
        onSelectSkill={onSelectSkill}
      />,
    );

    expect(screen.queryByText('No skills yet')).not.toBeInTheDocument();
    expect(screen.getByTestId('skill-list')).toBeInTheDocument();
    expect(screen.getByTestId('skill-view')).toHaveTextContent('pdf');
  });
});
