// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { external } from '../external';

describe('external', () => {
  it('caches snapshots, updates only when unequal, and resets after unsubscribe', () => {
    let emit: VoidFunction = () => {};
    const off = vi.fn();
    const sub = vi.fn((update: VoidFunction) => {
      emit = update;
      return off;
    });

    let source = { count: 0 };
    const calc = vi.fn(() => source);
    const store = external(sub)(calc, (prev, next) => prev.count === next.count);

    const { result, unmount } = renderHook(() => store.use());
    const firstSnapshot = result.current;

    expect(firstSnapshot).toEqual({ count: 0 });
    expect(sub).toHaveBeenCalledTimes(1);

    source = { count: 0 };
    act(() => emit());
    expect(result.current).toBe(firstSnapshot);

    source = { count: 1 };
    act(() => emit());
    expect(result.current).toEqual({ count: 1 });
    expect(result.current).not.toBe(firstSnapshot);

    unmount();
    expect(off).toHaveBeenCalledTimes(1);

    source = { count: 2 };
    const second = renderHook(() => store.use());
    expect(second.result.current).toEqual({ count: 2 });
    expect(sub).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it('shares one subscription across multiple listeners and uses Object.is by default', () => {
    let emit: VoidFunction = () => {};
    const off = vi.fn();
    const sub = vi.fn((update: VoidFunction) => {
      emit = update;
      return off;
    });

    let source = 'first';
    const store = external(sub)(() => source);

    const first = renderHook(() => store.use());
    const second = renderHook(() => store.use());

    expect(first.result.current).toBe('first');
    expect(second.result.current).toBe('first');
    expect(sub).toHaveBeenCalledTimes(1);

    source = 'second';
    act(() => emit());
    expect(first.result.current).toBe('second');
    expect(second.result.current).toBe('second');

    second.unmount();
    expect(off).not.toHaveBeenCalled();

    first.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
