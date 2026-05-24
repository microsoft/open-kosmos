import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/screenshot';

/**
 * renderer calling into the main process must use a whitelist for security.
 * The reverse (main process calling renderer) generally does not need restrictions.
 */
const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  /* All allowed method names must be provided here as a complete whitelist; omitting any will cause a type error */
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