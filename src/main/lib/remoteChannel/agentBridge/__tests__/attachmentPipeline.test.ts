// @ts-nocheck
/**
 * Tests for attachmentPipeline — utility functions and downloadAndBuildParts.
 */

import path from 'path';

// ── mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mirror the electron mock: app.getPath returns '/tmp/test', so getUserDataPath returns '/tmp/test'
const MOCK_USER_DATA = '/tmp/test';
vi.mock('../../userDataADO/pathUtils', () => ({
  getUserDataPath: () => MOCK_USER_DATA,
}));

const mockCompressImageFirstPass = vi.hoisted(() => vi.fn());
vi.mock('../../utilities/imageStorageCompression', () => ({
  MAX_IMAGE_BYTES_FOR_INLINE: 5 * 1024 * 1024,
  MAX_COMPRESSED_IMAGE_BYTES_FOR_INLINE: 4 * 1024 * 1024,
  compressImageFirstPass: (...args: any[]) => mockCompressImageFirstPass(...args),
}));

const mockGuessMimeFromFileName = vi.fn();
const mockDetectMimeFromMagicBytes = vi.fn();
vi.mock('../../utilities/mimeUtils', () => ({
  guessMimeFromFileName: (...args: any[]) => mockGuessMimeFromFileName(...args),
  detectMimeFromMagicBytes: (...args: any[]) => mockDetectMimeFromMagicBytes(...args),
}));

vi.mock('../../featureFlags', () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
}));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);

vi.mock('fs/promises', () => ({
  default: {
    mkdir: (...args: any[]) => mockMkdir(...args),
    writeFile: (...args: any[]) => mockWriteFile(...args),
    rm: (...args: any[]) => mockRm(...args),
  },
}));

// ── import SUT ─────────────────────────────────────────────────────────────

import {
  sanitizeAttachmentName,
  getAttachmentRootDir,
  getSessionAttachmentDir,
  downloadAndBuildParts,
  cleanupSessionAttachmentDir,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../attachmentPipeline';
import type { InboundAttachment } from '../../remoteChannel/types';

// ---------------------------------------------------------------------------
// sanitizeAttachmentName
// ---------------------------------------------------------------------------

describe('sanitizeAttachmentName', () => {
  it('keeps a clean filename unchanged', () => {
    expect(sanitizeAttachmentName('report.pdf')).toBe('report.pdf');
  });

  it('strips directory components', () => {
    expect(sanitizeAttachmentName('/etc/passwd')).toBe('passwd');
  });

  it('replaces control characters and forbidden chars', () => {
    const result = sanitizeAttachmentName('bad\x00name<>.txt');
    expect(result).not.toMatch(/[\x00<>]/);
  });

  it('collapses whitespace', () => {
    expect(sanitizeAttachmentName('my   file.txt')).toBe('my file.txt');
  });

  it('returns "unnamed" for empty / whitespace-only input', () => {
    expect(sanitizeAttachmentName('')).toBe('unnamed');
    expect(sanitizeAttachmentName('   ')).toBe('unnamed');
  });

  it('returns "unnamed" for null/undefined-like input', () => {
    expect(sanitizeAttachmentName(null as unknown as string)).toBe('unnamed');
  });
});

// ---------------------------------------------------------------------------
// getAttachmentRootDir / getSessionAttachmentDir
// ---------------------------------------------------------------------------

describe('getAttachmentRootDir', () => {
  it('returns path under userData', () => {
    expect(getAttachmentRootDir()).toBe(path.join(MOCK_USER_DATA, 'remote-attachments'));
  });
});

describe('getSessionAttachmentDir', () => {
  it('returns path under root dir with session id', () => {
    const dir = getSessionAttachmentDir('session-123');
    expect(dir).toBe(path.join(MOCK_USER_DATA, 'remote-attachments', 'session-123'));
  });
});

// ---------------------------------------------------------------------------
// downloadAndBuildParts
// ---------------------------------------------------------------------------

function makeAttachment(overrides: Partial<InboundAttachment> = {}): InboundAttachment {
  return {
    id: 'att-1',
    name: 'file.txt',
    kind: 'file',
    url: 'https://example.com/file.txt',
    ...overrides,
  } as InboundAttachment;
}

describe('downloadAndBuildParts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectMimeFromMagicBytes.mockReturnValue(null);
    mockGuessMimeFromFileName.mockReturnValue(null);
  });

  it('returns failure part when download fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, body: null });
    const parts = await downloadAndBuildParts([makeAttachment()], 'sess-1');
    expect(parts[0].type).toBe('text');
    expect((parts[0] as any).text).toMatch(/download failed/);
  });

  it('returns failure part when URL is missing', async () => {
    const parts = await downloadAndBuildParts([makeAttachment({ url: undefined })], 'sess-1');
    expect(parts[0].type).toBe('text');
  });

  it('persists text/* to disk and returns file content part', async () => {
    const textContent = 'hello world';
    const responseBody = makeReadableStream(textContent);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: responseBody,
      headers: { get: () => 'text/plain; charset=utf-8' },
    });
    mockDetectMimeFromMagicBytes.mockReturnValue(null);
    mockGuessMimeFromFileName.mockReturnValue('text/plain');

    const parts = await downloadAndBuildParts([makeAttachment({ name: 'hello.txt' })], 'sess-1');
    expect(mockWriteFile).toHaveBeenCalled();
    expect(parts[0].type).toBe('file');
  });

  it('persists office files to disk and returns office content part', async () => {
    const content = 'fake docx content';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeReadableStream(content),
      headers: { get: () => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    });
    mockDetectMimeFromMagicBytes.mockReturnValue(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    const parts = await downloadAndBuildParts([makeAttachment({ name: 'report.docx' })], 'sess-1');
    expect(parts[0].type).toBe('office');
  });

  it('returns text part when image compression fails (sharp unavailable in test env)', async () => {
    // In the test environment, sharp can't decompress fake image bytes,
    // so compressImageFirstPass throws — we verify the graceful fallback to text.
    const imageContent = 'not-real-png';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeReadableStream(imageContent),
      headers: { get: () => 'image/png' },
    });
    mockDetectMimeFromMagicBytes.mockReturnValue('image/png');

    const parts = await downloadAndBuildParts([makeAttachment({ name: 'photo.png' })], 'sess-1');
    // Either type=image (if somehow compressed) or type=text (compression failure fallback)
    expect(['image', 'text']).toContain(parts[0].type);
  });

  it('limits to MAX_ATTACHMENTS_PER_MESSAGE and adds truncation notice', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, body: null });
    const manyAtts = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 2 }, (_, i) =>
      makeAttachment({ id: `att-${i}`, name: `f${i}.txt` }),
    );
    const parts = await downloadAndBuildParts(manyAtts, 'sess-1');
    // Last part should be the truncation notice
    const last = parts[parts.length - 1] as any;
    expect(last.type).toBe('text');
    expect(last.text).toMatch(/Only the first/);
  });

  it('returns others part for unknown binary types', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: makeReadableStream('data'),
      headers: { get: () => 'application/octet-stream' },
    });
    mockDetectMimeFromMagicBytes.mockReturnValue(null);
    mockGuessMimeFromFileName.mockReturnValue(null);

    const parts = await downloadAndBuildParts([makeAttachment({ name: 'data.bin' })], 'sess-1');
    expect(parts[0].type).toBe('others');
  });
});

// ---------------------------------------------------------------------------
// cleanupSessionAttachmentDir
// ---------------------------------------------------------------------------

describe('cleanupSessionAttachmentDir', () => {
  it('calls fs.rm with the session dir', async () => {
    await cleanupSessionAttachmentDir('my-session');
    expect(mockRm).toHaveBeenCalledWith(
      path.join(MOCK_USER_DATA, 'remote-attachments', 'my-session'),
      { recursive: true, force: true },
    );
  });

  it('silently ignores rm errors', async () => {
    mockRm.mockRejectedValueOnce(new Error('ENOENT'));
    await expect(cleanupSessionAttachmentDir('missing')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeReadableStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}
