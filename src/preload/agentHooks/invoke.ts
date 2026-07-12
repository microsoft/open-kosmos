import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/agentHooks';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'listHooks',
    'createHook',
    'updateHook',
    'deleteHook',
    'getMasterSwitch',
    'setMasterSwitch',
  ],
);

export default invoke;
