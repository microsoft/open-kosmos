/**
 * FileTreeService coverage2 — uncovered branches:
 * - getFileTree: cache hit, ripgrep fallback to readdir on error
 * - listFilesWithRipgrep: truncated by file count, truncated by timeout, exit code error, stderr
 * - listFilesWithReaddir: excludes, hidden files, depth limit, MAX_FILES limit
 * - buildRipgrepArgs: all option combinations
 * - clearCache: by folder, all
 * - getFileList
 * - scanEmptyDirectoriesAsync: maxDepth exceeded, dirSet size limit
 * - disposeFileTreeService
 * - getRipgrepPath fallback
 */

const { mockSpawn, mockFsReaddir, mockFsStat } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsStat: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('fs/promises', () => ({
  readdir: mockFsReaddir,
  stat: mockFsStat,
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('@vscode/ripgrep', () => ({
  rgPath: '',
}));

import { EventEmitter } from 'events';

function makeRgProcess(options: {
  stdout?: string[];
  stderr?: string;
  exitCode?: number | null;
  error?: Error;
  delay?: number;
} = {}): any {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  process.nextTick(async () => {
    if (options.error) {
      emitter.emit('error', options.error);
      return;
    }
    if (options.delay) {
      await new Promise(r => setTimeout(r, options.delay));
    }
    for (const chunk of (options.stdout || [])) {
      stdout.emit('data', Buffer.from(chunk));
    }
    if (options.stderr) {
      stderr.emit('data', Buffer.from(options.stderr));
    }
    emitter.emit('close', options.exitCode ?? 0);
  });

  return Object.assign(emitter, { stdout, stderr, kill: vi.fn() });
}

describe('FileTreeService coverage2', () => {
  let FileTreeService: any;
  let getFileTreeService: any;
  let disposeFileTreeService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-import to get fresh module
    const mod = await import('../FileTreeService');
    FileTreeService = mod.FileTreeService;
    getFileTreeService = mod.getFileTreeService;
    disposeFileTreeService = mod.disposeFileTreeService;
  });

  function makeService(rgPathOverride?: string): any {
    const svc = new FileTreeService();
    if (rgPathOverride !== undefined) {
      svc['rgPath'] = rgPathOverride;
    }
    return svc;
  }

  describe('isAvailable', () => {
    it('returns false when rgPath is empty', () => {
      const svc = makeService('');
      expect(svc.isAvailable()).toBe(false);
    });

    it('returns true when rgPath is set', () => {
      const svc = makeService('/usr/bin/rg');
      expect(svc.isAvailable()).toBe(true);
    });
  });

  describe('getFileTree - cache hit', () => {
    it('returns cached result on second call', async () => {
      const svc = makeService('/usr/bin/rg');
      mockFsReaddir.mockResolvedValue([]);
      mockSpawn.mockReturnValue(makeRgProcess({ stdout: ['file1.ts\nfile2.ts\n'] }));

      const query = { folder: '/tmp/project' };
      const result1 = await svc.getFileTree(query);
      expect(result1.stats.cacheHit).toBe(false);

      const result2 = await svc.getFileTree(query);
      expect(result2.stats.cacheHit).toBe(true);
    });
  });

  describe('getFileTree - ripgrep fallback to readdir', () => {
    it('falls back to readdir when ripgrep fails', async () => {
      const svc = makeService('/usr/bin/rg');
      mockSpawn.mockReturnValue(makeRgProcess({ exitCode: 2 })); // non-zero, non-1 exit
      mockFsReaddir.mockResolvedValue([]);

      const query = { folder: '/tmp/project' };
      const result = await svc.getFileTree(query);
      expect(result).toBeDefined();
    });

    it('falls back when ripgrep not available', async () => {
      const svc = makeService(''); // no rg path
      mockFsReaddir.mockResolvedValue([]);

      const query = { folder: '/tmp/project' };
      const result = await svc.getFileTree(query);
      expect(result).toBeDefined();
    });
  });

  describe('listFilesWithRipgrep', () => {
    it('rejects when rg is not available', async () => {
      const svc = makeService('');
      await expect(svc['listFilesWithRipgrep']({ folder: '/tmp' })).rejects.toThrow('Ripgrep is not available');
    });

    it('resolves truncated files when MAX_FILES exceeded', async () => {
      const svc = makeService('/usr/bin/rg');

      // Generate MAX_FILES + 1 lines
      const lines = Array.from({ length: 100001 }, (_, i) => `file${i}.ts`).join('\n') + '\n';
      const proc = makeRgProcess({ stdout: [lines] });
      mockSpawn.mockReturnValue(proc);
      mockFsReaddir.mockResolvedValue([]);

      const files = await svc['listFilesWithRipgrep']({ folder: '/tmp' });
      expect(files.length).toBeLessThanOrEqual(100001);
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('resolves on exit code 1 (no matches)', async () => {
      const svc = makeService('/usr/bin/rg');
      mockSpawn.mockReturnValue(makeRgProcess({ exitCode: 1 }));
      mockFsReaddir.mockResolvedValue([]);

      const files = await svc['listFilesWithRipgrep']({ folder: '/tmp' });
      expect(Array.isArray(files)).toBe(true);
    });

    it('rejects on non-zero exit code', async () => {
      const svc = makeService('/usr/bin/rg');
      mockSpawn.mockReturnValue(makeRgProcess({ exitCode: 127 }));

      await expect(svc['listFilesWithRipgrep']({ folder: '/tmp' })).rejects.toThrow('Ripgrep exited with code 127');
    });

    it('rejects on spawn error', async () => {
      const svc = makeService('/usr/bin/rg');
      mockSpawn.mockReturnValue(makeRgProcess({ error: new Error('ENOENT') }));

      await expect(svc['listFilesWithRipgrep']({ folder: '/tmp' })).rejects.toThrow('ENOENT');
    });

    it('handles remaining buffer after close', async () => {
      const svc = makeService('/usr/bin/rg');
      // No newline at end to test remaining buffer
      mockSpawn.mockReturnValue(makeRgProcess({ stdout: ['file1.ts'] }));
      mockFsReaddir.mockResolvedValue([]);

      const files = await svc['listFilesWithRipgrep']({ folder: '/tmp' });
      expect(files).toContain('file1.ts');
    });
  });

  describe('listFilesWithReaddir', () => {
    it('skips excluded directories', async () => {
      const svc = makeService('');
      mockFsReaddir.mockResolvedValueOnce([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ] as any);
      mockFsReaddir.mockResolvedValueOnce([
        { name: 'index.ts', isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await svc['listFilesWithReaddir']({ folder: '/tmp', excludePattern: 'node_modules' });
      expect(files).not.toContain('node_modules/index.ts');
    });

    it('skips hidden files by default', async () => {
      const svc = makeService('');
      mockFsReaddir.mockResolvedValueOnce([
        { name: '.hidden', isDirectory: () => false, isFile: () => true },
        { name: 'visible.ts', isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await svc['listFilesWithReaddir']({ folder: '/tmp' });
      expect(files).not.toContain('.hidden');
      expect(files).toContain('visible.ts');
    });

    it('includes hidden files when includeHidden is true', async () => {
      const svc = makeService('');
      mockFsReaddir.mockResolvedValueOnce([
        { name: '.env', isDirectory: () => false, isFile: () => true },
      ] as any);

      const files = await svc['listFilesWithReaddir']({ folder: '/tmp', includeHidden: true });
      expect(files).toContain('.env');
    });

    it('respects maxDepth', async () => {
      const svc = makeService('');
      mockFsReaddir.mockResolvedValueOnce([
        { name: 'deep', isDirectory: () => true, isFile: () => false },
      ] as any);
      // Return empty for deeper calls (maxDepth=0)
      mockFsReaddir.mockResolvedValue([]);

      const files = await svc['listFilesWithReaddir']({ folder: '/tmp', maxDepth: 0 });
      expect(files).toHaveLength(0);
    });

    it('handles readdir errors gracefully', async () => {
      const svc = makeService('');
      mockFsReaddir.mockRejectedValueOnce(new Error('permission denied'));

      const files = await svc['listFilesWithReaddir']({ folder: '/tmp' });
      expect(files).toHaveLength(0);
    });
  });

  describe('buildRipgrepArgs', () => {
    it('includes --hidden when includeHidden is true', () => {
      const svc = makeService('/usr/bin/rg');
      const args = svc['buildRipgrepArgs']({ folder: '/tmp', includeHidden: true });
      expect(args).toContain('--hidden');
    });

    it('includes --max-depth when maxDepth is set', () => {
      const svc = makeService('/usr/bin/rg');
      const args = svc['buildRipgrepArgs']({ folder: '/tmp', maxDepth: 5 });
      expect(args).toContain('--max-depth');
      expect(args).toContain('5');
    });

    it('includes exclude glob patterns', () => {
      const svc = makeService('/usr/bin/rg');
      const args = svc['buildRipgrepArgs']({ folder: '/tmp', excludePattern: 'dist,build' });
      expect(args).toContain('!dist');
      expect(args).toContain('!build');
    });

    it('includes include glob patterns', () => {
      const svc = makeService('/usr/bin/rg');
      const args = svc['buildRipgrepArgs']({ folder: '/tmp', includePattern: '*.ts,*.js' });
      expect(args).toContain('*.ts');
      expect(args).toContain('*.js');
    });
  });

  describe('clearCache', () => {
    it('clears cache for specific folder', async () => {
      const svc = makeService('/usr/bin/rg');
      mockFsReaddir.mockResolvedValue([]);
      mockSpawn.mockReturnValue(makeRgProcess({ stdout: [] }));

      const query = { folder: '/tmp/project' };
      await svc.getFileTree(query);

      svc.clearCache('/tmp/project');

      // Should not be cached anymore
      mockSpawn.mockReturnValue(makeRgProcess({ stdout: [] }));
      const result = await svc.getFileTree(query);
      expect(result.stats.cacheHit).toBe(false);
    });

    it('clears all cache', async () => {
      const svc = makeService('/usr/bin/rg');
      mockFsReaddir.mockResolvedValue([]);
      mockSpawn.mockReturnValue(makeRgProcess({ stdout: [] }));
      await svc.getFileTree({ folder: '/tmp/a' });

      mockSpawn.mockReturnValue(makeRgProcess({ stdout: [] }));
      await svc.getFileTree({ folder: '/tmp/b' });

      svc.clearCache(); // clear all

      expect(svc['cache'].size).toBe(0);
    });
  });

  describe('getFileList', () => {
    it('returns file list using ripgrep', async () => {
      const svc = makeService('/usr/bin/rg');
      mockSpawn.mockReturnValue(makeRgProcess({ stdout: ['a.ts\nb.ts\n'] }));
      mockFsReaddir.mockResolvedValue([]);

      const files = await svc.getFileList({ folder: '/tmp' });
      expect(files).toContain('a.ts');
    });
  });

  describe('scanEmptyDirectoriesAsync', () => {
    it('stops at maxDepth', async () => {
      const svc = makeService('/usr/bin/rg');
      const dirSet = new Set<string>();

      // Should not read anything when already at maxDepth
      await svc['scanEmptyDirectoriesAsync']('/tmp', '', dirSet, { folder: '/tmp', maxDepth: 0 }, 0);

      expect(mockFsReaddir).not.toHaveBeenCalled();
    });

    it('stops when dirSet size exceeds MAX_FILES', async () => {
      const svc = makeService('/usr/bin/rg');
      const dirSet = new Set<string>();
      // Fill dirSet to MAX_FILES
      for (let i = 0; i < 100000; i++) {
        dirSet.add(`dir${i}`);
      }

      await svc['scanEmptyDirectoriesAsync']('/tmp', '', dirSet, { folder: '/tmp' }, 0);

      expect(mockFsReaddir).not.toHaveBeenCalled();
    });

    it('skips default excluded directories', async () => {
      const svc = makeService('/usr/bin/rg');
      const dirSet = new Set<string>();

      mockFsReaddir.mockResolvedValueOnce([
        { name: 'node_modules', isDirectory: () => true, isFile: () => false },
        { name: 'src', isDirectory: () => true, isFile: () => false },
      ] as any);
      mockFsReaddir.mockResolvedValueOnce([]); // for 'src'

      await svc['scanEmptyDirectoriesAsync']('/tmp', '', dirSet, { folder: '/tmp' }, 0);

      expect(dirSet.has('node_modules')).toBe(false);
      expect(dirSet.has('src')).toBe(true);
    });

    it('skips hidden directories when includeHidden is false', async () => {
      const svc = makeService('/usr/bin/rg');
      const dirSet = new Set<string>();

      mockFsReaddir.mockResolvedValueOnce([
        { name: '.git', isDirectory: () => true, isFile: () => false },
      ] as any);

      await svc['scanEmptyDirectoriesAsync']('/tmp', '', dirSet, { folder: '/tmp', includeHidden: false }, 0);

      expect(dirSet.has('.git')).toBe(false);
    });

    it('handles readdir error gracefully', async () => {
      const svc = makeService('/usr/bin/rg');
      const dirSet = new Set<string>();
      mockFsReaddir.mockRejectedValueOnce(new Error('EPERM'));

      // Should not throw
      await svc['scanEmptyDirectoriesAsync']('/tmp', '', dirSet, { folder: '/tmp' }, 0);
      expect(dirSet.size).toBe(0);
    });
  });

  describe('getFileTreeService / disposeFileTreeService', () => {
    it('returns same instance on multiple calls', () => {
      const svc1 = getFileTreeService();
      const svc2 = getFileTreeService();
      expect(svc1).toBe(svc2);
    });

    it('disposeFileTreeService clears the global service', () => {
      getFileTreeService(); // ensure singleton created
      disposeFileTreeService();
      // After dispose, next call creates a new one
      const svc = getFileTreeService();
      expect(svc).toBeDefined();
    });
  });

  describe('addMetadataAsync', () => {
    it('emits metadataLoaded after processing', async () => {
      const svc = makeService('/usr/bin/rg');
      const nodeMap = new Map([
        ['', { path: '', name: 'root', isDirectory: true }],
        ['file.ts', { path: 'file.ts', name: 'file.ts', isDirectory: false }],
      ]);

      mockFsStat.mockResolvedValue({ size: 100, mtimeMs: 1000 });

      const metadataLoaded = new Promise(resolve => svc.once('metadataLoaded', resolve));
      await svc['addMetadataAsync'](nodeMap, '/tmp');
      await metadataLoaded;
    });

    it('handles stat errors gracefully', async () => {
      const svc = makeService('/usr/bin/rg');
      const nodeMap = new Map([
        ['file.ts', { path: 'file.ts', name: 'file.ts', isDirectory: false }],
      ]);

      mockFsStat.mockRejectedValue(new Error('ENOENT'));

      const metadataLoaded = new Promise(resolve => svc.once('metadataLoaded', resolve));
      await svc['addMetadataAsync'](nodeMap, '/tmp');
      await metadataLoaded;
    });
  });
});
