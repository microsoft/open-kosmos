// @ts-nocheck
/**
 * Tests for WriteFileTool, ReadFileTool, SearchFilesTool,
 * SearchFileContentsTool, FetchWebContentTool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

vi.mock('../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn((n: string) => (n === 'userData' ? '/tmp/openkosmos-test' : os.tmpdir())) },
}));

// ─────────────────────────────────────────────────────────────
// WriteFileTool
// ─────────────────────────────────────────────────────────────
describe('WriteFileTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-write-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('overwrites a new file', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const filePath = path.join(tmpDir, 'new.txt');
    const result = await WriteFileTool.execute({ filePath, content: 'hello' });
    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('hello');
  });

  it('overwrites existing file by default', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const filePath = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'old');
    const result = await WriteFileTool.execute({ filePath, content: 'new' });
    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('new');
  });

  it('appends to file in append mode', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const filePath = path.join(tmpDir, 'append.txt');
    await fs.writeFile(filePath, 'line1');
    const result = await WriteFileTool.execute({ filePath, content: '\nline2', mode: 'append' });
    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('line1');
    expect(content).toContain('line2');
  });

  it('prepends to file in prepend mode', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const filePath = path.join(tmpDir, 'prepend.txt');
    await fs.writeFile(filePath, 'world');
    const result = await WriteFileTool.execute({ filePath, content: 'hello\n', mode: 'prepend' });
    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content.startsWith('hello')).toBe(true);
  });

  it('returns error for missing filePath', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const result = await WriteFileTool.execute({ filePath: '', content: 'x' });
    expect(result.success).toBe(false);
  });

  it('returns error for null content', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const result = await WriteFileTool.execute({ filePath: path.join(tmpDir, 'f.txt'), content: null as any });
    expect(result.success).toBe(false);
  });

  it('returns error for restricted path', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const result = await WriteFileTool.execute({ filePath: '/etc/shadow', content: 'x' });
    expect(result.success).toBe(false);
  });

  it('returns error for directory traversal', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const result = await WriteFileTool.execute({ filePath: '../etc/evil.txt', content: 'x' });
    expect(result.success).toBe(false);
  });

  it('returns error for invalid mode', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    const result = await WriteFileTool.execute({ filePath: path.join(tmpDir, 'f.txt'), content: 'x', mode: 'invalid_mode' as any });
    expect(result.success).toBe(false);
  });

  it('getDefinition returns write_file name', async () => {
    const { WriteFileTool } = await import('../writeFileTool');
    expect(WriteFileTool.getDefinition().name).toBe('write_file');
  });
});

// ─────────────────────────────────────────────────────────────
// ReadFileTool
// ─────────────────────────────────────────────────────────────
describe('ReadFileTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-read-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads a simple file', async () => {
    const { ReadFileTool } = await import('../readFileTool');
    const filePath = path.join(tmpDir, 'hello.txt');
    await fs.writeFile(filePath, 'line1\nline2\nline3');
    const result = await ReadFileTool.execute({ filePath });
    expect(result.content).toContain('line1');
    expect(result.startLine).toBeGreaterThanOrEqual(1);
  });

  it('throws for missing file', async () => {
    const { ReadFileTool } = await import('../readFileTool');
    await expect(ReadFileTool.execute({ filePath: path.join(tmpDir, 'nonexistent.txt') })).rejects.toThrow();
  });

  it('throws for empty filePath', async () => {
    const { ReadFileTool } = await import('../readFileTool');
    await expect(ReadFileTool.execute({ filePath: '' })).rejects.toThrow();
  });

  it('reads with startLine and endLine', async () => {
    const { ReadFileTool } = await import('../readFileTool');
    const filePath = path.join(tmpDir, 'multiline.txt');
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n');
    await fs.writeFile(filePath, lines);
    const result = await ReadFileTool.execute({ filePath, startLine: 2, endLine: 4 });
    expect(result.content).toContain('line2');
    expect(result.startLine).toBe(2);
  });

  it('getDefinition returns read_file name', async () => {
    const { ReadFileTool } = await import('../readFileTool');
    expect(ReadFileTool.getDefinition().name).toBe('read_file');
  });
});

// ─────────────────────────────────────────────────────────────
// SearchFilesTool
// ─────────────────────────────────────────────────────────────
describe('SearchFilesTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-searchfiles-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when pattern is empty', async () => {
    const { SearchFilesTool } = await import('../searchFilesTool');
    await expect(SearchFilesTool.execute({ pattern: '', workspaceRoot: tmpDir })).rejects.toThrow();
  });

  it('throws when workspaceRoot is empty', async () => {
    const { SearchFilesTool } = await import('../searchFilesTool');
    await expect(SearchFilesTool.execute({ pattern: '*.ts', workspaceRoot: '' })).rejects.toThrow();
  });

  it('throws when workspaceRoot does not exist', async () => {
    const { SearchFilesTool } = await import('../searchFilesTool');
    await expect(SearchFilesTool.execute({ pattern: '*.ts', workspaceRoot: '/nonexistent/path/xyz' })).rejects.toThrow();
  });

  it('finds files matching pattern', async () => {
    const { SearchFilesTool } = await import('../searchFilesTool');
    await fs.writeFile(path.join(tmpDir, 'hello.ts'), 'export {}');
    await fs.writeFile(path.join(tmpDir, 'world.js'), 'module.exports = {}');
    const result = await SearchFilesTool.execute({ pattern: '*.ts', workspaceRoot: tmpDir });
    expect(result.success).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.results.some(r => r.path.endsWith('.ts'))).toBe(true);
  });

  it('getDefinition returns search_files name', async () => {
    const { SearchFilesTool } = await import('../searchFilesTool');
    expect(SearchFilesTool.getDefinition().name).toBe('search_files');
  });
});

// ─────────────────────────────────────────────────────────────
// SearchFileContentsTool
// ─────────────────────────────────────────────────────────────
describe('SearchFileContentsTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-searchcontents-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('throws when patterns is empty array', async () => {
    const { SearchFileContentsTool } = await import('../searchFileContentsTool');
    await expect(SearchFileContentsTool.execute({ patterns: [], workspaceRoot: tmpDir })).rejects.toThrow();
  });

  it('throws when workspaceRoot is empty', async () => {
    const { SearchFileContentsTool } = await import('../searchFileContentsTool');
    await expect(SearchFileContentsTool.execute({ patterns: ['hello'], workspaceRoot: '' })).rejects.toThrow();
  });

  it('finds content in files', async () => {
    const { SearchFileContentsTool } = await import('../searchFileContentsTool');
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world\nfoo bar');
    const result = await SearchFileContentsTool.execute({ patterns: ['hello'], workspaceRoot: tmpDir });
    expect(result.success).toBe(true);
    expect(result.patternResults.length).toBeGreaterThanOrEqual(1);
    expect(result.patternResults[0].totalMatches).toBeGreaterThanOrEqual(1);
  });

  it('returns no matches for unmatched pattern', async () => {
    const { SearchFileContentsTool } = await import('../searchFileContentsTool');
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world');
    const result = await SearchFileContentsTool.execute({ patterns: ['xyzzy_not_found_xyz'], workspaceRoot: tmpDir });
    expect(result.success).toBe(true);
    expect(result.patternResults[0].totalMatches).toBe(0);
  });

  it('getDefinition returns search_file_contents name', async () => {
    const { SearchFileContentsTool } = await import('../searchFileContentsTool');
    expect(SearchFileContentsTool.getDefinition().name).toBe('search_file_contents');
  });
});

// ─────────────────────────────────────────────────────────────
// FetchWebContentTool — validation branch (no real network)
// ─────────────────────────────────────────────────────────────
describe('FetchWebContentTool — argument validation', () => {
  it('throws for missing urls', async () => {
    const { FetchWebContentTool } = await import('../fetchWebContentTool');
    await expect(FetchWebContentTool.execute({ urls: [] })).rejects.toThrow();
  });

  it('throws for invalid URL in list', async () => {
    const { FetchWebContentTool } = await import('../fetchWebContentTool');
    await expect(FetchWebContentTool.execute({ urls: ['not-a-url'] })).rejects.toThrow();
  });

  it('getDefinition returns fetch_web_content name', async () => {
    const { FetchWebContentTool } = await import('../fetchWebContentTool');
    expect(FetchWebContentTool.getDefinition().name).toBe('fetch_web_content');
  });
});
