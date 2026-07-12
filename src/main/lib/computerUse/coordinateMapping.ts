/**
 * Coordinate mapping (pure).
 *
 * The model sees a screenshot of a known pixel size and returns a point in that
 * image's coordinate space. To dispatch synthetic input we must map that point
 * onto the screen. {@link mapImagePointToScreen} produces a point in the display's
 * logical (DIP) bounds (origin + fractional position * size); {@link toDriverPoint}
 * then converts that logical point into whatever coordinate space the synthetic-input
 * driver expects on the current platform (logical on macOS, physical pixels on
 * Windows/Linux — see that function).
 *
 * Pure functions only — no Electron, no native deps — so every branch is unit
 * testable without a display.
 */

import type { Point, DisplayBounds } from './types';

export interface ImageDims {
  width: number;
  height: number;
}

export interface MapInput {
  /** The model's point, in screenshot-image-space. */
  imagePoint: Point;
  /** The actual captured pixel dimensions of that screenshot. */
  imageDims: ImageDims;
  /** Logical bounds of the display the screenshot came from. */
  bounds: DisplayBounds;
}

export type MapResult = { ok: true; point: Point } | { ok: false; error: string };

/**
 * Map an image-space point onto a logical screen point within a display.
 * Out-of-range points and degenerate image dimensions return a recoverable
 * error rather than clamping silently.
 */
export function mapImagePointToScreen(input: MapInput): MapResult {
  const { imagePoint, imageDims, bounds } = input;

  if (imageDims.width <= 0 || imageDims.height <= 0) {
    return { ok: false, error: 'Invalid capture dimensions; cannot map coordinates.' };
  }
  if (
    imagePoint.x < 0 ||
    imagePoint.y < 0 ||
    imagePoint.x > imageDims.width ||
    imagePoint.y > imageDims.height
  ) {
    return {
      ok: false,
      error: `Point (${imagePoint.x}, ${imagePoint.y}) is outside the ${imageDims.width}x${imageDims.height} screenshot.`,
    };
  }

  const fractionX = imagePoint.x / imageDims.width;
  const fractionY = imagePoint.y / imageDims.height;
  const screenX = bounds.x + fractionX * bounds.width;
  const screenY = bounds.y + fractionY * bounds.height;

  // Clamp to the display's last addressable logical pixel. An image point on the
  // exact right/bottom edge (fraction === 1) maps to `bounds.{x,y} + bounds.{width,height}`,
  // which is the FIRST pixel of the adjacent display (or off-screen) rather than this
  // display, so an edge click would land on the wrong screen. Pin the upper edge to
  // `origin + size - 1` and guard the lower edge at the origin.
  const maxX = bounds.x + bounds.width - 1;
  const maxY = bounds.y + bounds.height - 1;
  const x = Math.min(maxX, Math.max(bounds.x, Math.round(screenX)));
  const y = Math.min(maxY, Math.max(bounds.y, Math.round(screenY)));

  return { ok: true, point: { x, y } };
}

/**
 * Fallback conversion from a logical screen point (the output of
 * {@link mapImagePointToScreen}) into the coordinate space the synthetic-input
 * driver expects on the current platform.
 *
 * nut.js / libnut consume **logical points on macOS** (Cocoa's point space matches
 * Electron's `Display.bounds`), but **physical device pixels on Windows/Linux**: the
 * Electron process is per-monitor DPI-aware, so libnut's `SetCursorPos` / `SendInput`
 * operate in physical pixels. On a Windows display scaled to e.g. 150% a logical point
 * must be multiplied by `scaleFactor`, otherwise every click/drag lands short of its
 * target. macOS needs no scaling because the OS input APIs already use logical points.
 *
 * Returns the point unchanged on darwin; scales by `scaleFactor` (rounded) elsewhere. The
 * real Electron-backed desktop provider uses `screen.dipToScreenPoint` instead, because
 * multiplying absolute logical coordinates by a single display's scale factor is only a
 * fallback approximation for non-Electron test seams.
 */
export function toDriverPoint(
  logicalPoint: Point,
  scaleFactor: number,
  platform: NodeJS.Platform,
): Point {
  if (platform === 'darwin') {
    return logicalPoint;
  }
  return {
    x: Math.round(logicalPoint.x * scaleFactor),
    y: Math.round(logicalPoint.y * scaleFactor),
  };
}
