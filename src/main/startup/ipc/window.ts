import { ipcMain, Menu } from 'electron';

import type { Context } from './shared';

export default function(ctx: Context) {
  // Window management
  ipcMain.handle('window:minimize', () => ctx.mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => ctx.mainWindow?.maximize());
  ipcMain.handle('window:unmaximize', () => ctx.mainWindow?.unmaximize());
  ipcMain.handle('window:close', () => ctx.mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => ctx.mainWindow?.isMaximized() || false);
  ipcMain.handle('window:isFullScreen', () => ctx.mainWindow?.isFullScreen() || false);

  // Zoom management
  const syncWindowZoomWithPersistedState = async () => {
    const zoomLevel = await ctx.getPersistedWindowZoomLevel();
    return ctx.applyWindowZoomLevel(zoomLevel);
  };

  ipcMain.handle('window:zoomIn', async () => {
    return ctx.stepWindowZoomLevel(0.5);
  });
  ipcMain.handle('window:zoomOut', async () => {
    return ctx.stepWindowZoomLevel(-0.5);
  });
  ipcMain.handle('window:resetZoom', async () => {
    return ctx.resetWindowZoomLevel();
  });
  ipcMain.handle('window:getZoomLevel', async () => {
    return syncWindowZoomWithPersistedState();
  });

  // 🔥 New:Show app menu (Popup)
  ipcMain.handle('window:showAppMenu', (event, x: number, y: number) => {
    const template = ctx.getMenuTemplate();
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: ctx.mainWindow || undefined });
    return true;
  });

  // Window always on top management for minimal mode
  ipcMain.handle('window:setAlwaysOnTop', (event, flag: boolean) => {
    if (ctx.mainWindow) {
      ctx.mainWindow.setAlwaysOnTop(flag, 'floating');
      return true;
    }
    return false;
  });

  ipcMain.handle('window:isAlwaysOnTop', () => {
    return ctx.mainWindow?.isAlwaysOnTop() || false;
  });

  // Chat popup window management
  ipcMain.handle('window:setSize', (event, width: number, height: number) => {
    if (ctx.mainWindow) {
      ctx.mainWindow.setSize(width, height);
      ctx.mainWindow.center();
      return true;
    }
    return false;
  });

  ipcMain.handle('window:getSize', () => {
    if (ctx.mainWindow) {
      const [width, height] = ctx.mainWindow.getSize();
      return { width, height };
    }
    return { width: 1200, height: 800 };
  });

  // Window size constraint management for minimal mode
  ipcMain.handle('window:setMinSize', (event, width: number, height: number) => {
    if (ctx.mainWindow) {
      ctx.mainWindow.setMinimumSize(width, height);
      return true;
    }
    return false;
  });

  ipcMain.handle('window:setMaxSize', (event, width: number, height: number) => {
    if (ctx.mainWindow) {
      ctx.mainWindow.setMaximumSize(width, height);
      return true;
    }
    return false;
  });

  ipcMain.handle('window:getMinSize', () => {
    if (ctx.mainWindow) {
      const [width, height] = ctx.mainWindow.getMinimumSize();
      return { width, height };
    }
    return { width: 800, height: 600 };
  });

  ipcMain.handle('window:getMaxSize', () => {
    if (ctx.mainWindow) {
      const [width, height] = ctx.mainWindow.getMaximumSize();
      return { width, height };
    }
    return { width: 0, height: 0 }; // 0 means no limit
  });
}

