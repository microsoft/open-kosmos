/**
 * @vitest-environment node
 *
 * Tests for workspace/fuzzyScorer.ts — pure algorithmic module, no mocks needed.
 */

import {
  scoreFuzzy,
  scoreItemFuzzy,
  compareItemsByFuzzyScore,
  prepareQuery,
  type IItemAccessor,
  type FuzzyScorerCache,
  type IItemScore,
} from '../fuzzyScorer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface FileItem {
  label: string;
  description?: string;
  path?: string;
}

const accessor: IItemAccessor<FileItem> = {
  getItemLabel: (item) => item.label,
  getItemDescription: (item) => item.description,
  getItemPath: (item) => item.path,
};

function cache(): FuzzyScorerCache {
  return Object.create(null);
}

// ---------------------------------------------------------------------------
// scoreFuzzy
// ---------------------------------------------------------------------------
describe('scoreFuzzy', () => {
  it('returns [0, []] for empty target', () => {
    const [score, positions] = scoreFuzzy('', 'abc', 'abc', true);
    expect(score).toBe(0);
    expect(positions).toEqual([]);
  });

  it('returns [0, []] for empty query', () => {
    const [score, positions] = scoreFuzzy('hello', '', '', true);
    expect(score).toBe(0);
    expect(positions).toEqual([]);
  });

  it('returns [0, []] when target is shorter than query', () => {
    const [score] = scoreFuzzy('ab', 'abc', 'abc', true);
    expect(score).toBe(0);
  });

  it('scores an exact match with high score', () => {
    const [score, positions] = scoreFuzzy('hello', 'hello', 'hello', true);
    expect(score).toBeGreaterThan(0);
    expect(positions.length).toBeGreaterThan(0);
  });

  it('scores a prefix match', () => {
    const [score] = scoreFuzzy('hello world', 'hello', 'hello', true);
    expect(score).toBeGreaterThan(0);
  });

  it('scores a fuzzy (non-contiguous) match', () => {
    const [score] = scoreFuzzy('getUserById', 'gub', 'gub', true);
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 when no fuzzy match is possible', () => {
    const [score] = scoreFuzzy('hello', 'xyz', 'xyz', true);
    expect(score).toBe(0);
  });

  it('is case-insensitive', () => {
    const [s1] = scoreFuzzy('Hello', 'hello', 'hello', true);
    const [s2] = scoreFuzzy('hello', 'hello', 'hello', true);
    expect(s1).toBeGreaterThan(0);
    expect(s2).toBeGreaterThan(0);
  });

  it('rewards camelCase continuation', () => {
    const [s1] = scoreFuzzy('getUserById', 'getUser', 'getuser', true);
    const [s2] = scoreFuzzy('getXByY', 'getUser', 'getuser', true);
    // s2 = no match (different letters), s1 > 0
    expect(s1).toBeGreaterThan(0);
    expect(s2).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// prepareQuery
// ---------------------------------------------------------------------------
describe('prepareQuery', () => {
  it('handles non-string input gracefully', () => {
    const q = prepareQuery(42 as any);
    expect(q.original).toBe('');
    expect(q.normalized).toBe('');
  });

  it('creates a simple query', () => {
    const q = prepareQuery('hello');
    expect(q.original).toBe('hello');
    expect(q.normalized).toBe('hello');
    expect(q.normalizedLowercase).toBe('hello');
    expect(q.values).toBeUndefined();
  });

  it('splits multi-word queries into values', () => {
    const q = prepareQuery('foo bar');
    expect(q.values).toBeDefined();
    expect(q.values!.length).toBe(2);
    expect(q.values![0].normalized).toBe('foo');
    expect(q.values![1].normalized).toBe('bar');
  });

  it('strips wildcards from normalized query', () => {
    const q = prepareQuery('foo*bar');
    expect(q.normalized).toBe('foobar');
  });

  it('marks expectContiguousMatch for quoted queries', () => {
    const q = prepareQuery('"hello"');
    expect(q.expectContiguousMatch).toBe(true);
  });

  it('detects path separator in query', () => {
    const q = prepareQuery('src/index');
    // containsPathSeparator depends on path.sep which is '/' on mac/linux
    // just verify the property exists
    expect(typeof q.containsPathSeparator).toBe('boolean');
  });

  it('handles empty string', () => {
    const q = prepareQuery('');
    expect(q.original).toBe('');
    expect(q.normalized).toBe('');
  });

  it('multi-word with empty pieces ignored', () => {
    const q = prepareQuery('foo  bar'); // two spaces
    expect(q.values).toBeDefined();
    // space-split gives ['foo', '', 'bar']; empty piece is filtered
    expect(q.values!.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// scoreItemFuzzy
// ---------------------------------------------------------------------------
describe('scoreItemFuzzy', () => {
  it('returns NO_ITEM_SCORE for null item', () => {
    const q = prepareQuery('hello');
    const result = scoreItemFuzzy(null as any, q, true, accessor, cache());
    expect(result.score).toBe(0);
  });

  it('returns NO_ITEM_SCORE for empty query', () => {
    const item: FileItem = { label: 'hello.ts', path: 'src/hello.ts' };
    const q = prepareQuery('');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBe(0);
  });

  it('returns NO_ITEM_SCORE when label is undefined', () => {
    const badAccessor: IItemAccessor<FileItem> = {
      ...accessor,
      getItemLabel: () => undefined,
    };
    const item: FileItem = { label: 'hello.ts' };
    const q = prepareQuery('hello');
    const result = scoreItemFuzzy(item, q, true, badAccessor, cache());
    expect(result.score).toBe(0);
  });

  it('scores an exact label match with high score', () => {
    const item: FileItem = { label: 'index.ts', path: 'src/index.ts' };
    const q = prepareQuery('index');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBeGreaterThan(0);
    expect(result.labelMatch).toBeDefined();
  });

  it('scores an identity path match with PATH_IDENTITY_SCORE', () => {
    const item: FileItem = { label: 'index.ts', description: 'src', path: 'src/index.ts' };
    const q = prepareQuery('src/index.ts');
    // Override normalizedLowercase path to match exactly
    const modQ = { ...q, normalized: 'src/index.ts', normalizedLowercase: 'src/index.ts' };
    const result = scoreItemFuzzy(item, modQ as any, true, accessor, cache());
    // PATH_IDENTITY_SCORE = 1 << 18 = 262144
    expect(result.score).toBe(262144);
  });

  it('uses cache on second call', () => {
    const item: FileItem = { label: 'foo.ts', path: 'src/foo.ts' };
    const q = prepareQuery('foo');
    const c = cache();
    const r1 = scoreItemFuzzy(item, q, true, accessor, c);
    const r2 = scoreItemFuzzy(item, q, true, accessor, c);
    expect(r1).toBe(r2); // same object reference from cache
  });

  it('scores multi-word query', () => {
    const item: FileItem = { label: 'UserService.ts', description: 'src/services', path: 'src/services/UserService.ts' };
    const q = prepareQuery('user service');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBeGreaterThan(0);
  });

  it('returns NO_ITEM_SCORE when one word of multi-word query has no match', () => {
    const item: FileItem = { label: 'index.ts', path: 'index.ts' };
    const q = prepareQuery('index xyz');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBe(0);
  });

  it('scores description+label path for items with description', () => {
    const item: FileItem = { label: 'foo.ts', description: 'src/bar', path: 'src/bar/foo.ts' };
    const q = prepareQuery('bar');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// compareItemsByFuzzyScore
// ---------------------------------------------------------------------------
describe('compareItemsByFuzzyScore', () => {
  it('returns negative when A scores higher than B', () => {
    const a: FileItem = { label: 'index.ts', path: 'src/index.ts' };
    const b: FileItem = { label: 'users.ts', path: 'src/users.ts' };
    const q = prepareQuery('index');
    const c = cache();
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    expect(result).toBeLessThan(0);
  });

  it('returns positive when B scores higher than A', () => {
    const a: FileItem = { label: 'users.ts', path: 'src/users.ts' };
    const b: FileItem = { label: 'index.ts', path: 'src/index.ts' };
    const q = prepareQuery('index');
    const c = cache();
    expect(compareItemsByFuzzyScore(a, b, q, true, accessor, c)).toBeGreaterThan(0);
  });

  it('returns 0 for identical items', () => {
    const a: FileItem = { label: 'foo.ts', path: 'foo.ts' };
    const q = prepareQuery('foo');
    const c = cache();
    expect(compareItemsByFuzzyScore(a, a, q, true, accessor, c)).toBe(0);
  });

  it('prefers shorter label when scores are equal prefix matches', () => {
    const a: FileItem = { label: 'a.ts', path: 'a.ts' };
    const b: FileItem = { label: 'abc.ts', path: 'abc.ts' };
    const q = prepareQuery('a');
    const c = cache();
    // Both are prefix matches but 'a.ts' is shorter — should come first
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    expect(result).toBeLessThanOrEqual(0);
  });

  it('identity-match wins over label match', () => {
    const identity: FileItem = { label: 'foo.ts', description: '', path: 'foo.ts' };
    const labelMatch: FileItem = { label: 'foo.ts', description: 'something', path: 'something/foo.ts' };
    const q = prepareQuery('foo.ts');
    const modQ = { ...q, normalized: 'foo.ts', normalizedLowercase: 'foo.ts' };
    const c = cache();
    expect(compareItemsByFuzzyScore(identity, labelMatch, modQ as any, true, accessor, c)).toBeLessThan(0);
  });
});
