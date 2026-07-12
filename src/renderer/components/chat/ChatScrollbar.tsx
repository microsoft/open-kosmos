import React, { useCallback, useEffect, useRef, useState } from 'react';

interface ChatScrollbarProps {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  /** Delay (ms) after the last scroll before the page counts as static. */
  scrollIdleMs?: number;
}

/** Minimum thumb height (px) so it stays grabbable on very long conversations. */
export const CHAT_SCROLLBAR_MIN_THUMB_PX = 28;
/** Default delay (ms) before the page is treated as static after the last scroll. */
export const CHAT_SCROLLBAR_SCROLL_IDLE_MS = 700;

interface ThumbGeometry {
  height: number;
  top: number;
}

/**
 * Maps a scroll position onto the overlay thumb's height and top offset. Returns
 * `null` when the content does not overflow (nothing to scroll), so the caller can
 * skip rendering a thumb entirely. The math is the standard proportional mapping:
 * thumb height tracks the visible fraction of the content (floored at
 * CHAT_SCROLLBAR_MIN_THUMB_PX) and the thumb travels the leftover track in step
 * with scrollTop. It works unchanged under the chat's column-reverse layout because
 * scrollTop stays in standard top-origin coordinates in Chromium.
 */
export function computeThumbGeometry(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): ThumbGeometry | null {
  if (scrollHeight <= clientHeight) {
    return null;
  }

  const track = clientHeight;
  const height = Math.max(CHAT_SCROLLBAR_MIN_THUMB_PX, (clientHeight / scrollHeight) * track);
  const maxThumbTop = track - height;
  const maxScroll = scrollHeight - clientHeight;
  const top = (scrollTop / maxScroll) * maxThumbTop;
  return { height, top: Math.min(Math.max(top, 0), Math.max(maxThumbTop, 0)) };
}

/**
 * Auto-hiding overlay scroll bar for the chat message list. It coexists with the
 * message-flow minimap (`MessageFlowNavigationRail`): the minimap markers are inset
 * into their own lane while this thumb lives in the thin lane at the chat's right
 * edge.
 *
 * Visibility follows GitHub Copilot's behavior:
 * - the page is static and the pointer is off the page -> no scroll bar
 * - the page is scrolling OR the pointer is anywhere on the page (whether it is
 *   moving or resting still) -> scroll bar visible
 * - it hides again only once the page is static AND the pointer has left the page.
 *   Dragging the thumb always keeps it visible.
 *
 * Pointer presence is tracked on the overlay parent (which also hosts the thumb) so
 * hovering the thumb itself still counts as "on the page" and never hides the bar.
 * Activity flags (scrolling / pointer presence / dragging) live in refs, not React
 * state, so pointer movement does not re-render on every event; only the measured
 * thumb geometry and the boolean visibility drive renders.
 */
const ChatScrollbar: React.FC<ChatScrollbarProps> = ({
  scrollContainerRef,
  scrollIdleMs = CHAT_SCROLLBAR_SCROLL_IDLE_MS,
}) => {
  const [thumb, setThumbState] = useState<ThumbGeometry | null>(null);
  const [visible, setVisible] = useState(false);

  const scrollingRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const thumbRef = useRef<ThumbGeometry | null>(null);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tears down the in-flight thumb-drag window listeners; held in a ref so the effect
  // cleanup can also end a drag if the component unmounts before mouseup fires.
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const setThumb = useCallback((next: ThumbGeometry | null) => {
    thumbRef.current = next;
    setThumbState(next);
  }, []);

  // Hide only when the page is static AND the pointer is off the page. An in-flight
  // scroll, an active drag, or the pointer resting anywhere on the page all keep the
  // bar visible.
  const evaluateHide = useCallback(() => {
    if (scrollingRef.current || draggingRef.current || pointerInsideRef.current) {
      return;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    // The thumb is a child of the overlay parent, so tracking pointer presence here
    // (rather than on the scroll container) means moving onto the thumb does not fire
    // a leave and hide the bar.
    const overlay = container.parentElement;

    // Recompute the thumb from the live scroll metrics. When the container no longer
    // overflows (content shrank or the viewport grew) the geometry is null, so clear the
    // thumb and hide — otherwise a stale, non-scrollable bar would linger visible and
    // draggable. `forceVisible` reveals the bar on real scroll/pointer activity; passive
    // size/content refreshes pass false and only show the bar when existing activity
    // (pointer, scroll, drag) says it should be visible.
    const applyGeometry = (forceVisible: boolean) => {
      const next = computeThumbGeometry(container.scrollTop, container.scrollHeight, container.clientHeight);
      if (!next) {
        setThumb(null);
        setVisible(false);
        return;
      }
      const shouldBeVisible =
        forceVisible || scrollingRef.current || draggingRef.current || pointerInsideRef.current;
      if (shouldBeVisible || thumbRef.current) {
        setThumb(next);
      }
      if (shouldBeVisible) {
        setVisible(true);
      }
    };

    const reveal = () => applyGeometry(true);
    // A viewport resize can remove the overflow while the pointer rests motionless (no
    // scroll or move event fires); refresh geometry so the stale bar is cleared.
    const refreshGeometry = () => applyGeometry(false);
    const handleResize = refreshGeometry;

    const handleScroll = () => {
      reveal();
      scrollingRef.current = true;
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = setTimeout(() => {
        scrollingRef.current = false;
        evaluateHide();
      }, scrollIdleMs);
    };

    // The pointer being on the page reveals and holds the bar regardless of whether
    // it is moving; a single move marks it present until it leaves.
    const handlePointerMove = () => {
      pointerInsideRef.current = true;
      reveal();
    };

    const handlePointerLeave = () => {
      pointerInsideRef.current = false;
      evaluateHide();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(refreshGeometry);
    resizeObserver?.observe(container);

    let observedContent: Element | null = null;
    const observeCurrentContent = () => {
      const nextContent = container.firstElementChild;
      if (nextContent === observedContent) {
        return;
      }
      if (observedContent) {
        resizeObserver?.unobserve(observedContent);
      }
      observedContent = nextContent;
      if (observedContent) {
        resizeObserver?.observe(observedContent);
      }
    };
    observeCurrentContent();

    const contentMutationObserver = new MutationObserver(() => {
      observeCurrentContent();
      refreshGeometry();
    });
    contentMutationObserver.observe(container, { childList: true });

    if (overlay) {
      overlay.addEventListener('mousemove', handlePointerMove, { passive: true });
      overlay.addEventListener('mouseleave', handlePointerLeave);
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
      resizeObserver?.disconnect();
      contentMutationObserver.disconnect();
      if (overlay) {
        overlay.removeEventListener('mousemove', handlePointerMove);
        overlay.removeEventListener('mouseleave', handlePointerLeave);
      }
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }
      // End any drag still in flight so its window listeners do not outlive the component.
      dragCleanupRef.current?.();
    };
  }, [scrollContainerRef, evaluateHide, scrollIdleMs, setThumb]);

  const handleThumbMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    event.preventDefault();

    const startY = event.clientY;
    const startScrollTop = container.scrollTop;
    const maxScroll = container.scrollHeight - container.clientHeight;
    const geometry = computeThumbGeometry(startScrollTop, container.scrollHeight, container.clientHeight);
    const maxThumbTop = geometry ? container.clientHeight - geometry.height : 0;

    draggingRef.current = true;
    setVisible(true);

    const handleDragMove = (moveEvent: MouseEvent) => {
      if (maxThumbTop <= 0) {
        return;
      }
      const deltaScroll = ((moveEvent.clientY - startY) / maxThumbTop) * maxScroll;
      const nextScrollTop = Math.min(Math.max(startScrollTop + deltaScroll, 0), maxScroll);
      // Writing scrollTop fires the container's scroll handler, which refreshes the
      // thumb geometry and keeps the bar visible.
      container.scrollTop = nextScrollTop;
    };

    const cleanupDrag = () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('blur', handleDragEnd);
      dragCleanupRef.current = null;
    };

    function handleDragEnd() {
      draggingRef.current = false;
      cleanupDrag();
      evaluateHide();
    }

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    // Releasing the mouse outside the window (or alt-tabbing) never delivers mouseup,
    // which would otherwise leave the drag listeners and draggingRef stuck; blur ends it.
    window.addEventListener('blur', handleDragEnd);
    dragCleanupRef.current = cleanupDrag;
  }, [scrollContainerRef, evaluateHide]);

  if (!thumb) {
    return null;
  }

  return (
    <div className={`chat-scrollbar${visible ? ' is-visible' : ''}`} aria-hidden="true">
      <div
        className="chat-scrollbar-thumb"
        style={{ height: `${thumb.height}px`, transform: `translateY(${thumb.top}px)` }}
        onMouseDown={handleThumbMouseDown}
      />
    </div>
  );
};

export default ChatScrollbar;
