import { renderToMain, mainToRender } from '@shared/ipc/embeddedBrowser';

// Renderer → Main: type-safe API calls
export const embeddedBrowserApi = renderToMain.bindRender(
  window.electronAPI.embeddedBrowser.invoke,
);

// Main → Renderer: type-safe event listeners
export const embeddedBrowserEvents = mainToRender.bindRender(
  window.electronAPI.embeddedBrowser.on,
  window.electronAPI.embeddedBrowser.off,
);
