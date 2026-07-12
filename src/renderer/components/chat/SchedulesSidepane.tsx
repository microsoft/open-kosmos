import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, X, Settings } from 'lucide-react';
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
import { ChatSessionMenuAtom } from '../menu/ChatSessionDropdownMenu';
import { ScheduleSidepaneAtom } from './chat-side.atom';
import ScheduleSessionListItem from './ScheduleSessionListItem';
import { useI18n } from '../../lib/i18n/useI18n';

interface SchedulesSidepaneProps {
  onSelectSession?: (sessionId: string) => void | Promise<void>;
}

const PAGE_SIZE = 20;
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
  const navigate = useNavigate();
  const { t } = useI18n();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showAllLoadedHint, setShowAllLoadedHint] = useState(false);

  const loadingRef = useRef(false);
  const showAllLoadedHintTimerRef = useRef<NodeJS.Timeout | null>(null);
  const exhaustedBottomLatchRef = useRef(false);

  // Note: We no longer use scheduledSessionsFromCache from profile cache.
  // The sessions state is updated directly via:
  // 1. getAllScheduledSessions API (paginated)
  // 2. Real-time events (onChatSessionStoreSessionCreated, etc.)
  // This avoids loading all sessions from cache which defeats pagination.

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
      setTotal(0);
      return;
    }

    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.profile.getAllScheduledSessions(
        userAlias,
        currentChatId,
        { limit: PAGE_SIZE, offset: 0 },
      );

      if (!result?.success || !result.data) {
        throw new Error(result?.error || 'Failed to load scheduled sessions');
      }

      setSessions(result.data.sessions as ChatSession[]);
      setHasMore(result.data.hasMore);
      setTotal(result.data.total);
    } catch (loadError) {
      setSessions([]);
      setHasMore(false);
      setTotal(0);
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
      const result = await window.electronAPI.profile.getAllScheduledSessions(
        userAlias,
        currentChatId,
        { limit: PAGE_SIZE, offset: sessions.length },
      );

      if (!result?.success || !result.data) {
        throw new Error(result?.error || 'Failed to load more scheduled sessions');
      }

      setSessions((prev) => [...prev, ...(result.data!.sessions as ChatSession[])]);
      setHasMore(result.data.hasMore);
      setTotal(result.data.total);

      if (!result.data.hasMore) {
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
  }, [isVisible, userAlias, currentChatId, hasMore, sessions.length, triggerAllLoadedHint]);

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
            <AlarmClock size={16} color="var(--color-neutral-700)" />
            <span className="sidepane-section-title-text">{t('sidepane.schedules.title')}</span>
          </div>
          <div className="sidepane-section-header-actions">
            <button
              className="data-sources-configure-btn"
              onClick={() => {
                if (currentChatId) {
                  navigate(`/agent/chat/${currentChatId}/settings/schedules`);
                }
              }}
              title={t('sidepane.schedules.manage')}
              aria-label={t('sidepane.schedules.manage')}
              type="button"
            >
              <Settings size={14} />
            </button>
            <button
              className="sidepane-close-btn"
              onClick={onClose}
              title={t('sidepane.schedules.close')}
              aria-label={t('sidepane.schedules.close')}
              type="button"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div className="sidepane-body" onScroll={handleScroll}>
          {error && (
            <div className="empty-state">
              <p>{t('sidepane.schedules.loadFailed')}</p>
              <small>{error}</small>
            </div>
          )}

          {!error && sessions.length === 0 && isLoading && (
            <div className="loading-state">
              <AlarmClock className="loading-spinner" size={32} />
              <p>{t('sidepane.schedules.loading')}</p>
            </div>
          )}

          {!error && sessions.length === 0 && !isLoading && (
            <div className="empty-state">
              <AlarmClock className="empty-icon" size={32} />
              <p>{t('sidepane.schedules.empty')}</p>
              <small>{t('sidepane.schedules.emptyDescription')}</small>
            </div>
          )}

          {sessions.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '8px 0',
              }}
            >
              {sessions.map((session) => {
                const isActive = currentChatSessionId === session.chatSession_id;
                const isUnread = session.readStatus !== 'read' && !isActive;

                return (
                  <ScheduleSessionListItem
                    key={session.chatSession_id}
                    session={session}
                    isActive={isActive}
                    isUnread={isUnread}
                    isMenuOpen={openMenuChatSessionId === session.chatSession_id}
                    onSelectSession={onSelectSession}
                    onOpenMenu={(selectedSession, trigger) => {
                      if (!currentChatId) {
                        return;
                      }
                      trigger.dataset.chatSessionMenuSource = 'schedule';
                      chatSessionMenuActions.toggle(
                        currentChatId,
                        selectedSession.chatSession_id,
                        selectedSession.title,
                        trigger,
                      );
                    }}
                  />
                );
              })}

              {isLoading && (
                <div className="loading-state" style={{ padding: '20px 12px' }}>
                  <AlarmClock className="loading-spinner" size={24} />
                  <p>{t('settings.schedules.loadingMore')}</p>
                </div>
              )}

              {showAllLoadedHint && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px 12px',
                    color: 'var(--color-neutral-400)',
                    fontSize: '12px',
                  }}
                >
                  {t('settings.schedules.allLoaded')}
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
