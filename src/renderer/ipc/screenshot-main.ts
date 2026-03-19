/**
 * Screenshot API exposed for the main window
 */

import { renderToMain } from '@shared/ipc/screenshot';

export const screenshotApi = renderToMain.bindRender(window.electronAPI.screenshot.invoke);

