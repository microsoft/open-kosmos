import { contextBridge, ipcRenderer } from 'electron';
import invoke from './invoke';

contextBridge.exposeInMainWorld('electronScreenshot', {
  invoke,
  on: ipcRenderer.on.bind(ipcRenderer),
  off: ipcRenderer.off.bind(ipcRenderer),
});
