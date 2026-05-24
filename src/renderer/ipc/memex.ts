import { renderToMain } from '@shared/ipc/memex';

export const memexApi = renderToMain.bindRender(window.electronAPI.memex?.invoke as any);
