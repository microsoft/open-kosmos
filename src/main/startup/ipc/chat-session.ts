import { app, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { Context } from './shared';
import { getChatSessionFilePath } from "../../lib/userDataADO/pathUtils";

export default function handleChatSessionIPC(_ctx: Context): void {
  // Download ChatSession to Downloads directory
  ipcMain.handle('chatSession:downloadChatSession', async (
    event,
    alias: string,
    chatId: string,
    sessionId: string,
    title: string
  ) => {
    try {

      const sourcePath = getChatSessionFilePath(alias, chatId, sessionId);

      if (!fs.existsSync(sourcePath)) {
        return { success: false, error: 'Chat session file not found' };
      }

      const downloadsDir = app.getPath('downloads');

      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').trim() || sessionId;
      let destFileName = `${safeTitle}.json`;
      let destPath = path.join(downloadsDir, destFileName);

      if (fs.existsSync(destPath)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        destFileName = `${safeTitle}_${timestamp}.json`;
        destPath = path.join(downloadsDir, destFileName);
      }

      await fs.promises.copyFile(sourcePath, destPath);

      return { success: true, filePath: destPath, fileName: destFileName };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download chat session'
      };
    }
  });

  ipcMain.handle('chatSession:getFilePath', async (
    event,
    alias: string,
    chatId: string,
    sessionId: string,
  ) => {
    try {
      const filePath = getChatSessionFilePath(alias, chatId, sessionId);
      return { success: true, filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
