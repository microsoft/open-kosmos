import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/externalAgent';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'getConnectionInfo',
  ],
);

export default invoke;
