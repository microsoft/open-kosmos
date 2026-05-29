import { ipcRenderer } from 'electron';
import { renderToMain } from '@shared/ipc/doctor';

const invoke = renderToMain.provideInvokeForPreload(ipcRenderer, [
  'submitDoctorInquiry',
  'submitAgentAnswer',
]);

export default invoke;
