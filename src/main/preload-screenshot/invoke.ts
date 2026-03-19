import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/screenshot';

/**
 * Renderer calling main process must use whitelist restrictions for security.
 * Conversely, main process calling renderer generally doesn't need restrictions.
 */
const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  /* All callable method names must be passed here as a whitelist; omitting any will cause type errors */
  [
    'capture',
    'selectionStart',
    'saveToFile',
    'copyToClipboard',
    'sendToMain',
    'close',
    'getInitData',
    'getSettings',
    'updateSettings',
    'selectSavePath',
    'rejectFre',
    'navigateToSettings',
  ],
);

export default invoke;