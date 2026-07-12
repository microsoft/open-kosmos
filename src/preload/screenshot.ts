import { contextBridge, ipcRenderer } from 'electron';
import invoke from './screenshot/invoke';

contextBridge.exposeInMainWorld('electronScreenshot', {
  invoke,
  on: ipcRenderer.on.bind(ipcRenderer),
  off: ipcRenderer.off.bind(ipcRenderer),
});

contextBridge.exposeInMainWorld('electronAPI', {
  appConfig: {
    getAppConfig: () => ipcRenderer.invoke('app:getAppConfig'),
    updateAppConfig: () => Promise.resolve({ success: false, error: 'App config updates are not available in screenshot overlay' }),
    onConfigUpdated: (callback: (data: { config: any; timestamp: number; revision?: number }) => void) => {
      const listener = (_event: any, data: { config: any; timestamp: number; revision?: number }) => callback(data);
      ipcRenderer.on('app:configUpdated', listener);
      ipcRenderer.invoke('app:getAppConfig').then((result) => {
        if (result?.success && result.data) {
          callback({ config: result.data, timestamp: Date.now(), revision: result.revision });
        }
      }).catch(() => {
        // The AppDataManager fallback will retry if this early pull fails.
      });
      return () => ipcRenderer.removeListener('app:configUpdated', listener);
    },
  },
});
