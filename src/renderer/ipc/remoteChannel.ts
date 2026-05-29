import { renderToMain, mainToRender } from '@shared/ipc/remoteChannel';

// Renderer → Main: type-safe API calls
export const remoteChannelApi = renderToMain.bindRender(
  window.electronAPI.remoteChannel.invoke
);

// Main → Renderer: type-safe event listeners
export const remoteChannelEvents = mainToRender.bindRender(
  window.electronAPI.remoteChannel.on,
  window.electronAPI.remoteChannel.off,
);
