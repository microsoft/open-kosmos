/**
 * Unit tests for browserControlIPC
 *
 * Verifies that registerBrowserControlIPC correctly wires each IPC channel
 * to the corresponding BrowserControlManager method.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Capture registered ipcMain.handle calls
const ipcHandlers: Record<string, Function> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      ipcHandlers[channel] = handler;
    }),
  },
}));

// Capture renderToMain.bindMain wired handlers
const boundHandlers: Record<string, Function> = {};

vi.mock('@shared/ipc/browserControl', () => ({
  renderToMain: {
    bindMain: vi.fn(() => {
      return new Proxy({} as any, {
        get(_target: any, key: string) {
          return (fn: Function) => {
            boundHandlers[key] = fn;
          };
        },
      });
    }),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Minimal BrowserControlManager stub
// ─────────────────────────────────────────────────────────────────────────────

function makeManagerMock() {
  return {
    getSettings: vi.fn().mockResolvedValue({ success: true, data: { browser: 'edge' } }),
    updateSettings: vi.fn().mockResolvedValue({ success: true }),
    enable: vi.fn().mockResolvedValue({ success: true }),
    disable: vi.fn().mockResolvedValue({ success: true }),
    getStatus: vi.fn().mockResolvedValue({ success: true, data: 'enabled' }),
    getInstallStatus: vi.fn().mockResolvedValue({ success: true }),
    launchBrowserWithSnap: vi.fn().mockResolvedValue({ success: true }),
    resolveBrowserInstallConfirm: vi.fn(),
    resolveNativeServerDownloadConfirm: vi.fn(),
    resolveBrowserRestartConfirm: vi.fn(),
    getUpdateStatus: vi.fn().mockResolvedValue({ success: true }),
    checkNativeServerUpdate: vi.fn().mockResolvedValue({ success: true }),
    updateNativeServer: vi.fn().mockResolvedValue({ success: true }),
    reinstallExtension: vi.fn().mockResolvedValue({ success: true }),
    cdpEnable: vi.fn().mockResolvedValue({ success: true }),
    cdpDisable: vi.fn().mockResolvedValue({ success: true }),
    cdpGetStatus: vi.fn().mockResolvedValue({ status: 'enabled' }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('registerBrowserControlIPC', () => {
  let manager: ReturnType<typeof makeManagerMock>;

  beforeEach(async () => {
    vi.resetModules();
    // Clear handler registries
    for (const key of Object.keys(ipcHandlers)) delete ipcHandlers[key];
    for (const key of Object.keys(boundHandlers)) delete boundHandlers[key];

    manager = makeManagerMock();
    const { registerBrowserControlIPC } = await import('../browserControlIPC');
    registerBrowserControlIPC(manager as any);
  });

  // --- renderToMain.bindMain handlers ---

  it('wires getSettings to manager.getSettings', async () => {
    const result = await boundHandlers['getSettings']();
    expect(manager.getSettings).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { browser: 'edge' } });
  });

  it('wires updateSettings to manager.updateSettings', async () => {
    const event = {} as any;
    await boundHandlers['updateSettings'](event, { browser: 'chrome' });
    expect(manager.updateSettings).toHaveBeenCalledWith({ browser: 'chrome' });
  });

  it('wires enable to manager.enable', async () => {
    await boundHandlers['enable']();
    expect(manager.enable).toHaveBeenCalled();
  });

  it('wires disable to manager.disable', async () => {
    await boundHandlers['disable']();
    expect(manager.disable).toHaveBeenCalled();
  });

  it('wires getStatus to manager.getStatus', async () => {
    await boundHandlers['getStatus']();
    expect(manager.getStatus).toHaveBeenCalled();
  });

  it('wires getInstallStatus to manager.getInstallStatus', async () => {
    await boundHandlers['getInstallStatus']();
    expect(manager.getInstallStatus).toHaveBeenCalled();
  });

  it('wires launchWithSnap to manager.launchBrowserWithSnap', async () => {
    await boundHandlers['launchWithSnap']();
    expect(manager.launchBrowserWithSnap).toHaveBeenCalled();
  });

  it('wires respondBrowserInstallConfirm to manager.resolveBrowserInstallConfirm', async () => {
    const event = {} as any;
    await boundHandlers['respondBrowserInstallConfirm'](event, 'req-1', true);
    expect(manager.resolveBrowserInstallConfirm).toHaveBeenCalledWith('req-1', true);
  });

  it('wires respondNativeServerDownloadConfirm to manager.resolveNativeServerDownloadConfirm', async () => {
    const event = {} as any;
    await boundHandlers['respondNativeServerDownloadConfirm'](event, 'req-2', false);
    expect(manager.resolveNativeServerDownloadConfirm).toHaveBeenCalledWith('req-2', false);
  });

  it('wires respondBrowserRestartConfirm to manager.resolveBrowserRestartConfirm', async () => {
    const event = {} as any;
    await boundHandlers['respondBrowserRestartConfirm'](event, 'req-3', true);
    expect(manager.resolveBrowserRestartConfirm).toHaveBeenCalledWith('req-3', true);
  });

  it('wires getUpdateStatus to manager.getUpdateStatus', async () => {
    await boundHandlers['getUpdateStatus']();
    expect(manager.getUpdateStatus).toHaveBeenCalled();
  });

  it('wires checkNativeServerUpdate to manager.checkNativeServerUpdate', async () => {
    await boundHandlers['checkNativeServerUpdate']();
    expect(manager.checkNativeServerUpdate).toHaveBeenCalled();
  });

  it('wires updateNativeServer to manager.updateNativeServer', async () => {
    await boundHandlers['updateNativeServer']();
    expect(manager.updateNativeServer).toHaveBeenCalled();
  });

  it('wires reinstallExtension to manager.reinstallExtension', async () => {
    await boundHandlers['reinstallExtension']();
    expect(manager.reinstallExtension).toHaveBeenCalled();
  });

  // --- ipcMain.handle (CDP / DevTools MCP) ---

  it('registers devToolsMcp:enable and routes to manager.cdpEnable', async () => {
    expect(ipcHandlers['devToolsMcp:enable']).toBeDefined();
    const result = await ipcHandlers['devToolsMcp:enable']();
    expect(manager.cdpEnable).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('registers devToolsMcp:disable and routes to manager.cdpDisable', async () => {
    expect(ipcHandlers['devToolsMcp:disable']).toBeDefined();
    const result = await ipcHandlers['devToolsMcp:disable']();
    expect(manager.cdpDisable).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('registers devToolsMcp:getStatus and routes to manager.cdpGetStatus', async () => {
    expect(ipcHandlers['devToolsMcp:getStatus']).toBeDefined();
    const result = await ipcHandlers['devToolsMcp:getStatus']();
    expect(manager.cdpGetStatus).toHaveBeenCalled();
    expect(result).toEqual({ status: 'enabled' });
  });
});
