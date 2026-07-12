/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HookEditor from '../HookEditor';
import { emptyOperationForm, emptyFormState, type HookFormState } from '../hookFormModel';

function validState(): HookFormState {
  return { ...emptyFormState(), name: 'Hook', operation: { ...emptyOperationForm(), command: 'echo' } };
}

function renderEditor(overrides: Partial<React.ComponentProps<typeof HookEditor>> = {}) {
  const props = {
    initial: validState(),
    saveError: null,
    busy: false,
    isNew: true,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const utils = render(<HookEditor {...props} />);
  return { ...props, ...utils };
}

describe('HookEditor', () => {
  it('does not render a page title (the editor view header owns it)', () => {
    const { rerender } = renderEditor({ isNew: true });
    expect(screen.queryByText('New Hook')).toBeNull();
    rerender(
      <HookEditor
        initial={validState()}
        saveError={null}
        busy={false}
        isNew={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText('Edit Hook')).toBeNull();
  });

  it('labels the primary button Create when creating a new hook', () => {
    renderEditor({ isNew: true });
    expect(screen.getByLabelText('Save hook').textContent).toBe('Create');
  });

  it('labels the primary button Creating… while a new hook is saving', () => {
    renderEditor({ isNew: true, busy: true });
    expect(screen.getByLabelText('Save hook').textContent).toBe('Creating…');
  });

  it('labels the primary button Update when editing an existing hook', () => {
    renderEditor({ isNew: false });
    expect(screen.getByLabelText('Save hook').textContent).toBe('Update');
  });

  it('labels the primary button Updating… while an existing hook is saving', () => {
    renderEditor({ isNew: false, busy: true });
    expect(screen.getByLabelText('Save hook').textContent).toBe('Updating…');
  });

  it('updates name and description while editing an existing hook', () => {
    const { onSave } = renderEditor({ isNew: false });
    fireEvent.change(screen.getByLabelText('Hook name'), { target: { value: 'Renamed' } });
    fireEvent.change(screen.getByLabelText('Hook description'), { target: { value: 'desc' } });
    fireEvent.click(screen.getByLabelText('Save hook'));
    const saved = vi.mocked(onSave).mock.calls[0][0] as HookFormState;
    expect(saved.name).toBe('Renamed');
    expect(saved.description).toBe('desc');
  });

  it('does not render a manual enable control (Create/Update auto-enable)', () => {
    renderEditor({ isNew: true });
    expect(screen.queryByLabelText('Hook enabled')).toBeNull();
    expect(screen.queryByText('Enabled after review')).toBeNull();
  });

  it('resets local form state when editing switches to a different hook', () => {
    const first = { ...validState(), name: 'Hook A' };
    const second = { ...validState(), name: 'Hook B', description: 'second' };
    const { rerender, onSave, saveError, busy, onCancel } = renderEditor({ initial: first, isNew: false });

    fireEvent.change(screen.getByLabelText('Hook name'), { target: { value: 'Dirty A' } });
    rerender(
      <HookEditor
        initial={second}
        saveError={saveError}
        busy={busy}
        isNew={false}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByLabelText('Save hook'));

    const saved = vi.mocked(onSave).mock.calls[0][0] as HookFormState;
    expect((screen.getByLabelText('Hook name') as HTMLInputElement).value).toBe('Hook B');
    expect(saved.name).toBe('Hook B');
    expect(saved.description).toBe('second');
  });

  it('edits the event and saves', () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText('Event'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'PostToolUse' }));
    fireEvent.change(screen.getByLabelText('Matcher'), { target: { value: 'execute_command' } });
    fireEvent.change(screen.getByLabelText('If condition'), { target: { value: 'execute_command(rm *)' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'run.sh' } });
    fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '500' } });
    fireEvent.click(screen.getByLabelText('Async'));
    fireEvent.click(screen.getByLabelText('Save hook'));
    const saved = vi.mocked(onSave).mock.calls[0][0] as HookFormState;
    expect(saved.operation).toEqual({
      ...emptyOperationForm(),
      event: 'PostToolUse',
      matcher: 'execute_command',
      ifCondition: 'execute_command(rm *)',
      command: 'run.sh',
      timeout: '500',
      async: true,
    });
  });

  it('edits command exec-form arguments', () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText('Exec form'));
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: 'script.js\n--flag' } });
    fireEvent.click(screen.getByLabelText('Save hook'));
    const saved = vi.mocked(onSave).mock.calls[0][0] as HookFormState;
    expect(saved.operation.execForm).toBe(true);
    expect(saved.operation.argsText).toBe('script.js\n--flag');
  });

  it('switches the action to http and edits the http fields', () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText('Action type'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'http' }));
    fireEvent.change(screen.getByLabelText('If condition'), { target: { value: 'Fetch(*)' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/hook' } });
    fireEvent.click(screen.getByLabelText('Method'));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'PUT' }));
    fireEvent.change(screen.getByLabelText('Headers'), { target: { value: 'X-Test: 1' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: '{"k":1}' } });
    fireEvent.click(screen.getByLabelText('Save hook'));
    const saved = vi.mocked(onSave).mock.calls[0][0] as HookFormState;
    expect(saved.operation.actionType).toBe('http');
    expect(saved.operation.ifCondition).toBe('Fetch(*)');
    expect(saved.operation.url).toBe('https://example.com/hook');
    expect(saved.operation.method).toBe('PUT');
    expect(saved.operation.headersText).toBe('X-Test: 1');
    expect(saved.operation.body).toBe('{"k":1}');
  });

  it('shows http fields and hides the command field for an http operation', () => {
    renderEditor({
      initial: {
        ...emptyFormState(),
        name: 'Hook',
        operation: { ...emptyOperationForm(), actionType: 'http', url: 'https://h.test' },
      },
    });
    expect(screen.getByLabelText('URL')).toBeTruthy();
    expect(screen.getByLabelText('Method')).toBeTruthy();
    expect(screen.queryByLabelText('Command')).toBeNull();
  });

  it('uses custom dropdown menus for event, action type, and method', () => {
    renderEditor();
    const eventTrigger = screen.getByLabelText('Event');
    expect(eventTrigger.tagName).toBe('BUTTON');
    fireEvent.click(eventTrigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'SessionStart' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'SessionStart' }));
    expect(screen.queryByRole('listbox')).toBeNull();

    const actionTypeTrigger = screen.getByLabelText('Action type');
    expect(actionTypeTrigger.tagName).toBe('BUTTON');
    fireEvent.click(actionTypeTrigger);
    expect(screen.getByRole('option', { name: 'http' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'http' }));
    expect(screen.queryByRole('listbox')).toBeNull();

    const methodTrigger = screen.getByLabelText('Method');
    expect(methodTrigger.tagName).toBe('BUTTON');
    fireEvent.click(methodTrigger);
    expect(screen.getByRole('option', { name: 'PATCH' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'PATCH' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes a custom dropdown from outside click and Escape', () => {
    renderEditor();
    const eventTrigger = screen.getByLabelText('Event');
    fireEvent.click(eventTrigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(eventTrigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('selects custom dropdown options from keyboard click activation', () => {
    const { onSave } = renderEditor();
    fireEvent.click(screen.getByLabelText('Event'));
    fireEvent.click(screen.getByRole('option', { name: 'Stop' }));
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(screen.getByLabelText('Save hook'));
    const saved = vi.mocked(onSave).mock.calls[0][0] as HookFormState;
    expect(saved.operation.event).toBe('Stop');
  });

  it('keeps a custom dropdown open when clicking the trigger or menu', () => {
    renderEditor();
    const eventTrigger = screen.getByLabelText('Event');
    fireEvent.click(eventTrigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(eventTrigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('listbox'));
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('does not open a custom dropdown when trigger layout is unavailable', () => {
    renderEditor();
    const eventTrigger = screen.getByLabelText('Event') as HTMLButtonElement;
    const original = eventTrigger.getBoundingClientRect;
    eventTrigger.getBoundingClientRect = vi.fn(() => undefined as unknown as DOMRect);

    fireEvent.click(eventTrigger);
    expect(screen.queryByRole('listbox')).toBeNull();

    eventTrigger.getBoundingClientRect = original;
  });

  it('renders a single hook operation without add or remove controls', () => {
    renderEditor();
    expect(screen.getAllByTestId('hook-operation').length).toBe(1);
    expect(screen.queryByLabelText('Add event')).toBeNull();
    expect(screen.queryByLabelText('Remove event')).toBeNull();
    expect(screen.getByText('Operation')).toBeTruthy();
    expect(screen.getByText(/Hooks follow the Claude Hooks standard/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'official Hooks reference' })).toHaveAttribute(
      'href',
      'https://code.claude.com/docs/en/hooks',
    );
    expect(screen.getByLabelText('If condition')).toBeTruthy();
  });

  it('distinguishes required and optional fields', () => {
    renderEditor();
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Optional').length).toBeGreaterThan(0);
  });

  it('marks timeout as seconds', () => {
    renderEditor();
    expect(screen.getByText('(seconds)')).toBeTruthy();
  });

  it('explains how to fill hook fields', () => {
    renderEditor();
    expect(screen.getByText(/Choose the agent lifecycle point/)).toBeTruthy();
    expect(screen.getByText(/Leave empty or use \* to match all/)).toBeTruthy();
    expect(screen.getByText(/The agent passes the Hook event JSON to the command on stdin/)).toBeTruthy();
    expect(screen.getByText(/Maximum time in seconds/)).toBeTruthy();
  });

  it('does not render the removed additional operations review UI', () => {
    renderEditor({
      isNew: false,
      initial: validState(),
    });

    expect(screen.queryByText('Additional operations preserved')).toBeNull();
    expect(screen.queryByText('HTTP POST https://extra.test/hook')).toBeNull();
    expect(screen.queryByText('Command cleanup')).toBeNull();
  });

  it('blocks save and shows validation errors when invalid', () => {
    const { onSave } = renderEditor({ initial: { ...emptyFormState(), name: '' } });
    fireEvent.click(screen.getByLabelText('Save hook'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Name is required.')).toBeTruthy();
  });

  it('renders a save error from the parent', () => {
    renderEditor({ saveError: 'Boom' });
    expect(screen.getByText('Boom')).toBeTruthy();
  });

  it('disables the buttons and shows saving text when busy', () => {
    renderEditor({ busy: true });
    expect((screen.getByLabelText('Save hook') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Creating…')).toBeTruthy();
  });

  it('calls onCancel', () => {
    const { onCancel } = renderEditor();
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
