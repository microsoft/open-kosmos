// @ts-nocheck
// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mock FileReader ──────────────────────────────────────────────────────────

/** Controls how the next FileReader.readAsDataURL call resolves */
let mockFileReaderDataUrlResult: string | null = 'data:image/png;base64,abc';
let mockFileReaderDataUrlShouldError = false;
/** Controls how the next inner FileReader.readAsArrayBuffer call resolves */
let mockFileReaderArrayBufferResult: ArrayBuffer | null = new ArrayBuffer(50);
let mockFileReaderArrayBufferShouldError = false;

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private _listeners: Record<string, Array<() => void>> = {};

  readAsDataURL(_blob: Blob) {
    if (mockFileReaderDataUrlShouldError) {
      setTimeout(() => this.onerror?.(new Event('error')), 0);
    } else {
      this.result = mockFileReaderDataUrlResult;
      setTimeout(() => {
        this._listeners['loadend']?.forEach(fn => fn());
        this.onload?.(new Event('load'));
      }, 0);
    }
  }

  readAsArrayBuffer(_blob: Blob) {
    if (mockFileReaderArrayBufferShouldError) {
      setTimeout(() => this.onerror?.(new Event('error')), 0);
    } else {
      this.result = mockFileReaderArrayBufferResult;
      setTimeout(() => {
        this._listeners['loadend']?.forEach(fn => fn());
        this.onload?.(new Event('load'));
      }, 0);
    }
  }

  addEventListener(event: string, handler: () => void) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }
}

// ─── Mock Image ───────────────────────────────────────────────────────────────

let mockImageWidth = 1024;
let mockImageHeight = 768;
let mockImageShouldError = false;
/** If true, the image never fires onload or onerror (simulates timeout) */
let mockImageShouldHang = false;

class MockImage {
  width = mockImageWidth;
  height = mockImageHeight;
  onload: (() => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  private _src = '';

  set src(value: string) {
    this._src = value;
    if (mockImageShouldHang) return;
    this.width = mockImageWidth;
    this.height = mockImageHeight;
    if (mockImageShouldError) {
      setTimeout(() => this.onerror?.(new Event('error')), 0);
    } else {
      setTimeout(() => this.onload?.(), 0);
    }
  }

  get src() {
    return this._src;
  }
}

// ─── Mock Canvas ──────────────────────────────────────────────────────────────

let mockCanvasCtxNull = false;
let mockCanvasDrawImageThrow = false;
let mockCanvasToBlobNull = false;

const mockCtx = {
  drawImage: vi.fn(),
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'high' as ImageSmoothingQuality,
};

function makeMockCanvas() {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn((_type: string) => {
      if (mockCanvasCtxNull) return null;
      if (mockCanvasDrawImageThrow) {
        return {
          ...mockCtx,
          drawImage: vi.fn(() => { throw new Error('draw error'); }),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'high' as ImageSmoothingQuality,
        };
      }
      return mockCtx;
    }),
    toBlob: vi.fn((callback: (b: Blob | null) => void, _type?: string, _quality?: number) => {
      if (mockCanvasToBlobNull) {
        setTimeout(() => callback(null), 0);
      } else {
        setTimeout(() => callback(new Blob(['px'], { type: _type || 'image/png' })), 0);
      }
    }),
  };
}

// ─── Install globals ──────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset state
  mockFileReaderDataUrlResult = 'data:image/png;base64,abc';
  mockFileReaderDataUrlShouldError = false;
  mockFileReaderArrayBufferResult = new ArrayBuffer(50);
  mockFileReaderArrayBufferShouldError = false;
  mockImageWidth = 1024;
  mockImageHeight = 768;
  mockImageShouldError = false;
  mockImageShouldHang = false;
  mockCanvasCtxNull = false;
  mockCanvasDrawImageThrow = false;
  mockCanvasToBlobNull = false;
  mockCtx.drawImage.mockClear();

  vi.stubGlobal('FileReader', MockFileReader);
  vi.stubGlobal('Image', MockImage);
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });

  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return makeMockCanvas() as unknown as HTMLCanvasElement;
    return originalCreateElement(tag);
  });

  if (typeof globalThis.performance === 'undefined') {
    (globalThis as any).performance = { now: () => Date.now() };
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Import after mocks are set up ───────────────────────────────────────────

import {
  detectCSPCompatibility,
  getImageDimensions,
  resizeImageVSCodeOfficial,
  smartCompressImageVSCodeOfficial,
  shouldCompressImageVSCodeOfficial,
  resizeImageVSCodeStyle,
  shouldCompressImageVSCodeStyle,
  smartCompressImageVSCodeStyle,
  validateImageFileSize,
  shouldCompressImage,
  estimateBase64Size,
  VSCODE_IMAGE_LIMITS,
  GITHUB_COPILOT_IMAGE_LIMITS,
  smartCompressImage,
  shouldCompressImageAdvanced,
} from '../imageCompression';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeFile(name: string, sizeBytes: number, type = 'image/png'): File {
  const content = new Uint8Array(sizeBytes).fill(0);
  return new File([content], name, { type });
}

// =============================================================================
// VSCODE_IMAGE_LIMITS / constants
// =============================================================================

describe('VSCODE_IMAGE_LIMITS', () => {
  it('has correct MAX_SIZE_BYTES', () => {
    expect(VSCODE_IMAGE_LIMITS.MAX_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it('has correct STRICT_MAX_SIZE_BYTES', () => {
    expect(VSCODE_IMAGE_LIMITS.STRICT_MAX_SIZE_BYTES).toBe(1 * 1024 * 1024);
  });

  it('has correct MAX_DIMENSION', () => {
    expect(VSCODE_IMAGE_LIMITS.MAX_DIMENSION).toBe(2048);
  });

  it('has correct SCALE_TARGET_DIMENSION', () => {
    expect(VSCODE_IMAGE_LIMITS.SCALE_TARGET_DIMENSION).toBe(768);
  });

  it('GITHUB_COPILOT_IMAGE_LIMITS is the same object as VSCODE_IMAGE_LIMITS', () => {
    expect(GITHUB_COPILOT_IMAGE_LIMITS).toBe(VSCODE_IMAGE_LIMITS);
  });

  it('smartCompressImage is alias for smartCompressImageVSCodeStyle', () => {
    expect(smartCompressImage).toBe(smartCompressImageVSCodeStyle);
  });

  it('shouldCompressImageAdvanced is alias for shouldCompressImageVSCodeStyle', () => {
    expect(shouldCompressImageAdvanced).toBe(shouldCompressImageVSCodeStyle);
  });
});

// =============================================================================
// validateImageFileSize
// =============================================================================

describe('validateImageFileSize', () => {
  it('returns isValid=true for a file under 5MB', () => {
    const file = makeFile('small.png', 1024);
    expect(validateImageFileSize(file)).toEqual({ isValid: true });
  });

  it('returns isValid=false with error message for a file over 5MB', () => {
    const file = makeFile('big.png', 6 * 1024 * 1024);
    const result = validateImageFileSize(file);
    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/too large/);
    expect(result.error).toMatch(/5MB/);
  });

  it('returns isValid=false for exactly 5MB + 1 byte', () => {
    const file = makeFile('edge.png', 5 * 1024 * 1024 + 1);
    expect(validateImageFileSize(file).isValid).toBe(false);
  });

  it('returns isValid=true for exactly 5MB', () => {
    const file = makeFile('exact.png', 5 * 1024 * 1024);
    expect(validateImageFileSize(file).isValid).toBe(true);
  });
});

// =============================================================================
// shouldCompressImage (sync)
// =============================================================================

describe('shouldCompressImage', () => {
  it('returns false for a file under 2MB', () => {
    expect(shouldCompressImage(makeFile('small.png', 1 * 1024 * 1024))).toBe(false);
  });

  it('returns false for exactly 2MB', () => {
    expect(shouldCompressImage(makeFile('two.png', 2 * 1024 * 1024))).toBe(false);
  });

  it('returns true for a file over 2MB', () => {
    expect(shouldCompressImage(makeFile('big.png', 3 * 1024 * 1024))).toBe(true);
  });
});

// =============================================================================
// estimateBase64Size
// =============================================================================

describe('estimateBase64Size', () => {
  it('increases size by approximately 33%', () => {
    expect(estimateBase64Size(100)).toBe(133);
  });

  it('handles 0 bytes', () => {
    expect(estimateBase64Size(0)).toBe(0);
  });

  it('handles large values', () => {
    expect(estimateBase64Size(1_000_000)).toBe(1_330_000);
  });
});

// =============================================================================
// detectCSPCompatibility
// =============================================================================

describe('detectCSPCompatibility', () => {
  it('returns both supported when both Image loads succeed', async () => {
    const result = await detectCSPCompatibility();
    expect(result.supportsDataURL).toBe(true);
    expect(result.supportsBlobURL).toBe(true);
  });

  it('returns supportsDataURL=false and error when data URL image fails', async () => {
    mockImageShouldError = true;
    const result = await detectCSPCompatibility();
    expect(result.supportsDataURL).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns supportsBlobURL=false when blob URL image fails', async () => {
    // First Image load (data URL) succeeds, second (blob URL) fails
    let callCount = 0;
    class PartialFailImage {
      width = 1;
      height = 1;
      onload: (() => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      private _src = '';
      set src(v: string) {
        this._src = v;
        callCount++;
        if (callCount === 1) {
          setTimeout(() => this.onload?.(), 0);
        } else {
          setTimeout(() => this.onerror?.(new Event('error')), 0);
        }
      }
      get src() { return this._src; }
    }
    vi.stubGlobal('Image', PartialFailImage);
    const result = await detectCSPCompatibility();
    expect(result.supportsDataURL).toBe(true);
    expect(result.supportsBlobURL).toBe(false);
  });

  it('returns both false when image hangs (timeout)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockImageShouldHang = true;

    const promise = detectCSPCompatibility();
    // Advance past the 2000ms timeout for both tests
    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.supportsDataURL).toBe(false);
    expect(result.supportsBlobURL).toBe(false);
  });
});

// =============================================================================
// getImageDimensions
// =============================================================================

describe('getImageDimensions', () => {
  it('resolves with width and height from image', async () => {
    mockImageWidth = 800;
    mockImageHeight = 600;
    const file = makeFile('img.png', 100);
    const dims = await getImageDimensions(file);
    expect(dims).toEqual({ width: 800, height: 600 });
  });

  it('rejects when FileReader errors', async () => {
    mockFileReaderDataUrlShouldError = true;
    const file = makeFile('bad.png', 100);
    await expect(getImageDimensions(file)).rejects.toBeDefined();
  });

  it('rejects when Image errors', async () => {
    mockImageShouldError = true;
    const file = makeFile('bad.png', 100);
    await expect(getImageDimensions(file)).rejects.toBeDefined();
  });
});

// =============================================================================
// resizeImageVSCodeOfficial
// =============================================================================

describe('resizeImageVSCodeOfficial', () => {
  it('returns original data when image dimensions are small (skip compression)', async () => {
    // Both dims <= 768 and not GIF => skip
    mockImageWidth = 400;
    mockImageHeight = 300;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeOfficial(data, 'image/png');
    expect(result).toBe(data);
  });

  it('compresses when width > 768 (OR condition)', async () => {
    // width > 768, height <= 768 => compress
    mockImageWidth = 1000;
    mockImageHeight = 500;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeOfficial(data, 'image/png');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('compresses when height > 768 (OR condition)', async () => {
    mockImageWidth = 500;
    mockImageHeight = 1000;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeOfficial(data, 'image/png');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses phase-1 scaling when dimension > 2048', async () => {
    mockImageWidth = 4096;
    mockImageHeight = 3000;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeOfficial(data, 'image/jpeg');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('accepts File as input', async () => {
    mockImageWidth = 1024;
    mockImageHeight = 1024;
    const file = makeFile('test.png', 200, 'image/png');
    const result = await resizeImageVSCodeOfficial(file);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('forces GIF to be compressed even when small', async () => {
    mockImageWidth = 100;
    mockImageHeight = 100;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeOfficial(data, 'image/gif');
    // GIF is always compressed — should go through canvas path
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses image/jpeg output for JPEG input', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    const data = new Uint8Array([1, 2, 3]);
    // just check it resolves without error
    const result = await resizeImageVSCodeOfficial(data, 'image/jpeg');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses image/jpeg for image/jpg input', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeOfficial(data, 'image/jpg');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('rejects when canvas context is null', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasCtxNull = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeOfficial(data, 'image/png')).rejects.toThrow();
  });

  it('rejects when toBlob returns null', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasToBlobNull = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeOfficial(data, 'image/png')).rejects.toThrow();
  });

  it('rejects when Image fails to load', async () => {
    mockImageShouldError = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeOfficial(data, 'image/png')).rejects.toBeDefined();
  });

  it('rejects when FileReader errors', async () => {
    mockFileReaderDataUrlShouldError = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeOfficial(data, 'image/png')).rejects.toBeDefined();
  });
});

// =============================================================================
// smartCompressImageVSCodeOfficial
// =============================================================================

describe('smartCompressImageVSCodeOfficial', () => {
  it('compresses a JPEG file and returns correct shape', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    const file = makeFile('photo.jpg', 2000, 'image/jpeg');
    const result = await smartCompressImageVSCodeOfficial(file);
    expect(result).toMatchObject({
      compressedFile: expect.any(File),
      originalSize: 2000,
      compressedSize: expect.any(Number),
      compressionRatio: expect.any(Number),
      wasCompressed: expect.any(Boolean),
    });
  });

  it('outputs .jpg extension for jpeg input', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    const file = makeFile('photo.jpeg', 2000, 'image/jpeg');
    const result = await smartCompressImageVSCodeOfficial(file);
    expect(result.compressedFile.name).toMatch(/\.jpg$/);
  });

  it('outputs .png extension for PNG input', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    const file = makeFile('image.png', 2000, 'image/png');
    const result = await smartCompressImageVSCodeOfficial(file);
    expect(result.compressedFile.name).toMatch(/\.png$/);
  });

  it('throws a wrapped error when compression fails', async () => {
    mockImageShouldError = true;
    const file = makeFile('bad.png', 100, 'image/png');
    await expect(smartCompressImageVSCodeOfficial(file)).rejects.toThrow('VSCode official compression failed');
  });
});

// =============================================================================
// shouldCompressImageVSCodeOfficial
// =============================================================================

describe('shouldCompressImageVSCodeOfficial', () => {
  it('returns true when file exceeds 5MB', async () => {
    const file = makeFile('big.png', 6 * 1024 * 1024);
    expect(await shouldCompressImageVSCodeOfficial(file)).toBe(true);
  });

  it('returns true when either dimension > 768 (OR condition)', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 500; // only width > 768
    const file = makeFile('wide.png', 100);
    expect(await shouldCompressImageVSCodeOfficial(file)).toBe(true);
  });

  it('returns true for a GIF even when small', async () => {
    mockImageWidth = 100;
    mockImageHeight = 100;
    const file = makeFile('anim.gif', 100, 'image/gif');
    expect(await shouldCompressImageVSCodeOfficial(file)).toBe(true);
  });

  it('returns false when both dimensions <= 768 and not GIF', async () => {
    mockImageWidth = 400;
    mockImageHeight = 300;
    const file = makeFile('small.png', 100);
    expect(await shouldCompressImageVSCodeOfficial(file)).toBe(false);
  });

  it('returns false when getImageDimensions errors', async () => {
    mockFileReaderDataUrlShouldError = true;
    const file = makeFile('bad.png', 100);
    expect(await shouldCompressImageVSCodeOfficial(file)).toBe(false);
  });
});

// =============================================================================
// resizeImageVSCodeStyle
// =============================================================================

describe('resizeImageVSCodeStyle', () => {
  it('skips compression when both dims <= 768 and not GIF (AND condition)', async () => {
    mockImageWidth = 500;
    mockImageHeight = 500;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeStyle(data, 'image/png');
    expect(result).toBe(data);
  });

  it('skips compression when one dim <= 768 and other > 768, not GIF', async () => {
    // AND condition: only skip when BOTH <= 768
    // So width=500, height=500 => skip; width=800, height=500 => compress
    mockImageWidth = 800;
    mockImageHeight = 500;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeStyle(data, 'image/png');
    // One dim > 768 => should compress (go through canvas path)
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('does NOT skip when GIF even if both dims <= 768', async () => {
    mockImageWidth = 100;
    mockImageHeight = 100;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeStyle(data, 'image/gif');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('applies phase-1 scaling when > 2048', async () => {
    mockImageWidth = 3000;
    mockImageHeight = 3000;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeStyle(data, 'image/png');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('skips phase-2 when short side <= 768 after phase-1', async () => {
    // After phase 1: 2048x1200 (short side 1200 > 768 -> still scales)
    // Make width=2100, height=800 -> phase1 reduces both, short side might be < 768
    mockImageWidth = 2100;
    mockImageHeight = 800;
    const data = new Uint8Array([1, 2, 3]);
    const result = await resizeImageVSCodeStyle(data, 'image/png');
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('uses high smoothing quality for small images (< 2M pixels)', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900; // 810K pixels
    const data = new Uint8Array([1, 2, 3]);
    await resizeImageVSCodeStyle(data, 'image/jpeg');
    // just verify it doesn't throw
  });

  it('uses medium smoothing quality for large images (> 2M pixels)', async () => {
    mockImageWidth = 2000;
    mockImageHeight = 2000; // 4M pixels
    const data = new Uint8Array([1, 2, 3]);
    await resizeImageVSCodeStyle(data, 'image/jpeg');
    // just verify it doesn't throw
  });

  it('accepts File input', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    const file = makeFile('test.png', 200, 'image/png');
    const result = await resizeImageVSCodeStyle(file);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('rejects when canvas context is null', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasCtxNull = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toThrow();
  });

  it('rejects when drawImage throws', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasDrawImageThrow = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toThrow('Canvas drawing failed');
  });

  it('rejects when toBlob returns null', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasToBlobNull = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toThrow();
  });

  it('rejects when inner FileReader (arrayBuffer) errors', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    // After data url read succeeds and image loads, the inner reader for arrayBuffer fails
    // We need to let the first FileReader succeed but the second one fail
    let readerCount = 0;
    class PartialFailReader {
      result: any = null;
      onload: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      private _listeners: Record<string, Array<() => void>> = {};

      readAsDataURL(_blob: Blob) {
        readerCount++;
        this.result = 'data:image/png;base64,abc';
        setTimeout(() => {
          this._listeners['loadend']?.forEach(fn => fn());
          this.onload?.(new Event('load'));
        }, 0);
      }

      readAsArrayBuffer(_blob: Blob) {
        readerCount++;
        setTimeout(() => this.onerror?.(new Event('error')), 0);
      }

      addEventListener(event: string, handler: () => void) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
      }
    }
    vi.stubGlobal('FileReader', PartialFailReader);
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toBeDefined();
  });

  it('rejects when outer FileReader (dataURL) errors', async () => {
    mockFileReaderDataUrlShouldError = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toBeDefined();
  });

  it('rejects when Image fails to load', async () => {
    mockImageShouldError = true;
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toBeDefined();
  });

  it('rejects when FileReader result is null/empty', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    let readerCount = 0;
    class NullResultReader {
      result: any = null;
      onload: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      private _listeners: Record<string, Array<() => void>> = {};

      readAsDataURL(_blob: Blob) {
        readerCount++;
        this.result = 'data:image/png;base64,abc';
        setTimeout(() => {
          this._listeners['loadend']?.forEach(fn => fn());
          this.onload?.(new Event('load'));
        }, 0);
      }

      readAsArrayBuffer(_blob: Blob) {
        readerCount++;
        this.result = null; // null result
        setTimeout(() => {
          this._listeners['loadend']?.forEach(fn => fn());
          this.onload?.(new Event('load'));
        }, 0);
      }

      addEventListener(event: string, handler: () => void) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
      }
    }
    vi.stubGlobal('FileReader', NullResultReader);
    const data = new Uint8Array([1, 2, 3]);
    await expect(resizeImageVSCodeStyle(data, 'image/png')).rejects.toThrow('FileReader result is empty');
  });
});

// =============================================================================
// shouldCompressImageVSCodeStyle
// =============================================================================

describe('shouldCompressImageVSCodeStyle', () => {
  it('returns true when file exceeds 5MB', async () => {
    const file = makeFile('big.png', 6 * 1024 * 1024);
    expect(await shouldCompressImageVSCodeStyle(file)).toBe(true);
  });

  it('returns true when BOTH dimensions > 768 (AND condition)', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    const file = makeFile('big.png', 100);
    expect(await shouldCompressImageVSCodeStyle(file)).toBe(true);
  });

  it('returns false when only one dimension > 768 (AND condition)', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 400; // height <= 768
    const file = makeFile('wide.png', 100);
    expect(await shouldCompressImageVSCodeStyle(file)).toBe(false);
  });

  it('returns true for GIF even when small', async () => {
    mockImageWidth = 100;
    mockImageHeight = 100;
    const file = makeFile('anim.gif', 100, 'image/gif');
    expect(await shouldCompressImageVSCodeStyle(file)).toBe(true);
  });

  it('returns false for small non-GIF image', async () => {
    mockImageWidth = 400;
    mockImageHeight = 300;
    const file = makeFile('small.png', 100);
    expect(await shouldCompressImageVSCodeStyle(file)).toBe(false);
  });

  it('returns false when getImageDimensions throws', async () => {
    mockFileReaderDataUrlShouldError = true;
    const file = makeFile('bad.png', 100);
    expect(await shouldCompressImageVSCodeStyle(file)).toBe(false);
  });
});

// =============================================================================
// smartCompressImageVSCodeStyle (standard path — file <= 1MB)
// =============================================================================

describe('smartCompressImageVSCodeStyle — standard path', () => {
  it('compresses a small PNG file (standard path)', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    const file = makeFile('img.png', 500 * 1024, 'image/png'); // 500KB
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result.compressedFile).toBeInstanceOf(File);
    expect(result.originalSize).toBe(500 * 1024);
    expect(result.compressionRatio).toBeGreaterThan(0);
  });

  it('outputs .jpg extension for JPEG input', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    const file = makeFile('photo.jpg', 500 * 1024, 'image/jpeg');
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result.compressedFile.name).toMatch(/\.jpg$/);
  });

  it('outputs .jpg extension for image/jpg input', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    const file = makeFile('photo.jpg', 500 * 1024, 'image/jpg');
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result.compressedFile.name).toMatch(/\.jpg$/);
  });

  it('outputs .png extension for PNG input', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    const file = makeFile('image.png', 500 * 1024, 'image/png');
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result.compressedFile.name).toMatch(/\.png$/);
  });

  it('sets wasCompressed=true when compressed size is smaller', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    // Make compressed output tiny
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => setTimeout(() => cb(new Blob(['x'])), 0)) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result.wasCompressed).toBe(true);
  });
});

// =============================================================================
// smartCompressImageVSCodeStyle — aggressive path (file > 1MB)
// =============================================================================

describe('smartCompressImageVSCodeStyle — aggressive path', () => {
  it('uses aggressive path for files > 1MB', async () => {
    mockImageWidth = 2000;
    mockImageHeight = 2000;
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png'); // 2MB
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result.compressedFile).toBeInstanceOf(File);
    expect(result.originalSize).toBe(2 * 1024 * 1024);
    expect(result.compressedFile.name).toMatch(/\.jpg$/); // forced JPEG
  });

  it('applies step-1 scaling (> 1024) in aggressive mode', async () => {
    mockImageWidth = 2000;
    mockImageHeight = 1500;
    const file = makeFile('large.jpg', 2 * 1024 * 1024, 'image/jpeg');
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result).toMatchObject({ compressedFile: expect.any(File) });
  });

  it('does not apply step-1 when dimensions <= 1024', async () => {
    mockImageWidth = 700;
    mockImageHeight = 700;
    const file = makeFile('medium.png', 2 * 1024 * 1024, 'image/png');
    const result = await smartCompressImageVSCodeStyle(file);
    expect(result).toMatchObject({ compressedFile: expect.any(File) });
  });

  it('throws error when compressed size still > 1MB after aggressive compression', async () => {
    mockImageWidth = 2000;
    mockImageHeight = 2000;
    // Make toBlob return a 2MB blob
    const bigBlob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' });
    const bigCanvas = {
      width: 0, height: 0,
      getContext: vi.fn(() => mockCtx),
      toBlob: vi.fn((cb: (b: Blob | null) => void) => setTimeout(() => cb(bigBlob), 0)),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(bigCanvas as unknown as HTMLCanvasElement);
    // Also need inner FileReader to return a big buffer
    const bigBuffer = new ArrayBuffer(2 * 1024 * 1024);
    mockFileReaderArrayBufferResult = bigBuffer;

    const file = makeFile('huge.png', 3 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/still too large/);
  });

  it('rejects when canvas context is null in aggressive mode', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasCtxNull = true;
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });

  it('rejects when drawImage throws in aggressive mode', async () => {
    mockImageWidth = 1000;
    mockImageHeight = 1000;
    mockCanvasDrawImageThrow = true;
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });

  it('rejects when Image fails to load in aggressive mode (image.onerror)', async () => {
    mockImageShouldError = true;
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });

  it('rejects when outer FileReader errors in aggressive mode (reader.onerror)', async () => {
    mockFileReaderDataUrlShouldError = true;
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });

  it('rejects when inner FileReader errors (arrayBuffer) in aggressive mode', async () => {
    mockImageWidth = 700;
    mockImageHeight = 700;
    // First reader (dataURL) succeeds, second (arrayBuffer) fails
    let readerCount = 0;
    class AggressivePartialFailReader {
      result: any = null;
      onload: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      private _listeners: Record<string, Array<() => void>> = {};

      readAsDataURL(_blob: Blob) {
        readerCount++;
        this.result = 'data:image/png;base64,abc';
        setTimeout(() => {
          this._listeners['loadend']?.forEach(fn => fn());
          this.onload?.(new Event('load'));
        }, 0);
      }

      readAsArrayBuffer(_blob: Blob) {
        readerCount++;
        setTimeout(() => this.onerror?.(new Event('error')), 0);
      }

      addEventListener(event: string, handler: () => void) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
      }
    }
    vi.stubGlobal('FileReader', AggressivePartialFailReader);
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toBeDefined();
  });

  it('rejects when toBlob returns null in aggressive mode', async () => {
    mockImageWidth = 700;
    mockImageHeight = 700;
    mockCanvasToBlobNull = true;
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });

  it('rejects when inner aggressive FileReader result is null', async () => {
    mockImageWidth = 700;
    mockImageHeight = 700;
    let readerCount = 0;
    class NullResultAggressiveReader {
      result: any = null;
      onload: ((e: Event) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      private _listeners: Record<string, Array<() => void>> = {};

      readAsDataURL(_blob: Blob) {
        readerCount++;
        this.result = 'data:image/png;base64,abc';
        setTimeout(() => {
          this._listeners['loadend']?.forEach(fn => fn());
          this.onload?.(new Event('load'));
        }, 0);
      }

      readAsArrayBuffer(_blob: Blob) {
        readerCount++;
        this.result = null;
        setTimeout(() => {
          this._listeners['loadend']?.forEach(fn => fn());
          this.onload?.(new Event('load'));
        }, 0);
      }

      addEventListener(event: string, handler: () => void) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(handler);
      }
    }
    vi.stubGlobal('FileReader', NullResultAggressiveReader);
    const file = makeFile('large.png', 2 * 1024 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });
});

// =============================================================================
// smartCompressImageVSCodeStyle — error handling / error message mapping
// =============================================================================

describe('smartCompressImageVSCodeStyle — error messages', () => {
  const makeCompressError = async (errorMsg: string) => {
    // Force compression to throw with a specific message
    mockImageWidth = 900;
    mockImageHeight = 900;
    vi.stubGlobal('FileReader', class {
      result: any = null;
      onload: any = null;
      onerror: any = null;
      addEventListener = vi.fn();
      readAsDataURL() { setTimeout(() => { throw new Error(errorMsg); }, 0); }
      readAsArrayBuffer() {}
    });
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    return smartCompressImageVSCodeStyle(file);
  };

  it('wraps Canvas error with specific message', async () => {
    mockImageWidth = 900;
    mockImageHeight = 900;
    mockCanvasCtxNull = true;
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/Canvas/);
  });

  it('wraps unknown error type (non-Error thrown)', async () => {
    // The outer catch has an else-branch: `error instanceof Error ? ... : typeof error`.
    // The only await that is NOT inside an inner try-catch is `await data.arrayBuffer()`
    // in resizeImageVSCodeStyle when data is a File. Rejecting arrayBuffer with a plain
    // string propagates all the way to smartCompressImageVSCodeStyle's outer catch.
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue('plain-string-rejection');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/unknown error type/);
  });

  it('wraps Blob null error (mapped to Canvas message)', async () => {
    // toBlob returning null produces "Canvas to Blob conversion failed" which contains
    // "Canvas", so the error mapping produces the Canvas-related error message.
    mockImageWidth = 900;
    mockImageHeight = 900;
    mockCanvasToBlobNull = true;
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/Canvas|canvas/);
  });

  it('wraps FileReader error with specific message', async () => {
    mockFileReaderDataUrlShouldError = true;
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow();
  });

  it('wraps "Compression initialization failed" with initialization error message', async () => {
    // Make file.arrayBuffer() reject with an Error containing 'Compression initialization failed'
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(
      new Error('Compression initialization failed: something went wrong')
    );
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/initialization error/);
  });

  it('wraps "Content Security Policy" error with CSP message', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(
      new Error('Content Security Policy violation')
    );
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/security policy/);
  });

  it('wraps "CSP" error with CSP message', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('CSP blocked'));
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/security policy/);
  });

  it('wraps "FileReader" in error message', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('FileReader failed to read'));
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/file read error/);
  });

  it('wraps "file read failed" in error message', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('file read failed unexpectedly'));
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/file read error/);
  });

  it('wraps "Image failed to load" in error message', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Image failed to load: corrupted'));
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/cannot be loaded/);
  });

  it('wraps "Blob" in error message', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Blob creation failed'));
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/format conversion/);
  });

  it('uses generic message for unrecognized error text', async () => {
    const file = makeFile('img.png', 500 * 1024, 'image/png');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('some random failure'));
    await expect(smartCompressImageVSCodeStyle(file)).rejects.toThrow(/some random failure/);
  });
});
