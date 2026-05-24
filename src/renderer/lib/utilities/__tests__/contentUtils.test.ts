/**
 * @vitest-environment happy-dom
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock imageCompression module
vi.mock('../imageCompression', () => ({
  getImageDimensions: vi.fn(),
  smartCompressImage: vi.fn(),
  shouldCompressImageAdvanced: vi.fn(),
}));

// Mock logger module
vi.mock('../logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
}));

import {
  ContentPartFactory,
  FileProcessor,
  ContentConverter,
  ContentAnalyzer,
  generateId,
  formatFileSize,
  formatLineCount,
  getFileIconClass,
} from '../contentUtils';

import {
  getImageDimensions,
  smartCompressImage,
  shouldCompressImageAdvanced,
} from '../imageCompression';

describe('ContentPartFactory', () => {
  describe('createText', () => {
    it('creates text part with trimmed text', () => {
      const part = ContentPartFactory.createText('  hello  ');
      expect(part.type).toBe('text');
      expect(part.text).toBe('hello');
    });
  });

  describe('createImage', () => {
    it('creates image part with metadata', () => {
      const part = ContentPartFactory.createImage({
        url: 'data:image/png;base64,...',
        fileName: 'test.png',
        fileSize: 1000,
        width: 100,
        height: 200,
        mimeType: 'image/png',
      });
      expect(part.type).toBe('image');
      expect(part.image_url.url).toBe('data:image/png;base64,...');
      expect(part.image_url.detail).toBe('auto');
      expect(part.metadata.fileName).toBe('test.png');
    });

    it('uses provided detail value', () => {
      const part = ContentPartFactory.createImage({
        url: 'x', fileName: 'x', fileSize: 0, mimeType: 'image/png', detail: 'high',
      });
      expect(part.image_url.detail).toBe('high');
    });
  });

  describe('createFile', () => {
    it('creates file part with defaults', () => {
      const part = ContentPartFactory.createFile({
        fileName: 'test.ts',
        filePath: '/path/test.ts',
        fileSize: 500,
        mimeType: 'text/typescript',
      });
      expect(part.type).toBe('file');
      expect(part.file.fileName).toBe('test.ts');
      expect(part.metadata.encoding).toBe('utf-8');
      expect(part.metadata.detail).toBe('auto');
    });
  });

  describe('createOffice', () => {
    it('creates office part', () => {
      const part = ContentPartFactory.createOffice({
        fileName: 'doc.docx',
        filePath: '/doc.docx',
        fileSize: 2000,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        extension: 'docx',
      });
      expect(part.type).toBe('office');
      expect(part.metadata.truncated).toBe(false);
    });
  });

  describe('createOthers', () => {
    it('creates others part with defaults', () => {
      const part = ContentPartFactory.createOthers({
        fileName: 'data.bin',
        fileSize: 300,
        mimeType: 'application/octet-stream',
      });
      expect(part.type).toBe('others');
      expect(part.file.filePath).toBe('');
      expect(part.metadata.description).toContain('data.bin');
    });

    it('uses provided filePath', () => {
      const part = ContentPartFactory.createOthers({
        fileName: 'data.bin',
        filePath: '/full/path/data.bin',
        fileSize: 300,
        mimeType: 'application/octet-stream',
      });
      expect(part.file.filePath).toBe('/full/path/data.bin');
    });
  });
});

describe('FileProcessor', () => {
  describe('isImageFile', () => {
    it('returns true for supported image types', () => {
      expect(FileProcessor.isImageFile({ type: 'image/png' } as File)).toBe(true);
      expect(FileProcessor.isImageFile({ type: 'image/jpeg' } as File)).toBe(true);
    });

    it('returns false for non-image', () => {
      expect(FileProcessor.isImageFile({ type: 'text/plain' } as File)).toBe(false);
    });
  });

  describe('isOfficeFile', () => {
    it('returns true for PDF mime', () => {
      expect(FileProcessor.isOfficeFile({ type: 'application/pdf', name: 'doc.pdf' } as File)).toBe(true);
    });

    it('returns true for docx extension', () => {
      expect(FileProcessor.isOfficeFile({ type: '', name: 'file.docx' } as File)).toBe(true);
    });

    it('returns false for text files', () => {
      expect(FileProcessor.isOfficeFile({ type: 'text/plain', name: 'file.txt' } as File)).toBe(false);
    });
  });

  describe('isTextFile', () => {
    it('returns false for office files', () => {
      expect(FileProcessor.isTextFile({ type: 'application/pdf', name: 'doc.pdf' } as File)).toBe(false);
    });

    it('returns true for text mime type', () => {
      expect(FileProcessor.isTextFile({ type: 'text/plain', name: 'file.txt' } as File)).toBe(true);
    });

    it('returns true for known text extension', () => {
      expect(FileProcessor.isTextFile({ type: '', name: 'file.ts' } as File)).toBe(true);
    });
  });

  describe('isOthersFile', () => {
    it('returns true when not image, text, or office', () => {
      expect(FileProcessor.isOthersFile({ type: 'application/octet-stream', name: 'data.bin' } as File)).toBe(true);
    });
  });

  describe('isFileSizeValid', () => {
    it('returns true for files within limit', () => {
      expect(FileProcessor.isFileSizeValid({ size: 100 } as File)).toBe(true);
    });
  });

  describe('getMimeType', () => {
    it('returns file.type if available', () => {
      expect(FileProcessor.getMimeType({ type: 'text/plain', name: 'x' } as File)).toBe('text/plain');
    });

    it('infers from extension when type is empty', () => {
      expect(FileProcessor.getMimeType({ type: '', name: 'file.ts' } as File)).toBe('text/typescript');
      expect(FileProcessor.getMimeType({ type: '', name: 'file.py' } as File)).toBe('text/x-python');
    });

    it('defaults to text/plain for unknown', () => {
      expect(FileProcessor.getMimeType({ type: '', name: 'file.xyz123' } as File)).toBe('text/plain');
    });
  });
});

describe('ContentConverter', () => {
  describe('stringToContent', () => {
    it('returns text part for non-empty string', () => {
      const parts = ContentConverter.stringToContent('hello');
      expect(parts).toHaveLength(1);
      expect(parts[0].type).toBe('text');
    });

    it('returns empty array for whitespace-only', () => {
      expect(ContentConverter.stringToContent('   ')).toEqual([]);
    });
  });

  describe('contentToString', () => {
    it('joins text parts', () => {
      const result = ContentConverter.contentToString([
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ] as any);
      expect(result).toBe('hello world');
    });

    it('ignores non-text parts', () => {
      const result = ContentConverter.contentToString([
        { type: 'text', text: 'hi' },
        { type: 'image', image_url: { url: 'x' } },
      ] as any);
      expect(result).toBe('hi');
    });
  });
});

describe('ContentAnalyzer', () => {
  describe('analyzeContent', () => {
    it('counts all content types', () => {
      const content = [
        { type: 'text', text: 'hello world' },
        { type: 'image', metadata: { fileSize: 100 } },
        { type: 'file', metadata: { fileSize: 200 } },
        { type: 'office', metadata: { fileSize: 300 } },
        { type: 'others', metadata: { fileSize: 50 } },
      ] as any;
      const result = ContentAnalyzer.analyzeContent(content);
      expect(result.textLength).toBe(11);
      expect(result.imageCount).toBe(1);
      expect(result.fileCount).toBe(1);
      expect(result.officeCount).toBe(1);
      expect(result.othersCount).toBe(1);
      expect(result.totalSize).toBe(650);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });
  });

  describe('checkLimits', () => {
    it('returns valid for small content', () => {
      const content = [{ type: 'text', text: 'hi' }] as any;
      const result = ContentAnalyzer.checkLimits(content);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error for excessive file size', () => {
      const bigContent = [
        { type: 'image', metadata: { fileSize: 100 * 1024 * 1024 } }, // 100MB
      ] as any;
      const result = ContentAnalyzer.checkLimits(bigContent);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns warning for many images', () => {
      const content = Array(11).fill(null).map(() => ({ type: 'image', metadata: { fileSize: 100 } })) as any;
      const result = ContentAnalyzer.checkLimits(content);
      expect(result.warnings.some(w => w.includes('images'))).toBe(true);
    });

    it('returns warning for high token count', () => {
      // Each image costs 100 tokens; need > 6000 tokens (MAX_TOKEN_BUDGET * 10 = 600 * 10)
      const content = Array(62).fill(null).map(() => ({ type: 'image', metadata: { fileSize: 100 } })) as any;
      const result = ContentAnalyzer.checkLimits(content);
      expect(result.warnings.some((w: string) => w.includes('token'))).toBe(true);
    });

    it('returns warning for many files', () => {
      const content = Array(21).fill(null).map(() => ({ type: 'file', metadata: { fileSize: 100 } })) as any;
      const result = ContentAnalyzer.checkLimits(content);
      expect(result.warnings.some(w => w.includes('files'))).toBe(true);
    });
  });
});

describe('utility exports', () => {
  describe('generateId', () => {
    it('generates id with default prefix', () => {
      expect(generateId()).toMatch(/^content_\d+_/);
    });

    it('generates id with custom prefix', () => {
      expect(generateId('img')).toMatch(/^img_\d+_/);
    });
  });

  describe('formatFileSize', () => {
    it('formats 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('formats KB', () => {
      expect(formatFileSize(1024)).toContain('KB');
    });
  });

  describe('formatLineCount', () => {
    it('returns singular for 1 line', () => {
      expect(formatLineCount(1)).toBe('1 line');
    });

    it('returns plural for multiple lines', () => {
      expect(formatLineCount(100)).toBe('100 lines');
    });

    it('formats large numbers with locale', () => {
      const result = formatLineCount(1000);
      expect(result).toContain('lines');
    });
  });

  describe('getFileIconClass', () => {
    it('returns icon-image for image mimeType', () => {
      expect(getFileIconClass('image/png', 'file.png')).toBe('icon-image');
    });

    it('returns icon-text for text mimeType', () => {
      expect(getFileIconClass('text/plain', 'file.txt')).toBe('icon-text');
    });

    it('returns extension-based icon', () => {
      expect(getFileIconClass('application/octet-stream', 'file.py')).toBe('icon-python');
      expect(getFileIconClass('application/octet-stream', 'file.ts')).toBe('icon-ts');
    });

    it('returns icon-file for unknown', () => {
      expect(getFileIconClass('application/octet-stream', 'file.xyz')).toBe('icon-file');
    });

    it('returns icon-file for filename with no extension', () => {
      // A filename ending with a dot produces an empty string from pop(),
      // which exercises the `ext || ''` branch and the `|| 'icon-file'` fallback.
      expect(getFileIconClass('application/octet-stream', 'filewithoutextension.')).toBe('icon-file');
    });
  });
});

// ===== ContentConverter async methods =====

// Helper: create a mock File with optional extra properties
function makeFile(
  name: string,
  type: string,
  size: number,
  extras: Record<string, unknown> = {}
): File {
  const file = new File(['x'.repeat(Math.max(size, 1))], name, { type });
  return Object.assign(file, extras);
}

// Helper: mock FileReader so fileToDataURL resolves with a fixed data URL
function mockFileReader(result: string | null = 'data:image/png;base64,abc', error = false) {
  class MockFileReader {
    result: string | null = result;
    onload: ((e: any) => void) | null = null;
    onerror: ((e: any) => void) | null = null;

    readAsDataURL() {
      if (error) {
        setTimeout(() => this.onerror?.(new Error('read error')));
      } else {
        setTimeout(() => this.onload?.({ target: { result: this.result } }));
      }
    }

    readAsText() {
      if (error) {
        setTimeout(() => this.onerror?.(new Error('read error')));
      } else {
        setTimeout(() => this.onload?.({ target: { result: this.result } }));
      }
    }
  }
  (global as any).FileReader = MockFileReader;
  return MockFileReader;
}

describe('FileProcessor async methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fileToDataURL', () => {
    it('resolves with data URL', async () => {
      mockFileReader('data:image/png;base64,abc');
      const file = makeFile('img.png', 'image/png', 100);
      const result = await FileProcessor.fileToDataURL(file);
      expect(result).toBe('data:image/png;base64,abc');
    });

    it('rejects on reader error', async () => {
      mockFileReader(null, true);
      const file = makeFile('img.png', 'image/png', 100);
      await expect(FileProcessor.fileToDataURL(file)).rejects.toBeTruthy();
    });
  });

  describe('fileToText', () => {
    it('resolves with file text', async () => {
      mockFileReader('hello world');
      const file = makeFile('file.txt', 'text/plain', 11);
      const result = await FileProcessor.fileToText(file);
      expect(result).toBe('hello world');
    });

    it('truncates at MAX_TEXT_LINES', async () => {
      // Create content exceeding 2000 lines
      const lines = Array(2100).fill('line').join('\n');
      mockFileReader(lines);
      const file = makeFile('big.txt', 'text/plain', lines.length);
      const result = await FileProcessor.fileToText(file);
      expect(result).toContain('truncated');
      expect(result.split('\n').length).toBeLessThanOrEqual(2003); // 2000 lines + truncation message
    });

    it('rejects on reader error', async () => {
      mockFileReader(null, true);
      const file = makeFile('file.txt', 'text/plain', 5);
      await expect(FileProcessor.fileToText(file)).rejects.toBeTruthy();
    });
  });
});

describe('ContentConverter.fileToImageContent', () => {
  const mockedShouldCompress = shouldCompressImageAdvanced as ReturnType<typeof vi.fn>;
  const mockedSmartCompress = smartCompressImage as ReturnType<typeof vi.fn>;
  const mockedGetDimensions = getImageDimensions as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileReader('data:image/png;base64,abc');
  });

  it('throws for unsupported image type', async () => {
    const file = makeFile('data.bin', 'application/octet-stream', 100);
    await expect(ContentConverter.fileToImageContent(file)).rejects.toThrow('Unsupported image format');
  });

  it('throws when file size exceeds limit', async () => {
    // 6MB — over 5MB limit
    const file = makeFile('big.png', 'image/png', 6 * 1024 * 1024);
    await expect(ContentConverter.fileToImageContent(file)).rejects.toThrow('File size exceeds limit');
  });

  it('returns ImageContentPart without compression when not needed', async () => {
    mockedShouldCompress.mockResolvedValue(false);
    mockedGetDimensions.mockResolvedValue({ width: 800, height: 600 });

    const file = makeFile('photo.png', 'image/png', 100);
    const result = await ContentConverter.fileToImageContent(file);

    expect(result.type).toBe('image');
    expect(result.image_url.url).toBe('data:image/png;base64,abc');
    expect(result.metadata.width).toBe(800);
    expect(result.metadata.height).toBe(600);
    expect(result.image_url.detail).toBe('auto');
  });

  it('compresses when shouldCompressImageAdvanced returns true', async () => {
    const compressedFile = makeFile('photo.png', 'image/png', 50);
    mockedShouldCompress.mockResolvedValue(true);
    mockedSmartCompress.mockResolvedValue({ compressedFile, wasCompressed: true });
    mockedGetDimensions.mockResolvedValue({ width: 400, height: 300 });

    const file = makeFile('photo.png', 'image/png', 100);
    const result = await ContentConverter.fileToImageContent(file);

    expect(mockedSmartCompress).toHaveBeenCalledWith(file);
    expect(result.metadata.fileSize).toBe(compressedFile.size);
  });

  it('falls back to original file when compression throws', async () => {
    mockedShouldCompress.mockRejectedValue(new Error('compression error'));
    mockedGetDimensions.mockResolvedValue({ width: 800, height: 600 });

    const file = makeFile('photo.png', 'image/png', 100);
    const result = await ContentConverter.fileToImageContent(file);

    // Should still succeed with original file
    expect(result.type).toBe('image');
    expect(result.metadata.fileName).toBe('photo.png');
  });

  it('proceeds without dimensions when getImageDimensions throws', async () => {
    mockedShouldCompress.mockResolvedValue(false);
    mockedGetDimensions.mockRejectedValue(new Error('dim error'));

    const file = makeFile('photo.png', 'image/png', 100);
    const result = await ContentConverter.fileToImageContent(file);

    expect(result.metadata.width).toBeUndefined();
    expect(result.metadata.height).toBeUndefined();
  });
});

describe('ContentConverter.fileToFileContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for non-text files', async () => {
    const file = makeFile('data.bin', 'application/octet-stream', 100);
    await expect(ContentConverter.fileToFileContent(file)).rejects.toThrow('Unsupported file format');
  });

  it('uses filename as filePath when no full path available', async () => {
    const file = makeFile('readme.txt', 'text/plain', 10);
    const result = await ContentConverter.fileToFileContent(file);

    expect(result.type).toBe('file');
    expect(result.file.filePath).toBe('readme.txt');
    expect(result.file.fileName).toBe('readme.txt');
  });

  it('uses fullPath from Electron API when available', async () => {
    const file = makeFile('readme.txt', 'text/plain', 10, { fullPath: '/home/user/readme.txt' });
    const result = await ContentConverter.fileToFileContent(file);

    expect(result.file.filePath).toBe('/home/user/readme.txt');
  });

  it('uses webkitRelativePath as second priority', async () => {
    const file = makeFile('readme.txt', 'text/plain', 10, { webkitRelativePath: 'folder/readme.txt' });
    const result = await ContentConverter.fileToFileContent(file);

    expect(result.file.filePath).toBe('folder/readme.txt');
  });

  it('uses path property as third priority', async () => {
    const file = makeFile('readme.txt', 'text/plain', 10, { path: '/absolute/readme.txt' });
    const result = await ContentConverter.fileToFileContent(file);

    expect(result.file.filePath).toBe('/absolute/readme.txt');
  });

  it('ignores path property when it equals file.name', async () => {
    const file = makeFile('readme.txt', 'text/plain', 10, { path: 'readme.txt' });
    const result = await ContentConverter.fileToFileContent(file);

    // Falls back to filename since path === name
    expect(result.file.filePath).toBe('readme.txt');
  });
});

describe('ContentConverter.fileToOthersContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns OthersContentPart with filename as filePath by default', async () => {
    const file = makeFile('archive.zip', 'application/zip', 500);
    const result = await ContentConverter.fileToOthersContent(file);

    expect(result.type).toBe('others');
    expect(result.file.filePath).toBe('archive.zip');
    expect(result.metadata.fileExtension).toBe('zip');
  });

  it('uses fullPath when available', async () => {
    const file = makeFile('archive.zip', 'application/zip', 500, {
      fullPath: '/home/user/archive.zip',
    });
    const result = await ContentConverter.fileToOthersContent(file);

    expect(result.file.filePath).toBe('/home/user/archive.zip');
  });

  it('uses webkitRelativePath as second priority', async () => {
    const file = makeFile('archive.zip', 'application/zip', 500, {
      webkitRelativePath: 'folder/archive.zip',
    });
    const result = await ContentConverter.fileToOthersContent(file);

    expect(result.file.filePath).toBe('folder/archive.zip');
  });

  it('uses path property as third priority', async () => {
    const file = makeFile('archive.zip', 'application/zip', 500, {
      path: '/absolute/archive.zip',
    });
    const result = await ContentConverter.fileToOthersContent(file);

    expect(result.file.filePath).toBe('/absolute/archive.zip');
  });

  it('ignores path when it equals file.name', async () => {
    const file = makeFile('archive.zip', 'application/zip', 500, { path: 'archive.zip' });
    const result = await ContentConverter.fileToOthersContent(file);

    expect(result.file.filePath).toBe('archive.zip');
  });

  it('handles files with no extension', async () => {
    const file = makeFile('Dockerfile', 'text/x-dockerfile', 200);
    const result = await ContentConverter.fileToOthersContent(file);

    // split('.').pop() on a name with no dot returns the entire name as "extension"
    expect(result.metadata.fileExtension).toBe('Dockerfile'.toLowerCase());
  });
});

describe('ContentConverter.fileToOfficeContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for non-office files', async () => {
    const file = makeFile('image.png', 'image/png', 100);
    await expect(ContentConverter.fileToOfficeContent(file)).rejects.toThrow('Unsupported Office file format');
  });

  it('returns OfficeContentPart for a PDF file', async () => {
    const file = makeFile('report.pdf', 'application/pdf', 2000);
    const result = await ContentConverter.fileToOfficeContent(file);

    expect(result.type).toBe('office');
    expect(result.file.fileName).toBe('report.pdf');
    expect(result.file.filePath).toBe('report.pdf'); // filename only by default
    expect(result.file.extension).toBe('pdf');
    expect(result.metadata.truncated).toBe(false);
  });

  it('uses fullPath when available', async () => {
    const file = makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000, {
      fullPath: '/home/user/doc.docx',
    });
    const result = await ContentConverter.fileToOfficeContent(file);

    expect(result.file.filePath).toBe('/home/user/doc.docx');
  });

  it('uses webkitRelativePath as second priority', async () => {
    const file = makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000, {
      webkitRelativePath: 'folder/doc.docx',
    });
    const result = await ContentConverter.fileToOfficeContent(file);

    expect(result.file.filePath).toBe('folder/doc.docx');
  });

  it('uses path property as third priority', async () => {
    const file = makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000, {
      path: '/absolute/doc.docx',
    });
    const result = await ContentConverter.fileToOfficeContent(file);

    expect(result.file.filePath).toBe('/absolute/doc.docx');
  });

  it('ignores path when it equals file.name', async () => {
    const file = makeFile('doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000, {
      path: 'doc.docx',
    });
    const result = await ContentConverter.fileToOfficeContent(file);

    expect(result.file.filePath).toBe('doc.docx');
  });

  it('handles office file detected by extension (empty mime type)', async () => {
    const file = makeFile('slides.pptx', '', 3000);
    const result = await ContentConverter.fileToOfficeContent(file);

    expect(result.type).toBe('office');
    expect(result.file.extension).toBe('pptx');
  });
});
