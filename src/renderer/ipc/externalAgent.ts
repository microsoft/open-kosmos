import { renderToMain, mainToRender } from '@shared/ipc/externalAgent';

// Renderer → Main: type-safe API calls
export const externalAgentApi = renderToMain.bindRender(
  window.electronAPI.externalAgent.invoke
);

// Main → Renderer: type-safe event listeners
export const externalAgentEvents = mainToRender.bindRender(
  window.electronAPI.externalAgent.on,
  window.electronAPI.externalAgent.off,
);
