/**
 * @vitest-environment happy-dom
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatRenderItem } from '../ChatRenderItem';
import MessageFlowNavigationRail, {
  buildMessageFlowNavigationMarkers,
  CHAT_RENDER_ITEM_KEY_ATTRIBUTE,
  formatMarkerTimestamp,
  getCurrentMarkerKey,
  getMarkerClusterGap,
  getMarkerClusterOffset,
  getMarkerWaveWidth,
  getRenderItemElementsByKey,
  getScrollTopForElement,
  MARKER_CLUSTER_END_INSET_PX,
  MARKER_CLUSTER_GAP_PX,
  MARKER_MAX_WIDTH_PX,
  MARKER_MIN_WIDTH_PX,
  MARKER_SCROLL_SETTLE_INTERVAL_MS,
  MARKER_SCROLL_SETTLE_MAX_PASSES,
} from '../MessageFlowNavigationRail';

function textMessage(
  id: string,
  role: 'user' | 'assistant' | 'system',
  text: string,
  timestamp = 1_700_000_000_000,
) {
  return {
    id,
    role,
    timestamp,
    content: [{ type: 'text', text }],
  };
}

const renderItems: ChatRenderItem[] = [
  { type: 'user', message: textMessage('u1', 'user', 'First user message') as any, index: 0 },
  { type: 'assistant', message: textMessage('a1', 'assistant', 'Assistant response with a long enough preview') as any, index: 1 },
  {
    type: 'tool-calls-section',
    toolCalls: [
      { id: 'tc1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      { id: 'tc2', type: 'function', function: { name: 'write_file', arguments: '{}' } },
    ],
    sectionKey: 'tools-1',
    index: 2,
  },
  { type: 'activity-loading', sectionKey: 'loading', index: 3 },
];

const twoUserItems: ChatRenderItem[] = [
  { type: 'user', message: textMessage('u1', 'user', 'First user message') as any, index: 0 },
  { type: 'assistant', message: textMessage('a1', 'assistant', 'Assistant response') as any, index: 1 },
  { type: 'user', message: textMessage('u2', 'user', 'Second user message') as any, index: 2 },
];

function defineScrollGeometry(element: HTMLElement, geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: geometry.scrollHeight },
    clientHeight: { configurable: true, value: geometry.clientHeight },
    scrollTop: { configurable: true, writable: true, value: geometry.scrollTop },
  });
}

function createRect(top: number, height: number, width = 40): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: width,
    width,
    x: 0,
    y: top,
    toJSON: () => undefined,
  } as DOMRect;
}

function createMessageFlowRef(element = document.createElement('div')): React.RefObject<HTMLDivElement> {
  return { current: element as HTMLDivElement };
}

describe('MessageFlowNavigationRail', () => {
  it('builds navigation markers only from displayed user messages', () => {
    const markers = buildMessageFlowNavigationMarkers(renderItems);

    expect(markers).toEqual([
      {
        key: 'user:u1',
        label: 'User',
        preview: 'First user message',
        timestamp: 1_700_000_000_000,
      },
    ]);
  });

  it('keeps all displayed user markers in conversation order', () => {
    const markers = buildMessageFlowNavigationMarkers(twoUserItems);

    expect(markers.map((marker) => marker.preview)).toEqual([
      'First user message',
      'Second user message',
    ]);
  });

  it('filters hidden user messages and non-user items', () => {
    const longText = 'word '.repeat(40);
    const markers = buildMessageFlowNavigationMarkers([
      { type: 'user', message: textMessage('u-empty', 'user', '') as any, index: 0 },
      { type: 'user', message: { ...textMessage('u-synthetic', 'user', 'hidden'), metadata: { synthetic: true } } as any, index: 1 },
      { type: 'user', message: textMessage('u-trigger', 'user', '<task-notification-trigger/>') as any, index: 2 },
      { type: 'assistant', message: textMessage('a-empty', 'assistant', '') as any, index: 1 },
      { type: 'system', message: textMessage('s-empty', 'system', '') as any, index: 2 },
      { type: 'say-hi', message: textMessage('say-hi-1', 'assistant', 'Hello there') as any, index: 3 },
      { type: 'user', message: textMessage('u-long', 'user', longText) as any, index: 4 },
      {
        type: 'interactive-request',
        interactiveRequest: { interactionId: 'ask-1', type: 'choice', prompt: 'Pick one', options: [] } as any,
        sectionKey: 'ask-1',
        index: 6,
      },
    ]);

    expect(markers.map((marker) => marker.preview)).toEqual([
      'User message',
      expect.stringMatching(/\.\.\.$/),
    ]);
  });

  it('computes a centered cluster gap that compresses when the rail is short', () => {
    expect(getMarkerClusterGap(1, 400)).toBe(0);
    expect(getMarkerClusterGap(0, 400)).toBe(0);
    expect(getMarkerClusterGap(3, 0)).toBe(MARKER_CLUSTER_GAP_PX);
    // Plenty of room -> keep the default gap.
    expect(getMarkerClusterGap(5, 400)).toBe(MARKER_CLUSTER_GAP_PX);
    // Tall rail, crowded -> compress against the 84% fill (the inset leaves more room).
    expect(getMarkerClusterGap(80, 800)).toBeCloseTo((800 * 0.84) / 79, 8);
  });

  it('reserves end insets so the extreme markers clear the top/bottom overlays', () => {
    // Short rail, crowded -> the end inset binds before the 84% fill, pulling the
    // outermost markers in so they clear the find bar (top) and jump button (bottom).
    expect(getMarkerClusterGap(80, 400)).toBeCloseTo(
      (400 - 2 * MARKER_CLUSTER_END_INSET_PX) / 79,
      8,
    );
    // Rail too short to honor both insets -> fall back to the plain fill so markers
    // do not collapse onto each other.
    expect(getMarkerClusterGap(80, 100)).toBeCloseTo((100 * 0.84) / 79, 8);
  });

  it('spreads marker offsets symmetrically around the center', () => {
    expect(getMarkerClusterOffset(0, 1, 0)).toBe(0);
    expect(getMarkerClusterOffset(0, 2, 13)).toBe(-6.5);
    expect(getMarkerClusterOffset(1, 2, 13)).toBe(6.5);
    expect(getMarkerClusterOffset(0, 3, 13)).toBe(-13);
    expect(getMarkerClusterOffset(1, 3, 13)).toBe(0);
    expect(getMarkerClusterOffset(2, 3, 13)).toBe(13);
  });

  it('formats marker timestamps relative to now', () => {
    const now = new Date(2026, 5, 23, 18, 0);
    expect(formatMarkerTimestamp(0, now)).toBe('');
    expect(formatMarkerTimestamp(Number.NaN, now)).toBe('');
    expect(formatMarkerTimestamp(new Date(2026, 5, 23, 15, 24).getTime(), now)).toBe('Today, 3:24 PM');
    expect(formatMarkerTimestamp(new Date(2026, 5, 23, 0, 5).getTime(), now)).toBe('Today, 12:05 AM');
    expect(formatMarkerTimestamp(new Date(2026, 5, 22, 9, 0).getTime(), now)).toBe('Yesterday, 9:00 AM');
    expect(formatMarkerTimestamp(new Date(2026, 0, 4, 13, 7).getTime(), now)).toBe('Jan 4, 1:07 PM');
  });

  it('renders markers as a centered cluster with symmetric offsets', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={twoUserItems}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    const markerButtons = screen.getAllByRole('button', { name: /user message/i });
    expect(markerButtons).toHaveLength(2);
    expect(markerButtons[0]).toHaveStyle({ marginTop: '-6.5px' });
    expect(markerButtons[1]).toHaveStyle({ marginTop: '6.5px' });
    // At rest (no hover) every marker sits at the minimum wave width.
    expect(markerButtons[0]).toHaveStyle({ width: `${MARKER_MIN_WIDTH_PX}px` });
    expect(markerButtons[1]).toHaveStyle({ width: `${MARKER_MIN_WIDTH_PX}px` });
  });

  it('computes a sound-wave width that crests at the focus point', () => {
    expect(getMarkerWaveWidth(10, null)).toBe(MARKER_MIN_WIDTH_PX);
    expect(getMarkerWaveWidth(10, 10)).toBeCloseTo(MARKER_MAX_WIDTH_PX, 8);
    // Symmetric falloff around the focus point.
    expect(getMarkerWaveWidth(-13, 0)).toBeCloseTo(getMarkerWaveWidth(13, 0), 8);
    // Closer to the crest is wider than further away.
    expect(getMarkerWaveWidth(13, 0)).toBeGreaterThan(getMarkerWaveWidth(39, 0));
    // Far markers relax back toward the minimum width.
    expect(getMarkerWaveWidth(400, 0)).toBeCloseTo(MARKER_MIN_WIDTH_PX, 6);
  });

  it('magnifies markers into a wave that follows the pointer', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={twoUserItems}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    const cluster = document.querySelector('.chat-message-navigation-cluster') as HTMLElement;
    // Cluster center is at y=100; the first marker sits 6.5px above center.
    cluster.getBoundingClientRect = () => createRect(0, 200);
    const markerButtons = screen.getAllByRole('button', { name: /user message/i });

    fireEvent.pointerMove(cluster, { clientY: 93.5 });

    const firstWidth = Number.parseFloat((markerButtons[0] as HTMLElement).style.width);
    const secondWidth = Number.parseFloat((markerButtons[1] as HTMLElement).style.width);
    // Pointer is right on the first marker -> it crests, the far one stays smaller.
    expect(firstWidth).toBeCloseTo(MARKER_MAX_WIDTH_PX, 4);
    expect(firstWidth).toBeGreaterThan(secondWidth);

    fireEvent.pointerLeave(cluster);
    expect((markerButtons[0] as HTMLElement).style.width).toBe(`${MARKER_MIN_WIDTH_PX}px`);
  });

  it('crests the wave on the focused marker for keyboard navigation', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={twoUserItems}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    const markerButtons = screen.getAllByRole('button', { name: /user message/i });
    fireEvent.focus(markerButtons[1]);

    expect(markerButtons[1]).toHaveClass('is-active');
    const focusedWidth = Number.parseFloat((markerButtons[1] as HTMLElement).style.width);
    const otherWidth = Number.parseFloat((markerButtons[0] as HTMLElement).style.width);
    expect(focusedWidth).toBeCloseTo(MARKER_MAX_WIDTH_PX, 4);
    expect(focusedWidth).toBeGreaterThan(otherWidth);

    fireEvent.blur(markerButtons[1]);
    expect((markerButtons[1] as HTMLElement).style.width).toBe(`${MARKER_MIN_WIDTH_PX}px`);
  });

  it('selects the current marker via the reading line with a topmost fallback', () => {
    const markers = buildMessageFlowNavigationMarkers(twoUserItems);

    // Both messages are below the reading line -> fall back to the topmost one.
    expect(getCurrentMarkerKey(markers, new Map([['user:u1', 200], ['user:u2', 350]]), 100)).toBe('user:u1');
    // The lower message has crossed above the line -> it becomes the active turn.
    expect(getCurrentMarkerKey(markers, new Map([['user:u1', 10], ['user:u2', 80]]), 100)).toBe('user:u2');
    // A later marker above the line but higher up does not steal the active turn.
    expect(getCurrentMarkerKey(markers, new Map([['user:u1', 80], ['user:u2', 10]]), 100)).toBe('user:u1');
    // Missing elements are skipped; an empty map yields no current marker.
    expect(getCurrentMarkerKey(markers, new Map([['user:u2', 80]]), 100)).toBe('user:u2');
    expect(getCurrentMarkerKey(markers, new Map(), 100)).toBeNull();
  });

  it('marks the user message currently in view as the active turn while scrolling', () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    scrollContainer.getBoundingClientRect = () => createRect(0, 300);
    const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

    const messageFlow = document.createElement('div');
    const firstAnchor = document.createElement('div');
    firstAnchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
    firstAnchor.getBoundingClientRect = () => createRect(20, 40);
    const secondAnchor = document.createElement('div');
    secondAnchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u2');
    secondAnchor.getBoundingClientRect = () => createRect(500, 40);
    messageFlow.append(firstAnchor, secondAnchor);
    const messageFlowRef = createMessageFlowRef(messageFlow);

    render(
      <MessageFlowNavigationRail
        items={twoUserItems}
        scrollContainerRef={scrollContainerRef}
        messageFlowRef={messageFlowRef}
      />,
    );

    // Reading line = 0 + 300 * 0.5 = 150. Only the first message is above it.
    const [firstMarker, secondMarker] = screen.getAllByRole('button', { name: /user message/i });
    expect(firstMarker).toHaveClass('is-active');
    expect(secondMarker).not.toHaveClass('is-active');

    // Scroll so the second message crosses above the reading line.
    secondAnchor.getBoundingClientRect = () => createRect(60, 40);
    fireEvent.scroll(scrollContainer);
    expect(secondMarker).toHaveClass('is-active');
    expect(firstMarker).not.toHaveClass('is-active');

    // A scroll that does not change the active turn leaves the highlight untouched.
    fireEvent.scroll(scrollContainer);
    expect(secondMarker).toHaveClass('is-active');
  });

  it('does not re-scan marker positions on streaming re-renders that keep the same user keys', () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 250, scrollTop: 0 });
    scrollContainer.getBoundingClientRect = () => createRect(0, 250);
    const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

    const messageFlow = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
    let measureCount = 0;
    anchor.getBoundingClientRect = () => {
      measureCount += 1;
      return createRect(100, 40);
    };
    messageFlow.appendChild(anchor);
    const messageFlowRef = createMessageFlowRef(messageFlow);

    const userItem: ChatRenderItem = { type: 'user', message: textMessage('u1', 'user', 'First user message') as any, index: 0 };
    const streamA: ChatRenderItem[] = [userItem, { type: 'assistant', message: textMessage('a1', 'assistant', 'partial') as any, index: 1 }];
    const streamB: ChatRenderItem[] = [userItem, { type: 'assistant', message: textMessage('a1', 'assistant', 'partial response that grew longer') as any, index: 1 }];
    const withNewUser: ChatRenderItem[] = [...streamB, { type: 'user', message: textMessage('u2', 'user', 'Second user message') as any, index: 2 }];

    const { rerender } = render(
      <MessageFlowNavigationRail items={streamA} scrollContainerRef={scrollContainerRef} messageFlowRef={messageFlowRef} />,
    );
    const afterMount = measureCount;
    expect(afterMount).toBeGreaterThan(0);

    // Streaming recreates the items array but leaves the user-message keys unchanged, so the
    // current-turn effect must NOT re-subscribe and re-measure every marker on each token.
    rerender(
      <MessageFlowNavigationRail items={streamB} scrollContainerRef={scrollContainerRef} messageFlowRef={messageFlowRef} />,
    );
    expect(measureCount).toBe(afterMount);

    // Adding a user message changes the marker set, so a fresh scan is expected.
    const secondAnchor = document.createElement('div');
    secondAnchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u2');
    secondAnchor.getBoundingClientRect = () => createRect(300, 40);
    messageFlow.appendChild(secondAnchor);
    rerender(
      <MessageFlowNavigationRail items={withNewUser} scrollContainerRef={scrollContainerRef} messageFlowRef={messageFlowRef} />,
    );
    expect(measureCount).toBeGreaterThan(afterMount);
  });

  it('scrolls to the rendered user message position when a marker is clicked', async () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 250, scrollTop: 0 });
    scrollContainer.getBoundingClientRect = () => createRect(50, 250);
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;
    const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;
    const messageFlow = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
    anchor.getBoundingClientRect = () => createRect(425, 40);
    messageFlow.appendChild(anchor);
    const messageFlowRef = createMessageFlowRef(messageFlow);

    render(
      <MessageFlowNavigationRail
        items={renderItems}
        scrollContainerRef={scrollContainerRef}
        messageFlowRef={messageFlowRef}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /First user message/i }));

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 375, behavior: 'smooth' });
    });
  });

  it('re-aims after a marker click while lazy placeholders expand the target, then converges', () => {
    vi.useFakeTimers();
    try {
      const scrollContainer = document.createElement('div');
      defineScrollGeometry(scrollContainer, { scrollHeight: 10_000, clientHeight: 250, scrollTop: 0 });
      scrollContainer.getBoundingClientRect = () => createRect(0, 250);
      const scrollTo = vi.fn();
      scrollContainer.scrollTo = scrollTo;
      const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

      const messageFlow = document.createElement('div');
      const anchor = document.createElement('div');
      anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
      let anchorTop = 1000;
      anchor.getBoundingClientRect = () => createRect(anchorTop, 40);
      messageFlow.appendChild(anchor);
      const messageFlowRef = createMessageFlowRef(messageFlow);

      act(() => {
        render(
          <MessageFlowNavigationRail
            items={renderItems}
            scrollContainerRef={scrollContainerRef}
            messageFlowRef={messageFlowRef}
          />,
        );
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: 'smooth' });

      // Each settle pass sees the placeholders above the target render to full height,
      // so the measured target grows and the rail re-aims toward the corrected position.
      anchorTop = 2000;
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS);
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: 'smooth' });

      anchorTop = 2600;
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS);
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 2600, behavior: 'smooth' });

      // Once the target stops growing the loop must stop issuing corrections.
      const callsAfterConverge = scrollTo.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS * 4);
      });
      expect(scrollTo).toHaveBeenCalledTimes(callsAfterConverge);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops the settle loop when the target element disappears mid-scroll', () => {
    vi.useFakeTimers();
    try {
      const scrollContainer = document.createElement('div');
      defineScrollGeometry(scrollContainer, { scrollHeight: 10_000, clientHeight: 250, scrollTop: 0 });
      scrollContainer.getBoundingClientRect = () => createRect(0, 250);
      const scrollTo = vi.fn();
      scrollContainer.scrollTo = scrollTo;
      const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

      const messageFlow = document.createElement('div');
      const anchor = document.createElement('div');
      anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
      anchor.getBoundingClientRect = () => createRect(1000, 40);
      messageFlow.appendChild(anchor);
      const messageFlowRef = createMessageFlowRef(messageFlow);

      act(() => {
        render(
          <MessageFlowNavigationRail
            items={renderItems}
            scrollContainerRef={scrollContainerRef}
            messageFlowRef={messageFlowRef}
          />,
        );
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);

      // The anchor is removed before the next settle pass, so re-measuring yields null.
      messageFlow.removeChild(anchor);
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS * 4);
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps the settle loop at the configured maximum number of passes', () => {
    vi.useFakeTimers();
    try {
      const scrollContainer = document.createElement('div');
      defineScrollGeometry(scrollContainer, { scrollHeight: 1_000_000, clientHeight: 250, scrollTop: 0 });
      scrollContainer.getBoundingClientRect = () => createRect(0, 250);
      const scrollTo = vi.fn();
      scrollContainer.scrollTo = scrollTo;
      const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

      const messageFlow = document.createElement('div');
      const anchor = document.createElement('div');
      anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
      let anchorTop = 1000;
      anchor.getBoundingClientRect = () => {
        anchorTop += 500;
        return createRect(anchorTop, 40);
      };
      messageFlow.appendChild(anchor);
      const messageFlowRef = createMessageFlowRef(messageFlow);

      act(() => {
        render(
          <MessageFlowNavigationRail
            items={renderItems}
            scrollContainerRef={scrollContainerRef}
            messageFlowRef={messageFlowRef}
          />,
        );
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
      });

      // The target keeps growing forever, but the loop must stop after the pass cap.
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS * (MARKER_SCROLL_SETTLE_MAX_PASSES + 6));
      });

      expect(scrollTo).toHaveBeenCalledTimes(MARKER_SCROLL_SETTLE_MAX_PASSES + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight settle loop when another marker is clicked', () => {
    vi.useFakeTimers();
    try {
      const scrollContainer = document.createElement('div');
      defineScrollGeometry(scrollContainer, { scrollHeight: 10_000, clientHeight: 250, scrollTop: 0 });
      scrollContainer.getBoundingClientRect = () => createRect(0, 250);
      const scrollTo = vi.fn();
      scrollContainer.scrollTo = scrollTo;
      const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

      const messageFlow = document.createElement('div');
      const firstAnchor = document.createElement('div');
      firstAnchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
      let firstAnchorTop = 1000;
      firstAnchor.getBoundingClientRect = () => createRect(firstAnchorTop, 40);
      const secondAnchor = document.createElement('div');
      secondAnchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u2');
      secondAnchor.getBoundingClientRect = () => createRect(4000, 40);
      messageFlow.appendChild(firstAnchor);
      messageFlow.appendChild(secondAnchor);
      const messageFlowRef = createMessageFlowRef(messageFlow);

      act(() => {
        render(
          <MessageFlowNavigationRail
            items={twoUserItems}
            scrollContainerRef={scrollContainerRef}
            messageFlowRef={messageFlowRef}
          />,
        );
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
      });
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Second user message/i }));
      });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 4000, behavior: 'smooth' });

      // The first loop is cancelled, so growth of the first anchor never re-aims the scroll.
      firstAnchorTop = 9000;
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS * 4);
      });
      expect(scrollTo).not.toHaveBeenCalledWith({ top: 9000, behavior: 'smooth' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight settle loop when the rendered item set changes', () => {
    vi.useFakeTimers();
    try {
      const scrollContainer = document.createElement('div');
      defineScrollGeometry(scrollContainer, { scrollHeight: 10_000, clientHeight: 250, scrollTop: 0 });
      scrollContainer.getBoundingClientRect = () => createRect(0, 250);
      const scrollTo = vi.fn();
      scrollContainer.scrollTo = scrollTo;
      const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;

      const messageFlow = document.createElement('div');
      const anchor = document.createElement('div');
      anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
      let anchorTop = 1000;
      anchor.getBoundingClientRect = () => createRect(anchorTop, 40);
      messageFlow.appendChild(anchor);
      const messageFlowRef = createMessageFlowRef(messageFlow);

      const firstItems: ChatRenderItem[] = [
        { type: 'user', message: textMessage('u1', 'user', 'First user message') as any, index: 0 },
      ];
      const nextItems: ChatRenderItem[] = [
        { type: 'user', message: textMessage('u9', 'user', 'A different session message') as any, index: 0 },
      ];

      let rerender!: (ui: React.ReactElement) => void;
      act(() => {
        ({ rerender } = render(
          <MessageFlowNavigationRail
            items={firstItems}
            scrollContainerRef={scrollContainerRef}
            messageFlowRef={messageFlowRef}
          />,
        ));
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);

      // Switching to a different item set must abort the loop started for the old marker key,
      // even though that key (`user:u1`) still resolves to a (now stale) anchor in the DOM.
      act(() => {
        rerender(
          <MessageFlowNavigationRail
            items={nextItems}
            scrollContainerRef={scrollContainerRef}
            messageFlowRef={messageFlowRef}
          />,
        );
      });

      anchorTop = 5000;
      act(() => {
        vi.advanceTimersByTime(MARKER_SCROLL_SETTLE_INTERVAL_MS * 4);
      });
      expect(scrollTo).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores marker clicks when the rendered message is missing', () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 250, scrollTop: 0 });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;
    const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;
    const messageFlowRef = createMessageFlowRef();

    render(
      <MessageFlowNavigationRail
        items={renderItems}
        scrollContainerRef={scrollContainerRef}
        messageFlowRef={messageFlowRef}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does nothing when the scroll container or message flow refs are empty', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = { current: null } as React.RefObject<HTMLDivElement>;

    render(
      <MessageFlowNavigationRail
        items={renderItems}
        scrollContainerRef={scrollContainerRef}
        messageFlowRef={messageFlowRef}
      />,
    );

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: /First user message/i }));
      window.dispatchEvent(new Event('resize'));
    }).not.toThrow();
  });

  it('shows a hover tooltip with the message preview and timestamp', () => {
    const todayTimestamp = (() => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 24).getTime();
    })();
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={[{ type: 'user', message: textMessage('u1', 'user', 'First user message', todayTimestamp) as any, index: 0 }]}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: /First user message/i }));

    expect(screen.getByText('First user message')).toBeInTheDocument();
    expect(screen.getByText('Today, 3:24 PM')).toBeInTheDocument();

    // Leaving the marker no longer hides the card: it stays so the pointer can travel onto it
    // and click it. Only leaving the whole cluster (markers + card) dismisses it.
    fireEvent.mouseLeave(screen.getByRole('button', { name: /First user message/i }));
    expect(screen.getByText('First user message')).toBeInTheDocument();

    fireEvent.pointerLeave(document.querySelector('.chat-message-navigation-cluster') as HTMLElement);
    expect(screen.queryByText('First user message')).not.toBeInTheDocument();
  });

  it('scrolls to the rendered user message when the hover preview card is clicked', async () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 250, scrollTop: 0 });
    scrollContainer.getBoundingClientRect = () => createRect(50, 250);
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;
    const scrollContainerRef = { current: scrollContainer } as React.RefObject<HTMLDivElement>;
    const messageFlow = document.createElement('div');
    const anchor = document.createElement('div');
    anchor.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
    anchor.getBoundingClientRect = () => createRect(425, 40);
    messageFlow.appendChild(anchor);
    const messageFlowRef = createMessageFlowRef(messageFlow);

    render(
      <MessageFlowNavigationRail
        items={renderItems}
        scrollContainerRef={scrollContainerRef}
        messageFlowRef={messageFlowRef}
      />,
    );

    // Hover the marker to reveal the card, then click the card itself (not the marker).
    fireEvent.mouseEnter(screen.getByRole('button', { name: /First user message/i }));
    const card = document.querySelector('.chat-message-navigation-tooltip') as HTMLElement;
    // mousedown is prevented so clicking the card cannot steal focus from (and thus blur+unmount)
    // a keyboard-focused marker before the click lands. fireEvent returns false when default was
    // prevented.
    expect(fireEvent.mouseDown(card)).toBe(false);
    fireEvent.click(card);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 375, behavior: 'smooth' });
    });
  });

  it('omits the timestamp line when the message has no usable timestamp', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={[{ type: 'user', message: textMessage('u1', 'user', 'No timestamp message', 0) as any, index: 0 }]}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    fireEvent.focus(screen.getByRole('button', { name: /No timestamp message/i }));

    expect(screen.getByText('No timestamp message')).toBeInTheDocument();
    const tooltip = document.querySelector('.chat-message-navigation-tooltip');
    expect(tooltip?.querySelector('.chat-message-navigation-tooltip-time')).toBeNull();
  });

  it('supports keyboard focus and renders nothing for empty markers', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    const { rerender, container } = render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={[]}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    expect(container.querySelector('.chat-message-navigation-rail')).toBeNull();

    rerender(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={renderItems}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    fireEvent.focus(screen.getByRole('button', { name: /First user message/i }));
    expect(screen.getByText('First user message')).toBeInTheDocument();
    fireEvent.blur(screen.getByRole('button', { name: /First user message/i }));
    expect(screen.queryByText('First user message')).not.toBeInTheDocument();
  });

  it('re-measures the rail height on window resize without throwing', () => {
    const scrollContainerRef = React.createRef<HTMLDivElement>();
    const messageFlowRef = createMessageFlowRef();
    render(
      <>
        <div ref={scrollContainerRef} data-testid="scroll-container" />
        <MessageFlowNavigationRail
          items={renderItems}
          scrollContainerRef={scrollContainerRef}
          messageFlowRef={messageFlowRef}
        />
      </>,
    );

    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
  });

  it('resolves the scroll target from the rendered DOM offset', () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 250, scrollTop: 100 });
    scrollContainer.getBoundingClientRect = () => createRect(50, 250);
    const anchor = document.createElement('div');
    anchor.getBoundingClientRect = () => createRect(475, 40);

    expect(getScrollTopForElement(scrollContainer, anchor)).toBe(525);

    const nonScrollable = document.createElement('div');
    defineScrollGeometry(nonScrollable, { scrollHeight: 250, clientHeight: 250, scrollTop: 0 });
    expect(getScrollTopForElement(nonScrollable, anchor)).toBe(0);
  });

  it('clamps the scroll target to the scrollable range', () => {
    const scrollContainer = document.createElement('div');
    defineScrollGeometry(scrollContainer, { scrollHeight: 1000, clientHeight: 250, scrollTop: 0 });
    scrollContainer.getBoundingClientRect = () => createRect(0, 250);
    const aboveTop = document.createElement('div');
    aboveTop.getBoundingClientRect = () => createRect(-500, 40);
    const belowBottom = document.createElement('div');
    belowBottom.getBoundingClientRect = () => createRect(5000, 40);

    expect(getScrollTopForElement(scrollContainer, aboveTop)).toBe(0);
    expect(getScrollTopForElement(scrollContainer, belowBottom)).toBe(750);
  });

  it('maps anchored render items by key and skips entries without a key', () => {
    const messageFlow = document.createElement('div');
    const keyed = document.createElement('div');
    keyed.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, 'user:u1');
    const emptyKey = document.createElement('div');
    emptyKey.setAttribute(CHAT_RENDER_ITEM_KEY_ATTRIBUTE, '');
    messageFlow.appendChild(keyed);
    messageFlow.appendChild(emptyKey);

    const elementsByKey = getRenderItemElementsByKey(messageFlow);
    expect(elementsByKey.size).toBe(1);
    expect(elementsByKey.get('user:u1')).toBe(keyed);
  });
});
