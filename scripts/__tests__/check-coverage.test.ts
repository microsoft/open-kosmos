import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

import {
  normalizePath,
  globToRegex,
  matchGlob,
  matchesAny,
  parseArgs,
  getChangedFiles,
  getAddedCoverageAllowlistEntries,
  computeFileMetrics,
  loadCoverageByRelPath,
  evaluateChangedFiles,
  buildMarkdownReport,
} from '../check-coverage.js';

const THRESHOLDS = { lines: 90, functions: 90, branches: 90, statements: 90 };
const INCLUDE = ['src/**/*.ts', 'src/**/*.tsx'];
const EXEMPT = [
  'src/**/__tests__/**',
  'src/**/*.test.ts',
  'src/**/*.spec.ts',
  'src/**/*.d.ts',
  'src/**/*.config.ts',
];

// Build a minimal Istanbul/v8 coverage entry. `statements` is an array of hit
// counts; each maps to a unique source line. Functions and branches are
// optional arrays of hit counts.
function makeEntry({ statements = [], functions = [], branches = [] }: {
  statements?: number[];
  functions?: number[];
  branches?: number[][];
}) {
  const s: Record<string, number> = {};
  const statementMap: Record<string, { start: { line: number } }> = {};
  statements.forEach((hit, i) => {
    s[i] = hit;
    statementMap[i] = { start: { line: i + 1 } };
  });
  const f: Record<string, number> = {};
  functions.forEach((hit, i) => {
    f[i] = hit;
  });
  const b: Record<string, number[]> = {};
  branches.forEach((counts, i) => {
    b[i] = counts;
  });
  return { s, statementMap, f, b };
}

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\a\\b.ts')).toBe('src/a/b.ts');
  });
});

describe('globToRegex / matchGlob', () => {
  it('matches ** across directories', () => {
    expect(matchGlob('src/a/b/c.ts', 'src/**/*.ts')).toBe(true);
  });
  it('does not match files outside the prefix', () => {
    expect(matchGlob('lib/a.ts', 'src/**/*.ts')).toBe(false);
  });
  it('** matches zero directories', () => {
    expect(matchGlob('src/a.ts', 'src/**/*.ts')).toBe(true);
  });
  it('single * does not cross directory boundary', () => {
    expect(matchGlob('src/a/b.ts', 'src/*.ts')).toBe(false);
    expect(matchGlob('src/a.ts', 'src/*.ts')).toBe(true);
  });
  it('escapes dots so they are literal', () => {
    expect(globToRegex('a.ts').test('axts')).toBe(false);
  });
});

describe('matchesAny', () => {
  it('returns true when any pattern matches', () => {
    expect(matchesAny('src/a/b.test.ts', EXEMPT)).toBe(true);
  });
  it('returns false when no pattern matches', () => {
    expect(matchesAny('src/a/b.ts', EXEMPT)).toBe(false);
  });
});

describe('parseArgs', () => {
  it('parses base/head ref and output', () => {
    const r = parseArgs(['--base-ref', 'aaa', '--head-ref', 'bbb', '--output', 'r.md']);
    expect(r).toMatchObject({ baseRef: 'aaa', headRef: 'bbb', outputPath: 'r.md', stagedOnly: false });
  });
  it('parses staged-only', () => {
    expect(parseArgs(['--staged-only']).stagedOnly).toBe(true);
  });
  it('throws on missing value', () => {
    expect(() => parseArgs(['--base-ref'])).toThrow(/Missing value/);
  });
});

describe('getChangedFiles', () => {
  const fakeGit = (out: string) => () => out;

  it('builds a base...head diff command with rename detection and filters to .ts/.tsx', () => {
    let captured: string[] = [];
    const run = (gitArgs: string[]) => {
      captured = gitArgs;
      return 'src/a.ts\nREADME.md\nsrc/b.tsx\n';
    };
    const files = getChangedFiles({ baseRef: 'aaa', headRef: 'bbb' }, run);
    expect(captured).toContain('--diff-filter=ACMR');
    expect(captured).toContain('--find-renames');
    expect(captured).toContain('aaa...bbb');
    expect(files).toEqual(['src/a.ts', 'src/b.tsx']);
  });

  it('supports staged-only mode', () => {
    let captured: string[] = [];
    const run = (gitArgs: string[]) => {
      captured = gitArgs;
      return 'src/a.ts\n';
    };
    getChangedFiles({ stagedOnly: true }, run);
    expect(captured).toContain('--cached');
    expect(captured).toContain('--diff-filter=ACMR');
  });

  it('normalizes windows paths', () => {
    const files = getChangedFiles({ stagedOnly: true }, fakeGit('src\\a\\b.ts\n'));
    expect(files).toEqual(['src/a/b.ts']);
  });

  it('throws when no mode is given', () => {
    expect(() => getChangedFiles({}, fakeGit(''))).toThrow(/Specify/);
  });
});

describe('getAddedCoverageAllowlistEntries', () => {
  it('returns only allowlist entries added after the base ref', () => {
    const currentConfig = { allowlist: ['src/existing.ts', 'src/new.ts'] };
    const runGit = () => JSON.stringify({ allowlist: ['src/existing.ts'] });

    const additions = getAddedCoverageAllowlistEntries(
      { baseRef: 'base', headRef: 'head' },
      currentConfig,
      runGit,
    );

    expect(additions).toEqual(['src/new.ts']);
  });

  it('compares staged config against HEAD', () => {
    let captured: string[] = [];
    const runGit = (gitArgs: string[]) => {
      captured = gitArgs;
      return JSON.stringify({ allowlist: [] });
    };

    const additions = getAddedCoverageAllowlistEntries(
      { stagedOnly: true },
      { allowlist: ['src/new.ts'] },
      runGit,
    );

    expect(captured).toContain('show');
    expect(captured).toContain('HEAD:scripts/coverage-threshold-config.json');
    expect(additions).toEqual(['src/new.ts']);
  });
});

describe('computeFileMetrics', () => {
  it('reports 100% when fully covered', () => {
    const m = computeFileMetrics(makeEntry({
      statements: [1, 2, 3],
      functions: [1, 1],
      branches: [[1, 1]],
    }));
    expect(m).toEqual({ lines: 100, functions: 100, branches: 100, statements: 100 });
  });

  it('computes partial coverage correctly', () => {
    const m = computeFileMetrics(makeEntry({
      statements: [5, 0, 0], // 1/3
      functions: [1, 0], // 1/2
      branches: [[1, 0]], // 1/2
    }));
    expect(m.statements).toBeCloseTo(33.33, 1);
    expect(m.functions).toBe(50);
    expect(m.branches).toBe(50);
    expect(m.lines).toBeCloseTo(33.33, 1);
  });

  it('treats empty metric sets as 100% (vacuously satisfied)', () => {
    const m = computeFileMetrics(makeEntry({}));
    expect(m).toEqual({ lines: 100, functions: 100, branches: 100, statements: 100 });
  });

  it('counts a line as covered when any statement on it is hit', () => {
    // two statements share line 1 (one hit, one not) -> line is covered
    const entry = {
      s: { 0: 1, 1: 0 },
      statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 1 } } },
      f: {},
      b: {},
    };
    expect(computeFileMetrics(entry).lines).toBe(100);
  });
});

describe('evaluateChangedFiles', () => {
  const base = {
    thresholds: THRESHOLDS,
    includePatterns: INCLUDE,
    exemptPatterns: EXEMPT,
    allowlist: new Set<string>(),
  };

  it('passes a fully covered in-scope file', () => {
    const coverageByRel = new Map([
      ['src/a.ts', makeEntry({ statements: [1, 1], functions: [1], branches: [[1, 1]] })],
    ]);
    const results = evaluateChangedFiles({ ...base, changedFiles: ['src/a.ts'], coverageByRel });
    expect(results).toHaveLength(1);
    expect(results[0].failed).toBe(false);
    expect(results[0].hasData).toBe(true);
  });

  it('fails an under-covered in-scope file', () => {
    const coverageByRel = new Map([
      ['src/a.ts', makeEntry({ statements: [1, 0, 0, 0] })],
    ]);
    const results = evaluateChangedFiles({ ...base, changedFiles: ['src/a.ts'], coverageByRel });
    expect(results[0].failed).toBe(true);
  });

  it('treats a changed in-scope file with no coverage data as 0% and fails', () => {
    const results = evaluateChangedFiles({ ...base, changedFiles: ['src/a.ts'], coverageByRel: new Map() });
    expect(results[0]).toMatchObject({ failed: true, hasData: false });
    expect(results[0].metrics).toEqual({ lines: 0, functions: 0, branches: 0, statements: 0 });
  });

  it('ignores out-of-scope files (root tooling configs) even without coverage', () => {
    const results = evaluateChangedFiles({
      ...base,
      changedFiles: ['vitest.config.ts', 'webpack.main.config.ts', 'scripts/check-coverage.js'],
      coverageByRel: new Map(),
    });
    expect(results).toHaveLength(0);
  });

  it('skips exempt files (tests, .d.ts, configs)', () => {
    const results = evaluateChangedFiles({
      ...base,
      changedFiles: ['src/a.test.ts', 'src/__tests__/b.ts', 'src/types.d.ts', 'src/x.config.ts'],
      coverageByRel: new Map(),
    });
    expect(results).toHaveLength(0);
  });

  it('skips allowlisted files', () => {
    const results = evaluateChangedFiles({
      ...base,
      allowlist: new Set(['src/legacy.ts']),
      changedFiles: ['src/legacy.ts'],
      coverageByRel: new Map(),
    });
    expect(results).toHaveLength(0);
  });

  it('returns empty when there are no changed source files', () => {
    const results = evaluateChangedFiles({ ...base, changedFiles: [], coverageByRel: new Map() });
    expect(results).toHaveLength(0);
  });

  it('sorts failures before passes, then alphabetically', () => {
    const coverageByRel = new Map([
      ['src/pass.ts', makeEntry({ statements: [1, 1] })],
      ['src/failb.ts', makeEntry({ statements: [0] })],
    ]);
    const results = evaluateChangedFiles({
      ...base,
      changedFiles: ['src/pass.ts', 'src/failb.ts', 'src/faila.ts'],
      coverageByRel,
    });
    expect(results.map(r => r.file)).toEqual(['src/faila.ts', 'src/failb.ts', 'src/pass.ts']);
  });
});

describe('loadCoverageByRelPath', () => {
  it('returns an empty map when the report is missing', () => {
    const map = loadCoverageByRelPath('/nonexistent/coverage-final.json', '/root');
    expect(map.size).toBe(0);
  });

  it('keys entries by repo-relative normalized path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-'));
    const root = '/repo/root';
    const file = path.join(dir, 'coverage-final.json');
    fs.writeFileSync(file, JSON.stringify({ '/repo/root/src/a.ts': makeEntry({ statements: [1] }) }));
    const map = loadCoverageByRelPath(file, root);
    expect(map.has('src/a.ts')).toBe(true);
  });
});

describe('buildMarkdownReport', () => {
  it('renders PASSED when no failures', () => {
    const results = [{ file: 'src/a.ts', metrics: { lines: 100, functions: 100, branches: 100, statements: 100 }, hasData: true, failed: false }];
    const md = buildMarkdownReport(results, THRESHOLDS);
    expect(md).toContain('Coverage Check PASSED');
  });

  it('renders FAILED with the failing file and _no data_ marker', () => {
    const results = [{ file: 'src/a.ts', metrics: { lines: 0, functions: 0, branches: 0, statements: 0 }, hasData: false, failed: true }];
    const md = buildMarkdownReport(results, THRESHOLDS);
    expect(md).toContain('Coverage Check FAILED');
    expect(md).toContain('`src/a.ts`');
    expect(md).toContain('_no data_');
  });

  it('renders forbidden allowlist additions as failures', () => {
    const md = buildMarkdownReport([], THRESHOLDS, ['src/new.ts']);
    expect(md).toContain('Coverage Check FAILED');
    expect(md).toContain('Forbidden coverage allowlist additions');
    expect(md).toContain('`src/new.ts`');
  });

  it('notes when no source files require coverage', () => {
    const md = buildMarkdownReport([], THRESHOLDS);
    expect(md).toContain('No changed source files require coverage');
  });
});
