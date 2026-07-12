import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageHelper } from '@shared/types/chatTypes';
import { useI18n } from '../../lib/i18n/useI18n';
import {
  getChatRenderItemStableKey,
  isVisibleChatRenderItem,
  type ChatRenderItem,
} from './ChatRenderItem';

export interface MessageFlowNavigationMarker {
  key: string;
  label: string;
  preview: string;
  timestamp: number;
}

interface MessageFlowNavigationRailProps {
  items: ChatRenderItem[];
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  messageFlowRef: React.RefObject<HTMLDivElement>;
}

const MAX_PREVIEW_LENGTH = 96;
export const CHAT_RENDER_ITEM_KEY_ATTRIBUTE = 'data-chat-render-item-key';
/** Vertical spacing (px) between adjacent markers in the centered cluster. */
export const MARKER_CLUSTER_GAP_PX = 13;
/** Fraction of the rail height the cluster may occupy before the gap is compressed. */
const MARKER_CLUSTER_FILL_RATIO = 0.84;
/**
 * Space (px) reserved at the top and bottom of the rail so the extreme markers stay clear of the
 * conditionally shown overlays that share the rail's right edge: the find bar (top, min-height
 * 44px) and the jump-to-latest button (bottom, 16px offset + 32px tall = 48px band). 52px clears
 * the taller 48px band with a small gap. This only binds on short panes; on tall rails the 84%
 * fill already leaves a wider margin.
 */
export const MARKER_CLUSTER_END_INSET_PX = 52;
/** Marker width (px) at rest and when far from the hover focus point. */
export const MARKER_MIN_WIDTH_PX = 10.5;
/** Marker width (px) at the crest of the hover wave (directly under the pointer). */
export const MARKER_MAX_WIDTH_PX = 34;
/** Gaussian spread (px) of the hover wave; larger values widen the crest. */
export const MARKER_WAVE_SIGMA_PX = 20;
/** Fraction of the viewport height used as the "reading line" for the current-turn marker. */
export const MARKER_CURRENT_READING_RATIO = 0.5;
/** Re-measure interval (ms) for the post-click scroll settle loop. */
export const MARKER_SCROLL_SETTLE_INTERVAL_MS = 80;
/** Maximum number of settle passes after a marker click before giving up. */
export const MARKER_SCROLL_SETTLE_MAX_PASSES = 14;
/** Consecutive non-growing passes that mark the settle loop as converged. */
export const MARKER_SCROLL_SETTLE_STABLE_PASSES = 3;
/** Minimum target growth (px) that triggers a re-aim during the settle loop. */
export const MARKER_SCROLL_SETTLE_THRESHOLD_PX = 2;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
interface MessageFlowNavigationLabels {
  userLabel: string;
  userMessagePreview: string;
  today: string;
  yesterday: string;
  monthLabels: readonly string[];
  formatTime?: (date: Date) => string;
}

const DEFAULT_NAVIGATION_LABELS: MessageFlowNavigationLabels = {
  userLabel: 'User',
  userMessagePreview: 'User message',
  today: 'Today',
  yesterday: 'Yesterday',
  monthLabels: MONTH_LABELS,
};
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function truncatePreview(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MAX_PREVIEW_LENGTH) {
    return singleLine;
  }

  return `${singleLine.slice(0, MAX_PREVIEW_LENGTH - 1)}...`;
}

function getUserMessagePreview(item: Extract<ChatRenderItem, { type: 'user' }>, fallback: string = DEFAULT_NAVIGATION_LABELS.userMessagePreview): string {
  const text = truncatePreview(MessageHelper.getText(item.message));
  if (text) {
    return text;
  }

  return fallback;
}

function isDisplayedUserNavigationItem(item: ChatRenderItem): item is Extract<ChatRenderItem, { type: 'user' }> {
  if (item.type !== 'user' || !isVisibleChatRenderItem(item)) {
    return false;
  }

  if ((item.message as { metadata?: { synthetic?: boolean } }).metadata?.synthetic) {
    return false;
  }

  return MessageHelper.getText(item.message).trim() !== '<task-notification-trigger/>';
}

export function buildMessageFlowNavigationMarkers(
  items: ChatRenderItem[],
  labels: Pick<MessageFlowNavigationLabels, 'userLabel' | 'userMessagePreview'> = DEFAULT_NAVIGATION_LABELS,
): MessageFlowNavigationMarker[] {
  return items.flatMap((item) => {
    if (!isDisplayedUserNavigationItem(item)) {
      return [];
    }

    return [{
      key: getChatRenderItemStableKey(item),
      label: labels.userLabel,
      preview: getUserMessagePreview(item, labels.userMessagePreview),
      timestamp: item.message.timestamp,
    }];
  });
}

function formatClockTime(date: Date, formatTime?: (date: Date) => string): string {
  if (formatTime) {
    return formatTime(date);
  }

  const minutes = date.getMinutes().toString().padStart(2, '0');
  const meridiem = date.getHours() >= 12 ? 'PM' : 'AM';
  const hours12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
  return `${hours12}:${minutes} ${meridiem}`;
}

export function formatMarkerTimestamp(
  timestamp: number,
  now: Date = new Date(),
  labels: MessageFlowNavigationLabels = DEFAULT_NAVIGATION_LABELS,
): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const time = formatClockTime(date, labels.formatTime);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / MILLISECONDS_PER_DAY);

  if (dayDiff === 0) {
    return `${labels.today}, ${time}`;
  }
  if (dayDiff === 1) {
    return `${labels.yesterday}, ${time}`;
  }

  return `${labels.monthLabels[date.getMonth()] ?? MONTH_LABELS[date.getMonth()]} ${date.getDate()}, ${time}`;
}

/**
 * Spacing between markers in the centered cluster. Markers keep a fixed gap until the
 * cluster would overflow the rail, at which point the gap is compressed to fit. The usable
 * height is capped to MARKER_CLUSTER_FILL_RATIO of the rail and additionally inset by
 * MARKER_CLUSTER_END_INSET_PX at each end so the extreme markers stay clear of the find bar
 * (top) and the jump-to-latest button (bottom). Rails too short to honor both insets fall back
 * to the plain fill so the markers do not collapse onto each other.
 */
export function getMarkerClusterGap(markerCount: number, railHeight: number): number {
  if (markerCount <= 1) {
    return 0;
  }

  if (railHeight <= 0) {
    return MARKER_CLUSTER_GAP_PX;
  }

  const fillHeight = railHeight * MARKER_CLUSTER_FILL_RATIO;
  const insetHeight = railHeight - 2 * MARKER_CLUSTER_END_INSET_PX;
  const availableHeight = insetHeight > 0 ? Math.min(fillHeight, insetHeight) : fillHeight;
  return Math.min(MARKER_CLUSTER_GAP_PX, availableHeight / (markerCount - 1));
}

/** Vertical offset (px) of a marker from the rail's vertical center for the centered cluster. */
export function getMarkerClusterOffset(index: number, markerCount: number, gap: number): number {
  return (index - (markerCount - 1) / 2) * gap;
}

/**
 * Width (px) of a marker for the hover "sound wave" effect. The marker nearest the focus
 * point (`focusOffset`, measured from the cluster center) reaches `MARKER_MAX_WIDTH_PX` and
 * neighbours taper off with a Gaussian falloff, so the crest follows the pointer. When there
 * is no focus point the marker rests at `MARKER_MIN_WIDTH_PX`.
 */
export function getMarkerWaveWidth(markerOffset: number, focusOffset: number | null): number {
  if (focusOffset === null) {
    return MARKER_MIN_WIDTH_PX;
  }

  const distance = Math.abs(focusOffset - markerOffset);
  const falloff = Math.exp(-((distance / MARKER_WAVE_SIGMA_PX) ** 2));
  return MARKER_MIN_WIDTH_PX + (MARKER_MAX_WIDTH_PX - MARKER_MIN_WIDTH_PX) * falloff;
}

/**
 * Key of the marker for the turn "currently in view". Given each marker's element top
 * (viewport coordinates) and a reading line, the current turn is the user message whose
 * element sits closest to but still above the reading line. When every message is below the
 * line (e.g. scrolled to the very top), the topmost message is used as a fallback.
 */
export function getCurrentMarkerKey(
  markers: MessageFlowNavigationMarker[],
  elementTops: Map<string, number>,
  readingLine: number,
): string | null {
  let activeKey: string | null = null;
  let activeTop = -Infinity;
  let topmostKey: string | null = null;
  let topmostTop = Infinity;

  for (const marker of markers) {
    const top = elementTops.get(marker.key);
    if (top === undefined) {
      continue;
    }

    if (top <= readingLine && top > activeTop) {
      activeTop = top;
      activeKey = marker.key;
    }
    if (top < topmostTop) {
      topmostTop = top;
      topmostKey = marker.key;
    }
  }

  return activeKey ?? topmostKey;
}

export function getScrollTopForElement(container: HTMLElement, element: HTMLElement): number {
  const scrollableHeight = Math.max(container.scrollHeight - container.clientHeight, 0);
  if (scrollableHeight === 0) {
    return 0;
  }

  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const elementTop = container.scrollTop + elementRect.top - containerRect.top;
  return clamp(elementTop, 0, scrollableHeight);
}

export function getRenderItemElementsByKey(messageFlow: HTMLElement): Map<string, HTMLElement> {
  return Array.from(messageFlow.querySelectorAll<HTMLElement>(`[${CHAT_RENDER_ITEM_KEY_ATTRIBUTE}]`))
    .reduce((elementsByKey, element) => {
      const key = element.dataset.chatRenderItemKey;
      if (key) {
        elementsByKey.set(key, element);
      }
      return elementsByKey;
    }, new Map<string, HTMLElement>());
}

const MessageFlowNavigationRail: React.FC<MessageFlowNavigationRailProps> = ({
  items,
  scrollContainerRef,
  messageFlowRef,
}) => {
  const { t, language } = useI18n();
  const railRef = useRef<HTMLDivElement>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const navigationLabels = useMemo<MessageFlowNavigationLabels>(() => ({
    userLabel: t('chat.navigation.userLabel'),
    userMessagePreview: t('chat.navigation.userMessagePreview'),
    today: t('chat.navigation.today'),
    yesterday: t('chat.navigation.yesterday'),
    monthLabels: [
      t('chat.navigation.month.jan'),
      t('chat.navigation.month.feb'),
      t('chat.navigation.month.mar'),
      t('chat.navigation.month.apr'),
      t('chat.navigation.month.may'),
      t('chat.navigation.month.jun'),
      t('chat.navigation.month.jul'),
      t('chat.navigation.month.aug'),
      t('chat.navigation.month.sep'),
      t('chat.navigation.month.oct'),
      t('chat.navigation.month.nov'),
      t('chat.navigation.month.dec'),
    ],
    formatTime: (date) => new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date),
  }), [language, t]);
  const markers = useMemo(() => buildMessageFlowNavigationMarkers(items, navigationLabels), [items, navigationLabels]);
  // Stable identity of the marker set, used to abort an in-flight settle loop when the set
  // actually changes. Streaming re-creates the `items`/`markers` arrays on every tick without
  // changing the user-message keys, so signing the keys avoids cancelling a legitimate loop
  // on each streamed token while still reacting to a session switch or an added/removed message.
  const markerKeySignature = useMemo(() => markers.map((marker) => marker.key).join('\u0000'), [markers]);
  // Latest markers, read by the scroll listener without forcing the effect to re-subscribe on
  // every streamed token (which would re-run an O(marker) getBoundingClientRect scan per tick).
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [pointerOffset, setPointerOffset] = useState<number | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [railHeight, setRailHeight] = useState(0);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) {
      return;
    }

    const measureRail = () => {
      setRailHeight(rail.getBoundingClientRect().height);
    };

    measureRail();
    const timeoutId = window.setTimeout(measureRail, 0);
    const trailingTimeoutId = window.setTimeout(measureRail, 120);
    window.addEventListener('resize', measureRail);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(trailingTimeoutId);
      window.removeEventListener('resize', measureRail);
    };
  }, [markers.length]);

  // Track which user message is currently in view so its marker reads as the active turn. The
  // effect re-subscribes only when the marker set changes (via markerKeySignature), not on every
  // streamed token, and reads the live markers through markersRef so the listener stays current.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const messageFlow = messageFlowRef.current;
    if (!container || !messageFlow || markersRef.current.length === 0) {
      return;
    }

    const updateCurrentKey = () => {
      const elementTops = new Map<string, number>();
      getRenderItemElementsByKey(messageFlow).forEach((element, key) => {
        elementTops.set(key, element.getBoundingClientRect().top);
      });
      const containerTop = container.getBoundingClientRect().top;
      const readingLine = containerTop + container.clientHeight * MARKER_CURRENT_READING_RATIO;
      const nextKey = getCurrentMarkerKey(markersRef.current, elementTops, readingLine);
      setCurrentKey((previous) => (previous === nextKey ? previous : nextKey));
    };

    updateCurrentKey();
    container.addEventListener('scroll', updateCurrentKey, { passive: true });

    return () => {
      container.removeEventListener('scroll', updateCurrentKey);
    };
  }, [markerKeySignature, scrollContainerRef, messageFlowRef]);

  const cancelScrollSettle = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Cancel any in-flight settle loop when the rail unmounts or the marker set changes (e.g. a
  // session switch), so a stale loop can never re-aim using a marker key that now resolves to a
  // different message in the freshly rendered list.
  useEffect(() => cancelScrollSettle, [cancelScrollSettle, markerKeySignature]);

  const scrollToMarker = useCallback((marker: MessageFlowNavigationMarker) => {
    const container = scrollContainerRef.current;
    const messageFlow = messageFlowRef.current;
    if (!container || !messageFlow) {
      return;
    }

    const measureTarget = (): number | null => {
      const element = getRenderItemElementsByKey(messageFlow).get(marker.key);
      return element ? getScrollTopForElement(container, element) : null;
    };

    const initialTarget = measureTarget();
    if (initialTarget === null) {
      return;
    }

    cancelScrollSettle();
    container.scrollTo({ top: initialTarget, behavior: 'smooth' });

    // Markers exist for every user message, but off-screen ones are still LazyRenderItem
    // placeholders (a fixed 48px). getScrollTopForElement therefore undercounts the real
    // height of the messages above the target, so the first hop lands short on long chats.
    // Because placeholders only ever shrink the measured offset, the true target is
    // monotonically non-decreasing as intervening items render and latch to full height
    // while we scroll toward it. Re-measuring across a few frames and re-aiming whenever the
    // target grows therefore converges on the correct position without ever overshooting.
    // We keep polling across a short window rather than stopping at the first non-growing pass,
    // because lazy items render asynchronously as the smooth scroll progresses; a single
    // no-growth pass is not proof of convergence. The loop ends once the target has held steady
    // for MARKER_SCROLL_SETTLE_STABLE_PASSES consecutive passes, the element disappears, or the
    // pass cap is reached.
    let lastTarget = initialTarget;
    let passes = 0;
    let stablePasses = 0;
    const settle = () => {
      settleTimerRef.current = null;
      passes += 1;
      const nextTarget = measureTarget();
      if (nextTarget === null) {
        return;
      }
      if (nextTarget - lastTarget > MARKER_SCROLL_SETTLE_THRESHOLD_PX) {
        lastTarget = nextTarget;
        stablePasses = 0;
        container.scrollTo({ top: nextTarget, behavior: 'smooth' });
      } else {
        stablePasses += 1;
      }
      if (stablePasses >= MARKER_SCROLL_SETTLE_STABLE_PASSES) {
        return;
      }
      if (passes < MARKER_SCROLL_SETTLE_MAX_PASSES) {
        settleTimerRef.current = window.setTimeout(settle, MARKER_SCROLL_SETTLE_INTERVAL_MS);
      }
    };
    settleTimerRef.current = window.setTimeout(settle, MARKER_SCROLL_SETTLE_INTERVAL_MS);
  }, [scrollContainerRef, messageFlowRef, cancelScrollSettle]);

  const handleClusterPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const cluster = clusterRef.current;
    if (!cluster) {
      return;
    }

    const rect = cluster.getBoundingClientRect();
    setPointerOffset((event.clientY - rect.top) - rect.height / 2);
  }, []);

  const handleClusterPointerLeave = useCallback(() => {
    setPointerOffset(null);
    // Dismiss the hover card here rather than on each marker's mouseleave so the pointer can
    // travel from a marker onto the card (a cluster descendant) without it vanishing first.
    // pointerleave on the cluster fires only when the pointer leaves the cluster AND every
    // descendant (markers + card + the card's bridge), which is exactly when the card should hide.
    setHoveredKey(null);
  }, []);

  if (markers.length === 0) {
    return null;
  }

  const clusterGap = getMarkerClusterGap(markers.length, railHeight);
  const hoveredIndex = markers.findIndex((marker) => marker.key === hoveredKey);
  const hoveredMarker = hoveredIndex >= 0 ? markers[hoveredIndex] : undefined;
  const hoveredTimestamp = hoveredMarker ? formatMarkerTimestamp(hoveredMarker.timestamp, new Date(), navigationLabels) : '';
  // The wave crest follows the pointer; keyboard focus (no pointer) crests on the focused marker.
  const waveOffset = pointerOffset !== null
    ? pointerOffset
    : (hoveredIndex >= 0 ? getMarkerClusterOffset(hoveredIndex, markers.length, clusterGap) : null);

  return (
    <div ref={railRef} className="chat-message-navigation-rail" aria-label={t('chat.navigation.messageFlow')}>
      <div
        ref={clusterRef}
        className="chat-message-navigation-cluster"
        onPointerMove={handleClusterPointerMove}
        onPointerLeave={handleClusterPointerLeave}
      >
        {markers.map((marker, index) => {
          const markerOffset = getMarkerClusterOffset(index, markers.length, clusterGap);
          return (
            <button
              key={marker.key}
              type="button"
              className={`chat-message-navigation-marker user${marker.key === hoveredKey || marker.key === currentKey ? ' is-active' : ''}`}
              style={{
                marginTop: `${markerOffset}px`,
                width: `${getMarkerWaveWidth(markerOffset, waveOffset)}px`,
              }}
              aria-label={t('chat.navigation.jumpTo', { label: marker.label, preview: marker.preview })}
              title={`${marker.label}: ${marker.preview}`}
              onClick={() => scrollToMarker(marker)}
              onMouseEnter={() => setHoveredKey(marker.key)}
              onFocus={() => setHoveredKey(marker.key)}
              onBlur={() => setHoveredKey(null)}
            />
          );
        })}
        {hoveredMarker && (
          // Pointer-only convenience that mirrors the hovered marker's click: users instinctively
          // click the preview card rather than the thin marker. The marker <button> above stays
          // the keyboard / screen-reader control (hence no role here, so it never collides with the
          // marker in the accessibility tree). onMouseDown preventDefault keeps the marker's focus
          // so the card cannot unmount from a focus-driven blur before the click lands.
          <div
            className="chat-message-navigation-tooltip"
            style={{ marginTop: `${getMarkerClusterOffset(hoveredIndex, markers.length, clusterGap)}px` }}
            onClick={() => scrollToMarker(hoveredMarker)}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="chat-message-navigation-tooltip-preview">{hoveredMarker.preview}</div>
            {hoveredTimestamp && (
              <div className="chat-message-navigation-tooltip-time">{hoveredTimestamp}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageFlowNavigationRail;
