/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HookDropdownMenu from '../HookDropdownMenu';
import type { HookDefinition } from '@shared/ipc/agentHooks';
import type { AnchoredDropdownPosition } from '../../../lib/utilities/dropdownPosition';

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: 'h1',
    name: 'My Hook',
    description: 'd',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    action: { type: 'command', command: 'echo' },
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

const position: AnchoredDropdownPosition = {
  top: 10,
  left: 20,
  triggerTop: 5,
  triggerBottom: 25,
  triggerRight: 100,
};

function renderMenu(hook: HookDefinition, handlers: Partial<{
  onToggleEnable: (h: HookDefinition) => void;
  onEdit: (h: HookDefinition) => void;
  onDelete: (h: HookDefinition) => void;
  onClose: () => void;
}> = {}) {
  const merged = {
    onToggleEnable: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...handlers,
  };
  const ref = React.createRef<HTMLDivElement>();
  render(
    <HookDropdownMenu
      hookMenuRef={ref}
      hook={hook}
      position={position}
      onToggleEnable={merged.onToggleEnable}
      onEdit={merged.onEdit}
      onDelete={merged.onDelete}
      onClose={merged.onClose}
    />,
  );
  return merged;
}

describe('HookDropdownMenu', () => {
  it('shows a Disable item for an enabled hook', () => {
    renderMenu(makeHook({ enabled: true }));
    expect(screen.getByLabelText('Disable My Hook')).toBeTruthy();
    expect(screen.getByText('Disable')).toBeTruthy();
  });

  it('shows an Enable item for a disabled hook', () => {
    renderMenu(makeHook({ enabled: false }));
    expect(screen.getByLabelText('Enable My Hook')).toBeTruthy();
    expect(screen.getByText('Enable')).toBeTruthy();
  });

  it('calls onToggleEnable and closes when the toggle item is clicked', () => {
    const hook = makeHook({ enabled: true });
    const { onToggleEnable, onClose } = renderMenu(hook);
    fireEvent.click(screen.getByLabelText('Disable My Hook'));
    expect(onToggleEnable).toHaveBeenCalledWith(hook);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onEdit and closes when the edit item is clicked', () => {
    const hook = makeHook();
    const { onEdit, onClose } = renderMenu(hook);
    fireEvent.click(screen.getByLabelText('Edit My Hook'));
    expect(onEdit).toHaveBeenCalledWith(hook);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete and closes when the delete item is clicked', () => {
    const hook = makeHook();
    const { onDelete, onClose } = renderMenu(hook);
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    expect(onDelete).toHaveBeenCalledWith(hook);
    expect(onClose).toHaveBeenCalled();
  });
});
