/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { yyyymmdd, sleep, nextTick, Future } from '../utils/time';

describe('yyyymmdd', () => {
  it('formats a date correctly', () => {
    const d = new Date(2024, 0, 5); // Jan 5, 2024
    expect(yyyymmdd(d)).toBe('20240105');
  });

  it('pads month and day with zeros', () => {
    const d = new Date(2023, 8, 9); // Sep 9, 2023
    expect(yyyymmdd(d)).toBe('20230909');
  });

  it('handles two-digit month and day', () => {
    const d = new Date(2022, 11, 31); // Dec 31, 2022
    expect(yyyymmdd(d)).toBe('20221231');
  });
});

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a promise that resolves after ms', async () => {
    const p = sleep(100);
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('nextTick', () => {
  it('returns a promise', () => {
    // requestAnimationFrame is available in happy-dom
    const p = nextTick();
    expect(p).toBeInstanceOf(Promise);
  });
});

describe('Future', () => {
  it('resolves when reach is called', async () => {
    const f = new Future<number>();
    setTimeout(() => f.reach(42), 0);
    const result = await new Promise<number>((rs) => f.then(rs));
    expect(result).toBe(42);
  });

  it('delay resolves after sleep following reach', async () => {
    vi.useFakeTimers();
    const f = new Future<string>();
    f.reach('hello');
    const p = f.delay(50);
    await vi.runAllTimersAsync();
    const val = await p;
    expect(val).toBe('hello');
    vi.useRealTimers();
  });
});
