import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/scheduler';

const invoke = renderToMain.provideInvokeForPreload(
  ipcRenderer,
  [
    'listJobs',
    'createJob',
    'deleteJob',
    'toggleJob',
    'updateJob',
    'runJobNow',
    'getJobSessions',
  ],
);

export default invoke;
