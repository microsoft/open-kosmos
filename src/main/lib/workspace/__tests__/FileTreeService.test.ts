/**
 * Tests for FileTreeService
 */

vi.mock('@vscode/ripgrep', () => ({ rgPath: '/mock/rg' }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    promises: {
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn().mockResolvedValue({ size: 100, mtimeMs: Date.now() }),
    },
  };
});
vi.mock('fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 100, mtimeMs: Date.now() }),
}));
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { spawn } from 'child_process';
import {
  FileTreeService,
  getFileTreeService,
  disposeFileTreeService,
} from '../FileTreeService';

// Helper to build a fake spawn process
function makeFakeProcess(stdoutLines: string[], exitCode = 0) {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: vi.fn() };
  proc.killed = false;
  proc.kill = vi.fn();
  proc.pid = 12345;

  setImmediate(() => {
    if (stdoutLines.length > 0) {
      proc.stdout.emit('data', Buffer.from(stdoutLines.join('\n') + '\n'));
    }
    proc.emit('close', exitCode);
  });

  return proc;
}

describe('FileTreeService', () => {
  let service: FileTreeService;

  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as any).mockReturnValue(true);
    (fsp.readdir as any).mockResolvedValue([]);
    (fsp.stat as any).mockResolvedValue({ size: 100, mtimeMs: Date.now() });
    service = new FileTreeService();
  });

  // ---- isAvailable ----

  it('isAvailable() returns true when rgPath is set', () => {
    expect(service.isAvailable()).toBe(true);
  });

  // ---- getFileList (calls listFilesWithRipgrep) ----

  it('getFileList passes --files and --color=never args to spawn', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess(['src/foo.ts', 'src/bar.ts']));

    const files = await service.getFileList({ folder: '/project' });

    expect(spawn).toHaveBeenCalledWith(
      '/mock/rg',
      expect.arrayContaining(['--files', '--color=never']),
      expect.objectContaining({ cwd: '/project' }),
    );
    expect(files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('getFileList passes --hidden when includeHidden is true', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess([]));
    await service.getFileList({ folder: '/project', includeHidden: true });
    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain('--hidden');
  });

  it('getFileList passes --max-depth when maxDepth is set', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess([]));
    await service.getFileList({ folder: '/project', maxDepth: 3 });
    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain('--max-depth');
    expect(args).toContain('3');
  });

  it('getFileList passes exclude globs', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess([]));
    await service.getFileList({ folder: '/project', excludePattern: 'dist,build' });
    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain('!dist');
    expect(args).toContain('!build');
  });

  it('getFileList passes include globs', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess([]));
    await service.getFileList({ folder: '/project', includePattern: '*.ts,*.js' });
    const args = (spawn as any).mock.calls[0][1] as string[];
    expect(args).toContain('*.ts');
    expect(args).toContain('*.js');
  });

  it('getFileList rejects on non-zero ripgrep exit code', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess([], 2));
    await expect(service.getFileList({ folder: '/project' })).rejects.toThrow(
      'Ripgrep exited with code 2',
    );
  });

  it('getFileList resolves with empty array on exit code 1 (no matches)', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess([], 1));
    const files = await service.getFileList({ folder: '/project' });
    expect(files).toEqual([]);
  });

  // ---- getFileTree ----

  it('getFileTree builds a tree from file list', async () => {
    (spawn as any).mockReturnValue(
      makeFakeProcess(['src/index.ts', 'src/utils/helper.ts']),
    );

    const result = await service.getFileTree({ folder: '/project' });

    expect(result.flatList).toContain('src/index.ts');
    expect(result.root.isDirectory).toBe(true);
    expect(result.stats.cacheHit).toBe(false);
    expect(result.stats.totalFiles).toBe(2);
  });

  it('getFileTree returns cacheHit=true on second call', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess(['a.ts']));
    const query = { folder: '/project-cached' };
    await service.getFileTree(query);

    const result2 = await service.getFileTree(query);
    expect(result2.stats.cacheHit).toBe(true);
    // spawn should only have been called once
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('getFileTree emits treeBuilt event', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess(['a.ts']));
    const listener = vi.fn();
    service.on('treeBuilt', listener);
    await service.getFileTree({ folder: '/proj-event' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('getFileTree falls back to readdir when ripgrep fails', async () => {
    // Make ripgrep fail
    (spawn as any).mockReturnValue(makeFakeProcess([], 2));

    // Make readdir return a file
    (fsp.readdir as any).mockResolvedValue([
      { name: 'index.ts', isDirectory: () => false, isFile: () => true },
    ]);

    const result = await service.getFileTree({ folder: '/fallback' });
    expect(result.flatList).toContain('index.ts');
  });

  it('getFileTree totalDirectories counts correctly', async () => {
    (spawn as any).mockReturnValue(
      makeFakeProcess(['src/index.ts', 'src/utils/helper.ts']),
    );
    const result = await service.getFileTree({ folder: '/project-dirs' });
    // root + src + src/utils = 3 directories
    expect(result.stats.totalDirectories).toBeGreaterThanOrEqual(2);
  });

  // ---- clearCache ----

  it('clearCache(folder) removes only matching entries', async () => {
    (spawn as any)
      .mockReturnValueOnce(makeFakeProcess(['a.ts']))
      .mockReturnValueOnce(makeFakeProcess(['b.ts']));

    await service.getFileTree({ folder: '/folderA' });
    await service.getFileTree({ folder: '/folderB' });

    service.clearCache('/folderA');

    // folderA should re-fetch; folderB should still be cached
    (spawn as any).mockReturnValueOnce(makeFakeProcess(['a.ts']));
    const aResult = await service.getFileTree({ folder: '/folderA' });
    const bResult = await service.getFileTree({ folder: '/folderB' });

    expect(aResult.stats.cacheHit).toBe(false);
    expect(bResult.stats.cacheHit).toBe(true);
  }, 10_000);

  it('clearCache() without args clears all entries', async () => {
    (spawn as any).mockReturnValue(makeFakeProcess(['a.ts']));
    await service.getFileTree({ folder: '/folderC' });

    service.clearCache();

    (spawn as any).mockReturnValue(makeFakeProcess(['a.ts']));
    const result = await service.getFileTree({ folder: '/folderC' });
    expect(result.stats.cacheHit).toBe(false);
  });

  // ---- getFileTreeService singleton ----

  it('getFileTreeService returns same instance on repeated calls', () => {
    disposeFileTreeService();
    const s1 = getFileTreeService();
    const s2 = getFileTreeService();
    expect(s1).toBe(s2);
    disposeFileTreeService();
  });

  it('disposeFileTreeService creates a fresh instance after disposal', () => {
    disposeFileTreeService();
    const s1 = getFileTreeService();
    disposeFileTreeService();
    const s2 = getFileTreeService();
    expect(s1).not.toBe(s2);
    disposeFileTreeService();
  });

  // ---- readdir fallback (listFilesWithReaddir) ----

  it('listFilesWithReaddir skips hidden files by default', async () => {
    (fsp.readdir as any).mockResolvedValue([
      { name: '.hidden', isDirectory: () => false, isFile: () => true },
      { name: 'visible.ts', isDirectory: () => false, isFile: () => true },
    ]);

    const result = await (service as any).listFilesWithReaddir({
      folder: '/dir',
    });

    expect(result).toContain('visible.ts');
    expect(result).not.toContain('.hidden');
  });

  it('listFilesWithReaddir includes hidden files when includeHidden=true', async () => {
    (fsp.readdir as any).mockResolvedValue([
      { name: '.hidden', isDirectory: () => false, isFile: () => true },
    ]);

    const result = await (service as any).listFilesWithReaddir({
      folder: '/dir',
      includeHidden: true,
    });

    expect(result).toContain('.hidden');
  });

  it('listFilesWithReaddir excludes node_modules by default', async () => {
    (fsp.readdir as any).mockResolvedValue([
      { name: 'node_modules', isDirectory: () => true, isFile: () => false },
      { name: 'src', isDirectory: () => true, isFile: () => false },
    ]);

    const result = await (service as any).listFilesWithReaddir({
      folder: '/dir',
    });

    // node_modules excluded; src is empty dir so no files either
    expect(result).toEqual([]);
    // node_modules shouldn't trigger deeper readdir call
    const readdirCalls = (fsp.readdir as any).mock.calls.map((c: any[]) => c[0]);
    expect(readdirCalls.some((p: string) => p.includes('node_modules'))).toBe(false);
  });

  it('listFilesWithReaddir recurses into subdirectories', async () => {
    (fsp.readdir as any)
      .mockResolvedValueOnce([
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ])
      .mockResolvedValueOnce([
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      ]);

    const result = await (service as any).listFilesWithReaddir({
      folder: '/project',
    });

    expect(result).toContain('src/index.ts');
  });
});
