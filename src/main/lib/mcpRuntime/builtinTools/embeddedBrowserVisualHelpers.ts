import type { getEmbeddedBrowserManager } from '../../embeddedBrowser/EmbeddedBrowserManager';
import { createHash } from 'crypto';
import sharp from 'sharp';
import type { EmbeddedBrowserToolArgs } from './embeddedBrowserToolTypes';
import { elementRectExpression } from './embeddedBrowserToolExpressions';

type ToolError = { ok: false; error: string };
type Manager = NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>;
type Fail = (error: string) => ToolError;
type HasLocator = (args: EmbeddedBrowserToolArgs) => boolean;
type VisualBaseline = { data: string; hash: string; bytes: number; mimeType: string; capturedAt: number };
const MAX_VISUAL_BASELINES = 32;
const MAX_VISUAL_BASELINE_BYTES = 25 * 1024 * 1024;
const visualBaselines = new Map<string, VisualBaseline>();

let fail: Fail;
let hasLocator: HasLocator;

export function configureBrowserVisualHelpers(deps: { fail: Fail; hasLocator: HasLocator }): void {
  fail = deps.fail;
  hasLocator = deps.hasLocator;
}
interface CaptureRect { x: number; y: number; width: number; height: number }

export async function captureComparableScreenshot(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string } | ToolError> {
  if (!manager.hasNavigablePage(sessionId)) {
    return fail('The embedded browser has no page open yet. Call the navigate action first.');
  }
  await manager.ensureViewForAutomation(sessionId, undefined, signal);
  const viewport = await resolveScreenshotViewport(manager, sessionId, args);
  const previousViewport = viewport ? manager.getAutomationViewport(sessionId) : null;
  if (viewport) manager.setAutomationViewport(sessionId, viewport.width, viewport.height);
  try {
    const rect = hasLocator(args)
      ? await manager.executeJs(sessionId, elementRectExpression(args)) as CaptureRect | null
      : null;
    if (hasLocator(args) && !rect) return fail('No element matched the screenshot locator.');
    return await manager.captureScreenshot(sessionId, rect ?? undefined);
  } finally {
    if (previousViewport) manager.setAutomationViewport(sessionId, previousViewport.width, previousViewport.height);
  }
}

export function screenshotHash(base64Data: string): string {
  return createHash('sha256').update(Buffer.from(base64Data, 'base64')).digest('hex');
}

export async function compareScreenshotPixels(
  baselineData: string,
  currentData: string,
  thresholdInput?: number,
  includeDiffImage = false,
): Promise<{
  comparable: boolean;
  width?: number;
  height?: number;
  changedPixels?: number;
  totalPixels?: number;
  changedRatio?: number;
  changedBounds?: { x: number; y: number; width: number; height: number } | null;
  diffImage?: { available: true; mimeType: 'image/png'; bytes: number; description: string };
  threshold: number;
  reason?: string;
}> {
  const threshold = Math.min(Math.max(Math.round(Number.isFinite(thresholdInput) ? Number(thresholdInput) : 0), 0), 255);
  try {
    const baseline = await sharp(Buffer.from(baselineData, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const current = await sharp(Buffer.from(currentData, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (baseline.info.width !== current.info.width || baseline.info.height !== current.info.height || baseline.info.channels !== current.info.channels) {
      return {
        comparable: false,
        width: current.info.width,
        height: current.info.height,
        threshold,
        reason: `Image dimensions differ: baseline ${baseline.info.width}x${baseline.info.height}, current ${current.info.width}x${current.info.height}.`,
      };
    }
    let changedPixels = 0;
    const channels = baseline.info.channels;
    let minX = baseline.info.width;
    let minY = baseline.info.height;
    let maxX = -1;
    let maxY = -1;
    const diff = includeDiffImage ? Buffer.alloc(baseline.data.length) : null;
    for (let i = 0; i < baseline.data.length; i += channels) {
      let changed = false;
      for (let c = 0; c < channels; c++) {
        if (Math.abs(baseline.data[i + c] - current.data[i + c]) > threshold) {
          changed = true;
          break;
        }
      }
      const pixelIndex = i / channels;
      const x = pixelIndex % baseline.info.width;
      const y = Math.floor(pixelIndex / baseline.info.width);
      if (changed) {
        changedPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      if (diff) {
        diff[i] = changed ? 255 : current.data[i];
        diff[i + 1] = changed ? 0 : current.data[i + 1];
        diff[i + 2] = changed ? 255 : current.data[i + 2];
        diff[i + 3] = 255;
      }
    }
    const totalPixels = baseline.info.width * baseline.info.height;
    const changedBounds = changedPixels > 0
      ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
      : null;
    const diffBytes = diff
      ? (await sharp(diff, { raw: { width: baseline.info.width, height: baseline.info.height, channels } }).png().toBuffer()).byteLength
      : undefined;
    return {
      comparable: true,
      width: baseline.info.width,
      height: baseline.info.height,
      changedPixels,
      totalPixels,
      changedRatio: totalPixels > 0 ? changedPixels / totalPixels : 0,
      changedBounds,
      ...(diffBytes ? { diffImage: { available: true, mimeType: 'image/png', bytes: diffBytes, description: 'Visual diff image generated but raw base64 is omitted to avoid context bloat.' } } : {}),
      threshold,
    };
  } catch (err) {
    return { comparable: false, threshold, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function isToolError(value: { data: string; mimeType: string } | ToolError): value is ToolError {
  return 'ok' in value && value.ok === false;
}

export function visualBaselineKey(sessionId: string, baselineName: string): string {
  return `${sessionId}:${baselineName}`;
}

export function storeVisualBaseline(sessionId: string, baselineName: string, baseline: VisualBaseline): ToolError | undefined {
  if (baseline.bytes > MAX_VISUAL_BASELINE_BYTES) {
    return { ok: false, error: `Visual baseline is too large to store (${baseline.bytes} bytes > ${MAX_VISUAL_BASELINE_BYTES} bytes).` };
  }
  visualBaselines.set(visualBaselineKey(sessionId, baselineName), baseline);
  evictVisualBaselines();
  return undefined;
}

export function getVisualBaseline(sessionId: string, baselineName: string): VisualBaseline | undefined {
  return visualBaselines.get(visualBaselineKey(sessionId, baselineName));
}

export function clearVisualBaselines(sessionId?: string): void {
  if (!sessionId) {
    visualBaselines.clear();
    return;
  }
  const prefix = `${sessionId}:`;
  for (const key of Array.from(visualBaselines.keys())) {
    if (key.startsWith(prefix)) visualBaselines.delete(key);
  }
}

function evictVisualBaselines(): void {
  let totalBytes = 0;
  for (const baseline of visualBaselines.values()) totalBytes += baseline.bytes;
  const oldestFirst = () => Array.from(visualBaselines.entries()).sort((a, b) => a[1].capturedAt - b[1].capturedAt);
  while (visualBaselines.size > MAX_VISUAL_BASELINES) {
    const oldest = oldestFirst()[0]?.[0];
    if (!oldest) break;
    totalBytes -= visualBaselines.get(oldest)?.bytes ?? 0;
    visualBaselines.delete(oldest);
  }
  while (totalBytes > MAX_VISUAL_BASELINE_BYTES) {
    const oldest = oldestFirst()[0]?.[0];
    if (!oldest) break;
    totalBytes -= visualBaselines.get(oldest)?.bytes ?? 0;
    visualBaselines.delete(oldest);
  }
}

export async function resolveScreenshotViewport(
  manager: NonNullable<ReturnType<typeof getEmbeddedBrowserManager>>,
  sessionId: string,
  args: EmbeddedBrowserToolArgs,
): Promise<{ width: number; height: number } | null> {
  if (args.fullPage) {
    const size = await manager.executeJs(sessionId, `(() => ({
      width: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0, innerWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0, innerHeight),
    }))()`) as { width?: number; height?: number };
    if (Number.isFinite(size?.width) && Number.isFinite(size?.height)) {
      return {
        width: Math.min(Math.max(Math.round(Number(size.width)), 320), 3840),
        height: Math.min(Math.max(Math.round(Number(size.height)), 240), 10000),
      };
    }
  }
  if (args.viewport === 'desktop') return { width: 1440, height: 900 };
  if (args.viewport === 'mobile') return { width: 390, height: 844 };
  if (Number.isFinite(args.width) && Number.isFinite(args.height)) {
    const width = Math.min(Math.max(Math.round(Number(args.width)), 320), 3840);
    const height = Math.min(Math.max(Math.round(Number(args.height)), 240), 2160);
    return { width, height };
  }
  return null;
}
