/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HookEditorView from '../HookEditorView';
import type { HookDefinition } from '@shared/ipc/agentHooks';

const api = vi.hoisted(() => ({
  listHooks: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const routerParams = vi.hoisted(() => ({ editHookId: undefined as string | undefined }));

vi.mock('../../../ipc/agentHooks', () => ({ agentHooksApi: api }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => routerParams,
}));
vi.mock('../ApplyHookToAgentsDialog', () => ({
  default: (props: { hookId: string; hookName: string; onClose: () => void }) => (
    <div data-testid="apply-hook-dialog">
      <span data-testid="apply-hook-name">{props.hookName}</span>
      <span data-testid="apply-hook-id">{props.hookId}</span>
      <button onClick={props.onClose} aria-label="Close apply hook dialog">
        close
      </button>
    </div>
  ),
}));

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

function fillNewForm(name = 'New One', command = 'echo hi') {
  fireEvent.change(screen.getByLabelText('Hook name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Command'), { target: { value: command } });
}

describe('HookEditorView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockClear();
    routerParams.editHookId = undefined;
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    api.createHook.mockResolvedValue({ success: true });
    api.updateHook.mockResolvedValue({ success: true });
  });

  describe('create mode', () => {
    it('renders the New Hook title and an empty form without loading hooks', async () => {
      render(<HookEditorView />);
      expect(screen.getByText('New Hook', { selector: '.header-name' })).toBeTruthy();
      expect(screen.getByLabelText('Back to hooks')).toBeTruthy();
      expect(screen.getByLabelText('Save hook')).toBeTruthy();
      expect(api.listHooks).not.toHaveBeenCalled();
    });

    it('creates a hook, auto-enables it, opens the apply dialog, then returns with it selected', async () => {
      api.createHook.mockResolvedValue({
        success: true,
        hook: makeHook({ id: 'new-1', name: 'Fresh Hook', enabled: false }),
      });
      render(<HookEditorView />);
      fillNewForm('Fresh Hook');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(api.updateHook).toHaveBeenCalledWith('new-1', { enabled: true }));
      const dialog = await screen.findByTestId('apply-hook-dialog');
      expect(dialog).toBeTruthy();
      expect(screen.getByTestId('apply-hook-id').textContent).toBe('new-1');
      fireEvent.click(screen.getByLabelText('Close apply hook dialog'));
      expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks?selectHook=new-1');
    });

    it('does not re-enable a created hook that is already enabled', async () => {
      api.createHook.mockResolvedValue({
        success: true,
        hook: makeHook({ id: 'new-2', name: 'Already On', enabled: true }),
      });
      render(<HookEditorView />);
      fillNewForm('Already On');
      fireEvent.click(screen.getByLabelText('Save hook'));
      expect(await screen.findByTestId('apply-hook-dialog')).toBeTruthy();
      expect(api.updateHook).not.toHaveBeenCalled();
    });

    it('shows an error and skips the apply dialog when auto-enable fails', async () => {
      api.createHook.mockResolvedValue({
        success: true,
        hook: makeHook({ id: 'new-3', name: 'Enable Fails', enabled: false }),
      });
      api.updateHook.mockResolvedValue({ success: false, error: 'enable failed' });
      render(<HookEditorView />);
      fillNewForm('Enable Fails');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('enable failed')).toBeTruthy());
      expect(screen.queryByTestId('apply-hook-dialog')).toBeNull();
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('returns to the list without a dialog when create returns no hook payload', async () => {
      api.createHook.mockResolvedValue({ success: true });
      render(<HookEditorView />);
      fillNewForm('No Payload');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks'));
      expect(screen.queryByTestId('apply-hook-dialog')).toBeNull();
      expect(api.updateHook).not.toHaveBeenCalled();
    });

    it('shows a save error when create fails', async () => {
      api.createHook.mockResolvedValue({ success: false, error: 'save failed' });
      render(<HookEditorView />);
      fillNewForm();
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('save failed')).toBeTruthy());
    });

    it('shows a default save error when create fails without a message', async () => {
      api.createHook.mockResolvedValue({ success: false });
      render(<HookEditorView />);
      fillNewForm();
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('Failed to save hook.')).toBeTruthy());
    });

    it('shows a save error when create throws', async () => {
      api.createHook.mockRejectedValue(new Error('explode'));
      render(<HookEditorView />);
      fillNewForm();
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('explode')).toBeTruthy());
    });

    it('shows a default save error when create throws a non-Error', async () => {
      api.createHook.mockRejectedValue('weird');
      render(<HookEditorView />);
      fillNewForm();
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('Failed to save hook.')).toBeTruthy());
    });

    it('navigates back to the list from the header back button', async () => {
      render(<HookEditorView />);
      fireEvent.click(screen.getByLabelText('Back to hooks'));
      expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks');
    });

    it('navigates back to the list from the form cancel button', async () => {
      render(<HookEditorView />);
      fireEvent.click(screen.getByLabelText('Cancel'));
      expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks');
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      routerParams.editHookId = 'h1';
    });

    it('loads the hook and renders the Edit Hook title with a prefilled form', async () => {
      api.listHooks.mockResolvedValue({ success: true, data: [makeHook({ id: 'h1', name: 'Loaded Hook' })] });
      render(<HookEditorView />);
      expect(screen.getByText('Loading hook…')).toBeTruthy();
      expect(await screen.findByText('Edit Hook', { selector: '.header-name' })).toBeTruthy();
      expect((screen.getByLabelText('Hook name') as HTMLInputElement).value).toBe('Loaded Hook');
    });

    it('updates the hook and returns to the list with it selected, without the apply dialog', async () => {
      render(<HookEditorView />);
      await screen.findByLabelText('Save hook');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() =>
        expect(api.updateHook).toHaveBeenCalledWith('h1', expect.objectContaining({ enabled: true })),
      );
      expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks?selectHook=h1');
      expect(screen.queryByTestId('apply-hook-dialog')).toBeNull();
    });

    it('shows a save error when update fails', async () => {
      api.updateHook.mockResolvedValue({ success: false, error: 'update failed' });
      render(<HookEditorView />);
      await screen.findByLabelText('Save hook');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('update failed')).toBeTruthy());
    });

    it('shows a default save error when update fails without a message', async () => {
      api.updateHook.mockResolvedValue({ success: false });
      render(<HookEditorView />);
      await screen.findByLabelText('Save hook');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('Failed to save hook.')).toBeTruthy());
    });

    it('shows a save error when update throws', async () => {
      api.updateHook.mockRejectedValue(new Error('boom'));
      render(<HookEditorView />);
      await screen.findByLabelText('Save hook');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
    });

    it('shows a default save error when update throws a non-Error', async () => {
      api.updateHook.mockRejectedValue('weird');
      render(<HookEditorView />);
      await screen.findByLabelText('Save hook');
      fireEvent.click(screen.getByLabelText('Save hook'));
      await waitFor(() => expect(screen.getByText('Failed to save hook.')).toBeTruthy());
    });

    it('shows a not-found error when the hook id does not exist', async () => {
      api.listHooks.mockResolvedValue({ success: true, data: [makeHook({ id: 'other' })] });
      render(<HookEditorView />);
      expect(await screen.findByText('Hook not found.')).toBeTruthy();
    });

    it('shows an error when loading the hook fails', async () => {
      api.listHooks.mockResolvedValue({ success: false, error: 'load failed' });
      render(<HookEditorView />);
      expect(await screen.findByText('load failed')).toBeTruthy();
    });

    it('shows a default error when loading the hook fails without a message', async () => {
      api.listHooks.mockResolvedValue({ success: false });
      render(<HookEditorView />);
      expect(await screen.findByText('Failed to load hook.')).toBeTruthy();
    });

    it('shows an error when loading the hook throws', async () => {
      api.listHooks.mockRejectedValue(new Error('late'));
      render(<HookEditorView />);
      expect(await screen.findByText('late')).toBeTruthy();
    });

    it('shows a default error when loading the hook throws a non-Error', async () => {
      api.listHooks.mockRejectedValue('weird');
      render(<HookEditorView />);
      expect(await screen.findByText('Failed to load hook.')).toBeTruthy();
    });

    it('ignores a resolved load after the view unmounts', async () => {
      let resolveHooks: (value: unknown) => void = () => {};
      api.listHooks.mockImplementation(
        () =>
          new Promise(resolve => {
            resolveHooks = resolve;
          }),
      );
      const { unmount } = render(<HookEditorView />);
      unmount();
      resolveHooks({ success: true, data: [makeHook()] });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });
});
