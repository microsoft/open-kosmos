import { describe, it, expect } from 'vitest';
import {
  formatCardList,
  formatSearchResult,
  formatLinkStats,
  formatCompactSearchResult,
  formatCardLinks,
} from '../lib/formatter';

// Direct unit tests for the vendored pure string formatters. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file.

describe('formatCardList', () => {
  it('returns an empty string for no cards', () => {
    expect(formatCardList([])).toBe('');
  });

  it('aligns titles by padding to the longest slug', () => {
    const out = formatCardList([
      { slug: 'a', title: 'Short' },
      { slug: 'longer-slug', title: 'Long' },
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    // Both titles start at the same column (longest slug + 2 padding).
    expect(lines[0]).toBe('a            Short');
    expect(lines[1]).toBe('longer-slug  Long');
  });
});

describe('formatSearchResult', () => {
  it('renders a match line with the English "Match:" label', () => {
    const out = formatSearchResult({
      slug: 'card',
      title: 'Title',
      firstParagraph: 'Para',
      matchLine: 'the matched line',
      links: [],
    });
    expect(out).toContain('## card');
    expect(out).toContain('> Match: the matched line');
  });

  it('falls back to matched fields when there is no match line', () => {
    const out = formatSearchResult({
      slug: 'card',
      title: 'Title',
      firstParagraph: 'Para',
      matchLine: null,
      links: [],
      matchedFields: ['tag:auth', 'body:JWT'],
    });
    expect(out).toContain('> Matched: tag:auth, body:JWT');
  });

  it('renders wikilinks when present', () => {
    const out = formatSearchResult({
      slug: 'card',
      title: 'Title',
      firstParagraph: 'Para',
      matchLine: null,
      links: ['alpha', 'beta'],
    });
    expect(out).toContain('Links: [[alpha]], [[beta]]');
  });

  it('omits both match and matched-fields lines when neither is available', () => {
    const out = formatSearchResult({
      slug: 'card',
      title: 'Title',
      firstParagraph: 'Para',
      matchLine: null,
      links: [],
      matchedFields: [],
    });
    expect(out).not.toContain('> Match');
    expect(out).not.toContain('Links:');
  });
});

describe('formatLinkStats', () => {
  it('returns an empty string for no stats', () => {
    expect(formatLinkStats([])).toBe('');
  });

  it('labels orphans, hubs, and normal cards', () => {
    const out = formatLinkStats([
      { slug: 'orphan-card', outbound: 1, inbound: 0 },
      { slug: 'hub-card', outbound: 2, inbound: 12 },
      { slug: 'normal-card', outbound: 1, inbound: 3 },
    ]);
    const lines = out.split('\n');
    expect(lines[0]).toContain('slug');
    expect(out).toContain('orphan');
    expect(out).toContain('hub');
    // The normal card row has no status label appended.
    const normalRow = lines.find((l) => l.startsWith('normal-card'));
    expect(normalRow?.trimEnd().endsWith('3')).toBe(true);
  });
});

describe('formatCompactSearchResult', () => {
  it('omits the score when none is provided', () => {
    const out = formatCompactSearchResult({
      slug: 'card',
      title: 'Title',
      firstParagraph: '',
      matchLine: null,
      links: [],
    });
    expect(out).toBe('card  Title');
  });

  it('appends a two-decimal score when provided', () => {
    const out = formatCompactSearchResult(
      {
        slug: 'card',
        title: 'Title',
        firstParagraph: '',
        matchLine: null,
        links: [],
      },
      0.5,
    );
    expect(out).toBe('card  Title  [0.50]');
  });
});

describe('formatCardLinks', () => {
  it('renders outbound and inbound link sections', () => {
    const out = formatCardLinks('card', ['a', 'b'], ['c']);
    expect(out).toContain('## card');
    expect(out).toContain('Outbound: [[a]], [[b]]');
    expect(out).toContain('Inbound:  [[c]]');
  });

  it('shows (none) when a section has no links', () => {
    const out = formatCardLinks('card', [], []);
    expect(out).toContain('Outbound: (none)');
    expect(out).toContain('Inbound:  (none)');
  });
});
