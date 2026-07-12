/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the useAgent / useAgents hooks (sidecar renderer-normalization
 * Phase 2a). Drives cache hits, fallback compat, id/ids changes, and live push
 * re-renders through a controllable fake of the agent cache singleton.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => {
  const store = new Map<string, any>();
  let subs: Array<() => void> = [];
  return {
    store,
    reset() {
      store.clear();
      subs = [];
    },
    emit() {
      subs.slice().forEach((s) => s());
    },
    fake: {
      getAgent: (id: string | undefined | null) => (id ? store.get(id) ?? null : null),
      getAgents: (ids: string[] | undefined | null) =>
        Array.isArray(ids) ? ids.map((i) => store.get(i)).filter(Boolean) : [],
      subscribe: (cb: () => void) => {
        subs.push(cb);
        return () => {
          subs = subs.filter((s) => s !== cb);
        };
      },
    },
  };
});

vi.mock('../agentClientCacheManager', () => ({
  agentClientCacheManager: h.fake,
}));

import { useAgent, useAgents } from '../useAgents';

const agentA = { id: 'a1', name: 'Alpha' } as any;
const agentB = { id: 'b2', name: 'Beta' } as any;
const inlineFallback = { name: 'Inline', model: 'x' } as any;

describe('useAgent', () => {
  beforeEach(() => h.reset());

  it('returns the cached agent when present', () => {
    h.store.set('a1', agentA);
    const { result } = renderHook(() => useAgent('a1'));
    expect(result.current).toEqual(agentA);
  });

  it('returns the fallback when the id is not cached', () => {
    const { result } = renderHook(() => useAgent('missing', inlineFallback));
    expect(result.current).toEqual(inlineFallback);
  });

  it('returns null when the id is not cached and no fallback given', () => {
    const { result } = renderHook(() => useAgent('missing'));
    expect(result.current).toBeNull();
  });

  it('returns null for a null id', () => {
    const { result } = renderHook(() => useAgent(null, undefined));
    expect(result.current).toBeNull();
  });

  it('re-resolves when the id prop changes', () => {
    h.store.set('a1', agentA);
    h.store.set('b2', agentB);
    const { result, rerender } = renderHook(({ id }) => useAgent(id), {
      initialProps: { id: 'a1' },
    });
    expect(result.current).toEqual(agentA);
    rerender({ id: 'b2' });
    expect(result.current).toEqual(agentB);
  });

  it('re-renders when the cache emits a change', () => {
    const { result } = renderHook(() => useAgent('a1', inlineFallback));
    expect(result.current).toEqual(inlineFallback);
    act(() => {
      h.store.set('a1', agentA);
      h.emit();
    });
    expect(result.current).toEqual(agentA);
  });
});

describe('useAgents', () => {
  beforeEach(() => h.reset());

  it('resolves ids from the cache in order', () => {
    h.store.set('a1', agentA);
    h.store.set('b2', agentB);
    const { result } = renderHook(() => useAgents(['b2', 'a1']));
    expect(result.current).toEqual([agentB, agentA]);
  });

  it('returns the fallback when the cache resolves nothing', () => {
    const { result } = renderHook(() => useAgents(['missing'], [inlineFallback]));
    expect(result.current).toEqual([inlineFallback]);
  });

  it('returns [] when nothing resolves and fallback is empty', () => {
    const { result } = renderHook(() => useAgents(['missing'], []));
    expect(result.current).toEqual([]);
  });

  it('returns [] when nothing resolves and no fallback is given', () => {
    const { result } = renderHook(() => useAgents(['missing']));
    expect(result.current).toEqual([]);
  });

  it('handles null/undefined ids', () => {
    const { result } = renderHook(() => useAgents(null));
    expect(result.current).toEqual([]);
  });

  it('prefers resolved agents over the fallback when at least one resolves', () => {
    h.store.set('a1', agentA);
    const { result } = renderHook(() => useAgents(['a1', 'missing'], [inlineFallback]));
    expect(result.current).toEqual([agentA]);
  });

  it('re-resolves when the id list changes', () => {
    h.store.set('a1', agentA);
    h.store.set('b2', agentB);
    const { result, rerender } = renderHook(({ ids }) => useAgents(ids), {
      initialProps: { ids: ['a1'] },
    });
    expect(result.current).toEqual([agentA]);
    rerender({ ids: ['b2'] });
    expect(result.current).toEqual([agentB]);
  });

  it('re-renders when the cache emits a change', () => {
    const { result } = renderHook(() => useAgents(['a1'], [inlineFallback]));
    expect(result.current).toEqual([inlineFallback]);
    act(() => {
      h.store.set('a1', agentA);
      h.emit();
    });
    expect(result.current).toEqual([agentA]);
  });
});
