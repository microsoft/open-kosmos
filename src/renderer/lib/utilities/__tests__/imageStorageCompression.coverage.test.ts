/** @vitest-environment happy-dom */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ImageContentPart } from '@shared/types/chatTypes';

// We import the functions under test after setting up mocks
import {
  shouldCompressForStorage,
  compressImageForStorage,
  compressImagePartForStorage,
  compressMessageImagesForStorage,
} from '../imageStorageCompression';

// ── Canvas / DOM mocks ─────────────────────────────────────────────────────────

function makeBase64(bytes: number): string {
  // Returns a base64 string whose decoded length ~= bytes
  return 'A'.repeat(Math.ceil(bytes * 4 / 3));
}

function setupCanvasMock(opts: {
  toDataUrlResult?: string;
  ctxNull?: boolean;
} = {}) {
  const toDataURL = vi.fn().mockReturnValue(
    opts.toDataUrlResult ?? `data:image/jpeg,${makeBase64(50 * 1024)}`
  );
  const ctx = opts.ctxNull
    ? null
    : {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        drawImage: vi.fn(),
      };

  const canvas = {
    getContext: vi.fn().mockReturnValue(ctx),
    toDataURL,
    width: 0,
    height: 0,
  };

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') return canvas as any;
    return document.createElement(tag);
  });

  return { canvas, toDataURL, ctx };
}

function makeImagePart(
  url: string,
  fileSize: number,
  opts: Partial<ImageContentPart['metadata']> = {}
): ImageContentPart {
  return {
    type: 'image',
    image_url: { url, detail: 'auto' },
    metadata: {
      fileName: 'test.jpg',
      fileSize,
      mimeType: 'image/jpeg',
      ...opts,
    },
  };
}

// A minimal 1×1 JPEG in base64 (real JPEG so Image.onload fires)
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAHBABAAMBAAMBAAAAAAAAAAAAAQACAxESITH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Aqds8xqKxKXFTvFXE6pJp3kElNTxjrp58RQAAV//Z';

function makeTinyDataUrl() {
  return `data:image/jpeg;base64,${TINY_JPEG_B64}`;
}

function triggerImageLoad(naturalWidth = 100, naturalHeight = 100) {
  // FileReader constructor mock — must be a real class for `new FileReader()`
  class MockFileReader {
    onload: ((e: any) => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    result: string = makeTinyDataUrl();
    readAsDataURL(_file: any) {
      Promise.resolve().then(() => {
        if (this.onload) this.onload({ target: { result: makeTinyDataUrl() } });
      });
    }
  }

  // Image constructor mock — must be a real class for `new Image()`
  const w = naturalWidth;
  const h = naturalHeight;
  class MockImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width: number = w;
    height: number = h;
    private _src: string = '';
    get src() { return this._src; }
    set src(val: string) {
      this._src = val;
      this.width = w;
      this.height = h;
      const self = this;
      Promise.resolve().then(() => { if (self.onload) self.onload(); });
    }
  }

  return { mockFileReader: MockFileReader, mockImage: MockImage };
}

// ── shouldCompressForStorage ───────────────────────────────────────────────────
describe('shouldCompressForStorage', () => {
  it('returns true when fileSize exceeds maxSize and not compressed', () => {
    const part = makeImagePart('data:...', 200 * 1024);
    expect(shouldCompressForStorage(part)).toBe(true);
  });

  it('returns false when fileSize is within maxSize', () => {
    const part = makeImagePart('data:...', 50 * 1024);
    expect(shouldCompressForStorage(part)).toBe(false);
  });

  it('returns false when already storage compressed', () => {
    const part = makeImagePart('data:...', 200 * 1024, { storageCompressed: true });
    expect(shouldCompressForStorage(part)).toBe(false);
  });

  it('uses custom maxSize', () => {
    const part = makeImagePart('data:...', 30 * 1024);
    expect(shouldCompressForStorage(part, 20 * 1024)).toBe(true);
    expect(shouldCompressForStorage(part, 50 * 1024)).toBe(false);
  });
});

// ── compressImageForStorage ────────────────────────────────────────────────────
describe('compressImageForStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when canvas 2d context is null', async () => {
    setupCanvasMock({ ctxNull: true });
    const { mockFileReader, mockImage } = triggerImageLoad();
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
    await expect(compressImageForStorage(file)).rejects.toThrow('Unable to create Canvas 2D context');
  });

  it('resolves with compressed result for a small image', async () => {
    // toDataURL returns ~50KB
    const smallB64 = makeBase64(40 * 1024);
    setupCanvasMock({ toDataUrlResult: `data:image/jpeg,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(200, 200);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const file = new File(['x'.repeat(60 * 1024)], 'test.jpg', { type: 'image/jpeg' });
    const result = await compressImageForStorage(file);
    expect(result).toMatchObject({
      dataUrl: expect.stringContaining('data:image/jpeg'),
      width: 200,
      height: 200,
      compressedSize: expect.any(Number),
      compressionRatio: expect.any(Number),
    });
  });

  it('scales down image exceeding maxDimension', async () => {
    const smallB64 = makeBase64(40 * 1024);
    const { canvas } = setupCanvasMock({ toDataUrlResult: `data:image/jpeg,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(1024, 768);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const file = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    const result = await compressImageForStorage(file, { maxDimension: 512 });
    // 512/1024 = 0.5 ratio → width=512, height=384
    expect(result.width).toBe(512);
    expect(result.height).toBe(384);
  });

  it('iterates quality reduction when image is too large', async () => {
    let callCount = 0;
    // First several calls return large size, last returns small
    const largeB64 = makeBase64(200 * 1024);
    const smallB64 = makeBase64(40 * 1024);
    const toDataURL = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) return `data:image/jpeg,${largeB64}`;
      return `data:image/jpeg,${smallB64}`;
    });
    const ctx = { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage: vi.fn() };
    const canvas = { getContext: vi.fn().mockReturnValue(ctx), toDataURL, width: 0, height: 0 };
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') return canvas as any;
      return document.createElement(tag);
    });
    const { mockFileReader, mockImage } = triggerImageLoad(100, 100);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    const result = await compressImageForStorage(file, { maxSizeBytes: 100 * 1024 });
    expect(toDataURL.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result).toBeDefined();
  });

  it('uses webp format when configured', async () => {
    const smallB64 = makeBase64(40 * 1024);
    const { toDataURL } = setupCanvasMock({ toDataUrlResult: `data:image/webp,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(100, 100);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    await compressImageForStorage(file, { format: 'webp' });
    expect(toDataURL).toHaveBeenCalledWith('image/webp', expect.any(Number));
  });

  it('rejects when FileReader fails', async () => {
    setupCanvasMock();
    class MockFileReaderError {
      onload: any = null;
      onerror: any = null;
      readAsDataURL(_file: any) {
        Promise.resolve().then(() => { if (this.onerror) this.onerror(new Error('read error')); });
      }
    }
    (globalThis as any).FileReader = MockFileReaderError;

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    await expect(compressImageForStorage(file)).rejects.toThrow('FileReader read failed');
  });

  it('rejects when FileReader returns empty result', async () => {
    setupCanvasMock();
    class MockFileReaderEmpty {
      onload: any = null;
      onerror: any = null;
      readAsDataURL(_file: any) {
        Promise.resolve().then(() => { if (this.onload) this.onload({ target: { result: '' } }); });
      }
    }
    (globalThis as any).FileReader = MockFileReaderEmpty;

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    await expect(compressImageForStorage(file)).rejects.toThrow('FileReader conversion failed');
  });

  it('rejects when image fails to load', async () => {
    setupCanvasMock();
    class MockFileReaderTrigger {
      onload: any = null;
      onerror: any = null;
      readAsDataURL(_file: any) {
        Promise.resolve().then(() => {
          if (this.onload) this.onload({ target: { result: 'data:image/jpeg;base64,xxx' } });
        });
      }
    }
    class MockImageError {
      onload: any = null;
      onerror: any = null;
      private _src: string = '';
      get src() { return this._src; }
      set src(_val: string) {
        this._src = _val;
        const self = this;
        Promise.resolve().then(() => { if (self.onerror) self.onerror(); });
      }
    }
    (globalThis as any).FileReader = MockFileReaderTrigger;
    (globalThis as any).Image = MockImageError;

    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    await expect(compressImageForStorage(file)).rejects.toThrow('Image failed to load');
  });
});

// ── compressImagePartForStorage ────────────────────────────────────────────────
describe('compressImagePartForStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws for non-data URLs', async () => {
    const part = makeImagePart('https://example.com/img.jpg', 1000);
    await expect(compressImagePartForStorage(part)).rejects.toThrow(
      'Only data URL format images are supported'
    );
  });

  it('compresses a valid data URL part', async () => {
    const smallB64 = makeBase64(40 * 1024);
    setupCanvasMock({ toDataUrlResult: `data:image/jpeg,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(200, 200);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    // Use TINY_JPEG_B64 which is real base64 that atob can parse
    const url = makeTinyDataUrl();
    // Override fileSize to be large enough to be "eligible" (not checked here, just pass directly)
    const part = makeImagePart(url, 200 * 1024, { compressionStage: 'first' });

    const result = await compressImagePartForStorage(part);
    expect(result.type).toBe('image');
    expect(result.image_url.detail).toBe('low');
    expect(result.metadata.storageCompressed).toBe(true);
    expect(result.metadata.compressionStage).toBe('both');
    expect(result.metadata.originalSize).toBe(200 * 1024);
  });

  it('sets compressionStage to second when not first', async () => {
    const smallB64 = makeBase64(40 * 1024);
    setupCanvasMock({ toDataUrlResult: `data:image/jpeg,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(200, 200);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const url = makeTinyDataUrl();
    const part = makeImagePart(url, 200 * 1024);

    const result = await compressImagePartForStorage(part);
    expect(result.metadata.compressionStage).toBe('second');
  });
});

// ── compressMessageImagesForStorage ───────────────────────────────────────────
describe('compressMessageImagesForStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns message unchanged when content is not an array', async () => {
    const message = { role: 'user', content: 'text only' };
    const result = await compressMessageImagesForStorage(message);
    expect(result).toBe(message);
  });

  it('returns message unchanged when no eligible images', async () => {
    const message = {
      role: 'user',
      content: [
        makeImagePart('data:...', 50 * 1024), // too small
        makeImagePart('data:...', 200 * 1024, { storageCompressed: true }), // already compressed
        { type: 'text', text: 'hello' },
      ],
    };
    const result = await compressMessageImagesForStorage(message);
    expect(result).toBe(message);
  });

  it('compresses eligible images and returns new message', async () => {
    const smallB64 = makeBase64(40 * 1024);
    setupCanvasMock({ toDataUrlResult: `data:image/jpeg,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(200, 200);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const url = makeTinyDataUrl();
    const message = {
      role: 'user',
      content: [makeImagePart(url, 200 * 1024)],
    };
    const result = await compressMessageImagesForStorage(message);
    expect(result).not.toBe(message);
    expect(result.content[0].metadata.storageCompressed).toBe(true);
  });

  it('keeps non-image parts as-is', async () => {
    const smallB64 = makeBase64(40 * 1024);
    setupCanvasMock({ toDataUrlResult: `data:image/jpeg,${smallB64}` });
    const { mockFileReader, mockImage } = triggerImageLoad(200, 200);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const url = makeTinyDataUrl();
    const textPart = { type: 'text', text: 'hello' };
    const message = {
      role: 'user',
      content: [makeImagePart(url, 200 * 1024), textPart],
    };
    const result = await compressMessageImagesForStorage(message);
    expect(result.content[1]).toBe(textPart);
  });

  it('falls back to original image part on compression failure', async () => {
    setupCanvasMock({ ctxNull: true });
    const { mockFileReader, mockImage } = triggerImageLoad(200, 200);
    (globalThis as any).FileReader = mockFileReader;
    (globalThis as any).Image = mockImage;

    const url = makeTinyDataUrl();
    const originalPart = makeImagePart(url, 200 * 1024);
    const message = { role: 'user', content: [originalPart] };
    const result = await compressMessageImagesForStorage(message);
    // Compression failed, so we get back original
    expect(result.content[0]).toBe(originalPart);
  });
});
