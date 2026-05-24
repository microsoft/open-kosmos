import { renderToMain } from '@shared/ipc/scheduler';

export const schedulerApi = renderToMain.bindRender(window.electronAPI.scheduler.invoke);
