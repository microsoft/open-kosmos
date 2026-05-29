import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatEntry, formatStalenessHeader, formatStats, formatSources } from '../format';
import type { LogEntry } from '../parser';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: new Date('2026-05-17T10:00:00.000Z'),
    level: 'INFO',
    source: 'TestSource',
    message: 'test message',
    metadata: '',
    raw: '',
    ...overrides,
  };
}

describe('formatEntry', () => {
  it('formats basic entry with HH:mm:ss time', () => {
    const entry = makeEntry({ timestamp: new Date('2026-05-17T10:30:45.000Z') });
    const result = formatEntry(entry);
    expect(result).toContain('10:30:45');
    expect(result).toContain('INFO');
    expect(result).toContain('[TestSource]');
    expect(result).toContain('test message');
  });

  it('omits source brackets when source is empty', () => {
    const entry = makeEntry({ source: '' });
    const result = formatEntry(entry);
    expect(result).not.toContain('[');
  });

  it('pads level to 5 chars', () => {
    const entry = makeEntry({ level: 'WARN' });
    const result = formatEntry(entry);
    expect(result).toContain('WARN ');
  });

  it('appends parsed metadata key=value pairs', () => {
    const entry = makeEntry({ metadata: '{"code":404,"reason":"not found"}' });
    const result = formatEntry(entry);
    expect(result).toContain('code=404');
    expect(result).toContain('reason=not found');
  });

  it('truncates long metadata values to 60 chars with ...', () => {
    const longVal = 'X'.repeat(80);
    const entry = makeEntry({ metadata: JSON.stringify({ key: longVal }) });
    const result = formatEntry(entry);
    expect(result).toContain('...');
    expect(result).toContain('key=');
  });

  it('appends raw metadata when not valid JSON', () => {
    const entry = makeEntry({ metadata: 'some raw text' });
    const result = formatEntry(entry);
    expect(result).toContain('some raw text');
  });

  it('does not append anything for empty metadata', () => {
    const entry = makeEntry({ message: 'hello', metadata: '' });
    const result = formatEntry(entry);
    expect(result.trim()).toBe('10:00:00 INFO  [TestSource] hello');
  });
});

describe('formatStalenessHeader', () => {
  it('returns empty string for empty entries', () => {
    expect(formatStalenessHeader([], [])).toBe('');
  });

  it('includes file names', () => {
    const entry = makeEntry({ timestamp: new Date() });
    const result = formatStalenessHeader([entry], ['/logs/openkosmos-2026-05-17.log']);
    expect(result).toContain('openkosmos-2026-05-17.log');
  });

  it('includes last log entry timestamp', () => {
    const entry = makeEntry({ timestamp: new Date('2026-05-17T10:00:00Z') });
    const result = formatStalenessHeader([entry], ['/logs/openkosmos.log']);
    expect(result).toContain('2026-05-17');
  });

  it('shows day-old warning for logs >= 1 day old', () => {
    const old = new Date();
    old.setDate(old.getDate() - 2);
    const entry = makeEntry({ timestamp: old });
    const result = formatStalenessHeader([entry], ['/logs/old.log']);
    expect(result).toContain('day(s) old');
  });

  it('shows hours note for logs 2+ hours old but < 1 day', () => {
    const ts = new Date();
    ts.setHours(ts.getHours() - 3);
    const entry = makeEntry({ timestamp: ts });
    const result = formatStalenessHeader([entry], ['/logs/mid.log']);
    expect(result).toContain('hours ago');
  });

  it('does not show warning for fresh logs (< 2 hours)', () => {
    const ts = new Date();
    ts.setMinutes(ts.getMinutes() - 30);
    const entry = makeEntry({ timestamp: ts });
    const result = formatStalenessHeader([entry], ['/logs/fresh.log']);
    expect(result).not.toContain('old');
    expect(result).not.toContain('hours ago');
  });

  it('uses last entry timestamp (not first)', () => {
    const first = makeEntry({ timestamp: new Date('2026-01-01T00:00:00Z') });
    const last = makeEntry({ timestamp: new Date() });
    const result = formatStalenessHeader([first, last], ['/logs/x.log']);
    // Fresh logs, should not show staleness warning
    expect(result).not.toContain('day(s) old');
  });
});

describe('formatStats', () => {
  it('returns "No log entries found." for empty array', () => {
    expect(formatStats([])).toBe('No log entries found.');
  });

  it('shows total count', () => {
    const entries = [
      makeEntry({ level: 'INFO' }),
      makeEntry({ level: 'ERROR' }),
      makeEntry({ level: 'WARN' }),
    ];
    const result = formatStats(entries);
    expect(result).toContain('3');
  });

  it('shows level breakdown', () => {
    const entries = [
      makeEntry({ level: 'ERROR' }),
      makeEntry({ level: 'WARN' }),
      makeEntry({ level: 'INFO' }),
      makeEntry({ level: 'DEBUG' }),
    ];
    const result = formatStats(entries);
    expect(result).toContain('ERROR');
    expect(result).toContain('WARN');
    expect(result).toContain('INFO');
    expect(result).toContain('DEBUG');
  });

  it('shows top 15 sources', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ source: `Source${i}` })
    );
    const result = formatStats(entries);
    expect(result).toContain('By Source (top 15)');
  });

  it('shows (none) when no sources', () => {
    const entries = [makeEntry({ source: '' })];
    const result = formatStats(entries);
    expect(result).toContain('(none)');
  });

  it('includes time range', () => {
    const entries = [
      makeEntry({ timestamp: new Date('2026-05-17T10:00:00.000Z') }),
      makeEntry({ timestamp: new Date('2026-05-17T12:30:00.000Z') }),
    ];
    const result = formatStats(entries);
    expect(result).toContain('10:00:00');
    expect(result).toContain('12:30:00');
  });
});

describe('formatSources', () => {
  it('returns "(no sources found)" for empty entries', () => {
    expect(formatSources([])).toBe('(no sources found)');
  });

  it('returns "(no sources found)" when all sources are empty', () => {
    expect(formatSources([makeEntry({ source: '' })])).toBe('(no sources found)');
  });

  it('returns sorted unique source names', () => {
    const entries = [
      makeEntry({ source: 'Zzz' }),
      makeEntry({ source: 'Aaa' }),
      makeEntry({ source: 'Mmm' }),
      makeEntry({ source: 'Aaa' }), // duplicate
    ];
    const result = formatSources(entries);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('Aaa');
    expect(lines[1]).toBe('Mmm');
    expect(lines[2]).toBe('Zzz');
  });

  it('sorts case-insensitively', () => {
    const entries = [
      makeEntry({ source: 'zebra' }),
      makeEntry({ source: 'Apple' }),
    ];
    const result = formatSources(entries);
    expect(result.startsWith('Apple')).toBe(true);
  });
});
