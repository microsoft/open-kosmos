/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import SkillsContentView from '../SkillsContentView';

vi.mock('../SkillListPanel', () => ({ default: () => <div>skill-list-panel</div> }));
vi.mock('../SkillViewPanel', () => ({ default: () => <div>skill-view-panel</div> }));

describe('SkillsContentView', () => {
  it('splits empty-state device actions into artifact and folder events', () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

    render(
      <SkillsContentView
        skills={[]}
        selectedSkill={null}
        isLoading={false}
        onSelectSkill={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add from Device (.zip/.skill)' }));
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'skills:addFromDeviceArtifact' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add from Device (folder)' }));
    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'skills:addFromDeviceFolder' }),
    );

    expect(screen.queryByRole('button', { name: 'Add from Device (.zip/.skill or folder)' })).not.toBeInTheDocument();
    dispatchEventSpy.mockRestore();
  });
});