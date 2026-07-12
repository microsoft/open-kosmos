import { renderToMain } from '@shared/ipc/codingCli';

export const codingCliApi = renderToMain.bindRender(window.electronAPI.codingCli.invoke);
