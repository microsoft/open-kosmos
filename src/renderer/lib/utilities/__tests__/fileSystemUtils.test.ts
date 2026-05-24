/**
 * @vitest-environment happy-dom
 */
import {
  isValidFilePath,
  normalizePath,
  getFileExtension,
  hasFileExtension,
  getFileName,
  getDirectory,
  formatFileSize,
  formatTimestamp,
  checkFileExists,
  listDirectory,
  checkFileReadable,
  readFileContent,
  getFileStats,
  expandPath,
  batchCheckFiles,
  FILE_VALIDATION,
} from '../fileSystemUtils';

describe('fileSystemUtils', () => {
  describe('isValidFilePath', () => {
    it('returns false for empty string', () => {
      expect(isValidFilePath('')).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isValidFilePath(null as any)).toBe(false);
      expect(isValidFilePath(undefined as any)).toBe(false);
    });

    it('returns false for non-string', () => {
      expect(isValidFilePath(123 as any)).toBe(false);
    });

    it('returns false for whitespace only', () => {
      expect(isValidFilePath('   ')).toBe(false);
    });

    it('returns false for paths with invalid characters', () => {
      expect(isValidFilePath('file<name')).toBe(false);
      expect(isValidFilePath('file>name')).toBe(false);
      expect(isValidFilePath('file|name')).toBe(false);
      expect(isValidFilePath('file?name')).toBe(false);
      expect(isValidFilePath('file*name')).toBe(false);
      expect(isValidFilePath('file"name')).toBe(false);
    });

    it('returns true for valid paths', () => {
      expect(isValidFilePath('/usr/local/file.txt')).toBe(true);
      expect(isValidFilePath('./relative/path')).toBe(true);
      expect(isValidFilePath('simple-file.txt')).toBe(true);
    });

    it('returns false for Windows paths with colons (by design)', () => {
      expect(isValidFilePath('C:\\Users\\file.txt')).toBe(false);
    });
  });

  describe('normalizePath', () => {
    it('returns empty string for falsy input', () => {
      expect(normalizePath('')).toBe('');
      expect(normalizePath(null as any)).toBe('');
    });

    it('replaces backslashes with forward slashes', () => {
      expect(normalizePath('C:\\Users\\file.txt')).toBe('C:/Users/file.txt');
    });

    it('removes duplicate slashes', () => {
      expect(normalizePath('/usr//local///file.txt')).toBe('/usr/local/file.txt');
    });

    it('trims whitespace', () => {
      expect(normalizePath('  /path/to/file  ')).toBe('/path/to/file');
    });
  });

  describe('getFileExtension', () => {
    it('returns empty string for falsy input', () => {
      expect(getFileExtension('')).toBe('');
    });

    it('returns extension in lowercase', () => {
      expect(getFileExtension('/path/file.TXT')).toBe('txt');
      expect(getFileExtension('file.JSON')).toBe('json');
    });

    it('returns empty for no extension', () => {
      expect(getFileExtension('/path/file')).toBe('');
    });

    it('returns empty when dot is in directory name', () => {
      expect(getFileExtension('/path.dir/filename')).toBe('');
    });

    it('returns last extension for multiple dots', () => {
      expect(getFileExtension('file.test.ts')).toBe('ts');
    });
  });

  describe('hasFileExtension', () => {
    it('returns true when file has matching extension', () => {
      expect(hasFileExtension('file.json', ['json', 'yaml'])).toBe(true);
    });

    it('returns false when no match', () => {
      expect(hasFileExtension('file.txt', ['json', 'yaml'])).toBe(false);
    });

    it('is case insensitive', () => {
      expect(hasFileExtension('file.JSON', ['json'])).toBe(true);
    });
  });

  describe('getFileName', () => {
    it('returns empty for falsy input', () => {
      expect(getFileName('')).toBe('');
    });

    it('extracts filename from path', () => {
      expect(getFileName('/usr/local/file.txt')).toBe('file.txt');
    });

    it('returns input if no slash', () => {
      expect(getFileName('file.txt')).toBe('file.txt');
    });
  });

  describe('getDirectory', () => {
    it('returns empty for falsy input', () => {
      expect(getDirectory('')).toBe('');
    });

    it('extracts directory from path', () => {
      expect(getDirectory('/usr/local/file.txt')).toBe('/usr/local');
    });

    it('returns empty if no slash', () => {
      expect(getDirectory('file.txt')).toBe('');
    });
  });

  describe('formatFileSize', () => {
    it('returns 0 B for zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatFileSize(500)).toBe('500.0 B');
    });

    it('formats kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
    });

    it('formats megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    });

    it('formats gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
  });

  describe('formatTimestamp', () => {
    it('formats a valid timestamp', () => {
      const result = formatTimestamp(1700000000000);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('Invalid date');
    });

    it('handles invalid timestamp gracefully', () => {
      const result = formatTimestamp(NaN);
      // toLocaleString on Invalid Date returns 'Invalid Date' (doesn't throw)
      expect(result).toContain('Invalid');
    });

    it('returns "Invalid date" when toLocaleString throws', () => {
      const orig = Date.prototype.toLocaleString;
      Date.prototype.toLocaleString = () => { throw new Error('bad locale'); };
      try {
        expect(formatTimestamp(1700000000000)).toBe('Invalid date');
      } finally {
        Date.prototype.toLocaleString = orig;
      }
    });
  });

  describe('async functions with no electronAPI', () => {
    beforeEach(() => {
      // Ensure no electronAPI is available
      (window as any).electronAPI = undefined;
    });

    it('checkFileExists returns fallback when no API', async () => {
      const result = await checkFileExists('/some/path');
      expect(result.exists).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('listDirectory returns fallback when no API', async () => {
      const result = await listDirectory('/some/dir');
      expect(result.success).toBe(false);
    });

    it('checkFileReadable returns fallback when file does not exist', async () => {
      const result = await checkFileReadable('/nonexistent');
      expect(result.readable).toBe(false);
    });

    it('readFileContent returns fallback when file not readable', async () => {
      const result = await readFileContent('/nonexistent');
      expect(result.success).toBe(false);
    });

    it('getFileStats returns fallback when no API', async () => {
      const result = await getFileStats('/some/file');
      expect(result.success).toBe(false);
    });

    it('expandPath returns original path when no API', async () => {
      const result = await expandPath('/some/path');
      expect(result).toBe('/some/path');
    });

    it('batchCheckFiles handles multiple files', async () => {
      const results = await batchCheckFiles(['/file1', '/file2']);
      expect(results).toHaveLength(2);
      results.forEach(r => {
        expect(r.exists).toBe(false);
        expect(r.readable).toBe(false);
      });
    });
  });

  describe('async functions with electronAPI', () => {
    it('checkFileExists calls electronAPI.fs.exists', async () => {
      (window as any).electronAPI = { fs: { exists: vi.fn().mockResolvedValue(true) } };
      const result = await checkFileExists('/existing');
      expect(result.exists).toBe(true);
    });

    it('checkFileExists handles exceptions', async () => {
      (window as any).electronAPI = { fs: { exists: vi.fn().mockRejectedValue(new Error('boom')) } };
      const result = await checkFileExists('/err');
      expect(result.exists).toBe(false);
      expect(result.error).toContain('boom');
    });

    it('listDirectory calls electronAPI.fs.listDir', async () => {
      const entries = [{ name: 'a', isDirectory: false, isFile: true }];
      (window as any).electronAPI = { fs: { listDir: vi.fn().mockResolvedValue({ success: true, entries }) } };
      const result = await listDirectory('/dir');
      expect(result.success).toBe(true);
      expect(result.entries).toEqual(entries);
    });

    it('listDirectory handles exceptions', async () => {
      (window as any).electronAPI = { fs: { listDir: vi.fn().mockRejectedValue(new Error('fail')) } };
      const result = await listDirectory('/dir');
      expect(result.success).toBe(false);
      expect(result.error).toContain('fail');
    });

    it('checkFileReadable with access API', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
        },
      };
      const result = await checkFileReadable('/file');
      expect(result.readable).toBe(true);
      expect(result.writable).toBe(false);
    });

    it('checkFileReadable falls back when no access API but file exists', async () => {
      (window as any).electronAPI = {
        fs: { exists: vi.fn().mockResolvedValue(true) },
      };
      const result = await checkFileReadable('/file');
      expect(result.readable).toBe(true);
    });

    it('checkFileReadable handles exception in access path', async () => {
      // exists succeeds, but access throws
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockRejectedValue(new Error('access crashed')),
        },
      };
      const result = await checkFileReadable('/file');
      expect(result.readable).toBe(false);
      expect(result.error).toContain('access crashed');
    });

    it('readFileContent success path', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
          readFile: vi.fn().mockResolvedValue({ success: true, content: 'data', size: 4, lastModified: 100 }),
        },
      };
      const result = await readFileContent('/file');
      expect(result.success).toBe(true);
      expect(result.content).toBe('data');
    });

    it('readFileContent failure from readFile API', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
          readFile: vi.fn().mockResolvedValue({ success: false, error: 'denied' }),
        },
      };
      const result = await readFileContent('/file');
      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('readFileContent no readFile API', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
        },
      };
      const result = await readFileContent('/file');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not available');
    });

    it('readFileContent handles exception', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
          readFile: vi.fn().mockRejectedValue(new Error('io')),
        },
      };
      const result = await readFileContent('/file');
      expect(result.success).toBe(false);
      expect(result.error).toContain('io');
    });

    it('getFileStats success', async () => {
      (window as any).electronAPI = {
        fs: {
          stat: vi.fn().mockResolvedValue({
            success: true,
            stats: { size: 100, isFile: true, isDirectory: false, mtime: 1000, atime: 2000, birthtime: 500 },
          }),
        },
      };
      const result = await getFileStats('/file');
      expect(result.success).toBe(true);
      expect(result.stats!.size).toBe(100);
    });

    it('getFileStats failure', async () => {
      (window as any).electronAPI = {
        fs: { stat: vi.fn().mockResolvedValue({ success: false, error: 'no stat' }) },
      };
      const result = await getFileStats('/file');
      expect(result.success).toBe(false);
    });

    it('getFileStats no API', async () => {
      (window as any).electronAPI = { fs: {} };
      const result = await getFileStats('/file');
      expect(result.success).toBe(false);
    });

    it('getFileStats handles exception', async () => {
      (window as any).electronAPI = {
        fs: { stat: vi.fn().mockRejectedValue(new Error('crash')) },
      };
      const result = await getFileStats('/file');
      expect(result.success).toBe(false);
      expect(result.error).toContain('crash');
    });

    it('expandPath calls electronAPI', async () => {
      (window as any).electronAPI = {
        fs: { expandPath: vi.fn().mockResolvedValue('/expanded/path') },
      };
      const result = await expandPath('$HOME/test');
      expect(result).toBe('/expanded/path');
    });

    it('expandPath handles exception', async () => {
      (window as any).electronAPI = {
        fs: { expandPath: vi.fn().mockRejectedValue(new Error('no')) },
      };
      const result = await expandPath('$HOME/test');
      expect(result).toBe('$HOME/test');
    });

    it('batchCheckFiles with stats available', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
          stat: vi.fn().mockResolvedValue({ success: true, stats: { size: 42, isFile: true, isDirectory: false, mtime: 0, atime: 0, birthtime: 0 } }),
        },
      };
      const results = await batchCheckFiles(['/file']);
      expect(results[0].exists).toBe(true);
      expect(results[0].readable).toBe(true);
      expect(results[0].size).toBe(42);
    });

    it('batchCheckFiles handles individual file errors', async () => {
      (window as any).electronAPI = {
        fs: {
          exists: vi.fn().mockResolvedValue(true),
          access: vi.fn().mockResolvedValue({ readable: true, writable: false }),
          stat: vi.fn().mockResolvedValue({ success: false, error: 'stat failed' }),
        },
      };
      const results = await batchCheckFiles(['/bad']);
      expect(results[0].exists).toBe(true);
      expect(results[0].readable).toBe(true);
      // stat failed, so size is undefined
      expect(results[0].size).toBeUndefined();
    });
  });

  describe('FILE_VALIDATION', () => {
    it('has VSCODE_SETTINGS config', () => {
      expect(FILE_VALIDATION.VSCODE_SETTINGS.extensions).toContain('json');
      expect(FILE_VALIDATION.VSCODE_SETTINGS.maxSize).toBeGreaterThan(0);
    });

    it('has MCP_JSON config', () => {
      expect(FILE_VALIDATION.MCP_JSON.extensions).toContain('json');
    });
  });
});
