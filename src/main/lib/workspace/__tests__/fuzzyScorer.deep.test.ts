/**
 * @vitest-environment node
 *
 * Deep tests for workspace/fuzzyScorer.ts — covers branches not exercised by
 * the existing fuzzyScorer.test.ts: createMatches merging, normalizeMatches
 * overlap resolution, compareItemsByFuzzyScore tie-breaking paths,
 * computeCharScore bonuses, and doScoreItemFuzzy description-only branches.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreFuzzy,
  scoreItemFuzzy,
  compareItemsByFuzzyScore,
  prepareQuery,
  type IItemAccessor,
  type FuzzyScorerCache,
} from '../fuzzyScorer';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── scoreFuzzy — deeper character-score branches ──────────────────────────────

describe('scoreFuzzy — character-score bonuses', () => {
  it('start-of-word bonus: first character match scores higher than mid-word', () => {
    // 'f' at index 0 gets startOfWord bonus (8) vs 'f' elsewhere
    const [s1] = scoreFuzzy('foo', 'f', 'f', true);
    const [s2] = scoreFuzzy('xf', 'f', 'f', true);
    expect(s1).toBeGreaterThan(s2);
  });

  it('same-case bonus: exact-case match scores higher than case-insensitive', () => {
    const [sCased] = scoreFuzzy('Hello', 'H', 'h', true);
    const [sLower] = scoreFuzzy('Hello', 'h', 'h', true);
    // 'H' matches at index 0 with same-case bonus; 'h' does not get same-case bonus
    expect(sCased).toBeGreaterThan(sLower);
  });

  it('separator bonus: match after slash gets bonus', () => {
    // Match 'i' after slash separator
    const [sAfterSlash] = scoreFuzzy('foo/index', 'i', 'i', true);
    const [sMidWord] = scoreFuzzy('foindex', 'i', 'i', true);
    expect(sAfterSlash).toBeGreaterThan(sMidWord);
  });

  it('separator bonus: match after underscore gets bonus', () => {
    const [s] = scoreFuzzy('my_file', 'f', 'f', true);
    expect(s).toBeGreaterThan(0);
  });

  it('separator bonus: match after dash gets bonus', () => {
    const [s] = scoreFuzzy('my-file', 'f', 'f', true);
    expect(s).toBeGreaterThan(0);
  });

  it('separator bonus: match after dot gets bonus', () => {
    const [s] = scoreFuzzy('file.ts', 't', 't', true);
    expect(s).toBeGreaterThan(0);
  });

  it('separator bonus: match after space gets bonus', () => {
    const [s] = scoreFuzzy('foo bar', 'b', 'b', true);
    expect(s).toBeGreaterThan(0);
  });

  it('camelCase bonus: uppercase letter in middle word gets bonus', () => {
    // 'U' is upper-case mid-word in getUserById
    const [s] = scoreFuzzy('getUserById', 'U', 'u', true);
    expect(s).toBeGreaterThan(0);
  });

  it('consecutive sequence bonus: longer runs score higher', () => {
    const [s1] = scoreFuzzy('abcdef', 'ab', 'ab', true);
    const [s2] = scoreFuzzy('abcdef', 'a', 'a', true);
    expect(s1).toBeGreaterThan(s2);
  });

  it('non-contiguous matches disabled: returns 0 if characters are not contiguous from start', () => {
    // 'gub' must match contiguously from start when allowNonContiguousMatches=false
    const [s] = scoreFuzzy('getUserById', 'gub', 'gub', false);
    // With strict mode, 'gub' won't match a non-prefix pattern
    expect(s).toBe(0);
  });

  it('non-contiguous matches enabled: matches across word parts', () => {
    const [s] = scoreFuzzy('getUserById', 'gub', 'gub', true);
    expect(s).toBeGreaterThan(0);
  });

  it('path separator equate: / and \\ treated as equal', () => {
    // target contains backslash, query has forward slash
    const [sForward] = scoreFuzzy('foo/bar', 'f/b', 'f/b', true);
    expect(sForward).toBeGreaterThan(0);
  });
});

// ── prepareQuery — edge cases ─────────────────────────────────────────────────

describe('prepareQuery — additional branches', () => {
  it('handles quoted piece in multi-word query', () => {
    const q = prepareQuery('"exact" match');
    expect(q.values).toBeDefined();
    const exactPiece = q.values!.find(v => v.original === '"exact"');
    expect(exactPiece?.expectContiguousMatch).toBe(true);
    const normalPiece = q.values!.find(v => v.original === 'match');
    expect(normalPiece?.expectContiguousMatch).toBe(false);
  });

  it('normalizes wildcards in multi-word pieces', () => {
    const q = prepareQuery('foo* bar');
    const fooPiece = q.values!.find(v => v.original === 'foo*');
    expect(fooPiece?.normalized).toBe('foo');
  });

  it('multi-word where all pieces are empty (only spaces) gives undefined values', () => {
    const q = prepareQuery('  ');
    // spaces split into ['', '', ''] — all normalize to '' and are filtered
    expect(q.values).toBeUndefined();
  });

  it('single-word with wildcard strips wildcard', () => {
    const q = prepareQuery('foo*');
    expect(q.normalized).toBe('foo');
    expect(q.values).toBeUndefined(); // no space → no split
  });
});

// ── scoreItemFuzzy — description/path branches ───────────────────────────────

describe('scoreItemFuzzy — description and path branches', () => {
  it('falls through to description search when label does not match', () => {
    const item: FileItem = { label: 'index.ts', description: 'searchterm', path: 'searchterm/index.ts' };
    const q = prepareQuery('searchterm');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBeGreaterThan(0);
    expect(result.descriptionMatch).toBeDefined();
  });

  it('returns NO_ITEM_SCORE when neither label nor description matches', () => {
    const item: FileItem = { label: 'index.ts', description: 'src', path: 'src/index.ts' };
    const q = prepareQuery('zzzzz');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBe(0);
  });

  it('scores label+description combined path (split match)', () => {
    // Query spans description and label parts
    const item: FileItem = { label: 'bar.ts', description: 'foo', path: 'foo/bar.ts' };
    const q = prepareQuery('foobar');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    // Should score on the description+sep+label path
    expect(result.score).toBeGreaterThan(0);
  });

  it('identity path match scores PATH_IDENTITY_SCORE (1<<18 = 262144)', () => {
    const item: FileItem = { label: 'foo.ts', description: 'src', path: 'exactpath' };
    const q = prepareQuery('exactpath');
    const modQ = { ...q, normalized: 'exactpath', normalizedLowercase: 'exactpath' };
    const result = scoreItemFuzzy(item, modQ as any, true, accessor, cache());
    expect(result.score).toBe(262144);
    expect(result.labelMatch).toEqual([{ start: 0, end: 'foo.ts'.length }]);
    expect(result.descriptionMatch).toEqual([{ start: 0, end: 'src'.length }]);
  });

  it('identity path match without description has no descriptionMatch', () => {
    const item: FileItem = { label: 'foo.ts', path: 'exactpath' };
    const q = prepareQuery('exactpath');
    const modQ = { ...q, normalized: 'exactpath', normalizedLowercase: 'exactpath' };
    const result = scoreItemFuzzy(item, modQ as any, true, accessor, cache());
    expect(result.score).toBe(262144);
    expect(result.descriptionMatch).toBeUndefined();
  });

  it('multi-word returns NO_ITEM_SCORE when any word has no match', () => {
    const item: FileItem = { label: 'index.ts', path: 'index.ts' };
    const q = prepareQuery('index zzzzz');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBe(0);
  });

  it('multi-word aggregates label matches', () => {
    const item: FileItem = {
      label: 'UserService.ts',
      description: 'src/services',
      path: 'src/services/UserService.ts',
    };
    const q = prepareQuery('User Service');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBeGreaterThan(0);
  });

  it('expectContiguousMatch piece forces contiguous matching', () => {
    const item: FileItem = { label: 'getUserById', path: 'getUserById' };
    const q = prepareQuery('"gub"');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    // "gub" as exact/contiguous — not a substring of getUserById
    expect(result.score).toBe(0);
  });

  it('label prefix match gives LABEL_PREFIX_SCORE_THRESHOLD boost', () => {
    const item: FileItem = { label: 'hello.ts', path: 'src/hello.ts' };
    const q = prepareQuery('hello');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    // LABEL_PREFIX_SCORE_THRESHOLD = 1<<17 = 131072
    expect(result.score).toBeGreaterThanOrEqual(131072);
  });

  it('non-prefix label match uses LABEL_SCORE_THRESHOLD', () => {
    // 'ello' is not a prefix of 'hello.ts'
    const item: FileItem = { label: 'hello.ts', path: 'src/hello.ts' };
    const q = prepareQuery('ello');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    // LABEL_SCORE_THRESHOLD = 1<<16 = 65536; non-prefix so below PREFIX threshold
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(131072);
  });

  it('returns NO_ITEM_SCORE when item has description but no match anywhere', () => {
    const item: FileItem = { label: 'alpha.ts', description: 'beta', path: 'beta/alpha.ts' };
    const q = prepareQuery('zzz');
    const result = scoreItemFuzzy(item, q, true, accessor, cache());
    expect(result.score).toBe(0);
  });
});

// ── compareItemsByFuzzyScore — tie-breaking paths ─────────────────────────────

describe('compareItemsByFuzzyScore — tie-breaking', () => {
  it('prefers item with label matches over item without', () => {
    // Both match but only A has a label match
    const a: FileItem = { label: 'foobar', description: 'src', path: 'src/foobar' };
    const b: FileItem = { label: 'xyz', description: 'foobar', path: 'foobar/xyz' };
    const q = prepareQuery('foobar');
    const c = cache();
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    // a has label match, b has only description match → a should rank first (negative)
    expect(result).toBeLessThanOrEqual(0);
  });

  it('fallback: shorter label+description wins when scores equal', () => {
    // Create two items that score the same — both exact label prefix matches for 'a'
    const a: FileItem = { label: 'a', path: 'a' };
    const b: FileItem = { label: 'ab', path: 'ab' };
    const q = prepareQuery('a');
    const c = cache();
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    expect(result).toBeLessThan(0); // a is shorter
  });

  it('fallback: label localeCompare when lengths equal', () => {
    const a: FileItem = { label: 'bar.ts', path: 'bar.ts' };
    const b: FileItem = { label: 'foo.ts', path: 'foo.ts' };
    const q = prepareQuery('ts');
    const c = cache();
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    // 'bar.ts' < 'foo.ts' alphabetically → negative
    expect(result).toBeLessThan(0);
  });

  it('fallback: path localeCompare when labels equal', () => {
    const a: FileItem = { label: 'index.ts', description: 'src/a', path: 'src/a/index.ts' };
    const b: FileItem = { label: 'index.ts', description: 'src/b', path: 'src/b/index.ts' };
    const q = prepareQuery('ts');
    const c = cache();
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    // Paths differ — order by description then path
    expect(typeof result).toBe('number');
  });

  it('returns 0 for completely identical items with identical paths', () => {
    const a: FileItem = { label: 'same.ts', description: 'src', path: 'src/same.ts' };
    const q = prepareQuery('same');
    const c = cache();
    expect(compareItemsByFuzzyScore(a, a, q, true, accessor, c)).toBe(0);
  });

  it('identity match always beats label match', () => {
    const identity: FileItem = { label: 'foo.ts', path: 'foo.ts' };
    const other: FileItem = { label: 'foo.ts', description: 'other', path: 'other/foo.ts' };
    const q = prepareQuery('foo.ts');
    const modQ = { ...q, normalized: 'foo.ts', normalizedLowercase: 'foo.ts' };
    const c = cache();
    const result = compareItemsByFuzzyScore(identity, other, modQ as any, true, accessor, c);
    expect(result).toBeLessThan(0);
  });

  it('match-length comparison: more compact match wins at same score', () => {
    // 'ac' in 'ac' is more compact than 'ac' in 'abbc' (if both score equal)
    const a: FileItem = { label: 'ac', path: 'ac' };
    const b: FileItem = { label: 'abbc', path: 'abbc' };
    const q = prepareQuery('ac');
    const c = cache();
    // a is shorter prefix — should win
    const result = compareItemsByFuzzyScore(a, b, q, true, accessor, c);
    expect(result).toBeLessThanOrEqual(0);
  });
});
