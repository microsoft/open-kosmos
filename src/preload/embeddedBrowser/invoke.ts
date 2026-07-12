import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/embeddedBrowser';

/**
 * Renderer → main whitelist for the in-app browser side panel.
 * Every contract method must be listed or TypeScript reports a missing key.
 */
const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'open',
    'navigate',
    'show',
    'hide',
    'setBounds',
    'goBack',
    'goForward',
    'reload',
    'stop',
    'setActiveSession',
    'destroyAll',
  ],
);

export default invoke;
