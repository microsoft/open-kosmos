/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the generic useSidecarList hook (sidecar renderer-normalization
 * Phase 2b). Drives cache hits, fallback compat, and live push re-renders via a
 * controllable fake cache.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSidecarList, type ReadableListCache } from '../useSidecarList';

type Item = { id: string };

function makeFake(initial: Item[] = []) {
  let items = initial;
  let subs: Array<(data: unknown) => void> = [];
  const cache: ReadableListCache<Item> & {
    set(next: Item[]): void;
  } = {
    getItems: () => items,
    subscribe: (listener: (data: unknown) => void) => {
      subs.push(listener);
      return () => {
        subs = subs.filter((s) => s !== listener);
      };
    },
    set(next: Item[]) {
      items = next;
      subs.slice().forEach((s) => s(undefined));
    },
  };
  return cache;
}

const a = { id: 'a' };
const b = { id: 'b' };

describe('useSidecarList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns cached items when present', () => {
    const cache = makeFake([a, b]);
    const { result } = renderHook(() => useSidecarList(cache));
    expect(result.current).toEqual([a, b]);
  });

  it('returns the fallback when the cache is empty', () => {
    const cache = makeFake([]);
    const { result } = renderHook(() => useSidecarList(cache, [a]));
    expect(result.current).toEqual([a]);
  });

  it('returns [] when the cache is empty and fallback is empty', () => {
    const cache = makeFake([]);
    const { result } = renderHook(() => useSidecarList(cache, []));
    expect(result.current).toEqual([]);
  });

  it('returns [] when the cache is empty and no fallback given', () => {
    const cache = makeFake([]);
    const { result } = renderHook(() => useSidecarList(cache));
    expect(result.current).toEqual([]);
  });

  it('prefers cached items over the fallback when non-empty', () => {
    const cache = makeFake([b]);
    const { result } = renderHook(() => useSidecarList(cache, [a]));
    expect(result.current).toEqual([b]);
  });

  it('re-renders when the cache emits a change', () => {
    const cache = makeFake([]);
    const { result } = renderHook(() => useSidecarList(cache, [a]));
    expect(result.current).toEqual([a]);
    act(() => cache.set([b]));
    expect(result.current).toEqual([b]);
  });

  it('re-subscribes when the manager identity changes', () => {
    const first = makeFake([a]);
    const second = makeFake([b]);
    const { result, rerender } = renderHook(({ m }) => useSidecarList(m), {
      initialProps: { m: first as ReadableListCache<Item> },
    });
    expect(result.current).toEqual([a]);
    rerender({ m: second as ReadableListCache<Item> });
    expect(result.current).toEqual([b]);
  });
});
