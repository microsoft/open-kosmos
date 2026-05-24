/**
 * @vitest-environment happy-dom
 */

import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../lib/utilities/dropdownPosition', async () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
}));

describe('SkillsAddMenuDropdown', () => {
  it('renders split device actions and dispatches the matching events', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const onClose = vi.fn();
    const { default: SkillsAddMenuDropdown } = await import('../SkillsAddMenuDropdown');

    render(
      <SkillsAddMenuDropdown
        skillsAddMenuRef={createRef<HTMLDivElement>()}
        position={{ top: 0, left: 0, triggerTop: 0, triggerRight: 0 }}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Add from Device (.zip/.skill)' }));
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'skills:addFromDeviceArtifact' }));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Add from Device (folder)' }));
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'skills:addFromDeviceFolder' }));

    expect(onClose).toHaveBeenCalledTimes(2);
    dispatchEventSpy.mockRestore();
  });
});