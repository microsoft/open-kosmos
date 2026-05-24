import { ipcMain } from 'electron';
import { isDevelopmentLogEnvironment } from '../../lib/unifiedLogger/FileOperations';

export function registerRendererLogIPC(ipc = ipcMain): void {
  ipc.on('logger:rendererLog', async (_event, log) => {
    if (isDevelopmentLogEnvironment() && log?.__openkosmos_log) {
      const { getDevLogger } = await import('../../lib/devLogger');
      const devLogger = getDevLogger();
      if (devLogger) {
        devLogger.handleLog(log);
      }
    }
  });
}
