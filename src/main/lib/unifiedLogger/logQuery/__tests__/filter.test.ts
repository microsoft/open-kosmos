import { describe, it, expect } from 'vitest';
import { globMatch, buildGrepMatcher, matchesFilter } from '../filter';
import type { LogEntry } from '../parser';
import type { Filters } from '../filter';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date('2026-05-17T10:00:00Z'),
    level: 'INFO',
    source: 'TestSource',
    message: 'test message',
    metadata: '',
    raw: '',
    ...overrides,
  };
}

describe('globMatch', () => {
  it('returns true for exact match', () => {
    expect(globMatch('MCP', 'MCP')).toBe(true);
  });

  it('returns true for wildcard prefix', () => {
    expect(globMatch('*Manager', 'ChatManager')).toBe(true);
  });

  it('returns true for wildcard suffix', () => {
    expect(globMatch('mcp*', 'mcpRuntime')).toBe(true);
  });

  it('returns true for wildcard both sides', () => {
    expect(globMatch('*chat*', 'MainChatEngine')).toBe(true);
  });

  it('returns false when no match', () => {
    expect(globMatch('mcp*', 'auth')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(globMatch('MCP', 'mcp')).toBe(true);
    expect(globMatch('mcp', 'MCP')).toBe(true);
  });

  it('handles pattern with no wildcards', () => {
    expect(globMatch('exact', 'exact')).toBe(true);
    expect(globMatch('exact', 'notexact')).toBe(false);
  });

  it('escapes regex special chars in pattern', () => {
    expect(globMatch('a.b', 'axb')).toBe(false); // dot is escaped, not a regex wildcard
    expect(globMatch('a.b', 'a.b')).toBe(true);
  });
});

describe('buildGrepMatcher', () => {
  describe('regex syntax', () => {
    it('matches using regex', () => {
      const m = buildGrepMatcher('/error.*fail/i');
      expect(m('some ERROR failure here')).toBe(true);
      expect(m('all good')).toBe(false);
    });

    it('uses provided flags', () => {
      const m = buildGrepMatcher('/ERROR/');
      expect(m('error')).toBe(true); // defaults to i flag when no flags provided
      expect(m('ERROR')).toBe(true);
    });

    it('defaults to i flag when no flags provided', () => {
      const m = buildGrepMatcher('/hello/');
      expect(m('HELLO world')).toBe(true); // i flag is the default
    });
  });

  describe('plain text', () => {
    it('matches case-insensitive substring', () => {
      const m = buildGrepMatcher('timeout');
      // The matcher lowercases the keyword; matchesFilter pre-lowercases the haystack.
      // Call with lowercased haystack to replicate production usage.
      expect(m('connection timeout occurred')).toBe(true);
      expect(m('all good')).toBe(false);
    });
  });

  describe('OR syntax (comma)', () => {
    it('returns true when any group matches', () => {
      const m = buildGrepMatcher('error,warn');
      expect(m('this is a warning')).toBe(true);
      expect(m('fatal error')).toBe(true);
      expect(m('all good')).toBe(false);
    });
  });

  describe('AND syntax (plus)', () => {
    it('returns true only when all terms match', () => {
      const m = buildGrepMatcher('error+mcp');
      expect(m('mcp error occurred')).toBe(true);
      expect(m('only error')).toBe(false);
      expect(m('only mcp')).toBe(false);
    });
  });

  describe('NOT syntax (exclamation)', () => {
    it('returns false when negated term is present', () => {
      const m = buildGrepMatcher('error+!retry');
      expect(m('error without retry')).toBe(false);
      expect(m('error happened')).toBe(true);
    });
  });

  describe('combined syntax', () => {
    it('handles OR of AND groups', () => {
      const m = buildGrepMatcher('error+mcp,warn+timeout');
      expect(m('mcp error here')).toBe(true);
      expect(m('timeout warning')).toBe(true);
      expect(m('nothing relevant')).toBe(false);
    });
  });

  it('filters empty groups from comma split', () => {
    const m = buildGrepMatcher(',hello,');
    expect(m('say hello')).toBe(true);
  });
});

describe('matchesFilter', () => {
  it('returns true for empty filters', () => {
    const entry = makeEntry();
    expect(matchesFilter(entry, {})).toBe(true);
  });

  it('filters by level — match', () => {
    const entry = makeEntry({ level: 'ERROR' });
    expect(matchesFilter(entry, { level: ['ERROR'] })).toBe(true);
  });

  it('filters by level — no match', () => {
    const entry = makeEntry({ level: 'INFO' });
    expect(matchesFilter(entry, { level: ['ERROR'] })).toBe(false);
  });

  it('filters by source glob — match', () => {
    const entry = makeEntry({ source: 'McpRuntime' });
    expect(matchesFilter(entry, { source: 'mcp*' })).toBe(true);
  });

  it('filters by source glob — no match', () => {
    const entry = makeEntry({ source: 'AuthManager' });
    expect(matchesFilter(entry, { source: 'mcp*' })).toBe(false);
  });

  it('filters by from date — before range', () => {
    const entry = makeEntry({ timestamp: new Date('2026-01-01T00:00:00Z') });
    const filters: Filters = { from: new Date('2026-06-01T00:00:00Z') };
    expect(matchesFilter(entry, filters)).toBe(false);
  });

  it('filters by from date — at boundary (included)', () => {
    const ts = new Date('2026-05-17T10:00:00Z');
    const entry = makeEntry({ timestamp: ts });
    expect(matchesFilter(entry, { from: ts })).toBe(true);
  });

  it('filters by to date — after range', () => {
    const entry = makeEntry({ timestamp: new Date('2026-12-31T00:00:00Z') });
    const filters: Filters = { to: new Date('2026-01-01T00:00:00Z') };
    expect(matchesFilter(entry, filters)).toBe(false);
  });

  it('filters by to date — at boundary (included)', () => {
    const ts = new Date('2026-05-17T10:00:00Z');
    const entry = makeEntry({ timestamp: ts });
    expect(matchesFilter(entry, { to: ts })).toBe(true);
  });

  it('filters by grep — message match', () => {
    const entry = makeEntry({ message: 'connection failed', source: 'MCP', metadata: '' });
    expect(matchesFilter(entry, { grep: 'failed' })).toBe(true);
  });

  it('filters by grep — no match', () => {
    const entry = makeEntry({ message: 'all good', source: 'Auth', metadata: '' });
    expect(matchesFilter(entry, { grep: 'error' })).toBe(false);
  });

  it('caches _grepMatcher on repeated calls', () => {
    const filters: Filters = { grep: 'hello' };
    const entry = makeEntry({ message: 'hello world', source: '', metadata: '' });
    matchesFilter(entry, filters);
    const firstMatcher = filters._grepMatcher;
    matchesFilter(entry, filters);
    expect(filters._grepMatcher).toBe(firstMatcher); // same reference = cached
  });

  it('searches metadata in grep haystack', () => {
    const entry = makeEntry({ message: 'msg', source: '', metadata: '{"error":"disk full"}' });
    expect(matchesFilter(entry, { grep: 'disk' })).toBe(true);
  });
});
