/**
 * Screenshot API exposed for the screenshot overlay window
 */

import { renderToMain } from '@shared/ipc/screenshot';

const bridge = (window as any).electronScreenshot.invoke;
export const screenshotApi = renderToMain.bindRender(bridge);
