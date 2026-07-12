import { describe, it, expect } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter, extractLinks } from '../lib/parser';

// Direct unit tests for the vendored frontmatter/link parser. This code is
// vendored from iamtouchskyer/memex but lives in our tree, so we test it like
// any first-party file (no allowlist exemption).

describe('parseFrontmatter', () => {
  it('parses a well-formed YAML frontmatter block and body', () => {
    const raw = ['---', 'title: Hello', 'count: 3', '---', 'Body text here.'].join('\n');
    const { data, content } = parseFrontmatter(raw);
    expect(data.title).toBe('Hello');
    expect(data.count).toBe(3);
    expect(content).toBe('Body text here.');
  });

  it('treats input with no frontmatter as pure content', () => {
    const { data, content } = parseFrontmatter('Just a body, no frontmatter.');
    expect(data).toEqual({});
    expect(content).toBe('Just a body, no frontmatter.');
  });

  it('handles CRLF line endings in the frontmatter block', () => {
    const raw = '---\r\ntitle: Win\r\n---\r\nbody';
    const { data, content } = parseFrontmatter(raw);
    expect(data.title).toBe('Win');
    expect(content).toBe('body');
  });

  it('falls back to empty data when the YAML is a sequence (not a mapping)', () => {
    const raw = ['---', '- one', '- two', '---', 'body'].join('\n');
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toBe('body');
  });

  it('falls back to empty data when the YAML is a bare scalar', () => {
    const raw = ['---', 'just-a-string', '---', 'body'].join('\n');
    const { data } = parseFrontmatter(raw);
    expect(data).toEqual({});
  });

  it('recovers from a YAML parse error by stripping the frontmatter', () => {
    // An unterminated double-quoted scalar makes js-yaml throw, hitting the catch.
    const raw = '---\ntitle: "unterminated\n---\nrecovered body';
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({});
    expect(content).toContain('recovered body');
  });
});

describe('stringifyFrontmatter', () => {
  it('emits simple key: value lines for plain values', () => {
    const out = stringifyFrontmatter('body', { title: 'Note', created: '2026-06-01' });
    expect(out).toContain('title: Note');
    expect(out).toContain('created: 2026-06-01');
    expect(out.endsWith('---\nbody')).toBe(true);
  });

  it('skips undefined and null values', () => {
    const out = stringifyFrontmatter('b', { title: 'X', skip: undefined, gone: null });
    expect(out).toContain('title: X');
    expect(out).not.toContain('skip');
    expect(out).not.toContain('gone');
  });

  it('single-quotes values containing YAML-special characters and escapes quotes', () => {
    const out = stringifyFrontmatter('b', { tags: 'a, b', note: "it's: tricky" });
    expect(out).toContain("tags: 'a, b'");
    // Embedded single quotes are doubled.
    expect(out).toContain("note: 'it''s: tricky'");
  });

  it('collapses embedded newlines in a value to spaces', () => {
    const out = stringifyFrontmatter('b', { title: 'line one\nline two' });
    expect(out).toContain('title: line one line two');
  });
});

describe('extractLinks', () => {
  it('extracts wikilink targets', () => {
    expect(extractLinks('See [[alpha]] and [[beta]].')).toEqual(['alpha', 'beta']);
  });

  it('deduplicates repeated identical links', () => {
    expect(extractLinks('[[same]] then [[same]] again')).toEqual(['same']);
  });

  it('resolves Obsidian-style pipe aliases to the target', () => {
    expect(extractLinks('[[target|Display Text]]')).toEqual(['target']);
  });

  it('ignores links inside fenced code blocks', () => {
    const body = ['before [[real]]', '```', 'code [[fake]]', '```'].join('\n');
    expect(extractLinks(body)).toEqual(['real']);
  });

  it('ignores links inside inline code', () => {
    expect(extractLinks('text `[[inline]]` and [[outside]]')).toEqual(['outside']);
  });

  it('skips empty targets such as alias-only links', () => {
    expect(extractLinks('[[|just-an-alias]]')).toEqual([]);
  });
});
