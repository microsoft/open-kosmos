import { describe, it, expect } from 'vitest';
import {
  isCodeToken,
  tokenizeQuery,
  buildSearchableFields,
  scoreCard,
  meetsThreshold,
  sortScoredMatches,
  type ScoredMatch,
  type SearchableFields,
} from '../lib/scoring';

// Direct unit tests for the vendored lexical scoring engine. Vendored from
// iamtouchskyer/memex but in our tree, so tested like a first-party file. These
// functions are pure (no I/O), so we exercise the branch matrix directly.

describe('isCodeToken', () => {
  it('detects camelCase, ALLCAPS, digits, and path/dot separators as code', () => {
    expect(isCodeToken('camelCase')).toBe(true);
    expect(isCodeToken('API')).toBe(true);
    expect(isCodeToken('v2')).toBe(true);
    expect(isCodeToken('a.b')).toBe(true);
    expect(isCodeToken('a/b')).toBe(true);
    expect(isCodeToken('a_b')).toBe(true);
  });

  it('treats a plain lowercase word as non-code', () => {
    expect(isCodeToken('migration')).toBe(false);
  });
});

describe('tokenizeQuery', () => {
  it('extracts ASCII tokens and lowercases for matching', () => {
    const { tokens } = tokenizeQuery('JWT Migration');
    expect(tokens).toContain('jwt');
    expect(tokens).toContain('migration');
  });

  it('expands compound tokens into their parts', () => {
    const { tokens } = tokenizeQuery('jwt-migration');
    expect(tokens).toEqual(expect.arrayContaining(['jwt-migration', 'jwt', 'migration']));
  });

  it('removes stopwords but keeps content tokens', () => {
    const result = tokenizeQuery('how to fix the auth bug');
    expect(result.stopwordsRemoved).toEqual(expect.arrayContaining(['how', 'to', 'fix', 'the']));
    expect(result.tokens).toEqual(expect.arrayContaining(['auth', 'bug']));
  });

  it('falls back to the original tokens when every token is a stopword', () => {
    const result = tokenizeQuery('how the');
    expect(result.tokens.length).toBeGreaterThan(0);
    expect(result.stopwordsRemoved).toEqual([]);
  });

  it('extracts CJK fragments alongside ASCII', () => {
    const { tokens } = tokenizeQuery('auth 认证');
    expect(tokens).toContain('auth');
    expect(tokens.some((t) => t.includes('认证'))).toBe(true);
  });

  it('deduplicates case-insensitively, keeping first-seen original casing', () => {
    const result = tokenizeQuery('JWT jwt');
    const lowerCount = result.tokens.filter((t) => t === 'jwt').length;
    expect(lowerCount).toBe(1);
    expect(result.originalTokens).toContain('JWT');
  });
});

describe('buildSearchableFields', () => {
  it('uses the title from frontmatter and parses array tags', () => {
    const f = buildSearchableFields(
      'my-slug',
      { title: 'My Title', tags: ['Auth', ' jwt '], category: 'security' },
      '# Heading One\n\nBody text with JWT.',
      ['linked-card'],
    );
    expect(f.title).toBe('My Title');
    expect(f.tags).toEqual(['Auth', 'jwt']);
    expect(f.category).toBe('security');
    expect(f.headings).toEqual(['Heading One']);
    expect(f.wikilinks).toEqual(['linked-card']);
  });

  it('falls back to the slug when no title is present', () => {
    const f = buildSearchableFields('fallback-slug', {}, 'body', []);
    expect(f.title).toBe('fallback-slug');
  });

  it('parses comma-separated string tags and reads the singular tag key', () => {
    const f = buildSearchableFields('s', { tag: 'red, green ,blue' }, 'body', []);
    expect(f.tags).toEqual(['red', 'green', 'blue']);
  });

  it('defaults category to empty string when not a string', () => {
    const f = buildSearchableFields('s', { category: 123 }, 'body', []);
    expect(f.category).toBe('');
  });
});

describe('scoreCard', () => {
  const base = (over: Partial<SearchableFields>): SearchableFields => ({
    slug: 'card',
    title: 'Title',
    tags: [],
    category: '',
    headings: [],
    wikilinks: [],
    body: '',
    bodyLines: [],
    ...over,
  });

  it('returns null when there are no tokens', () => {
    expect(scoreCard([], [], base({}))).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(scoreCard(['zzz'], ['zzz'], base({ body: 'unrelated content' }))).toBeNull();
  });

  it('matches a slug segment and reports the field', () => {
    const fields = base({ slug: 'jwt-auth' });
    const match = scoreCard(['jwt'], ['jwt'], fields);
    expect(match).not.toBeNull();
    expect(match!.matchedFields).toContain('slug:jwt');
  });

  it('matches a title segment', () => {
    const fields = base({ title: 'Token Refresh Flow' });
    const match = scoreCard(['refresh'], ['refresh'], fields);
    expect(match!.matchedFields.some((f) => f.startsWith('title:'))).toBe(true);
  });

  it('matches an exact tag at full weight', () => {
    const fields = base({ tags: ['auth'] });
    const match = scoreCard(['auth'], ['auth'], fields);
    expect(match!.matchedFields).toContain('tags:auth');
  });

  it('matches a tag segment at reduced weight', () => {
    const fields = base({ tags: ['user-auth'] });
    const match = scoreCard(['auth'], ['auth'], fields);
    expect(match).not.toBeNull();
  });

  it('matches an exact category and a category segment', () => {
    expect(scoreCard(['security'], ['security'], base({ category: 'security' }))).not.toBeNull();
    expect(scoreCard(['web'], ['web'], base({ category: 'web-dev' }))).not.toBeNull();
  });

  it('matches a heading on a word boundary with a code-token boost', () => {
    const fields = base({ headings: ['Configure OAuth2'] });
    const match = scoreCard(['oauth2'], ['OAuth2'], fields);
    expect(match!.matchedFields.some((f) => f.startsWith('headings:'))).toBe(true);
  });

  it('matches a wikilink segment', () => {
    const fields = base({ wikilinks: ['jwt-guide'] });
    const match = scoreCard(['jwt'], ['jwt'], fields);
    expect(match).not.toBeNull();
  });

  it('matches body text on a word boundary and surfaces a match line', () => {
    const fields = base({
      body: 'This card explains JWT tokens.',
      bodyLines: ['This card explains JWT tokens.'],
    });
    const match = scoreCard(['jwt'], ['JWT'], fields);
    expect(match!.matchLine).toContain('JWT');
  });

  it('matches CJK tokens via substring in body and headings', () => {
    const fields = base({
      headings: ['认证流程'],
      body: '认证 is the topic',
      bodyLines: ['认证 is the topic'],
    });
    const match = scoreCard(['认证'], ['认证'], fields);
    expect(match).not.toBeNull();
    expect(match!.matchLine).toContain('认证');
  });

  it('drops low-coverage long queries without a high-signal match', () => {
    // 5 effective tokens, only a single low-signal body word matches → below threshold.
    const fields = base({ body: 'config', bodyLines: ['config'] });
    const match = scoreCard(
      ['config', 'alpha', 'beta', 'gamma', 'delta'],
      ['config', 'alpha', 'beta', 'gamma', 'delta'],
      fields,
    );
    expect(match).toBeNull();
  });

  it('keeps a long query when a high-signal tag matches', () => {
    const fields = base({ tags: ['auth'] });
    const match = scoreCard(
      ['auth', 'alpha', 'beta', 'gamma', 'delta'],
      ['auth', 'alpha', 'beta', 'gamma', 'delta'],
      fields,
    );
    expect(match).not.toBeNull();
  });

  it('penalizes a low-signal token that matches a slug or title', () => {
    // "config" is in LOW_SIGNAL_TOKENS, so a slug/title hit takes the penalty arm.
    const slugMatch = scoreCard(['config'], ['config'], base({ slug: 'config' }));
    expect(slugMatch).not.toBeNull();
    const titleMatch = scoreCard(['config'], ['config'], base({ title: 'config' }));
    expect(titleMatch).not.toBeNull();
  });

  it('matches an ASCII heading without a code-token boost', () => {
    // "auth" is a plain lowercase word (non-code), exercising the no-boost arm.
    const fields = base({ headings: ['Auth Overview'] });
    const match = scoreCard(['auth'], ['auth'], fields);
    expect(match!.matchedFields.some((f) => f.startsWith('headings:'))).toBe(true);
  });

  it('matches a CJK token in a heading', () => {
    const fields = base({ headings: ['配置认证'] });
    const match = scoreCard(['认证'], ['认证'], fields);
    expect(match).not.toBeNull();
  });

  it('skips wikilinks that do not contain the token segment', () => {
    // First wikilink has no matching segment; the loop continues to the next.
    const fields = base({ wikilinks: ['other-guide', 'jwt-notes'] });
    const match = scoreCard(['jwt'], ['jwt'], fields);
    expect(match).not.toBeNull();
  });

  it('records only the first match index across multiple matching tokens', () => {
    const fields = base({
      slug: 'jwt-auth',
      body: 'covers refresh tokens',
      bodyLines: ['covers refresh tokens'],
    });
    const match = scoreCard(['jwt', 'refresh'], ['jwt', 'refresh'], fields);
    expect(match!.firstMatchIndex).toBe(0);
    expect(match!.matchedTokens).toBe(2);
  });

  it('handles compound query tokens that expand to a single part', () => {
    // "foo-" matches the separator test but splits into a single part, taking the
    // arm where no additional sub-tokens are added.
    const { tokens } = tokenizeQuery('foo-');
    expect(tokens).toContain('foo-');
  });

  it('does not grant high-signal exemption to a stopword slug match on a long query', () => {
    // "from" is a stopword; even though it matches the slug, it must not exempt
    // the long query from the coverage threshold, so the card is dropped.
    const fields = base({ slug: 'from' });
    const match = scoreCard(
      ['from', 'alpha', 'beta', 'gamma', 'delta'],
      ['from', 'alpha', 'beta', 'gamma', 'delta'],
      fields,
    );
    expect(match).toBeNull();
  });

  it('grants high-signal exemption to a CJK slug match on a long query', () => {
    const fields = base({ slug: '认证' });
    const match = scoreCard(
      ['认证', 'alpha', 'beta', 'gamma', 'delta'],
      ['认证', 'alpha', 'beta', 'gamma', 'delta'],
      fields,
    );
    expect(match).not.toBeNull();
  });

  it('does not exempt a very short non-code title token on a long query', () => {
    // "ab" is < 3 chars and not a code token → no high-signal exemption, and the
    // single low-coverage match fails the long-query threshold.
    const fields = base({ title: 'ab' });
    const match = scoreCard(
      ['ab', 'alpha', 'beta', 'gamma', 'delta'],
      ['ab', 'alpha', 'beta', 'gamma', 'delta'],
      fields,
    );
    expect(match).toBeNull();
  });
});

describe('meetsThreshold', () => {
  it('always passes for short queries (< 4 effective tokens)', () => {
    expect(meetsThreshold(3, 1, false)).toBe(true);
  });

  it('passes long queries when a high-signal match is present', () => {
    expect(meetsThreshold(6, 1, true)).toBe(true);
  });

  it('requires sufficient coverage for long queries without high signal', () => {
    expect(meetsThreshold(6, 1, false)).toBe(false);
    expect(meetsThreshold(6, 2, false)).toBe(true);
  });
});

describe('sortScoredMatches', () => {
  const mk = (over: Partial<ScoredMatch>): ScoredMatch => ({
    slug: 's',
    score: 0,
    coverage: 0,
    matchedTokens: 0,
    effectiveTokens: 1,
    firstMatchIndex: 0,
    matchLine: '',
    matchedFields: [],
    ...over,
  });

  it('orders by score desc, then coverage, then firstMatchIndex, then slug', () => {
    const sorted = sortScoredMatches([
      mk({ slug: 'low', score: 0.1 }),
      mk({ slug: 'high', score: 0.9 }),
    ]);
    expect(sorted[0].slug).toBe('high');
  });

  it('breaks score ties by coverage', () => {
    const sorted = sortScoredMatches([
      mk({ slug: 'a', score: 0.5, coverage: 0.2 }),
      mk({ slug: 'b', score: 0.5, coverage: 0.8 }),
    ]);
    expect(sorted[0].slug).toBe('b');
  });

  it('breaks score+coverage ties by earliest match index', () => {
    const sorted = sortScoredMatches([
      mk({ slug: 'a', score: 0.5, coverage: 0.5, firstMatchIndex: 3 }),
      mk({ slug: 'b', score: 0.5, coverage: 0.5, firstMatchIndex: 1 }),
    ]);
    expect(sorted[0].slug).toBe('b');
  });

  it('breaks remaining ties alphabetically by slug', () => {
    const sorted = sortScoredMatches([
      mk({ slug: 'zebra', score: 0.5, coverage: 0.5, firstMatchIndex: 0 }),
      mk({ slug: 'apple', score: 0.5, coverage: 0.5, firstMatchIndex: 0 }),
    ]);
    expect(sorted[0].slug).toBe('apple');
  });
});
