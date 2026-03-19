import { ipcMain, dialog, BrowserWindow } from 'electron';
import { ScreenshotManager } from './ScreenshotManager';
import { renderToMain } from '@shared/ipc/screenshot';
import type { ScreenshotSettings } from '@shared/ipc/screenshot';
import { getUnifiedLogger } from '../unifiedLogger';
import { registerScreenshotShortcut } from './screenshotShortcut';
import { isFeatureEnabled } from '../featureFlags';

const logger = getUnifiedLogger();

let isRegistered = false;

async function getAppCacheManager() {
  const { appCacheManager } = await import('../userDataADO');
  return appCacheManager;
}

export interface ScreenshotIPCOptions {
  getCurrentUserAlias: () => string | null;
}

async function getSettings(): Promise<ScreenshotSettings> {
  const acManager = await getAppCacheManager();
  const settings = acManager.getScreenshotSettings();
  // When the feature flag is disabled, force enabled=false
  if (!isFeatureEnabled('kosmosFeatureScreenshot')) {
    return { ...settings, enabled: false };
  }
  return settings;
}

export const registerScreenshotIPC = (mainWindow: BrowserWindow, options: ScreenshotIPCOptions): void => {
  if (isRegistered) return;

  const screenshotManager = ScreenshotManager.getInstance();
  screenshotManager.setMainWindow(mainWindow);

  const handle = renderToMain.bindMain(ipcMain);

  handle.capture(async (_event, callback = true) => {
    return await screenshotManager.capture(callback);
  });

  handle.selectionStart(async (_event, displayId) => {
    logger.info('[ScreenshotIPC] selectionStart invoked');
    screenshotManager.onSelectionStart(displayId);
  });

  handle.saveToFile(async (_event, displayId, rect, imageData) => {
    const savePath = (await getSettings())?.savePath || undefined;
    return await screenshotManager.saveToFile(displayId, rect, imageData, savePath);
  });

  handle.copyToClipboard(async (_event, displayId, rect) => {
    return await screenshotManager.copyToClipboard(displayId, rect);
  });

  handle.sendToMain((_event, displayId, rect, imageData) => {
    return screenshotManager.sendToMain(displayId, rect, imageData);
  });

  handle.close(async () => {
    screenshotManager.cleanup();
  });

  handle.getInitData(async (_event, displayId) => {
    return screenshotManager.getInitData(displayId);
  });

  handle.getSettings(async () => {
    const settings = await getSettings();
    return { success: true, data: settings };
  });

  handle.updateSettings(async (_event, newSettings) => {
    const acManager = await getAppCacheManager();
    const success = await acManager.updateScreenshotSettings(newSettings);
    if (!success) return { success: false, error: 'Failed to update screenshot settings' };
    registerScreenshotShortcut(options);
    return { success: true };
  });

  handle.selectSavePath(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Screenshot Save Directory',
    });
    if (Array.isArray(result)) {
      return { success: true, data: result.length === 0 ? null : result[0] };
    }
    const dialogResult = result as any;
    if (dialogResult.canceled || !dialogResult.filePaths?.length) {
      return { success: true, data: null };
    }
    return { success: true, data: dialogResult.filePaths[0] };
  });

  handle.rejectFre(async () => {
    const acManager = await getAppCacheManager();
    const success = await acManager.updateScreenshotSettings({ freRejected: true });
    if (!success) return { success: false, error: 'Failed to update settings' };
    return { success: true };
  });

  handle.navigateToSettings(async () => {
    screenshotManager.cleanup();
    // Navigate main window to screenshot settings
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('navigate:to', { route: '/settings/screenshot' });
    }
    return { success: true };
  });

  isRegistered = true;
  logger.info('[ScreenshotIPC] IPC handlers registered');
};
