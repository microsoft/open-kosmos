import { renderToMain } from '@shared/ipc/plugin';

export const pluginApi = renderToMain.bindRender(window.electronAPI.plugin.invoke);
