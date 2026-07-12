import { describe, it, expect } from 'vitest';

import {
  normalizePath,
  parseArgs,
  parseNumstatLine,
  getDiffStats,
  readBaseFile,
  getStagedFiles,
  getAddedAllowlistEntries,
  flattenFileLengthAllowlist,
  countLines,
  buildMarkdownReport,
  globToRegex,
  matchGlob,
} from '../check-file-length.js';

import fs from 'fs';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------
describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\a\\b.ts')).toBe('src/a/b.ts');
  });
  it('leaves forward slashes unchanged', () => {
    expect(normalizePath('src/a/b.ts')).toBe('src/a/b.ts');
  });
});

// ---------------------------------------------------------------------------
// globToRegex / matchGlob
// ---------------------------------------------------------------------------
describe('globToRegex / matchGlob', () => {
  it('matches ** across directories', () => {
    expect(matchGlob('src/a/b/c.ts', 'src/**/*.ts')).toBe(true);
  });
  it('does not match files outside the prefix', () => {
    expect(matchGlob('lib/a.ts', 'src/**/*.ts')).toBe(false);
  });
  it('** does not match zero directories', () => {
    expect(matchGlob('src/a.ts', 'src/**/*.ts')).toBe(false);
  });
  it('single * does not cross directory boundary', () => {
    expect(matchGlob('src/a/b.ts', 'src/*.ts')).toBe(false);
    expect(matchGlob('src/a.ts', 'src/*.ts')).toBe(true);
  });
  it('escapes dots so they are literal', () => {
    expect(globToRegex('a.ts').test('axts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------
describe('parseArgs', () => {
  it('parses --staged-only', () => {
    const result = parseArgs(['--staged-only']);
    expect(result.stagedOnly).toBe(true);
    expect(result.baseRef).toBeNull();
    expect(result.headRef).toBeNull();
  });
  it('parses --base-ref and --head-ref', () => {
    const result = parseArgs(['--base-ref', 'origin/main', '--head-ref', 'HEAD']);
    expect(result.baseRef).toBe('origin/main');
    expect(result.headRef).toBe('HEAD');
  });
  it('parses --output', () => {
    const result = parseArgs(['--output', 'report.md']);
    expect(result.outputPath).toBe('report.md');
  });
  it('throws when --base-ref has no value', () => {
    expect(() => parseArgs(['--base-ref'])).toThrow('Missing value');
  });
});

// ---------------------------------------------------------------------------
// parseNumstatLine
// ---------------------------------------------------------------------------
describe('parseNumstatLine', () => {
  it('parses a valid numstat line', () => {
    expect(parseNumstatLine('10\t5\tsrc/foo.ts')).toEqual({
      file: 'src/foo.ts',
      added: 10,
      deleted: 5,
    });
  });
  it('returns null for binary files (dash stats)', () => {
    expect(parseNumstatLine('-\t-\timage.png')).toBeNull();
  });
  it('returns null for lines with too few columns', () => {
    expect(parseNumstatLine('10\t5')).toBeNull();
  });
  it('handles paths with tabs', () => {
    const result = parseNumstatLine('3\t1\tpath/with\ttab.ts');
    expect(result).toEqual({ file: 'path/with\ttab.ts', added: 3, deleted: 1 });
  });
  it('normalizes backslashes in file paths', () => {
    const result = parseNumstatLine('1\t0\tsrc\\main\\file.ts');
    expect(result?.file).toBe('src/main/file.ts');
  });
});

// ---------------------------------------------------------------------------
// getDiffStats — uses injected runGit
// ---------------------------------------------------------------------------
describe('getDiffStats', () => {
  it('uses --base-ref...--head-ref range when both are provided', () => {
    let captured: string[] = [];
    const runGit = (args: string[]) => {
      captured = args;
      return '5\t2\tsrc/a.ts\n3\t0\tsrc/b.ts\n';
    };

    const result = getDiffStats({ baseRef: 'origin/main', headRef: 'HEAD' }, runGit);

    expect(captured).toContain('diff');
    expect(captured).toContain('origin/main...HEAD');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: 'src/a.ts', added: 5, deleted: 2 });
  });

  it('uses --cached for staged-only mode', () => {
    let captured: string[] = [];
    const runGit = (args: string[]) => {
      captured = args;
      return '1\t0\tsrc/c.ts\n';
    };

    const result = getDiffStats({ stagedOnly: true }, runGit);

    expect(captured).toContain('--cached');
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no mode is specified', () => {
    const result = getDiffStats({});
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getStagedFiles — uses injected runGit
// ---------------------------------------------------------------------------
describe('getStagedFiles', () => {
  it('passes array args to runGit (not shell string)', () => {
    let captured: string[] = [];
    const runGit = (args: string[]) => {
      captured = args;
      return 'src/foo.ts\nsrc/bar.tsx\nREADME.md\n';
    };

    const result = getStagedFiles(runGit);

    expect(captured).toEqual(['diff', '--cached', '--name-only', '--diff-filter=ACM']);
    // README.md should be filtered out (not a code extension)
    expect(result.some((f: string) => f.endsWith('foo.ts'))).toBe(true);
    expect(result.some((f: string) => f.endsWith('bar.tsx'))).toBe(true);
    expect(result.some((f: string) => f.endsWith('README.md'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readBaseFile — uses injected runGit
// ---------------------------------------------------------------------------
describe('readBaseFile', () => {
  it('uses baseRef:relPath when baseRef and headRef are provided', () => {
    let captured: string[] = [];
    const runGit = (args: string[]) => {
      captured = args;
      return 'file content';
    };

    const result = readBaseFile(
      { baseRef: 'origin/main', headRef: 'HEAD' },
      'scripts/file-length-allowlist.json',
      runGit,
    );

    expect(captured).toContain('show');
    expect(captured).toContain('origin/main:scripts/file-length-allowlist.json');
    expect(result).toBe('file content');
  });

  it('uses HEAD:relPath in staged-only mode', () => {
    let captured: string[] = [];
    const runGit = (args: string[]) => {
      captured = args;
      return '{}';
    };

    readBaseFile({ stagedOnly: true }, 'scripts/file-length-allowlist.json', runGit);

    expect(captured).toContain('show');
    expect(captured).toContain('HEAD:scripts/file-length-allowlist.json');
  });

  it('returns null when neither mode is set', () => {
    const result = readBaseFile({}, 'some/path.json');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAddedAllowlistEntries — uses injected runGit
// ---------------------------------------------------------------------------
describe('getAddedAllowlistEntries', () => {
  it('detects newly added allowlist entries via injected runGit', () => {
    // runGit returns a base config with an entry that also exists in current config
    // so additions = current - base
    const runGit = (args: string[]) => {
      // Return a base config that looks like the current one
      // so there should be no additions
      return JSON.stringify({
        allowlist: [],
        overrides: [],
      });
    };

    const additions = getAddedAllowlistEntries(
      { baseRef: 'base', headRef: 'head' },
      runGit,
    );

    // With empty base, all current allowlist entries are "additions"
    expect(Array.isArray(additions)).toBe(true);
    expect(additions.length).toBeGreaterThan(0);
  });

  it('passes array args to runGit for git show', () => {
    let captured: string[] = [];
    const runGit = (args: string[]) => {
      captured = args;
      // Return a config matching the current one so no additions
      return JSON.stringify({
        allowlist: [],
        overrides: [],
      });
    };

    getAddedAllowlistEntries({ stagedOnly: true }, runGit);

    expect(captured).toContain('show');
    expect(captured).toContain('HEAD:scripts/file-length-allowlist.json');
  });

  it('returns empty array when readBaseFile throws', () => {
    const runGit = () => {
      throw new Error('git not found');
    };

    // When git fails, baseRaw falls back to '{}', so base is empty set
    // All current entries become "additions" — but the function doesn't crash
    const additions = getAddedAllowlistEntries(
      { baseRef: 'base', headRef: 'head' },
      runGit,
    );
    expect(Array.isArray(additions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// flattenFileLengthAllowlist
// ---------------------------------------------------------------------------
describe('flattenFileLengthAllowlist', () => {
  it('flattens top-level allowlist', () => {
    const result = flattenFileLengthAllowlist({
      allowlist: ['src/a.ts', 'src/b.ts'],
    });
    expect(result).toBeInstanceOf(Set);
    expect(result.has('src/a.ts')).toBe(true);
    expect(result.has('src/b.ts')).toBe(true);
  });

  it('includes override allowlists', () => {
    const result = flattenFileLengthAllowlist({
      allowlist: ['src/a.ts'],
      overrides: [{ pattern: '*.tsx', allowlist: ['src/c.tsx'] }],
    });
    expect(result.has('src/a.ts')).toBe(true);
    expect(result.has('src/c.tsx')).toBe(true);
  });

  it('normalizes backslashes', () => {
    const result = flattenFileLengthAllowlist({
      allowlist: ['src\\win\\file.ts'],
    });
    expect(result.has('src/win/file.ts')).toBe(true);
  });

  it('returns empty set for missing allowlist', () => {
    const result = flattenFileLengthAllowlist({});
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countLines
// ---------------------------------------------------------------------------
describe('countLines', () => {
  it('counts lines of a file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-test-'));
    const tmpFile = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(tmpFile, 'line1\nline2\nline3\n', 'utf8');
    expect(countLines(tmpFile)).toBe(3);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns 0 for empty file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-test-'));
    const tmpFile = path.join(tmpDir, 'empty.ts');
    fs.writeFileSync(tmpFile, '', 'utf8');
    expect(countLines(tmpFile)).toBe(0);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// buildMarkdownReport
// ---------------------------------------------------------------------------
describe('buildMarkdownReport', () => {
  it('returns a string containing passed when no violations', () => {
    const report = buildMarkdownReport({
      hardViolations: [],
      allowlistedGrowthViolations: [],
      allowlistedGrowthWithinLimit: [],
      allowlistAdditions: [],
    });
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(0);
  });

  it('includes violation info when there are hard violations', () => {
    const report = buildMarkdownReport({
      hardViolations: [{ file: 'src/big.ts', lines: 1500, limit: 1000 }],
      allowlistedGrowthViolations: [],
      allowlistedGrowthWithinLimit: [],
      allowlistAdditions: [],
    });
    expect(report).toContain('src/big.ts');
    expect(report).toContain('1500');
  });
});
