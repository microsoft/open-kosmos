import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/codingCli';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'getSettings',
    'updateSettings',
    'detectAvailability',
  ],
);

export default invoke;
