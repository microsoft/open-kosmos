/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HookListPanel from '../HookListPanel';
import type { HookDefinition } from '@shared/ipc/agentHooks';

function makeHook(overrides: Partial<HookDefinition> = {}): HookDefinition {
  return {
    id: 'h1',
    name: 'My Hook',
    description: 'A description',
    version: '1.0.0',
    source: 'ON-DEVICE',
    enabled: true,
    event: 'PreToolUse',
    matcher: undefined,
    action: { type: 'command', command: 'echo' },
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof HookListPanel>> = {}) {
  const merged = {
    hooks: [makeHook()],
    selectedHookId: null,
    onSelect: vi.fn(),
    onMenuToggle: vi.fn(),
    ...props,
  };
  render(<HookListPanel {...merged} />);
  return merged;
}

describe('HookListPanel', () => {
  it('shows an empty state when there are no hooks', () => {
    renderPanel({ hooks: [] });
    expect(screen.getByText(/No hooks yet/)).toBeTruthy();
  });

  it('renders the hook name', () => {
    renderPanel();
    expect(screen.getByText('My Hook')).toBeTruthy();
  });

  it('does not render a description or operation summary in the card', () => {
    renderPanel();
    expect(screen.queryByText('A description')).toBeNull();
    expect(screen.queryByText(/Operation:/)).toBeNull();
  });

  it('renders the version and source provenance labels', () => {
    renderPanel();
    expect(screen.getByText('v1.0.0')).toBeTruthy();
    expect(screen.getByText('ON-DEVICE')).toBeTruthy();
  });

  it('omits the version and source labels when empty', () => {
    renderPanel({ hooks: [makeHook({ version: '', source: '' as HookDefinition['source'] })] });
    expect(screen.queryByText('v1.0.0')).toBeNull();
    expect(screen.queryByText('ON-DEVICE')).toBeNull();
  });

  it('does not render a duplicate list title', () => {
    renderPanel();
    expect(screen.queryByRole('heading', { name: 'Hooks' })).toBeNull();
  });

  it('omits the description when absent', () => {
    renderPanel({ hooks: [makeHook({ description: undefined })] });
    expect(screen.queryByText('A description')).toBeNull();
  });

  it('marks the selected hook row', () => {
    renderPanel({ selectedHookId: 'h1' });
    const row = screen.getByTestId('hook-row');
    expect(row.className).toContain('is-selected');
  });

  it('does not mark an unselected hook row', () => {
    renderPanel({ selectedHookId: 'other' });
    const row = screen.getByTestId('hook-row');
    expect(row.className).not.toContain('is-selected');
  });

  it('renders an enabled badge for enabled hooks and a disabled badge for disabled hooks', () => {
    const { container } = render(
      <HookListPanel
        hooks={[makeHook({ id: 'a', name: 'On', enabled: true }), makeHook({ id: 'b', name: 'Off', enabled: false })]}
        selectedHookId={null}
        onSelect={vi.fn()}
        onMenuToggle={vi.fn()}
      />,
    );
    const badges = container.querySelectorAll('.hook-status');
    expect(badges[0].classList.contains('enabled')).toBe(true);
    expect(badges[0].textContent).toBe('enabled');
    expect(badges[1].classList.contains('disabled')).toBe(true);
    expect(badges[1].textContent).toBe('disabled');
  });

  it('calls onSelect with the hook when a row is clicked', () => {
    const { onSelect, hooks } = renderPanel();
    fireEvent.click(screen.getByLabelText('Select My Hook'));
    expect(onSelect).toHaveBeenCalledWith(hooks[0]);
  });

  it('calls onMenuToggle with the hook id and the trigger element', () => {
    const { onMenuToggle } = renderPanel();
    const trigger = screen.getByLabelText('Hook options for My Hook');
    fireEvent.click(trigger);
    expect(onMenuToggle).toHaveBeenCalledWith('h1', trigger);
  });

  it('stops mousedown propagation from the row menu trigger', () => {
    const onMouseDown = vi.fn();
    render(
      <div onMouseDown={onMouseDown}>
        <HookListPanel
          hooks={[makeHook()]}
          selectedHookId={null}
          onSelect={vi.fn()}
          onMenuToggle={vi.fn()}
        />
      </div>,
    );

    fireEvent.mouseDown(screen.getByLabelText('Hook options for My Hook'));

    expect(onMouseDown).not.toHaveBeenCalled();
  });

  describe('search box', () => {
    it('renders a search box when there are hooks', () => {
      renderPanel();
      expect(screen.getByPlaceholderText('Search hooks...')).toBeTruthy();
    });

    it('does not render a search box when there are no hooks', () => {
      renderPanel({ hooks: [] });
      expect(screen.queryByPlaceholderText('Search hooks...')).toBeNull();
    });

    it('filters the list by hook name', () => {
      renderPanel({
        hooks: [makeHook({ id: 'a', name: 'Alpha' }), makeHook({ id: 'b', name: 'Beta' })],
        selectedHookId: 'a',
      });
      fireEvent.change(screen.getByPlaceholderText('Search hooks...'), { target: { value: 'Alph' } });
      expect(screen.getByText('Alpha')).toBeTruthy();
      expect(screen.queryByText('Beta')).toBeNull();
    });

    it('shows a no-match message when the search excludes every hook', () => {
      renderPanel({ hooks: [makeHook({ name: 'Alpha' })], selectedHookId: 'h1' });
      fireEvent.change(screen.getByPlaceholderText('Search hooks...'), { target: { value: 'zzz' } });
      expect(screen.getByText('No hooks match your search.')).toBeTruthy();
      expect(screen.queryByTestId('hook-row')).toBeNull();
    });

    it('restores the full list when the search is cleared', () => {
      renderPanel({
        hooks: [makeHook({ id: 'a', name: 'Alpha' }), makeHook({ id: 'b', name: 'Beta' })],
        selectedHookId: 'a',
      });
      fireEvent.change(screen.getByPlaceholderText('Search hooks...'), { target: { value: 'Alph' } });
      expect(screen.queryByText('Beta')).toBeNull();
      fireEvent.click(screen.getByTitle('Clear search'));
      expect(screen.getByText('Beta')).toBeTruthy();
    });
  });

  describe('selection sync', () => {
    it('auto-selects the first hook when nothing is selected', () => {
      const hooks = [makeHook({ id: 'a', name: 'Alpha' }), makeHook({ id: 'b', name: 'Beta' })];
      const onSelect = vi.fn();
      render(
        <HookListPanel hooks={hooks} selectedHookId={null} onSelect={onSelect} onMenuToggle={vi.fn()} />,
      );
      expect(onSelect).toHaveBeenCalledWith(hooks[0]);
    });

    it('selects the first visible hook when the selection is filtered out', () => {
      const hooks = [makeHook({ id: 'a', name: 'Alpha' }), makeHook({ id: 'b', name: 'Beta' })];
      const onSelect = vi.fn();
      render(
        <HookListPanel hooks={hooks} selectedHookId="b" onSelect={onSelect} onMenuToggle={vi.fn()} />,
      );
      onSelect.mockClear();
      fireEvent.change(screen.getByPlaceholderText('Search hooks...'), { target: { value: 'Alph' } });
      expect(onSelect).toHaveBeenCalledWith(hooks[0]);
    });

    it('keeps the selection when it remains in the filtered results', () => {
      const hooks = [makeHook({ id: 'a', name: 'Alpha' }), makeHook({ id: 'b', name: 'Beta' })];
      const onSelect = vi.fn();
      render(
        <HookListPanel hooks={hooks} selectedHookId="a" onSelect={onSelect} onMenuToggle={vi.fn()} />,
      );
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.change(screen.getByPlaceholderText('Search hooks...'), { target: { value: 'Alph' } });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('does not reselect while every hook is filtered out', () => {
      const hooks = [makeHook({ id: 'a', name: 'Alpha' })];
      const onSelect = vi.fn();
      render(
        <HookListPanel hooks={hooks} selectedHookId="a" onSelect={onSelect} onMenuToggle={vi.fn()} />,
      );
      onSelect.mockClear();
      fireEvent.change(screen.getByPlaceholderText('Search hooks...'), { target: { value: 'zzz' } });
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
