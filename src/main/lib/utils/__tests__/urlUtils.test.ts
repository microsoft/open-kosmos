/**
 * Tests for urlUtils.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appendCacheBustingTimestamp } from '../urlUtils';

describe('appendCacheBustingTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends timestamp as query param to a URL without query string', () => {
    const result = appendCacheBustingTimestamp('https://example.com/data.json');
    expect(result).toBe(`https://example.com/data.json?timestamp=${Date.now()}`);
  });

  it('appends timestamp with & when URL already has query string', () => {
    const result = appendCacheBustingTimestamp('https://example.com/data.json?foo=bar');
    expect(result).toBe(`https://example.com/data.json?foo=bar&timestamp=${Date.now()}`);
  });

  it('appends timestamp with ? when URL has no query string', () => {
    const url = 'https://cdn.example.com/config';
    const result = appendCacheBustingTimestamp(url);
    expect(result).toContain('?timestamp=');
    expect(result.startsWith(url)).toBe(true);
  });

  it('uses the current timestamp value', () => {
    const fakeNow = Date.now(); // reads the mocked clock
    const result = appendCacheBustingTimestamp('https://example.com/file');
    expect(result).toContain(`timestamp=${fakeNow}`);
  });

  it('handles URLs that already contain multiple query params', () => {
    const url = 'https://example.com/resource?a=1&b=2';
    const result = appendCacheBustingTimestamp(url);
    expect(result).toContain('&timestamp=');
    expect(result.startsWith(url)).toBe(true);
  });

  it('handles a bare path without scheme', () => {
    const result = appendCacheBustingTimestamp('/api/data');
    expect(result).toBe(`/api/data?timestamp=${Date.now()}`);
  });
});
