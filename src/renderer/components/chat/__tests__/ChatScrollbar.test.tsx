/** @vitest-environment happy-dom */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import ChatScrollbar, {
  computeThumbGeometry,
  CHAT_SCROLLBAR_MIN_THUMB_PX,
  CHAT_SCROLLBAR_SCROLL_IDLE_MS,
} from '../ChatScrollbar';

interface Metrics {
  scrollTop?: number;
  scrollHeight: number;
  clientHeight: number;
}

function setMetrics(el: HTMLElement, { scrollTop = 0, scrollHeight, clientHeight }: Metrics): void {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
}

interface HarnessProps {
  scrollbarRef: React.RefObject<HTMLDivElement>;
  scrollIdleMs?: number;
}

function Harness({ scrollbarRef, scrollIdleMs }: HarnessProps) {
  return (
    <div>
      <div
        data-testid="scroll"
        ref={(el) => {
          (scrollbarRef as { current: HTMLDivElement | null }).current = el;
        }}
      />
      <ChatScrollbar scrollContainerRef={scrollbarRef} scrollIdleMs={scrollIdleMs} />
    </div>
  );
}

function renderScrollbar(opts: { scrollIdleMs?: number } = {}) {
  const scrollbarRef = { current: null } as React.RefObject<HTMLDivElement>;
  const utils = render(<Harness scrollbarRef={scrollbarRef} scrollIdleMs={opts.scrollIdleMs ?? 500} />);
  const scrollEl = utils.getByTestId('scroll');
  // The overlay parent is where pointer presence is tracked (it also hosts the thumb).
  const overlayEl = scrollEl.parentElement as HTMLElement;
  return { ...utils, scrollEl, overlayEl, scrollbarRef };
}

const getBar = (): HTMLElement | null => document.querySelector('.chat-scrollbar');
const getThumb = (): HTMLElement | null => document.querySelector('.chat-scrollbar-thumb');
const isVisible = (): boolean => getBar()?.classList.contains('is-visible') ?? false;

const originalResizeObserver = globalThis.ResizeObserver;
let resizeObserverCallbacks: ResizeObserverCallback[] = [];

function installResizeObserverMock(): void {
  resizeObserverCallbacks = [];
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallbacks.push(callback);
    }

    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}

function triggerResizeObservers(): void {
  for (const callback of [...resizeObserverCallbacks]) {
    callback([], {} as ResizeObserver);
  }
}

describe('computeThumbGeometry', () => {
  it('returns null when the content does not overflow', () => {
    expect(computeThumbGeometry(0, 400, 400)).toBeNull();
    expect(computeThumbGeometry(0, 300, 400)).toBeNull();
  });

  it('maps the scroll position to a proportional thumb height and top', () => {
    const top = computeThumbGeometry(0, 1000, 400);
    expect(top!.height).toBeCloseTo(160);
    expect(top!.top).toBe(0);

    const middle = computeThumbGeometry(300, 1000, 400);
    expect(middle!.top).toBeCloseTo(120);

    const bottom = computeThumbGeometry(600, 1000, 400);
    expect(bottom!.top).toBeCloseTo(240);
  });

  it('floors the thumb height and clamps the top inside a tiny viewport', () => {
    const geometry = computeThumbGeometry(500, 1000, 20);
    expect(geometry!.height).toBe(CHAT_SCROLLBAR_MIN_THUMB_PX);
    expect(geometry!.top).toBe(0);
  });
});

describe('ChatScrollbar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installResizeObserverMock();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: originalResizeObserver,
    });
  });

  it('exposes the documented default scroll-idle delay', () => {
    expect(CHAT_SCROLLBAR_SCROLL_IDLE_MS).toBe(700);
  });

  it('renders nothing before any scroll or pointer activity', () => {
    renderScrollbar();
    expect(getBar()).toBeNull();
  });

  it('appears on scroll and reflects the measured thumb geometry', () => {
    const { scrollEl } = renderScrollbar();
    setMetrics(scrollEl, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });

    expect(isVisible()).toBe(true);
    expect(getThumb()!.style.height).toBe('160px');
    expect(getThumb()!.style.transform).toBe('translateY(120px)');
  });

  it('ignores scroll events when the content does not overflow', () => {
    const { scrollEl } = renderScrollbar();
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });

    expect(getBar()).toBeNull();
  });

  it('debounces the scroll-idle hide across rapid scrolls, then hides when static and the pointer is away', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Second scroll resets the pending scroll-idle timer.
    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(isVisible()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(isVisible()).toBe(false);
  });

  it('shows while the pointer rests on the page and hides once it leaves', () => {
    const { scrollEl, overlayEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    // A single move marks the pointer present; no scroll needed.
    act(() => {
      fireEvent.mouseMove(overlayEl);
    });
    expect(isVisible()).toBe(true);
    expect(getThumb()!.style.transform).toBe('translateY(80px)');

    // The pointer rests on the page (no further moves) -> stays visible.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(isVisible()).toBe(true);

    // Pointer leaves the page while it is static -> hides.
    act(() => {
      fireEvent.mouseLeave(overlayEl);
    });
    expect(isVisible()).toBe(false);
  });

  it('does not show on hover when the content does not overflow', () => {
    const { scrollEl, overlayEl } = renderScrollbar();
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });

    act(() => {
      fireEvent.mouseMove(overlayEl);
    });
    expect(getBar()).toBeNull();
  });

  it('stays visible after a scroll settles while the pointer is still on the page', () => {
    const { scrollEl, overlayEl } = renderScrollbar({ scrollIdleMs: 300 });
    setMetrics(scrollEl, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
      fireEvent.mouseMove(overlayEl);
    });
    expect(isVisible()).toBe(true);

    // Scroll goes static but the pointer is still on the page -> kept visible.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(isVisible()).toBe(true);

    // Only after the pointer leaves does it hide.
    act(() => {
      fireEvent.mouseLeave(overlayEl);
    });
    expect(isVisible()).toBe(false);
  });

  it('stays visible if the pointer leaves while a scroll is still settling', () => {
    const { scrollEl, overlayEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    // Leaving while the page is still scrolling must not hide the bar.
    act(() => {
      fireEvent.mouseLeave(overlayEl);
    });
    expect(isVisible()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(isVisible()).toBe(false);
  });

  it('drags the thumb to scroll the container and hides after release', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(isVisible()).toBe(false);

    act(() => {
      fireEvent.mouseDown(getThumb()!, { clientY: 100 });
    });
    expect(isVisible()).toBe(true);

    // maxThumbTop = 400 - 160 = 240; maxScroll = 600; delta 50 -> +125 -> 325.
    act(() => {
      fireEvent.mouseMove(window, { clientY: 150 });
    });
    expect(scrollEl.scrollTop).toBeCloseTo(325);

    act(() => {
      fireEvent.mouseUp(window);
    });
    expect(isVisible()).toBe(false);
  });

  it('clamps a drag past the end of the track', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      fireEvent.mouseDown(getThumb()!, { clientY: 100 });
    });
    // A huge downward drag clamps scrollTop to maxScroll (600).
    act(() => {
      fireEvent.mouseMove(window, { clientY: 100000 });
    });
    expect(scrollEl.scrollTop).toBe(600);

    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('does not scroll when the thumb fills the whole track', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    // Content shrinks below the viewport, so the thumb geometry is null at mousedown.
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 300, clientHeight: 400 });

    act(() => {
      fireEvent.mouseDown(getThumb()!, { clientY: 100 });
    });
    act(() => {
      fireEvent.mouseMove(window, { clientY: 400 });
    });
    expect(scrollEl.scrollTop).toBe(200);

    act(() => {
      fireEvent.mouseUp(window);
    });
  });

  it('ignores a thumb mousedown when the container ref is detached', () => {
    const { scrollEl, scrollbarRef } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    const thumb = getThumb()!;
    (scrollbarRef as { current: HTMLDivElement | null }).current = null;

    expect(() => {
      act(() => {
        fireEvent.mouseDown(thumb, { clientY: 100 });
      });
    }).not.toThrow();

    act(() => {
      fireEvent.mouseMove(window, { clientY: 300 });
    });
    expect(scrollEl.scrollTop).toBe(200);
  });

  it('keeps the bar visible while a drag is in flight even if the scroll-idle timer fires', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 200 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      fireEvent.mouseDown(getThumb()!, { clientY: 100 });
    });
    // The scroll-idle timer fires mid-drag; dragging keeps the bar visible.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(isVisible()).toBe(true);

    act(() => {
      fireEvent.mouseUp(window);
    });
    expect(isVisible()).toBe(false);
  });

  it('removes in-flight drag listeners when unmounted before mouseup', () => {
    const { scrollEl, unmount } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      fireEvent.mouseDown(getThumb()!, { clientY: 100 });
    });

    // Unmounting mid-drag must tear down the window drag listeners via the effect cleanup.
    expect(() => {
      unmount();
    }).not.toThrow();

    // Listeners are gone, so a later window mousemove no longer scrolls the detached container.
    act(() => {
      fireEvent.mouseMove(window, { clientY: 100000 });
    });
    expect(scrollEl.scrollTop).toBe(200);
  });

  it('ends an in-flight drag and unhooks listeners when the window loses focus', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 300 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => {
      fireEvent.mouseDown(getThumb()!, { clientY: 100 });
    });
    expect(isVisible()).toBe(true);

    // Releasing outside the window delivers blur, not mouseup; the drag must still end
    // (draggingRef cleared) so the static, pointer-away bar can hide.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(isVisible()).toBe(false);

    // Listeners removed: a subsequent window mousemove no longer scrolls the container.
    act(() => {
      fireEvent.mouseMove(window, { clientY: 100000 });
    });
    expect(scrollEl.scrollTop).toBe(200);
  });

  it('clears a shown bar once the content stops overflowing on the next scroll', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    expect(getBar()).not.toBeNull();

    // Content shrinks below the viewport; the next scroll must remove the stale bar
    // instead of leaving a non-scrollable thumb behind.
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });
    act(() => {
      fireEvent.scroll(scrollEl);
    });
    expect(getBar()).toBeNull();
  });

  it('clears a shown bar when a viewport resize removes the overflow', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    expect(getBar()).not.toBeNull();

    // The viewport grows past the content height; a resize fires with no scroll or
    // pointer event, yet the stale bar must still be cleared.
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(getBar()).toBeNull();
  });

  it('clears a shown bar when content size changes without scroll, pointer movement, or window resize', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    expect(getBar()).not.toBeNull();

    // The conversation content shrinks while the page is otherwise idle; the content
    // ResizeObserver refresh clears the stale, non-scrollable thumb.
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });
    act(() => {
      triggerResizeObservers();
    });
    expect(getBar()).toBeNull();
  });

  it('shows when content starts overflowing while the pointer is already on the page', () => {
    const { scrollEl, overlayEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });

    act(() => {
      fireEvent.mouseMove(overlayEl);
    });
    expect(getBar()).toBeNull();

    // Pointer presence is already true. When content becomes scrollable, the passive
    // content-size refresh should now create and show the thumb without requiring another
    // pointermove.
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });
    act(() => {
      triggerResizeObservers();
    });
    expect(isVisible()).toBe(true);
    expect(getThumb()!.style.transform).toBe('translateY(80px)');
  });

  it('retargets the observed content node when the message-flow child is replaced', async () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    const firstFlow = document.createElement('div');
    const secondFlow = document.createElement('div');
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    expect(getBar()).not.toBeNull();

    await act(async () => {
      scrollEl.appendChild(firstFlow);
      await Promise.resolve();
    });

    // A session/content replacement swaps the message-flow child while the page is
    // otherwise idle. The child-list MutationObserver retargets ResizeObserver and
    // refreshes geometry, clearing the stale bar when the new content no longer overflows.
    setMetrics(scrollEl, { scrollTop: 0, scrollHeight: 300, clientHeight: 400 });
    await act(async () => {
      scrollEl.replaceChildren(secondFlow);
      await Promise.resolve();
    });
    expect(getBar()).toBeNull();
  });

  it('refreshes the thumb on resize without forcing the hidden bar visible', () => {
    const { scrollEl } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(isVisible()).toBe(false);

    // A resize with overflow but no scroll/pointer activity measures the thumb but
    // must not pop the hidden bar into view.
    setMetrics(scrollEl, { scrollTop: 200, scrollHeight: 1200, clientHeight: 400 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(getThumb()).not.toBeNull();
    expect(parseFloat(getThumb()!.style.height)).toBeCloseTo(133.33333333333331);
    expect(isVisible()).toBe(false);
  });

  it('cleans up scroll and pointer listeners on unmount after activity', () => {
    const { scrollEl, overlayEl, unmount } = renderScrollbar({ scrollIdleMs: 500 });
    setMetrics(scrollEl, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });

    act(() => {
      fireEvent.scroll(scrollEl);
      fireEvent.mouseMove(overlayEl);
    });

    expect(() => {
      unmount();
    }).not.toThrow();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });

  it('cleans up without pending timers when unmounted before any activity', () => {
    const { unmount } = renderScrollbar();
    expect(() => {
      unmount();
    }).not.toThrow();
  });

  it('attaches no listeners when the container ref is empty on mount', () => {
    const emptyRef = { current: null } as React.RefObject<HTMLDivElement>;
    const { container } = render(<ChatScrollbar scrollContainerRef={emptyRef} />);
    expect(container.querySelector('.chat-scrollbar')).toBeNull();
  });

  it('still tracks scroll but skips pointer listeners when the container has no overlay parent', () => {
    const detached = document.createElement('div');
    setMetrics(detached, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });
    const ref = { current: detached } as React.RefObject<HTMLDivElement>;

    const { unmount } = render(<ChatScrollbar scrollContainerRef={ref} />);

    act(() => {
      fireEvent.scroll(detached);
    });
    // Scroll still reveals the bar even though no overlay parent exists for hover.
    expect(isVisible()).toBe(true);

    expect(() => {
      unmount();
    }).not.toThrow();
  });
});
