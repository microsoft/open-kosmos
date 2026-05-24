import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/browserControl';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'getSettings',
    'updateSettings',
    'enable',
    'disable',
    'getStatus',
    'getInstallStatus',
    'getUpdateStatus',
    'launchWithSnap',
    'respondBrowserInstallConfirm',
    'respondNativeServerDownloadConfirm',
    'respondBrowserRestartConfirm',
    'checkNativeServerUpdate',
    'updateNativeServer',
    'reinstallExtension',
  ],
);

export default invoke;
