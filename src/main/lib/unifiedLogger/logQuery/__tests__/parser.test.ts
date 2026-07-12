import { describe, it, expect } from 'vitest';
import { parseLine, parseDateTime } from '../parser';

describe('parseLine', () => {
  it('returns null for empty string', () => {
    expect(parseLine('')).toBeNull();
  });

  it('returns null for comment lines', () => {
    expect(parseLine('# this is a comment')).toBeNull();
  });

  it('returns null for lines that do not match the pattern', () => {
    expect(parseLine('not a log line')).toBeNull();
  });

  it('parses a basic INFO line without source', () => {
    const line = '2026-01-01T12:00:00.000Z INFO App started';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('INFO');
    expect(entry!.source).toBe('');
    expect(entry!.message).toBe('App started');
    expect(entry!.metadata).toBe('');
    expect(entry!.raw).toBe(line);
  });

  it('parses a WARN line with source', () => {
    const line = '2026-01-02T08:30:00.000Z WARN [MCP] Connection slow';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('WARN');
    expect(entry!.source).toBe('MCP');
    expect(entry!.message).toBe('Connection slow');
  });

  it('parses an ERROR line with source and JSON metadata', () => {
    const line = '2026-01-03T10:00:00.000Z ERROR [Auth] Login failed {"userId":"u1","code":401}';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('ERROR');
    expect(entry!.source).toBe('Auth');
    expect(entry!.message).toBe('Login failed');
    expect(entry!.metadata).toBe('{"userId":"u1","code":401}');
  });

  it('parses a DEBUG line', () => {
    const line = '2026-01-01T00:00:00.000Z DEBUG [Scheduler] tick';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe('DEBUG');
    expect(entry!.source).toBe('Scheduler');
    expect(entry!.message).toBe('tick');
  });

  it('does not extract metadata when candidate JSON does not end with }', () => {
    const line = '2026-01-01T12:00:00.000Z INFO msg {"open": true more text';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.metadata).toBe('');
  });

  it('does not extract metadata when candidate is not valid JSON', () => {
    const line = '2026-01-01T12:00:00.000Z INFO message {invalid json}';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.metadata).toBe('');
  });

  it('correctly parses timestamp as a Date', () => {
    const line = '2026-05-17T15:30:00.000Z INFO [Test] hello';
    const entry = parseLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.timestamp).toBeInstanceOf(Date);
    expect(entry!.timestamp.getFullYear()).toBe(2026);
    expect(entry!.timestamp.getMonth()).toBe(4); // May = 4
    expect(entry!.timestamp.getDate()).toBe(17);
  });

  it('returns null when level is not valid', () => {
    const line = '2026-01-01T12:00:00.000Z VERBOSE [x] msg';
    expect(parseLine(line)).toBeNull();
  });
});

describe('parseDateTime', () => {
  it('parses ISO 8601 string', () => {
    const d = parseDateTime('2026-05-17T12:00:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
  });

  it('parses YYYY-MM-DD HH:mm format', () => {
    const d = parseDateTime('2026-05-17 14:30');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMinutes()).toBe(30);
  });

  it('parses YYYY-MM-DD date only', () => {
    const d = parseDateTime('2026-05-17');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
  });

  it('falls back to new Date() for arbitrary strings', () => {
    const d = parseDateTime('May 17, 2026');
    expect(d).toBeInstanceOf(Date);
  });
});
