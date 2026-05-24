import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, MoreHorizontal, X, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import '../../styles/Sidepane.css';
import '../../styles/WorkspaceExplorerSidepane.css';
import '../../styles/DropdownMenu.css';
import { useAuthContext } from '../auth/AuthProvider';
import { ChatSession } from '../../lib/userData/types';
import {
  useCurrentChatId,
  useCurrentChatSessionId,
} from '../../lib/chat/agentChatSessionCacheManager';
import { useProfileData } from '../userData/userDataProvider';
import { getScheduledSessionDisplayState } from './SchedulesSidepane.utils';
import { ChatSessionMenuAtom } from '../menu/ChatSessionDropdownMenu';
import { ScheduleSidepaneAtom } from './chat-side.atom';

interface SchedulesSidepaneProps {
  onSelectSession?: (sessionId: string) => void | Promise<void>;
}

const PAGE_SIZE = 100;
const SCROLL_THRESHOLD_PX = 80;

const isScheduledSession = (
  session: Partial<ChatSession> | null | undefined,
): session is ChatSession => {
  return !!session?.schedulerJobId && session.schedulerJobId.trim().length > 0;
};

const sortSessionsByTimeDesc = (sessions: ChatSession[]): ChatSession[] => {
  return [...sessions].sort(
    (a, b) =>
      new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime(),
  );
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

const formatTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ExecutingIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      animation: 'spin 1s linear infinite',
      display: 'block',
    }}
  >
    <circle cx="10" cy="10" r="9" stroke="black" strokeOpacity="0.15" strokeWidth="2" />
    <path
      d="M19 10C19 12.3869 18.0518 14.6761 16.364 16.364C14.6761 18.0518 12.387 19 10 19"
      stroke="#272320"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const CompletedIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <path
      d="M0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10Z"
      fill="#272320"
    />
    <mask
      id="schedule-sidepane-completed-icon-mask"
      style={{ maskType: 'alpha' }}
      maskUnits="userSpaceOnUse"
      x="4"
      y="4"
      width="12"
      height="12"
    >
      <path
        d="M13.765 7.20474C14.0661 7.48915 14.0797 7.96383 13.7953 8.26497L9.54526 12.765C9.40613 12.9123 9.21332 12.997 9.01071 12.9999C8.8081 13.0028 8.61295 12.9236 8.46967 12.7803L6.21967 10.5303C5.92678 10.2374 5.92678 9.76257 6.21967 9.46967C6.51256 9.17678 6.98744 9.17678 7.28033 9.46967L8.98463 11.174L12.7047 7.23503C12.9891 6.9339 13.4638 6.92033 13.765 7.20474Z"
        fill="#242424"
      />
    </mask>
    <g mask="url(#schedule-sidepane-completed-icon-mask)">
      <rect width="12" height="12" transform="translate(4 4)" fill="#E2DDD9" />
    </g>
  </svg>
);

const InterruptedIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: 'block' }}
  >
    <circle cx="10" cy="10" r="9" fill="#FEF2F2" stroke="#DC2626" strokeWidth="2" />
    <path
      d="M10 5.75V10.25"
      stroke="#B91C1C"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <circle cx="10" cy="13.5" r="1" fill="#B91C1C" />
  </svg>
);

const SchedulesSidepane: React.FC<SchedulesSidepaneProps> = ({
  onSelectSession,
}) => {
  const [isVisible, { hide: onClose }] = ScheduleSidepaneAtom.use();
  const [{ isOpen: chatSessionMenuIsOpen, sessionId: chatSessionMenuSessionId }, chatSessionMenuActions] = ChatSessionMenuAtom.use();
  const openMenuChatSessionId = chatSessionMenuIsOpen ? chatSessionMenuSessionId : null;
  const { user } = useAuthContext();
  const userAlias = user?.login;
  const currentChatId = useCurrentChatId();
  const currentChatSessionId = useCurrentChatSessionId();
  const { chats } = useProfileData();
  const navigate = useNavigate();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextMonthIndex, setNextMonthIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAllLoadedHint, setShowAllLoadedHint] = useState(false);

  const loadingRef = useRef(false);
  const showAllLoadedHintTimerRef = useRef<NodeJS.Timeout | null>(null);
  const exhaustedBottomLatchRef = useRef(false);

  const scheduledSessionsFromCache = useMemo(() => {
    if (!currentChatId) {
      return [];
    }

    const currentChat = chats.find((chat) => chat.chat_id === currentChatId);
    return sortSessionsByTimeDesc(
      (currentChat?.chatSessions || []).filter(isScheduledSession),
    );
  }, [chats, currentChatId]);

  const displaySessions = useMemo(
    () => mergeSessions(sessions, scheduledSessionsFromCache),
    [sessions, scheduledSessionsFromCache],
  );

  const triggerAllLoadedHint = useCallback(() => {
    if (showAllLoadedHint) {
      return;
    }

    setShowAllLoadedHint(true);

    if (showAllLoadedHintTimerRef.current) {
      clearTimeout(showAllLoadedHintTimerRef.current);
    }

    showAllLoadedHintTimerRef.current = setTimeout(() => {
      setShowAllLoadedHint(false);
      showAllLoadedHintTimerRef.current = null;
    }, 800);
  }, [showAllLoadedHint]);

  const loadInitialSessions = useCallback(async () => {
    if (!userAlias || !currentChatId || !window.electronAPI?.profile) {
      setSessions([]);
      setHasMore(false);
      setNextMonthIndex(0);
      return;
    }

    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const initialResult = await window.electronAPI.profile.getChatSessions(
        userAlias,
        currentChatId,
      );

      if (!initialResult?.success || !initialResult.data) {
        throw new Error(initialResult?.error || 'Failed to load scheduled sessions');
      }

      let collected = (initialResult.data.sessions || []).filter(isScheduledSession);
      let currentNextMonthIndex = initialResult.data.nextMonthIndex || 0;
      let currentHasMore = Boolean(initialResult.data.hasMore);

      while (currentHasMore && collected.length < PAGE_SIZE) {
        const moreResult = await window.electronAPI.profile.getMoreChatSessions(
          userAlias,
          currentChatId,
          currentNextMonthIndex,
        );

        if (!moreResult?.success || !moreResult.data) {
          throw new Error(moreResult?.error || 'Failed to load more scheduled sessions');
        }

        collected = collected.concat(
          (moreResult.data.sessions || []).filter(isScheduledSession),
        );
        currentNextMonthIndex = moreResult.data.nextMonthIndex || 0;
        currentHasMore = Boolean(moreResult.data.hasMore);
      }

      setSessions(sortSessionsByTimeDesc(collected));
      setNextMonthIndex(currentNextMonthIndex);
      setHasMore(currentHasMore);
    } catch (loadError) {
      setSessions([]);
      setHasMore(false);
      setNextMonthIndex(0);
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load scheduled sessions',
      );
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [userAlias, currentChatId]);

  const loadMoreSessions = useCallback(async () => {
    if (
      !isVisible ||
      !userAlias ||
      !currentChatId ||
      loadingRef.current ||
      !window.electronAPI?.profile
    ) {
      return;
    }

    if (!hasMore) {
      triggerAllLoadedHint();
      return;
    }

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      let collected: ChatSession[] = [];
      let currentNextMonthIndex = nextMonthIndex;
      let currentHasMore: boolean = hasMore;

      while (currentHasMore && collected.length < PAGE_SIZE) {
        const moreResult = await window.electronAPI.profile.getMoreChatSessions(
          userAlias,
          currentChatId,
          currentNextMonthIndex,
        );

        if (!moreResult?.success || !moreResult.data) {
          throw new Error(moreResult?.error || 'Failed to load more scheduled sessions');
        }

        collected = collected.concat(
          (moreResult.data.sessions || []).filter(isScheduledSession),
        );
        currentNextMonthIndex = moreResult.data.nextMonthIndex || 0;
        currentHasMore = Boolean(moreResult.data.hasMore);
      }

      setSessions((prev) => mergeSessions(prev, collected));
      setNextMonthIndex(currentNextMonthIndex);
      setHasMore(currentHasMore);

      if (!currentHasMore) {
        triggerAllLoadedHint();
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load more scheduled sessions',
      );
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [isVisible, userAlias, currentChatId, hasMore, nextMonthIndex, triggerAllLoadedHint]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    loadInitialSessions();
  }, [isVisible, loadInitialSessions]);

  useEffect(() => {
    return () => {
      if (showAllLoadedHintTimerRef.current) {
        clearTimeout(showAllLoadedHintTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      !isVisible ||
      !userAlias ||
      !currentChatId ||
      !window.electronAPI?.profile?.onChatSessionStoreSessionCreated ||
      !window.electronAPI?.profile?.onChatSessionStoreMetadataPatched ||
      !window.electronAPI?.profile?.onChatSessionStoreSessionDeleted
    ) {
      return;
    }

    const unsubscribeCreated = window.electronAPI.profile.onChatSessionStoreSessionCreated((data) => {
      if (data.alias !== userAlias || data.chatId !== currentChatId) {
        return;
      }

      if (!isScheduledSession(data.session)) {
        return;
      }

      setSessions((prev) => mergeSessions(prev, [data.session]));
    });

    const unsubscribeMetadataPatched = window.electronAPI.profile.onChatSessionStoreMetadataPatched((data) => {
      if (data.alias !== userAlias || data.chatId !== currentChatId) {
        return;
      }

      if (!isScheduledSession(data.metadata)) {
        setSessions((prev) => prev.filter((session) => session.chatSession_id !== data.chatSessionId));
        return;
      }

      setSessions((prev) => mergeSessions(prev, [data.metadata]));
    });

    const unsubscribeDeleted = window.electronAPI.profile.onChatSessionStoreSessionDeleted((data) => {
      if (data.alias !== userAlias || data.chatId !== currentChatId) {
        return;
      }

      setSessions((prev) => prev.filter((session) => session.chatSession_id !== data.chatSessionId));
    });

    return () => {
      unsubscribeCreated();
      unsubscribeMetadataPatched();
      unsubscribeDeleted();
    };
  }, [isVisible, userAlias, currentChatId]);

  useEffect(() => {
    if (
      !isVisible ||
      !userAlias ||
      !currentChatId ||
      !window.electronAPI?.profile?.onAutoSelectChatSession
    ) {
      return;
    }

    return window.electronAPI.profile.onAutoSelectChatSession((data) => {
      if (data.alias !== userAlias || data.chatId !== currentChatId) {
        return;
      }

      void loadInitialSessions();
    });
  }, [isVisible, userAlias, currentChatId, loadInitialSessions]);

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (isLoading) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
      const isNearBottom = scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD_PX;

      if (!hasMore) {
        if (!isNearBottom) {
          exhaustedBottomLatchRef.current = false;
          return;
        }

        if (!exhaustedBottomLatchRef.current) {
          exhaustedBottomLatchRef.current = true;
          triggerAllLoadedHint();
        }
        return;
      }

      if (!isNearBottom) {
        exhaustedBottomLatchRef.current = false;
        return;
      }

      loadMoreSessions();
    },
    [hasMore, isLoading, loadMoreSessions, triggerAllLoadedHint],
  );

  if (!isVisible) {
    return null;
  }

  return (
    <div className="chat-sidepane">
      <div className="file-explorer-section schedule-sidepane-section">
        <div className="sidepane-section-header" style={{ cursor: 'default' }}>
          <div className="sidepane-section-header-title">
            <AlarmClock size={16} color="#374151" />
            <span className="sidepane-section-title-text">Scheduled runs</span>
          </div>
          <div className="sidepane-section-header-actions">
            <button
              className="data-sources-configure-btn"
              onClick={() => {
                if (currentChatId) {
                  navigate(`/agent/chat/${currentChatId}/settings/schedules`);
                }
              }}
              title="Manage Schedules"
              aria-label="Manage Schedules"
              type="button"
            >
              <Settings size={14} />
            </button>
            <button
              className="sidepane-close-btn"
              onClick={onClose}
              title="Close schedules"
              aria-label="Close schedules"
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div className="sidepane-body" onScroll={handleScroll}>
          {error && (
            <div className="empty-state">
              <p>Failed to load scheduled runs</p>
              <small>{error}</small>
            </div>
          )}

          {!error && displaySessions.length === 0 && isLoading && (
            <div className="loading-state">
              <AlarmClock className="loading-spinner" size={32} />
              <p>Loading scheduled runs</p>
            </div>
          )}

          {!error && displaySessions.length === 0 && !isLoading && (
            <div className="empty-state">
              <AlarmClock className="empty-icon" size={32} />
              <p>No scheduled runs yet</p>
              <small>Triggered scheduled runs will appear here.</small>
            </div>
          )}

          {displaySessions.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '8px 0',
              }}
            >
              {displaySessions.map((session) => {
                const isActive = currentChatSessionId === session.chatSession_id;
                const executionState = getScheduledSessionDisplayState(session);
                const isExecuting = executionState === 'running';
                const isFailed = executionState === 'failed';
                const isInterrupted = executionState === 'interrupted';
                const isUnread = session.readStatus !== 'read' && !isActive;
                const titleColor = isUnread ? '#272320' : '#6C6C70';
                const titleFontWeight = isUnread ? 600 : 410;

                return (
                  <button
                    key={session.chatSession_id}
                    type="button"
                    onClick={() => {
                      onSelectSession?.(session.chatSession_id);
                    }}
                    title={session.title}
                    className={openMenuChatSessionId === session.chatSession_id ? 'chat-session-item menu-open' : 'chat-session-item'}
                    style={{
                      width: '100%',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '12px',
                      background: isActive ? 'rgba(0, 0, 0, 0.06)' : '#FFFFFF',
                      cursor: 'pointer',
                      opacity: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '6px',
                      boxSizing: 'border-box',
                      textAlign: 'left',
                      position: 'relative',
                    }}
                    data-read-status={session.readStatus || 'read'}
                    onMouseEnter={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
                      }
                      const moreBtn = event.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                      if (moreBtn) {
                        moreBtn.style.opacity = '1';
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!isActive) {
                        event.currentTarget.style.backgroundColor = '#FFFFFF';
                      }
                      if (openMenuChatSessionId !== session.chatSession_id) {
                        const moreBtn = event.currentTarget.querySelector('.chat-session-more-btn') as HTMLElement;
                        if (moreBtn) {
                          moreBtn.style.opacity = '0';
                        }
                      }
                    }}
                  >
                    <div
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <div
                        style={{
                          width: '20px',
                          height: '20px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isExecuting ? <ExecutingIcon /> : isInterrupted ? <InterruptedIcon /> : <CompletedIcon />}
                      </div>
                      <span
                        style={{
                          minWidth: 0,
                          flex: 1,
                          fontSize: '14px',
                          fontWeight: titleFontWeight,
                          color: titleColor,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {session.title}
                      </span>
                      <div
                        className="chat-session-more-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (currentChatId) {
                            const trigger = event.currentTarget as HTMLDivElement;
                            trigger.dataset.chatSessionMenuSource = 'schedule';
                            chatSessionMenuActions.toggle(
                              currentChatId,
                              session.chatSession_id,
                              session.title,
                              trigger,
                            );
                          }
                        }}
                        style={{
                          opacity: openMenuChatSessionId === session.chatSession_id ? '1' : '0',
                          marginLeft: 'auto',
                        }}
                        title="More options"
                      >
                        <MoreHorizontal size={20} strokeWidth={1.5} />
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: '12px',
                        color: isFailed || isInterrupted ? '#B91C1C' : isUnread ? '#374151' : '#6B7280',
                        paddingLeft: '28px',
                        fontWeight: isUnread ? 600 : 400,
                      }}
                    >
                      {isExecuting
                        ? formatTime(session.last_updated)
                        : isInterrupted
                          ? `Interrupted${session.schedulerCompletedAt ? ` · ${formatTime(session.schedulerCompletedAt)}` : ''}`
                        : isFailed
                          ? `Failed${session.schedulerError ? ` · ${session.schedulerError}` : ''}`
                          : formatTime(session.last_updated)}
                    </span>
                  </button>
                );
              })}

              {isLoading && (
                <div className="loading-state" style={{ padding: '20px 12px' }}>
                  <AlarmClock className="loading-spinner" size={24} />
                  <p>Loading more</p>
                </div>
              )}

              {showAllLoadedHint && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px 12px',
                    color: '#9E9E9E',
                    fontSize: '12px',
                  }}
                >
                  All scheduled runs loaded
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SchedulesSidepane;
