import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/doctor';
import type { Context } from './shared';
import { doctorManager } from '../../lib/doctor/manager';

export default function handleDoctorIPC(ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  handle.submitDoctorInquiry(async (_event, payload) => {
    return doctorManager.submitInquiry(payload);
  });

  handle.submitAgentAnswer(async (_event, payload) => {
    doctorManager.receiveAnswer(payload.taskId, payload.answers);
  });
}
