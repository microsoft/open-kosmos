/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock deps used in bg.ts
vi.mock('../color', () => ({
  mosaicBlur: vi.fn(),
}));

vi.mock('../dom', () => ({
  svg2Base64: vi.fn(() => 'data:image/svg+xml,<svg/>'),
  makeInvisibleCanvas: vi.fn(() => {
    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4 * 4 * 4) })),
    };
    return { ctx };
  }),
}));

import { BackgroundImage, loadBackground } from '../bg';
import { mosaicBlur } from '../color';
import { makeInvisibleCanvas } from '../dom';

function makeImage(w = 100, h = 80): HTMLImageElement {
  const img = new Image();
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
  return img;
}

type MockCtx = {
  drawImage: ReturnType<typeof vi.fn>;
  getImageData: ReturnType<typeof vi.fn>;
};

function makeOffscreenCtx(): MockCtx {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: [10, 20, 30, 255] })),
  };
}

function setupOffscreenCanvas(ctx: MockCtx) {
  // Must be a real class/function since bg.ts does `new OffscreenCanvas(...)`
  class MockOffscreenCanvas {
    constructor(_w: number, _h: number) {}
    getContext(_type: string) { return ctx; }
  }
  (globalThis as any).OffscreenCanvas = MockOffscreenCanvas;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
});

describe('BackgroundImage constructor', () => {
  it('uses displayWidth/displayHeight when provided', () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(200, 160);
    const bg = new BackgroundImage('http://x', img, 100, 80);

    expect(bg.width).toBe(100);
    expect(bg.height).toBe(80);
    expect(bg.ratio).toBe(2); // naturalWidth / displayWidth
    expect(bg.css.backgroundSize).toBe('100px 80px');
    expect(bg.css.backgroundImage).toBe('url("http://x")');
  });

  it('uses dpr when displayWidth/displayHeight not provided', () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(200, 160);
    const bg = new BackgroundImage('http://y', img);

    expect(bg.width).toBe(100); // 200 / dpr(2)
    expect(bg.height).toBe(80); // 160 / dpr(2)
    expect(bg.ratio).toBe(2);
  });

  it('defaults dpr to 1 when devicePixelRatio is 0', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 0, configurable: true });
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(100, 80);
    const bg = new BackgroundImage('http://z', img);
    expect(bg.ratio).toBe(1);
  });
});

describe('BackgroundImage.getColor', () => {
  it('returns RGBA with alpha normalized', () => {
    const ctx = makeOffscreenCtx();
    ctx.getImageData.mockReturnValue({ data: [10, 20, 30, 200] });
    setupOffscreenCanvas(ctx);

    const img = makeImage(100, 80);
    const bg = new BackgroundImage('u', img);
    const color = bg.getColor(5, 5);
    expect(color[0]).toBe(10);
    expect(color[1]).toBe(20);
    expect(color[2]).toBe(30);
    expect(color[3]).toBeCloseTo(200 / 255);
  });
});

describe('BackgroundImage.blur', () => {
  it('calls makeInvisibleCanvas and mosaicBlur', () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(100, 80);
    const bg = new BackgroundImage('u', img, 50, 40);

    const area: [number, number, number, number] = [0, 0, 20, 10];
    bg.blur(area, 5);

    expect(makeInvisibleCanvas).toHaveBeenCalled();
    expect(mosaicBlur).toHaveBeenCalled();
  });
});

describe('BackgroundImage.getSubCanvasByArea', () => {
  it('creates a canvas with scaled dimensions', () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(100, 80);
    const bg = new BackgroundImage('u', img, 50, 40); // ratio = 2

    // happy-dom does not implement canvas getContext('2d') — stub it
    const mockCtx2d = { drawImage: vi.fn() };
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx2d) as any;

    const result = bg.getSubCanvasByArea([0, 0, 10, 8]);

    expect(result.width).toBe(20); // 10 * ratio(2)
    expect(result.height).toBe(16); // 8 * ratio(2)
    expect(result.canvas).toBeDefined();

    HTMLCanvasElement.prototype.getContext = origGetContext;
  });
});

describe('BackgroundImage.compose', () => {
  it('returns a canvas promise', async () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(100, 80);
    const bg = new BackgroundImage('u', img, 50, 40);

    const mockCanvas = document.createElement('canvas');
    const mockSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    const mockMosaicCanvas = document.createElement('canvas');

    // Override Image so onload fires immediately when src is set
    const originalImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      set src(_: string) { this.onload?.(); }
      drawImage() {}
    }
    (globalThis as any).Image = MockImage;

    vi.spyOn(bg, 'getSubCanvasByArea').mockReturnValue({
      canvas: mockCanvas,
      ctx: { drawImage: vi.fn() } as any,
      width: 100,
      height: 80,
    });

    const result = await bg.compose([0, 0, 50, 40], mockMosaicCanvas, mockSvg);
    expect(result).toBe(mockCanvas);

    globalThis.Image = originalImage;
  });
});

describe('BackgroundImage.getAreaImageBlob', () => {
  it('resolves with blob from toBlob', async () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const img = makeImage(100, 80);
    const bg = new BackgroundImage('u', img, 50, 40);

    const canvas = document.createElement('canvas');
    const mockBlob = new Blob(['data'], { type: 'image/png' });
    vi.spyOn(canvas, 'toBlob').mockImplementation((cb) => cb(mockBlob));

    const blob = await bg.getAreaImageBlob(canvas);
    expect(blob).toBe(mockBlob);
  });
});

describe('BackgroundImage.getAreaImageCanvas', () => {
  it('delegates to getSubCanvasByArea', () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);
    const img = makeImage(100, 80);
    const bg = new BackgroundImage('u', img, 50, 40);

    const mockCanvas = document.createElement('canvas');
    vi.spyOn(bg, 'getSubCanvasByArea').mockReturnValue({ canvas: mockCanvas, ctx: {} as any, width: 0, height: 0 });
    expect(bg.getAreaImageCanvas([0, 0, 10, 10])).toBe(mockCanvas);
  });
});

describe('loadBackground', () => {
  it('resolves with a BackgroundImage on load', async () => {
    const ctx = makeOffscreenCtx();
    setupOffscreenCanvas(ctx);

    const originalImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      crossOrigin = '';
      set src(_url: string) {
        Object.defineProperty(this, 'naturalWidth', { value: 60 });
        Object.defineProperty(this, 'naturalHeight', { value: 40 });
        this.onload?.();
      }
    }
    (globalThis as any).Image = MockImage;

    const bg = await loadBackground('http://img');
    expect(bg).toBeInstanceOf(BackgroundImage);
    expect(bg.url).toBe('http://img');

    globalThis.Image = originalImage;
  });
});
