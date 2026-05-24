// @ts-nocheck
/**
 * plugin.ts IPC handler coverage tests
 */

// ─── mock variables ───────────────────────────────────────────────────────────

const mockHandle = vi.fn();
const mockRemoveHandler = vi.fn();
const mockShowOpenDialog = vi.fn();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: any[]) => mockHandle(...args),
    removeHandler: (...args: any[]) => mockRemoveHandler(...args),
  },
  dialog: {
    showOpenDialog: (...args: any[]) => mockShowOpenDialog(...args),
  },
}));

const mockGetPlugins = vi.fn().mockReturnValue([]);
const mockInstallPlugin = vi.fn();
const mockUninstallPlugin = vi.fn();
const mockEnablePluginForAgent = vi.fn();
const mockDisablePluginForAgent = vi.fn();
const mockEnablePlugin = vi.fn();
const mockDisablePlugin = vi.fn();
const mockRestartPlugin = vi.fn();

vi.mock('../../../lib/plugin/pluginManager', () => ({
  pluginManager: {
    getPlugins: (...args: any[]) => mockGetPlugins(...args),
    installPlugin: (...args: any[]) => mockInstallPlugin(...args),
    uninstallPlugin: (...args: any[]) => mockUninstallPlugin(...args),
    enablePluginForAgent: (...args: any[]) => mockEnablePluginForAgent(...args),
    disablePluginForAgent: (...args: any[]) => mockDisablePluginForAgent(...args),
    enablePlugin: (...args: any[]) => mockEnablePlugin(...args),
    disablePlugin: (...args: any[]) => mockDisablePlugin(...args),
    restartPlugin: (...args: any[]) => mockRestartPlugin(...args),
  },
}));

vi.mock('../../../../shared/ipc/plugin', async () => {
  const { connectRenderToMain } = await import('../../../../shared/ipc/base');
  return { renderToMain: connectRenderToMain('plugin') };
});

vi.mock('../../../lib/unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── helpers ──────────────────────────────────────────────────────────────────

function getHandler(channel: string): Function {
  const call = mockHandle.mock.calls.find(([name]) => name === channel);
  if (!call) throw new Error(`Handler not registered for: ${channel}`);
  return call[1];
}

async function setup(ctx: any = {}) {
  vi.clearAllMocks();
  mockGetPlugins.mockReturnValue([{ id: 'plugin-1' }]);
  mockInstallPlugin.mockResolvedValue({});
  mockUninstallPlugin.mockResolvedValue({});
  mockEnablePluginForAgent.mockResolvedValue({});
  mockDisablePluginForAgent.mockResolvedValue({});
  mockEnablePlugin.mockResolvedValue({});
  mockDisablePlugin.mockResolvedValue({});
  mockRestartPlugin.mockResolvedValue({});

  const handlePluginIPC = (await import('../plugin')).default;
  handlePluginIPC({ mainWindow: { id: 1 } as any, ...ctx } as any);
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('plugin IPC handlers (coverage)', () => {
  afterEach(() => vi.resetModules());

  // ── getPlugins ──────────────────────────────────────────────────────────────

  describe('plugin:getPlugins', () => {
    it('returns plugins on success', async () => {
      await setup();
      const handler = getHandler('plugin:getPlugins');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.plugins).toEqual([{ id: 'plugin-1' }]);
    });

    it('returns error on exception', async () => {
      await setup();
      mockGetPlugins.mockImplementationOnce(() => { throw new Error('Get error'); });
      const handler = getHandler('plugin:getPlugins');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Get error');
    });
  });

  // ── install ─────────────────────────────────────────────────────────────────

  describe('plugin:install', () => {
    it('returns error when no mainWindow', async () => {
      await setup({ mainWindow: null });
      const handler = getHandler('plugin:install');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('No main window');
    });

    it('returns error when dialog is cancelled', async () => {
      await setup();
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      const handler = getHandler('plugin:install');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cancelled');
    });

    it('returns error when no filePaths selected', async () => {
      await setup();
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
      const handler = getHandler('plugin:install');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cancelled');
    });

    it('returns error when installPlugin returns error', async () => {
      await setup();
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/path/to/plugin'] });
      mockInstallPlugin.mockResolvedValueOnce({ error: 'Invalid plugin' });
      const handler = getHandler('plugin:install');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid plugin');
    });

    it('returns plugins on success', async () => {
      await setup();
      mockShowOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/path/to/plugin'] });
      mockInstallPlugin.mockResolvedValueOnce({});
      const handler = getHandler('plugin:install');
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.plugins).toBeDefined();
    });

    it('returns error on exception', async () => {
      await setup();
      mockShowOpenDialog.mockRejectedValueOnce(new Error('Dialog error'));
      const handler = getHandler('plugin:install');
      const result = await handler({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Dialog error');
    });
  });

  // ── installFromPath ─────────────────────────────────────────────────────────

  describe('plugin:installFromPath', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockInstallPlugin.mockResolvedValueOnce({});
      const handler = getHandler('plugin:installFromPath');
      const result = await handler({}, '/path/to/plugin');
      expect(result.success).toBe(true);
      expect(result.plugins).toBeDefined();
    });

    it('returns error when installPlugin returns error', async () => {
      await setup();
      mockInstallPlugin.mockResolvedValueOnce({ error: 'Bad plugin' });
      const handler = getHandler('plugin:installFromPath');
      const result = await handler({}, '/path/to/plugin');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Bad plugin');
    });

    it('returns error on exception', async () => {
      await setup();
      mockInstallPlugin.mockRejectedValueOnce(new Error('Install failed'));
      const handler = getHandler('plugin:installFromPath');
      const result = await handler({}, '/path/to/plugin');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Install failed');
    });
  });

  // ── uninstall ───────────────────────────────────────────────────────────────

  describe('plugin:uninstall', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockUninstallPlugin.mockResolvedValueOnce({});
      const handler = getHandler('plugin:uninstall');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(true);
    });

    it('returns error when uninstallPlugin returns error', async () => {
      await setup();
      mockUninstallPlugin.mockResolvedValueOnce({ error: 'Cannot uninstall' });
      const handler = getHandler('plugin:uninstall');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot uninstall');
    });

    it('returns error on exception', async () => {
      await setup();
      mockUninstallPlugin.mockRejectedValueOnce(new Error('Uninstall failed'));
      const handler = getHandler('plugin:uninstall');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });
  });

  // ── enableForAgent ──────────────────────────────────────────────────────────

  describe('plugin:enableForAgent', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockEnablePluginForAgent.mockResolvedValueOnce({});
      const handler = getHandler('plugin:enableForAgent');
      const result = await handler({}, 'plugin-1', 'user', 'chat-1');
      expect(result.success).toBe(true);
    });

    it('returns error when enablePluginForAgent returns error', async () => {
      await setup();
      mockEnablePluginForAgent.mockResolvedValueOnce({ error: 'Already enabled' });
      const handler = getHandler('plugin:enableForAgent');
      const result = await handler({}, 'plugin-1', 'user', 'chat-1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      await setup();
      mockEnablePluginForAgent.mockRejectedValueOnce(new Error('Enable failed'));
      const handler = getHandler('plugin:enableForAgent');
      const result = await handler({}, 'plugin-1', 'user', 'chat-1');
      expect(result.success).toBe(false);
    });
  });

  // ── disableForAgent ─────────────────────────────────────────────────────────

  describe('plugin:disableForAgent', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockDisablePluginForAgent.mockResolvedValueOnce({});
      const handler = getHandler('plugin:disableForAgent');
      const result = await handler({}, 'plugin-1', 'user', 'chat-1');
      expect(result.success).toBe(true);
    });

    it('returns error when disablePluginForAgent returns error', async () => {
      await setup();
      mockDisablePluginForAgent.mockResolvedValueOnce({ error: 'Not enabled' });
      const handler = getHandler('plugin:disableForAgent');
      const result = await handler({}, 'plugin-1', 'user', 'chat-1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      await setup();
      mockDisablePluginForAgent.mockRejectedValueOnce(new Error('Disable failed'));
      const handler = getHandler('plugin:disableForAgent');
      const result = await handler({}, 'plugin-1', 'user', 'chat-1');
      expect(result.success).toBe(false);
    });
  });

  // ── enable ──────────────────────────────────────────────────────────────────

  describe('plugin:enable', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockEnablePlugin.mockResolvedValueOnce({});
      const handler = getHandler('plugin:enable');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(true);
    });

    it('returns error when enablePlugin returns error', async () => {
      await setup();
      mockEnablePlugin.mockResolvedValueOnce({ error: 'Enable failed' });
      const handler = getHandler('plugin:enable');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      await setup();
      mockEnablePlugin.mockRejectedValueOnce(new Error('Enable threw'));
      const handler = getHandler('plugin:enable');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });
  });

  // ── disable ─────────────────────────────────────────────────────────────────

  describe('plugin:disable', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockDisablePlugin.mockResolvedValueOnce({});
      const handler = getHandler('plugin:disable');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(true);
    });

    it('returns error when disablePlugin returns error', async () => {
      await setup();
      mockDisablePlugin.mockResolvedValueOnce({ error: 'Disable failed' });
      const handler = getHandler('plugin:disable');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      await setup();
      mockDisablePlugin.mockRejectedValueOnce(new Error('Disable threw'));
      const handler = getHandler('plugin:disable');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });
  });

  // ── restart ─────────────────────────────────────────────────────────────────

  describe('plugin:restart', () => {
    it('returns plugins on success', async () => {
      await setup();
      mockRestartPlugin.mockResolvedValueOnce({});
      const handler = getHandler('plugin:restart');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(true);
    });

    it('returns error when restartPlugin returns error', async () => {
      await setup();
      mockRestartPlugin.mockResolvedValueOnce({ error: 'Restart failed' });
      const handler = getHandler('plugin:restart');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      await setup();
      mockRestartPlugin.mockRejectedValueOnce(new Error('Restart threw'));
      const handler = getHandler('plugin:restart');
      const result = await handler({}, 'plugin-1');
      expect(result.success).toBe(false);
    });
  });
});
