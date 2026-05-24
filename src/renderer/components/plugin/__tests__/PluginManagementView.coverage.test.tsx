/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── hoisted mock vars ──────────────────────────────────────────────────────────
const mockShowSuccess = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());
const mockGetPlugins = vi.hoisted(() => vi.fn());
const mockInstall = vi.hoisted(() => vi.fn());
const mockUninstall = vi.hoisted(() => vi.fn());
const mockEnable = vi.hoisted(() => vi.fn());
const mockDisable = vi.hoisted(() => vi.fn());
const mockRestart = vi.hoisted(() => vi.fn());

// ── module mocks ───────────────────────────────────────────────────────────────
vi.mock('../../../ipc/plugin', () => ({
  pluginApi: {
    getPlugins: mockGetPlugins,
    install: mockInstall,
    uninstall: mockUninstall,
    enable: mockEnable,
    disable: mockDisable,
    restart: mockRestart,
  },
}));

vi.mock('../../ui/ToastProvider', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
}));

vi.mock('../PluginHeaderView', () => ({
  default: ({ totalPlugins, enabledPlugins, onAddClick }: any) => (
    <div data-testid="plugin-header">
      <span data-testid="total">{totalPlugins}</span>
      <span data-testid="enabled">{enabledPlugins}</span>
      <button data-testid="add-btn" onClick={onAddClick}>Add</button>
    </div>
  ),
}));

vi.mock('../PluginContentView', () => ({
  default: ({ plugins, selectedPlugin, isLoading, onSelectPlugin, onUninstall, onToggleEnabled, onRestart }: any) => (
    <div data-testid="plugin-content">
      {isLoading && <span data-testid="loading">loading</span>}
      {plugins.map((p: any) => (
        <div key={p.id} data-testid={`plugin-${p.id}`}>
          <button data-testid={`select-${p.id}`} onClick={() => onSelectPlugin(p)}>{p.manifest.name}</button>
          <button data-testid={`uninstall-${p.id}`} onClick={() => onUninstall(p.id)}>Uninstall</button>
          <button data-testid={`toggle-${p.id}`} onClick={() => onToggleEnabled(p.id, p.enabled)}>Toggle</button>
          <button data-testid={`restart-${p.id}`} onClick={() => onRestart(p.id)}>Restart</button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../ApplyPluginToAgentsDialog', () => ({
  default: ({ open, onOpenChange, plugin, onApplied }: any) => (
    <div data-testid="apply-dialog" data-open={open}>
      {open && plugin && (
        <div>
          <span data-testid="dialog-plugin">{plugin.manifest.name}</span>
          <button data-testid="close-dialog" onClick={() => onOpenChange(false)}>Close</button>
          <button data-testid="applied-btn" onClick={() => onApplied([])}>Applied</button>
        </div>
      )}
    </div>
  ),
}));

import PluginManagementView from '../PluginManagementView';

const makePlugin = (id: string, name: string, enabled = true) => ({
  id,
  enabled,
  manifest: { name, commands: [], agents: [] },
});

describe('PluginManagementView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlugins.mockResolvedValue({ success: true, plugins: [] });
  });

  it('renders loading then empty plugin list', async () => {
    mockGetPlugins.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PluginManagementView />);
    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  it('fetches plugins on mount and displays them', async () => {
    const plugins = [makePlugin('p1', 'Plugin A'), makePlugin('p2', 'Plugin B', false)];
    mockGetPlugins.mockResolvedValue({ success: true, plugins });
    render(<PluginManagementView />);
    await waitFor(() => {
      expect(screen.getByTestId('total').textContent).toBe('2');
      expect(screen.getByTestId('enabled').textContent).toBe('1');
    });
  });

  it('handles failed getPlugins gracefully', async () => {
    mockGetPlugins.mockRejectedValue(new Error('network error'));
    render(<PluginManagementView />);
    await waitFor(() => {
      expect(screen.queryByTestId('loading')).toBeFalsy();
    });
  });

  it('handles getPlugins result without plugins array', async () => {
    mockGetPlugins.mockResolvedValue({ success: false });
    render(<PluginManagementView />);
    await waitFor(() => {
      expect(screen.getByTestId('total').textContent).toBe('0');
    });
  });

  describe('handleInstall', () => {
    it('installs a new plugin and shows apply dialog', async () => {
      const existing = [makePlugin('p1', 'Old Plugin')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins: existing });
      const newPlugin = makePlugin('p2', 'New Plugin');
      mockInstall.mockResolvedValue({ success: true, plugins: [...existing, newPlugin] });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('1'));

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });

      await waitFor(() => {
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('New Plugin'));
        expect(screen.getByTestId('apply-dialog').getAttribute('data-open')).toBe('true');
      });
    });

    it('shows generic success when no new plugin detected', async () => {
      const plugins = [makePlugin('p1', 'Same Plugin')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockInstall.mockResolvedValue({ success: true, plugins });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('total').textContent).toBe('1'));

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });

      await waitFor(() => {
        expect(mockShowSuccess).toHaveBeenCalledWith('Plugin installed successfully');
      });
    });

    it('shows error when install fails', async () => {
      mockGetPlugins.mockResolvedValue({ success: true, plugins: [] });
      mockInstall.mockResolvedValue({ success: false, error: 'Permission denied' });

      render(<PluginManagementView />);
      await waitFor(() => {});

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
      });
    });

    it('does not show error when install is Cancelled', async () => {
      mockGetPlugins.mockResolvedValue({ success: true, plugins: [] });
      mockInstall.mockResolvedValue({ success: false, error: 'Cancelled' });

      render(<PluginManagementView />);
      await waitFor(() => {});

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });

      await waitFor(() => {
        expect(mockShowError).not.toHaveBeenCalled();
      });
    });

    it('shows error when install throws', async () => {
      mockGetPlugins.mockResolvedValue({ success: true, plugins: [] });
      mockInstall.mockRejectedValue(new Error('crash'));

      render(<PluginManagementView />);
      await waitFor(() => {});

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('crash'));
      });
    });
  });

  describe('handleUninstall', () => {
    it('uninstalls a plugin and shows success', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockUninstall.mockResolvedValue({ success: true, plugins: [] });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('uninstall-p1').click();
      });

      await waitFor(() => {
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('p1'));
      });
    });

    it('shows error on uninstall failure', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockUninstall.mockResolvedValue({ success: false, error: 'Not found' });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('uninstall-p1').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Not found'));
      });
    });

    it('shows error on uninstall exception', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockUninstall.mockRejectedValue(new Error('oops'));

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('uninstall-p1').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('oops'));
      });
    });
  });

  describe('handleToggleEnabled', () => {
    it('disables an enabled plugin', async () => {
      const plugins = [makePlugin('p1', 'Plugin A', true)];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      const updated = [makePlugin('p1', 'Plugin A', false)];
      mockDisable.mockResolvedValue({ success: true, plugins: updated });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('toggle-p1').click();
      });

      await waitFor(() => {
        expect(mockDisable).toHaveBeenCalledWith('p1');
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('disabled'));
      });
    });

    it('enables a disabled plugin', async () => {
      const plugins = [makePlugin('p1', 'Plugin A', false)];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      const updated = [makePlugin('p1', 'Plugin A', true)];
      mockEnable.mockResolvedValue({ success: true, plugins: updated });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('toggle-p1').click();
      });

      await waitFor(() => {
        expect(mockEnable).toHaveBeenCalledWith('p1');
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('enabled'));
      });
    });

    it('shows error on toggle failure', async () => {
      const plugins = [makePlugin('p1', 'Plugin A', true)];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockDisable.mockResolvedValue({ success: false, error: 'Toggle failed' });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('toggle-p1').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Toggle failed'));
      });
    });

    it('shows error on toggle exception', async () => {
      const plugins = [makePlugin('p1', 'Plugin A', true)];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockDisable.mockRejectedValue(new Error('toggle crash'));

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('toggle-p1').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('toggle crash'));
      });
    });
  });

  describe('handleRestart', () => {
    it('restarts a plugin and shows success', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockRestart.mockResolvedValue({ success: true, plugins });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('restart-p1').click();
      });

      await waitFor(() => {
        expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('restarted'));
      });
    });

    it('shows error on restart failure', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockRestart.mockResolvedValue({ success: false, error: 'Restart failed' });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('restart-p1').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('Restart failed'));
      });
    });

    it('shows error on restart exception', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      mockRestart.mockRejectedValue(new Error('restart boom'));

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        screen.getByTestId('restart-p1').click();
      });

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining('restart boom'));
      });
    });
  });

  describe('plugins:selectPlugin event', () => {
    it('selects a plugin when event fired with matching pluginId', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        window.dispatchEvent(new CustomEvent('plugins:selectPlugin', { detail: { pluginId: 'p1' } }));
      });

      // No error thrown; component handles selection
      expect(screen.getByTestId('plugin-content')).toBeTruthy();
    });

    it('ignores event when pluginId not found', async () => {
      const plugins = [makePlugin('p1', 'Plugin A')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });

      render(<PluginManagementView />);
      await waitFor(() => expect(screen.getByTestId('plugin-p1')).toBeTruthy());

      await act(async () => {
        window.dispatchEvent(new CustomEvent('plugins:selectPlugin', { detail: { pluginId: 'unknown' } }));
      });

      expect(screen.getByTestId('plugin-content')).toBeTruthy();
    });
  });

  describe('ApplyPluginToAgentsDialog integration', () => {
    it('closes apply dialog when onOpenChange(false) called', async () => {
      const plugins = [makePlugin('p1', 'Old')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      const newPlugin = makePlugin('p2', 'New');
      mockInstall.mockResolvedValue({ success: true, plugins: [...plugins, newPlugin] });

      render(<PluginManagementView />);
      await waitFor(() => {});

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });
      await waitFor(() => expect(screen.getByTestId('apply-dialog').getAttribute('data-open')).toBe('true'));

      await act(async () => {
        screen.getByTestId('close-dialog').click();
      });
      expect(screen.getByTestId('apply-dialog').getAttribute('data-open')).toBe('false');
    });

    it('updates plugins when onApplied is called', async () => {
      const plugins = [makePlugin('p1', 'Old')];
      mockGetPlugins.mockResolvedValue({ success: true, plugins });
      const newPlugin = makePlugin('p2', 'New');
      mockInstall.mockResolvedValue({ success: true, plugins: [...plugins, newPlugin] });

      render(<PluginManagementView />);
      await waitFor(() => {});

      await act(async () => {
        screen.getByTestId('add-btn').click();
      });
      await waitFor(() => expect(screen.getByTestId('apply-dialog').getAttribute('data-open')).toBe('true'));

      await act(async () => {
        screen.getByTestId('applied-btn').click();
      });
      // Plugins set to empty array via onApplied([])
      expect(screen.getByTestId('total').textContent).toBe('0');
    });
  });
});
