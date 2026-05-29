import { renderToMain, mainToRender } from '@shared/ipc/doctor';

// Renderer → Main: type-safe API calls
export const doctorApi = renderToMain.bindRender(
  window.electronAPI.doctor.invoke
);

// Main → Renderer: type-safe event listeners
export const doctorEvents = mainToRender.bindRender(
  window.electronAPI.doctor.on,
  window.electronAPI.doctor.off,
);
