/**
 * AI cursor render smoke test (Computer Use overlay).
 *
 * WHY THIS EXISTS
 * ---------------
 * The AI cursor has regressed to *invisible* several times on Windows — content
 * protection blanking the layer, a zero-opacity / transparent-colour draw, and
 * white-on-white salience loss. None of those were caught by the unit tests in
 * `src/main/lib/computerUse/__tests__/cursorOverlay.test.ts`, because those tests
 * drive a `vi.fn()` fake window and only assert the *call contract* (which window
 * methods fire, in what order) — they never rasterize the in-page renderer, so a
 * cursor that paints zero visible pixels still passes every one of them.
 *
 * This test closes exactly that gap. It injects the REAL, shipped
 * {@link BOOTSTRAP_SCRIPT} into a plain Chromium page (the same string the main
 * process feeds to `webContents.executeJavaScript`), drives it with a payload
 * built by the REAL {@link buildPayload}, screenshots the result, and asserts the
 * brand-violet cursor actually paints visible pixels AT the click point. The page
 * background is pure white, so a pass also proves the cursor survives the
 * white-on-white case. It is intentionally background-independent (it counts the
 * cursor's own violet, not contrast) and intentionally does NOT assert OS window
 * z-order (untestable in a browser and too flaky for CI) — z-order stays covered
 * by the call-contract re-raise unit test.
 *
 * Run: npx playwright test tests/e2e/cursor-overlay.e2e.ts
 */
import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import {
  BOOTSTRAP_SCRIPT,
  buildPayload,
} from '../../src/main/lib/computerUse/cursorRenderer';

/** Viewport / click geometry. The display bounds start at (0,0) so the logical
 *  screen point and the window-local payload coordinate coincide. */
const VIEW = { width: 1000, height: 700 };
const CLICK = { x: 500, y: 350 };
/** Clip framed around the click point, wide enough to capture the whole cursor
 *  (ring + glow + arrow + the "AI" label, which sits up-and-right of the point). */
const CLIP = { x: 460, y: 300, width: 160, height: 120 };
/** Click point expressed in clip-local pixels (where the cursor centres). */
const LOCAL = { x: CLICK.x - CLIP.x, y: CLICK.y - CLIP.y };
/** Radius (clip-local px) of the "is the cursor actually AT the target" probe. */
const NEAR_RADIUS = 32;

interface VioletStats {
  /** Violet pixels anywhere in the clip. */
  total: number;
  /** Violet pixels within {@link NEAR_RADIUS} of the click point. */
  near: number;
}

/**
 * Count brand-violet pixels in a PNG screenshot. The cursor's palette is the
 * violet/indigo family (#8b5cf6 ring, #a78bfa glow/dot halo, #7c3aed arrow,
 * #6366f1 label) — every member has a high blue channel that clearly leads green
 * and red, which is what this predicate keys on so it never matches the white
 * page, white dot core, or greyscale anti-aliasing.
 */
async function violetStats(png: Buffer): Promise<VioletStats> {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let total = 0;
  let near = 0;
  const r2 = NEAR_RADIUS * NEAR_RADIUS;
  for (let i = 0, px = 0; i + 2 < data.length; i += ch, px++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Violet: blue dominant, well clear of green, red present but below blue.
    if (b >= 140 && b - g >= 45 && b - r >= 12 && r >= 55 && r <= b) {
      total++;
      const x = px % info.width;
      const y = Math.floor(px / info.width);
      const dx = x - LOCAL.x;
      const dy = y - LOCAL.y;
      if (dx * dx + dy * dy <= r2) near++;
    }
  }
  return { total, near };
}

test.describe('AI cursor render smoke', () => {
  test('paints visible violet pixels at the click point (incl. white-on-white)', async ({
    page,
  }) => {
    await page.setViewportSize(VIEW);
    // Pure-white page: a pass here also proves the white-on-white case.
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"></head>` +
        `<body style="margin:0;padding:0;background:#ffffff;width:${VIEW.width}px;height:${VIEW.height}px"></body></html>`,
    );

    // Inject the REAL overlay bootstrap, exactly as the main process does via
    // webContents.executeJavaScript — a <script> tag runs the IIFE in page scope.
    await page.addScriptTag({ content: BOOTSTRAP_SCRIPT });
    await page.waitForFunction(
      () => typeof (window as unknown as { __cu?: unknown }).__cu === 'function',
    );

    // Negative control: the cursor is parked offscreen at translate(-9999,-9999),
    // so the framed clip must contain (essentially) no violet before we drive it.
    const before = await violetStats(await page.screenshot({ clip: CLIP }));

    const payload = buildPayload({
      kind: 'click',
      point: CLICK,
      button: 'left',
      display: { id: 1, bounds: { x: 0, y: 0, width: VIEW.width, height: VIEW.height } },
    });
    await page.evaluate((p) => {
      (window as unknown as { __cu: (payload: unknown) => void }).__cu(p);
    }, payload);

    // First placement is instant (the renderer snaps from the offscreen park),
    // so this only waits out the opacity .25s ease-in plus a compositing margin.
    await page.waitForTimeout(500);

    const after = await violetStats(await page.screenshot({ clip: CLIP }));

    // Surfaced on pass too, so threshold drift is visible in CI logs.
    // eslint-disable-next-line no-console
    console.log(
      `[cursor-smoke] violet before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );

    // Before: cursor offscreen → no meaningful violet.
    expect(before.total).toBeLessThan(40);
    // After: the cursor must paint a substantial violet footprint...
    expect(after.total).toBeGreaterThan(200);
    // ...and it must be AT the click point, not merely somewhere on screen
    // (guards against a broken payload projection / placement regression).
    expect(after.near).toBeGreaterThan(60);
    // And the action must have clearly changed the frame.
    expect(after.total).toBeGreaterThan(before.total + 150);
  });
});
