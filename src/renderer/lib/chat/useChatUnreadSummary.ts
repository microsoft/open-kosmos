import { useEffect, useMemo, useState } from 'react';

import type { ChatUnreadSummary } from '@shared/types/chatSessionTypes';

const EMPTY_CHAT_UNREAD_SUMMARY: ChatUnreadSummary = {
  chatId: '',
  userUnreadCount: 0,
  scheduledUnreadCount: 0,
  updatedAt: '',
};

function buildEmptySummary(chatId: string): ChatUnreadSummary {
  return {
    ...EMPTY_CHAT_UNREAD_SUMMARY,
    chatId,
  };
}

export function formatUnreadBadgeCount(count: number): string {
  if (count > 99) {
    return '99+';
  }

  return String(count);
}

function getSummaryUpdatedAtValue(summary: ChatUnreadSummary | undefined): number {
  if (!summary?.updatedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = new Date(summary.updatedAt).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function mergeSummaryByRecency(
  current: ChatUnreadSummary | undefined,
  incoming: ChatUnreadSummary,
): ChatUnreadSummary {
  if (!current) {
    return incoming;
  }

  return getSummaryUpdatedAtValue(incoming) >= getSummaryUpdatedAtValue(current)
    ? incoming
    : current;
}

function mergeSummaryMapByRecency(
  currentMap: Record<string, ChatUnreadSummary>,
  incomingMap: Record<string, ChatUnreadSummary>,
): Record<string, ChatUnreadSummary> {
  const mergedMap = { ...currentMap };

  Object.entries(incomingMap).forEach(([chatId, incomingSummary]) => {
    mergedMap[chatId] = mergeSummaryByRecency(currentMap[chatId], incomingSummary);
  });

  return mergedMap;
}

export function useChatUnreadSummaryMap(
  chatIds: string[],
  alias: string | null,
): Record<string, ChatUnreadSummary> {
  const chatIdsKey = useMemo(
    () => Array.from(new Set(chatIds.filter(Boolean))).sort().join('|'),
    [chatIds],
  );
  const normalizedChatIds = useMemo(
    () => (chatIdsKey ? chatIdsKey.split('|') : []),
    [chatIdsKey],
  );
  const [summaryMap, setSummaryMap] = useState<Record<string, ChatUnreadSummary>>({});

  useEffect(() => {
    if (!alias || normalizedChatIds.length === 0 || !window.electronAPI?.profile?.getChatUnreadSummary) {
      setSummaryMap({});
      return;
    }

    let cancelled = false;

    void Promise.all(
      normalizedChatIds.map(async (chatId) => {
        try {
          const result = await window.electronAPI.profile.getChatUnreadSummary(alias, chatId);
          if (result?.success && result.data) {
            return [chatId, result.data] as const;
          }
        } catch {
          // Fall back to an empty summary for this chat.
        }

        return [chatId, buildEmptySummary(chatId)] as const;
      }),
    ).then((entries) => {
      if (cancelled) {
        return;
      }

      const fetchedSummaryMap = Object.fromEntries(entries);
      setSummaryMap((prev) => mergeSummaryMapByRecency(prev, fetchedSummaryMap));
    });

    return () => {
      cancelled = true;
    };
  }, [alias, chatIdsKey, normalizedChatIds]);

  useEffect(() => {
    if (!alias || normalizedChatIds.length === 0 || !window.electronAPI?.profile?.onChatUnreadSummaryChanged) {
      return;
    }

    const visibleChatIds = new Set(normalizedChatIds);

    return window.electronAPI.profile.onChatUnreadSummaryChanged((data) => {
      if (data.alias !== alias || !visibleChatIds.has(data.summary.chatId)) {
        return;
      }

      setSummaryMap((prev) => ({
        ...prev,
        [data.summary.chatId]: mergeSummaryByRecency(prev[data.summary.chatId], data.summary),
      }));
    });
  }, [alias, chatIdsKey, normalizedChatIds]);

  return summaryMap;
}

export function useChatUnreadSummary(
  chatId: string | null,
  alias: string | null,
): ChatUnreadSummary {
  const summaryMap = useChatUnreadSummaryMap(chatId ? [chatId] : [], alias);

  if (!chatId) {
    return EMPTY_CHAT_UNREAD_SUMMARY;
  }

  return summaryMap[chatId] || buildEmptySummary(chatId);
}