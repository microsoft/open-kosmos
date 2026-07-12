/**
 * Coverage tests for ReadOfficeFileTool
 * Mocks all external dependencies: fs, pdfreader, mammoth, jszip, OfficeXmlParsers, NativeOfficeExtractor
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock variables ───────────────────────────────────────────────────
const mockReadFile = vi.hoisted(() => vi.fn());
const MockPdfReader = vi.hoisted(() => vi.fn());
const mockMammoth = vi.hoisted(() => ({ extractRawText: vi.fn() }));
const MockJSZip = vi.hoisted(() => vi.fn());
const mockExtractSlideTextFromXml = vi.hoisted(() => vi.fn());
const mockParseExcelSharedStrings = vi.hoisted(() => vi.fn());
const mockParseExcelWorksheetRows = vi.hoisted(() => vi.fn());
const mockResolveExcelSheetEntries = vi.hoisted(() => vi.fn());
const mockNativeOfficeExtractor = vi.hoisted(() => ({
  isPlatformSupported: vi.fn(),
  getRequiredApp: vi.fn(),
  checkOfficeInstalled: vi.fn(),
  extractFromFile: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

vi.mock('pdfreader', () => ({
  PdfReader: MockPdfReader,
}));

vi.mock('mammoth', () => ({
  default: mockMammoth,
}));

vi.mock('jszip', () => ({
  default: MockJSZip,
}));

vi.mock('../OfficeXmlParsers', () => ({
  extractSlideTextFromXml: mockExtractSlideTextFromXml,
  parseExcelSharedStrings: mockParseExcelSharedStrings,
  parseExcelWorksheetRows: mockParseExcelWorksheetRows,
  resolveExcelSheetEntries: mockResolveExcelSheetEntries,
}));

vi.mock('../NativeOfficeExtractor', () => ({
  NativeOfficeExtractor: mockNativeOfficeExtractor,
}));

vi.mock('../../../constants/fileConstants', () => ({
  FILE_ATTACHMENT_LIMITS: {
    MAX_TEXT_LINES: 2000,
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a normal (non-encrypted) buffer */
function normalBuffer(): Buffer {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
}

/** Build a CDFV2/OLE2 magic-bytes buffer */
function encryptedBuffer(): Buffer {
  return Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0x00, 0x00, 0x00, 0x00]);
}

/** Set up MockPdfReader to emit a list of page/text/null events */
function setupPdfReader(
  events: Array<{ type: 'page'; page: number } | { type: 'text'; y: number; x: number; text: string } | { type: 'end' } | { type: 'error'; err: unknown }>
) {
  MockPdfReader.mockImplementation(function (this: any) {
    this.parseBuffer = (_buf: Buffer, cb: (err: unknown, item: unknown) => void) => {
      for (const event of events) {
        if (event.type === 'error') {
          cb(event.err, null);
          return;
        } else if (event.type === 'end') {
          cb(null, null);
          return;
        } else if (event.type === 'page') {
          cb(null, { page: event.page });
        } else {
          cb(null, { text: event.text, y: event.y, x: event.x });
        }
      }
      cb(null, null);
    };
  });
}

/** Build a minimal JSZip-like fake for PowerPoint */
function makePptZip(slideFiles: Record<string, string>) {
  const zipFiles: Record<string, { async: (type: string) => Promise<string> }> = {};
  for (const [name, xml] of Object.entries(slideFiles)) {
    zipFiles[name] = { async: async () => xml };
  }
  MockJSZip.mockImplementation(() => ({}));
  (MockJSZip as any).loadAsync = vi.fn().mockResolvedValue({ files: zipFiles });
}

/** Build a minimal JSZip-like fake for Excel */
function makeExcelZip(sheetFiles: Record<string, string>) {
  const zipFiles: Record<string, { async: (type: string) => Promise<string> }> = {};
  for (const [name, xml] of Object.entries(sheetFiles)) {
    zipFiles[name] = { async: async () => xml };
  }
  (MockJSZip as any).loadAsync = vi.fn().mockResolvedValue({ files: zipFiles });
}

// ─── Import under test (after mocks are hoisted) ─────────────────────────────
const { ReadOfficeFileTool } = await import('../readOfficeFileTool');

// ─────────────────────────────────────────────────────────────────────────────
// getDefinition
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool.getDefinition', () => {
  it('returns name read_office_file', () => {
    expect(ReadOfficeFileTool.getDefinition().name).toBe('read_office_file');
  });
  it('has a description', () => {
    expect(ReadOfficeFileTool.getDefinition().description.length).toBeGreaterThan(10);
  });
  it('requires description and filePath', () => {
    const schema = ReadOfficeFileTool.getDefinition().inputSchema;
    expect(schema.required).toContain('description');
    expect(schema.required).toContain('filePath');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// execute – validation / routing errors
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool.execute – validation errors', () => {
  it('throws when filePath is missing', async () => {
    await expect(ReadOfficeFileTool.execute({ filePath: '' })).rejects.toThrow('No file path provided');
  });

  it('throws for unsupported file type', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.txt' })
    ).rejects.toThrow('Unsupported office file type');
  });

  it('throws for invalid startLine (0)', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', startLine: 0 })
    ).rejects.toThrow('startLine must be a positive integer');
  });

  it('throws for non-integer startLine', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', startLine: 1.5 })
    ).rejects.toThrow('startLine must be a positive integer');
  });

  it('throws for invalid endLine', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', endLine: 0 })
    ).rejects.toThrow('endLine must be a positive integer');
  });

  it('throws when startLine > endLine', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', startLine: 5, endLine: 3 })
    ).rejects.toThrow('startLine cannot be greater than endLine');
  });

  it('throws for invalid lineCount', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', lineCount: 0 })
    ).rejects.toThrow('lineCount must be a positive integer');
  });

  it('throws for invalid startPage', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', startPage: 0 })
    ).rejects.toThrow('startPage must be a positive integer');
  });

  it('throws for invalid endPage', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', endPage: -1 })
    ).rejects.toThrow('endPage must be a positive integer');
  });

  it('throws when startPage > endPage', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', startPage: 3, endPage: 1 })
    ).rejects.toThrow('startPage cannot be greater than endPage');
  });

  it('throws for invalid fileSize', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/file.pdf', fileSize: -1 })
    ).rejects.toThrow('fileSize must be a non-negative integer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveDocumentType via mimeType
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – document type resolution via mimeType', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
  });

  it('resolves pdf from mimeType', async () => {
    setupPdfReader([{ type: 'end' }]);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/pdf',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves word from docx mimeType', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: '' });
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves word from docm mimeType', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: '' });
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.ms-word.document.macroenabled.12',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves ppt from pptx mimeType', async () => {
    makePptZip({});
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves ppt from pptm mimeType', async () => {
    makePptZip({});
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.ms-powerpoint.presentation.macroenabled.12',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves ppt from vnd.ms-powerpoint mimeType', async () => {
    makePptZip({});
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.ms-powerpoint',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves excel from xlsx mimeType', async () => {
    makeExcelZip({});
    mockParseExcelSharedStrings.mockResolvedValue([]);
    mockResolveExcelSheetEntries.mockResolvedValue([]);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves excel from vnd.ms-excel mimeType', async () => {
    makeExcelZip({});
    mockParseExcelSharedStrings.mockResolvedValue([]);
    mockResolveExcelSheetEntries.mockResolvedValue([]);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.ms-excel',
    });
    expect(result.totalPages).toBe(0);
  });

  it('resolves excel from xlsm mimeType', async () => {
    makeExcelZip({});
    mockParseExcelSharedStrings.mockResolvedValue([]);
    mockResolveExcelSheetEntries.mockResolvedValue([]);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file.unknown',
      mimeType: 'application/vnd.ms-excel.sheet.macroenabled.12',
    });
    expect(result.totalPages).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveDocumentType via fileType
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – document type resolution via fileType', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
  });

  const pdfFileTypes = ['pdf', '.pdf'];
  for (const ft of pdfFileTypes) {
    it(`resolves pdf from fileType=${ft}`, async () => {
      setupPdfReader([{ type: 'end' }]);
      const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/file', fileType: ft });
      expect(result.totalPages).toBe(0);
    });
  }

  const wordFileTypes = ['docx', '.docx', 'docm', '.docm'];
  for (const ft of wordFileTypes) {
    it(`resolves word from fileType=${ft}`, async () => {
      mockMammoth.extractRawText.mockResolvedValue({ value: '' });
      const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/file', fileType: ft });
      expect(result.totalPages).toBe(0);
    });
  }

  const pptFileTypes = ['pptx', '.pptx', 'pptm', '.pptm', 'ppt', '.ppt'];
  for (const ft of pptFileTypes) {
    it(`resolves ppt from fileType=${ft}`, async () => {
      makePptZip({});
      const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/file', fileType: ft });
      expect(result.totalPages).toBe(0);
    });
  }

  const excelFileTypes = ['xlsx', '.xlsx', 'xlsm', '.xlsm', 'xls', '.xls'];
  for (const ft of excelFileTypes) {
    it(`resolves excel from fileType=${ft}`, async () => {
      makeExcelZip({});
      mockParseExcelSharedStrings.mockResolvedValue([]);
      mockResolveExcelSheetEntries.mockResolvedValue([]);
      const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/file', fileType: ft });
      expect(result.totalPages).toBe(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveDocumentType via fileName
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – document type resolution via fileName', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
  });

  it('resolves from fileName when path has no extension', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'some content' });
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/file',
      fileName: 'report.docx',
    });
    expect(result.totalPages).toBe(1); // word always returns 1 page
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PDF reading
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – PDF reading', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
  });

  it('returns empty result for empty PDF', async () => {
    setupPdfReader([{ type: 'end' }]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf' });
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('returns text for a single-page PDF', async () => {
    setupPdfReader([
      { type: 'page', page: 1 },
      { type: 'text', y: 1, x: 0, text: 'Hello' },
      { type: 'text', y: 1, x: 1, text: 'World' },
      { type: 'end' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf' });
    expect(result.content).toContain('Hello');
    expect(result.totalPages).toBe(1);
    expect(result.startPage).toBe(1);
    expect(result.endPage).toBe(1);
  });

  it('returns text for a multi-page PDF', async () => {
    setupPdfReader([
      { type: 'page', page: 1 },
      { type: 'text', y: 1, x: 0, text: 'Page1' },
      { type: 'page', page: 2 },
      { type: 'text', y: 1, x: 0, text: 'Page2' },
      { type: 'end' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf' });
    expect(result.totalPages).toBe(2);
    expect(result.content).toContain('Page1');
    expect(result.content).toContain('Page2');
  });

  it('respects page range startPage/endPage', async () => {
    setupPdfReader([
      { type: 'page', page: 1 },
      { type: 'text', y: 1, x: 0, text: 'Page1' },
      { type: 'page', page: 2 },
      { type: 'text', y: 1, x: 0, text: 'Page2' },
      { type: 'page', page: 3 },
      { type: 'text', y: 1, x: 0, text: 'Page3' },
      { type: 'end' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf', startPage: 2, endPage: 2 });
    expect(result.content).toContain('Page2');
    expect(result.content).not.toContain('Page1');
    expect(result.content).not.toContain('Page3');
    expect(result.startPage).toBe(2);
    expect(result.endPage).toBe(2);
  });

  it('respects line range startLine/endLine', async () => {
    setupPdfReader([
      { type: 'page', page: 1 },
      { type: 'text', y: 1, x: 0, text: 'Line1' },
      { type: 'text', y: 2, x: 0, text: 'Line2' },
      { type: 'text', y: 3, x: 0, text: 'Line3' },
      { type: 'end' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf', startLine: 2, endLine: 2 });
    expect(result.content).toContain('Line2');
    expect(result.content).not.toContain('Line1');
    expect(result.content).not.toContain('Line3');
  });

  it('respects lineCount', async () => {
    setupPdfReader([
      { type: 'page', page: 1 },
      { type: 'text', y: 1, x: 0, text: 'L1' },
      { type: 'text', y: 2, x: 0, text: 'L2' },
      { type: 'text', y: 3, x: 0, text: 'L3' },
      { type: 'end' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf', startLine: 1, lineCount: 2 });
    expect(result.endLine).toBe(2);
  });

  it('uses fileName from args when provided', async () => {
    setupPdfReader([{ type: 'end' }]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf', fileName: 'myfile.pdf' });
    expect(result.fileName).toBe('myfile.pdf');
  });

  it('derives fileName from path when not provided', async () => {
    setupPdfReader([{ type: 'end' }]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/report.pdf' });
    expect(result.fileName).toBe('report.pdf');
  });

  it('wraps PDF reader error', async () => {
    setupPdfReader([{ type: 'error', err: new Error('bad pdf') }]);
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf' })
    ).rejects.toThrow('File read failed');
  });

  it('wraps fs.readFile error for PDF', async () => {
    mockReadFile.mockRejectedValue(new Error('no file'));
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf' })
    ).rejects.toThrow('File read failed');
  });

  it('clamps page range beyond totalPages', async () => {
    setupPdfReader([
      { type: 'page', page: 1 },
      { type: 'text', y: 1, x: 0, text: 'OnlyPage' },
      { type: 'end' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.pdf', startPage: 5, endPage: 10 });
    expect(result.startPage).toBe(1);
    expect(result.endPage).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Word reading
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – Word reading', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
  });

  it('returns empty result for empty Word doc', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: '' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
  });

  it('returns text content from Word doc', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'Hello\nWorld\nLine3' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.content).toContain('Hello');
    expect(result.totalLines).toBe(3);
    expect(result.totalPages).toBe(1);
  });

  it('normalizes CRLF line endings', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'A\r\nB\r\nC' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.totalLines).toBe(3);
  });

  it('normalizes CR line endings', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'A\rB\rC' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.totalLines).toBe(3);
  });

  it('applies startLine/endLine slicing', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'L1\nL2\nL3\nL4' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx', startLine: 2, endLine: 3 });
    expect(result.content).toBe('L2\nL3');
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(3);
  });

  it('applies lineCount', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'L1\nL2\nL3\nL4' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx', startLine: 1, lineCount: 2 });
    expect(result.endLine).toBe(2);
    expect(result.content).toBe('L1\nL2');
  });

  it('handles startPage/endPage for Word (ignored, warns)', async () => {
    mockMammoth.extractRawText.mockResolvedValue({ value: 'Text' });
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/doc.docx',
      startPage: 1,
      endPage: 2,
    });
    expect(result.totalPages).toBe(1);
  });

  it('wraps mammoth extraction error', async () => {
    mockMammoth.extractRawText.mockRejectedValue(new Error('mammoth fail'));
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' })
    ).rejects.toThrow('File read failed');
  });

  it('marks truncated true when content exceeds max lines', async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line${i}`).join('\n');
    mockMammoth.extractRawText.mockResolvedValue({ value: lines });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.truncated).toBe(true);
    expect(result.endLine).toBeLessThanOrEqual(2000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PowerPoint reading
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – PowerPoint reading', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
    mockExtractSlideTextFromXml.mockReturnValue(['Slide content line 1', 'Slide content line 2']);
  });

  it('returns empty result for empty PPTX', async () => {
    makePptZip({});
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
  });

  it('reads a single slide', async () => {
    makePptZip({ 'ppt/slides/slide1.xml': '<xml/>' });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    expect(result.content).toContain('Slide content line 1');
    expect(result.totalPages).toBe(1);
  });

  it('reads multiple slides in numeric order (fallback)', async () => {
    makePptZip({
      'ppt/slides/slide1.xml': '<xml/>',
      'ppt/slides/slide2.xml': '<xml/>',
    });
    mockExtractSlideTextFromXml
      .mockReturnValueOnce(['Slide1Line'])
      .mockReturnValueOnce(['Slide2Line']);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    expect(result.totalPages).toBe(2);
    expect(result.content).toContain('Slide1Line');
    expect(result.content).toContain('Slide2Line');
  });

  it('reads slides in presentation order when rels available', async () => {
    const presentationXml = `<root><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></root>`;
    const relsXml = `
      <Relationships>
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
      </Relationships>
    `;
    const zipFiles: Record<string, { async: (t: string) => Promise<string> }> = {
      'ppt/presentation.xml': { async: async () => presentationXml },
      'ppt/_rels/presentation.xml.rels': { async: async () => relsXml },
      'ppt/slides/slide1.xml': { async: async () => '<xml/>' },
      'ppt/slides/slide2.xml': { async: async () => '<xml/>' },
    };
    (MockJSZip as any).loadAsync = vi.fn().mockResolvedValue({ files: zipFiles });

    mockExtractSlideTextFromXml
      .mockReturnValueOnce(['Slide2First'])
      .mockReturnValueOnce(['Slide1Second']);

    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    // rId2->slide2 comes first
    expect(result.content.indexOf('Slide2First')).toBeLessThan(result.content.indexOf('Slide1Second'));
  });

  it('respects page range for PPT', async () => {
    makePptZip({
      'ppt/slides/slide1.xml': '<xml/>',
      'ppt/slides/slide2.xml': '<xml/>',
      'ppt/slides/slide3.xml': '<xml/>',
    });
    mockExtractSlideTextFromXml
      .mockReturnValueOnce(['S1'])
      .mockReturnValueOnce(['S2'])
      .mockReturnValueOnce(['S3']);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/slides.pptx',
      startPage: 2,
      endPage: 2,
    });
    expect(result.content).toContain('S2');
    expect(result.content).not.toContain('S1');
    expect(result.content).not.toContain('S3');
  });

  it('wraps JSZip.loadAsync error', async () => {
    (MockJSZip as any).loadAsync = vi.fn().mockRejectedValue(new Error('zip error'));
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' })
    ).rejects.toThrow('File read failed');
  });

  it('returns empty result when slides have no content and pages array is empty after loop', async () => {
    // slide file exists but slideFile is falsy via missing entry
    const zipFiles: Record<string, any> = {};
    // slide1 is listed in fallback but the file lookup returns undefined
    (MockJSZip as any).loadAsync = vi.fn().mockResolvedValue({
      files: {
        'ppt/slides/slide1.xml': undefined,
      },
    });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    expect(result.content).toBe('');
  });

  it('inserts blank line between slides with content', async () => {
    makePptZip({
      'ppt/slides/slide1.xml': '<xml/>',
      'ppt/slides/slide2.xml': '<xml/>',
    });
    mockExtractSlideTextFromXml
      .mockReturnValueOnce(['S1Line'])
      .mockReturnValueOnce(['S2Line']);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    expect(result.content).toContain('\n\n');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Excel reading
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – Excel reading', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(normalBuffer());
    mockParseExcelSharedStrings.mockResolvedValue([]);
    mockParseExcelWorksheetRows.mockReturnValue(['col1\tcol2', 'val1\tval2']);
  });

  it('returns empty result when no sheets found', async () => {
    makeExcelZip({});
    mockResolveExcelSheetEntries.mockResolvedValue([]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/data.xlsx' });
    expect(result.content).toBe('');
    expect(result.totalPages).toBe(0);
  });

  it('reads a single sheet', async () => {
    makeExcelZip({ 'xl/worksheets/sheet1.xml': '<xml/>' });
    mockResolveExcelSheetEntries.mockResolvedValue([
      { name: 'Sheet1', zipPath: 'xl/worksheets/sheet1.xml' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/data.xlsx' });
    expect(result.content).toContain('Sheet 1: Sheet1');
    expect(result.totalPages).toBe(1);
  });

  it('reads multiple sheets', async () => {
    makeExcelZip({
      'xl/worksheets/sheet1.xml': '<xml/>',
      'xl/worksheets/sheet2.xml': '<xml/>',
    });
    mockResolveExcelSheetEntries.mockResolvedValue([
      { name: 'Alpha', zipPath: 'xl/worksheets/sheet1.xml' },
      { name: 'Beta', zipPath: 'xl/worksheets/sheet2.xml' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/data.xlsx' });
    expect(result.totalPages).toBe(2);
    expect(result.content).toContain('Alpha');
    expect(result.content).toContain('Beta');
  });

  it('respects page range for Excel', async () => {
    makeExcelZip({
      'xl/worksheets/sheet1.xml': '<xml/>',
      'xl/worksheets/sheet2.xml': '<xml/>',
    });
    mockResolveExcelSheetEntries.mockResolvedValue([
      { name: 'Alpha', zipPath: 'xl/worksheets/sheet1.xml' },
      { name: 'Beta', zipPath: 'xl/worksheets/sheet2.xml' },
    ]);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/data.xlsx',
      startPage: 2,
      endPage: 2,
    });
    expect(result.content).toContain('Beta');
    expect(result.content).not.toContain('Alpha');
  });

  it('skips sheets whose zipPath is missing from zip.files', async () => {
    makeExcelZip({});
    mockResolveExcelSheetEntries.mockResolvedValue([
      { name: 'Missing', zipPath: 'xl/worksheets/missing.xml' },
    ]);
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/data.xlsx' });
    // No sheets rendered — pages remains empty and totalPages is 0
    expect(result.totalPages).toBe(0);
  });

  it('wraps JSZip.loadAsync error for Excel', async () => {
    (MockJSZip as any).loadAsync = vi.fn().mockRejectedValue(new Error('zip fail'));
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/data.xlsx' })
    ).rejects.toThrow('File read failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isCdfv2Encrypted + NativeOfficeExtractor
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – encrypted files (CDFV2)', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(encryptedBuffer());
  });

  it('throws on unsupported platform for encrypted Word', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(false);
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' })
    ).rejects.toThrow('File read failed');
  });

  it('throws when getRequiredApp returns null', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue(null);
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' })
    ).rejects.toThrow('File read failed');
  });

  it('throws when required Office app not installed', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('word');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ word: false, excel: false, powerpoint: false });
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' })
    ).rejects.toThrow('File read failed');
  });

  it('uses NativeOfficeExtractor when platform supported and app installed (Word)', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('word');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ word: true });
    mockNativeOfficeExtractor.extractFromFile.mockResolvedValue({
      content: 'Extracted line1\nExtracted line2',
      totalPages: 2,
    });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.content).toContain('Extracted line1');
    expect(result.totalPages).toBe(2);
  });

  it('uses NativeOfficeExtractor for encrypted PPT', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('powerpoint');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ powerpoint: true });
    mockNativeOfficeExtractor.extractFromFile.mockResolvedValue({
      content: 'PPT content',
      totalPages: 1,
    });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/slides.pptx' });
    expect(result.content).toBe('PPT content');
  });

  it('uses NativeOfficeExtractor for encrypted Excel', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('excel');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ excel: true });
    mockNativeOfficeExtractor.extractFromFile.mockResolvedValue({
      content: 'Excel content',
      totalPages: 0, // will default to 1
    });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/data.xlsx' });
    expect(result.totalPages).toBe(1);
  });

  it('applies line truncation for NativeOfficeExtractor results', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('word');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ word: true });
    const lines = Array.from({ length: 3000 }, (_, i) => `line${i}`).join('\n');
    mockNativeOfficeExtractor.extractFromFile.mockResolvedValue({
      content: lines,
      totalPages: 1,
    });
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(result.truncated).toBe(true);
    expect(result.endLine).toBeLessThanOrEqual(2000);
  });

  it('uses unknown app name fallback for unmapped app keys', async () => {
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('visio');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ visio: false });
    await expect(
      ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' })
    ).rejects.toThrow('File read failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isCdfv2Encrypted edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – isCdfv2Encrypted edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats short buffer (<8 bytes) as not encrypted', async () => {
    mockReadFile.mockResolvedValue(Buffer.from([0xD0, 0xCF]));
    mockMammoth.extractRawText.mockResolvedValue({ value: '' });
    // should NOT call NativeOfficeExtractor
    const result = await ReadOfficeFileTool.execute({ filePath: '/tmp/doc.docx' });
    expect(mockNativeOfficeExtractor.isPlatformSupported).not.toHaveBeenCalled();
    expect(result.content).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fileName derivation edge cases
// ─────────────────────────────────────────────────────────────────────────────
describe('ReadOfficeFileTool – fileName derivation', () => {
  it('uses fileName arg over path derivation', async () => {
    mockReadFile.mockResolvedValue(normalBuffer());
    mockMammoth.extractRawText.mockResolvedValue({ value: '' });
    const result = await ReadOfficeFileTool.execute({
      filePath: '/tmp/something.docx',
      fileName: 'custom-name.docx',
    });
    expect(result.fileName).toBe('custom-name.docx');
  });
});

describe('ReadOfficeFileTool reachable branch edges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(normalBuffer());
    mockMammoth.extractRawText.mockResolvedValue({ value: '' });
    mockExtractSlideTextFromXml.mockReturnValue(['slide']);
    mockParseExcelSharedStrings.mockResolvedValue([]);
    mockParseExcelWorksheetRows.mockReturnValue(['row']);
    mockResolveExcelSheetEntries.mockResolvedValue([]);
  });

  it('rejects a non-string file path during argument validation', async () => {
    await expect(
      ReadOfficeFileTool.execute({ filePath: 42 as any, fileType: 'pdf' }),
    ).rejects.toThrow('filePath is required and must be a string');
  });

  it('uses the outer unknown-error fallback for a non-Error reader rejection', async () => {
    const readPdf = vi.spyOn(ReadOfficeFileTool as any, 'readPdfWithPagination')
      .mockRejectedValueOnce('reader stopped');

    await expect(
      ReadOfficeFileTool.execute({ filePath: '/workspace/report.pdf' }),
    ).rejects.toThrow('File read failed: Unknown error');

    readPdf.mockRestore();
  });

  it('accepts a valid file size while reading an empty PDF', async () => {
    setupPdfReader([{ type: 'end' }]);
    const result = await ReadOfficeFileTool.execute({
      filePath: '/workspace/report.pdf',
      fileSize: 0,
    });
    expect(result.totalPages).toBe(0);
  });

  it('falls back to the path extension for an unrecognized fileType hint', async () => {
    mockResolveExcelSheetEntries.mockResolvedValueOnce([]);
    makeExcelZip({});

    const result = await ReadOfficeFileTool.execute({
      filePath: '/workspace/data.xlsx',
      fileType: 'unknown',
    });

    expect(result.totalPages).toBe(0);
  });

  it('uses default coordinates and ignores PDF metadata items', async () => {
    MockPdfReader.mockImplementation(function (this: any) {
      this.parseBuffer = (_buf: Buffer, cb: (err: unknown, item: unknown) => void) => {
        cb(null, { page: 1 });
        cb(null, { metadata: 'ignored' });
        cb(null, { text: 'No coordinates' });
        cb(null, null);
      };
    });

    const result = await ReadOfficeFileTool.execute({ filePath: '/workspace/report.pdf' });
    expect(result.content).toBe('No coordinates');
  });

  it('handles an empty Word extraction with page arguments and undefined text', async () => {
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: undefined });

    const result = await ReadOfficeFileTool.execute({
      filePath: '/workspace/document.docx',
      startPage: 1,
      endPage: 1,
    });

    expect(result).toMatchObject({ content: '', totalPages: 0 });
  });

  it('ignores malformed slide relationships and preserves meaningful blank-slide separators', async () => {
    const files: Record<string, any> = {
      'ppt/presentation.xml': {
        async: async () => '<p:sldId r:id="missing"/><p:sldId r:id="valid"/>',
      },
      'ppt/_rels/presentation.xml.rels': {
        async: async () => [
          '<Relationships>',
          '<Relationship Target="slides/slide1.xml"/>',
          '<Relationship Id="missingTarget"/>',
          '<Relationship Id="notes" Target="notes.xml" Type="notes"/>',
          '<Relationship Id="valid" Target="ppt/slides/absent.xml" Type="slide"/>',
          '</Relationships>',
        ].join(''),
      },
      'ppt/slides/slide1.xml': { async: async () => '<slide/>' },
      'ppt/slides/slide2.xml': { async: async () => '<slide/>' },
      'ppt/slides/slide3.xml': { async: async () => '<slide/>' },
    };
    (MockJSZip as any).loadAsync = vi.fn().mockResolvedValue({ files });
    mockExtractSlideTextFromXml
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['middle'])
      .mockReturnValueOnce([]);

    const result = await ReadOfficeFileTool.execute({
      filePath: '/workspace/slides.pptx',
      endLine: 2,
    });

    expect(result.content).toBe('\nmiddle');
    expect(result.totalPages).toBe(3);
  });

  it('falls back to numeric slide order when relationship XML cannot be read', async () => {
    const files: Record<string, any> = {
      'ppt/presentation.xml': { async: async () => { throw new Error('unreadable'); } },
      'ppt/_rels/presentation.xml.rels': { async: async () => '<Relationships/>' },
      'ppt/slides/slide1.xml': { async: async () => '<slide/>' },
    };
    (MockJSZip as any).loadAsync = vi.fn().mockResolvedValue({ files });

    const result = await ReadOfficeFileTool.execute({ filePath: '/workspace/slides.pptx' });
    expect(result.content).toBe('slide');
  });

  it('applies lineCount when slicing Excel rows', async () => {
    makeExcelZip({ 'xl/worksheets/sheet1.xml': '<sheet/>' });
    mockResolveExcelSheetEntries.mockResolvedValueOnce([
      { name: 'Data', zipPath: 'xl/worksheets/sheet1.xml' },
    ]);

    const result = await ReadOfficeFileTool.execute({
      filePath: '/workspace/data.xlsx',
      startLine: 2,
      lineCount: 1,
    });

    expect(result.content).toBe('row');
    expect(result.endLine).toBe(2);
  });

  it('applies lineCount to native extraction and defaults missing page totals', async () => {
    mockReadFile.mockResolvedValue(encryptedBuffer());
    mockNativeOfficeExtractor.isPlatformSupported.mockReturnValue(true);
    mockNativeOfficeExtractor.getRequiredApp.mockReturnValue('word');
    mockNativeOfficeExtractor.checkOfficeInstalled.mockResolvedValue({ word: true });
    mockNativeOfficeExtractor.extractFromFile.mockResolvedValue({
      content: 'first\nsecond\nthird',
      totalPages: undefined,
    });

    const result = await ReadOfficeFileTool.execute({
      filePath: '/workspace/document.docx',
      startLine: 2,
      lineCount: 1,
    });

    expect(result).toMatchObject({ content: 'second', totalPages: 1, truncated: false });
  });
});
