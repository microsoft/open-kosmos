import type { IpcRenderer, IpcRendererEvent } from 'electron';
import type { MemexCardsChangedEvent } from '@shared/ipc/memex';
import invokeMemex from './invoke';

/**
 * Preload bridge for the per-agent memory sidepane. Exposes the read invoke
 * channel plus a channel-specific `memex:cardsChanged` subscription. Do not
 * expose raw `on`/`off` here; the renderer should only observe this memex event.
 */
export function createMemexPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    invoke: invokeMemex,
    onCardsChanged: (
      callback: (payload: MemexCardsChangedEvent) => void,
    ) => {
      const listener = (_event: IpcRendererEvent, payload: MemexCardsChangedEvent) => {
        callback(payload);
      };
      ipcRenderer.on('memex:cardsChanged', listener);
      return () => ipcRenderer.off('memex:cardsChanged', listener);
    },
  };
}
