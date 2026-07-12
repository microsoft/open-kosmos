// @ts-nocheck
/**
 * @vitest-environment happy-dom
 *
 * useOverlayScrollbar.test.ts
 * Branch-complete coverage for the overlay scrollbar hook extracted from
 * AgentList: thumb sizing, the missing-container and no-overflow early
 * returns, the show-defined vs show-undefined visibility branch, the prev
 * timer clear, and the hover-guarded auto-hide timers for both mouse enter
 * and mouse leave.
 */

import { act, renderHook } from '@testing-library/react';
import { useOverlayScrollbar } from '../useOverlayScrollbar';

function makeContainer({ scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = {}) {
  return { scrollTop, scrollHeight, clientHeight } as unknown as HTMLDivElement;
}

describe('useOverlayScrollbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Run rAF callbacks synchronously so handleSessionListMouseEnter resolves.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does nothing when no container is registered for the id', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    act(() => {
      result.current.updateScrollbar('missing');
    });
    expect(result.current.scrollbarState.get('missing')).toBeUndefined();
  });

  it('does nothing when the content does not overflow', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    result.current.scrollContainerRefs.current.set(
      'c1',
      makeContainer({ scrollHeight: 100, clientHeight: 100 }),
    );
    act(() => {
      result.current.updateScrollbar('c1');
    });
    expect(result.current.scrollbarState.get('c1')).toBeUndefined();
  });

  it('computes thumb geometry and keeps prior visibility when show is undefined', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    result.current.scrollContainerRefs.current.set(
      'c1',
      makeContainer({ scrollTop: 50, scrollHeight: 400, clientHeight: 100 }),
    );
    act(() => {
      result.current.updateScrollbar('c1'); // fresh entry, show undefined -> default false
    });
    const state = result.current.scrollbarState.get('c1');
    expect(state.thumbHeight).toBeGreaterThanOrEqual(20);
    expect(state.visible).toBe(false);
  });

  it('honors an explicit show flag and clears the previous auto-hide timer', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    result.current.scrollContainerRefs.current.set(
      'c1',
      makeContainer({ scrollTop: 50, scrollHeight: 400, clientHeight: 100 }),
    );
    act(() => {
      result.current.updateScrollbar('c1', true); // first call: no prev timer
    });
    expect(result.current.scrollbarState.get('c1').visible).toBe(true);
    act(() => {
      result.current.updateScrollbar('c1', true); // second call: clears prev timer
    });
    expect(result.current.scrollbarState.get('c1').visible).toBe(true);
  });

  it('auto-hides after 1200ms when not hovered', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    result.current.scrollContainerRefs.current.set(
      'c1',
      makeContainer({ scrollTop: 50, scrollHeight: 400, clientHeight: 100 }),
    );
    act(() => {
      result.current.updateScrollbar('c1', true);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(result.current.scrollbarState.get('c1').visible).toBe(false);
  });

  it('does not auto-hide while hovered', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    result.current.scrollContainerRefs.current.set(
      'c1',
      makeContainer({ scrollTop: 50, scrollHeight: 400, clientHeight: 100 }),
    );
    act(() => {
      result.current.handleSessionListMouseEnter('c1'); // hovered: true, visible: true
    });
    expect(result.current.scrollbarState.get('c1').hovered).toBe(true);
    expect(result.current.scrollbarState.get('c1').visible).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    // Hover guard keeps it visible.
    expect(result.current.scrollbarState.get('c1').visible).toBe(true);
  });

  it('hides 800ms after mouse leave when no longer hovered', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    result.current.scrollContainerRefs.current.set(
      'c1',
      makeContainer({ scrollTop: 50, scrollHeight: 400, clientHeight: 100 }),
    );
    act(() => {
      result.current.handleSessionListMouseEnter('c1');
    });
    act(() => {
      result.current.handleSessionListMouseLeave('c1'); // hovered -> false
    });
    expect(result.current.scrollbarState.get('c1').hovered).toBe(false);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.scrollbarState.get('c1').visible).toBe(false);
  });

  it('mouse leave on an unknown id leaves state untouched', () => {
    const { result } = renderHook(() => useOverlayScrollbar());
    act(() => {
      result.current.handleSessionListMouseLeave('never'); // cur undefined branch
    });
    expect(result.current.scrollbarState.get('never')).toBeUndefined();
    // The deferred timer also finds no entry and is a no-op.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.scrollbarState.get('never')).toBeUndefined();
  });
});
