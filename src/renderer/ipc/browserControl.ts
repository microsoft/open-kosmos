import { renderToMain } from '@shared/ipc/browserControl';

export const browserControlApi = renderToMain.bindRender(window.electronAPI.browserControl!.invoke);
