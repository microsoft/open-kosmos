import { app, ipcMain } from 'electron';

import { crashCaptureManager, type RendererCrashReport } from '../../lib/crash/CrashCaptureManager';
import { getAppCacheManager } from '../lazy';

import type { Context } from './shared';
import { getOrCreateInstallationDeviceId } from "../../lib/utilities/idFactory";

export default function(ctx: Context) {
  // IPC event handlers
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getName', () => app.getName());
  ipcMain.handle('app:isDev', () => ctx.isDev);

  // Check whether AgentChat has finished loading.
  ipcMain.handle('app:isReady', () => {
    return {
      success: true,
      data: ctx.isAgentChatReady
    };
  });

  // 🔥 New: platform detection IPC handler
  ipcMain.handle('app:getPlatformInfo', () => {
    const platform = process.platform; // 'win32', 'darwin', 'linux'
    const arch = process.arch; // 'arm64', 'x64', 'ia32'
    const isWindowsArm = platform === 'win32' && arch === 'arm64';

    return {
      platform,
      arch,
      isWindowsArm,
    };
  });

  // 🔥 New: get userData path - for local resource access (e.g., FRE videos)
  ipcMain.handle('app:getUserDataPath', () => {
    return app.getPath('userData');
  });

  ipcMain.handle('app:getInstallationDeviceId', async () => {
    return getOrCreateInstallationDeviceId();
  });

  ipcMain.handle('app:getCrashCaptureStatus', () => {
    return crashCaptureManager.getStatus();
  });

  ipcMain.handle('app:recordCrashBreadcrumb', (_event, message: string, metadata?: Record<string, unknown>) => {
    crashCaptureManager.recordRendererBreadcrumb(message, metadata);
  });

  ipcMain.handle('app:reportRendererError', (_event, report: RendererCrashReport) => {
    crashCaptureManager.reportRendererError(report);
  });

  // 🆕 AppConfig IPC handlers — managed by AppCacheManager for app.json
  ipcMain.handle('app:getAppConfig', async () => {
    try {
      const manager = await getAppCacheManager();
      return { success: true, data: manager.getConfig(), revision: manager.getConfigRevision() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('app:updateAppConfig', async (_event, updates: any) => {
    try {
      const manager = await getAppCacheManager();
      const result = await manager.updateConfig(updates);
      return { success: true, revision: result.revision };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
