import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('extractFilePathsFromText', () => {
  it('extracts a Unix path from text', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    const result = extractFilePathsFromText('Saved to /Users/alice/projects/report.md here.');
    expect(result).toContain('/Users/alice/projects/report.md');
  });

  it('extracts a Windows path from text', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    const result = extractFilePathsFromText('File is at C:\\Users\\bob\\docs\\notes.txt right?');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('notes.txt');
  });

  it('deduplicates repeated paths', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    const result = extractFilePathsFromText('/Users/alice/foo.txt and again /Users/alice/foo.txt');
    expect(result.filter((p: string) => p.includes('foo.txt'))).toHaveLength(1);
  });

  it('returns empty array for plain text with no paths', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    expect(extractFilePathsFromText('Hello, world!')).toEqual([]);
  });
});

describe('linkifyFilePaths', () => {
  it('converts a Unix path to a markdown link with filename only', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const result = linkifyFilePaths('Saved to /Users/alice/projects/report.md here.');
    expect(result).toBe('Saved to [report.md](/Users/alice/projects/report.md) here.');
  });

  it('converts a Windows path to a markdown link with file:/// scheme', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const result = linkifyFilePaths('File at C:\\Users\\bob\\docs\\notes.txt done.');
    expect(result).toContain('[notes.txt](file:///');
  });

  it('does not linkify paths with spaces in free text to avoid merging prose', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = 'See /Users/alice/Library/Application Support/openkosmos/file.png end.';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('does not modify paths inside inline code', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = 'Run `cat /Users/alice/projects/report.md` to see it.';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('does not modify paths inside code blocks', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '```\n/Users/alice/projects/report.md\n```';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('does not modify paths already inside markdown links', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '[report](/Users/alice/projects/report.md)';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('returns plain text unchanged when no paths exist', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    expect(linkifyFilePaths('Hello, world!')).toBe('Hello, world!');
  });

  it('handles multiple paths on separate lines', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '/Users/a/file1.png\n/Users/b/file2.mmd';
    const result = linkifyFilePaths(input);
    expect(result).toContain('[file1.png]');
    expect(result).toContain('[file2.mmd]');
  });

  it('does not modify paths inside backtick-wrapped inline code', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = 'File path: `C:/Users/yueyingchen/AppData/Roaming/openkosmos/csv_stats.py`';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('uses file:/// scheme for Windows paths with forward slashes', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const result = linkifyFilePaths('File: C:/Users/test/report.md done.');
    expect(result).toBe('File: [report.md](file:///C:/Users/test/report.md) done.');
  });

  it('does not modify HTTPS URLs', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = 'Link: https://docs.example.com/files/report.xlsx';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('does not modify paths inside language-tagged code blocks', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '```python\ncsv_path = r"C:/Users/test/data.csv"\n```';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('linkifies bare path but skips code block path in same text', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '```bash\npython C:/Users/test/script.py\n```\n\nOutput saved to /Users/alice/result.json';
    const result = linkifyFilePaths(input);
    expect(result).toContain('python C:/Users/test/script.py');
    expect(result).toContain('[result.json]');
  });

  it('does not merge two same-line Unix paths into one link', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '/Users/alice/a.md and /Users/bob/b.md';
    const result = linkifyFilePaths(input);
    expect(result).toBe('[a.md](/Users/alice/a.md) and [b.md](/Users/bob/b.md)');
  });

  it('preserves an existing markdown link when a bare path follows', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '[report](/Users/alice/report.md) and /Users/bob/report.md';
    const result = linkifyFilePaths(input);
    expect(result).toBe('[report](/Users/alice/report.md) and [report.md](/Users/bob/report.md)');
  });

  it('does not corrupt URLs with Unix system-dir segments in path', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const urls = [
      'https://cdn.example.com/media/images/photo.jpg',
      'https://example.com/home/index.html',
      'https://files.example.org/var/www/logo.png',
      'https://example.com/usr/share/doc.pdf',
    ];
    for (const url of urls) {
      expect(linkifyFilePaths(url)).toBe(url);
    }
  });

  it('does not corrupt URLs embedded in surrounding prose', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const inputs = [
      'See https://cdn.example.com/media/images/photo.jpg here.',
      'Docs at http://docs.example.com/home/getting-started.html for setup.',
      'Image https://files.example.org/var/www/static/logo.png loaded.',
      'Reference: https://example.com/usr/share/doc.pdf',
    ];
    for (const input of inputs) {
      expect(linkifyFilePaths(input)).toBe(input);
    }
  });

  it('does not linkify paths inside an unclosed fenced code block (mid-stream)', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = 'Output:\n```\n/Users/alice/result.json\n/Users/bob/data.csv';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('linkifies bare path but not paths inside an unclosed fence in the same text', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = 'Saved to /Users/alice/log.txt.\n\n```bash\ncat /Users/alice/log.txt';
    const result = linkifyFilePaths(input);
    expect(result.startsWith('Saved to [log.txt](/Users/alice/log.txt).')).toBe(true);
    expect(result).toContain('cat /Users/alice/log.txt');
    expect(result.indexOf('[log.txt]')).toBe(result.lastIndexOf('[log.txt]'));
  });

  it('does not linkify macOS paths with spaces in free text (strict mode)', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '/Users/lei/Library/Application Support/openkosmos-app/profiles/mile/jtbd-diagnostic.png';
    expect(linkifyFilePaths(input)).toBe(input);
  });
});

describe('isFilePathString', () => {
  it('matches a Windows path with backslashes', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('C:\\Users\\test\\file.txt')).toBe(true);
  });

  it('matches a Unix path', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('/Users/alice/report.md')).toBe(true);
  });

  it('matches macOS paths with spaces (Application Support)', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('/Users/lei/Library/Application Support/openkosmos-app/profiles/mile/jtbd-diagnostic.png')).toBe(true);
  });

  it('rejects path followed by prose', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('C:\\Users\\foo.txt is updated')).toBe(false);
  });

  it('rejects plain text', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('hello world')).toBe(false);
  });
});

describe('isLocalFilePath', () => {
  it('matches Unix absolute path', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('/Users/alice/file.txt')).toBe(true);
  });

  it('matches Windows drive path', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('C:\\Users\\file.txt')).toBe(true);
  });

  it('matches file:/// URL', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('file:///C:/Users/file.txt')).toBe(true);
  });

  it('rejects http URL', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('https://example.com')).toBe(false);
  });
});

describe('stripFileScheme', () => {
  it('strips file:/// from Windows path', async () => {
    const { stripFileScheme } = await import('../filePathUtils');
    expect(stripFileScheme('file:///C:/Users/file.txt')).toBe('C:/Users/file.txt');
  });

  it('preserves leading slash for Unix path', async () => {
    const { stripFileScheme } = await import('../filePathUtils');
    expect(stripFileScheme('file:///Users/bob/file.txt')).toBe('/Users/bob/file.txt');
  });

  it('returns input unchanged when no file scheme', async () => {
    const { stripFileScheme } = await import('../filePathUtils');
    expect(stripFileScheme('/Users/alice/file.txt')).toBe('/Users/alice/file.txt');
  });

  it('does not crash on malformed percent encoding', async () => {
    const { stripFileScheme } = await import('../filePathUtils');
    expect(stripFileScheme('file:///C:/Users/bad%2path.txt')).toBe('C:/Users/bad%2path.txt');
  });

  it('decodes %20 in paths', async () => {
    const { stripFileScheme } = await import('../filePathUtils');
    expect(stripFileScheme('file:///Users/test/Application%20Support/file.txt')).toBe('/Users/test/Application Support/file.txt');
  });
});

describe('getFileName', () => {
  it('extracts filename from Unix path', async () => {
    const { getFileName } = await import('../filePathUtils');
    expect(getFileName('/Users/alice/report.md')).toBe('report.md');
  });

  it('extracts filename from Windows path', async () => {
    const { getFileName } = await import('../filePathUtils');
    expect(getFileName('C:\\Users\\bob\\notes.txt')).toBe('notes.txt');
  });

  it('returns input when no separator', async () => {
    const { getFileName } = await import('../filePathUtils');
    expect(getFileName('file.txt')).toBe('file.txt');
  });

  it('returns input for empty string (fallback branch)', async () => {
    const { getFileName } = await import('../filePathUtils');
    expect(getFileName('')).toBe('');
  });
});

describe('extractFilePathsFromText edge cases', () => {
  it('extracts both Windows and non-overlapping Unix paths', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    const result = extractFilePathsFromText('C:\\docs\\a.txt\n/home/bob/b.txt');
    expect(result).toHaveLength(2);
  });

  it('handles Windows path with forward slashes', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    const result = extractFilePathsFromText('File at C:/Users/test/data.csv here');
    expect(result).toHaveLength(1);
  });

  it('does not extract Unix path segments from URLs', async () => {
    const { extractFilePathsFromText } = await import('../filePathUtils');
    const result = extractFilePathsFromText('https://cdn.example.com/media/photo.jpg');
    expect(result).toEqual([]);
  });
});

describe('linkifyFilePaths branch coverage', () => {
  it('deduplicates overlapping Windows and Unix matches', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const result = linkifyFilePaths('C:/Users/test/report.md');
    const linkCount = (result.match(/\[/g) || []).length;
    expect(linkCount).toBe(1);
  });

  it('skips path inside code block (codeBlockRanges branch)', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    const input = '```\n/Users/alice/file.txt\n```';
    expect(linkifyFilePaths(input)).toBe(input);
  });

  it('skips path inside inline code (inlineCodeRanges branch)', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    expect(linkifyFilePaths('See `/Users/alice/file.txt` here')).toBe('See `/Users/alice/file.txt` here');
  });

  it('skips path inside existing markdown link (isInsideLink branch)', async () => {
    const { linkifyFilePaths } = await import('../filePathUtils');
    expect(linkifyFilePaths('[file](/Users/alice/file.txt)')).toBe('[file](/Users/alice/file.txt)');
  });
});

describe('isLocalFilePath all branches', () => {
  it('matches /path (first branch)', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('/Users/a.txt')).toBe(true);
  });

  it('matches C:\\ (second branch)', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('C:\\file.txt')).toBe(true);
  });

  it('matches file:/// (third branch)', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('file:///C:/file.txt')).toBe(true);
  });

  it('rejects relative path', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('relative/path.txt')).toBe(false);
  });

  it('rejects // protocol-relative URL', async () => {
    const { isLocalFilePath } = await import('../filePathUtils');
    expect(isLocalFilePath('//cdn.example.com/file.js')).toBe(false);
  });
});

describe('isFilePathString all branches', () => {
  it('matches Windows path (first branch)', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('D:\\docs\\file.pdf')).toBe(true);
  });

  it('matches Unix path (second branch)', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('/home/user/file.txt')).toBe(true);
  });

  it('rejects path without extension', async () => {
    const { isFilePathString } = await import('../filePathUtils');
    expect(isFilePathString('/Users/alice/noext')).toBe(false);
  });
});
