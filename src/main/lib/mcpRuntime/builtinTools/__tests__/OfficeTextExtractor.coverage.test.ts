/**
 * OfficeTextExtractor coverage tests
 * Covers: all extraction paths, magic byte validation, native fallback, error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockMammothExtract,
  mockJsZipLoadAsync,
  mockFsWriteFileSync,
  mockFsExistsSync,
  mockFsUnlinkSync,
  mockOsTmpdir,
  mockNativeIsPlatformSupported,
  mockNativeGetRequiredApp,
  mockNativeCheckOfficeInstalled,
  mockNativeExtractFromBuffer,
  mockExtractSlideTextFromXml,
  mockParseExcelSharedStrings,
  mockParseExcelWorksheetRows,
  mockResolveExcelSheetEntries,
  mockPdfReaderParseBuffer,
} = vi.hoisted(() => {
  const mockPdfReaderParseBuffer = vi.fn();
  return {
    mockMammothExtract: vi.fn(),
    mockJsZipLoadAsync: vi.fn(),
    mockFsWriteFileSync: vi.fn(),
    mockFsExistsSync: vi.fn().mockReturnValue(true),
    mockFsUnlinkSync: vi.fn(),
    mockOsTmpdir: vi.fn().mockReturnValue('/tmp'),
    mockNativeIsPlatformSupported: vi.fn().mockReturnValue(true),
    mockNativeGetRequiredApp: vi.fn().mockReturnValue('word'),
    mockNativeCheckOfficeInstalled: vi.fn().mockResolvedValue({ word: true, powerpoint: true, excel: true, platform: 'darwin' }),
    mockNativeExtractFromBuffer: vi.fn(),
    mockExtractSlideTextFromXml: vi.fn().mockReturnValue(['Slide line 1', 'Slide line 2']),
    mockParseExcelSharedStrings: vi.fn().mockResolvedValue([]),
    mockParseExcelWorksheetRows: vi.fn().mockReturnValue(['row1\tcol1', 'row2\tcol2']),
    mockResolveExcelSheetEntries: vi.fn().mockResolvedValue([]),
    mockPdfReaderParseBuffer,
  };
});

vi.mock('mammoth', () => ({
  default: { extractRawText: mockMammothExtract },
}));

vi.mock('jszip', () => ({
  default: { loadAsync: mockJsZipLoadAsync },
}));

vi.mock('node:fs', () => ({
  writeFileSync: mockFsWriteFileSync,
  existsSync: mockFsExistsSync,
  unlinkSync: mockFsUnlinkSync,
}));

vi.mock('node:os', () => ({
  tmpdir: mockOsTmpdir,
}));

vi.mock('pdfreader', () => ({
  PdfReader: class {
    parseBuffer(buf: Buffer, cb: (err: any, item: any) => void) {
      mockPdfReaderParseBuffer(buf, cb);
    }
  },
}));

vi.mock('../NativeOfficeExtractor', () => ({
  NativeOfficeExtractor: {
    isPlatformSupported: mockNativeIsPlatformSupported,
    getRequiredApp: mockNativeGetRequiredApp,
    checkOfficeInstalled: mockNativeCheckOfficeInstalled,
    extractFromBuffer: mockNativeExtractFromBuffer,
  },
}));

vi.mock('../OfficeXmlParsers', () => ({
  extractSlideTextFromXml: mockExtractSlideTextFromXml,
  parseExcelSharedStrings: mockParseExcelSharedStrings,
  parseExcelWorksheetRows: mockParseExcelWorksheetRows,
  resolveExcelSheetEntries: mockResolveExcelSheetEntries,
}));

vi.mock('../../unifiedLogger', () => ({
  getGlobalLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { OfficeTextExtractor } from '../OfficeTextExtractor';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Make a valid ZIP-signature buffer (PK\x03\x04) */
function makeZipBuffer(extra = 0): Buffer {
  const buf = Buffer.alloc(8 + extra, 0);
  buf[0] = 0x50; buf[1] = 0x4B; buf[2] = 0x03; buf[3] = 0x04;
  return buf;
}

/** Make a valid PDF-signature buffer (%PDF) */
function makePdfBuffer(): Buffer {
  const buf = Buffer.alloc(8, 0);
  buf[0] = 0x25; buf[1] = 0x50; buf[2] = 0x44; buf[3] = 0x46;
  return buf;
}

/** Make a CDFV2/OLE2 buffer (D0 CF 11 E0) */
function makeCdfv2Buffer(withEncryptionMarker = false): Buffer {
  const marker = withEncryptionMarker ? Buffer.from('EncryptedPackage') : Buffer.alloc(0);
  const buf = Buffer.alloc(64 + marker.length, 0);
  buf[0] = 0xD0; buf[1] = 0xCF; buf[2] = 0x11; buf[3] = 0xE0;
  if (withEncryptionMarker) {
    marker.copy(buf, 64);
  }
  return buf;
}

/** Make a mock JSZip object */
function makeZip(files: Record<string, string>): any {
  const zipFiles: Record<string, any> = {};
  for (const [name, content] of Object.entries(files)) {
    zipFiles[name] = {
      async: vi.fn().mockResolvedValue(content),
    };
  }
  return { files: zipFiles };
}

// ── isSupported ───────────────────────────────────────────────────────────────

describe('OfficeTextExtractor.isSupported', () => {
  it('returns true for supported extensions', () => {
    for (const ext of ['.docx', '.pdf', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm']) {
      expect(OfficeTextExtractor.isSupported(`file${ext}`)).toBe(true);
    }
  });

  it('returns false for unsupported extensions', () => {
    expect(OfficeTextExtractor.isSupported('file.mp4')).toBe(false);
    expect(OfficeTextExtractor.isSupported('file.exe')).toBe(false);
    expect(OfficeTextExtractor.isSupported('noext')).toBe(false);
  });
});

// ── unsupported extension ─────────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – unsupported extension', () => {
  it('throws for unsupported file types', async () => {
    const buf = Buffer.from('data');
    await expect(OfficeTextExtractor.extract(buf, 'file.mp4')).rejects.toThrow('Unsupported file type');
  });
});

// ── buffer too small ──────────────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – small buffer', () => {
  it('throws for buffer smaller than 4 bytes', async () => {
    const buf = Buffer.from([0x01, 0x02]);
    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow('Buffer too small');
  });
});

// ── HTML detection ────────────────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – HTML error page detection', () => {
  it('throws with HTML error when buffer starts with <!doctype', async () => {
    const html = '<!doctype html><html><body>Sign In</body></html>';
    const buf = Buffer.from(html);
    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow('HTML page');
  });

  it('throws with HTML error when buffer starts with <html', async () => {
    const html = '<html><body>Error Page</body></html>';
    const buf = Buffer.from(html);
    await expect(OfficeTextExtractor.extract(buf, 'file.pptx')).rejects.toThrow('HTML page');
  });
});

// ── CDFV2 / native extraction ─────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – CDFV2 triggers native extraction', () => {
  afterEach(() => vi.clearAllMocks());

  it('attempts native extraction for encrypted .docx (CDFV2 + encryption marker)', async () => {
    const buf = makeCdfv2Buffer(true);
    mockNativeExtractFromBuffer.mockResolvedValueOnce({
      content: 'Decrypted content',
      fileType: 'docx',
      extractionMethod: 'native-applescript-word',
      totalLines: 1,
      totalPages: 1,
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.docx');
    expect(result.content).toBe('Decrypted content');
    expect(mockNativeExtractFromBuffer).toHaveBeenCalledWith(buf, 'file.docx');
  });

  it('attempts native extraction for CDFV2 .pptx', async () => {
    const buf = makeCdfv2Buffer(false);
    mockNativeGetRequiredApp.mockReturnValueOnce('powerpoint');
    mockNativeCheckOfficeInstalled.mockResolvedValueOnce({
      word: true, powerpoint: true, excel: true, platform: 'darwin',
    });
    mockNativeExtractFromBuffer.mockResolvedValueOnce({
      content: 'PPT content',
      fileType: 'pptx',
      extractionMethod: 'native-applescript-powerpoint',
      totalLines: 5,
      totalPages: 3,
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.content).toBe('PPT content');
  });

  it('throws when native extraction is unavailable on unsupported platform', async () => {
    const buf = makeCdfv2Buffer(true);
    mockNativeIsPlatformSupported.mockReturnValueOnce(false);

    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow(
      'Native Office extraction is not supported',
    );
  });

  it('throws when required app is not available', async () => {
    const buf = makeCdfv2Buffer(true);
    mockNativeIsPlatformSupported.mockReturnValueOnce(true);
    mockNativeGetRequiredApp.mockReturnValueOnce('word');
    mockNativeCheckOfficeInstalled.mockResolvedValueOnce({
      word: false, powerpoint: false, excel: false, platform: 'darwin',
    });

    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow(
      'Microsoft Word is not installed',
    );
  });

  it('rethrows native extraction error', async () => {
    const buf = makeCdfv2Buffer(true);
    mockNativeExtractFromBuffer.mockRejectedValueOnce(new Error('Timed out'));

    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow('Timed out');
  });

  it('throws for CDFV2 docx when getRequiredApp returns null', async () => {
    const buf = makeCdfv2Buffer(true);
    mockNativeIsPlatformSupported.mockReturnValueOnce(true);
    mockNativeGetRequiredApp.mockReturnValueOnce(null);

    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow(
      'not supported for native Office extraction',
    );
  });
});

// ── wrong magic bytes ─────────────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – wrong magic bytes', () => {
  it('throws for .docx without ZIP signature', async () => {
    const buf = Buffer.alloc(8, 0xAB);
    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow(
      'Expected ZIP-based .docx format',
    );
  });

  it('throws for .pptx without ZIP signature', async () => {
    const buf = Buffer.alloc(8, 0xAB);
    await expect(OfficeTextExtractor.extract(buf, 'file.pptx')).rejects.toThrow(
      'Expected ZIP-based .pptx format',
    );
  });

  it('throws for .xlsx without ZIP signature', async () => {
    const buf = Buffer.alloc(8, 0xAB);
    await expect(OfficeTextExtractor.extract(buf, 'file.xlsx')).rejects.toThrow(
      'Expected ZIP-based .xlsx format',
    );
  });
});

// ── plain text extraction ─────────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – plain text files', () => {
  it('extracts .txt content', async () => {
    const buf = Buffer.from('Hello plain text');
    const result = await OfficeTextExtractor.extract(buf, 'file.txt');
    expect(result.content).toBe('Hello plain text');
    expect(result.fileType).toBe('txt');
    expect(result.extractionMethod).toBe('text-decode');
  });

  it('extracts .md content', async () => {
    const buf = Buffer.from('# Heading\n\nContent');
    const result = await OfficeTextExtractor.extract(buf, 'readme.md');
    expect(result.content).toContain('Heading');
    expect(result.fileType).toBe('md');
  });

  it('extracts .csv content', async () => {
    const buf = Buffer.from('col1,col2\nval1,val2');
    const result = await OfficeTextExtractor.extract(buf, 'data.csv');
    expect(result.fileType).toBe('csv');
  });

  it('extracts .json content', async () => {
    const buf = Buffer.from('{"key":"value"}');
    const result = await OfficeTextExtractor.extract(buf, 'data.json');
    expect(result.fileType).toBe('json');
  });

  it('extracts .xml content', async () => {
    const buf = Buffer.from('<root><item>val</item></root>');
    const result = await OfficeTextExtractor.extract(buf, 'data.xml');
    expect(result.fileType).toBe('xml');
  });

  it('extracts .html content', async () => {
    // Note: must start with < and NOT contain doctype/html/sign in/error to avoid detection
    const buf = Buffer.from('<!-- comment --><div>Content</div>');
    const result = await OfficeTextExtractor.extract(buf, 'page.html');
    expect(result.fileType).toBe('html');
  });

  it('extracts .htm content', async () => {
    const buf = Buffer.from('<!-- comment --><div>Content</div>');
    const result = await OfficeTextExtractor.extract(buf, 'page.htm');
    expect(result.fileType).toBe('htm');
  });
});

// ── Word (.docx) extraction ───────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – Word (.docx)', () => {
  afterEach(() => vi.clearAllMocks());

  it('extracts .docx content via mammoth', async () => {
    const buf = makeZipBuffer();
    mockMammothExtract.mockResolvedValueOnce({ value: 'Word document text\r\nSecond line' });

    const result = await OfficeTextExtractor.extract(buf, 'file.docx');
    expect(result.content).toContain('Word document text');
    expect(result.fileType).toBe('docx');
    expect(result.extractionMethod).toBe('mammoth');
    expect(mockFsWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]office-extract-\d+\.docx$/),
      buf,
    );
    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });

  it('handles mammoth returning undefined value gracefully', async () => {
    const buf = makeZipBuffer();
    mockMammothExtract.mockResolvedValueOnce({ value: undefined });

    const result = await OfficeTextExtractor.extract(buf, 'file.docx');
    expect(result.content).toBe('');
  });

  it('cleans up temp file on mammoth failure', async () => {
    const buf = makeZipBuffer();
    mockMammothExtract.mockRejectedValueOnce(new Error('Mammoth failed'));

    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow('Mammoth failed');
    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });

  it('skips cleanup when temp file does not exist', async () => {
    const buf = makeZipBuffer();
    mockMammothExtract.mockRejectedValueOnce(new Error('fail'));
    mockFsExistsSync.mockReturnValueOnce(false);

    await expect(OfficeTextExtractor.extract(buf, 'file.docx')).rejects.toThrow();
    expect(mockFsUnlinkSync).not.toHaveBeenCalled();
  });
});

// ── PowerPoint (.pptx) extraction ─────────────────────────────────────────────

describe('OfficeTextExtractor.extract – PowerPoint (.pptx)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // Reset mock implementations to avoid queue leakage between tests
    mockJsZipLoadAsync.mockReset();
    mockExtractSlideTextFromXml.mockReturnValue(['Slide line 1', 'Slide line 2']);
  });

  it('extracts slides from .pptx via jszip+xml', async () => {
    const buf = makeZipBuffer();
    const zip = makeZip({
      'ppt/slides/slide1.xml': '<xml>slide1</xml>',
      'ppt/slides/slide2.xml': '<xml>slide2</xml>',
    });
    mockJsZipLoadAsync.mockResolvedValueOnce(zip);
    mockExtractSlideTextFromXml.mockReturnValue(['Text from slide']);

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.extractionMethod).toBe('jszip+xml');
    expect(result.fileType).toBe('pptx');
    expect(result.content).toContain('--- Slide 1 ---');
  });

  it('returns empty content when no slides found', async () => {
    const buf = makeZipBuffer();
    mockJsZipLoadAsync.mockResolvedValueOnce({ files: {} });

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
  });

  it('falls back to numeric sort when presentation.xml is missing', async () => {
    const buf = makeZipBuffer();
    const zip = makeZip({
      'ppt/slides/slide3.xml': '<xml>slide3</xml>',
      'ppt/slides/slide1.xml': '<xml>slide1</xml>',
      'ppt/slides/slide2.xml': '<xml>slide2</xml>',
    });
    mockJsZipLoadAsync.mockResolvedValueOnce(zip);
    mockExtractSlideTextFromXml.mockReturnValue(['Slide text']);

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.totalPages).toBe(3);
  });

  it('uses presentation.xml rels for slide order when available', async () => {
    const buf = makeZipBuffer();
    const presentationXml = `<Presentation><p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/></p:sldIdLst></Presentation>`;
    const relsXml = `<Relationships>
      <Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
      <Relationship Id="rId2" Target="slides/slide2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>
    </Relationships>`;

    const zip = makeZip({
      'ppt/presentation.xml': presentationXml,
      'ppt/_rels/presentation.xml.rels': relsXml,
      'ppt/slides/slide1.xml': '<xml>slide1</xml>',
      'ppt/slides/slide2.xml': '<xml>slide2</xml>',
    });
    mockJsZipLoadAsync.mockResolvedValueOnce(zip);
    mockExtractSlideTextFromXml.mockReturnValue(['Ordered slide text']);

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.totalPages).toBe(2);
  });

  it('attempts native extraction when JSZip throws for CDFV2 .pptx', async () => {
    // CDFV2 buffer triggers native extraction BEFORE JSZip is called — do not mock JSZip
    const buf = makeCdfv2Buffer(false);
    mockNativeGetRequiredApp.mockReturnValueOnce('powerpoint');
    mockNativeCheckOfficeInstalled.mockResolvedValueOnce({
      word: true, powerpoint: true, excel: true, platform: 'darwin',
    });
    mockNativeExtractFromBuffer.mockResolvedValueOnce({
      content: 'Native PPT',
      fileType: 'pptx',
      extractionMethod: 'native-applescript-powerpoint',
      totalLines: 3,
      totalPages: 2,
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.content).toBe('Native PPT');
  });

  it('throws JSZip error for non-CDFV2 .pptx when ZIP fails', async () => {
    const buf = makeZipBuffer(); // Valid ZIP sig but JSZip will throw
    mockJsZipLoadAsync.mockRejectedValueOnce(new Error('Corrupted ZIP'));

    await expect(OfficeTextExtractor.extract(buf, 'file.pptx')).rejects.toThrow('JSZip failed');
  });

  it('skips slides with no text', async () => {
    const buf = makeZipBuffer();
    const zip = makeZip({ 'ppt/slides/slide1.xml': '<xml/>' });
    mockJsZipLoadAsync.mockResolvedValueOnce(zip);
    mockExtractSlideTextFromXml.mockReturnValueOnce([]); // no text

    const result = await OfficeTextExtractor.extract(buf, 'file.pptx');
    expect(result.content).toBe('');
  });
});

// ── Excel (.xlsx) extraction ──────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – Excel (.xlsx)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockJsZipLoadAsync.mockReset();
    mockParseExcelSharedStrings.mockResolvedValue([]);
    mockParseExcelWorksheetRows.mockReturnValue(['row1\tcol1', 'row2\tcol2']);
    mockResolveExcelSheetEntries.mockResolvedValue([]);
  });

  it('extracts sheets from .xlsx via jszip+xml', async () => {
    const buf = makeZipBuffer();
    const zip = makeZip({ 'xl/worksheets/sheet1.xml': '<xml/>' });
    mockJsZipLoadAsync.mockResolvedValueOnce(zip);
    mockParseExcelSharedStrings.mockResolvedValueOnce(['shared1', 'shared2']);
    mockResolveExcelSheetEntries.mockResolvedValueOnce([
      { name: 'Sheet1', zipPath: 'xl/worksheets/sheet1.xml' },
    ]);
    mockParseExcelWorksheetRows.mockReturnValueOnce(['row1\tcol1', 'row2\tcol2']);

    const result = await OfficeTextExtractor.extract(buf, 'file.xlsx');
    expect(result.extractionMethod).toBe('jszip+xml');
    expect(result.fileType).toBe('xlsx');
    expect(result.content).toContain('--- Sheet 1: Sheet1 ---');
  });

  it('returns empty content when no sheets found', async () => {
    const buf = makeZipBuffer();
    mockJsZipLoadAsync.mockResolvedValueOnce({ files: {} });
    mockParseExcelSharedStrings.mockResolvedValueOnce([]);
    mockResolveExcelSheetEntries.mockResolvedValueOnce([]);

    const result = await OfficeTextExtractor.extract(buf, 'file.xlsx');
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
  });

  it('attempts native extraction when JSZip throws for CDFV2 .xlsx', async () => {
    // CDFV2 buffer short-circuits in validateBufferMagicBytes — JSZip never called
    const buf = makeCdfv2Buffer(false);
    mockNativeGetRequiredApp.mockReturnValueOnce('excel');
    mockNativeCheckOfficeInstalled.mockResolvedValueOnce({
      word: true, powerpoint: true, excel: true, platform: 'darwin',
    });
    mockNativeExtractFromBuffer.mockResolvedValueOnce({
      content: 'Native Excel',
      fileType: 'xlsx',
      extractionMethod: 'native-applescript-excel',
      totalLines: 10,
      totalPages: 2,
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.xlsx');
    expect(result.content).toBe('Native Excel');
  });

  it('throws JSZip error for non-CDFV2 .xlsx when ZIP fails', async () => {
    const buf = makeZipBuffer();
    mockJsZipLoadAsync.mockRejectedValueOnce(new Error('Corrupted'));

    await expect(OfficeTextExtractor.extract(buf, 'file.xlsx')).rejects.toThrow('JSZip failed');
  });

  it('skips sheet file when not found in zip', async () => {
    const buf = makeZipBuffer();
    mockJsZipLoadAsync.mockResolvedValueOnce({ files: {} }); // empty zip files
    mockParseExcelSharedStrings.mockResolvedValueOnce([]);
    mockResolveExcelSheetEntries.mockResolvedValueOnce([
      { name: 'Missing', zipPath: 'xl/worksheets/sheet99.xml' },
    ]);

    const result = await OfficeTextExtractor.extract(buf, 'file.xlsx');
    // When wsFile is not found, the loop continues — content will be empty
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(1); // sheetEntries.length
  });
});

// ── PDF extraction ────────────────────────────────────────────────────────────

describe('OfficeTextExtractor.extract – PDF (.pdf)', () => {
  afterEach(() => vi.clearAllMocks());

  it('extracts text from a PDF with pages', async () => {
    const buf = makePdfBuffer();
    mockPdfReaderParseBuffer.mockImplementationOnce((_buf: Buffer, cb: Function) => {
      cb(null, { page: 1 });
      cb(null, { text: 'Hello', x: 1, y: 1 });
      cb(null, { text: 'World', x: 2, y: 1 });
      cb(null, null); // end
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.pdf');
    expect(result.fileType).toBe('pdf');
    expect(result.extractionMethod).toBe('pdfreader');
    expect(result.content).toContain('Hello');
    expect(result.totalPages).toBe(1);
  });

  it('returns empty content for empty PDF', async () => {
    const buf = makePdfBuffer();
    mockPdfReaderParseBuffer.mockImplementationOnce((_buf: Buffer, cb: Function) => {
      cb(null, null); // immediate end, no pages
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.pdf');
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
  });

  it('rejects when pdfreader emits an error', async () => {
    const buf = makePdfBuffer();
    mockPdfReaderParseBuffer.mockImplementationOnce((_buf: Buffer, cb: Function) => {
      cb(new Error('PDF parse error'), null);
    });

    await expect(OfficeTextExtractor.extract(buf, 'file.pdf')).rejects.toThrow('PDF parse error');
  });

  it('handles PDF with non-PDF magic bytes (warning, not error)', async () => {
    // Non-PDF magic but pdfreader may still handle
    const buf = Buffer.alloc(8, 0x00);
    buf[0] = 0x25; // % but not full PDF sig
    mockPdfReaderParseBuffer.mockImplementationOnce((_buf: Buffer, cb: Function) => {
      cb(null, null); // returns empty
    });

    // Should not throw based on magic — pdfreader handles it
    const result = await OfficeTextExtractor.extract(buf, 'file.pdf');
    expect(result.fileType).toBe('pdf');
  });

  it('handles multiple pages separated by blank line', async () => {
    const buf = makePdfBuffer();
    mockPdfReaderParseBuffer.mockImplementationOnce((_buf: Buffer, cb: Function) => {
      cb(null, { page: 1 });
      cb(null, { text: 'Page1', x: 1, y: 1 });
      cb(null, { page: 2 });
      cb(null, { text: 'Page2', x: 1, y: 1 });
      cb(null, null);
    });

    const result = await OfficeTextExtractor.extract(buf, 'file.pdf');
    expect(result.totalPages).toBe(2);
    expect(result.content).toContain('Page1');
    expect(result.content).toContain('Page2');
  });
});

describe('OfficeTextExtractor reachable branch edges', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockNativeIsPlatformSupported.mockReturnValue(true);
    mockNativeGetRequiredApp.mockReturnValue('word');
    mockNativeCheckOfficeInstalled.mockResolvedValue({
      word: true, powerpoint: true, excel: true, platform: 'darwin',
    });
    mockExtractSlideTextFromXml.mockReturnValue(['Slide line']);
  });

  it('builds fallback native-extraction errors when no detector message exists', async () => {
    mockNativeIsPlatformSupported.mockReturnValueOnce(false);
    await expect(
      (OfficeTextExtractor as any).attemptNativeExtraction(Buffer.from('data'), 'secret.docx', null),
    ).rejects.toThrow('Cannot extract encrypted file "secret.docx".');

    mockNativeGetRequiredApp.mockReturnValueOnce(null);
    await expect(
      (OfficeTextExtractor as any).attemptNativeExtraction(Buffer.from('data'), 'secret.bin', null),
    ).rejects.toThrow('File type is not supported');
  });

  it('rethrows a non-Error native extraction rejection unchanged', async () => {
    mockNativeExtractFromBuffer.mockRejectedValueOnce('native failure');
    await expect(
      (OfficeTextExtractor as any).attemptNativeExtraction(Buffer.from('data'), 'secret.docx', null),
    ).rejects.toBe('native failure');
  });

  it('detects encryption markers when the Word extractor is called directly', async () => {
    mockNativeExtractFromBuffer.mockResolvedValueOnce({
      content: 'decrypted',
      fileType: 'docx',
      extractionMethod: 'native-applescript-word',
      totalLines: 1,
    });

    const encrypted = await (OfficeTextExtractor as any).extractWord(
      makeCdfv2Buffer(true),
      'secret.docx',
    );
    expect(encrypted.content).toBe('decrypted');

    mockMammothExtract.mockResolvedValueOnce({ value: 'legacy content' });
    const legacy = await (OfficeTextExtractor as any).extractWord(
      makeCdfv2Buffer(false),
      'legacy.docx',
    );
    expect(legacy.content).toBe('legacy content');
  });

  it('uses default PDF coordinates for text items without positions', async () => {
    mockPdfReaderParseBuffer.mockImplementationOnce((_buf: Buffer, cb: Function) => {
      cb(null, { page: 1 });
      cb(null, { metadata: 'ignored' });
      cb(null, { text: 'No coordinates' });
      cb(null, null);
    });

    const result = await OfficeTextExtractor.extract(makePdfBuffer(), 'file.pdf');
    expect(result.content).toBe('No coordinates');
  });

  it('ignores malformed slide relationships and falls back to numeric order', async () => {
    const zip = makeZip({
      'ppt/presentation.xml': '<p:sldId r:id="missing"/><p:sldId r:id="valid"/>',
      'ppt/_rels/presentation.xml.rels': [
        '<Relationships>',
        '<Relationship Target="slides/slide1.xml"/>',
        '<Relationship Id="noTarget"/>',
        '<Relationship Id="notSlide" Target="notes.xml" Type="notes"/>',
        '<Relationship Id="valid" Target="ppt/slides/absent.xml" Type="slide"/>',
        '</Relationships>',
      ].join(''),
      'ppt/slides/slide1.xml': '<slide/>',
    });
    mockJsZipLoadAsync.mockResolvedValueOnce(zip);

    const result = await OfficeTextExtractor.extract(makeZipBuffer(), 'file.pptx');

    expect(result.totalPages).toBe(1);
    expect(result.content).toContain('Slide line');
  });

  it.each([
    ['extractPowerPoint', 'short.pptx'],
    ['extractExcel', 'short.xlsx'],
  ])('reports N/A magic for a short invalid archive in %s', async (method, fileName) => {
    mockJsZipLoadAsync.mockRejectedValueOnce(new Error('invalid archive'));

    await expect(
      (OfficeTextExtractor as any)[method](Buffer.from([0x50, 0x4b, 0x03]), fileName),
    ).rejects.toThrow('magic: N/A');
  });
});
