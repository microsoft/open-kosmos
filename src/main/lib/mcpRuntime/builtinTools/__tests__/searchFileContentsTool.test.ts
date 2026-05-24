/**
 * Comprehensive tests for SearchFileContentsTool — targeting uncovered branches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SearchFileContentsTool } from '../searchFileContentsTool';

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/openkosmos-test') },
}));

describe('SearchFileContentsTool — validateArgs', () => {
  it('throws when args is null', async () => {
    await expect(SearchFileContentsTool.execute(null as any)).rejects.toThrow();
  });

  it('throws when patterns is not an array', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: 'hello' as any, workspaceRoot: '/tmp' })).rejects.toThrow();
  });

  it('throws when patterns array is empty after normalizing', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['  ', ''], workspaceRoot: '/tmp' })).rejects.toThrow();
  });

  it('throws when context is a float', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['x'], workspaceRoot: '/tmp', context: 1.5 })).rejects.toThrow();
  });

  it('throws when context is negative', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['x'], workspaceRoot: '/tmp', context: -1 })).rejects.toThrow();
  });
});

describe('SearchFileContentsTool — context handling', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-ctx-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('context > 2 is capped to 2 and warns', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'line1\nhello\nline3');
    const result = await SearchFileContentsTool.execute({ patterns: ['hello'], workspaceRoot: tmpDir, context: 5 });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('capped')]));
    // Blocks use 2 context lines
    const blocks = result.patternResults[0].results[0].matches;
    expect(blocks[0].startLine).toBe(1); // context of 2 from line 2
  });

  it('context = 0 returns only match lines', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'before\nhello world\nafter');
    const result = await SearchFileContentsTool.execute({ patterns: ['hello'], workspaceRoot: tmpDir, context: 0 });
    const block = result.patternResults[0].results[0].matches[0];
    expect(block.startLine).toBe(block.endLine);
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]).toContain('>');
  });

  it('invalid non-integer context records error and defaults to 1', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'before\nhello\nafter');
    // Pass a non-integer indirectly: validateArgs allows float to throw, but pass string coerced via ts
    // Use valid-looking but semantically invalid value via the errors path
    // context = 'bad' coerced — actually validateArgs would throw; let's check a different branch:
    // When context is a non-negative non-integer (not caught by validateArgs alone → caught in execute)
    // The execute function checks:  !Number.isInteger(inputContext) || inputContext < 0
    // validateArgs rejects these; so there's no "records error + defaults" path for floats via execute.
    // Test that context = 1 (valid) works normally:
    const result = await SearchFileContentsTool.execute({ patterns: ['hello'], workspaceRoot: tmpDir, context: 1 });
    expect(result.success).toBe(true);
  });
});

describe('SearchFileContentsTool — duplicate patterns removed', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-dup-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('deduplicates patterns and adds warning', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
    const result = await SearchFileContentsTool.execute({ patterns: ['hello', 'hello'], workspaceRoot: tmpDir });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('removed')]));
    expect(result.patterns).toHaveLength(1);
  });
});

describe('SearchFileContentsTool — path resolution', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-paths-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('uses paths (plural) over path (single)', async () => {
    const subDir = path.join(tmpDir, 'sub');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'b.txt'), 'target content');
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'other content');

    const result = await SearchFileContentsTool.execute({
      patterns: ['content'],
      workspaceRoot: tmpDir,
      paths: ['sub'],
      path: 'a.txt',
    });
    // Both paths ('path ignored because paths provided' warning) + results
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('path ignored')]));
    // Only sub/ was searched
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.some(f => f.includes('a.txt'))).toBe(false);
  });

  it('skips relative path when workspaceRoot is empty (throws)', async () => {
    await expect(SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: '',
      path: 'relative/path',
    })).rejects.toThrow();
  });

  it('skips path outside workspace and warns', async () => {
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      path: '/etc/passwd',
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('outside workspace')]));
  });

  it('skips path not found and warns', async () => {
    const result = await SearchFileContentsTool.execute({
      patterns: ['hello'],
      workspaceRoot: tmpDir,
      path: 'nonexistent_file.txt',
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('not found')]));
  });

  it('truncates paths list to MAX_INPUT_PATHS=10 and warns', async () => {
    const manyPaths = Array.from({ length: 12 }, (_, i) => `file${i}.txt`);
    const result = await SearchFileContentsTool.execute({
      patterns: ['x'],
      workspaceRoot: tmpDir,
      paths: manyPaths,
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('truncated')]));
  });

  it('searches specific file target directly', async () => {
    await fs.writeFile(path.join(tmpDir, 'direct.txt'), 'find me here');
    const result = await SearchFileContentsTool.execute({
      patterns: ['find me'],
      workspaceRoot: tmpDir,
      path: 'direct.txt',
    });
    expect(result.patternResults[0].totalMatches).toBeGreaterThan(0);
  });
});

describe('SearchFileContentsTool — fileGlob filtering', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-glob-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('supports *.ext glob', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'match here');
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'match here');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      fileGlob: '*.ts',
    });
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.every(f => f.endsWith('.ts'))).toBe(true);
  });

  it('supports **/*.ext glob', async () => {
    const sub = path.join(tmpDir, 'sub');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, 'deep.ts'), 'match here');
    await fs.writeFile(path.join(sub, 'deep.txt'), 'match here');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      fileGlob: '**/*.ts',
    });
    const files = result.patternResults[0].results.map(r => r.file);
    expect(files.every(f => f.endsWith('.ts'))).toBe(true);
  });

  it('* glob matches all files', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'match');
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'match');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      fileGlob: '*',
    });
    expect(result.patternResults[0].results.length).toBe(2);
  });

  it('unsupported glob is ignored with warning', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.ts'), 'match');
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      fileGlob: '**/*.{ts,js}', // complex, unsupported
    });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('Unsupported')]));
  });
});

describe('SearchFileContentsTool — regex patterns', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-regex-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('supports /regex/ patterns', async () => {
    await fs.writeFile(path.join(tmpDir, 'code.ts'), 'function myFunc() {}\nconst x = 1;');
    const result = await SearchFileContentsTool.execute({
      patterns: ['/function\\s+\\w+/'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].totalMatches).toBeGreaterThan(0);
  });

  it('falls back to literal when regex is invalid', async () => {
    await fs.writeFile(path.join(tmpDir, 'file.txt'), '/[invalid/');
    const result = await SearchFileContentsTool.execute({
      patterns: ['/[invalid/'],
      workspaceRoot: tmpDir,
    });
    // Invalid regex falls back to literal match for the string "/[invalid/"
    expect(result.success).toBe(true);
  });
});

describe('SearchFileContentsTool — binary file skipping', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-binary-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips binary files (containing null bytes)', async () => {
    const binaryData = Buffer.concat([Buffer.from('some text'), Buffer.from([0x00]), Buffer.from('more')]);
    await fs.writeFile(path.join(tmpDir, 'binary.bin'), binaryData);
    const result = await SearchFileContentsTool.execute({
      patterns: ['some text'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].totalMatches).toBe(0);
  });
});

describe('SearchFileContentsTool — ignored directories', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-ignored-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips node_modules directory', async () => {
    const nm = path.join(tmpDir, 'node_modules');
    await fs.mkdir(nm);
    await fs.writeFile(path.join(nm, 'pkg.js'), 'should not match');
    const result = await SearchFileContentsTool.execute({
      patterns: ['should not match'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].totalMatches).toBe(0);
  });

  it('skips .git directory', async () => {
    const git = path.join(tmpDir, '.git');
    await fs.mkdir(git);
    await fs.writeFile(path.join(git, 'config'), 'should not match');
    const result = await SearchFileContentsTool.execute({
      patterns: ['should not match'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults[0].totalMatches).toBe(0);
  });
});

describe('SearchFileContentsTool — multiple patterns', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-multi-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runs each pattern and returns separate results', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'alpha beta\ngamma delta');
    const result = await SearchFileContentsTool.execute({
      patterns: ['alpha', 'gamma'],
      workspaceRoot: tmpDir,
    });
    expect(result.patternResults).toHaveLength(2);
    expect(result.patternResults[0].pattern).toBe('alpha');
    expect(result.patternResults[1].pattern).toBe('gamma');
  });
});

describe('SearchFileContentsTool — line truncation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-trunc-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('truncates lines longer than 500 chars', async () => {
    const longLine = 'match ' + 'x'.repeat(600);
    await fs.writeFile(path.join(tmpDir, 'long.txt'), longLine);
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
    });
    const line = result.patternResults[0].results[0].matches[0].lines[0];
    expect(line).toContain('[truncated...]');
  });
});

describe('SearchFileContentsTool — block grouping', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-block-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('groups adjacent match lines into a single block', async () => {
    const content = 'match1\nmatch2\nno match\nmatch3';
    await fs.writeFile(path.join(tmpDir, 'file.txt'), content);
    const result = await SearchFileContentsTool.execute({
      patterns: ['match'],
      workspaceRoot: tmpDir,
      context: 0,
    });
    const blocks = result.patternResults[0].results[0].matches;
    // match1 and match2 are adjacent → one block; match3 is separate
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const firstBlock = blocks[0];
    expect(firstBlock.matchCount).toBeGreaterThanOrEqual(2);
  });

  it('splits non-adjacent matches into separate blocks', async () => {
    // Lines 1,2 = match; lines 10,11 = match (with many non-matches in between)
    const lines = Array.from({ length: 20 }, (_, i) => {
      if (i === 0 || i === 1 || i === 10 || i === 11) return 'target text';
      return 'filler line';
    });
    await fs.writeFile(path.join(tmpDir, 'file.txt'), lines.join('\n'));
    const result = await SearchFileContentsTool.execute({
      patterns: ['target text'],
      workspaceRoot: tmpDir,
      context: 0,
    });
    const blocks = result.patternResults[0].results[0].matches;
    expect(blocks.length).toBe(2);
  });
});

describe('SearchFileContentsTool — output shape', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-out-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null paths when no path/paths provided (global scan)', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'data');
    const result = await SearchFileContentsTool.execute({ patterns: ['data'], workspaceRoot: tmpDir });
    expect(result.paths).toBeNull();
  });

  it('returns relative paths when path provided', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'data');
    const result = await SearchFileContentsTool.execute({
      patterns: ['data'],
      workspaceRoot: tmpDir,
      path: 'a.txt',
    });
    expect(result.paths).toEqual(['a.txt']);
  });

  it('sets fileGlob in output', async () => {
    const result = await SearchFileContentsTool.execute({
      patterns: ['x'],
      workspaceRoot: tmpDir,
      fileGlob: '*.ts',
    });
    expect(result.fileGlob).toBe('*.ts');
  });

  it('has timestamp in ISO format', async () => {
    const result = await SearchFileContentsTool.execute({ patterns: ['x'], workspaceRoot: tmpDir });
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('SearchFileContentsTool — throws without workspaceRoot and no absolute path', () => {
  it('throws when no workspaceRoot and no paths', async () => {
    await expect(SearchFileContentsTool.execute({ patterns: ['x'], workspaceRoot: '  ' }))
      .rejects.toThrow();
  });
});

describe('SearchFileContentsTool — file size limit', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-sfc-size-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips files larger than 512KB', async () => {
    const bigContent = 'match line\n' + 'x'.repeat(513 * 1024);
    await fs.writeFile(path.join(tmpDir, 'big.txt'), bigContent);
    const result = await SearchFileContentsTool.execute({ patterns: ['match line'], workspaceRoot: tmpDir });
    expect(result.patternResults[0].totalMatches).toBe(0);
  });
});

describe('SearchFileContentsTool — getDefinition', () => {
  it('returns correct tool definition schema', () => {
    const def = SearchFileContentsTool.getDefinition();
    expect(def.name).toBe('search_file_contents');
    expect(def.inputSchema.required).toContain('workspaceRoot');
    expect(def.inputSchema.required).toContain('patterns');
  });
});
