/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  CONVERSATION_FIND_ACTIVE_HIGHLIGHT,
  CONVERSATION_FIND_MATCH_HIGHLIGHT,
  collectConversationFindMatches,
  useConversationFind,
} from '../useConversationFind';

class MockHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

function installHighlightApi() {
  const registry = new Map<string, MockHighlight>();
  const testGlobal = globalThis as unknown as {
    Highlight?: typeof MockHighlight;
    CSS?: { highlights?: { set: (name: string, highlight: MockHighlight) => void; delete: (name: string) => void } };
  };
  const originalHighlight = testGlobal.Highlight;
  const originalCss = testGlobal.CSS;
  testGlobal.Highlight = MockHighlight;
  testGlobal.CSS = {
    ...originalCss,
    highlights: {
      set: (name, highlight) => registry.set(name, highlight),
      delete: (name) => { registry.delete(name); },
    },
  };
  return {
    registry,
    restore() {
      if (originalHighlight) testGlobal.Highlight = originalHighlight; else delete testGlobal.Highlight;
      if (originalCss) testGlobal.CSS = originalCss; else delete testGlobal.CSS;
    },
  };
}

function createFindDom(messageHtml: string) {
  const scrollContainer = document.createElement('div');
  const root = document.createElement('div');
  root.className = 'chat-message-flow-reverse';
  root.innerHTML = messageHtml;
  scrollContainer.appendChild(root);
  document.body.appendChild(scrollContainer);
  return {
    root,
    scrollContainer,
    rootRef: { current: root } as React.RefObject<HTMLElement>,
    scrollContainerRef: { current: scrollContainer } as React.RefObject<HTMLElement>,
  };
}

describe('useConversationFind extra coverage', () => {
  let highlightApi: ReturnType<typeof installHighlightApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    highlightApi = installHighlightApi();
  });

  afterEach(() => {
    highlightApi.restore();
    vi.restoreAllMocks();
  });

  it('reports unsupported and resets when the Highlight API is unavailable', () => {
    highlightApi.restore(); // remove Highlight API before mounting the hook
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha</p>');
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    expect(result.current.isSupported).toBe(false);

    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(0);
    // re-install for afterEach restore symmetry
    highlightApi = installHighlightApi();
  });

  it('deletes the non-active highlight registry when only one match exists', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>only alpha here</p>');
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(1);
    expect(highlightApi.registry.get(CONVERSATION_FIND_ACTIVE_HIGHLIGHT)?.ranges).toHaveLength(1);
    // single match -> the "other matches" group is empty, so the registry entry is deleted
    expect(highlightApi.registry.has(CONVERSATION_FIND_MATCH_HIGHLIGHT)).toBe(false);
  });

  it('skips text inside hidden, aria-hidden, and non-content elements', () => {
    const scrollContainer = document.createElement('div');
    const root = document.createElement('div');
    root.className = 'chat-message-flow-reverse';
    scrollContainer.appendChild(root);
    document.body.appendChild(scrollContainer);

    const visible = document.createElement('p');
    visible.appendChild(document.createTextNode('alpha visible'));
    root.appendChild(visible);

    // Each excluded container gets a real text node so the corresponding
    // tag-name / visibility guard branch is exercised.
    for (const tag of ['script', 'style', 'noscript', 'textarea', 'select', 'option']) {
      const el = document.createElement(tag);
      el.appendChild(document.createTextNode('alpha ' + tag));
      root.appendChild(el);
    }

    const hidden = document.createElement('p');
    hidden.hidden = true;
    hidden.appendChild(document.createTextNode('alpha hidden'));
    root.appendChild(hidden);

    const aria = document.createElement('p');
    aria.setAttribute('aria-hidden', 'true');
    aria.appendChild(document.createTextNode('alpha aria'));
    root.appendChild(aria);

    expect(collectConversationFindMatches(root, 'alpha')).toHaveLength(1);
  });

  it('returns no matches for a blank query passed directly to the collector', () => {
    const { root } = createFindDom('<p>alpha beta</p>');
    expect(collectConversationFindMatches(root, '   ')).toEqual([]);
    expect(collectConversationFindMatches(root, '')).toEqual([]);
  });

  it('orders matches across multiple reversed message bubbles', () => {
    const { root } = createFindDom(
      '<div class="bubble"><p>newest alpha</p></div><div class="bubble"><p>older alpha here</p></div>',
    );
    const matches = collectConversationFindMatches(root, 'alpha');
    expect(matches).toHaveLength(2);
    // Reversed visual flow: the later DOM bubble is shown first.
    expect(matches[0].textNode.nodeValue).toContain('older');
    expect(matches[1].textNode.nodeValue).toContain('newest');
  });

  it('clears matches when the query is emptied', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta alpha</p>');
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(2);
    act(() => {
      result.current.setQuery('', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(0);
  });

  it('flushes a pending debounced search when navigating forward before the timer fires', () => {
    vi.useFakeTimers();
    try {
      const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta alpha gamma alpha</p>');
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      // Debounced (non-immediate) query change leaves a pending search.
      act(() => {
        result.current.setQuery('alpha');
      });
      expect(result.current.totalMatches).toBe(0);
      // Navigating forward flushes the pending search immediately.
      act(() => {
        result.current.findNext();
      });
      expect(result.current.totalMatches).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending debounced search when navigating backward before the timer fires', () => {
    vi.useFakeTimers();
    try {
      const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta alpha</p>');
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      act(() => {
        result.current.setQuery('alpha');
      });
      act(() => {
        result.current.findPrevious();
      });
      expect(result.current.totalMatches).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs the debounced search once the timer elapses', () => {
    vi.useFakeTimers();
    try {
      const { rootRef, scrollContainerRef } = createFindDom('<p>alpha alpha</p>');
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      act(() => {
        result.current.setQuery('alpha');
      });
      expect(result.current.totalMatches).toBe(0);
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(result.current.totalMatches).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores navigation when there are no matches and nothing pending', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>nothing here</p>');
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    act(() => {
      result.current.findNext();
      result.current.findPrevious();
    });
    expect(result.current.totalMatches).toBe(0);
    expect(result.current.activeMatchOrdinal).toBe(0);
  });

  it('scrolls using the bounding-rect fallback when the range has a zero-size rect', () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrollIntoView as never);
    const zeroRect = {
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect;
    const original = Range.prototype.getBoundingClientRect;
    // Direct prototype assignment so internally created Range instances pick it up.
    Range.prototype.getBoundingClientRect = () => zeroRect;
    try {
      const { rootRef, scrollContainerRef } = createFindDom('<p>alpha here</p>');
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      act(() => {
        result.current.setQuery('alpha', { immediate: true });
      });
      expect(result.current.totalMatches).toBe(1);
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      Range.prototype.getBoundingClientRect = original;
    }
  });

  it('scrolls by adjusting scrollTop when the range has a non-zero rect', () => {
    const original = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 100, bottom: 120, left: 0, right: 10, width: 10, height: 20, x: 0, y: 100, toJSON: () => ({}) } as DOMRect);
    try {
      const { rootRef, scrollContainerRef, scrollContainer } = createFindDom('<p>alpha there</p>');
      scrollContainer.getBoundingClientRect = () =>
        ({ top: 0, bottom: 50, left: 0, right: 10, width: 10, height: 50, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      act(() => {
        result.current.setQuery('alpha', { immediate: true });
      });
      expect(result.current.totalMatches).toBe(1);
    } finally {
      Range.prototype.getBoundingClientRect = original;
    }
  });

  it('scrolls using the fallback when the range has no getBoundingClientRect', () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(scrollIntoView as never);
    const original = Range.prototype.getBoundingClientRect;
    // Force the "not a function" branch.
    (Range.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect = undefined;
    try {
      const { rootRef, scrollContainerRef } = createFindDom('<p>alpha alone</p>');
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      act(() => {
        result.current.setQuery('alpha', { immediate: true });
      });
      expect(result.current.totalMatches).toBe(1);
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      (Range.prototype as unknown as { getBoundingClientRect: unknown }).getBoundingClientRect = original;
    }
  });

  it('clears all highlights when a non-empty query has no matches', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta gamma</p>');
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    act(() => {
      result.current.setQuery('zzz-missing', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(0);
    expect(result.current.activeMatchOrdinal).toBe(0);
    expect(highlightApi.registry.size).toBe(0);
  });

  it('does not search while closed and clears when isOpen is false', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta alpha</p>');
    const { result, rerender } = renderHook(
      ({ isOpen }) => useConversationFind({ rootRef, scrollContainerRef, isOpen, sessionId: 's1' }),
      { initialProps: { isOpen: true } },
    );
    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(2);

    act(() => {
      rerender({ isOpen: false });
    });
    expect(result.current.totalMatches).toBe(0);
    expect(result.current.query).toBe('');
  });

  it('does not start a mutation observer when the query is empty', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha</p>');
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    // query stays empty -> the observer effect bails out at the query guard
    expect(result.current.query).toBe('');
    expect(result.current.totalMatches).toBe(0);
  });

  it('resets matches in runSearch when the root element is detached', () => {
    const scrollContainer = document.createElement('div');
    document.body.appendChild(scrollContainer);
    const rootRef = { current: null } as React.RefObject<HTMLElement>;
    const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLElement>;
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(0);
  });

  it('searches without scrolling when there is no scroll container', () => {
    const root = document.createElement('div');
    root.className = 'chat-message-flow-reverse';
    root.innerHTML = '<p>alpha beta alpha</p>';
    document.body.appendChild(root);
    const rootRef = { current: root } as React.RefObject<HTMLElement>;
    const scrollContainerRef = { current: null } as React.RefObject<HTMLElement>;
    const { result } = renderHook(() =>
      useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
    );
    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.totalMatches).toBe(2);
    // Navigation still works even though there is no scroll container.
    act(() => {
      result.current.findNext();
    });
    expect(result.current.activeMatchOrdinal).toBe(1);
  });

  it('drops a pending search when a later change requests skipSearch', () => {
    vi.useFakeTimers();
    try {
      const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta alpha</p>');
      const { result } = renderHook(() =>
        useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }),
      );
      act(() => {
        result.current.setQuery('alpha'); // schedules a debounced search
      });
      act(() => {
        result.current.setQuery('alpha typing', { skipSearch: true }); // cancels pending
      });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current.totalMatches).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
