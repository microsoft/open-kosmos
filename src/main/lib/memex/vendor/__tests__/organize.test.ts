import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardStore } from '../lib/store';
import { organizeCommand } from '../commands/organize';

// Direct unit tests for the vendored organize command. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file against
// real on-disk cards.

let home: string;
let cardsDir: string;
let store: CardStore;

async function writeCard(slug: string, frontmatter: string, body: string): Promise<void> {
  await writeFile(join(cardsDir, `${slug}.md`), `---\n${frontmatter}\n---\n${body}`, 'utf-8');
  store.invalidateCache();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memex-organize-'));
  cardsDir = join(home, 'cards');
  await mkdir(cardsDir, { recursive: true });
  store = new CardStore(cardsDir, join(home, 'archive'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('organizeCommand', () => {
  it('reports no cards when the store is empty', async () => {
    const r = await organizeCommand(store, null);
    expect(r.output).toBe('No cards yet.');
    expect(r.exitCode).toBe(0);
  });

  it('produces a report with link stats and an orphans section', async () => {
    await writeCard('a', 'title: A', 'links to [[b]]');
    await writeCard('b', 'title: B', 'standalone');
    const r = await organizeCommand(store, null);
    expect(r.output).toContain('# Organize Report');
    expect(r.output).toContain('## Link Stats');
    expect(r.output).toContain('## Orphans');
    // 'a' has no inbound links and is not the index card → it is an orphan.
    expect(r.output).toContain('- a');
  });

  it('excludes the index card from orphans', async () => {
    await writeCard('index', 'title: Index', 'the map');
    const r = await organizeCommand(store, null);
    // index is the only card and is excluded from orphans, so no orphan section.
    expect(r.output).not.toContain('## Orphans');
  });

  it('lists unresolved conflict cards', async () => {
    await writeCard('clash', 'title: Clash\nstatus: conflict', 'conflicting content');
    const r = await organizeCommand(store, null);
    expect(r.output).toContain('## Unresolved Conflicts');
    expect(r.output).toContain('- clash');
  });

  it('reports recently modified neighbor pairs on the first run', async () => {
    await writeCard('a', 'title: A', 'links to [[b]]');
    await writeCard('b', 'title: B', 'content for b');
    const r = await organizeCommand(store, null);
    expect(r.output).toContain('## Recently Modified Cards + Neighbors');
    expect(r.output).toContain('### a ↔ b');
  });

  it('honors the lastOrganize cutoff for recent cards', async () => {
    await writeCard('old', 'title: Old\nmodified: 2020-01-01', 'links to [[fresh]]');
    await writeCard('fresh', 'title: Fresh\nmodified: 2026-06-01', 'recent content');
    const r = await organizeCommand(store, '2026-01-01');
    // 'old' is before the cutoff, so the old↔fresh pair is not surfaced as recent.
    expect(r.output).not.toContain('### old ↔ fresh');
  });

  it('renders a hub when a card has many inbound links', async () => {
    // Create 10 cards that all link to 'hub' so hub crosses the >= 10 threshold.
    for (let i = 0; i < 10; i++) {
      await writeCard(`src${i}`, `title: Src ${i}`, 'points to [[hub]]');
    }
    await writeCard('hub', 'title: Hub', 'central card');
    const r = await organizeCommand(store, null);
    expect(r.output).toContain('## Hubs');
    expect(r.output).toContain('- hub');
  });

  it('emits a JSON report when json is set', async () => {
    await writeCard('a', 'title: A', 'links to [[b]]');
    await writeCard('b', 'title: B', 'standalone');
    const r = await organizeCommand(store, null, true);
    const parsed = JSON.parse(r.output);
    expect(parsed).toHaveProperty('stats');
    expect(parsed).toHaveProperty('orphans');
    expect(parsed).toHaveProperty('hubs');
    expect(parsed).toHaveProperty('conflicts');
    expect(parsed).toHaveProperty('recentPairs');
  });

  it('falls back to slugs in JSON for hubs, conflicts, and orphans without titles', async () => {
    // 10 untitled sources make 'hub' a hub; an untitled conflict card; the sources
    // themselves are untitled orphans. All exercise the `?? slug` fallback arms.
    for (let i = 0; i < 10; i++) {
      await writeCard(`s${i}`, 'status: ok', 'points to [[hub]]');
    }
    await writeCard('hub', '', 'central');
    await writeCard('clash', 'status: conflict', 'conflicting');
    const r = await organizeCommand(store, null, true);
    const parsed = JSON.parse(r.output);
    expect(parsed.hubs[0].slug).toBe('hub');
    expect(parsed.hubs[0].title).toBe('hub'); // fallback to slug
    expect(parsed.conflicts.some((c: { slug: string }) => c.slug === 'clash')).toBe(true);
    expect(parsed.orphans.length).toBeGreaterThan(0);
  });

  it('tolerates dangling links to non-existent neighbor cards', async () => {
    // The link target has no card, so its cardData lookup is undefined and the
    // neighbor loop skips it (the `if (!neighborInfo) continue` arm).
    await writeCard('a', 'title: A', 'links to [[ghost]]');
    const r = await organizeCommand(store, null);
    expect(r.exitCode).toBe(0);
    expect(r.output).not.toContain('ghost');
  });

  it('deduplicates mutually-linked neighbor pairs', async () => {
    // a↔b link each other; the pair key is seen twice but emitted once.
    await writeCard('a', 'title: A', 'links to [[b]]');
    await writeCard('b', 'title: B', 'links back to [[a]]');
    const r = await organizeCommand(store, null);
    const occurrences = (r.output.match(/### a ↔ b/g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('surfaces no recent pairs when every card predates the cutoff', async () => {
    await writeCard('a', 'title: A\nmodified: 2020-01-01', 'links to [[b]]');
    await writeCard('b', 'title: B\nmodified: 2020-01-02', 'content');
    const r = await organizeCommand(store, '2030-01-01');
    expect(r.output).not.toContain('## Recently Modified Cards');
  });

  it('caps neighbor pairs at 20 and notes how many more exist', async () => {
    // One hub linking to 21 distinct cards yields 21 pairs → the >20 cap message.
    const targets = Array.from({ length: 21 }, (_, i) => `[[t${i}]]`).join(' ');
    await writeCard('hub', 'title: Hub', `links to ${targets}`);
    for (let i = 0; i < 21; i++) {
      await writeCard(`t${i}`, `title: T${i}`, 'leaf');
    }
    const r = await organizeCommand(store, null);
    expect(r.output).toContain('more pairs not shown');
  });
});
