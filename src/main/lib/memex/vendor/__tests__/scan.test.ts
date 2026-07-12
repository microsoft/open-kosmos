import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanMarkdownFiles } from '../lib/scan';

// Direct unit tests for the vendored recursive markdown scanner. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memex-scan-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('scanMarkdownFiles', () => {
  it('returns an empty list for a directory that does not exist', async () => {
    const results = await scanMarkdownFiles(join(root, 'missing'));
    expect(results).toEqual([]);
  });

  it('finds top-level .md files and derives slugs from the basename', async () => {
    await writeFile(join(root, 'alpha.md'), '# a', 'utf-8');
    await writeFile(join(root, 'beta.md'), '# b', 'utf-8');
    const results = await scanMarkdownFiles(root);
    const slugs = results.map((r) => r.slug).sort();
    expect(slugs).toEqual(['alpha', 'beta']);
    expect(results.every((r) => r.path.endsWith('.md'))).toBe(true);
  });

  it('recurses into subdirectories', async () => {
    const sub = join(root, 'nested', 'deep');
    await mkdir(sub, { recursive: true });
    await writeFile(join(sub, 'gamma.md'), '# g', 'utf-8');
    const results = await scanMarkdownFiles(root);
    expect(results.map((r) => r.slug)).toContain('gamma');
  });

  it('ignores non-markdown files', async () => {
    await writeFile(join(root, 'keep.md'), '# k', 'utf-8');
    await writeFile(join(root, 'skip.txt'), 'nope', 'utf-8');
    await writeFile(join(root, 'data.json'), '{}', 'utf-8');
    const results = await scanMarkdownFiles(root);
    expect(results.map((r) => r.slug)).toEqual(['keep']);
  });
});
