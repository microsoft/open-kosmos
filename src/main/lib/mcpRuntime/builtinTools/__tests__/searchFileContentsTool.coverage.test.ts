/**
 * Additional coverage tests for SearchFileContentsTool
 * Targets uncovered branches: regex patterns, glob filtering, directory traversal,
 * file size limit, binary detection, context lines, multi-path, and warnings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';

import { SearchFileContentsTool } from '../searchFileContentsTool';

// ── Helpers ───────────────────────────────────────────────────────────────────
async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-cov-'));
}

async function cleanTmpDir(dir: string) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ── validateArgs ──────────────────────────────────────────────────────────────
describe('SearchFileContentsTool — validateArgs', () => {
  it('throws when args is null', async () => {
    await expect(SearchFileContentsTool.execute(null as any)).rejects.toThrow();
  });

  it('throws when patterns is not an array', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: 'x' as any, workspaceRoot: '/tmp' })).rejects.toThrow(/patterns/);
  });

  it('throws when patterns is empty after dedup', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['', '  '], workspaceRoot: '/tmp' })).rejects.toThrow();
  });

  it('throws when workspaceRoot is missing', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['x'], workspaceRoot: '' })).rejects.toThrow(/workspaceRoot/);
  });

  it('throws when context is a negative float', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['x'], workspaceRoot: '/tmp', context: -0.5 })).rejects.toThrow();
  });

  it('deduplicates duplicate patterns', async () => {
    const tmpDir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello world');
      const result = await SearchFileContentsTool.execute({
        patterns: ['hello', 'hello', 'hello'],
        workspaceRoot: tmpDir,
      });
      // Three duplicates → one normalized pattern
      expect(result.patterns).toHaveLength(1);
    } finally {
      await cleanTmpDir(tmpDir);
    }
  });

  it('errors field mentions removed entries when duplicates removed', async () => {
    const tmpDir = await makeTmpDir();
    try {
      await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
      const result = await SearchFileContentsTool.execute({
        patterns: ['hello', 'hello'],
        workspaceRoot: tmpDir,
      });
      // removed entries warning
      expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('invalid or duplicate')]));
    } finally {
      await cleanTmpDir(tmpDir);
    }
  });
});

// ── regex pattern ─────────────────────────────────────────────────────────────
describe('SearchFileContentsTool — regex patterns', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('matches lines using /regex/ syntax', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'HELLO world\nfoo bar\nHello again');
    const result = await SearchFileContentsTool.execute({
      patterns: ['/hello/'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].results).toHaveLength(1);
    expect(result.patternResults[0].totalMatches).toBeGreaterThanOrEqual(2);
  });

  it('falls back to literal for invalid regex', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), '/broken[/ text');
    const result = await SearchFileContentsTool.execute({
      patterns: ['/broken[/'],
      workspaceRoot: tmpDir,
    });
    // Should still succeed (treated as literal)
    expect(result.success).toBe(true);
  });
});

// ── literal pattern ───────────────────────────────────────────────────────────
describe('SearchFileContentsTool — literal patterns', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('case-insensitive literal match', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'Hello World\nfoo bar');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].totalMatches).toBe(1);
  });

  it('returns empty results when no match found', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'foo bar baz');
    const result = await SearchFileContentsTool.execute({
      patterns: ['zzznomatch'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].results).toHaveLength(0);
  });
});

// ── fileGlob filtering ────────────────────────────────────────────────────────
describe('SearchFileContentsTool — fileGlob filtering', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('*.ts glob only searches .ts files', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'hello typescript');
    await fs.writeFile(path.join(tmpDir, 'file.js'), 'hello javascript');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      fileGlob: '*.ts',
    });
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.some(f => f.endsWith('.ts'))).toBe(true);
    expect(files.some(f => f.endsWith('.js'))).toBe(false);
  });

  it('* glob matches all files', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'hello');
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'hello');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      fileGlob: '*',
    });
    expect(result.patternResults[0].results.length).toBeGreaterThanOrEqual(2);
  });

  it('unsupported glob is ignored with a warning', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'hello');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      fileGlob: '{foo,bar}',
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('Unsupported fileGlob')]));
  });
});

// ── context lines ─────────────────────────────────────────────────────────────
describe('SearchFileContentsTool — context lines', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('context=0 returns only the matched line', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'before\nmatch\nafter');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      context: 0,
    });
    const block = result.patternResults[0].results[0].matches[0];
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]).toContain('>');
  });

  it('context=2 includes 2 lines before and after', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'a\nb\nmatch\nd\ne');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      context: 2,
    });
    const block = result.patternResults[0].results[0].matches[0];
    // Should include lines a,b,match,d,e = 5 lines
    expect(block.lines.length).toBe(5);
  });

  it('context > 2 is capped and warns', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'a\nb\nmatch\nd\ne');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      context: 10,
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('capped')]));
  });
});

// ── binary detection ──────────────────────────────────────────────────────────
describe('SearchFileContentsTool — binary file detection', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('skips files containing null bytes', async () => {
    const binaryContent = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64]);
    await fs.writeFile(path.join(tmpDir, 'binary.bin'), binaryContent);
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].results).toHaveLength(0);
  });
});

// ── specific path targeting ───────────────────────────────────────────────────
describe('SearchFileContentsTool — path targeting', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('searches only the specified path', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'hello');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      path: 'a.txt',
    });
    expect(result.patternResults[0].results).toHaveLength(1);
    expect(result.patternResults[0].results[0].file).toContain('a.txt');
  });

  it('paths[] takes priority over path', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'hello');
    await fs.writeFile(path.join(tmpDir, 'c.txt'), 'no match here');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      path: 'c.txt',
      paths: ['a.txt', 'b.txt'],
    });
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.some(f => f.includes('a.txt') || f.includes('b.txt'))).toBe(true);
    expect(files.every(f => !f.includes('c.txt'))).toBe(true);
    // "path ignored" warning
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('path ignored')]));
  });

  it('warns and skips path outside workspace', async () => {
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      path: '../etc/passwd',
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('outside workspace')]));
  });

  it('warns for non-existent path', async () => {
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      path: 'nonexistent.txt',
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('not found')]));
  });
});

// ── multiple patterns ─────────────────────────────────────────────────────────
describe('SearchFileContentsTool — multiple patterns', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('returns results for each pattern separately', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'foo bar baz\nhello world');
    const result = await SearchFileContentsTool.execute({
      patterns: ['foo', 'hello'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults).toHaveLength(2);
    expect(result.patternResults[0].pattern).toBe('foo');
    expect(result.patternResults[1].pattern).toBe('hello');
  });
});

// ── getDefinition ─────────────────────────────────────────────────────────────
describe('SearchFileContentsTool — getDefinition', () => {
  it('returns correct name', () => {
    const def = SearchFileContentsTool.getDefinition();
    expect(def.name).toBe('search_file_contents');
  });

  it('requires description, patterns, workspaceRoot', () => {
    const req = SearchFileContentsTool.getDefinition().inputSchema.required;
    expect(req).toContain('description');
    expect(req).toContain('patterns');
    expect(req).toContain('workspaceRoot');
  });
});

// ── subdirectory recursion ────────────────────────────────────────────────────
describe('SearchFileContentsTool — subdirectory traversal', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await makeTmpDir(); });
  afterEach(async () => { await cleanTmpDir(tmpDir); });

  it('recursively finds files in subdirectories', async () => {
    const subDir = path.join(tmpDir, 'src');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'code.ts'), 'export const hello = "world"');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].totalMatches).toBeGreaterThan(0);
  });

  it('skips node_modules directories', async () => {
    const nmDir = path.join(tmpDir, 'node_modules', 'pkg');
    await fs.mkdir(nmDir, { recursive: true });
    await fs.writeFile(path.join(nmDir, 'index.js'), 'hello from node_modules');
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].results).toHaveLength(0);
  });
});

// ── isSupportedSimpleGlob ─────────────────────────────────────────────────────
describe('SearchFileContentsTool — isSupportedSimpleGlob (private)', () => {
  const check = (g: string) => (SearchFileContentsTool as any).isSupportedSimpleGlob(g);

  it('supports *', () => expect(check('*')).toBe(true));
  it('supports *.ts', () => expect(check('*.ts')).toBe(true));
  it('supports **/*.ts', () => expect(check('**/*.ts')).toBe(true));
  it('rejects {a,b}', () => expect(check('{a,b}')).toBe(false));
  it('rejects **', () => expect(check('**')).toBe(false));
});

// ── buildMatcher ──────────────────────────────────────────────────────────────
describe('SearchFileContentsTool — buildMatcher (private)', () => {
  const build = (p: string) => (SearchFileContentsTool as any).buildMatcher(p);

  it('treats /pattern/ as regex', () => {
    const m = build('/hello/');
    expect(m.isRegex).toBe(true);
    expect(m.regex).toBeInstanceOf(RegExp);
  });

  it('treats plain text as literal', () => {
    const m = build('hello world');
    expect(m.isRegex).toBe(false);
    expect(m.literal).toBe('hello world');
  });

  it('falls back to literal for invalid regex', () => {
    const m = build('/[invalid/');
    expect(m.isRegex).toBe(false);
    expect(m.literal).toBeTruthy();
  });
});
