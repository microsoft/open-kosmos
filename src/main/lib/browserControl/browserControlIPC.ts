/**
 * browserControlIPC — type-safe IPC bridge via shared/ipc framework.
 * Delegates everything to BrowserControlManager.
 */

import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/browserControl';
import { BrowserControlManager } from './BrowserControlManager';

export function registerBrowserControlIPC(manager: BrowserControlManager): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.getSettings(async () => manager.getSettings());
  handle.updateSettings(async (_e, settings) => manager.updateSettings(settings));
  handle.enable(async () => manager.enable());
  handle.disable(async () => manager.disable());
  handle.getStatus(async () => manager.getStatus());
  handle.getInstallStatus(async () => manager.getInstallStatus());
  handle.launchWithSnap(async () => manager.launchBrowserWithSnap());
  handle.respondBrowserInstallConfirm(async (_e, requestId, confirmed) => {
    manager.resolveBrowserInstallConfirm(requestId, confirmed);
  });
  handle.respondNativeServerDownloadConfirm(async (_e, requestId, confirmed) => {
    manager.resolveNativeServerDownloadConfirm(requestId, confirmed);
  });
  handle.respondBrowserRestartConfirm(async (_e, requestId, confirmed) => {
    manager.resolveBrowserRestartConfirm(requestId, confirmed);
  });
  handle.getUpdateStatus(async () => manager.getUpdateStatus());
  handle.checkNativeServerUpdate(async () => manager.checkNativeServerUpdate());
  handle.updateNativeServer(async () => manager.updateNativeServer());
  handle.reinstallExtension(async () => manager.reinstallExtension());

  // CDP (DevTools MCP) handlers
  ipcMain.handle('devToolsMcp:enable', async () => manager.cdpEnable());
  ipcMain.handle('devToolsMcp:disable', async () => manager.cdpDisable());
  ipcMain.handle('devToolsMcp:getStatus', async () => manager.cdpGetStatus());
}
