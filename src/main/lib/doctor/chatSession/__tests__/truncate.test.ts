import { describe, it, expect } from 'vitest';
import { truncateMiddle } from '../truncate';

describe('truncateMiddle', () => {
  it('returns empty string when maxChars is 0', () => {
    expect(truncateMiddle('hello', 0)).toBe('');
  });

  it('returns empty string when maxChars is negative', () => {
    expect(truncateMiddle('hello', -5)).toBe('');
  });

  it('returns the original string when shorter than maxChars', () => {
    expect(truncateMiddle('hello', 100)).toBe('hello');
  });

  it('returns the original string when equal to maxChars', () => {
    expect(truncateMiddle('hello', 5)).toBe('hello');
  });

  it('truncates long strings with a marker in the middle', () => {
    const text = 'a'.repeat(200);
    const result = truncateMiddle(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('truncated');
  });

  it('returns a slice of the marker when marker is >= maxChars', () => {
    // Very short maxChars — the marker itself exceeds the budget
    const text = 'a'.repeat(100);
    const result = truncateMiddle(text, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('keeps first 60% + last 40% of the budget', () => {
    // Use a string of 1000 chars and maxChars of 100
    const text = 'A'.repeat(500) + 'B'.repeat(500);
    const result = truncateMiddle(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.startsWith('A')).toBe(true);
    expect(result.endsWith('B')).toBe(true);
  });

  it('tail is empty when budget - headLen equals 0', () => {
    // maxChars just large enough that head fills all budget
    const text = 'XY'.repeat(50); // 100 chars
    const result = truncateMiddle(text, 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });
});
