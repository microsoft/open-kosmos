import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MoreHorizontal, Globe, Search, Star, X } from 'lucide-react';
import { ChatConfigRuntime, ChatSession, StarredChatSessionIndexItem } from '../../../lib/userData/types';
import type { ChatUnreadSummary } from '@shared/types/chatSessionTypes';
import NavItem from '../../ui/navigation/NavItem';
import { AgentAvatar } from '../../common/AgentAvatar';
import { isBuiltinAgent } from '../../../lib/userData/types';
import { BRAND_NAME } from '@shared/constants/branding';
import { useProfileData } from '../../userData/userDataProvider';
import { useChatUnreadSummaryMap } from '../../../lib/chat/useChatUnreadSummary';
import { AgentMenuAtom } from '../../menu/AgentDropdownMenu';
import { ChatSessionMenuAtom } from '../../menu/ChatSessionDropdownMenu';
import '../../../styles/DropdownMenu.css';
import { createLogger } from '../../../lib/utilities/logger';
const logger = createLogger('[AgentList]');

const PAGE_SIZE = 100;
const SCROLL_THRESHOLD_PX = 80;
interface PaginatedChatSessionsState {
  sessions: ChatSession[];
  hasLoaded: boolean;
  hasMore: boolean;
  nextMonthIndex: number;
  isLoading: boolean;
  error: string | null;
}

interface SearchResultItem {
  chatId: string;
  sessionId: string;
  title: string;
  agentName: string;
  agentEmoji?: string;
  agentAvatar?: string;
  agentSource?: 'ON-DEVICE' | 'EXTERNAL';
  agentVersion?: string;
  lastUpdated: string;
  readStatus?: ChatSession['readStatus'];
  source?: ChatSession['source'];
}

interface SearchAgentOption {
  chatId: string;
  agentName: string;
  agentEmoji?: string;
  agentAvatar?: string;
  agentSource?: 'ON-DEVICE' | 'EXTERNAL';
  agentVersion?: string;
}

const SEARCH_PAGE_SIZE = 100;

const isScheduledSession = (
  session: Partial<ChatSession> | null | undefined,
): boolean => {
  return !!session?.schedulerJobId && session.schedulerJobId.trim().length > 0;
};

const sortSessionsByTimeDesc = (sessions: ChatSession[]): ChatSession[] => {
  return [...sessions].sort(
    (a, b) =>
      new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime(),
  );
};

const getNonScheduledSessions = (sessions: ChatSession[] | null | undefined): ChatSession[] => {
  return (sessions || []).filter((session) => !isScheduledSession(session));
};

const mergeSessions = (
  current: ChatSession[],
  incoming: ChatSession[],
): ChatSession[] => {
  const merged = new Map<string, ChatSession>();

  current.forEach((session) => {
    merged.set(session.chatSession_id, session);
  });

  incoming.forEach((session) => {
    const existing = merged.get(session.chatSession_id);
    merged.set(session.chatSession_id, {
      ...existing,
      ...session,
    });
  });

  return sortSessionsByTimeDesc(Array.from(merged.values()));
};

const getDefaultPaginatedState = (): PaginatedChatSessionsState => ({
  sessions: [],
  hasLoaded: false,
  hasMore: true,
  nextMonthIndex: 0,
  isLoading: false,
  error: null,
});

const getSessionItemRefKey = (chatId: string, sessionId: string): string => {
  return `${chatId}:${sessionId}`;
};

const getUnreadCount = (summary: Pick<ChatUnreadSummary, 'userUnreadCount' | 'scheduledUnreadCount'>): number => {
  return summary.userUnreadCount + summary.scheduledUnreadCount;
};

const getSummaryUpdatedAtValue = (summary: Pick<ChatUnreadSummary, 'updatedAt'> | undefined): number => {
  if (!summary?.updatedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = new Date(summary.updatedAt).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
};

const mergeUnreadSummaryByRecency = (
  current: ChatUnreadSummary | undefined,
  incoming: ChatUnreadSummary,
): ChatUnreadSummary => {
  if (!current) {
    return incoming;
  }

  return getSummaryUpdatedAtValue(incoming) >= getSummaryUpdatedAtValue(current)
    ? incoming
    : current;
};

// 🔥 Added: Start New Conversation icon component
const StartNewConversationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10.5 4.00002C10.7761 4.00002 11 4.22388 11 4.50002C10.9999 4.77612 10.7761 5.00002 10.5 5.00002L6 5.00002C4.89543 5.00002 4 5.89544 4 7.00001L4 14C4.00004 15.1045 4.89545 16 6 16L13 16C14.1045 16 14.9999 15.1045 15 14V9.5C15 9.22386 15.2238 9 15.5 9C15.7761 9 16 9.22386 16 9.5V14C15.9999 15.6568 14.6568 17 13 17H6C4.34317 17 3.00004 15.6568 3 14L3 7.00001C3 5.34316 4.34314 4.00002 6 4.00002L10.5 4.00002ZM16.1465 3.14651C16.3417 2.95125 16.6582 2.95125 16.8535 3.14651C17.0487 3.34177 17.0487 3.6583 16.8535 3.85353L9.06054 11.6455L7.99999 12L8.35351 10.9395L16.1465 3.14651Z" fill="#242424"/>
  </svg>
);

// 🔥 Added: Loading icon component
const LoadingIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      animation: 'spin 1s linear infinite'
    }}
  >
    <g clipPath="url(#clip0_390_2677)">
      <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2"/>
      <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="#272320" strokeWidth="2" strokeLinecap="round"/>
    </g>
    <defs>
      <clipPath id="clip0_390_2677">
        <rect width="20" height="20" fill="white"/>
      </clipPath>
    </defs>
  </svg>
);

interface AgentListProps {
  chats?: ChatConfigRuntime[];
  searchSourceChats?: ChatConfigRuntime[];
  primaryAgent?: string; // 🔥 Added: primary agent name, used for priority display
  excludeBuiltinAgents?: boolean; // 🔥 Modified: whether to exclude built-in agents (used for the main list)
  showSearch?: boolean;
  currentChatId?: string | null;
  onSelectChat?: (chatId: string) => void;
  activeView?: 'chat' | 'mcp' | 'skills' | 'memory' | 'settings-page' | 'settings'; // 🔥 Added: currently active view (including agent settings page)
  currentChatSessionId?: string | null; // 🔥 Added: currently selected ChatSession ID
  onSelectChatSession?: (chatId: string, sessionId: string) => void; // 🔥 Added: callback for selecting a ChatSession
  onDeleteChatSession?: (chatId: string, sessionId: string) => void; // 🔥 Added: callback for deleting a ChatSession
  onForkChatSession?: (chatId: string, sessionId: string) => void; // 🔥 Added: callback for forking a ChatSession
  onSearchActiveChange?: (active: boolean) => void;
}

const rankSearchResult = (query: string, item: SearchResultItem): number => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const normalizedTitle = item.title.toLowerCase();
  const normalizedAgent = item.agentName.toLowerCase();
  let score = 0;

  if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 1000;
  } else if (normalizedTitle.includes(normalizedQuery)) {
    score += 700;
  }

  const titleTokens = normalizedTitle.split(/\s+/).filter(Boolean);
  if (titleTokens.some((token) => token.startsWith(normalizedQuery))) {
    score += 250;
  }

  if (normalizedAgent.startsWith(normalizedQuery)) {
    score += 220;
  } else if (normalizedAgent.includes(normalizedQuery)) {
    score += 120;
  }

  if (item.readStatus === 'unread') {
    score += 15;
  }

  score += Math.floor(new Date(item.lastUpdated).getTime() / 100000000);

  return score;
};

const getRelativeTimeLabel = (dateString: string): string => {
  const date = new Date(dateString);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) {
    return 'Just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString();
};

const renderHighlightedTitle = (title: string, query: string): React.ReactNode => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return title;
  }

  const lowerTitle = title.toLowerCase();
  const lowerQuery = normalizedQuery.toLowerCase();
  const matchIndex = lowerTitle.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return title;
  }

  const before = title.slice(0, matchIndex);
  const matched = title.slice(matchIndex, matchIndex + normalizedQuery.length);
  const after = title.slice(matchIndex + normalizedQuery.length);

  return (
    <>
      {before}
      <span style={{ backgroundColor: '#F9E7A8', borderRadius: '4px', padding: '0 2px' }}>
        {matched}
      </span>
      {after}
    </>
  );
};

const getMentionDraft = (value: string): string | null => {
  const plainMatch = value.match(/(?:^|\s)@([^\s]*)$/);
  return plainMatch ? plainMatch[1] : null;
};

const AgentList: React.FC<AgentListProps> = ({
  chats = [],
  searchSourceChats,
            primaryAgent, // 🔥 Fix: no default value set, allowing undefined
  excludeBuiltinAgents = true, // 🔥 Modified: default excludes built-in agents (used in main list)
  showSearch = false,
  currentChatId,
  onSelectChat,
  activeView = 'chat', // 🔥 Default value is 'chat'
  currentChatSessionId,
  onSelectChatSession,
  onDeleteChatSession,
  onForkChatSession,
  onSearchActiveChange,
}) => {
  const [{ isOpen: agentMenuIsOpen, chatId: agentMenuChatId }, agentMenuActions] = AgentMenuAtom.use();
  const [
    { isOpen: chatSessionMenuIsOpen, sessionId: chatSessionMenuSessionId },
    chatSessionMenuActions,
  ] = ChatSessionMenuAtom.use();
  const openMenuChatId = agentMenuIsOpen ? agentMenuChatId : null;
  const openMenuChatSessionId = chatSessionMenuIsOpen ? chatSessionMenuSessionId : null;
  // Get profile data to obtain the alias field (used for loading more ChatSessions)
  const { data } = useProfileData();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<SearchAgentOption | null>(null);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [searchSessionCache, setSearchSessionCache] = useState<Map<string, ChatSession[]>>(new Map());
  const [searchLoadingChatIds, setSearchLoadingChatIds] = useState<Set<string>>(new Set());
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const mentionPickerRef = useRef<HTMLDivElement | null>(null);
  const mentionOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const blurHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🔥 Added: expanded Agent ID
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);

  // 🔥 Added: track the status of each ChatSession
  const [chatSessionStatuses, setChatSessionStatuses] = useState<Map<string, string>>(new Map());

  // 🔥 Paginated loading: each chat maintains locally loaded non-scheduled sessions
  const [paginatedChatSessions, setPaginatedChatSessions] = useState<Map<string, PaginatedChatSessionsState>>(new Map());

  // 🔥 Added: state for temporarily showing "all loaded" hint (chatId -> whether to show)
  const [showAllLoadedHint, setShowAllLoadedHint] = useState<Map<string, boolean>>(new Map());

  // 🔥 Custom overlay scrollbar state
  const [scrollbarState, setScrollbarState] = useState<Map<string, {
    thumbHeight: number;
    thumbTop: number;
    visible: boolean;
    hovered: boolean;
  }>>(new Map());
  const scrollbarHideTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [pendingSessionScrollTarget, setPendingSessionScrollTarget] = useState<{
    chatId: string;
    sessionId: string;
  } | null>(null);
  const [unreadHighlightChatIds, setUnreadHighlightChatIds] = useState<Set<string>>(new Set());
  const latestUnreadSummariesRef = useRef<Map<string, ChatUnreadSummary>>(new Map());
  const unreadSummaryMap = useChatUnreadSummaryMap(
    chats.map((chat) => chat.chat_id),
    data?.profile?.alias || null,
  );

  // Calculate scrollbar position
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

  // 🔥 Critical fix: ensure that when an Agent is selected the ChatSession sub-menu is always expanded (chat view only)
  useEffect(() => {
    if (currentChatId && activeView === 'chat') {
      // When an Agent is selected and in chat view, auto-expand its ChatSession list
      setExpandedAgentId(currentChatId);
    } else if (activeView !== 'chat' && activeView !== 'settings') {
      // When switching to other views (not chat or settings), collapse all ChatSession lists
      setExpandedAgentId(null);
    } else if (activeView === 'settings') {
      // 🔥 In settings view, collapse the ChatSession list but keep the Agent selected
      setExpandedAgentId(null);
    }
  }, [currentChatId, activeView]);

  // 🔥 Extra guard: on init if an Agent is already selected and in chat view, ensure it is expanded
  useEffect(() => {
    if (currentChatId && activeView === 'chat' && !expandedAgentId) {
      setExpandedAgentId(currentChatId);
    }
  }, [currentChatId, activeView, expandedAgentId]);

  useEffect(() => {
    const nextUnreadSummaries = new Map<string, ChatUnreadSummary>();

    chats.forEach((chat) => {
      const unreadSummary = unreadSummaryMap[chat.chat_id];
      if (unreadSummary) {
        nextUnreadSummaries.set(chat.chat_id, unreadSummary);
      }
    });

    latestUnreadSummariesRef.current = nextUnreadSummaries;

    setUnreadHighlightChatIds((prev) => {
      const next = new Set(prev);
      next.forEach((chatId) => {
        const summary = nextUnreadSummaries.get(chatId);
        if (!summary || expandedAgentId === chatId || getUnreadCount(summary) <= 0) {
          next.delete(chatId);
        }
      });
      return next;
    });
  }, [chats, expandedAgentId, unreadSummaryMap]);

  useEffect(() => {
    const profileAlias = data?.profile?.alias;

    if (!profileAlias || !window.electronAPI?.profile?.onChatUnreadSummaryChanged) {
      return;
    }

    const visibleChatIds = new Set(chats.map((chat) => chat.chat_id));

    return window.electronAPI.profile.onChatUnreadSummaryChanged((payload) => {
      if (payload.alias !== profileAlias || !visibleChatIds.has(payload.summary.chatId)) {
        return;
      }

      const currentSummary = latestUnreadSummariesRef.current.get(payload.summary.chatId);
      const mergedSummary = mergeUnreadSummaryByRecency(currentSummary, payload.summary);

      if (mergedSummary !== payload.summary) {
        return;
      }

      const previousUnreadCount = currentSummary ? getUnreadCount(currentSummary) : undefined;
      const nextUnreadCount = getUnreadCount(payload.summary);
      latestUnreadSummariesRef.current.set(payload.summary.chatId, payload.summary);

      if (expandedAgentId === payload.summary.chatId || nextUnreadCount <= 0 || (previousUnreadCount !== undefined && nextUnreadCount <= previousUnreadCount)) {
        setUnreadHighlightChatIds((prev) => {
          if (!prev.has(payload.summary.chatId)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(payload.summary.chatId);
          return next;
        });
        return;
      }

      if (previousUnreadCount !== undefined && nextUnreadCount > previousUnreadCount) {
        setUnreadHighlightChatIds((prev) => {
          if (prev.has(payload.summary.chatId)) {
            return prev;
          }
          const next = new Set(prev);
          next.add(payload.summary.chatId);
          return next;
        });
      }
    });
  }, [chats, data?.profile?.alias, expandedAgentId]);

  // 🔥 Added: listen for chat status change events
  useEffect(() => {
    const handleChatStatusChanged = (data: {chatId: string; chatSessionId: string; chatStatus: string; agentName?: string; timestamp?: string}) => {
      const { chatId, chatSessionId, chatStatus } = data;

      // 🔥 Fix: use chatSessionId directly without filtering, so all ChatSession status changes are recorded
      // This ensures background ChatSession status changes are also updated
      if (chatSessionId && chatStatus) {
        logger.debug('[AgentList] onChatStatusChanged', {
          chatId,
          chatSessionId,
          chatStatus,
          currentChatId,
          currentChatSessionId,
        });
        setChatSessionStatuses(prev => {
          const newMap = new Map(prev);
          newMap.set(chatSessionId, chatStatus);
          return newMap;
        });
      }
    };

    // Listen for chat status change events from the main process
    if (window.electronAPI?.agentChat?.onChatStatusChanged) {
      const cleanup = window.electronAPI.agentChat.onChatStatusChanged(handleChatStatusChanged);

      return () => {
        if (cleanup) cleanup();
      };
    }
  }, [currentChatId, currentChatSessionId]);

  const handleMenuToggle = (chatId: string, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    agentMenuActions.toggle(chatId, event.currentTarget);
  };

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearchMode = showSearch && (normalizedSearchQuery.length > 0 || !!selectedAgentFilter);

  const allSearchableChats = React.useMemo(() => {
    return searchSourceChats || chats;
  }, [searchSourceChats, chats]);

  const mentionDraft = React.useMemo(() => getMentionDraft(searchQuery), [searchQuery]);

  const searchAgentOptions = React.useMemo(() => {
    const deduped = new Map<string, SearchAgentOption>();

    allSearchableChats.forEach((chat) => {
      const agentName = chat.agent?.name || 'Unnamed Agent';
      if (!deduped.has(agentName)) {
        deduped.set(agentName, {
          chatId: chat.chat_id,
          agentName,
          agentEmoji: chat.agent?.emoji,
          agentAvatar: chat.agent?.avatar,
          agentSource: chat.agent?.source,
          agentVersion: chat.agent?.version,
        });
      }
    });

    return Array.from(deduped.values()).sort((a, b) => a.agentName.localeCompare(b.agentName));
  }, [allSearchableChats]);

  const mentionSuggestions = React.useMemo(() => {
    if (mentionDraft === null) {
      return [];
    }

    const normalizedDraft = mentionDraft.trim().toLowerCase();
    return searchAgentOptions
      .filter((option) => !selectedAgentFilter || option.agentName !== selectedAgentFilter.agentName)
      .filter((option) => normalizedDraft.length === 0 || option.agentName.toLowerCase().includes(normalizedDraft))
  }, [mentionDraft, searchAgentOptions, selectedAgentFilter]);

  const isMentionPickerOpen = mentionSuggestions.length > 0 && mentionDraft !== null;
  const showAgentSearchHint = showSearch
    && isSearchFocused
    && !isMentionPickerOpen
    && !selectedAgentFilter
    && searchQuery.trim().length === 0;

  const getSearchableSessionsForChat = useCallback((chat: ChatConfigRuntime): ChatSession[] => {
    const cachedSessions = searchSessionCache.get(chat.chat_id);
    if (cachedSessions && cachedSessions.length > 0) {
      return getNonScheduledSessions(cachedSessions);
    }

    const paginatedSessions = paginatedChatSessions.get(chat.chat_id)?.sessions;
    if (paginatedSessions && paginatedSessions.length > 0) {
      return getNonScheduledSessions(paginatedSessions);
    }

    return getNonScheduledSessions(chat.chatSessions || []);
  }, [paginatedChatSessions, searchSessionCache]);

  useEffect(() => {
    if (!isSearchMode || !data?.profile?.alias || !window.electronAPI?.profile) {
      return;
    }

    const targetChats = allSearchableChats.filter((chat) => {
      if (selectedAgentFilter && chat.chat_id !== selectedAgentFilter.chatId && chat.agent?.name !== selectedAgentFilter.agentName) {
        return false;
      }

      const alreadyCached = searchSessionCache.has(chat.chat_id);
      const hasInlineSessions = getNonScheduledSessions(chat.chatSessions || []).length > 0;
      return !alreadyCached && !hasInlineSessions;
    });

    if (targetChats.length === 0) {
      return;
    }

    let cancelled = false;

    const loadSearchSessions = async (chat: ChatConfigRuntime) => {
      const alias = data.profile?.alias || '';
      const chatId = chat.chat_id;

      setSearchLoadingChatIds((prev) => {
        const next = new Set(prev);
        next.add(chatId);
        return next;
      });

      try {
        const initialResult = await window.electronAPI.profile.getChatSessions(alias, chatId, SEARCH_PAGE_SIZE);
        if (!initialResult?.success || !initialResult.data) {
          throw new Error(initialResult?.error || 'Failed to load sessions for search');
        }

        let collected = initialResult.data.sessions || [];
        let currentNextMonthIndex = initialResult.data.nextMonthIndex || 0;
        let currentHasMore = Boolean(initialResult.data.hasMore);

        while (currentHasMore) {
          const moreResult = await window.electronAPI.profile.getMoreChatSessions(alias, chatId, currentNextMonthIndex);
          if (!moreResult?.success || !moreResult.data) {
            throw new Error(moreResult?.error || 'Failed to load more sessions for search');
          }

          collected = collected.concat(moreResult.data.sessions || []);
          currentNextMonthIndex = moreResult.data.nextMonthIndex || 0;
          currentHasMore = Boolean(moreResult.data.hasMore);
        }

        if (cancelled) {
          return;
        }

        setSearchSessionCache((prev) => {
          const next = new Map(prev);
          next.set(chatId, sortSessionsByTimeDesc(collected));
          return next;
        });
      } catch (error) {
        logger.error('[AgentList] Failed to build search session cache', {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!cancelled) {
          setSearchLoadingChatIds((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
        }
      }
    };

    void Promise.all(targetChats.map((chat) => loadSearchSessions(chat)));

    return () => {
      cancelled = true;
    };
  }, [allSearchableChats, data?.profile?.alias, isSearchMode, searchSessionCache, selectedAgentFilter]);

  const searchResults = React.useMemo(() => {
    if (!isSearchMode) {
      return [];
    }

    const flattened = allSearchableChats.flatMap((chat) => {
      const agentName = chat.agent?.name || 'Unnamed Agent';
      if (selectedAgentFilter && agentName !== selectedAgentFilter.agentName) {
        return [];
      }

      return getSearchableSessionsForChat(chat)
        .map((session) => ({
          chatId: chat.chat_id,
          sessionId: session.chatSession_id,
          title: session.title,
          agentName,
          agentEmoji: chat.agent?.emoji,
          agentAvatar: chat.agent?.avatar,
          agentSource: chat.agent?.source,
          agentVersion: chat.agent?.version,
          lastUpdated: session.last_updated,
          readStatus: session.readStatus,
          source: session.source,
        } satisfies SearchResultItem));
    });

    return flattened
      .filter((item) => {
        if (!normalizedSearchQuery) {
          return true;
        }
        const lowerTitle = item.title.toLowerCase();
        const lowerAgent = item.agentName.toLowerCase();
        return lowerTitle.includes(normalizedSearchQuery) || lowerAgent.includes(normalizedSearchQuery);
      })
      .filter((item, index, array) => array.findIndex((candidate) => candidate.sessionId === item.sessionId) === index)
      .sort((a, b) => rankSearchResult(normalizedSearchQuery, b) - rankSearchResult(normalizedSearchQuery, a))
      .slice(0, 50);
  }, [allSearchableChats, getSearchableSessionsForChat, isSearchMode, normalizedSearchQuery, selectedAgentFilter]);

  useEffect(() => {
    onSearchActiveChange?.(isSearchMode);
  }, [isSearchMode, onSearchActiveChange]);

  useEffect(() => {
    setActiveSearchIndex(0);
  }, [normalizedSearchQuery, selectedAgentFilter]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionDraft]);

  useEffect(() => {
    if (!isMentionPickerOpen) {
      mentionOptionRefs.current = [];
      return;
    }

    const activeOption = mentionOptionRefs.current[activeMentionIndex];
    if (!activeOption) {
      return;
    }

    requestAnimationFrame(() => {
      activeOption.scrollIntoView({ block: 'nearest' });
    });
  }, [activeMentionIndex, isMentionPickerOpen, mentionSuggestions.length]);

  const applyMentionSuggestion = useCallback((option: SearchAgentOption) => {
    const nextValue = searchQuery.replace(/(?:^|\s)@[^\s]*$/, (match) => {
      const leadingWhitespace = match.startsWith(' ') ? ' ' : '';
      return leadingWhitespace;
    });

    setSelectedAgentFilter(option);
    setSearchQuery(nextValue.trimStart());
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [searchQuery]);

  const clearSelectedAgentFilter = useCallback(() => {
    setSelectedAgentFilter(null);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  const upsertSearchCacheSession = useCallback((chatId: string, session: ChatSession) => {
    setSearchSessionCache((prev) => {
      const existing = prev.get(chatId);
      if (!existing) {
        return prev;
      }

      const next = new Map(prev);
      next.set(chatId, getNonScheduledSessions(mergeSessions(existing, [session])));
      return next;
    });
  }, []);

  const removeSearchCacheSession = useCallback((chatId: string, chatSessionId: string) => {
    setSearchSessionCache((prev) => {
      const existing = prev.get(chatId);
      if (!existing) {
        return prev;
      }

      const nextSessions = existing.filter(
        (session) => session.chatSession_id !== chatSessionId,
      );

      const next = new Map(prev);
      next.set(chatId, nextSessions);
      return next;
    });
  }, []);

  const resolveSessionForChat = useCallback((chatId: string, sessionId: string): ChatSession | null => {
    const paginatedSession = paginatedChatSessions
      .get(chatId)
      ?.sessions.find((session) => session.chatSession_id === sessionId);
    if (paginatedSession) {
      return paginatedSession;
    }

    const cachedSearchSession = searchSessionCache
      .get(chatId)
      ?.find((session) => session.chatSession_id === sessionId);
    if (cachedSearchSession) {
      return cachedSearchSession;
    }

    const chat = allSearchableChats.find((candidate) => candidate.chat_id === chatId);
    return (chat?.chatSessions || []).find(
      (session) => session.chatSession_id === sessionId,
    ) || null;
  }, [allSearchableChats, paginatedChatSessions, searchSessionCache]);

  const ensureSessionPresentInPaginatedState = useCallback((chatId: string, session: ChatSession) => {
    if (isScheduledSession(session)) {
      return;
    }

    setPaginatedChatSessions((prev) => {
      const existing = prev.get(chatId) || getDefaultPaginatedState();
      if (existing.sessions.some((item) => item.chatSession_id === session.chatSession_id)) {
        return prev;
      }

      const next = new Map(prev);
      next.set(chatId, {
        ...existing,
        sessions: getNonScheduledSessions(mergeSessions(existing.sessions, [session])),
      });
      return next;
    });
  }, []);

  const ensureSessionVisible = useCallback((chatId: string, sessionId: string): boolean => {
    const container = scrollContainerRefs.current.get(chatId);
    const item = sessionItemRefs.current.get(getSessionItemRefKey(chatId, sessionId));

    if (!container || !item) {
      return false;
    }

    item.scrollIntoView({ block: 'nearest' });
    updateScrollbar(chatId, true);
    return true;
  }, [updateScrollbar]);

  const handleSearchFocus = useCallback(() => {
    if (blurHideTimerRef.current) {
      clearTimeout(blurHideTimerRef.current);
      blurHideTimerRef.current = null;
    }

    setIsSearchFocused(true);
  }, []);

  const handleSearchBlur = useCallback(() => {
    blurHideTimerRef.current = setTimeout(() => {
      setIsSearchFocused(false);
    }, 120);
  }, []);

  useEffect(() => {
    return () => {
      if (blurHideTimerRef.current) {
        clearTimeout(blurHideTimerRef.current);
      }
    };
  }, []);

  const openSearchResult = useCallback((result: SearchResultItem) => {
    setPendingSessionScrollTarget({
      chatId: result.chatId,
      sessionId: result.sessionId,
    });
    setExpandedAgentId(result.chatId);
    onSelectChat?.(result.chatId);
    setSearchQuery('');
    setTimeout(() => {
      onSelectChatSession?.(result.chatId, result.sessionId);
    }, 0);
  }, [onSelectChat, onSelectChatSession]);

  const handleSearchInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isMentionPickerOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveMentionIndex((prev) => Math.min(prev + 1, Math.max(mentionSuggestions.length - 1, 0)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveMentionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const option = mentionSuggestions[activeMentionIndex];
        if (option) {
          applyMentionSuggestion(option);
        }
        return;
      }
    }

    if (!isSearchMode) {
      if (event.key === 'Escape' && searchQuery.length > 0) {
        event.preventDefault();
        setSearchQuery('');
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSearchIndex((prev) => Math.min(prev + 1, Math.max(searchResults.length - 1, 0)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSearchIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const target = searchResults[activeSearchIndex];
      if (target) {
        openSearchResult(target);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setSearchQuery('');
      searchInputRef.current?.blur();
    }
  }, [activeMentionIndex, activeSearchIndex, applyMentionSuggestion, isMentionPickerOpen, isSearchMode, mentionSuggestions, openSearchResult, searchQuery.length, searchResults]);

  // 🔥 Fix: handle Agent click - start a new AgentChat and expand the Chat Session list
  const handleAgentClick = (chatId: string) => {
    // Always expand the current Agent's Chat Session list
    setExpandedAgentId(chatId);

    // Select this Agent (this starts a new AgentChat)
    onSelectChat?.(chatId);
  };

  // 🔥 Fix: handle ChatSession click - ensure Agent is selected and expanded
  const handleChatSessionClick = (chatId: string, sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    logger.debug('[AgentList] handleChatSessionClick', {
      chatId,
      sessionId,
      currentChatId,
      currentChatSessionId,
    });

    // Ensure Agent is expanded
    if (expandedAgentId !== chatId) {
      setExpandedAgentId(chatId);
    }

    // Ensure Agent is selected
    if (currentChatId !== chatId) {
      onSelectChat?.(chatId);
    }

    // Select the ChatSession (use setTimeout to ensure Agent state has been updated)
    setTimeout(() => {
      onSelectChatSession?.(chatId, sessionId);
    }, 0);
  };

  // 🔥 Added: handle ChatSession menu toggle
  const handleChatSessionMenuToggle = (chatId: string, sessionId: string, title: string, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    chatSessionMenuActions.toggle(chatId, sessionId, title, event.currentTarget);
  };

  // 🔥 Added: handle delete ChatSession
  const handleDeleteChatSession = (chatId: string, sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onDeleteChatSession?.(chatId, sessionId);
  };

  // 🔥 Added: handle fork ChatSession
  const handleForkChatSession = (chatId: string, sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    onForkChatSession?.(chatId, sessionId);
  };

  // 🔥 Added: sort chats by primaryAgent — the chat matching primaryAgent appears first
  // When excludeBuiltinAgents is true, all built-in agents are excluded from the list (they will be shown separately below the divider)
  const sortedChats = React.useMemo(() => {
    if (!chats.length) return [];

    let filteredChats = chats;

    // 🔥 If excludeBuiltinAgents is true, exclude all built-in agents from the main list
    // Built-in agents are shown separately below the divider, so exclude them here
    if (excludeBuiltinAgents) {
      filteredChats = chats.filter(chat => !isBuiltinAgent(chat.agent?.name, BRAND_NAME));
    }

    const chatsWithoutScheduledSessions = filteredChats;

    const primaryChat = chatsWithoutScheduledSessions.find(chat => chat.agent?.name === primaryAgent);
    const otherChats = chatsWithoutScheduledSessions.filter(chat => chat.agent?.name !== primaryAgent);

    // The chat matching primaryAgent goes first; other chats maintain their original order
    return primaryChat ? [primaryChat, ...otherChats] : chatsWithoutScheduledSessions;
  }, [chats, primaryAgent, excludeBuiltinAgents]);

  const starredSessions = React.useMemo(() => {
    if (!excludeBuiltinAgents) {
      return [] as StarredChatSessionIndexItem[];
    }

    const indexedStarredSessions = data?.profile?.['starred-chat-sessions'] || [];

    return indexedStarredSessions
      .filter((item: StarredChatSessionIndexItem, index: number, array: StarredChatSessionIndexItem[]) => array.findIndex((candidate: StarredChatSessionIndexItem) => candidate.chatSessionId === item.chatSessionId) === index)
      .sort((a: StarredChatSessionIndexItem, b: StarredChatSessionIndexItem) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
  }, [data?.profile, excludeBuiltinAgents]);

  // 🔥 Added: scroll container refs (one scroll container per chat)
  const scrollContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const sessionItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const exhaustedBottomLatchRef = useRef<Map<string, boolean>>(new Map());

  // 🔥 Added: function to show "all loaded" hint (debounced to avoid frequent triggers)
  const showAllLoadedHintTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const triggerAllLoadedHint = useCallback((chatId: string) => {
    // If the hint is already showing, do not trigger again
    if (showAllLoadedHint.get(chatId)) {
      return;
    }

    // Show the hint
    setShowAllLoadedHint(prev => {
      const newMap = new Map(prev);
      newMap.set(chatId, true);
      return newMap;
    });

    // Clear any previous timer
    const existingTimer = showAllLoadedHintTimerRef.current.get(chatId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Auto-hide the hint after 800ms
    const timer = setTimeout(() => {
      setShowAllLoadedHint(prev => {
        const newMap = new Map(prev);
        newMap.set(chatId, false);
        return newMap;
      });
      showAllLoadedHintTimerRef.current.delete(chatId);
    }, 800);

    showAllLoadedHintTimerRef.current.set(chatId, timer);
  }, [showAllLoadedHint]);

  const loadInitialChatSessions = useCallback(async (chatId: string) => {
    const alias = data?.profile?.alias;
    const currentState = paginatedChatSessions.get(chatId);

    if (!alias) {
      logger.warn('[AgentList] Cannot load initial sessions: no user alias');
      return;
    }

    if (!window.electronAPI?.profile || currentState?.isLoading || currentState?.hasLoaded) {
      return;
    }

    setPaginatedChatSessions((prev) => {
      const newMap = new Map(prev);
      const existing: PaginatedChatSessionsState =
        newMap.get(chatId) || getDefaultPaginatedState();
      const nextState: PaginatedChatSessionsState = {
        ...existing,
        isLoading: true,
        error: null,
      };
      newMap.set(chatId, nextState);
      return newMap;
    });

    try {
      const initialResult = await window.electronAPI.profile.getChatSessions(
        alias,
        chatId,
        PAGE_SIZE,
      );

      if (!initialResult?.success || !initialResult.data) {
        throw new Error(initialResult?.error || 'Failed to load chat sessions');
      }

      let collected = initialResult.data.sessions || [];
      let currentNextMonthIndex = initialResult.data.nextMonthIndex || 0;
      let currentHasMore: boolean = Boolean(initialResult.data.hasMore);

      while (currentHasMore && collected.length < PAGE_SIZE) {
        const moreResult = await window.electronAPI.profile.getMoreChatSessions(
          alias,
          chatId,
          currentNextMonthIndex,
        );

        if (!moreResult?.success || !moreResult.data) {
          throw new Error(moreResult?.error || 'Failed to load more chat sessions');
        }

        collected = collected.concat(moreResult.data.sessions || []);
        currentNextMonthIndex = moreResult.data.nextMonthIndex || 0;
        currentHasMore = Boolean(moreResult.data.hasMore);
      }

      setPaginatedChatSessions((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(chatId) || getDefaultPaginatedState();
        const nextState: PaginatedChatSessionsState = {
          ...existing,
          sessions: getNonScheduledSessions(mergeSessions(existing.sessions, collected)),
          hasLoaded: true,
          hasMore: currentHasMore,
          nextMonthIndex: currentNextMonthIndex,
          isLoading: false,
          error: null,
        };
        newMap.set(chatId, nextState);
        return newMap;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load chat sessions';
      logger.error('[AgentList] Failed to load initial chat sessions:', error);
      setPaginatedChatSessions((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(chatId) || getDefaultPaginatedState();
        const nextState: PaginatedChatSessionsState = {
          ...existing,
          hasLoaded: true,
          hasMore: false,
          nextMonthIndex: 0,
          isLoading: false,
          error: message,
        };
        newMap.set(chatId, nextState);
        return newMap;
      });
    }
  }, [data?.profile?.alias, paginatedChatSessions]);

  const loadMoreChatSessions = useCallback(async (chatId: string) => {
    const alias = data?.profile?.alias;
    const state = paginatedChatSessions.get(chatId);

    if (!alias) {
      logger.warn('[AgentList] Cannot load more: no user alias');
      return;
    }

    if (!window.electronAPI?.profile || !state?.hasLoaded || state.isLoading) {
      return;
    }

    if (!state.hasMore) {
      triggerAllLoadedHint(chatId);
      return;
    }

    setPaginatedChatSessions((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(chatId);
      if (existing) {
        const nextState: PaginatedChatSessionsState = {
          ...existing,
          isLoading: true,
          error: null,
        };
        newMap.set(chatId, nextState);
      }
      return newMap;
    });

    try {
      let collected: ChatSession[] = [];
      let currentNextMonthIndex = state.nextMonthIndex;
      let currentHasMore: boolean = state.hasMore;

      while (currentHasMore && collected.length < PAGE_SIZE) {
        const moreResult = await window.electronAPI.profile.getMoreChatSessions(
          alias,
          chatId,
          currentNextMonthIndex,
        );

        if (!moreResult?.success || !moreResult.data) {
          throw new Error(moreResult?.error || 'Failed to load more chat sessions');
        }

        collected = collected.concat(moreResult.data.sessions || []);
        currentNextMonthIndex = moreResult.data.nextMonthIndex || 0;
        currentHasMore = Boolean(moreResult.data.hasMore);
      }

      setPaginatedChatSessions((prev) => {
        const newMap = new Map(prev);
        const existing: PaginatedChatSessionsState =
          newMap.get(chatId) || getDefaultPaginatedState();
        const nextState: PaginatedChatSessionsState = {
          ...existing,
          sessions: getNonScheduledSessions(mergeSessions(existing.sessions, collected)),
          hasLoaded: true,
          hasMore: currentHasMore,
          nextMonthIndex: currentNextMonthIndex,
          isLoading: false,
          error: null,
        };
        newMap.set(chatId, nextState);
        return newMap;
      });

      if (!currentHasMore) {
        triggerAllLoadedHint(chatId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load more chat sessions';
      logger.error('[AgentList] Failed to load more chat sessions:', error);
      setPaginatedChatSessions((prev) => {
        const newMap = new Map(prev);
        const existing: PaginatedChatSessionsState =
          newMap.get(chatId) || getDefaultPaginatedState();
        const nextState: PaginatedChatSessionsState = {
          ...existing,
          isLoading: false,
          error: message,
        };
        newMap.set(chatId, nextState);
        return newMap;
      });
    }
  }, [data?.profile?.alias, paginatedChatSessions, triggerAllLoadedHint]);

  const handleScroll = useCallback((chatId: string, event: React.UIEvent<HTMLDivElement>) => {
    const state = paginatedChatSessions.get(chatId);
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    const isNearBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD_PX;
    const exhaustedBottomLatched = exhaustedBottomLatchRef.current.get(chatId) === true;

    if (!state?.hasLoaded || state.isLoading) {
      return;
    }

    if (!state.hasMore) {
      if (!isNearBottom) {
        exhaustedBottomLatchRef.current.set(chatId, false);
        return;
      }

      if (!exhaustedBottomLatched) {
        exhaustedBottomLatchRef.current.set(chatId, true);
        triggerAllLoadedHint(chatId);
      }
      return;
    }

    if (!isNearBottom) {
      exhaustedBottomLatchRef.current.set(chatId, false);
      return;
    }

    void loadMoreChatSessions(chatId);
  }, [loadMoreChatSessions, paginatedChatSessions, triggerAllLoadedHint]);

  useEffect(() => {
    if (expandedAgentId) {
      void loadInitialChatSessions(expandedAgentId);
    }
  }, [expandedAgentId, loadInitialChatSessions]);

  useEffect(() => {
    if (!currentChatId || !currentChatSessionId || activeView !== 'chat') {
      return;
    }

    setPendingSessionScrollTarget((currentTarget) => {
      if (
        currentTarget?.chatId === currentChatId
        && currentTarget?.sessionId === currentChatSessionId
      ) {
        return currentTarget;
      }

      return {
        chatId: currentChatId,
        sessionId: currentChatSessionId,
      };
    });

    if (expandedAgentId !== currentChatId) {
      setExpandedAgentId(currentChatId);
    }

    const resolvedSession = resolveSessionForChat(currentChatId, currentChatSessionId);
    if (resolvedSession) {
      ensureSessionPresentInPaginatedState(currentChatId, resolvedSession);
    }
  }, [
    activeView,
    currentChatId,
    currentChatSessionId,
    ensureSessionPresentInPaginatedState,
    expandedAgentId,
    resolveSessionForChat,
  ]);

  useEffect(() => {
    const pendingTarget = pendingSessionScrollTarget;

    if (!pendingTarget || expandedAgentId !== pendingTarget.chatId) {
      return;
    }

    let frame1 = 0;
    let frame2 = 0;

    frame1 = window.requestAnimationFrame(() => {
      frame2 = window.requestAnimationFrame(() => {
        const didScroll = ensureSessionVisible(
          pendingTarget.chatId,
          pendingTarget.sessionId,
        );

        if (didScroll) {
          setPendingSessionScrollTarget((currentTarget) => {
            if (
              currentTarget?.chatId === pendingTarget.chatId
              && currentTarget?.sessionId === pendingTarget.sessionId
            ) {
              return null;
            }

            return currentTarget;
          });
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(frame1);
      window.cancelAnimationFrame(frame2);
    };
  }, [ensureSessionVisible, expandedAgentId, paginatedChatSessions, pendingSessionScrollTarget]);

  useEffect(() => {
    const validChatIds = new Set(chats.map((chat) => chat.chat_id));
    setPaginatedChatSessions((prev) => {
      const newMap = new Map<string, PaginatedChatSessionsState>();
      prev.forEach((value, key) => {
        if (validChatIds.has(key)) {
          newMap.set(key, value);
        }
      });
      return newMap;
    });

    exhaustedBottomLatchRef.current.forEach((_, key) => {
      if (!validChatIds.has(key)) {
        exhaustedBottomLatchRef.current.delete(key);
      }
    });
  }, [chats]);

  useEffect(() => {
    const alias = data?.profile?.alias;
    if (
      !alias ||
      !window.electronAPI?.profile?.onChatSessionStoreSessionCreated ||
      !window.electronAPI?.profile?.onChatSessionStoreMetadataPatched ||
      !window.electronAPI?.profile?.onChatSessionStoreSessionDeleted
    ) {
      return;
    }

    const unsubscribeCreated = window.electronAPI.profile.onChatSessionStoreSessionCreated((eventData) => {
      if (eventData.alias !== alias) {
        return;
      }

      upsertSearchCacheSession(eventData.chatId, eventData.session as ChatSession);

      setPaginatedChatSessions((prev) => {
        const existing = prev.get(eventData.chatId);
        if (!existing?.hasLoaded) {
          return prev;
        }

        const newMap = new Map(prev);
        newMap.set(eventData.chatId, {
          ...existing,
          sessions: getNonScheduledSessions(mergeSessions(existing.sessions, [eventData.session as ChatSession])),
        });
        return newMap;
      });

      const scrollContainer = scrollContainerRefs.current.get(eventData.chatId);
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    });

    const unsubscribeMetadataPatched = window.electronAPI.profile.onChatSessionStoreMetadataPatched((eventData) => {
      if (eventData.alias !== alias) {
        return;
      }

      upsertSearchCacheSession(eventData.chatId, eventData.metadata as ChatSession);

      setPaginatedChatSessions((prev) => {
        const existing = prev.get(eventData.chatId);
        if (!existing?.hasLoaded) {
          return prev;
        }

        const newMap = new Map(prev);
        newMap.set(eventData.chatId, {
          ...existing,
          sessions: getNonScheduledSessions(mergeSessions(existing.sessions, [eventData.metadata as ChatSession])),
        });
        return newMap;
      });
    });

    const unsubscribeDeleted = window.electronAPI.profile.onChatSessionStoreSessionDeleted((eventData) => {
      if (eventData.alias !== alias) {
        return;
      }

      removeSearchCacheSession(eventData.chatId, eventData.chatSessionId);

      setPaginatedChatSessions((prev) => {
        const existing = prev.get(eventData.chatId);
        if (!existing?.hasLoaded) {
          return prev;
        }

        const newMap = new Map(prev);
        newMap.set(eventData.chatId, {
          ...existing,
          sessions: existing.sessions.filter(
            (session) => session.chatSession_id !== eventData.chatSessionId,
          ),
        });
        return newMap;
      });
    });

    return () => {
      unsubscribeCreated();
      unsubscribeMetadataPatched();
      unsubscribeDeleted();
    };
  }, [data?.profile?.alias, removeSearchCacheSession, upsertSearchCacheSession]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      padding: '0px',
      gap: '8px',
      width: '100%'
    }}>
      {showSearch && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px', position: 'sticky', top: 0, zIndex: 10, backgroundColor: '#FFFBF8', paddingBottom: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 12px',
              borderRadius: '14px',
              backgroundColor: '#F3F1ED',
              border: isSearchMode ? '1px solid #272320' : '1px solid transparent',
            }}
          >
            <Search size={16} color="#6C6C70" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={handleSearchInputKeyDown}
              onFocus={handleSearchFocus}
              onBlur={handleSearchBlur}
              placeholder="Search conversations"
              aria-label="Search conversations"
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                flex: 1,
                fontSize: '14px',
                color: '#272320',
              }}
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear conversation search"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#6C6C70',
                }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          {selectedAgentFilter && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '0 4px',
              }}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  maxWidth: '100%',
                  borderRadius: '999px',
                  backgroundColor: '#F4E7D3',
                  color: '#272320',
                  padding: '6px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                <AgentAvatar
                  emoji={selectedAgentFilter.agentEmoji}
                  avatar={selectedAgentFilter.agentAvatar}
                  source={selectedAgentFilter.agentSource}
                  name={selectedAgentFilter.agentName}
                  size="sm"
                  version={selectedAgentFilter.agentVersion}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedAgentFilter.agentName}
                </span>
                <button
                  type="button"
                  onClick={clearSelectedAgentFilter}
                  aria-label="Clear agent filter"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#6C6C70',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
              <span style={{ fontSize: '12px', color: '#6C6C70' }}>Filtering by agent</span>
            </div>
          )}

          {showAgentSearchHint && (
            <div
              style={{
                padding: '0 4px',
                fontSize: '12px',
                color: '#6C6C70',
              }}
            >
              Tip: type @ to narrow results to an agent.
            </div>
          )}

          {isMentionPickerOpen && (
            <div
              ref={mentionPickerRef}
              style={{
                position: 'absolute',
                top: selectedAgentFilter ? '92px' : showAgentSearchHint ? '82px' : '58px',
                left: 0,
                right: 0,
                backgroundColor: '#FFFFFF',
                border: '1px solid #E4DED4',
                borderRadius: '16px',
                boxShadow: '0 12px 32px rgba(39, 35, 32, 0.12)',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                zIndex: 20,
                maxHeight: '280px',
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                scrollbarWidth: 'thin',
              }}
            >
              {mentionSuggestions.map((option, index) => {
                const isActiveOption = index === activeMentionIndex;
                return (
                  <button
                    key={`${option.chatId}-${option.agentName}`}
                    ref={(element) => {
                      mentionOptionRefs.current[index] = element;
                    }}
                    type="button"
                    onMouseEnter={() => setActiveMentionIndex(index)}
                    onClick={() => applyMentionSuggestion(option)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      width: '100%',
                      border: 'none',
                      background: isActiveOption ? '#F6F0E7' : 'transparent',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <AgentAvatar
                      emoji={option.agentEmoji}
                      avatar={option.agentAvatar}
                      source={option.agentSource}
                      name={option.agentName}
                      size="sm"
                      version={option.agentVersion}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#272320' }}>{option.agentName}</span>
                      <span style={{ fontSize: '12px', color: '#6C6C70' }}>Filter conversations for this agent</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {chats.length === 0 ? (
        <div>
          <p>No chats available</p>
          <p>Create your first chat to get started</p>
        </div>
      ) : isSearchMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          {searchResults.length === 0 ? (
            <div
              style={{
                padding: '16px 12px',
                borderRadius: '16px',
                backgroundColor: '#F8F6F2',
                color: '#6C6C70',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              <div style={{ color: '#272320', fontWeight: 600, marginBottom: '4px' }}>
                {searchLoadingChatIds.size > 0 ? 'Indexing conversations...' : 'No conversations found'}
              </div>
              <div>
                {searchLoadingChatIds.size > 0
                  ? 'Loading session metadata for search.'
                  : 'Try another keyword or type @ to filter by agent.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
              {searchResults.map((result, index) => {
                const isActiveResult = index === activeSearchIndex;
                const isUnread = result.readStatus !== 'read';
                const isCurrentSession = currentChatSessionId === result.sessionId;

                return (
                  <button
                    key={`${result.chatId}-${result.sessionId}`}
                    type="button"
                    onMouseEnter={() => setActiveSearchIndex(index)}
                    onClick={() => openSearchResult(result)}
                    style={{
                      border: isActiveResult ? '1px solid #272320' : '1px solid transparent',
                      background: isCurrentSession ? '#ECE8E0' : isActiveResult ? '#F6F0E7' : '#F8F6F2',
                      borderRadius: '16px',
                      padding: '12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      width: '100%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '14px',
                          fontWeight: isUnread ? 700 : 600,
                          color: '#272320',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        {renderHighlightedTitle(result.title, searchQuery)}
                      </div>
                      {isUnread && (
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '999px',
                            backgroundColor: '#B42318',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <AgentAvatar
                        emoji={result.agentEmoji}
                        avatar={result.agentAvatar}
                        source={result.agentSource}
                        name={result.agentName}
                        size="sm"
                        version={result.agentVersion}
                      />
                      <span style={{ fontSize: '12px', color: '#6C6C70', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {result.agentName}
                      </span>
                      <span style={{ fontSize: '12px', color: '#B0B0B5' }}>•</span>
                      <span style={{ fontSize: '12px', color: '#6C6C70' }}>{getRelativeTimeLabel(result.lastUpdated)}</span>
                      {result.source?.type === 'remote' && (
                        <span
                          style={{
                            fontSize: '11px',
                            lineHeight: 1,
                            borderRadius: '999px',
                            padding: '4px 6px',
                            backgroundColor: '#D8EEF9',
                            color: '#0B6FA4',
                            marginLeft: 'auto',
                          }}
                        >
                          Remote
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {searchResults.length >= 50 && (
                <div style={{ fontSize: '12px', color: '#6C6C70', padding: '0 4px' }}>
                  Showing top 50 results
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          width: '100%'
        }}>
          {starredSessions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 4px',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#6C6C70',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                }}
              >
                <span>Starred</span>
              </div>

              {starredSessions.map((session: StarredChatSessionIndexItem) => {
                const isActiveSession = currentChatSessionId === session.chatSessionId;
                const isUnreadSession = session.readStatus !== 'read' && !isActiveSession;
                const sessionTitleColor = isUnreadSession ? '#272320' : '#6C6C70';
                const sessionTitleFontWeight = isUnreadSession ? 600 : 410;

                return (
                  <div
                    key={`starred-${session.chatSessionId}`}
                    onClick={(event) => handleChatSessionClick(session.chatId, session.chatSessionId, event)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0px 16px 0px 12px',
                      marginRight: '4px',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      fontSize: '15px',
                      height: '40px',
                      minHeight: '40px',
                      color: sessionTitleColor,
                      backgroundColor: isActiveSession ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                      transition: 'background-color 0.2s ease',
                      position: 'relative',
                    }}
                    className={`chat-session-item ${
                      openMenuChatSessionId === session.chatSessionId ? 'menu-open' : ''
                    }`}
                    onMouseEnter={(event) => {
                      if (!isActiveSession) {
                        event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                      }
                      const moreBtn = event.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                      if (moreBtn) {
                        moreBtn.style.opacity = '1';
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!isActiveSession) {
                        event.currentTarget.style.backgroundColor = 'transparent';
                      }
                      if (openMenuChatSessionId !== session.chatSessionId) {
                        const moreBtn = event.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                        if (moreBtn) {
                          moreBtn.style.opacity = '0';
                        }
                      }
                    }}
                    title={session.title}
                    data-read-status={session.readStatus || 'read'}
                  >
                    <div style={{
                      width: '28px',
                      height: '40px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }} />
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      minWidth: 0,
                      flex: 1,
                      padding: '10px 10px 10px 0px',
                    }}>
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                          minWidth: 0,
                          fontWeight: sessionTitleFontWeight,
                          lineHeight: '20px',
                          fontVariationSettings: '\'opsz\' 10.5',
                          color: sessionTitleColor,
                        }}
                      >
                        {session.title}
                      </span>
                    </div>

                    {(onDeleteChatSession || onForkChatSession) && (
                      <div
                        className="chat-session-more-btn"
                        data-chat-session-starred="true"
                        onClick={(event) => {
                          event.stopPropagation();
                          chatSessionMenuActions.toggle(session.chatId, session.chatSessionId, session.title, event.currentTarget);
                        }}
                        style={{
                          opacity: openMenuChatSessionId === session.chatSessionId ? '1' : '0',
                          marginLeft: 'auto',
                        }}
                        title="More options"
                      >
                        <MoreHorizontal size={20} strokeWidth={1.5} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {starredSessions.length > 0 && sortedChats.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '0 4px',
                fontSize: '12px',
                fontWeight: 700,
                color: '#6C6C70',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              <span>Agents</span>
            </div>
          )}

          {sortedChats.map((chat) => {
            // 🔥 Determine if this is a Built-in Agent (built-in agent; list differs by branding)
            const isBuiltinAgentFlag = isBuiltinAgent(chat.agent?.name, BRAND_NAME);
            // 🔥 Determine if this is an Example Agent (demo/sample)
            const isExampleAgent = chat.agent?.name === 'PM Agent - Journeys';
            const agentName = chat.agent?.name || 'Unnamed Agent';
            const paginatedState = paginatedChatSessions.get(chat.chat_id) || getDefaultPaginatedState();
            const inlineChatSessions = getNonScheduledSessions(chat.chatSessions || []);
            const visibleChatSessions = paginatedState.hasLoaded
              ? getNonScheduledSessions(paginatedState.sessions)
              : inlineChatSessions;
            const isExpandedAgent = expandedAgentId === chat.chat_id;
            const shouldBoldAgentName = unreadHighlightChatIds.has(chat.chat_id) && !isExpandedAgent;

            return (
              <div key={chat.chat_id} style={{ width: '100%' }}>
              <NavItem
                icon={
                  <AgentAvatar
                    emoji={chat.agent?.emoji}
                    avatar={chat.agent?.avatar}
                    source={chat.agent?.source}
                    name={chat.agent?.name}
                    size="sm"
                    version={chat.agent?.version}
                  />
                }
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: shouldBoldAgentName ? 700 : 400 }}>
                    {agentName}
                    {isBuiltinAgentFlag && (
                      <span className="kobi-builtin-badge">Built-in</span>
                    )}
                    {isExampleAgent && (
                      <span className="example-agent-badge">Example</span>
                    )}
                  </span>
                }
                ariaLabel={agentName}
                isActive={
                  (activeView === 'chat' || activeView === 'settings') &&
                  chat.chat_id === currentChatId &&
                  (activeView === 'settings' || !currentChatSessionId || !visibleChatSessions.some(s => s.chatSession_id === currentChatSessionId))
                } // 🔥 Agent selected condition: (in chat or settings view) AND is current Agent AND (in settings view OR no session selected OR selected session not in list)
                onClick={() => handleAgentClick(chat.chat_id)}
                rightContent={
                  chat.agent ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      {/* 🔥 Added: Start New Conversation button */}
                      <div
                        className="dropdown-menu-container"
                        style={{
                          opacity: currentChatSessionId && visibleChatSessions.some(s => s.chatSession_id === currentChatSessionId) ? 1 : 0,
                          transition: 'opacity 0.2s ease-in-out'
                        }}
                      >
                        <div
                          className="dropdown-menu-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAgentClick(chat.chat_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              handleAgentClick(chat.chat_id);
                            }
                          }}
                          title="Start new conversation"
                          aria-label="Start new conversation"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                        >
                          <StartNewConversationIcon />
                        </div>
                      </div>

                      {/* More options button */}
                      <div className="dropdown-menu-container" style={{
                        opacity: currentChatSessionId && visibleChatSessions.some(s => s.chatSession_id === currentChatSessionId) ? 1 : 0,
                        transition: 'opacity 0.2s ease-in-out'
                      }}>
                        <div
                          className="dropdown-menu-trigger"
                          onClick={(e) => handleMenuToggle(chat.chat_id, e)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              agentMenuActions.toggle(chat.chat_id, e.currentTarget);
                            }
                          }}
                          title="More options"
                          aria-label="More options"
                          aria-expanded={openMenuChatId === chat.chat_id}
                          aria-haspopup="menu"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                        >
                          <MoreHorizontal size={20} strokeWidth={1.5} />
                        </div>
                      </div>
                    </div>
                  ) : undefined
                }
              />

              {/* 🔥 Added: ChatSession secondary list */}
              {expandedAgentId === chat.chat_id && (
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => handleSessionListMouseEnter(chat.chat_id)}
                  onMouseLeave={() => handleSessionListMouseLeave(chat.chat_id)}
                >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    paddingLeft: '0px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    maxHeight: 'calc(5 * (40px + 4px))', // Height for 5 items: item height 40px + gap 4px
                    overflowY: 'auto',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none' as React.CSSProperties['msOverflowStyle'],
                  }}
                  className="chat-sessions-list"
                  onScroll={(e) => { handleScroll(chat.chat_id, e); updateScrollbar(chat.chat_id, true); }}
                  ref={(el) => {
                    if (el) {
                      scrollContainerRefs.current.set(chat.chat_id, el);
                    }
                  }}
                >
                  {visibleChatSessions
                    .sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())
                    .map((session) => {
                      const isActiveSession = currentChatSessionId === session.chatSession_id;
                      const isUnreadSession = session.readStatus !== 'read' && !isActiveSession;
                      const sessionTitleColor = isUnreadSession ? '#272320' : '#6C6C70';
                      const sessionTitleFontWeight = isUnreadSession ? 600 : 410;
                      const sessionRefKey = getSessionItemRefKey(chat.chat_id, session.chatSession_id);

                      return (
                      <div
                        key={session.chatSession_id}
                        ref={(el) => {
                          if (el) {
                            sessionItemRefs.current.set(sessionRefKey, el);
                            return;
                          }

                          sessionItemRefs.current.delete(sessionRefKey);
                        }}
                        onClick={(e) => handleChatSessionClick(chat.chat_id, session.chatSession_id, e)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0px 16px 0px 12px',
                          marginRight: '4px',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          fontSize: '15px',
                          height: '40px',
                          minHeight: '40px',
                          color: sessionTitleColor,
                          backgroundColor: isActiveSession ? 'rgba(0, 0, 0, 0.05)' : 'transparent',
                          transition: 'background-color 0.2s ease',
                          position: 'relative',
                        }}
                        className={`chat-session-item ${
                          openMenuChatSessionId === session.chatSession_id ? 'menu-open' : ''
                        }`}
                        onMouseEnter={(e) => {
                          if (!isActiveSession) {
                            e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                          }
                          // Show the more options button
                          const moreBtn = e.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                          if (moreBtn) {
                            moreBtn.style.opacity = '1';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActiveSession) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                          // Hide the more options button (unless the menu is open)
                          if (openMenuChatSessionId !== session.chatSession_id) {
                            const moreBtn = e.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                            if (moreBtn) {
                              moreBtn.style.opacity = '0';
                            }
                          }
                        }}
                        title={session.title}
                        data-read-status={session.readStatus || 'read'}
                      >
                        {/* 🔥 Added: left-side loading icon area */}
                        <div style={{
                          width: '28px',
                          height: '40px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          {(() => {
                            const status = chatSessionStatuses.get(session.chatSession_id);
                            const isLoading = status && status !== 'idle';
                            return isLoading ? <LoadingIcon /> : null;
                          })()}
                        </div>

                        {session.source?.type === 'remote' && (
                          <Globe className="w-3 h-3 text-blue-400 shrink-0 mr-1" />
                        )}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          minWidth: 0,
                          flex: 1,
                          padding: '10px 10px 10px 0px'
                        }}>
                          <span style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: sessionTitleFontWeight,
                            lineHeight: '20px',
                            fontVariationSettings: '\'opsz\' 10.5',
                            flex: 1,
                            minWidth: 0,
                            color: sessionTitleColor
                          }}>
                            {session.title}
                          </span>
                        </div>

                        {/* 🔥 Added: More Options button - right-aligned, hover style controlled by CSS */}
                        {(onDeleteChatSession || onForkChatSession) && (
                          <div
                            className="chat-session-more-btn"
                            data-chat-session-starred={session.starred ? 'true' : 'false'}
                            onClick={(e) => handleChatSessionMenuToggle(chat.chat_id, session.chatSession_id, session.title, e)}
                            style={{
                              opacity: openMenuChatSessionId === session.chatSession_id ? '1' : '0',
                              marginLeft: 'auto'
                            }}
                            title="More options"
                          >
                            <MoreHorizontal size={20} strokeWidth={1.5} />
                          </div>
                        )}

                      </div>
                    );})}

                  {paginatedState.error && !paginatedState.isLoading && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: '#B42318',
                      fontSize: '12px',
                      textAlign: 'center'
                    }}>
                      {paginatedState.error}
                    </div>
                  )}

                  {!paginatedState.isLoading && paginatedState.hasLoaded && visibleChatSessions.length === 0 && !paginatedState.error && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: '#9E9E9E',
                      fontSize: '12px'
                    }}>
                      No conversations yet
                    </div>
                  )}

                  {/* 🔥 Added: scroll-to-load-more loading indicator */}
                  {paginatedState.isLoading && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: '#6C6C70',
                      fontSize: '13px'
                    }}>
                      <LoadingIcon />
                      <span style={{ marginLeft: '8px' }}>Loading...</span>
                    </div>
                  )}

                  {/* 🔥 Added: temporary "no more data" hint (auto-dismisses after showing) */}
                  {showAllLoadedHint.get(chat.chat_id) && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: '#9E9E9E',
                      fontSize: '12px'
                    }}>
                      All conversations loaded
                    </div>
                  )}
                </div>
                {/* Custom overlay scrollbar */}
                {(() => {
                  const sb = scrollbarState.get(chat.chat_id);
                  const container = scrollContainerRefs.current.get(chat.chat_id);
                  const needsScroll = container ? container.scrollHeight > container.clientHeight : false;
                  if (!sb || !needsScroll) return null;
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        right: 2,
                        top: sb.thumbTop + 4, // +4 for paddingTop
                        width: 3,
                        height: sb.thumbHeight,
                        borderRadius: 3,
                        background: 'rgba(0, 0, 0, 0.22)',
                        opacity: sb.visible ? 1 : 0,
                        transition: 'opacity 0.25s ease',
                        pointerEvents: 'none',
                        zIndex: 10,
                      }}
                    />
                  );
                })()}
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AgentList;