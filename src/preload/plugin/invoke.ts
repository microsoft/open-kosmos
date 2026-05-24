import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/plugin';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'getPlugins',
    'install',
    'installFromPath',
    'uninstall',
    'enableForAgent',
    'disableForAgent',
    'enable',
    'disable',
    'restart',
  ],
);

export default invoke;
