/**
 * @vitest-environment node
 *
 * Tests for workspace/FileIndexCache.ts
 */

import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', async (importOriginal) => {
  const orig = await importOriginal<typeof fs>();
  return {
    ...orig,
    promises: {
      ...orig.promises,
      readdir: vi.fn(),
      stat: vi.fn(),
    },
  };
});

import { FileIndexCache } from '../FileIndexCache';

const ROOT = '/workspace';

const readdir = vi.mocked(fs.promises.readdir);
const stat = vi.mocked(fs.promises.stat);

function makeDirent(name: string, isDir = false): fs.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as fs.Dirent;
}

function fakeStat(opts: Partial<fs.Stats> = {}): fs.Stats {
  return {
    size: 100,
    mtimeMs: 1000,
    isFile: () => true,
    isDirectory: () => false,
    ...opts,
  } as unknown as fs.Stats;
}

describe('FileIndexCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // buildIndex
  // -------------------------------------------------------------------------
  it('buildIndex emits indexComplete with file/dir counts', async () => {
    readdir
      .mockResolvedValueOnce([makeDirent('src', true), makeDirent('readme.md')] as any)
      .mockResolvedValueOnce([makeDirent('main.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    const complete = new Promise<any>((res) => cache.once('indexComplete', res));
    await cache.buildIndex();
    const info = await complete;

    expect(info.fileCount).toBe(2); // readme.md + src/main.ts
    expect(info.directoryCount).toBe(1); // src
  });

  it('buildIndex ignores hidden directories and node_modules', async () => {
    readdir.mockResolvedValueOnce([
      makeDirent('.git', true),
      makeDirent('node_modules', true),
      makeDirent('index.ts'),
    ] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const stats = cache.getStats();
    expect(stats.totalFiles).toBe(1);
    expect(stats.totalDirectories).toBe(0);
  });

  it('buildIndex does not run concurrently (second call is ignored)', async () => {
    let readdirCallCount = 0;
    readdir.mockImplementation(async () => {
      readdirCallCount++;
      return [makeDirent('a.ts')] as any;
    });
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    // Kick two builds simultaneously
    const p1 = cache.buildIndex();
    const p2 = cache.buildIndex(); // should return immediately
    await Promise.all([p1, p2]);
    // readdir should only have been called once for root (second call skipped)
    expect(readdirCallCount).toBe(1);
  });

  it('buildIndex emits indexError on scan failure', async () => {
    readdir.mockRejectedValueOnce(new Error('EACCES'));

    const cache = new FileIndexCache(ROOT);
    const error = new Promise<any>((res) => cache.once('indexError', res));
    await cache.buildIndex();
    const err = await error;
    expect(err.message).toContain('EACCES');
  });

  // -------------------------------------------------------------------------
  // handleFileChanges
  // -------------------------------------------------------------------------
  it('handleFileChanges ADDED adds file to index', async () => {
    // Prime an empty index
    readdir.mockResolvedValueOnce([] as any);
    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();

    stat.mockResolvedValueOnce(fakeStat({ isFile: () => true, isDirectory: () => false } as any));

    await cache.handleFileChanges([{ type: 1, path: 'new-file.ts' }]);
    const results = cache.search('new-file');
    expect(results.map(r => r.path)).toContain('new-file.ts');
  });

  it('handleFileChanges UPDATED updates existing file', async () => {
    readdir.mockResolvedValueOnce([makeDirent('old.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();

    // Update with new stat
    stat.mockResolvedValueOnce(fakeStat({ size: 9999 } as any));
    await cache.handleFileChanges([{ type: 0, path: 'old.ts' }]);
    // File should still be in index
    const results = cache.search('old');
    expect(results.length).toBeGreaterThan(0);
  });

  it('handleFileChanges DELETED removes file from index', async () => {
    readdir.mockResolvedValueOnce([makeDirent('del.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    expect(cache.search('del').length).toBeGreaterThan(0);

    await cache.handleFileChanges([{ type: 2, path: 'del.ts' }]);
    expect(cache.search('del').length).toBe(0);
  });

  it('handleFileChanges emits indexUpdated', async () => {
    readdir.mockResolvedValueOnce([] as any);
    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();

    const updated = new Promise<any>((res) => cache.once('indexUpdated', res));
    await cache.handleFileChanges([{ type: 2, path: 'gone.ts' }]);
    const info = await updated;
    expect(info.changesProcessed).toBe(1);
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------
  it('search returns all files when no pattern given', async () => {
    readdir.mockResolvedValueOnce([makeDirent('a.ts'), makeDirent('b.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search();
    expect(results.length).toBe(2);
  });

  it('search filters by substring pattern', async () => {
    readdir.mockResolvedValueOnce([makeDirent('index.ts'), makeDirent('users.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search('index');
    expect(results.map(r => r.path)).toContain('index.ts');
    expect(results.map(r => r.path)).not.toContain('users.ts');
  });

  it('search supports fuzzy matching', async () => {
    readdir.mockResolvedValueOnce([makeDirent('getUserById.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search('gub', { fuzzy: true });
    expect(results.map(r => r.path)).toContain('getUserById.ts');
  });

  it('search respects maxResults', async () => {
    readdir.mockResolvedValueOnce([
      makeDirent('a.ts'), makeDirent('b.ts'), makeDirent('c.ts'),
    ] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search(undefined, { maxResults: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('search with searchTarget "folders" returns directories', async () => {
    readdir
      .mockResolvedValueOnce([makeDirent('src', true), makeDirent('index.ts')] as any)
      .mockResolvedValueOnce([] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search(undefined, { searchTarget: 'folders' });
    expect(results.every(r => r.isDirectory)).toBe(true);
    expect(results.map(r => r.path)).toContain('src');
  });

  it('search with searchTarget "files" returns files only', async () => {
    readdir
      .mockResolvedValueOnce([makeDirent('src', true), makeDirent('index.ts')] as any)
      .mockResolvedValueOnce([] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search(undefined, { searchTarget: 'files' });
    expect(results.every(r => !r.isDirectory)).toBe(true);
  });

  it('search with excludePattern excludes matching entries', async () => {
    readdir.mockResolvedValueOnce([makeDirent('index.ts'), makeDirent('test.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search(undefined, { excludePattern: 'test' });
    expect(results.map(r => r.path)).not.toContain('test.ts');
  });

  it('search with includePattern includes only matching entries', async () => {
    readdir.mockResolvedValueOnce([makeDirent('index.ts'), makeDirent('style.css')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search(undefined, { includePattern: '.ts' });
    expect(results.map(r => r.path)).toContain('index.ts');
    expect(results.map(r => r.path)).not.toContain('style.css');
  });

  it('scores exact filename match with 100', async () => {
    readdir.mockResolvedValueOnce([makeDirent('index.ts'), makeDirent('indexHelper.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const results = cache.search('index.ts');
    // Exact match should have higher score
    expect(results[0].path).toBe('index.ts');
    expect(results[0].score).toBe(100);
  });

  // -------------------------------------------------------------------------
  // getStats / clear
  // -------------------------------------------------------------------------
  it('getStats reflects current index state', async () => {
    readdir.mockResolvedValueOnce([makeDirent('a.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    const s = cache.getStats();
    expect(s.totalFiles).toBe(1);
    expect(s.isIndexing).toBe(false);
    expect(s.progress).toBe(100);
  });

  it('clear empties the index', async () => {
    readdir.mockResolvedValueOnce([makeDirent('a.ts')] as any);
    stat.mockResolvedValue(fakeStat());

    const cache = new FileIndexCache(ROOT);
    await cache.buildIndex();
    cache.clear();
    expect(cache.getStats().totalFiles).toBe(0);
    expect(cache.getStats().totalDirectories).toBe(0);
  });
});
