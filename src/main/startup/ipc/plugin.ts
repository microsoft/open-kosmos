/**
 * Plugin IPC handlers — type-safe via the shared IPC framework.
 */

import { ipcMain, dialog } from 'electron';
import type { Context } from './shared';
import { pluginManager } from '../../lib/plugin/pluginManager';
import { renderToMain } from '../../../shared/ipc/plugin';
import { createLogger } from '../../lib/unifiedLogger';

const logger = createLogger();

export default function handlePluginIPC(ctx: Context) {
  const main = renderToMain.bindMain(ipcMain);

  main.getPlugins(async () => {
    try {
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] getPlugins failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.install(async () => {
    try {
      if (!ctx.mainWindow) {
        return { success: false, error: 'No main window' };
      }

      const dialogResult = await dialog.showOpenDialog(ctx.mainWindow, {
        title: 'Select Plugin Directory',
        properties: ['openDirectory'],
      });

      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { success: false, error: 'Cancelled' };
      }

      const sourceDir = dialogResult.filePaths[0];
      const result = await pluginManager.installPlugin(sourceDir);

      if (result.error) {
        return { success: false, error: result.error };
      }

      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] install failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.installFromPath(async (_event, sourceDir) => {
    try {
      const result = await pluginManager.installPlugin(sourceDir);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] installFromPath failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.uninstall(async (_event, pluginId) => {
    try {
      const result = await pluginManager.uninstallPlugin(pluginId);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] uninstall failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.enableForAgent(async (_event, pluginId, userAlias, chatId) => {
    try {
      const result = await pluginManager.enablePluginForAgent(pluginId, userAlias, chatId);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] enableForAgent failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.disableForAgent(async (_event, pluginId, userAlias, chatId) => {
    try {
      const result = await pluginManager.disablePluginForAgent(pluginId, userAlias, chatId);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] disableForAgent failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.enable(async (_event, pluginId) => {
    try {
      const result = await pluginManager.enablePlugin(pluginId);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] enable failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.disable(async (_event, pluginId) => {
    try {
      const result = await pluginManager.disablePlugin(pluginId);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] disable failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });

  main.restart(async (_event, pluginId) => {
    try {
      const result = await pluginManager.restartPlugin(pluginId);
      if (result.error) {
        return { success: false, error: result.error };
      }
      return { success: true, plugins: pluginManager.getPlugins() };
    } catch (e) {
      logger.error(`[PluginIPC] restart failed: ${e}`);
      return { success: false, error: String(e) };
    }
  });
}
