/**
 * @vitest-environment node
 *
 * Tests for NodeFSSearchEngine — mocks the filesystem.
 */

import * as fsModule from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mock fs.readdir so we can control directory listings
// ---------------------------------------------------------------------------
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof fsModule>();
  return {
    ...original,
    readdir: vi.fn(),
    stat: vi.fn(),
  };
});

import { NodeFSSearchEngine } from '../NodeFSSearchEngine';
import type { IFileSearchQuery } from '../SearchService';

const readdir = vi.mocked(fsModule.readdir as any);

function makeDirent(name: string, isDir = false, isFile = true): fsModule.Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => isFile && !isDir,
    isSymbolicLink: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as fsModule.Dirent;
}

function setupReaddir(structure: Record<string, fsModule.Dirent[]>) {
  readdir.mockImplementation((dir: string, _opts: any, cb: Function) => {
    const dirStr = typeof dir === 'string' ? dir : String(dir);
    const entries = structure[dirStr] || [];
    cb(null, entries);
  });
}

const ROOT = '/workspace';

describe('NodeFSSearchEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results when directory is empty', async () => {
    setupReaddir({ [ROOT]: [] });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT });
    expect(result.results).toHaveLength(0);
    expect(result.limitHit).toBe(false);
  });

  it('returns all files when no pattern given', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('a.ts'), makeDirent('b.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT });
    expect(result.results.map(r => r.path)).toEqual(
      expect.arrayContaining(['a.ts', 'b.ts'])
    );
  });

  it('filters files by pattern using simple substring match', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('index.ts'), makeDirent('users.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, pattern: 'index' });
    expect(result.results.map(r => r.path)).toContain('index.ts');
    expect(result.results.map(r => r.path)).not.toContain('users.ts');
  });

  it('matches files fuzzy-style', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('getUserById.ts'), makeDirent('unrelated.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, pattern: 'gub', fuzzy: true });
    expect(result.results.map(r => r.path)).toContain('getUserById.ts');
  });

  it('recurses into subdirectories', async () => {
    const subDir = path.join(ROOT, 'src');
    setupReaddir({
      [ROOT]: [makeDirent('src', true, false)],
      [subDir]: [makeDirent('main.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT });
    expect(result.results.map(r => r.path)).toContain('src/main.ts');
  });

  it('respects maxResults', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('a.ts'), makeDirent('b.ts'), makeDirent('c.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, maxResults: 2 });
    expect(result.results.length).toBeLessThanOrEqual(2);
    expect(result.limitHit).toBe(true);
  });

  it('excludes node_modules by default', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('node_modules', true, false), makeDirent('index.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT });
    expect(result.results.map(r => r.path)).not.toContain('node_modules');
    expect(result.results.map(r => r.path)).toContain('index.ts');
  });

  it('applies custom excludePattern', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('dist', true, false), makeDirent('src', true, false)],
      [path.join(ROOT, 'src')]: [makeDirent('main.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, excludePattern: 'dist' });
    const paths = result.results.map(r => r.path);
    expect(paths).not.toContain('dist');
    expect(paths).toContain('src/main.ts');
  });

  it('applies includePattern to restrict matches', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('index.ts'), makeDirent('style.css')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, includePattern: '*.ts' });
    const paths = result.results.map(r => r.path);
    expect(paths).toContain('index.ts');
    expect(paths).not.toContain('style.css');
  });

  it('handles directories when searchTarget is "folders"', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('src', true, false), makeDirent('index.ts')],
      [path.join(ROOT, 'src')]: [],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, searchTarget: 'folders' });
    const paths = result.results.map(r => r.path);
    expect(paths).toContain('src');
    expect(paths).not.toContain('index.ts');
  });

  it('handles files only when searchTarget is "files"', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('src', true, false), makeDirent('index.ts')],
      [path.join(ROOT, 'src')]: [makeDirent('main.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, searchTarget: 'files' });
    const paths = result.results.map(r => r.path);
    expect(paths).not.toContain('src');
    expect(paths).toContain('index.ts');
  });

  it('calls onProgress for each matched file', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('a.ts'), makeDirent('b.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const progressItems: string[] = [];
    await engine.search({ folder: ROOT }, (r) => progressItems.push(r.path));
    expect(progressItems.length).toBeGreaterThan(0);
  });

  it('handles readdir errors gracefully (returns empty results)', async () => {
    readdir.mockImplementation((_dir: string, _opts: any, cb: Function) => {
      cb(new Error('permission denied'));
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT });
    expect(result.results).toHaveLength(0);
  });

  it('scores and sorts results when a pattern is given', async () => {
    setupReaddir({
      [ROOT]: [makeDirent('index.ts'), makeDirent('indexHelper.ts')],
    });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT, pattern: 'index' });
    // Should have 2 results
    expect(result.results.length).toBe(2);
    // First result should be 'index.ts' (exact prefix match)
    expect(result.results[0].path).toBe('index.ts');
  });

  it('includes stats in results', async () => {
    setupReaddir({ [ROOT]: [makeDirent('a.ts')] });
    const engine = new NodeFSSearchEngine();
    const result = await engine.search({ folder: ROOT });
    expect(result.stats).toBeDefined();
    expect(result.stats!.duration).toBeGreaterThanOrEqual(0);
    expect(result.stats!.cacheHit).toBe(false);
  });
});
