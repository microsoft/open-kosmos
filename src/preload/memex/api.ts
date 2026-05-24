import type { IpcRenderer } from 'electron';
import invokeMemex from './invoke';

export function createMemexPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    invoke: invokeMemex,
    onPhaseChange: (callback: (phase: string) => void) => {
      const listener = (_event: any, phase: string) => callback(phase);
      ipcRenderer.on('memex:phaseChange', listener);
      return () => ipcRenderer.removeListener('memex:phaseChange', listener);
    },
  };
}