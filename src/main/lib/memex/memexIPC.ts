/**
 * memexIPC — type-safe IPC bridge for Memex memory management.
 * Delegates everything to MemexManager.
 */

import { app, ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { renderToMain } from '@shared/ipc/memex';
import { isFeatureEnabled } from '../featureFlags';
import { MemexManager } from './MemexManager';
import { mcpClientManager as mgr } from "../mcpRuntime/mcpClientManager";

const MEMEX_DISABLED_ERROR = 'Memex Memory feature is disabled';

export function registerMemexIPC(manager: MemexManager): void {
  const handle = renderToMain.bindMain(ipcMain);

  handle.enable(async () => {
    if (!isFeatureEnabled('openkosmosFeatureMemexMemory')) {
      return { success: false, error: MEMEX_DISABLED_ERROR };
    }
    return manager.enable();
  });

  handle.disable(async () => {
    if (!isFeatureEnabled('openkosmosFeatureMemexMemory')) {
      return { success: false, error: MEMEX_DISABLED_ERROR };
    }
    return manager.disable();
  });

  handle.getStatus(async () => {
    if (!isFeatureEnabled('openkosmosFeatureMemexMemory')) {
      return { success: true, data: { enabled: false } };
    }
    return manager.getStatus();
  });
}

/**
 * One-call setup: create MemexManager, register IPC, return the manager.
 * Keeps index.ts thin.
 */
export function setupMemex(ctx: {
  currentUserAlias: string | null;
  mainWindow: BrowserWindow | null;
}, getProfileCacheManager: () => Promise<any>): MemexManager | undefined {
  if (!isFeatureEnabled('openkosmosFeatureMemexMemory')) {
    return undefined;
  }

  try {
    const manager = new MemexManager({
      getAlias: () => ctx.currentUserAlias || '',
      getProfileCacheManager,
      getMcpClientManager: async () => {
        return mgr;
      },
      getUserDataDir: () => app.getPath('userData'),
      getMainWindow: () => ctx.mainWindow,
    });
    registerMemexIPC(manager);
    return manager;
  } catch (err) {
    console.error('[MemexManager] Failed to initialize:', err);
    return undefined;
  }
}
