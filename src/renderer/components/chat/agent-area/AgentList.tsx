import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MoreHorizontal, Star } from 'lucide-react';
import { ChatConfigRuntime, ChatSession, StarredChatSessionIndexItem } from '../../../lib/userData/types';
import type { ChatUnreadSummary } from '@shared/types/chatSessionTypes';
import NavItem from '../../ui/navigation/NavItem';
import { AgentAvatar } from '../../common/AgentAvatar';
import { isBuiltinAgent } from '../../../lib/userData/types';
import { BRAND_NAME } from '@shared/constants/branding';
import { resolveChatAgent } from '@/lib/agent';
import { useProfileData } from '../../userData/userDataProvider';
import { useChatUnreadSummaryMap } from '../../../lib/chat/useChatUnreadSummary';
import { AgentMenuAtom } from '../../menu/AgentDropdownMenu';
import { ChatSessionMenuAtom } from '../../menu/ChatSessionDropdownMenu';
import { AgentListSearchHeader } from './AgentListSearchHeader';
import { useOverlayScrollbar } from './useOverlayScrollbar';
import '../../../styles/DropdownMenu.css';
import { createLogger } from '../../../lib/utilities/logger';
import { useI18n } from '../../../lib/i18n/useI18n';
const logger = createLogger('[AgentList]');

const PAGE_SIZE = 100;
// Built-in agents (pinned below the divider) keep the original fixed-height,
// scroll-to-load list; this is the near-bottom threshold that triggers the next page.
const SCROLL_THRESHOLD_PX = 80;
// Regular agents use a Show more / Show less window: the initial expand shows up to
// 8 sessions; each "Show more" reveals SHOW_MORE_STEP additional sessions.
const INITIAL_VISIBLE_COUNT = 8;
const SHOW_MORE_STEP = 10;
// Reserved key used to drive the regular (searchable) agent list's own hover overlay
// scrollbar through the same scrollbar machinery as the built-in session lists. It is a
// sentinel that never collides with a real chat_id.
const AGENT_LIST_SCROLLBAR_KEY = '__agent_list__';
interface PaginatedChatSessionsState {
  sessions: ChatSession[];
  hasLoaded: boolean;
  hasMore: boolean;
  nextMonthIndex: number;
  isLoading: boolean;
  error: string | null;
  visibleCount: number;
}

interface SearchResultItem {
  chatId: string;
  sessionId: string;
  title: string;
  agentName: string;
  agentEmoji?: string;
  agentAvatar?: string;
  agentSource?: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL';
  agentVersion?: string;
  lastUpdated: string;
  readStatus?: ChatSession['readStatus'];
}

export interface SearchAgentOption {
  chatId: string;
  agentName: string;
  agentEmoji?: string;
  agentAvatar?: string;
  agentSource?: 'IN-LIBRARY' | 'ON-DEVICE' | 'EXTERNAL';
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
  visibleCount: INITIAL_VISIBLE_COUNT,
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
    <path d="M10.5 4.00002C10.7761 4.00002 11 4.22388 11 4.50002C10.9999 4.77612 10.7761 5.00002 10.5 5.00002L6 5.00002C4.89543 5.00002 4 5.89544 4 7.00001L4 14C4.00004 15.1045 4.89545 16 6 16L13 16C14.1045 16 14.9999 15.1045 15 14V9.5C15 9.22386 15.2238 9 15.5 9C15.7761 9 16 9.22386 16 9.5V14C15.9999 15.6568 14.6568 17 13 17H6C4.34317 17 3.00004 15.6568 3 14L3 7.00001C3 5.34316 4.34314 4.00002 6 4.00002L10.5 4.00002ZM16.1465 3.14651C16.3417 2.95125 16.6582 2.95125 16.8535 3.14651C17.0487 3.34177 17.0487 3.6583 16.8535 3.85353L9.06054 11.6455L7.99999 12L8.35351 10.9395L16.1465 3.14651Z" fill="currentColor"/>
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
      <path d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19" stroke="var(--color-warm-900)" strokeWidth="2" strokeLinecap="round"/>
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
  primaryChat?: string; // 🔥 primary chat id, used for priority display
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
      <span style={{ backgroundColor: 'var(--color-warning-100)', borderRadius: '4px', padding: '0 2px' }}>
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
  primaryChat, // 🔥 primary chat id; no default so it can be undefined
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
  const { t } = useI18n();
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

  // Independently expanded Agent IDs: each agent's ChatSession list toggles on its own
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(() => new Set());

  // Additively expand an agent's ChatSession list (idempotent; preserves other agents' state)
  const expandAgent = useCallback((chatId: string) => {
    setExpandedAgentIds((prev) => {
      if (prev.has(chatId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(chatId);
      return next;
    });
  }, []);

  // Toggle a single agent's ChatSession list independently of the others
  const toggleAgentExpanded = useCallback((chatId: string) => {
    setExpandedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  // Collapse every agent's ChatSession list (used when leaving the chat view)
  const collapseAllAgents = useCallback(() => {
    setExpandedAgentIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  // 🔥 Added: track the status of each ChatSession
  const [chatSessionStatuses, setChatSessionStatuses] = useState<Map<string, string>>(new Map());

  // 🔥 Paginated loading: each chat maintains locally loaded non-scheduled sessions
  const [paginatedChatSessions, setPaginatedChatSessions] = useState<Map<string, PaginatedChatSessionsState>>(new Map());

  // Built-in agents keep the fixed-height scroll-load list: transient "all loaded" hint per chat.
  const [showAllLoadedHint, setShowAllLoadedHint] = useState<Map<string, boolean>>(new Map());

  // Custom overlay scrollbar state + the tracked scroll containers (built-in
  // scroll-load list and the regular agent list) live in a dedicated hook.
  const {
    scrollbarState,
    scrollContainerRefs,
    updateScrollbar,
    handleSessionListMouseEnter,
    handleSessionListMouseLeave,
  } = useOverlayScrollbar();

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


  // Auto-expand the current Agent on navigation (chat view only); additive so other agents stay as-is.
  // Leaving the chat view collapses every list (session lists are not shown outside chat).
  useEffect(() => {
    if (currentChatId && activeView === 'chat') {
      expandAgent(currentChatId);
    } else if (activeView !== 'chat') {
      collapseAllAgents();
    }
  }, [currentChatId, activeView, expandAgent, collapseAllAgents]);

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
        if (!summary || expandedAgentIds.has(chatId) || getUnreadCount(summary) <= 0) {
          next.delete(chatId);
        }
      });
      return next;
    });
  }, [chats, expandedAgentIds, unreadSummaryMap]);

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

      if (expandedAgentIds.has(payload.summary.chatId) || nextUnreadCount <= 0 || (previousUnreadCount !== undefined && nextUnreadCount <= previousUnreadCount)) {
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
  }, [chats, data?.profile?.alias, expandedAgentIds]);

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
      const agent = resolveChatAgent(chat);
      const agentName = agent?.name || 'Unnamed Agent';
      if (!deduped.has(agentName)) {
        deduped.set(agentName, {
          chatId: chat.chat_id,
          agentName,
          agentEmoji: agent?.emoji,
          agentAvatar: agent?.avatar,
          agentSource: agent?.source,
          agentVersion: agent?.version,
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
      if (selectedAgentFilter && chat.chat_id !== selectedAgentFilter.chatId && resolveChatAgent(chat)?.name !== selectedAgentFilter.agentName) {
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
      const agent = resolveChatAgent(chat);
      const agentName = agent?.name || 'Unnamed Agent';
      if (selectedAgentFilter && agentName !== selectedAgentFilter.agentName) {
        return [];
      }

      return getSearchableSessionsForChat(chat)
        .map((session) => ({
          chatId: chat.chat_id,
          sessionId: session.chatSession_id,
          title: session.title,
          agentName,
          agentEmoji: agent?.emoji,
          agentAvatar: agent?.avatar,
          agentSource: agent?.source,
          agentVersion: agent?.version,
          lastUpdated: session.last_updated,
          readStatus: session.readStatus,
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
    const item = sessionItemRefs.current.get(getSessionItemRefKey(chatId, sessionId));

    if (!item) {
      return false;
    }

    item.scrollIntoView({ block: 'nearest' });

    // Built-in agents render a custom overlay scrollbar; refresh it after scrolling.
    if (scrollContainerRefs.current.get(chatId)) {
      updateScrollbar(chatId, true);
    }
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
    expandAgent(result.chatId);
    onSelectChat?.(result.chatId);
    setSearchQuery('');
    setTimeout(() => {
      onSelectChatSession?.(result.chatId, result.sessionId);
    }, 0);
  }, [expandAgent, onSelectChat, onSelectChatSession]);

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

  // Handle Agent click: toggle this Agent's ChatSession list. Does NOT start a new chat -
  // the dedicated new-chat button owns that. Expansion is independent per agent.
  const handleToggleAgentExpand = (chatId: string) => {
    toggleAgentExpanded(chatId);
  };

  // Handle the dedicated new-chat button: start a new AgentChat and reveal its session list.
  const handleStartNewChat = (chatId: string) => {
    expandAgent(chatId);
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
    expandAgent(chatId);

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

  // 🔥 Sort chats by the primary chat id — the chat matching primaryChat appears first
  // When excludeBuiltinAgents is true, all built-in agents are excluded from the list (they will be shown separately below the divider)
  const sortedChats = React.useMemo(() => {
    if (!chats.length) return [];

    let filteredChats = chats;

    // 🔥 If excludeBuiltinAgents is true, exclude all built-in agents from the main list
    // Built-in agents are shown separately below the divider, so exclude them here
    if (excludeBuiltinAgents) {
      filteredChats = chats.filter(chat => !isBuiltinAgent(resolveChatAgent(chat)?.name, BRAND_NAME));
    }

    const chatsWithoutScheduledSessions = filteredChats;

    const primaryChatConfig = chatsWithoutScheduledSessions.find(chat => chat.chat_id === primaryChat);
    const otherChats = chatsWithoutScheduledSessions.filter(chat => chat.chat_id !== primaryChat);

    // The chat matching primaryChat goes first; other chats maintain their original order
    return primaryChatConfig ? [primaryChatConfig, ...otherChats] : chatsWithoutScheduledSessions;
  }, [chats, primaryChat, excludeBuiltinAgents]);

  const starredSessions = React.useMemo(() => {
    if (!excludeBuiltinAgents) {
      return [] as StarredChatSessionIndexItem[];
    }

    const indexedStarredSessions = data?.profile?.['starred-chat-sessions'] || [];

    return indexedStarredSessions
      .filter((item: StarredChatSessionIndexItem, index: number, array: StarredChatSessionIndexItem[]) => array.findIndex((candidate: StarredChatSessionIndexItem) => candidate.chatSessionId === item.chatSessionId) === index)
      .sort((a: StarredChatSessionIndexItem, b: StarredChatSessionIndexItem) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
  }, [data?.profile, excludeBuiltinAgents]);

  const sessionItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Built-in scroll-load list: pagination latches (scroll container refs live in useOverlayScrollbar)
  const exhaustedBottomLatchRef = useRef<Map<string, boolean>>(new Map());
  const showAllLoadedHintTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Show the "all loaded" hint (debounced to avoid frequent triggers)
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

  // Built-in scroll-load list: load the next page when the user scrolls near the
  // bottom; latch the "all loaded" hint when there is nothing more to fetch.
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

  // Reveal SHOW_MORE_STEP additional sessions. If the new window exceeds the
  // sessions already loaded and the backend has more, fetch the next page first.
  const handleShowMore = useCallback(async (chatId: string) => {
    const state = paginatedChatSessions.get(chatId);
    if (!state || state.isLoading) {
      return;
    }

    const loadedCount = getNonScheduledSessions(state.sessions).length;
    const targetVisible = state.visibleCount + SHOW_MORE_STEP;

    if (targetVisible > loadedCount && state.hasMore) {
      await loadMoreChatSessions(chatId);
    }

    setPaginatedChatSessions((prev) => {
      const newMap = new Map(prev);
      const existing = newMap.get(chatId);
      if (existing) {
        newMap.set(chatId, {
          ...existing,
          visibleCount: existing.visibleCount + SHOW_MORE_STEP,
        });
      }
      return newMap;
    });
  }, [loadMoreChatSessions, paginatedChatSessions]);

  // Collapse the list back to the initial window (8 + "Show more").
  const handleShowLess = useCallback((chatId: string) => {
    setPaginatedChatSessions((prev) => {
      const existing = prev.get(chatId);
      if (!existing || existing.visibleCount === INITIAL_VISIBLE_COUNT) {
        return prev;
      }
      const newMap = new Map(prev);
      newMap.set(chatId, { ...existing, visibleCount: INITIAL_VISIBLE_COUNT });
      return newMap;
    });
  }, []);

  useEffect(() => {
    expandedAgentIds.forEach((chatId) => {
      void loadInitialChatSessions(chatId);
    });
  }, [expandedAgentIds, loadInitialChatSessions]);

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

    expandAgent(currentChatId);

    const resolvedSession = resolveSessionForChat(currentChatId, currentChatSessionId);
    if (resolvedSession) {
      ensureSessionPresentInPaginatedState(currentChatId, resolvedSession);
    }
  }, [
    activeView,
    currentChatId,
    currentChatSessionId,
    ensureSessionPresentInPaginatedState,
    expandAgent,
    resolveSessionForChat,
  ]);

  useEffect(() => {
    const pendingTarget = pendingSessionScrollTarget;

    if (!pendingTarget || !expandedAgentIds.has(pendingTarget.chatId)) {
      return;
    }

    // Make sure the target session falls inside the visible window; otherwise it
    // is sliced out and never rendered, so scrollIntoView can never resolve it.
    const targetState = paginatedChatSessions.get(pendingTarget.chatId);
    if (targetState?.hasLoaded) {
      const orderedSessions = sortSessionsByTimeDesc(getNonScheduledSessions(targetState.sessions));
      const targetIndex = orderedSessions.findIndex(
        (session) => session.chatSession_id === pendingTarget.sessionId,
      );

      if (targetIndex >= 0 && targetIndex >= targetState.visibleCount) {
        setPaginatedChatSessions((prev) => {
          const existing = prev.get(pendingTarget.chatId);
          if (!existing || targetIndex < existing.visibleCount) {
            return prev;
          }
          const newMap = new Map(prev);
          newMap.set(pendingTarget.chatId, {
            ...existing,
            visibleCount: targetIndex + 1,
          });
          return newMap;
        });
        return;
      }
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
  }, [ensureSessionVisible, expandedAgentIds, paginatedChatSessions, pendingSessionScrollTarget]);

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

      // Built-in scroll-load list: keep the newest session in view at the top.
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '0px',
        gap: '8px',
        width: '100%',
        position: 'relative',
        ...(showSearch ? { height: '100%' } : {}),
      }}
    >
      {showSearch && (
        <AgentListSearchHeader
          isSearchMode={isSearchMode}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchInputRef={searchInputRef}
          handleSearchInputKeyDown={handleSearchInputKeyDown}
          handleSearchFocus={handleSearchFocus}
          handleSearchBlur={handleSearchBlur}
          selectedAgentFilter={selectedAgentFilter}
          clearSelectedAgentFilter={clearSelectedAgentFilter}
          showAgentSearchHint={showAgentSearchHint}
          isMentionPickerOpen={isMentionPickerOpen}
          mentionPickerRef={mentionPickerRef}
          mentionSuggestions={mentionSuggestions}
          activeMentionIndex={activeMentionIndex}
          setActiveMentionIndex={setActiveMentionIndex}
          applyMentionSuggestion={applyMentionSuggestion}
          mentionOptionRefs={mentionOptionRefs}
        />
      )}

      <div
        style={
          showSearch
            ? {
                position: 'relative',
                flex: 1,
                minHeight: 0,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
              }
            : { display: 'contents' }
        }
        onMouseEnter={showSearch ? () => handleSessionListMouseEnter(AGENT_LIST_SCROLLBAR_KEY) : undefined}
        onMouseLeave={showSearch ? () => handleSessionListMouseLeave(AGENT_LIST_SCROLLBAR_KEY) : undefined}
      >
      <div
        ref={
          showSearch
            ? (el) => {
                if (el) {
                  scrollContainerRefs.current.set(AGENT_LIST_SCROLLBAR_KEY, el);
                } else {
                  scrollContainerRefs.current.delete(AGENT_LIST_SCROLLBAR_KEY);
                }
              }
            : undefined
        }
        onScroll={showSearch ? () => updateScrollbar(AGENT_LIST_SCROLLBAR_KEY, true) : undefined}
        className={showSearch ? 'agent-list-scroll-viewport' : undefined}
        style={
          showSearch
            ? {
                flex: 1,
                minHeight: 0,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '8px',
                // Small right gutter so the overlay scrollbar thumb sits flush
                // against the navigation boundary instead of over the content.
                paddingRight: '6px',
                overflowY: 'auto',
                overflowX: 'hidden',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }
            : { display: 'contents' }
        }
      >

      {chats.length === 0 ? (
        <div>
          <p>{t('agent.list.noChats')}</p>
          <p>{t('agent.list.createFirstChat')}</p>
        </div>
      ) : isSearchMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          {searchResults.length === 0 ? (
            <div
              style={{
                padding: '16px 12px',
                borderRadius: '16px',
                backgroundColor: 'var(--color-warm-100)',
                color: 'var(--color-neutral-500)',
                fontSize: '13px',
                lineHeight: 1.5,
              }}
            >
              <div style={{ color: 'var(--color-warm-900)', fontWeight: 600, marginBottom: '4px' }}>
                {searchLoadingChatIds.size > 0 ? t('agent.list.indexing') : t('agent.list.noConversationsFound')}
              </div>
              <div>
                {searchLoadingChatIds.size > 0
                  ? t('agent.list.loadingMetadata')
                  : t('agent.list.trySearchHint')}
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
                      border: isActiveResult ? '1px solid var(--color-warm-900)' : '1px solid transparent',
                      background: isCurrentSession ? 'var(--color-warm-200)' : isActiveResult ? 'var(--color-warm-100)' : 'var(--color-warm-100)',
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
                          color: 'var(--color-warm-900)',
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
                            backgroundColor: 'var(--color-danger-700)',
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
                      <span style={{ fontSize: '12px', color: 'var(--color-neutral-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {result.agentName}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--color-neutral-400)' }}>•</span>
                      <span style={{ fontSize: '12px', color: 'var(--color-neutral-500)' }}>{getRelativeTimeLabel(result.lastUpdated)}</span>
                    </div>
                  </button>
                );
              })}

              {searchResults.length >= 50 && (
                <div style={{ fontSize: '12px', color: 'var(--color-neutral-500)', padding: '0 4px' }}>
                  {t('agent.list.showingTopResults')}
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
                  color: 'var(--color-neutral-500)',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                }}
              >
                <span>{t('agent.list.starred')}</span>
              </div>

              {starredSessions.map((session: StarredChatSessionIndexItem) => {
                const isActiveSession = currentChatSessionId === session.chatSessionId;
                const isUnreadSession = session.readStatus !== 'read' && !isActiveSession;
                const sessionTitleColor = isUnreadSession ? 'var(--color-warm-900)' : 'var(--color-neutral-500)';
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
                        title={t('agent.list.moreOptions')}
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
                color: 'var(--color-neutral-500)',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              <span>{t('agent.list.agentsSection')}</span>
            </div>
          )}

          {sortedChats.map((chat) => {
            const agent = resolveChatAgent(chat);
            // Determine if this is a built-in agent.
            const isBuiltinAgentFlag = isBuiltinAgent(agent?.name, BRAND_NAME);
            const agentName = agent?.name || 'Unnamed Agent';
            const paginatedState = paginatedChatSessions.get(chat.chat_id) || getDefaultPaginatedState();
            const inlineChatSessions = getNonScheduledSessions(chat.chatSessions || []);
            const loadedChatSessions = sortSessionsByTimeDesc(
              paginatedState.hasLoaded
                ? getNonScheduledSessions(paginatedState.sessions)
                : inlineChatSessions,
            );
            // Only the first `visibleCount` sessions are rendered; the rest are
            // revealed via the "Show more" button (no inner scroll / max-height).
            const shownChatSessions = loadedChatSessions.slice(0, paginatedState.visibleCount);
            const totalLoadedCount = loadedChatSessions.length;
            const allSessionsShown =
              !paginatedState.hasMore && paginatedState.visibleCount >= totalLoadedCount;
            const showMoreButton = totalLoadedCount > 0 && !allSessionsShown;
            const showLessButton = allSessionsShown && totalLoadedCount > INITIAL_VISIBLE_COUNT;
            // Built-in agents keep the original fixed-height scroll-load list and render
            // every loaded session; regular agents render only the Show more/less window.
            const sessionsToRender = isBuiltinAgentFlag ? loadedChatSessions : shownChatSessions;
            const isExpandedAgent = expandedAgentIds.has(chat.chat_id);
            const shouldBoldAgentName = unreadHighlightChatIds.has(chat.chat_id) && !isExpandedAgent;

            return (
              <div key={chat.chat_id} style={{ width: '100%' }}>
              <NavItem
                icon={
                  <AgentAvatar
                    emoji={agent?.emoji}
                    avatar={agent?.avatar}
                    source={agent?.source}
                    name={agent?.name}
                    size="sm"
                    version={agent?.version}
                  />
                }
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: shouldBoldAgentName ? 700 : 400 }}>
                    {agentName}
                    {isBuiltinAgentFlag && (
                      <span className="kobi-builtin-badge">{t('agent.list.builtinBadge')}</span>
                    )}
                  </span>
                }
                ariaLabel={agentName}
                isActive={
                  (activeView === 'chat' || activeView === 'settings') &&
                  chat.chat_id === currentChatId &&
                  (activeView === 'settings' || !currentChatSessionId || !loadedChatSessions.some(s => s.chatSession_id === currentChatSessionId))
                } // 🔥 Agent selected condition: (in chat or settings view) AND is current Agent AND (in settings view OR no session selected OR selected session not in list)
                onClick={() => handleToggleAgentExpand(chat.chat_id)}
                rightContent={
                  agent ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      {/* 🔥 Added: Start New Conversation button */}
                      <div
                        className="dropdown-menu-container"
                        style={{
                          opacity: currentChatSessionId && loadedChatSessions.some(s => s.chatSession_id === currentChatSessionId) ? 1 : 0,
                          transition: 'opacity 0.2s ease-in-out'
                        }}
                      >
                        <div
                          className="dropdown-menu-trigger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartNewChat(chat.chat_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              handleStartNewChat(chat.chat_id);
                            }
                          }}
                          title={t('agent.list.startNewConversation')}
                          aria-label={t('agent.list.startNewConversation')}
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer' }}
                        >
                          <StartNewConversationIcon />
                        </div>
                      </div>

                      {/* More options button */}
                      <div className="dropdown-menu-container" style={{
                        opacity: currentChatSessionId && loadedChatSessions.some(s => s.chatSession_id === currentChatSessionId) ? 1 : 0,
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
                          title={t('agent.list.moreOptions')}
                          aria-label={t('agent.list.moreOptions')}
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
              {expandedAgentIds.has(chat.chat_id) && (
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => { if (isBuiltinAgentFlag) handleSessionListMouseEnter(chat.chat_id); }}
                  onMouseLeave={() => { if (isBuiltinAgentFlag) handleSessionListMouseLeave(chat.chat_id); }}
                >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    paddingLeft: '0px',
                    paddingTop: '4px',
                    paddingBottom: '4px',
                    ...(isBuiltinAgentFlag ? {
                      maxHeight: 'calc(5 * (40px + 4px))', // Height for 5 items: item height 40px + gap 4px
                      overflowY: 'auto' as const,
                      scrollbarWidth: 'none' as const,
                      msOverflowStyle: 'none' as React.CSSProperties['msOverflowStyle'],
                    } : {}),
                  }}
                  className="chat-sessions-list"
                  onScroll={(e) => {
                    if (!isBuiltinAgentFlag) {
                      return;
                    }
                    handleScroll(chat.chat_id, e);
                    updateScrollbar(chat.chat_id, true);
                  }}
                  ref={(el) => {
                    if (!isBuiltinAgentFlag) {
                      return;
                    }
                    if (el) {
                      scrollContainerRefs.current.set(chat.chat_id, el);
                    } else {
                      scrollContainerRefs.current.delete(chat.chat_id);
                    }
                  }}
                >
                  {sessionsToRender
                    .map((session) => {
                      const isActiveSession = currentChatSessionId === session.chatSession_id;
                      const isUnreadSession = session.readStatus !== 'read' && !isActiveSession;
                      const sessionTitleColor = isUnreadSession ? 'var(--color-warm-900)' : 'var(--color-neutral-500)';
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
                            title={t('agent.list.moreOptions')}
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
                      color: 'var(--color-danger-700)',
                      fontSize: '12px',
                      textAlign: 'center'
                    }}>
                      {paginatedState.error}
                    </div>
                  )}

                  {!paginatedState.isLoading && paginatedState.hasLoaded && totalLoadedCount === 0 && !paginatedState.error && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: 'var(--color-neutral-400)',
                      fontSize: '12px'
                    }}>
                      {t('agent.list.noConversationsYet')}
                    </div>
                  )}

                  {/* Added: loading indicator while fetching the next page */}
                  {paginatedState.isLoading && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: 'var(--color-neutral-500)',
                      fontSize: '13px'
                    }}>
                      <LoadingIcon />
                      <span style={{ marginLeft: '8px' }}>{t('agent.list.loading')}</span>
                    </div>
                  )}

                  {/* Built-in scroll-load list: transient "all conversations loaded" hint */}
                  {isBuiltinAgentFlag && showAllLoadedHint.get(chat.chat_id) && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px',
                      color: 'var(--color-neutral-400)',
                      fontSize: '12px'
                    }}>
                      {t('agent.list.allConversationsLoaded')}
                    </div>
                  )}

                  {/* Regular agents: Show more / Show less toggle (replaces scroll-to-load) */}
                  {!isBuiltinAgentFlag && !paginatedState.isLoading && !paginatedState.error && showMoreButton && (
                    <div
                      className="chat-sessions-show-more"
                      role="button"
                      tabIndex={0}
                      aria-label={t('agent.list.showMoreConversations')}
                      onClick={() => { void handleShowMore(chat.chat_id); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleShowMore(chat.chat_id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '8px',
                        color: 'var(--color-neutral-500)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {t('agent.list.showMore')}
                    </div>
                  )}

                  {!isBuiltinAgentFlag && !paginatedState.isLoading && !paginatedState.error && showLessButton && (
                    <div
                      className="chat-sessions-show-less"
                      role="button"
                      tabIndex={0}
                      aria-label={t('agent.list.showFewerConversations')}
                      onClick={() => handleShowLess(chat.chat_id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleShowLess(chat.chat_id);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '8px',
                        color: 'var(--color-neutral-500)',
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {t('agent.list.showLess')}
                    </div>
                  )}
                </div>
                {/* Built-in scroll-load list: custom overlay scrollbar */}
                {isBuiltinAgentFlag && (() => {
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
      {showSearch && (() => {
        const sb = scrollbarState.get(AGENT_LIST_SCROLLBAR_KEY);
        const container = scrollContainerRefs.current.get(AGENT_LIST_SCROLLBAR_KEY);
        const needsScroll = container ? container.scrollHeight > container.clientHeight : false;
        if (!sb || !needsScroll) return null;
        return (
          <div
            style={{
              position: 'absolute',
              right: 2,
              top: sb.thumbTop,
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
    </div>
  );
};

export default AgentList;