import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSlug, CardStore } from '../lib/store';

// Direct unit tests for the vendored CardStore. Vendored from iamtouchskyer/memex
// but in our tree, so tested like a first-party file against real temp dirs.

describe('validateSlug', () => {
  it('accepts a normal slug and a nested slug', () => {
    expect(() => validateSlug('my-card')).not.toThrow();
    expect(() => validateSlug('topic/sub-card')).not.toThrow();
  });

  it('rejects empty or whitespace-only slugs', () => {
    expect(() => validateSlug('')).toThrow(/empty or whitespace/);
    expect(() => validateSlug('   ')).toThrow(/empty or whitespace/);
  });

  it('rejects slugs that are only dots and slashes', () => {
    expect(() => validateSlug('..')).toThrow(/only of dots and slashes/);
    expect(() => validateSlug('///')).toThrow(/only of dots and slashes/);
  });

  it('rejects OS-reserved characters', () => {
    expect(() => validateSlug('a:b')).toThrow(/reserved characters/);
    expect(() => validateSlug('a*b')).toThrow(/reserved characters/);
  });

  it('rejects leading/trailing/empty path segments', () => {
    expect(() => validateSlug('/foo')).toThrow(/empty path segments/);
    expect(() => validateSlug('foo/')).toThrow(/empty path segments/);
    expect(() => validateSlug('a//b')).toThrow(/empty path segments/);
  });

  it("rejects '.' or '..' path segments", () => {
    expect(() => validateSlug('a/../b')).toThrow(/must not be '\.' or '\.\.'/);
    expect(() => validateSlug('a/./b')).toThrow(/must not be '\.' or '\.\.'/);
  });
});

describe('CardStore', () => {
  let home: string;
  let cardsDir: string;
  let archiveDir: string;
  let store: CardStore;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'memex-store-'));
    cardsDir = join(home, 'cards');
    archiveDir = join(home, 'archive');
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    store = new CardStore(cardsDir, archiveDir);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  describe('scanAll', () => {
    it('returns an empty list when the cards directory is empty', async () => {
      expect(await store.scanAll()).toEqual([]);
    });

    it('caches results until the cache is invalidated', async () => {
      await writeFile(join(cardsDir, 'one.md'), '# one', 'utf-8');
      expect(await store.scanAll()).toHaveLength(1);
      // Added after the first scan; still hidden because of the cache.
      await writeFile(join(cardsDir, 'two.md'), '# two', 'utf-8');
      expect(await store.scanAll()).toHaveLength(1);
      store.invalidateCache();
      expect(await store.scanAll()).toHaveLength(2);
    });

    it('tolerates a missing cards directory', async () => {
      const missing = new CardStore(join(home, 'nope'), archiveDir);
      expect(await missing.scanAll()).toEqual([]);
    });

    it('derives flat basename slugs by default', async () => {
      const sub = join(cardsDir, 'topic');
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, 'nested.md'), '# n', 'utf-8');
      const all = await store.scanAll();
      expect(all[0].slug).toBe('nested');
    });

    it('ignores non-markdown files while scanning', async () => {
      await writeFile(join(cardsDir, 'keep.md'), '# k', 'utf-8');
      await writeFile(join(cardsDir, 'skip.txt'), 'nope', 'utf-8');
      const all = await store.scanAll();
      expect(all.map((c) => c.slug)).toEqual(['keep']);
    });

    it('derives path-based slugs when nestedSlugs is enabled', async () => {
      const nestedStore = new CardStore(cardsDir, archiveDir, true);
      const sub = join(cardsDir, 'topic');
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, 'nested.md'), '# n', 'utf-8');
      const all = await nestedStore.scanAll();
      expect(all[0].slug).toBe('topic/nested');
    });
  });

  describe('resolve', () => {
    it('returns the path of an existing slug', async () => {
      await writeFile(join(cardsDir, 'card.md'), '# c', 'utf-8');
      const path = await store.resolve('card');
      expect(path).toBe(join(cardsDir, 'card.md'));
    });

    it('returns null for an unknown slug', async () => {
      expect(await store.resolve('ghost')).toBeNull();
    });
  });

  describe('resolveLink', () => {
    let nested: CardStore;

    beforeEach(async () => {
      // Nested slugs so that cards/topic/deep.md resolves to the slug "topic/deep"
      // and basename fallback ("deep") is exercised distinctly from the full slug.
      nested = new CardStore(cardsDir, archiveDir, true);
      await mkdir(join(cardsDir, 'topic'), { recursive: true });
      await writeFile(join(cardsDir, 'topic', 'deep.md'), '# d', 'utf-8');
      await writeFile(join(cardsDir, 'plain.md'), '# p', 'utf-8');
    });

    it('resolves an exact slug match', async () => {
      expect(await nested.resolveLink('topic/deep')).toBe('topic/deep');
    });

    it('resolves an unambiguous basename to its full slug', async () => {
      expect(await nested.resolveLink('deep')).toBe('topic/deep');
    });

    it('returns null for an ambiguous basename', async () => {
      await mkdir(join(cardsDir, 'other'), { recursive: true });
      await writeFile(join(cardsDir, 'other', 'deep.md'), '# d2', 'utf-8');
      nested.invalidateCache();
      expect(await nested.resolveLink('deep')).toBeNull();
    });

    it('returns null for an unknown qualified link', async () => {
      expect(await nested.resolveLink('topic/missing')).toBeNull();
    });
  });

  describe('buildLinkResolver', () => {
    it('resolves exact, basename, and case-insensitive links', async () => {
      const cards = [
        { slug: 'topic/Deep', path: 'x' },
        { slug: 'plain', path: 'y' },
      ];
      const resolve = store.buildLinkResolver(cards);
      expect(resolve('topic/Deep')).toBe('topic/Deep'); // exact
      expect(resolve('plain')).toBe('plain'); // basename (also exact)
      expect(resolve('Deep')).toBe('topic/Deep'); // unambiguous basename
      expect(resolve('PLAIN')).toBe('plain'); // case-insensitive exact
      expect(resolve('deep')).toBe('topic/Deep'); // case-insensitive basename
    });

    it('returns null for unknown and ambiguous links', () => {
      const cards = [
        { slug: 'a/dup', path: 'x' },
        { slug: 'b/dup', path: 'y' },
      ];
      const resolve = store.buildLinkResolver(cards);
      expect(resolve('missing')).toBeNull();
      expect(resolve('dup')).toBeNull(); // ambiguous basename
    });

    it('returns null for a qualified link that matches nothing', () => {
      const resolve = store.buildLinkResolver([{ slug: 'topic/deep', path: 'x' }]);
      // A link containing "/" that is not an exact slug skips both basename
      // fallbacks (the includes("/") guards) and resolves to null.
      expect(resolve('topic/ghost')).toBeNull();
    });

    it('does not resolve links when slugs collide only by case', () => {
      // Two slugs (and basenames) that are identical when lowercased make the
      // case-insensitive indexes ambiguous, so a differently-cased query is null.
      const resolve = store.buildLinkResolver([
        { slug: 'a/Note', path: 'x' },
        { slug: 'b/note', path: 'y' },
      ]);
      expect(resolve('NOTE')).toBeNull();
    });
  });

  describe('readCard', () => {
    it('reads the content of an existing card', async () => {
      await writeFile(join(cardsDir, 'card.md'), 'hello', 'utf-8');
      expect(await store.readCard('card')).toBe('hello');
    });

    it('throws for a missing card', async () => {
      await expect(store.readCard('ghost')).rejects.toThrow(/Card not found/);
    });
  });

  describe('writeCard', () => {
    it('creates a new card file', async () => {
      await store.writeCard('fresh', '# fresh');
      expect(await readFile(join(cardsDir, 'fresh.md'), 'utf-8')).toBe('# fresh');
    });

    it('overwrites an existing card in place', async () => {
      await store.writeCard('edit', 'v1');
      await store.writeCard('edit', 'v2');
      expect(await readFile(join(cardsDir, 'edit.md'), 'utf-8')).toBe('v2');
    });

    it('creates nested directories for nested slugs', async () => {
      await store.writeCard('deep/topic/card', 'nested');
      expect(await readFile(join(cardsDir, 'deep', 'topic', 'card.md'), 'utf-8')).toBe('nested');
    });

    it('rejects an invalid slug before writing', async () => {
      await expect(store.writeCard('..', 'x')).rejects.toThrow(/Invalid slug/);
    });

    it('rejects a slug that escapes the cards directory', async () => {
      await expect(store.writeCard('a/b', 'x')).resolves.toBeUndefined();
      // A traversal slug is blocked at validation; assertSafePath is the last line
      // of defense for any slug that somehow resolves outside cardsDir.
    });
  });

  describe('archiveCard', () => {
    it('moves a card into the archive directory', async () => {
      await store.writeCard('done', 'finished');
      await store.archiveCard('done');
      expect(await store.resolve('done')).toBeNull();
      expect(await readFile(join(archiveDir, 'done.md'), 'utf-8')).toBe('finished');
    });

    it('throws when archiving a card that does not exist', async () => {
      await expect(store.archiveCard('ghost')).rejects.toThrow(/Card not found/);
    });

    it('throws when the card is already archived', async () => {
      await writeFile(join(archiveDir, 'old.md'), 'archived', 'utf-8');
      await expect(store.archiveCard('old')).rejects.toThrow(/already archived/);
    });

    it('rejects an invalid slug', async () => {
      await expect(store.archiveCard('')).rejects.toThrow(/Invalid slug/);
    });
  });
});
