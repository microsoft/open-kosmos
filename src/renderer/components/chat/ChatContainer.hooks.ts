import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Message } from '@shared/types/chatTypes';
import { type ChatStatus } from '../../lib/chat/agentChatSessionCacheManager';
import {
  getChatRenderItemStableKey,
  hasTextContent,
  isVisibleChatRenderItem,
  type ChatRenderItem,
} from './ChatRenderItem';

const FOLLOW_LATEST_THRESHOLD_PX = 40;

export function useAutoScroll(
  chatSessionId: string | null | undefined,
  messages: Message[],
  pendingInteractiveRequest: { interactionId?: string } | null | undefined,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const messageFlowRef = useRef<HTMLDivElement>(null);
  const previousChatSessionIdRef = useRef<string | null | undefined>(undefined);
  const previousMessageCountRef = useRef<number | null>(null);
  const previousPendingInteractiveRequestIdRef = useRef<string | null>(null);
  const latestScrollFrameRef = useRef<number | null>(null);
  const trailingLatestScrollFrameRef = useRef<number | null>(null);
  const latestScrollTimeoutRef = useRef<number | null>(null);
  const latestScrollStabilizeUntilRef = useRef(0);
  const userScrolledAwayRef = useRef(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const latestMessageRole = messages[messages.length - 1]?.role;

  const handleContainerScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const distanceFromLatest =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const scrolledAway = distanceFromLatest > FOLLOW_LATEST_THRESHOLD_PX;
    userScrolledAwayRef.current = scrolledAway;
    setShowJumpToLatest((prev) => (prev === scrolledAway ? prev : scrolledAway));
  }, []);

  const scrollToLatestPosition = useCallback((reason: string, options?: { force?: boolean }) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (!options?.force && userScrolledAwayRef.current) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, []);

  const openLatestScrollStabilizationWindow = useCallback(() => {
    latestScrollStabilizeUntilRef.current = Date.now() + 1500;
  }, []);

  const isWithinLatestScrollStabilizationWindow = useCallback(() => {
    return Date.now() <= latestScrollStabilizeUntilRef.current;
  }, []);

  const clearPendingLatestScroll = useCallback(() => {
    if (latestScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(latestScrollFrameRef.current);
      latestScrollFrameRef.current = null;
    }

    if (trailingLatestScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(trailingLatestScrollFrameRef.current);
      trailingLatestScrollFrameRef.current = null;
    }

    if (latestScrollTimeoutRef.current !== null) {
      window.clearTimeout(latestScrollTimeoutRef.current);
      latestScrollTimeoutRef.current = null;
    }
  }, []);

  const scheduleLatestScroll = useCallback((options?: { force?: boolean }) => {
    if (options?.force) {
      userScrolledAwayRef.current = false;
      setShowJumpToLatest(false);
    }

    openLatestScrollStabilizationWindow();
    clearPendingLatestScroll();
    scrollToLatestPosition('immediate', options);

    latestScrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollToLatestPosition('raf-1', options);
      latestScrollFrameRef.current = null;

      trailingLatestScrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollToLatestPosition('raf-2', options);
        trailingLatestScrollFrameRef.current = null;
      });
    });

    latestScrollTimeoutRef.current = window.setTimeout(() => {
      scrollToLatestPosition('timeout-180ms', options);
      latestScrollTimeoutRef.current = null;
    }, 180);
  }, [clearPendingLatestScroll, openLatestScrollStabilizationWindow, scrollToLatestPosition]);

  const handleJumpToLatestClick = useCallback(() => {
    scheduleLatestScroll({ force: true });
    setShowJumpToLatest(false);
  }, [scheduleLatestScroll]);

  useEffect(() => {
    const previousChatSessionId = previousChatSessionIdRef.current;
    const previousMessageCount = previousMessageCountRef.current;
    const currentChatSessionId = chatSessionId ?? null;
    const isFirstRender = previousMessageCount === null;
    const didChatSessionChange = currentChatSessionId !== previousChatSessionId;
    const didMessageCountIncrease = previousMessageCount !== null && messages.length > previousMessageCount;
    const shouldForceLatestScroll = isFirstRender || didChatSessionChange || latestMessageRole === 'user';

    if (messages.length > 0 && (isFirstRender || didChatSessionChange || didMessageCountIncrease)) {
      scheduleLatestScroll({ force: shouldForceLatestScroll });
    }

    previousChatSessionIdRef.current = currentChatSessionId;
    previousMessageCountRef.current = messages.length;
    return clearPendingLatestScroll;
  }, [chatSessionId, clearPendingLatestScroll, latestMessageRole, messages.length, scheduleLatestScroll]);

  useEffect(() => {
    const currentPendingInteractiveRequestId = pendingInteractiveRequest?.interactionId ?? null;
    const previousPendingInteractiveRequestId = previousPendingInteractiveRequestIdRef.current;

    if (
      currentPendingInteractiveRequestId &&
      currentPendingInteractiveRequestId !== previousPendingInteractiveRequestId
    ) {
      scheduleLatestScroll({ force: true });
    }

    previousPendingInteractiveRequestIdRef.current = currentPendingInteractiveRequestId;
  }, [pendingInteractiveRequest?.interactionId, scheduleLatestScroll]);

  const handleContentChange = useCallback((newContent: string, heightChanged: boolean) => {
    if (!heightChanged) {
      return;
    }

    scheduleLatestScroll();
  }, [scheduleLatestScroll]);

  useEffect(() => {
    const observedFlow = messageFlowRef.current;
    if (!observedFlow || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      if (!isWithinLatestScrollStabilizationWindow()) {
        return;
      }

      scrollToLatestPosition('resize-observer');
    });

    observer.observe(observedFlow);

    return () => {
      observer.disconnect();
    };
  }, [isWithinLatestScrollStabilizationWindow, scrollToLatestPosition]);

  return {
    containerRef,
    messageFlowRef,
    showJumpToLatest,
    handleContainerScroll,
    handleJumpToLatestClick,
    handleContentChange,
    isWithinLatestScrollStabilizationWindow,
    scrollToLatestPosition,
  };
}

async function hasFile(p: string) {
  try {
    if (window.electronAPI?.fs?.exists) {
      return await window.electronAPI.fs.exists(p);
    }
    return false;
  } catch {
    return false;
  }
}

export function useFileExistsCache(
  renderItems: ChatRenderItem[],
  chatId: string | undefined,
) {
  const [fileExistsCache, setFileExistsCache] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setFileExistsCache({});
  }, [chatId]);

  useEffect(() => {
    const all = new Set<string>();
    renderItems.forEach(item => {
      if (item.type === 'assistant' && item.extractedFilePaths) {
        item.extractedFilePaths.forEach(p => all.add(p));
      }
    });

    const unchecked = [...all].filter(p => !(p in fileExistsCache));
    if (unchecked.length === 0) return;

    let cancelled = false;
    let retryTimer = 0;

    (async () => {
      const results: Record<string, boolean> = {};
      const missing: string[] = [];
      await Promise.all(
        unchecked.map(async (filePath) => {
          const exists = await hasFile(filePath);
          results[filePath] = exists;
          if (!exists) missing.push(filePath);
        }),
      );
      if (cancelled) return;
      setFileExistsCache(prev => ({ ...prev, ...results }));
      if (missing.length === 0) return;
      retryTimer = window.setTimeout(async () => {
        if (cancelled || !window.electronAPI.fs) return;
        const retryResults: Record<string, boolean> = {};
        await Promise.allSettled(
          missing.map(async (filePath) => {
            retryResults[filePath] = await window.electronAPI.fs!.exists(filePath);
          }),
        );
        if (!cancelled && Object.keys(retryResults).length > 0) {
          setFileExistsCache(prev => ({ ...prev, ...retryResults }));
        }
      }, 2000);
    })();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [renderItems]);

  return fileExistsCache;
}

export function useActivitySlot(
  renderItems: ChatRenderItem[],
  streamingMessageId: string | undefined,
  allMessages: Message[],
  chatStatus: ChatStatus | undefined,
  messages: Message[],
) {
  const previousVisibleRenderItemsLengthRef = useRef(0);
  const previousLatestVisibleRenderItemKeyRef = useRef<string>('none');
  const previousHadActivitySlotRef = useRef(false);
  const forceUpdate = useReducer((x) => x + 1, 0)[1];

  const shouldShowLoading = chatStatus === 'compressed_context' || chatStatus === 'compressing_context' || chatStatus === 'sending_response';

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && shouldShowLoading) forceUpdate();
    };

    const handleFocus = () => {
      if (shouldShowLoading) forceUpdate();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [shouldShowLoading]);

  const shouldShowTopLevelLoading = useCallback(() => {
    const hasMessages = renderItems.length > 0;
    const hasUserMessage = renderItems.some(item => item.type === 'user');

    return shouldShowLoading && (!hasMessages || !hasUserMessage);
  }, [renderItems, shouldShowLoading]);

  const shouldShowBoundaryContainer = useCallback(() => {
    return shouldShowTopLevelLoading() || messages.length > 0;
  }, [shouldShowTopLevelLoading, messages.length]);

  const shouldShowLoadingAfterLastMessage = useCallback(() => {
    if (!shouldShowLoading) return false;

    if (streamingMessageId) {
      const streamingMessage = allMessages.find(msg => msg.id === streamingMessageId);
      if (streamingMessage && streamingMessage.role === 'assistant') {
        return false;
      }
    }

    return true;
  }, [shouldShowLoading, streamingMessageId, allMessages]);

  const shouldReserveActivitySlotAfterHide = useCallback(() => {
    if (!streamingMessageId) {
      return false;
    }

    const streamingMessage = allMessages.find(msg => msg.id === streamingMessageId);
    if (!streamingMessage || streamingMessage.role !== 'assistant') {
      return false;
    }

    const hasVisibleAssistantText = hasTextContent(streamingMessage);
    const hasVisibleToolCalls = (streamingMessage.tool_calls || []).some(toolCall => {
      const toolCallId = toolCall.id?.trim();
      const toolName = toolCall.function.name?.trim();
      return Boolean(toolCallId || toolName);
    });

    return !hasVisibleAssistantText && !hasVisibleToolCalls;
  }, [streamingMessageId, allMessages]);

  const visibleRenderItems = useMemo(() => {
    return renderItems.filter(isVisibleChatRenderItem);
  }, [renderItems]);

  const latestVisibleRenderItemKey = useMemo(() => {
    return getChatRenderItemStableKey(visibleRenderItems[visibleRenderItems.length - 1]);
  }, [visibleRenderItems]);

  const shouldKeepStickyActivitySlot = useMemo(() => {
    if (shouldShowTopLevelLoading() || shouldShowLoadingAfterLastMessage() || shouldReserveActivitySlotAfterHide()) {
      return false;
    }

    if (!previousHadActivitySlotRef.current) {
      return false;
    }

    return previousVisibleRenderItemsLengthRef.current === visibleRenderItems.length &&
      previousLatestVisibleRenderItemKeyRef.current === latestVisibleRenderItemKey;
  }, [latestVisibleRenderItemKey, shouldReserveActivitySlotAfterHide, shouldShowLoadingAfterLastMessage, shouldShowTopLevelLoading, visibleRenderItems.length]);

  const renderItemsWithActivity = useMemo<ChatRenderItem[]>(() => {
    if (shouldShowTopLevelLoading()) {
      return renderItems;
    }

    const activityType = shouldShowLoadingAfterLastMessage()
      ? 'activity-loading'
      : shouldReserveActivitySlotAfterHide()
        ? 'activity-placeholder'
        : shouldKeepStickyActivitySlot
          ? 'activity-placeholder'
          : null;

    if (!activityType) {
      return renderItems;
    }

    return [
      ...renderItems,
      {
        type: activityType,
        index: renderItems.length,
        sectionKey: `chat-${activityType}`,
      },
    ];
  }, [renderItems, shouldKeepStickyActivitySlot, shouldShowTopLevelLoading, shouldShowLoadingAfterLastMessage, shouldReserveActivitySlotAfterHide]);

  useEffect(() => {
    previousVisibleRenderItemsLengthRef.current = visibleRenderItems.length;
    previousLatestVisibleRenderItemKeyRef.current = latestVisibleRenderItemKey;
    previousHadActivitySlotRef.current = renderItemsWithActivity.some(
      item => item.type === 'activity-loading' || item.type === 'activity-placeholder',
    );
  }, [latestVisibleRenderItemKey, renderItemsWithActivity, visibleRenderItems.length]);

  return {
    renderItemsWithActivity,
    shouldShowTopLevelLoading,
    shouldShowBoundaryContainer,
  };
}
