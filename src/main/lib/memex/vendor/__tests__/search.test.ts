import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardStore } from '../lib/store';
import { searchCommand } from '../commands/search';

// Direct unit tests for the vendored search command. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file against
// real on-disk cards.

let home: string;
let cardsDir: string;
let store: CardStore;

async function writeCard(slug: string, frontmatter: string, body: string): Promise<void> {
  const content = `---\n${frontmatter}\n---\n${body}`;
  await writeFile(join(cardsDir, `${slug}.md`), content, 'utf-8');
  store.invalidateCache();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memex-search-'));
  cardsDir = join(home, 'cards');
  await mkdir(cardsDir, { recursive: true });
  store = new CardStore(cardsDir, join(home, 'archive'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('searchCommand', () => {
  it('rejects a query containing tokenized URL credentials', async () => {
    const r = await searchCommand(store, 'https://user:pass@example.com/x');
    expect(r.exitCode).toBe(1);
    expect(r.output).toMatch(/Sensitive input rejected/);
  });

  it('returns empty output when there are no cards', async () => {
    const r = await searchCommand(store, 'anything');
    expect(r.output).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('shows guidance when no query, no list, and no filter', async () => {
    await writeCard('a', 'title: A', 'body');
    const r = await searchCommand(store, undefined);
    expect(r.output).toContain('No query provided');
    expect(r.totalCount).toBe(1);
  });

  it('lists cards when --list is set with no query', async () => {
    await writeCard('alpha', 'title: Alpha', 'body');
    await writeCard('beta', 'title: Beta', 'body');
    const r = await searchCommand(store, undefined, { list: true });
    expect(r.output).toContain('alpha');
    expect(r.output).toContain('beta');
  });

  it('caps the list to the limit and notes how many are shown', async () => {
    await writeCard('one', 'title: One', 'b');
    await writeCard('two', 'title: Two', 'b');
    await writeCard('three', 'title: Three', 'b');
    const r = await searchCommand(store, undefined, { list: true, limit: 2 });
    expect(r.output).toContain('cards shown');
  });

  it('treats a negative limit as the default and still lists', async () => {
    await writeCard('one', 'title: One', 'b');
    const r = await searchCommand(store, undefined, { list: true, limit: -5 });
    expect(r.output).toContain('one');
  });

  it('produces an empty list body when the limit is zero', async () => {
    await writeCard('one', 'title: One', 'b');
    const r = await searchCommand(store, undefined, { list: true, limit: 0 });
    expect(r.output).toContain('cards shown');
  });

  it('returns a ranked keyword match for a query', async () => {
    await writeCard('jwt-auth', 'title: JWT Auth', 'Explains JWT token refresh.');
    await writeCard('unrelated', 'title: Cooking', 'A recipe for soup.');
    const r = await searchCommand(store, 'jwt');
    expect(r.output).toContain('## jwt-auth');
    expect(r.totalCount).toBe(1);
  });

  it('returns empty output when the query matches nothing', async () => {
    await writeCard('a', 'title: A', 'unrelated body');
    const r = await searchCommand(store, 'zzzznomatch');
    expect(r.output).toBe('');
  });

  it('supports compact output formatting', async () => {
    await writeCard('jwt-auth', 'title: JWT Auth', 'Explains JWT tokens.');
    const r = await searchCommand(store, 'jwt', { compact: true });
    expect(r.output).toContain('jwt-auth');
    expect(r.output).not.toContain('## ');
  });

  it('treats a negative limit as the default during keyword search', async () => {
    await writeCard('jwt-auth', 'title: JWT Auth', 'Explains JWT tokens.');
    const r = await searchCommand(store, 'jwt', { limit: -3 });
    expect(r.output).toContain('jwt-auth');
  });

  it('shows matched metadata fields for a tag-only match', async () => {
    // The token matches only the tag (no body/heading line), so the scorer leaves
    // matchLine empty and the formatter surfaces the matched fields instead.
    await writeCard('tagged', 'title: Tagged Card\ntags: [jwt]', 'unrelated prose about cooking');
    const r = await searchCommand(store, 'jwt');
    expect(r.output).toContain('## tagged');
    expect(r.output).toContain('> Matched:');
  });

  it('falls back to the slug when a keyword-matched card has no title', async () => {
    await writeFile(join(cardsDir, 'jwt-notes.md'), 'A note about JWT tokens.', 'utf-8');
    store.invalidateCache();
    const r = await searchCommand(store, 'jwt');
    expect(r.output).toContain('## jwt-notes');
  });

  it('returns only a warning when a credential-path query matches no cards', async () => {
    await writeCard('a', 'title: A', 'unrelated content');
    // The query carries a credential-path warning but matches nothing, so the
    // result body is just the warning text (empty-output branch in withWarnings).
    const r = await searchCommand(store, 'zzzznomatch ~/.aws/credentials');
    expect(r.output).toContain('Warning:');
    expect(r.output).not.toContain('##');
  });

  it('prepends a warning when the query mentions a credential path', async () => {
    await writeCard('a', 'title: A', 'about config files');
    const r = await searchCommand(store, 'config ~/.aws/credentials', { list: false });
    expect(r.output).toContain('Warning:');
  });

  it('returns empty output when the query tokenizes to nothing', async () => {
    await writeCard('a', 'title: A', 'body');
    // Pure punctuation yields no token segments, so keyword search short-circuits.
    const r = await searchCommand(store, '!!!');
    expect(r.output).toBe('');
  });

  it('falls back to the slug when a listed card has no title', async () => {
    await writeFile(join(cardsDir, 'no-title.md'), 'just a body, no frontmatter', 'utf-8');
    store.invalidateCache();
    const r = await searchCommand(store, undefined, { list: true });
    expect(r.output).toContain('no-title');
  });

  it('searches additional directories and prefixes slugs when --all is set', async () => {
    await writeCard('main-card', 'title: Main', 'JWT token handling in main.');
    // A second searchable directory under the memex home.
    const notesDir = join(home, 'notes');
    await mkdir(notesDir, { recursive: true });
    await writeFile(join(notesDir, 'aux.md'), '---\ntitle: Aux\n---\nJWT notes in aux.', 'utf-8');
    const r = await searchCommand(store, 'jwt', {
      all: true,
      memexHome: home,
      config: { nestedSlugs: false, searchDirs: ['notes'] },
    });
    // Results from the extra dir are prefixed with the directory name.
    expect(r.output).toContain('notes/aux');
    expect(r.totalCount).toBe(2);
  });

  it('lists across additional directories with prefixes when --all and --list are set', async () => {
    await writeCard('main-card', 'title: Main', 'body');
    const notesDir = join(home, 'notes');
    await mkdir(notesDir, { recursive: true });
    await writeFile(join(notesDir, 'aux.md'), '---\ntitle: Aux\n---\nbody', 'utf-8');
    const r = await searchCommand(store, undefined, {
      all: true,
      list: true,
      memexHome: home,
      config: { nestedSlugs: false, searchDirs: ['notes'] },
    });
    expect(r.output).toContain('notes/aux');
    expect(r.output).toContain('main-card');
  });

  describe('manifest filter', () => {
    beforeEach(async () => {
      await writeCard('sec', 'title: Sec\ncategory: security\ntags: [auth, jwt]\nauthor: alice\ncreated: 2026-01-01', 'secure body');
      await writeCard('web', 'title: Web\ncategory: web\ntag: frontend\nsource: bob\ncreated: 2026-06-01', 'web body');
    });

    it('filters by category', async () => {
      const r = await searchCommand(store, undefined, { filter: { category: 'security' }, list: true });
      expect(r.output).toContain('sec');
      expect(r.output).not.toContain('web ');
    });

    it('filters by tag in an array', async () => {
      const r = await searchCommand(store, undefined, { filter: { tag: 'jwt' }, list: true });
      expect(r.output).toContain('sec');
    });

    it('filters by a comma/single string tag', async () => {
      const r = await searchCommand(store, undefined, { filter: { tag: 'frontend' }, list: true });
      expect(r.output).toContain('web');
    });

    it('filters by author or source', async () => {
      const r1 = await searchCommand(store, undefined, { filter: { author: 'alice' }, list: true });
      expect(r1.output).toContain('sec');
      const r2 = await searchCommand(store, undefined, { filter: { author: 'bob' }, list: true });
      expect(r2.output).toContain('web');
    });

    it('filters by since and before dates', async () => {
      const since = await searchCommand(store, undefined, { filter: { since: '2026-03-01' }, list: true });
      expect(since.output).toContain('web');
      expect(since.output).not.toContain('sec ');
      const before = await searchCommand(store, undefined, { filter: { before: '2026-03-01' }, list: true });
      expect(before.output).toContain('sec');
    });

    it('returns empty output when the filter excludes everything', async () => {
      const r = await searchCommand(store, undefined, { filter: { category: 'nonexistent' }, list: true });
      expect(r.output).toBe('');
    });

    it('compares quoted (string) frontmatter dates', async () => {
      // Quoting forces YAML to keep the date as a string, exercising the string
      // arm of toDateString (unquoted dates parse to Date objects instead).
      await writeCard('strdate', "title: StrDate\ncreated: '2026-02-15'", 'string-dated body');
      const since = await searchCommand(store, undefined, { filter: { since: '2026-02-01' }, list: true });
      expect(since.output).toContain('strdate');
      const before = await searchCommand(store, undefined, { filter: { before: '2026-03-01' }, list: true });
      expect(before.output).toContain('strdate');
    });

    it('excludes a card with no tags when filtering by tag', async () => {
      await writeCard('untagged', 'title: Untagged', 'no tags here');
      const r = await searchCommand(store, undefined, { filter: { tag: 'jwt' }, list: true });
      expect(r.output).not.toContain('untagged');
      expect(r.output).toContain('sec');
    });
  });
});
