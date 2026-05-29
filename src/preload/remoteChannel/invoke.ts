import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/remoteChannel';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'getConfig',
    'updateConfig',
    'getStatus',
    'getAllStatus',
    'start',
    'stop',
    'bind',
    'unbind',
    'getBindingStatus',
  ],
);

export default invoke;
