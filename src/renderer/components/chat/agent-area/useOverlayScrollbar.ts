import { useCallback, useRef, useState } from 'react';

interface OverlayScrollbarThumb {
  thumbHeight: number;
  thumbTop: number;
  visible: boolean;
  hovered: boolean;
}

/**
 * Custom overlay scrollbar state for the fixed-height scroll-load lists
 * (built-in agents' session list and the regular agent list). The thumb is
 * hidden by default and revealed on scroll or hover, then auto-hides on a timer.
 * Extracted from AgentList to keep that component within the file-length budget.
 */
export function useOverlayScrollbar() {
  const [scrollbarState, setScrollbarState] = useState<Map<string, OverlayScrollbarThumb>>(new Map());
  const scrollbarHideTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scrollContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Calculate scrollbar position from the tracked container's scroll metrics.
  const updateScrollbar = useCallback((chatId: string, show?: boolean) => {
    const container = scrollContainerRefs.current.get(chatId);
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    if (scrollHeight <= clientHeight) return; // No scrollbar needed

    const thumbH = Math.max(20, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = clientHeight - thumbH;
    const thumbT = (scrollTop / (scrollHeight - clientHeight)) * maxTop;

    setScrollbarState(prev => {
      const next = new Map(prev);
      const cur = next.get(chatId) || { thumbHeight: 0, thumbTop: 0, visible: false, hovered: false };
      next.set(chatId, {
        ...cur,
        thumbHeight: thumbH,
        thumbTop: thumbT,
        visible: show !== undefined ? show : cur.visible,
      });
      return next;
    });

    // Auto-hide timer
    const prevTimer = scrollbarHideTimers.current.get(chatId);
    if (prevTimer) clearTimeout(prevTimer);

    const timer = setTimeout(() => {
      setScrollbarState(prev => {
        const next = new Map(prev);
        const cur = next.get(chatId);
        if (cur && !cur.hovered) {
          next.set(chatId, { ...cur, visible: false });
        }
        return next;
      });
    }, 1200);
    scrollbarHideTimers.current.set(chatId, timer);
  }, []);

  const handleSessionListMouseEnter = useCallback((chatId: string) => {
    setScrollbarState(prev => {
      const next = new Map(prev);
      const cur = next.get(chatId) || { thumbHeight: 0, thumbTop: 0, visible: false, hovered: false };
      next.set(chatId, { ...cur, hovered: true, visible: true });
      return next;
    });
    // Need to calculate position in next frame (ensure DOM is ready)
    requestAnimationFrame(() => updateScrollbar(chatId, true));
  }, [updateScrollbar]);

  const handleSessionListMouseLeave = useCallback((chatId: string) => {
    setScrollbarState(prev => {
      const next = new Map(prev);
      const cur = next.get(chatId);
      if (cur) next.set(chatId, { ...cur, hovered: false });
      return next;
    });
    const timer = setTimeout(() => {
      setScrollbarState(prev => {
        const next = new Map(prev);
        const cur = next.get(chatId);
        if (cur && !cur.hovered) {
          next.set(chatId, { ...cur, visible: false });
        }
        return next;
      });
    }, 800);
    scrollbarHideTimers.current.set(chatId, timer);
  }, []);

  return {
    scrollbarState,
    scrollContainerRefs,
    updateScrollbar,
    handleSessionListMouseEnter,
    handleSessionListMouseLeave,
  };
}
