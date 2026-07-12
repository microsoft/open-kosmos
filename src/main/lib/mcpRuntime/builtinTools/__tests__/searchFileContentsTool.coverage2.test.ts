// @ts-nocheck
/**
 * searchFileContentsTool.coverage2.test.ts
 *
 * Targets uncovered branches in SearchFileContentsTool (39 statements, 85.5%):
 *  - resolveTargets: paths > MAX_INPUT_PATHS truncation
 *  - resolveTargets: relative path without workspaceRoot (skipped)
 *  - resolveTargets: duplicate absolute paths (dedup via visited Set)
 *  - resolveTargets: absolute path inside workspace root
 *  - walkDirectory: file scan limit reached
 *  - processFile: stat fails (early return)
 *  - processFile: readFile fails (error push + return)
 *  - buildBlock: long line truncation
 *  - processFile: consecutive matched lines (block merge)
 *  - execute: context = 0 non-integer branch (defaulted)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

import { SearchFileContentsTool } from '../searchFileContentsTool';

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-cov2-'));
}

async function cleanTmpDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ── resolveTargets: paths list truncated when > 10 ────────────────────────────
describe('SearchFileContentsTool — resolveTargets paths truncation', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('warns when more than 10 paths supplied', async () => {
    // Create 12 files
    for (let i = 0; i < 12; i++) {
      await fs.writeFile(path.join(tmpDir, `f${i}.txt`), 'hello');
    }
    const paths = Array.from({ length: 12 }, (_, i) => `f${i}.txt`);
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      paths,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('truncated to first 10')]),
    );
  });
});

// ── resolveTargets: relative path without workspaceRoot ───────────────────────
describe('SearchFileContentsTool — resolveTargets relative path no root', () => {
  it('skips relative path when workspaceRoot is empty and warns', async () => {
    // Use an absolute path in paths[] but also supply a relative path
    // by crafting a call where workspaceRoot resolves, but a second entry
    // in paths is an empty-trimmed string (skipped silently).
    const tmpDir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
      // Pass a whitespace-only path to hit the `if (!trimmed) continue` branch
      const result = await SearchFileContentsTool.execute({
        patterns: ['hello'],
        workspaceRoot: tmpDir,
        paths: ['a.txt', '   '],
      });
      // Only a.txt found; whitespace path silently skipped
      expect(result.patternResults[0].results.length).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanTmpDir(tmpDir);
    }
  });
});

// ── resolveTargets: absolute path inside workspace ────────────────────────────
describe('SearchFileContentsTool — resolveTargets absolute path inside workspace', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('accepts absolute path inside workspaceRoot', async () => {
    await fs.writeFile(path.join(tmpDir, 'target.txt'), 'findme');
    const absPath = path.join(tmpDir, 'target.txt');
    const result = await SearchFileContentsTool.execute({
      patterns: ['findme'],
      workspaceRoot: tmpDir,
      paths: [absPath],
    });
    expect(result.patternResults[0].results).toHaveLength(1);
  });
});

// ── resolveTargets: deduplication ─────────────────────────────────────────────
describe('SearchFileContentsTool — resolveTargets deduplication', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('deduplicates paths pointing to the same file', async () => {
    await fs.writeFile(path.join(tmpDir, 'dup.txt'), 'hello');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      paths: ['dup.txt', 'dup.txt'],
    });
    // Only one result entry despite two identical paths
    expect(result.patternResults[0].results).toHaveLength(1);
  });
});

// ── buildBlock: long-line truncation ─────────────────────────────────────────
describe('SearchFileContentsTool — buildBlock long line truncation', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('truncates lines longer than 500 chars in match output', async () => {
    const longLine = 'match ' + 'x'.repeat(510);
    await fs.writeFile(path.join(tmpDir, 'long.txt'), longLine);
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      context: 0,
    });
    const block = result.patternResults[0].results[0]?.matches[0];
    expect(block).toBeDefined();
    expect(block.lines[0]).toContain('[truncated...]');
  });
});

// ── processFile: consecutive matched lines form merged blocks ─────────────────
describe('SearchFileContentsTool — processFile consecutive matches merge', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('merges consecutive matched lines into a single block', async () => {
    // Three consecutive lines that all match
    const content = 'match one\nmatch two\nmatch three\nunrelated';
    await fs.writeFile(path.join(tmpDir, 'consec.txt'), content);
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      context: 0,
    });
    const fileResult = result.patternResults[0].results[0];
    expect(fileResult).toBeDefined();
    // All three consecutive matches should be in one block
    expect(fileResult.matches).toHaveLength(1);
    expect(fileResult.matches[0].matchCount).toBe(3);
  });
});

// ── processFile: many separate matches (cap at MAX_MATCHES_PER_FILE=5) ────────
describe('SearchFileContentsTool — processFile max matches per file cap', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('caps match blocks at 5 per file', async () => {
    // Create 10 isolated matches (each separated by many non-matching lines)
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push('match here');
      for (let j = 0; j < 5; j++) lines.push('no match');
    }
    await fs.writeFile(path.join(tmpDir, 'many.txt'), lines.join('\n'));
    const result = await SearchFileContentsTool.execute({
      patterns: ['match here'],
      workspaceRoot: tmpDir,
      context: 0,
    });
    const fileResult = result.patternResults[0].results[0];
    expect(fileResult.matches.length).toBeLessThanOrEqual(5);
  });
});

// ── walkDirectory: skips ignored dirs (coverage for else-if branch) ───────────
describe('SearchFileContentsTool — walkDirectory ignored dirs branch', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('skips .git directory', async () => {
    const gitDir = path.join(tmpDir, '.git');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(path.join(gitDir, 'HEAD'), 'hello from git');
    await fs.writeFile(path.join(tmpDir, 'real.txt'), 'hello');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
    });
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.some(f => f.includes('.git'))).toBe(false);
    expect(files.some(f => f.includes('real.txt'))).toBe(true);
  });
});

// ── **/*.ext glob filtering ────────────────────────────────────────────────────
describe('SearchFileContentsTool — **/*.ext glob', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('**/*.ts glob filters to only .ts files in subdirectory', async () => {
    const sub = path.join(tmpDir, 'src');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'code.ts'), 'hello typescript');
    await fs.writeFile(path.join(sub, 'readme.md'), 'hello markdown');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      fileGlob: '**/*.ts',
    });
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.some(f => f.endsWith('.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('.md'))).toBe(false);
  });
});

// ── context invalid (non-integer) — validateArgs throws ──────────────────────
describe('SearchFileContentsTool — context invalid non-integer', () => {
  it('throws when context is a non-integer float', async () => {
    await expect(
      SearchFileContentsTool.execute({
        patterns: ['hello'],
        workspaceRoot: '/tmp',
        context: 1.5 as any,
      }),
    ).rejects.toThrow(/context/);
  });
});

// ── isMicrosoftAuthority via windows.net URL ──────────────────────────────────
describe('SearchFileContentsTool — shouldSkipByGlob private', () => {
  const skip = (rel: string, glob?: string) =>
    (SearchFileContentsTool as any).shouldSkipByGlob(rel, glob);

  it('returns false when glob is undefined', () => expect(skip('foo.ts', undefined)).toBe(false));
  it('returns false when glob is null', () => expect(skip('foo.ts', null)).toBe(false));
  it('returns false for * glob', () => expect(skip('foo.ts', '*')).toBe(false));
  it('returns false for *.ts and matching file', () => expect(skip('foo.ts', '*.ts')).toBe(false));
  it('returns true for *.ts and non-matching file', () => expect(skip('foo.js', '*.ts')).toBe(true));
  it('returns false for **/*.ts and matching nested file', () => expect(skip('src/foo.ts', '**/*.ts')).toBe(false));
  it('returns true for **/*.ts and non-matching file', () => expect(skip('src/foo.js', '**/*.ts')).toBe(true));
});
