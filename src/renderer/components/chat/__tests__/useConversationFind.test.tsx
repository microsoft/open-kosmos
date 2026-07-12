/**
 * @vitest-environment happy-dom
 */

import React from 'react';
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
      if (originalHighlight) {
        testGlobal.Highlight = originalHighlight;
      } else {
        delete testGlobal.Highlight;
      }

      if (originalCss) {
        testGlobal.CSS = originalCss;
      } else {
        delete testGlobal.CSS;
      }
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

describe('useConversationFind', () => {
  let highlightApi: ReturnType<typeof installHighlightApi>;

  beforeEach(() => {
    document.body.innerHTML = '';
    highlightApi = installHighlightApi();
  });

  afterEach(() => {
    highlightApi.restore();
  });

  it('collects matches only inside the provided conversation root', () => {
    const outsideInput = document.createElement('input');
    outsideInput.value = 'alpha';
    document.body.appendChild(outsideInput);
    const outsideText = document.createElement('div');
    outsideText.textContent = 'alpha outside';
    document.body.appendChild(outsideText);

    const { root } = createFindDom('<p>alpha inside</p><p>Beta</p>');

    expect(collectConversationFindMatches(root, 'alpha')).toHaveLength(1);
  });

  it('orders matches by visual conversation flow for reversed message containers', () => {
    const { root } = createFindDom('<p>new alpha</p><p>old alpha</p>');

    const matches = collectConversationFindMatches(root, 'alpha');

    expect(matches.map(match => match.textNode.nodeValue)).toEqual(['old alpha', 'new alpha']);
  });

  it('updates count and highlight registries for a scoped query', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>Alpha beta alpha</p>');
    const { result } = renderHook(() => useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }));

    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });

    expect(result.current.activeMatchOrdinal).toBe(2);
    expect(result.current.totalMatches).toBe(2);
    expect(highlightApi.registry.get(CONVERSATION_FIND_ACTIVE_HIGHLIGHT)?.ranges).toHaveLength(1);
    expect(highlightApi.registry.get(CONVERSATION_FIND_MATCH_HIGHLIGHT)?.ranges).toHaveLength(1);
  });

  it('navigates forward and backward through matches', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha beta alpha gamma alpha</p>');
    const { result } = renderHook(() => useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }));

    act(() => {
      result.current.setQuery('alpha', { immediate: true });
    });
    expect(result.current.activeMatchOrdinal).toBe(3);

    act(() => {
      result.current.findPrevious();
    });
    expect(result.current.activeMatchOrdinal).toBe(2);

    act(() => {
      result.current.findNext();
    });
    expect(result.current.activeMatchOrdinal).toBe(3);

    act(() => {
      result.current.findNext();
    });
    expect(result.current.activeMatchOrdinal).toBe(1);
  });

  it('does not search while query changes are marked as composition-only', () => {
    const { rootRef, scrollContainerRef } = createFindDom('<p>alpha</p>');
    const { result } = renderHook(() => useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }));

    act(() => {
      result.current.setQuery('alpha', { skipSearch: true });
    });

    expect(result.current.query).toBe('alpha');
    expect(result.current.totalMatches).toBe(0);
    expect(highlightApi.registry.size).toBe(0);
  });

  it('refreshes matches during continuous conversation mutations', async () => {
    vi.useFakeTimers();
    try {
      const { root, rootRef, scrollContainerRef } = createFindDom('<p>alpha</p>');
      const paragraph = root.querySelector('p');
      const { result } = renderHook(() => useConversationFind({ rootRef, scrollContainerRef, isOpen: true, sessionId: 's1' }));

      act(() => {
        result.current.setQuery('alpha', { immediate: true });
      });
      expect(result.current.totalMatches).toBe(1);

      for (let i = 0; i < 5; i++) {
        await act(async () => {
          paragraph?.append(' alpha');
          await Promise.resolve();
          vi.advanceTimersByTime(100);
        });
      }

      expect(result.current.totalMatches).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
