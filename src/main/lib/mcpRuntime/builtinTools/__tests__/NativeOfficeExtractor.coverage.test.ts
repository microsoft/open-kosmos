/**
 * NativeOfficeExtractor coverage tests
 * Covers: platform checks, app detection, extraction, parsers, error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const { mockExecFileAsync, mockFsExistsSync, mockFsWriteFileSync, mockFsUnlinkSync, mockOsTmpdir } =
  vi.hoisted(() => {
    return {
      mockExecFileAsync: vi.fn(),
      mockFsExistsSync: vi.fn().mockReturnValue(true),
      mockFsWriteFileSync: vi.fn(),
      mockFsUnlinkSync: vi.fn(),
      mockOsTmpdir: vi.fn().mockReturnValue('/tmp'),
    };
  });

vi.mock('node:util', () => ({
  promisify: () => mockExecFileAsync,
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: mockFsExistsSync,
  writeFileSync: mockFsWriteFileSync,
  unlinkSync: mockFsUnlinkSync,
}));

vi.mock('node:os', () => ({
  tmpdir: mockOsTmpdir,
}));

vi.mock('../../unifiedLogger', () => ({
  getGlobalLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// path is NOT mocked — we use the real path module

// ── import after mocks ────────────────────────────────────────────────────────

import { NativeOfficeExtractor } from '../NativeOfficeExtractor';

// ── helpers ───────────────────────────────────────────────────────────────────

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

// ── isPlatformSupported ───────────────────────────────────────────────────────

describe('NativeOfficeExtractor.isPlatformSupported', () => {
  afterEach(() => setPlatform('linux'));

  it('returns true on darwin', () => {
    setPlatform('darwin');
    expect(NativeOfficeExtractor.isPlatformSupported()).toBe(true);
  });

  it('returns true on win32', () => {
    setPlatform('win32');
    expect(NativeOfficeExtractor.isPlatformSupported()).toBe(true);
  });

  it('returns false on linux', () => {
    setPlatform('linux');
    expect(NativeOfficeExtractor.isPlatformSupported()).toBe(false);
  });
});

// ── getRequiredApp ────────────────────────────────────────────────────────────

describe('NativeOfficeExtractor.getRequiredApp', () => {
  it('returns word for .docx', () => expect(NativeOfficeExtractor.getRequiredApp('doc.docx')).toBe('word'));
  it('returns word for .doc', () => expect(NativeOfficeExtractor.getRequiredApp('doc.doc')).toBe('word'));
  it('returns powerpoint for .pptx', () => expect(NativeOfficeExtractor.getRequiredApp('slide.pptx')).toBe('powerpoint'));
  it('returns powerpoint for .ppt', () => expect(NativeOfficeExtractor.getRequiredApp('slide.ppt')).toBe('powerpoint'));
  it('returns excel for .xlsx', () => expect(NativeOfficeExtractor.getRequiredApp('book.xlsx')).toBe('excel'));
  it('returns excel for .xls', () => expect(NativeOfficeExtractor.getRequiredApp('book.xls')).toBe('excel'));
  it('returns null for unknown extension', () => expect(NativeOfficeExtractor.getRequiredApp('file.pdf')).toBeNull());
  it('returns null for no extension', () => expect(NativeOfficeExtractor.getRequiredApp('noext')).toBeNull());
});

// ── checkOfficeInstalled ──────────────────────────────────────────────────────

describe('NativeOfficeExtractor.checkOfficeInstalled', () => {
  afterEach(() => {
    setPlatform('linux');
    vi.clearAllMocks();
  });

  it('returns unsupported platform on linux', async () => {
    setPlatform('linux');
    const result = await NativeOfficeExtractor.checkOfficeInstalled();
    expect(result.platform).toBe('unsupported');
    expect(result.word).toBe(false);
  });

  it('checks mac apps via osascript on darwin', async () => {
    setPlatform('darwin');
    // Word: found; PowerPoint: not found; Excel: error
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '/Applications/Microsoft Word.app', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('not found'));

    const result = await NativeOfficeExtractor.checkOfficeInstalled();
    expect(result.platform).toBe('darwin');
    expect(result.word).toBe(true);
    expect(result.powerpoint).toBe(false);
    expect(result.excel).toBe(false);
  });

  it('checks windows COM via powershell on win32', async () => {
    setPlatform('win32');
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: 'OK', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'FAIL', stderr: '' })
      .mockRejectedValueOnce(new Error('fail'));

    const result = await NativeOfficeExtractor.checkOfficeInstalled();
    expect(result.platform).toBe('win32');
    expect(result.word).toBe(true);
    expect(result.powerpoint).toBe(false);
    expect(result.excel).toBe(false);
  });
});

// ── extractFromFile ───────────────────────────────────────────────────────────

describe('NativeOfficeExtractor.extractFromFile', () => {
  afterEach(() => {
    setPlatform('linux');
    vi.clearAllMocks();
  });

  it('throws for unsupported file type', async () => {
    await expect(NativeOfficeExtractor.extractFromFile('/tmp/file.pdf', 'file.pdf'))
      .rejects.toThrow('Unsupported file type for native extraction');
  });

  it('throws when file does not exist', async () => {
    mockFsExistsSync.mockReturnValueOnce(false);
    await expect(NativeOfficeExtractor.extractFromFile('/tmp/missing.docx', 'missing.docx'))
      .rejects.toThrow('File not found');
  });

  it('throws on unsupported platform', async () => {
    setPlatform('linux');
    mockFsExistsSync.mockReturnValueOnce(true);
    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('not supported on linux');
  });

  it('extracts Word on macOS via AppleScript', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:0|150|800\nTEXT:Hello world content here',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    expect(result.extractionMethod).toBe('native-applescript-word');
    expect(result.content).toBe('Hello world content here');
    expect(result.fileType).toBe('docx');
  });

  it('extracts PowerPoint on macOS via AppleScript', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:5\nTEXT:Slide text here',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/slide.pptx', 'slide.pptx');
    expect(result.extractionMethod).toBe('native-applescript-powerpoint');
    expect(result.totalPages).toBe(5);
  });

  it('extracts Excel on macOS via AppleScript', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:3\nTEXT:Sheet data here',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/book.xlsx', 'book.xlsx');
    expect(result.extractionMethod).toBe('native-applescript-excel');
    expect(result.totalPages).toBe(3);
  });

  it('extracts Word on Windows via PowerShell', async () => {
    setPlatform('win32');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:2|300|1500\nTEXT_START\nWord document content\nTEXT_END\n',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    expect(result.extractionMethod).toBe('native-powershell-word');
    expect(result.content).toBe('Word document content');
    expect(result.totalPages).toBe(2);
  });

  it('extracts PowerPoint on Windows via PowerShell', async () => {
    setPlatform('win32');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:10\nTEXT_START\nPPT content\nTEXT_END\n',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/slide.pptx', 'slide.pptx');
    expect(result.extractionMethod).toBe('native-powershell-powerpoint');
    expect(result.totalPages).toBe(10);
  });

  it('extracts Excel on Windows via PowerShell', async () => {
    setPlatform('win32');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:2\nTEXT_START\nExcel data\nTEXT_END\n',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/book.xlsx', 'book.xlsx');
    expect(result.extractionMethod).toBe('native-powershell-excel');
    expect(result.totalPages).toBe(2);
  });

  it('logs stderr warnings when osascript emits stderr', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:0|10|50\nTEXT:content',
      stderr: 'some warning',
    });
    const result = await NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    expect(result.content).toBe('content');
  });

  it.each([
    ['darwin', 'slide.pptx', 'STATS:1\nTEXT:slide', 'native-applescript-powerpoint'],
    ['darwin', 'book.xlsx', 'STATS:1\nTEXT:sheet', 'native-applescript-excel'],
    ['win32', 'doc.docx', 'STATS:1|2|3\nTEXT_START\nword\nTEXT_END', 'native-powershell-word'],
    ['win32', 'slide.pptx', 'STATS:1\nTEXT_START\nslide\nTEXT_END', 'native-powershell-powerpoint'],
    ['win32', 'book.xlsx', 'STATS:1\nTEXT_START\nsheet\nTEXT_END', 'native-powershell-excel'],
  ])('accepts successful %s %s extraction with diagnostic stderr', async (
    platform,
    fileName,
    stdout,
    extractionMethod,
  ) => {
    setPlatform(platform);
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout, stderr: 'Office diagnostic' });

    const result = await NativeOfficeExtractor.extractFromFile(`/workspace/${fileName}`, fileName);

    expect(result.extractionMethod).toBe(extractionMethod);
    expect(result.content).not.toBe('');
  });

  it('retries on transient AppleScript error (-609) then succeeds', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    const transientErr = new Error('osascript error: (-609) Connection is invalid');
    mockExecFileAsync
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce({
        stdout: 'STATS:0|10|50\nTEXT:Retry succeeded',
        stderr: '',
      });

    // Speed up retry delay
    vi.useFakeTimers();
    const promise = NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.content).toBe('Retry succeeded');
    vi.useRealTimers();
  }, 15000);

  it('throws after exhausting retries on persistent transient error', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    // Use a non-retryable error so the retry loop exits after the first attempt
    // (avoids fake-timer/queue timing issues with the serial queue)
    mockExecFileAsync.mockRejectedValueOnce(new Error('Unknown fatal error'));

    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('Failed to extract text using Word');
  }, 15000);

  it('throws immediately on non-retryable error', async () => {
    setPlatform('darwin');
    mockFsExistsSync.mockReturnValueOnce(true);
    mockExecFileAsync.mockRejectedValueOnce(new Error('Document is password protected'));
    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('password');
  });
});

// ── extractFromBuffer ─────────────────────────────────────────────────────────

describe('NativeOfficeExtractor.extractFromBuffer', () => {
  afterEach(() => {
    setPlatform('darwin');
    vi.clearAllMocks();
  });

  beforeEach(() => {
    setPlatform('darwin');
  });

  it('writes temp file, extracts, and cleans up', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:0|50|200\nTEXT:Buffer extracted content',
      stderr: '',
    });

    const buffer = Buffer.from('fake docx content');
    const result = await NativeOfficeExtractor.extractFromBuffer(buffer, 'file.docx');

    expect(mockFsWriteFileSync).toHaveBeenCalled();
    expect(mockFsUnlinkSync).toHaveBeenCalled();
    expect(result.content).toBe('Buffer extracted content');
  });

  it('cleans up temp file even when extraction fails', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockRejectedValueOnce(new Error('Extraction failed'));

    await expect(
      NativeOfficeExtractor.extractFromBuffer(Buffer.from('data'), 'file.docx'),
    ).rejects.toThrow();

    expect(mockFsUnlinkSync).toHaveBeenCalled();
  });

  it('skips cleanup when temp file does not exist after error', async () => {
    mockFsExistsSync
      .mockReturnValueOnce(true)  // existsSync during extractFromFile
      .mockReturnValueOnce(false); // existsSync during cleanup
    mockExecFileAsync.mockRejectedValueOnce(new Error('Failed'));

    await expect(
      NativeOfficeExtractor.extractFromBuffer(Buffer.from('data'), 'file.docx'),
    ).rejects.toThrow();

    expect(mockFsUnlinkSync).not.toHaveBeenCalled();
  });
});

// ── parsers with fallback paths ───────────────────────────────────────────────

describe('NativeOfficeExtractor parsers – fallback (no STATS/TEXT markers)', () => {
  afterEach(() => {
    setPlatform('darwin');
    vi.clearAllMocks();
  });

  beforeEach(() => setPlatform('darwin'));

  it('parseAppleScriptWordOutput falls back to raw output', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'raw content without markers', stderr: '' });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    expect(result.content).toBe('raw content without markers');
    expect(result.extractionMethod).toBe('native-applescript-word');
  });

  it('parseAppleScriptPowerPointOutput falls back to raw output', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'raw ppt output', stderr: '' });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/slide.pptx', 'slide.pptx');
    expect(result.content).toBe('raw ppt output');
    expect(result.totalPages).toBe(0);
  });

  it('parseAppleScriptExcelOutput falls back to raw output', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'raw excel output', stderr: '' });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/book.xlsx', 'book.xlsx');
    expect(result.content).toBe('raw excel output');
    expect(result.totalPages).toBe(0);
  });
});

describe('NativeOfficeExtractor parsers – fallback on Windows', () => {
  afterEach(() => {
    setPlatform('linux');
    vi.clearAllMocks();
  });

  beforeEach(() => setPlatform('win32'));

  it('parsePowerShellWordOutput falls back when no TEXT_START/END', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'raw powershell output', stderr: '' });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    expect(result.content).toBe('raw powershell output');
    expect(result.totalPages).toBe(1);
  });

  it('parsePowerShellPowerPointOutput falls back when no TEXT_START/END', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'raw ppt ps output', stderr: '' });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/slide.pptx', 'slide.pptx');
    expect(result.content).toBe('raw ppt ps output');
    expect(result.totalPages).toBe(0);
  });

  it('parsePowerShellExcelOutput falls back when no TEXT_START/END', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({ stdout: 'raw excel ps output', stderr: '' });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/book.xlsx', 'book.xlsx');
    expect(result.content).toBe('raw excel ps output');
    expect(result.totalPages).toBe(0);
  });

  it('parsePowerShellWordOutput handles STATS with pipe-separated values', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:5|500|3000\nTEXT_START\nPage content\nTEXT_END',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    expect(result.totalPages).toBe(5);
    expect(result.content).toBe('Page content');
  });

  it('parsePowerShellExcelOutput parses sheetCount', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockResolvedValueOnce({
      stdout: 'STATS:4\nTEXT_START\nSheet data\nTEXT_END',
      stderr: '',
    });

    const result = await NativeOfficeExtractor.extractFromFile('/tmp/book.xlsx', 'book.xlsx');
    expect(result.totalPages).toBe(4);
  });
});

// ── handleNativeError (via thrown errors) ─────────────────────────────────────

describe('NativeOfficeExtractor.handleNativeError paths', () => {
  beforeEach(() => setPlatform('darwin'));
  afterEach(() => {
    setPlatform('linux');
    vi.clearAllMocks();
  });

  it('throws timeout error when error has killed=true', async () => {
    mockFsExistsSync.mockReturnValue(true);
    const timeoutErr: any = new Error('ETIMEDOUT');
    timeoutErr.killed = true;
    mockExecFileAsync.mockRejectedValueOnce(timeoutErr);

    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('timed out');
  });

  it('throws timeout error when message includes ETIMEDOUT', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockRejectedValueOnce(new Error('ETIMEDOUT: operation timed out'));

    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('timed out');
  });

  it('throws permission/IRM error for rights-related messages', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockRejectedValueOnce(new Error('Insufficient rights to access document'));

    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('IRM permissions');
  });

  it('throws permission error for permission-related messages', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockRejectedValueOnce(new Error('No permission to open this file'));

    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('IRM permissions');
  });

  it('throws generic error for unknown errors', async () => {
    mockFsExistsSync.mockReturnValue(true);
    mockExecFileAsync.mockRejectedValueOnce(new Error('Unknown COM failure'));

    await expect(NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx'))
      .rejects.toThrow('Failed to extract text using Word');
  });
});

// ── Windows retry error patterns ──────────────────────────────────────────────

describe('NativeOfficeExtractor Windows COM retry patterns', () => {
  beforeEach(() => setPlatform('win32'));
  afterEach(() => {
    setPlatform('linux');
    vi.clearAllMocks();
  });

  it('retries on RPC_E_CALL_REJECTED', async () => {
    mockFsExistsSync.mockReturnValue(true);
    const rpcErr = new Error('RPC_E_CALL_REJECTED: Server busy');
    mockExecFileAsync
      .mockRejectedValueOnce(rpcErr)
      .mockResolvedValueOnce({
        stdout: 'STATS:1|100|500\nTEXT_START\nRetried content\nTEXT_END',
        stderr: '',
      });

    vi.useFakeTimers();
    const promise = NativeOfficeExtractor.extractFromFile('/tmp/doc.docx', 'doc.docx');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.content).toBe('Retried content');
    vi.useRealTimers();
  }, 15000);

  it('retries on CO_E_SERVER_EXEC_FAILURE', async () => {
    mockFsExistsSync.mockReturnValue(true);
    const comErr = new Error('CO_E_SERVER_EXEC_FAILURE occurred');
    mockExecFileAsync
      .mockRejectedValueOnce(comErr)
      .mockResolvedValueOnce({
        stdout: 'STATS:3\nTEXT_START\nPPT retry\nTEXT_END',
        stderr: '',
      });

    vi.useFakeTimers();
    const promise = NativeOfficeExtractor.extractFromFile('/tmp/slide.pptx', 'slide.pptx');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.content).toBe('PPT retry');
    vi.useRealTimers();
  }, 15000);
});
