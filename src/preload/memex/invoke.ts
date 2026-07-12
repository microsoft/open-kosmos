import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/memex';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'listCards',
    'readCard',
    'getGraph',
    'searchCards',
    'archiveProfileCard',
    'deleteProfileCard',
  ],
);

export default invoke;
