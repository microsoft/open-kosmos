/**
 * Tests for getCurrentDateTimeTool, moveFileTool, appendToFileTool,
 * createFileTool, downloadFileTool, readFileTool, writeFileTool and
 * other simple builtin tools without existing test files.
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
// GetCurrentDateTimeTool
// ─────────────────────────────────────────────────────────────
describe('GetCurrentDateTimeTool', () => {
  it('execute returns local_datetime and local_timezone', async () => {
    const { GetCurrentDateTimeTool } = await import('../getCurrentDateTimeTool');
    const result = await GetCurrentDateTimeTool.execute();
    expect(result.local_datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(result.local_timezone).toMatch(/UTC[+-]\d{2}:\d{2}/);
  });

  it('getDefinition returns correct tool name', async () => {
    const { GetCurrentDateTimeTool } = await import('../getCurrentDateTimeTool');
    expect(GetCurrentDateTimeTool.getDefinition().name).toBe('get_current_datetime');
  });
});

// ─────────────────────────────────────────────────────────────
// AppendToFileTool
// ─────────────────────────────────────────────────────────────
describe('AppendToFileTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-test-append-'));
    const { AppendToFileTool } = await import('../appendToFileTool');
    AppendToFileTool.clearAllSessions();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file and appends content', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const filePath = path.join(tmpDir, 'test.txt');
    const result = await AppendToFileTool.execute({ filePath, content: 'hello' });
    expect(result.success).toBe(true);
    expect(result.chunkNumber).toBe(1);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('hello');
  });

  it('appends to existing file', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const filePath = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'initial');
    const result = await AppendToFileTool.execute({ filePath, content: ' appended' });
    expect(result.success).toBe(true);
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toContain('initial');
    expect(content).toContain('appended');
  });

  it('returns error when filePath missing', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const result = await AppendToFileTool.execute({ filePath: '', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error when content is null', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const result = await AppendToFileTool.execute({ filePath: path.join(tmpDir, 'f.txt'), content: null as any });
    expect(result.success).toBe(false);
  });

  it('returns error for restricted system directory', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const result = await AppendToFileTool.execute({ filePath: '/etc/test.txt', content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('restricted');
  });

  it('returns error when file does not exist and createIfNotExists=false', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const result = await AppendToFileTool.execute({
      filePath: path.join(tmpDir, 'nonexistent.txt'),
      content: 'x',
      createIfNotExists: false,
    });
    expect(result.success).toBe(false);
  });

  it('addNewlineBefore inserts newline before content for existing file', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const filePath = path.join(tmpDir, 'newline.txt');
    await fs.writeFile(filePath, 'line1');
    await AppendToFileTool.execute({ filePath, content: 'line2', addNewlineBefore: true, addNewlineAfter: false });
    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('line1\nline2');
  });

  it('isLastChunk clears session tracking', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const filePath = path.join(tmpDir, 'chunked.txt');
    await AppendToFileTool.execute({ filePath, content: 'part1', isLastChunk: false });
    await AppendToFileTool.execute({ filePath, content: 'part2', isLastChunk: true });
    const session = AppendToFileTool.getSessionInfo(filePath);
    expect(session).toBeNull();
  });

  it('getDefinition returns correct tool name', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    expect(AppendToFileTool.getDefinition().name).toBe('append_to_file');
  });

  it('session is reused within timeout window', async () => {
    const { AppendToFileTool } = await import('../appendToFileTool');
    const filePath = path.join(tmpDir, 'session.txt');
    await AppendToFileTool.execute({ filePath, content: 'a' });
    await AppendToFileTool.execute({ filePath, content: 'b' });
    const session = AppendToFileTool.getSessionInfo(filePath);
    expect(session?.chunkCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────
// CreateFileTool
// ─────────────────────────────────────────────────────────────
describe('CreateFileTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-test-create-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates a new file', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const filePath = path.join(tmpDir, 'new.txt');
    const result = await CreateFileTool.execute({ filePath, content: 'hello world' });
    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
  });

  it('overwrites an existing file by default', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const filePath = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'old content');
    const result = await CreateFileTool.execute({ filePath, content: 'new content' });
    expect(result.success).toBe(true);
    expect(result.created).toBe(false);
  });

  it('returns error when overwrite=false and file exists', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const filePath = path.join(tmpDir, 'locked.txt');
    await fs.writeFile(filePath, 'locked');
    const result = await CreateFileTool.execute({ filePath, content: 'new', overwrite: false });
    expect(result.success).toBe(false);
  });

  it('returns error for missing filePath', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const result = await CreateFileTool.execute({ filePath: '', content: 'x' });
    expect(result.success).toBe(false);
  });

  it('returns error for disallowed extension', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const result = await CreateFileTool.execute({ filePath: path.join(tmpDir, 'file.exe'), content: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('extension');
  });

  it('validates JSON content when validateJson=true', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const filePath = path.join(tmpDir, 'data.json');
    const result = await CreateFileTool.execute({ filePath, content: '{"key": "value"}', validateJson: true });
    expect(result.success).toBe(true);
    expect(result.contentValid).toBe(true);
  });

  it('returns error for invalid JSON when validateJson=true', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const filePath = path.join(tmpDir, 'bad.json');
    const result = await CreateFileTool.execute({ filePath, content: '{invalid json}', validateJson: true });
    expect(result.success).toBe(false);
    expect(result.contentValid).toBe(false);
  });

  it('returns error for restricted system directory', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const result = await CreateFileTool.execute({ filePath: '/etc/test.txt', content: 'x' });
    expect(result.success).toBe(false);
  });

  it('returns error for directory traversal', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    const result = await CreateFileTool.execute({ filePath: '../test.txt', content: 'x' });
    expect(result.success).toBe(false);
  });

  it('getDefinition returns create_file name', async () => {
    const { CreateFileTool } = await import('../createFileTool');
    expect(CreateFileTool.getDefinition().name).toBe('create_file');
  });
});

// ─────────────────────────────────────────────────────────────
// MoveFileTool
// ─────────────────────────────────────────────────────────────
describe('MoveFileTool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openkosmos-test-move-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('moves a file', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    await fs.writeFile(src, 'content');
    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dst });
    expect(result.success).toBe(true);
    expect(result.operation).toBe('move');
    await expect(fs.access(dst)).resolves.toBeUndefined();
    await expect(fs.access(src)).rejects.toThrow();
  });

  it('copies a file when copy=true', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    await fs.writeFile(src, 'content');
    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dst, copy: true });
    expect(result.success).toBe(true);
    expect(result.operation).toBe('copy');
    await expect(fs.access(src)).resolves.toBeUndefined(); // source still exists
  });

  it('throws when source does not exist', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    await expect(MoveFileTool.execute({
      sourcePath: path.join(tmpDir, 'nonexistent.txt'),
      destinationPath: path.join(tmpDir, 'dst.txt'),
    })).rejects.toThrow();
  });

  it('throws when sourcePath is not absolute', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    await expect(MoveFileTool.execute({
      sourcePath: 'relative/path.txt',
      destinationPath: path.join(tmpDir, 'dst.txt'),
    })).rejects.toThrow();
  });

  it('throws when destinationPath is not absolute', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    const src = path.join(tmpDir, 'src.txt');
    await fs.writeFile(src, 'content');
    await expect(MoveFileTool.execute({
      sourcePath: src,
      destinationPath: 'relative.txt',
    })).rejects.toThrow();
  });

  it('throws when destination exists and overwrite=false', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    const src = path.join(tmpDir, 'src.txt');
    const dst = path.join(tmpDir, 'dst.txt');
    await fs.writeFile(src, 'src-content');
    await fs.writeFile(dst, 'existing');
    await expect(MoveFileTool.execute({ sourcePath: src, destinationPath: dst, overwrite: false })).rejects.toThrow();
  });

  it('destination is a directory: places file inside it', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    const src = path.join(tmpDir, 'src.txt');
    const dstDir = path.join(tmpDir, 'subdir');
    await fs.writeFile(src, 'content');
    await fs.mkdir(dstDir);
    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dstDir });
    expect(result.success).toBe(true);
    expect(result.destinationPath).toBe(path.join(dstDir, 'src.txt'));
  });

  it('getDefinition returns move_file name', async () => {
    const { MoveFileTool } = await import('../moveFileTool');
    expect(MoveFileTool.getDefinition().name).toBe('move_file');
  });
});

// ─────────────────────────────────────────────────────────────
// DownloadFileTool — validation branch (no real network)
// ─────────────────────────────────────────────────────────────
describe('DownloadFileTool — argument validation', () => {
  it('throws for invalid URL', async () => {
    const { DownloadFileTool } = await import('../downloadFileTool');
    await expect(DownloadFileTool.execute({ url: 'not-a-url', filename: 'test.txt' })).rejects.toThrow();
  });

  it('throws for non-http URL', async () => {
    const { DownloadFileTool } = await import('../downloadFileTool');
    await expect(DownloadFileTool.execute({ url: 'ftp://example.com/file.txt', filename: 'test.txt' })).rejects.toThrow();
  });

  it('throws for filename with path separators', async () => {
    const { DownloadFileTool } = await import('../downloadFileTool');
    await expect(DownloadFileTool.execute({ url: 'https://example.com/file.txt', filename: '../evil.txt' })).rejects.toThrow();
  });

  it('getDefinition returns download_file name', async () => {
    const { DownloadFileTool } = await import('../downloadFileTool');
    expect(DownloadFileTool.getDefinition().name).toBe('download_file');
  });
});
