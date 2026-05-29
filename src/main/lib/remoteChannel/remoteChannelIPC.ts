import { ipcMain, BrowserWindow } from 'electron';
import { renderToMain, mainToRender } from '@shared/ipc/remoteChannel';
import type { ChannelStatusInfo } from '@shared/ipc/remoteChannel';
import type { ProfileCacheManager } from '../userDataADO/profileCacheManager';
import type { RemoteChannelManager } from './channelManager';
import { createLogger } from '../unifiedLogger';
import { credentialStore } from "./credentialStore";

const logger = createLogger();

/**
 * Register remote channel IPC handlers
 *
 * @param deps Dependency injection, lazily obtains manager instances
 */
export function registerRemoteChannelIPC(deps: {
  getAlias: () => string | null;
  getProfileCacheManager: () => Promise<ProfileCacheManager>;
  getRemoteChannelManager: () => Promise<RemoteChannelManager>;
}) {
  const handle = renderToMain.bindMain(ipcMain);

  // ──────── Config read/write ────────

  handle.getConfig(async () => {
    try {
      const alias = deps.getAlias();
      if (!alias) return { success: false, error: 'User not logged in' };
      const pcManager = await deps.getProfileCacheManager();
      const profile = pcManager.getCachedProfile(alias);
      return { success: true, data: profile?.remoteChannels || {} };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.updateConfig(async (_event, config) => {
    try {
      const alias = deps.getAlias();
      if (!alias) return { success: false, error: 'User not logged in' };

      const pcManager = await deps.getProfileCacheManager();
      await pcManager.updateRemoteChannelsConfig(alias, config);

      // Check which channels are affected, only restart running channels
      const channelManager = await deps.getRemoteChannelManager();
      for (const channelId of Object.keys(config)) {
        const status = channelManager.getChannelStatus(channelId);
        if (status && status.status !== 'stopped') {
          await channelManager.restartChannel(channelId);
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ──────── Status & Control ────────

  handle.getStatus(async (_event, channelId) => {
    try {
      const manager = await deps.getRemoteChannelManager();
      return { success: true, data: manager.getChannelStatus(channelId) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.getAllStatus(async () => {
    try {
      const manager = await deps.getRemoteChannelManager();
      return { success: true, data: manager.getAllChannelStatus() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.start(async (_event, channelId) => {
    try {
      const manager = await deps.getRemoteChannelManager();
      await manager.startChannel(channelId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.stop(async (_event, channelId) => {
    try {
      const manager = await deps.getRemoteChannelManager();
      await manager.stopChannel(channelId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // ──────── Binding Management ────────

  handle.bind(async (_event, { channelId, code }) => {
    try {
      const alias = deps.getAlias();
      if (!alias) return { success: false, error: 'User not logged in' };

      const manager = await deps.getRemoteChannelManager();
      const result = await manager.bind(channelId, code);
      return { success: true, data: { userId: result.userId } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.unbind(async (_event, { channelId }) => {
    try {
      const alias = deps.getAlias();
      if (!alias) return { success: false, error: 'User not logged in' };

      const manager = await deps.getRemoteChannelManager();
      await manager.unbind(channelId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  handle.getBindingStatus(async (_event, { channelId }) => {
    try {
      const alias = deps.getAlias();
      if (!alias) return { success: false, error: 'User not logged in' };

      const token = await credentialStore.getCredential(alias, channelId, 'bindingToken');
      const userId = await credentialStore.getCredential(alias, channelId, 'boundUserId');
      return { success: true, data: { bound: !!token, userId: userId || undefined } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

}

// ──────────────────────────────────────────────
// Status broadcasting
// ──────────────────────────────────────────────

/**
 * Broadcast channel status changes to all windows
 * Used by RemoteChannelManager.setStatusChangeListener()
 */
export function broadcastRemoteChannelStatus(info: ChannelStatusInfo): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      const sender = mainToRender.bindWebContents(win.webContents);
      sender.statusChanged(info);
    }
  });
}

/**
 * Broadcast binding status changes to all windows
 */
export function broadcastBindingChanged(info: { channelId: string; bound: boolean }): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      const sender = mainToRender.bindWebContents(win.webContents);
      sender.bindingChanged(info);
    }
  });
}
