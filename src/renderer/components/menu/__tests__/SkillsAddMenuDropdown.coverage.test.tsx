// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * Comprehensive supplementary coverage tests for SkillsAddMenuDropdown.tsx
 */
import React, { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/utilities/dropdownPosition', () => ({
  adjustAnchoredDropdownToViewport: vi.fn(),
}));

vi.mock('@/lib/i18n/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('lucide-react', () => ({
  FolderPlus: () => <svg data-testid="folder-plus-icon" />,
  Plus: () => <svg data-testid="plus-icon" />,
  Store: () => <svg data-testid="store-icon" />,
}));

import SkillsAddMenuDropdown from '../SkillsAddMenuDropdown';

const defaultPosition = { top: 10, left: 20, triggerTop: 0, triggerRight: 0 };

describe('SkillsAddMenuDropdown', () => {
  const onClose = vi.fn();
  const dispatchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'dispatchEvent').mockImplementation(dispatchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders local Skill import actions', () => {
    render(
      <SkillsAddMenuDropdown
        skillsAddMenuRef={createRef<HTMLDivElement>()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('skills.addFromDeviceArtifact')).toBeTruthy();
    expect(screen.getByText('skills.addFromDeviceFolder')).toBeTruthy();
  });

  it('dispatches skills:addFromDeviceArtifact and calls onClose', () => {
    render(
      <SkillsAddMenuDropdown
        skillsAddMenuRef={createRef<HTMLDivElement>()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('skills.addFromDeviceArtifact'));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'skills:addFromDeviceArtifact' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dispatches skills:addFromDeviceFolder and calls onClose', () => {
    render(
      <SkillsAddMenuDropdown
        skillsAddMenuRef={createRef<HTMLDivElement>()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('skills.addFromDeviceFolder'));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'skills:addFromDeviceFolder' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies position styles', () => {
    const { container } = render(
      <SkillsAddMenuDropdown
        skillsAddMenuRef={createRef<HTMLDivElement>()}
        position={{ top: 50, left: 80, triggerTop: 0, triggerRight: 0 }}
        onClose={onClose}
      />,
    );
    const menu = container.querySelector('.skills-add-dropdown-menu');
    expect(menu?.style.top).toBe('50px');
    expect(menu?.style.left).toBe('80px');
  });

  it('renders with role=menu', () => {
    render(
      <SkillsAddMenuDropdown
        skillsAddMenuRef={createRef<HTMLDivElement>()}
        position={defaultPosition}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });
});
