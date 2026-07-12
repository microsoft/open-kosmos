import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CardStore } from '../lib/store';
import { linksCommand } from '../commands/links';

// Direct unit tests for the vendored links command. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file against
// real on-disk cards.

let home: string;
let cardsDir: string;
let store: CardStore;

async function writeCard(slug: string, body: string): Promise<void> {
  await writeFile(join(cardsDir, `${slug}.md`), `---\ntitle: ${slug}\n---\n${body}`, 'utf-8');
  store.invalidateCache();
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'memex-links-'));
  cardsDir = join(home, 'cards');
  await mkdir(cardsDir, { recursive: true });
  store = new CardStore(cardsDir, join(home, 'archive'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('linksCommand', () => {
  it('returns empty output when there are no cards', async () => {
    const r = await linksCommand(store, undefined);
    expect(r.output).toBe('');
    expect(r.exitCode).toBe(0);
  });

  it('reports outbound and inbound links for a single slug', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, 'a');
    expect(r.output).toContain('## a');
    expect(r.output).toContain('Outbound: [[b]]');
  });

  it('reports inbound links for the target slug', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'standalone');
    const r = await linksCommand(store, 'b');
    expect(r.output).toContain('Inbound:  [[a]]');
  });

  it('emits JSON for a single slug when json is set', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'x');
    const r = await linksCommand(store, 'a', { json: true });
    const parsed = JSON.parse(r.output);
    expect(parsed.slug).toBe('a');
    expect(parsed.outbound).toEqual(['b']);
  });

  it('renders a link stats table for all cards', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined);
    expect(r.output).toContain('slug');
    expect(r.output).toContain('orphan'); // a has 0 inbound
  });

  it('filters to orphans only', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined, { filter: 'orphan' });
    // a is an orphan (0 inbound); b has 1 inbound and is excluded.
    expect(r.output).toContain('a');
    expect(r.output.split('\n').some((l) => l.startsWith('b '))).toBe(false);
  });

  it('filters to hubs only (empty when none reach the threshold)', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined, { filter: 'hub' });
    // No card has >= 10 inbound, so only the header row remains.
    expect(r.output.split('\n').length).toBe(1);
  });

  it('produces a stats summary in text mode', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined, { stats: true });
    expect(r.output).toContain('Total cards: 2');
    expect(r.output).toContain('Orphans');
    expect(r.output).toContain('Avg outbound links');
  });

  it('produces a stats summary with a filter label', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined, { stats: true, filter: 'orphan' });
    expect(r.output).toContain('Showing: orphan');
  });

  it('emits aggregate JSON stats', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined, { stats: true, json: true });
    const parsed = JSON.parse(r.output);
    expect(parsed.totalCards).toBe(2);
    expect(parsed.showing).toBe('all');
    expect(parsed).toHaveProperty('avgInbound');
  });

  it('emits per-card JSON stats without the stats flag', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, undefined, { json: true });
    const parsed = JSON.parse(r.output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  it('reports zero outbound and inbound for an unknown slug', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'no links');
    const r = await linksCommand(store, 'ghost');
    // Unknown slug hits the `|| []` fallbacks for both maps → both sections empty.
    expect(r.output).toContain('Outbound: (none)');
    expect(r.output).toContain('Inbound:  (none)');
  });

  it('tolerates dangling links to non-existent cards', async () => {
    // The link target has no card, so resolveLink returns null and the code falls
    // back to the raw link text, which is absent from inboundMap (the `|| []` arm).
    await writeCard('a', 'links to [[nonexistent-target]]');
    const r = await linksCommand(store, 'a');
    expect(r.output).toContain('Outbound: [[nonexistent-target]]');
    expect(r.exitCode).toBe(0);
  });

  it('reports zeroed averages when a filter empties the stats (text summary)', async () => {
    // Both cards have inbound links, so the orphan filter yields an empty set and
    // the avg branches take their `stats.length > 0 ? ... : "0"` else arm.
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'links to [[a]]');
    const r = await linksCommand(store, undefined, { stats: true, filter: 'orphan' });
    expect(r.output).toContain('Avg outbound links: 0');
    expect(r.output).toContain('Avg inbound links: 0');
  });

  it('reports zeroed averages when a filter empties the stats (JSON summary)', async () => {
    await writeCard('a', 'links to [[b]]');
    await writeCard('b', 'links to [[a]]');
    const r = await linksCommand(store, undefined, { stats: true, json: true, filter: 'orphan' });
    const parsed = JSON.parse(r.output);
    expect(parsed.count).toBe(0);
    expect(parsed.avgOutbound).toBe(0);
    expect(parsed.avgInbound).toBe(0);
  });

  it('counts inbound links from extraLinkDirs', async () => {
    await writeCard('target', 'standalone card');
    const refsDir = join(home, 'refs');
    await mkdir(refsDir, { recursive: true });
    await writeFile(join(refsDir, 'note.md'), '---\ntitle: note\n---\nrefers to [[target]]', 'utf-8');
    const r = await linksCommand(store, 'target', { home, extraLinkDirs: ['refs'] });
    expect(r.output).toContain('Inbound:');
    expect(r.output).toContain('~note');
  });

  it('skips an extraLinkDir that points back at the cards directory', async () => {
    await writeCard('a', 'links to [[a]]');
    const r = await linksCommand(store, undefined, { home, extraLinkDirs: ['cards'] });
    // No crash; the self-referential extra dir is ignored.
    expect(r.exitCode).toBe(0);
  });
});
