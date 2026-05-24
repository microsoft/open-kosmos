/**
 * @vitest-environment node
 *
 * Full-coverage tests for DownloadFileTool — covers all branches in execute(),
 * validateArgs(), validateUrl(), validateFilename(), validateAndNormalizePath(),
 * getMimeTypeExtension(), and getDefinition().
 */

import * as path from 'path';
import * as os from 'os';

// ─── hoisted mocks ────────────────────────────────────────────────────────────
const mockFetch = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockStatSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockCreateWriteStream = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());

vi.mock('node-fetch', () => ({ default: mockFetch }));

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  return {
    ...real,
    existsSync: mockExistsSync,
    statSync: mockStatSync,
    mkdirSync: mockMkdirSync,
    createWriteStream: mockCreateWriteStream,
    unlinkSync: mockUnlinkSync,
  };
});

import { DownloadFileTool } from '../downloadFileTool';

// ─── helpers ────────────────────────────────────────────────────────────────

const HOME = os.homedir();

/** Create a fake node-fetch response with a streaming body */
function makeStreamResponse(chunks: Buffer[], opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  contentLength?: string;
} = {}) {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    contentType = 'image/png',
    contentLength,
  } = opts;
  const headers = new Map<string, string | null>();
  headers.set('content-type', contentType);
  if (contentLength !== undefined) headers.set('content-length', contentLength);

  return {
    ok,
    status,
    statusText,
    headers: {
      get: (key: string) => headers.get(key.toLowerCase()) ?? null,
    },
    body: chunks.length > 0
      ? (async function* () {
          for (const chunk of chunks) yield chunk;
        })()
      : null,
  };
}

/** A writable stream that collects written data and resolves finish event */
function makeFakeWriteStream() {
  const written: Buffer[] = [];
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const on = vi.fn((event: string, fn: (...args: any[]) => void) => {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  });
  const emit = (event: string, ...args: any[]) => {
    for (const fn of (listeners[event] || [])) fn(...args);
  };
  const stream = {
    write: vi.fn((chunk: any) => { written.push(chunk); }),
    end: vi.fn(() => {
      // Use setImmediate so that 'finish' fires after 'on' listener is registered
      setImmediate(() => emit('finish'));
    }),
    close: vi.fn(),
    on,
    emit: vi.fn(emit),
    _written: written,
  };
  return stream;
}

// ─── getDefinition ──────────────────────────────────────────────────────────
describe('DownloadFileTool.getDefinition', () => {
  it('returns a definition with name download_file', () => {
    const def = DownloadFileTool.getDefinition();
    expect(def.name).toBe('download_file');
    expect(def.inputSchema.required).toContain('url');
    expect(def.inputSchema.required).toContain('filename');
  });
});

// ─── validateArgs (via execute) ──────────────────────────────────────────────
describe('DownloadFileTool.execute — argument validation errors', () => {
  it('throws when url is missing', async () => {
    await expect(
      DownloadFileTool.execute({ url: '', filename: 'file.png' }),
    ).rejects.toThrow('url is required');
  });

  it('throws when url is not a string (null coerced)', async () => {
    await expect(
      DownloadFileTool.execute({ url: null as any, filename: 'file.png' }),
    ).rejects.toThrow('url is required');
  });

  it('throws for non-http/https URL (ftp)', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'ftp://example.com/file.bin', filename: 'file.bin' }),
    ).rejects.toThrow('Only HTTP and HTTPS protocols are supported');
  });

  it('throws for invalid URL format', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'not a url at all', filename: 'file.txt' }),
    ).rejects.toThrow('Invalid URL');
  });

  it('throws when filename is missing', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/file.png', filename: '' }),
    ).rejects.toThrow('filename is required');
  });

  it('throws when filename contains path separator /', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/file.png', filename: 'a/b.png' }),
    ).rejects.toThrow('path separators');
  });

  it('throws when filename contains path separator \\', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'a\\b.png' }),
    ).rejects.toThrow('path separators');
  });

  it('throws when filename contains ..', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: '..evil.png' }),
    ).rejects.toThrow('path separators');
  });

  it('throws when filename is whitespace only', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: '   ' }),
    ).rejects.toThrow('empty');
  });

  it('throws when filename contains invalid chars like *', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f*le.txt' }),
    ).rejects.toThrow('invalid characters');
  });

  it('throws when filename contains invalid chars like :', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f:le.txt' }),
    ).rejects.toThrow('invalid characters');
  });

  it('throws when filename length > 255', async () => {
    const longName = 'a'.repeat(256) + '.txt';
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: longName }),
    ).rejects.toThrow('too long');
  });

  it('throws when maxSizeBytes is non-integer', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f.txt', maxSizeBytes: 1.5 }),
    ).rejects.toThrow('maxSizeBytes');
  });

  it('throws when maxSizeBytes is < 1', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f.txt', maxSizeBytes: 0 }),
    ).rejects.toThrow('maxSizeBytes');
  });

  it('throws when maxSizeBytes exceeds 1GB', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f.txt', maxSizeBytes: 2_000_000_000 }),
    ).rejects.toThrow('maxSizeBytes');
  });

  it('throws when timeout is < 1000', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f.txt', timeout: 500 }),
    ).rejects.toThrow('timeout');
  });

  it('throws when timeout > 300000', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f.txt', timeout: 400000 }),
    ).rejects.toThrow('timeout');
  });

  it('throws when saveDirectory is empty string', async () => {
    await expect(
      DownloadFileTool.execute({ url: 'https://example.com/f', filename: 'f.txt', saveDirectory: '   ' }),
    ).rejects.toThrow('saveDirectory');
  });
});

// ─── path validation errors ──────────────────────────────────────────────────
describe('DownloadFileTool.execute — path validation errors', () => {
  it('returns error when saveDirectory is outside user home', async () => {
    const result = await DownloadFileTool.execute({
      url: 'https://example.com/file.png',
      filename: 'file.png',
      saveDirectory: '/etc/passwd_dir',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('user home directory');
  });

  it('returns error when saveDirectory exists but is a file not a directory', async () => {
    const saveDir = path.join(HOME, 'Downloads');
    mockExistsSync.mockImplementation((p: string) => p === saveDir);
    mockStatSync.mockReturnValue({ isDirectory: () => false });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/file.png',
      filename: 'file.png',
      saveDirectory: saveDir,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not a directory');
  });

  it('returns error when directory does not exist and createDirectory=false', async () => {
    const saveDir = path.join(HOME, 'NonExistentDir');
    mockExistsSync.mockReturnValue(false);

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/file.png',
      filename: 'file.png',
      saveDirectory: saveDir,
      createDirectory: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('createDirectory is false');
  });

  it('returns error when mkdirSync throws', async () => {
    const saveDir = path.join(HOME, 'FailDir');
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => { throw new Error('permission denied'); });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/file.png',
      filename: 'file.png',
      saveDirectory: saveDir,
      createDirectory: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create directory');
  });
});

// ─── file already exists ────────────────────────────────────────────────────
describe('DownloadFileTool.execute — file overwrite check', () => {
  beforeEach(() => {
    const saveDir = path.join(HOME, 'Downloads');
    // Dir exists and is directory
    mockExistsSync.mockImplementation((p: string) => true);
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('returns error when file exists and overwrite=false', async () => {
    const result = await DownloadFileTool.execute({
      url: 'https://example.com/file.png',
      filename: 'file.png',
      saveDirectory: path.join(HOME, 'Downloads'),
      overwrite: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});

// ─── HTTP error ───────────────────────────────────────────────────────────────
describe('DownloadFileTool.execute — HTTP errors', () => {
  beforeEach(() => {
    mockExistsSync.mockImplementation((p: string) => {
      // Dir exists, file doesn't
      return p === path.join(HOME, 'Downloads');
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('returns error for non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue(makeStreamResponse([], { ok: false, status: 404, statusText: 'Not Found' }));
    const result = await DownloadFileTool.execute({
      url: 'https://example.com/missing.png',
      filename: 'missing.png',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 404');
  });
});

// ─── content-length exceeds limit ───────────────────────────────────────────
describe('DownloadFileTool.execute — content-length size check', () => {
  beforeEach(() => {
    mockExistsSync.mockImplementation((p: string) => {
      return p === path.join(HOME, 'Downloads');
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('returns error when content-length header exceeds maxSizeBytes', async () => {
    const maxSizeBytes = 1024;
    mockFetch.mockResolvedValue(
      makeStreamResponse([], { contentLength: String(maxSizeBytes + 1) }),
    );
    const result = await DownloadFileTool.execute({
      url: 'https://example.com/big.png',
      filename: 'big.png',
      maxSizeBytes,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('too large');
  });
});

// ─── empty response body ─────────────────────────────────────────────────────
describe('DownloadFileTool.execute — empty body', () => {
  beforeEach(() => {
    mockExistsSync.mockImplementation((p: string) => p === path.join(HOME, 'Downloads'));
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('returns error when response.body is null', async () => {
    mockFetch.mockResolvedValue(makeStreamResponse([], {}));
    const result = await DownloadFileTool.execute({
      url: 'https://example.com/file.png',
      filename: 'file.png',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });
});

// ─── successful download ─────────────────────────────────────────────────────
describe('DownloadFileTool.execute — successful download', () => {
  let fakeStream: ReturnType<typeof makeFakeWriteStream>;

  beforeEach(() => {
    fakeStream = makeFakeWriteStream();
    mockCreateWriteStream.mockReturnValue(fakeStream);
    mockExistsSync.mockImplementation((p: string) => {
      // dir exists, file does not (overwrite=false default)
      return p === path.join(HOME, 'Downloads');
    });
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('downloads successfully and returns correct result shape', async () => {
    const chunk = Buffer.from('fake image data');
    mockFetch.mockResolvedValue({
      ...makeStreamResponse([chunk], { contentType: 'image/png' }),
      body: (async function* () { yield chunk; })(),
    });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/image.png',
      filename: 'image.png',
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toContain('image.png');
    expect(result.fileSize).toBe(chunk.length);
    expect(result.mimeType).toBe('image/png');
    expect(result.downloadTime).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('overwrites existing file when overwrite=true', async () => {
    // Both dir and file exist
    mockExistsSync.mockReturnValue(true);
    mockStatSync.mockReturnValue({ isDirectory: () => true });

    const chunk = Buffer.from('data');
    mockFetch.mockResolvedValue({
      ...makeStreamResponse([chunk]),
      body: (async function* () { yield chunk; })(),
    });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/f.txt',
      filename: 'f.txt',
      overwrite: true,
    });
    expect(result.success).toBe(true);
  });

  it('uses default Downloads folder when saveDirectory is not specified', async () => {
    const chunk = Buffer.from('x');
    mockFetch.mockResolvedValue({
      ...makeStreamResponse([chunk]),
      body: (async function* () { yield chunk; })(),
    });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/f.txt',
      filename: 'f.txt',
    });
    expect(result.success).toBe(true);
    expect(result.filePath).toContain('Downloads');
  });

  it('trims content-type to strip charset', async () => {
    const chunk = Buffer.from('text data');
    mockFetch.mockResolvedValue({
      ...makeStreamResponse([chunk], { contentType: 'text/plain; charset=utf-8' }),
      body: (async function* () { yield chunk; })(),
    });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/readme.txt',
      filename: 'readme.txt',
    });
    expect(result.mimeType).toBe('text/plain');
  });
});

// ─── mid-stream size exceeded ────────────────────────────────────────────────
describe('DownloadFileTool.execute — mid-stream size exceeded', () => {
  beforeEach(() => {
    const fakeStream = makeFakeWriteStream();
    mockCreateWriteStream.mockReturnValue(fakeStream);
    mockExistsSync.mockImplementation((p: string) => p === path.join(HOME, 'Downloads'));
    mockStatSync.mockReturnValue({ isDirectory: () => true });
    mockUnlinkSync.mockReturnValue(undefined);
  });

  it('deletes partial file and returns error when downloaded bytes exceed maxSizeBytes', async () => {
    const bigChunk = Buffer.alloc(200);
    mockFetch.mockResolvedValue({
      ...makeStreamResponse([]),
      ok: true,
      headers: { get: () => null },
      body: (async function* () { yield bigChunk; })(),
    });

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/huge.bin',
      filename: 'huge.bin',
      maxSizeBytes: 100,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('too large');
    expect(mockUnlinkSync).toHaveBeenCalled();
  });
});

// ─── AbortError / timeout ────────────────────────────────────────────────────
describe('DownloadFileTool.execute — AbortError paths', () => {
  beforeEach(() => {
    mockExistsSync.mockImplementation((p: string) => p === path.join(HOME, 'Downloads'));
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('returns "Download timed out" when AbortError with no external signal', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abortErr);

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/f.txt',
      filename: 'f.txt',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Download timed out');
  });

  it('returns "Download cancelled by user" when AbortError with aborted external signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abortErr);

    const result = await DownloadFileTool.execute(
      { url: 'https://example.com/f.txt', filename: 'f.txt' },
      { signal: controller.signal },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('Download cancelled by user');
  });
});

// ─── generic error passthrough ────────────────────────────────────────────────
describe('DownloadFileTool.execute — generic error passthrough', () => {
  beforeEach(() => {
    mockExistsSync.mockImplementation((p: string) => p === path.join(HOME, 'Downloads'));
    mockStatSync.mockReturnValue({ isDirectory: () => true });
  });

  it('returns error message from non-AbortError exceptions', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/f.txt',
      filename: 'f.txt',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('connection refused');
  });

  it('converts non-Error throws to string', async () => {
    mockFetch.mockRejectedValue('raw string error');

    const result = await DownloadFileTool.execute({
      url: 'https://example.com/f.txt',
      filename: 'f.txt',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('raw string error');
  });
});
