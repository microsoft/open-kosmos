import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MoveFileTool } from '../moveFileTool';

describe('MoveFileTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-file-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ========== getDefinition ==========

  it('getDefinition returns correct schema', () => {
    const def = MoveFileTool.getDefinition();
    expect(def.name).toBe('move_file');
    const props = (def.inputSchema as any).properties;
    expect(props.sourcePath).toBeDefined();
    expect(props.destinationPath).toBeDefined();
    expect(props.copy).toBeDefined();
    expect(props.overwrite).toBeDefined();
    expect((def.inputSchema as any).required).toContain('sourcePath');
    expect((def.inputSchema as any).required).toContain('destinationPath');
  });

  // ========== Validation ==========

  it('throws if sourcePath is empty', async () => {
    await expect(
      MoveFileTool.execute({ sourcePath: '', destinationPath: '/tmp/dest.txt' })
    ).rejects.toThrow('sourcePath is required');
  });

  it('throws if destinationPath is empty', async () => {
    const src = path.join(tmpDir, 'src.txt');
    fs.writeFileSync(src, 'hello');
    await expect(
      MoveFileTool.execute({ sourcePath: src, destinationPath: '' })
    ).rejects.toThrow('destinationPath is required');
  });

  it('throws if sourcePath is not absolute', async () => {
    await expect(
      MoveFileTool.execute({ sourcePath: 'relative/path.txt', destinationPath: '/tmp/dest.txt' })
    ).rejects.toThrow('sourcePath must be an absolute path');
  });

  it('throws if destinationPath is not absolute', async () => {
    const src = path.join(tmpDir, 'src.txt');
    fs.writeFileSync(src, 'hello');
    await expect(
      MoveFileTool.execute({ sourcePath: src, destinationPath: 'relative/dest.txt' })
    ).rejects.toThrow('destinationPath must be an absolute path');
  });

  it('throws if source file does not exist', async () => {
    await expect(
      MoveFileTool.execute({
        sourcePath: path.join(tmpDir, 'nonexistent.txt'),
        destinationPath: path.join(tmpDir, 'dest.txt')
      })
    ).rejects.toThrow('Source file does not exist');
  });

  it('throws if source path is a directory (not a file)', async () => {
    const srcDir = path.join(tmpDir, 'srcdir');
    fs.mkdirSync(srcDir);
    await expect(
      MoveFileTool.execute({ sourcePath: srcDir, destinationPath: path.join(tmpDir, 'dest.txt') })
    ).rejects.toThrow('Source path is not a file');
  });

  it('throws if destination exists and overwrite is false', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'dest.txt');
    fs.writeFileSync(src, 'hello');
    fs.writeFileSync(dest, 'world');
    await expect(
      MoveFileTool.execute({ sourcePath: src, destinationPath: dest })
    ).rejects.toThrow('Destination file already exists');
  });

  // ========== Move ==========

  it('moves a file to an explicit destination path', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'dest.txt');
    fs.writeFileSync(src, 'content');

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dest });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('move');
    expect(result.destinationPath).toBe(dest);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('content');
  });

  it('moves a file into a destination directory (uses source filename)', async () => {
    const src = path.join(tmpDir, 'myfile.txt');
    const destDir = path.join(tmpDir, 'subdir');
    fs.writeFileSync(src, 'data');
    fs.mkdirSync(destDir);

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: destDir });

    expect(result.success).toBe(true);
    expect(result.destinationPath).toBe(path.join(destDir, 'myfile.txt'));
    expect(fs.existsSync(path.join(destDir, 'myfile.txt'))).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
  });

  it('creates intermediate destination directories if they do not exist', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'a', 'b', 'c', 'dest.txt');
    fs.writeFileSync(src, 'data');

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dest });

    expect(result.success).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('returns fileSize in result', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'dest.txt');
    fs.writeFileSync(src, 'hello world');

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dest });

    expect(result.fileSize).toBe(11);
  });

  it('overwrites destination when overwrite=true', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'dest.txt');
    fs.writeFileSync(src, 'new content');
    fs.writeFileSync(dest, 'old content');

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dest, overwrite: true });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('new content');
  });

  // ========== Copy ==========

  it('copies a file when copy=true', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'dest.txt');
    fs.writeFileSync(src, 'hello');

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dest, copy: true });

    expect(result.success).toBe(true);
    expect(result.operation).toBe('copy');
    expect(fs.existsSync(src)).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('hello');
  });

  it('copy preserves sourcePath in result', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'copy.txt');
    fs.writeFileSync(src, 'data');

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: dest, copy: true });

    expect(result.sourcePath).toBe(src);
  });

  // ========== Destination path inference ==========

  it('infers directory destination when dest path has no extension but source does', async () => {
    const src = path.join(tmpDir, 'report.pdf');
    const destBase = path.join(tmpDir, 'archive');
    fs.writeFileSync(src, 'pdf data');
    // destBase does not exist yet; tool should create it as a directory

    const result = await MoveFileTool.execute({ sourcePath: src, destinationPath: destBase });

    expect(result.success).toBe(true);
    // File should land at destBase/report.pdf
    const expectedDest = path.join(destBase, 'report.pdf');
    expect(result.destinationPath).toBe(expectedDest);
    expect(fs.existsSync(expectedDest)).toBe(true);
  });
});
