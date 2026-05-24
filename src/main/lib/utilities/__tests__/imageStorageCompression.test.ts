// @ts-nocheck
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../lib/unifiedLogger', () => {
  const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { createLogger: vi.fn(() => noop) };
});

const { mockSharpInstance, sharpFn } = vi.hoisted(() => {
  const instance: any = {};
  instance.metadata = vi.fn().mockResolvedValue({ width: 1024, height: 768 });
  instance.resize = vi.fn().mockReturnValue(instance);
  instance.flatten = vi.fn().mockReturnValue(instance);
  instance.jpeg = vi.fn().mockReturnValue(instance);
  instance.webp = vi.fn().mockReturnValue(instance);
  instance.toBuffer = vi.fn().mockResolvedValue(Buffer.from('compressed-data'));
  const fn = vi.fn(() => instance);
  return { mockSharpInstance: instance, sharpFn: fn };
});

vi.mock('sharp', () => ({ default: sharpFn }));

import {
  compressImageFirstPass,
  compressImageForStorage,
  compressImagePartForStorage,
  compressMessageImagesForStorage,
  MAX_IMAGE_BYTES_FOR_INLINE,
  MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE,
} from '../imageStorageCompression';

// Minimal valid base64 1x1 pixel white JPEG — used as a stand-in
const DUMMY_BASE64 = Buffer.from('dummy-image-data').toString('base64');
const DUMMY_DATA_URL = `data:image/jpeg;base64,${DUMMY_BASE64}`;

describe('imageStorageCompression constants', () => {
  it('MAX_IMAGE_BYTES_FOR_INLINE is 10MB', () => {
    expect(MAX_IMAGE_BYTES_FOR_INLINE).toBe(10 * 1024 * 1024);
  });

  it('MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE is 4MB', () => {
    expect(MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE).toBe(4 * 1024 * 1024);
  });
});

describe('compressImageFirstPass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to large image by default
    mockSharpInstance.metadata.mockResolvedValue({ width: 1024, height: 768 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('compressed'));
  });

  it('skips compression when both dimensions are <= targetShortSide', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 500, height: 400 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/jpeg');

    expect(result.wasCompressed).toBe(false);
    expect(result.base64Data).toBe(DUMMY_BASE64);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('compresses a JPEG image larger than targetShortSide', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 2000, height: 1500 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/jpeg');

    expect(result.wasCompressed).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('compresses and outputs webp when format is webp and input is not JPEG', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 2000, height: 1500 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/png', { format: 'webp' });

    expect(result.wasCompressed).toBe(true);
    expect(result.mimeType).toBe('image/webp');
    expect(mockSharpInstance.webp).toHaveBeenCalled();
  });

  it('compresses non-JPEG with default jpeg format via flatten', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 2000, height: 1500 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/png');

    expect(result.wasCompressed).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(mockSharpInstance.flatten).toHaveBeenCalled();
  });

  it('applies step 1 (maxDimension) when a dimension exceeds 2048', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 4096, height: 3000 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/jpeg');
    expect(result.wasCompressed).toBe(true);
  });

  it('throws when sharp cannot get image dimensions', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: undefined, height: undefined });
    sharpFn.mockReturnValue(mockSharpInstance);

    await expect(compressImageFirstPass(DUMMY_BASE64, 'image/jpeg')).rejects.toThrow(
      'Unable to get image dimensions',
    );
  });

  it('throws non-Error when sharp rejects with a string (covers String(error) branch)', async () => {
    mockSharpInstance.metadata.mockRejectedValueOnce('sharp string error');
    sharpFn.mockReturnValue(mockSharpInstance);

    await expect(compressImageFirstPass(DUMMY_BASE64, 'image/jpeg')).rejects.toEqual('sharp string error');
  });

  it('skips step 2 when short side is already <= targetShortSide after step 1', async () => {
    // Image 5000x400: after step 1 (maxDimension 2048), width=2048, height=164 — short side 164 <= 768
    mockSharpInstance.metadata.mockResolvedValue({ width: 5000, height: 400 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/jpeg');
    expect(result.wasCompressed).toBe(true);
    // Step 2 was NOT triggered since short side after step 1 is 164
    expect(result.height).toBe(164);
  });

  it('uses image/jpg as a jpeg input type', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 2000, height: 1500 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageFirstPass(DUMMY_BASE64, 'image/jpg');
    expect(result.mimeType).toBe('image/jpeg');
  });
});

describe('compressImageForStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 1024, height: 768 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('compressed-storage'));
  });

  it('compresses a valid data URL', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageForStorage(DUMMY_DATA_URL);

    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(result.compressedSize).toBeGreaterThan(0);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it('throws for invalid data URL format', async () => {
    await expect(compressImageForStorage('not-a-data-url')).rejects.toThrow(
      'Invalid data URL format',
    );
  });

  it('throws when sharp cannot get image dimensions', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: undefined, height: undefined });
    sharpFn.mockReturnValue(mockSharpInstance);

    await expect(compressImageForStorage(DUMMY_DATA_URL)).rejects.toThrow(
      'Unable to get image dimensions',
    );
  });

  it('resizes when dimensions exceed maxDimension', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 2000, height: 1500 });
    sharpFn.mockReturnValue(mockSharpInstance);

    const result = await compressImageForStorage(DUMMY_DATA_URL, { maxDimension: 512 });
    expect(mockSharpInstance.resize).toHaveBeenCalled();
    expect(result.width).toBeLessThanOrEqual(512);
    expect(result.height).toBeLessThanOrEqual(512);
  });

  it('does not resize when dimensions are within maxDimension', async () => {
    mockSharpInstance.metadata.mockResolvedValue({ width: 400, height: 300 });
    sharpFn.mockReturnValue(mockSharpInstance);

    await compressImageForStorage(DUMMY_DATA_URL, { maxDimension: 512 });
    expect(mockSharpInstance.resize).not.toHaveBeenCalled();
  });
});

describe('compressImagePartForStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('compressed'));
  });

  function makeImagePart(url: string = DUMMY_DATA_URL, compressionStage: 'first' | 'second' | 'both' = 'first') {
    return {
      type: 'image_url' as const,
      image_url: { url, detail: 'auto' as const },
      metadata: {
        fileName: 'test.jpg',
        fileSize: 100000,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        compressionStage,
        storageCompressed: false,
      },
    };
  }

  it('compresses an image part and sets storageCompressed=true', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);

    const part = makeImagePart();
    const result = await compressImagePartForStorage(part);

    expect(result.metadata.storageCompressed).toBe(true);
    expect(result.metadata.compressionStage).toBe('both');
    expect(result.image_url.detail).toBe('low');
  });

  it('sets compressionStage to "second" when input stage is not "first"', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);

    const part = makeImagePart(DUMMY_DATA_URL, 'second');
    const result = await compressImagePartForStorage(part);

    expect(result.metadata.compressionStage).toBe('second');
  });

  it('propagates errors from compressImageForStorage', async () => {
    const badPart = makeImagePart('not-a-data-url');
    await expect(compressImagePartForStorage(badPart)).rejects.toThrow();
  });

  it('propagates non-Error objects from compressImageForStorage (String(error) branch)', async () => {
    mockSharpInstance.metadata.mockRejectedValueOnce('non-error string');
    sharpFn.mockReturnValue(mockSharpInstance);

    const part = makeImagePart();
    await expect(compressImagePartForStorage(part)).rejects.toEqual('non-error string');
  });
});

describe('compressMessageImagesForStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSharpInstance.metadata.mockResolvedValue({ width: 800, height: 600 });
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('compressed'));
  });

  function makeMessage(content: any[]) {
    return { role: 'user', content };
  }

  function makeImagePart(overrides: Partial<any> = {}) {
    return {
      type: 'image_url',
      image_url: { url: DUMMY_DATA_URL, detail: 'auto' },
      metadata: {
        fileName: 'img.jpg',
        fileSize: 200000,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        compressionStage: 'first',
        storageCompressed: false,
        ...overrides.metadata,
      },
      ...overrides,
    };
  }

  it('returns message unchanged when content is not an array', async () => {
    const message = { role: 'user', content: 'plain text' };
    const result = await compressMessageImagesForStorage(message);
    expect(result).toBe(message);
  });

  it('returns message unchanged when no eligible images', async () => {
    const part = makeImagePart({ metadata: { fileSize: 100, storageCompressed: false } });
    const message = makeMessage([part]);
    const result = await compressMessageImagesForStorage(message, { maxSizeBytes: 50 * 1024 });
    // fileSize 100 < maxSizeBytes 51200, not eligible
    expect(result.content[0]).toBe(part);
  });

  it('compresses eligible image_url parts', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);

    const part = makeImagePart();
    const message = makeMessage([part]);
    const result = await compressMessageImagesForStorage(message);

    expect(result.content[0].metadata.storageCompressed).toBe(true);
  });

  it('handles "image" type parts as well as "image_url"', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);

    const part = makeImagePart({ type: 'image' });
    const message = makeMessage([part]);
    const result = await compressMessageImagesForStorage(message);

    expect(result.content[0].metadata.storageCompressed).toBe(true);
  });

  it('keeps already-compressed images unchanged', async () => {
    const part = makeImagePart({ metadata: { fileSize: 200000, storageCompressed: true } });
    const message = makeMessage([part]);
    const result = await compressMessageImagesForStorage(message);
    expect(result.content[0]).toBe(part);
  });

  it('keeps small (below threshold) image parts unchanged alongside eligible ones', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);
    // bigPart is eligible for compression (fileSize > maxSizeBytes)
    const bigPart = makeImagePart();
    // smallPart has fileSize below threshold — should pass through unchanged
    const smallPart = makeImagePart({ metadata: { fileSize: 100, storageCompressed: false } });
    const message = makeMessage([bigPart, smallPart]);
    const result = await compressMessageImagesForStorage(message, { maxSizeBytes: 50 * 1024 });

    expect(result.content[0].metadata.storageCompressed).toBe(true);
    expect(result.content[1]).toBe(smallPart);
  });

  it('passes through non-image content parts unchanged', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);
    const textPart = { type: 'text', text: 'hello' };
    const imgPart = makeImagePart();
    const message = makeMessage([textPart, imgPart]);
    const result = await compressMessageImagesForStorage(message);

    expect(result.content[0]).toBe(textPart);
  });

  it('keeps original part when compression fails', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);
    mockSharpInstance.metadata.mockRejectedValueOnce(new Error('sharp error'));

    const part = makeImagePart();
    const message = makeMessage([part]);
    const result = await compressMessageImagesForStorage(message);

    expect(result.content[0]).toBe(part);
  });

  it('keeps original part when compression fails with non-Error (String(error) branch)', async () => {
    sharpFn.mockReturnValue(mockSharpInstance);
    mockSharpInstance.metadata.mockRejectedValueOnce('plain string error');

    const part = makeImagePart();
    const message = makeMessage([part]);
    const result = await compressMessageImagesForStorage(message);

    expect(result.content[0]).toBe(part);
  });
});
