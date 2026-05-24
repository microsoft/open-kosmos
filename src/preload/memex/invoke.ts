import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/memex';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'enable',
    'disable',
    'getStatus',
  ],
);

export default invoke;
