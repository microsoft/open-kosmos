/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AgentHooksView from '../AgentHooksView';
import type { HookDefinition } from '@shared/ipc/agentHooks';

const api = vi.hoisted(() => ({
  listHooks: vi.fn(),
  getMasterSwitch: vi.fn(),
  setMasterSwitch: vi.fn(),
  createHook: vi.fn(),
  updateHook: vi.fn(),
  deleteHook: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const routerState = vi.hoisted(() => ({ search: '' }));
const mcpClientCacheManager = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('../../../ipc/agentHooks', () => ({ agentHooksApi: api }));
vi.mock('../../../lib/mcp/mcpClientCacheManager', () => ({ mcpClientCacheManager }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useSearchParams: () => [new URLSearchParams(routerState.search)],
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

async function renderView() {
  render(<AgentHooksView />);
  await screen.findByText('Hooks', { selector: '.header-name' });
}

function openMenu(name: string) {
  fireEvent.click(screen.getByLabelText(`Hook options for ${name}`));
}

function clickAddHook() {
  fireEvent.click(screen.getByLabelText('Add hook'));
}

describe('AgentHooksView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigateMock.mockClear();
    routerState.search = '';
    api.listHooks.mockResolvedValue({ success: true, data: [] });
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: true });
    api.setMasterSwitch.mockResolvedValue({ success: true });
    api.createHook.mockResolvedValue({ success: true });
    api.updateHook.mockResolvedValue({ success: true });
    api.deleteHook.mockResolvedValue({ success: true });
    mcpClientCacheManager.refresh.mockResolvedValue(undefined);
  });

  it('shows a loading state then the view', async () => {
    render(<AgentHooksView />);
    expect(screen.getByText('Loading hooks…')).toBeTruthy();
    await screen.findByText('Hooks', { selector: '.header-name' });
  });

  it('renders an error when loading hooks fails', async () => {
    api.listHooks.mockResolvedValue({ success: false, error: 'load failed' });
    await renderView();
    expect(screen.getByText('load failed')).toBeTruthy();
  });

  it('uses a default error when the hooks failure has no message', async () => {
    api.listHooks.mockResolvedValue({ success: false });
    await renderView();
    expect(screen.getByText('Failed to load hooks.')).toBeTruthy();
  });

  it('tolerates a failed master switch without crashing', async () => {
    api.getMasterSwitch.mockResolvedValue({ success: false, enabled: false });
    await renderView();
    expect((screen.getByLabelText('Enable hooks') as HTMLInputElement).checked).toBe(false);
  });

  it('uses the shared settings toggle style for the master switch', async () => {
    await renderView();
    const input = screen.getByLabelText('Enable hooks');
    expect(input.closest('.toolbar-toggle-wrapper')).toBeTruthy();
    expect(input.nextElementSibling?.className).toContain('toolbar-toggle-track');
  });

  it('renders an error when the initial load throws', async () => {
    api.listHooks.mockRejectedValue(new Error('boom'));
    await renderView();
    expect(screen.getByText('boom')).toBeTruthy();
  });

  it('renders a default error when the initial load throws a non-Error', async () => {
    api.listHooks.mockRejectedValue('weird');
    await renderView();
    expect(screen.getByText('Failed to load hooks.')).toBeTruthy();
  });

  it('asks for confirmation before enabling, then enables', async () => {
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: false });
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable hooks'));
    expect(screen.getByText(/execute local shell commands/)).toBeTruthy();
    expect(screen.getByText(/send prompt, tool, or session data to remote HTTP endpoints/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Confirm enable hooks'));
    await waitFor(() => expect(api.setMasterSwitch).toHaveBeenCalledWith(true));
    expect(mcpClientCacheManager.refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels the enable confirmation', async () => {
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: false });
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable hooks'));
    fireEvent.click(screen.getByLabelText('Cancel enable hooks'));
    expect(screen.queryByText(/execute local shell commands/)).toBeNull();
    expect(screen.queryByText(/remote HTTP endpoints/)).toBeNull();
    expect(api.setMasterSwitch).not.toHaveBeenCalled();
  });

  it('disables directly without confirmation when already enabled', async () => {
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: true });
    const listener = vi.fn();
    window.addEventListener('agent-hooks-master-switch-changed', listener);
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable hooks'));
    await waitFor(() => expect(api.setMasterSwitch).toHaveBeenCalledWith(false));
    expect(mcpClientCacheManager.refresh).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: { enabled: false } }));
    window.removeEventListener('agent-hooks-master-switch-changed', listener);
    expect(screen.getByTestId('agent-hooks-disabled-state')).toBeTruthy();
    expect(screen.getByText('Hooks Disabled')).toBeTruthy();
  });

  it('shows a disabled zero state when mounted directly with the master switch off', async () => {
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: false });
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    expect(screen.getByText('Hooks Disabled')).toBeTruthy();
    expect(screen.getByText('Enable hooks with the master switch to manage hook definitions.')).toBeTruthy();
    expect(screen.getByText('Hooks stay inactive until this setting is turned on.')).toBeTruthy();
    expect(screen.getByLabelText('Enable hooks from empty state')).toHaveClass('agent-hooks-disabled-primary');
    expect(screen.queryByLabelText('Hook options for My Hook')).toBeNull();
  });

  it('opens the enable confirmation from the disabled zero state button', async () => {
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: false });
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable hooks from empty state'));
    expect(screen.getByText(/execute local shell commands/)).toBeTruthy();
    expect(api.setMasterSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Confirm enable hooks'));
    await waitFor(() => expect(api.setMasterSwitch).toHaveBeenCalledWith(true));
  });

  it('shows an error when updating the master switch fails', async () => {
    api.setMasterSwitch.mockResolvedValue({ success: false, error: 'switch failed' });
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: true });
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable hooks'));
    await waitFor(() => expect(screen.getByText('switch failed')).toBeTruthy());
  });

  it('navigates to the full-page New Hook view from the plus button', async () => {
    await renderView();
    clickAddHook();
    expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks/new');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('navigates to the full-page Edit Hook view from the row menu', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Edit My Hook'));
    expect(navigateMock).toHaveBeenCalledWith('/settings/agent-hooks/edit/h1');
  });

  it('selects a hook and shows its read-only detail', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    fireEvent.click(screen.getByLabelText('Select My Hook'));
    expect(screen.getByText('Action')).toBeTruthy();
  });

  it('default-selects the first hook on open so the detail pane is populated', async () => {
    api.listHooks.mockResolvedValue({
      success: true,
      data: [makeHook({ id: 'h1', name: 'First Hook' }), makeHook({ id: 'h2', name: 'Second Hook' })],
    });
    await renderView();
    expect(screen.getByText('First Hook', { selector: '.hook-detail-name' })).toBeTruthy();
  });

  it('selects the hook named by the selectHook query param on open', async () => {
    routerState.search = 'selectHook=h2';
    api.listHooks.mockResolvedValue({
      success: true,
      data: [makeHook({ id: 'h1', name: 'First Hook' }), makeHook({ id: 'h2', name: 'Second Hook' })],
    });
    await renderView();
    expect(screen.getByText('Second Hook', { selector: '.hook-detail-name' })).toBeTruthy();
  });

  it('falls back to the first hook when the selectHook param does not match', async () => {
    routerState.search = 'selectHook=missing';
    api.listHooks.mockResolvedValue({
      success: true,
      data: [makeHook({ id: 'h1', name: 'First Hook' }), makeHook({ id: 'h2', name: 'Second Hook' })],
    });
    await renderView();
    expect(screen.getByText('First Hook', { selector: '.hook-detail-name' })).toBeTruthy();
  });

  it('opens and closes the row menu from the same trigger', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    expect(screen.getByLabelText('Edit My Hook')).toBeTruthy();
    openMenu('My Hook');
    expect(screen.queryByLabelText('Edit My Hook')).toBeNull();
  });

  it('closes the row menu when clicking outside it', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    expect(screen.getByLabelText('Edit My Hook')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByLabelText('Edit My Hook')).toBeNull());
  });

  it('keeps the row menu open on mousedown inside the menu or on a trigger', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    fireEvent.mouseDown(screen.getByLabelText('Edit My Hook'));
    expect(screen.getByLabelText('Edit My Hook')).toBeTruthy();
    fireEvent.mouseDown(screen.getByLabelText('Hook options for My Hook'));
    expect(screen.getByLabelText('Edit My Hook')).toBeTruthy();
  });

  it('toggles a hook enabled state from the menu', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook({ enabled: true })] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Disable My Hook'));
    await waitFor(() => expect(api.updateHook).toHaveBeenCalledWith('h1', { enabled: false }));
  });

  it('selects and reviews a disabled hook before enabling it from the menu', async () => {
    const firstHook = makeHook({ id: 'first', name: 'First Hook', enabled: true });
    const reviewHook = makeHook({
      id: 'review',
      name: 'Review Hook',
      enabled: false,
      event: 'Stop',
      action: { type: 'http', method: 'POST', url: 'https://hooks.example/review', body: 'payload' },
    });
    api.listHooks
      .mockResolvedValueOnce({ success: true, data: [firstHook, reviewHook] })
      .mockResolvedValue({ success: true, data: [firstHook, { ...reviewHook, enabled: true }] });

    await renderView();
    expect(screen.getByText('First Hook', { selector: '.hook-detail-name' })).toBeTruthy();

    openMenu('Review Hook');
    expect(screen.getByText('Review Hook', { selector: '.hook-detail-name' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Enable Review Hook'));

    expect(api.updateHook).not.toHaveBeenCalled();
    expect(screen.getByText(/Review every operation below before enabling this hook/)).toBeTruthy();
    expect(screen.getAllByText('Stop')).toHaveLength(2);
    expect(screen.getAllByText('HTTP')).toHaveLength(2);
    expect(screen.getAllByText('https://hooks.example/review')).toHaveLength(2);

    fireEvent.click(screen.getByLabelText('Confirm enable hook'));
    await waitFor(() => expect(api.updateHook).toHaveBeenCalledWith('review', { enabled: true }));
  });

  it('cancels hook enable review without enabling', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook({ enabled: false })] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Enable My Hook'));
    fireEvent.click(screen.getByLabelText('Cancel enable hook'));

    expect(screen.queryByText(/Review every operation below/)).toBeNull();
    expect(api.updateHook).not.toHaveBeenCalled();
  });

  it('closes hook enable review when dismissed', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook({ enabled: false })] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Enable My Hook'));
    expect(screen.getByLabelText('Confirm enable hook')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByLabelText('Confirm enable hook')).toBeNull());
    expect(api.updateHook).not.toHaveBeenCalled();
  });

  it('shows a default error when enabling a hook fails without a message', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook({ enabled: false })] });
    api.updateHook.mockResolvedValue({ success: false });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Enable My Hook'));
    fireEvent.click(screen.getByLabelText('Confirm enable hook'));

    await waitFor(() => expect(screen.getByText('Failed to update hook.')).toBeTruthy());
  });

  it('shows an error when toggle fails', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    api.updateHook.mockResolvedValue({ success: false, error: 'toggle failed' });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Disable My Hook'));
    await waitFor(() => expect(screen.getByText('toggle failed')).toBeTruthy());
  });

  it('shows a default error when toggle fails without a message', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    api.updateHook.mockResolvedValue({ success: false });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Disable My Hook'));
    await waitFor(() => expect(screen.getByText('Failed to update hook.')).toBeTruthy());
  });

  it('shows a default error when refresh after a mutation fails', async () => {
    api.listHooks
      .mockResolvedValueOnce({ success: true, data: [makeHook()] })
      .mockResolvedValueOnce({ success: false });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Disable My Hook'));
    await waitFor(() => expect(screen.getByText('Failed to load hooks.')).toBeTruthy());
  });

  it('deletes a hook after confirmation', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    fireEvent.click(screen.getByLabelText('Confirm delete hook'));
    await waitFor(() => expect(api.deleteHook).toHaveBeenCalledWith('h1'));
  });

  it('cancels a delete without calling the API', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    fireEvent.click(screen.getByLabelText('Cancel delete hook'));
    expect(screen.queryByLabelText('Confirm delete hook')).toBeNull();
    expect(api.deleteHook).not.toHaveBeenCalled();
  });

  it('clears the selection after deleting the selected hook', async () => {
    api.listHooks
      .mockResolvedValueOnce({ success: true, data: [makeHook()] })
      .mockResolvedValue({ success: true, data: [] });
    await renderView();
    fireEvent.click(screen.getByLabelText('Select My Hook'));
    expect(screen.getByText('Action')).toBeTruthy();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    fireEvent.click(screen.getByLabelText('Confirm delete hook'));
    await waitFor(() => expect(screen.getByText('Select a hook to view its configuration.')).toBeTruthy());
  });

  it('shows an error when delete fails', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    api.deleteHook.mockResolvedValue({ success: false, error: 'delete failed' });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    fireEvent.click(screen.getByLabelText('Confirm delete hook'));
    await waitFor(() => expect(screen.getByText('delete failed')).toBeTruthy());
  });

  it('shows a default error when delete fails without a message', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    api.deleteHook.mockResolvedValue({ success: false });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    fireEvent.click(screen.getByLabelText('Confirm delete hook'));
    await waitFor(() => expect(screen.getByText('Failed to delete hook.')).toBeTruthy());
  });

  it('shows a default error when updating the master switch fails without a message', async () => {
    api.setMasterSwitch.mockResolvedValue({ success: false });
    api.getMasterSwitch.mockResolvedValue({ success: true, enabled: true });
    await renderView();
    fireEvent.click(screen.getByLabelText('Enable hooks'));
    await waitFor(() => expect(screen.getByText('Failed to update setting.')).toBeTruthy());
  });

  it('ignores a resolved load after the view unmounts', async () => {
    let resolveHooks: (value: unknown) => void = () => {};
    api.listHooks.mockImplementation(() => new Promise(resolve => {
      resolveHooks = resolve;
    }));
    const { unmount } = render(<AgentHooksView />);
    unmount();
    resolveHooks({ success: true, data: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.setMasterSwitch).not.toHaveBeenCalled();
  });

  it('ignores a rejected load after the view unmounts', async () => {
    let rejectHooks: (reason: unknown) => void = () => {};
    api.listHooks.mockImplementation(() => new Promise((_, reject) => {
      rejectHooks = reject;
    }));
    const { unmount } = render(<AgentHooksView />);
    unmount();
    rejectHooks(new Error('late'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.setMasterSwitch).not.toHaveBeenCalled();
  });

  it('closes the delete confirmation when dismissed without deleting', async () => {
    api.listHooks.mockResolvedValue({ success: true, data: [makeHook()] });
    await renderView();
    openMenu('My Hook');
    fireEvent.click(screen.getByLabelText('Delete My Hook'));
    expect(screen.getByLabelText('Confirm delete hook')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Confirm delete hook')).toBeNull());
    expect(api.deleteHook).not.toHaveBeenCalled();
  });
});
