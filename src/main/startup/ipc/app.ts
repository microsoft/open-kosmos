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

  // � New: check if app is ready (both Analytics and AgentChat are loaded)
  ipcMain.handle('app:isReady', () => {
    // In dev mode, or if any component is ready, we may want to show the UI
    // But for strict "fully ready" status, both must be complete
    return {
      success: true,
      data: ctx.isAnalyticsReady && ctx.isAgentChatReady
    };
  });

  // �🔥 New: platform detection IPC handler - for detecting Windows ARM and disabling Memory feature
  ipcMain.handle('app:getPlatformInfo', () => {
    const platform = process.platform;
    const arch = process.arch;
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
      return { success: true, data: manager.getConfig() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('app:updateAppConfig', async (_event, updates: any) => {
    try {
      const manager = await getAppCacheManager();
      await manager.updateConfig(updates);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

