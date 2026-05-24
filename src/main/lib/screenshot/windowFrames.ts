import { Window as ScreenshotWindow } from 'node-screenshots';
import type { WindowFrame } from '@shared/ipc/screenshot';
import { getUnifiedLogger } from '../unifiedLogger';

const logger = getUnifiedLogger();

/**
 * Get the bounds of all system windows, grouped by display.
 * Uses Window.all() from node-screenshots to obtain the z-order-sorted window list.
 */
export function getWindowFrames(displays: Electron.Display[]): Map<number, WindowFrame[]> {
  const allWindows = ScreenshotWindow.all();
  const framesByDisplay = new Map<number, WindowFrame[]>();
  for (const display of displays) {
    framesByDisplay.set(display.id, []);
  }

  for (const win of allWindows) {
    if (win.isMinimized()) continue;

    const ww = win.width();
    const wh = win.height();
    if (ww <= 1 || wh <= 1) continue;

    const wx = win.x();
    const wy = win.y();

    // Determine which display this window belongs to based on its center point
    const centerX = wx + ww / 2;
    const centerY = wy + wh / 2;
    const targetDisplay = displays.find(d => {
      const { x, y, width, height } = d.bounds;
      return centerX >= x && centerX < x + width && centerY >= y && centerY < y + height;
    });
    if (!targetDisplay) continue;

    const { x: dx, y: dy } = targetDisplay.bounds;
    const sf = targetDisplay.scaleFactor;

    // Convert coordinates to relative coordinates within the display, then multiply by scaleFactor to get physical pixels
    const frame: WindowFrame = {
      x: (wx - dx) * sf,
      y: (wy - dy) * sf,
      width: ww * sf,
      height: wh * sf,
      id: win.id(),
    };

    framesByDisplay.get(targetDisplay.id)!.push(frame);
  }

  logger.info(`[windowFrames] Got ${allWindows.length} windows, distributed to ${displays.length} display(s)`);
  return framesByDisplay;
}