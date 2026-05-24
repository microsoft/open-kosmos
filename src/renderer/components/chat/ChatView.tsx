import React, { useCallback, memo, useMemo, useEffect, useRef } from 'react';
import {
  useParams,
  useNavigate,
  useLocation,
} from 'react-router-dom';

import ChatViewHeader from './ChatViewHeader';
import ChatViewContent from './ChatViewContent';
import { ContextMenu } from './chat-input/ContextMenu';
import { useAgentConfig } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import { useLayout } from '../layout/LayoutProvider';
import { CurrentSessionStatus, useHasChatSessionCache, agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { profileDataManager } from '../../lib/userData';
import { getPmAgentSayHiMessageConfig } from '../../lib/chat/pmAgentSayHi';
import { startNewChatFor } from '../../lib/chat/startNewChatFor';
import { createLogger } from '../../lib/utilities/logger';
import { ScheduleSidepaneAtom } from './chat-side.atom';
const logger = createLogger('[ChatView]');

const ChatView: React.FC = memo(() => {
  // 🔥 Route Synchronization
  const { chatId: routeChatId, sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const navigationState = (location.state as {
    selectedText?: string;
    intent?: 'new-chat' | 'open-session';
    source?: string;
    targetChatId?: string;
    targetSessionId?: string;
    openSchedulesSidepane?: boolean;
  } | null) ?? null;

  // Handle selectedText from navigation state
  useEffect(() => {
    if (navigationState?.selectedText) {
      // Dispatch event to fill input
      const fillInputEvent = new CustomEvent('agent:fillInput', {
        detail: { text: navigationState.selectedText },
      });
      window.dispatchEvent(fillInputEvent);

      // Clear state to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [navigationState, navigate, location.pathname]);

  // Get chatId and chatSessionId from agentChatSessionCacheManager
  const { chatId, chatSessionId, chatStatus } = CurrentSessionStatus.use();

  // On first render, if cache manager has no value, proactively fetch current session state from backend
  // Scenario: backend already sent currentChatSessionIdChanged event before frontend set up IPC listener
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;

    if (agentChatSessionCacheManager.getCurrentChatSessionId()) {
      return;
    }

    const fetchCurrentSession = async () => {
      try {
        if (window.electronAPI?.agentChat?.getCurrentChatSession) {
          const result = await window.electronAPI.agentChat.getCurrentChatSession();
          if (result.success && result.data?.chatId && result.data?.chatSessionId) {
            agentChatSessionCacheManager.setCurrentChatSessionId(result.data.chatId, result.data.chatSessionId);
          }
        }
      } catch (error) {
        logger.error('[ChatView] Failed to fetch current session:', error);
      }
    };

    setTimeout(fetchCurrentSession, 100);
  }, []);

  // We need to track the last processed route to avoid redundant updates
  const lastProcessedRouteRef = useRef<string>('');

  useEffect(() => {
    const syncRoute = async () => {
      const currentRouteKey = `${routeChatId}-${routeSessionId}`;
      const routeIntent = navigationState?.intent;
      const routeSource = navigationState?.source;

      // Case 1: Route has both IDs (Switch Session)
      if (routeChatId && routeSessionId) {
        // Update ref to ensure we can detect when we leave this route
        lastProcessedRouteRef.current = currentRouteKey;

        // Only switch if the session ID doesn't match the current one
        // AND we haven't just processed this route (to prevent loops)
        if (routeSessionId !== chatSessionId) {
          logger.debug('[ChatView] 🔄 Route changed, switching session:', {
            routeChatId,
            routeSessionId,
            routeIntent,
            routeSource,
          });
          if (window.electronAPI?.agentChat?.switchToChatSession) {
            await window.electronAPI.agentChat.switchToChatSession(
              routeChatId,
              routeSessionId,
            );
          }
        }

        return;
      }

      // Case 2: Route has only chatId
      if (routeChatId && !routeSessionId) {
        // Only explicit new-chat intent may create a new session.
        if (routeIntent !== 'new-chat') {
          logger.debug('[ChatView] ⏭️ Route has chatId only without new-chat intent, skipping auto-create:', {
            routeChatId,
            routeIntent,
            routeSource,
            chatSessionId,
          });
          return;
        }

        // Only trigger if we haven't just processed this intent
        if (lastProcessedRouteRef.current !== currentRouteKey) {
          logger.debug(
            '[ChatView] 🆕 Route has chatId only with explicit new-chat intent, starting new chat:',
            routeChatId,
          );
          lastProcessedRouteRef.current = currentRouteKey;

          const result = await startNewChatFor(
            routeChatId,
            getPmAgentSayHiMessageConfig(routeChatId),
          );
          if (result.success && result.chatSessionId) {
            logger.debug(
              '[ChatView] ✅ New chat started, redirecting to session:',
              result.chatSessionId,
            );
            // Replace URL with new session ID
            navigate(`/agent/chat/${routeChatId}/${result.chatSessionId}`, {
              replace: true,
              state: {
                ...navigationState,
                intent: 'open-session',
                targetChatId: routeChatId,
                targetSessionId: result.chatSessionId,
              },
            });
          }
        }
        return;
      }

      // Case 3: No IDs in route (Default view)
      if (!routeChatId && !routeSessionId) {
        // If we have a current session, redirect to it to keep URL in sync
        // Fix: get latest value directly from cache manager instead of potentially stale local state
        const cacheCurrentChatId = agentChatSessionCacheManager.getCurrentChatId();
        const cacheCurrentChatSessionId = agentChatSessionCacheManager.getCurrentChatSessionId();
        if (cacheCurrentChatId && cacheCurrentChatSessionId) {
          logger.debug(
            '[ChatView] 🔀 Default route, redirecting to current session:',
            { cacheCurrentChatId, cacheCurrentChatSessionId },
          );
          navigate(`/agent/chat/${cacheCurrentChatId}/${cacheCurrentChatSessionId}`, {
            replace: true,
          });
        }
      }
    };

    syncRoute();
  }, [routeChatId, routeSessionId, chatSessionId, navigate, navigationState]);

  // Minimal mode state for chat popup - now obtained from LayoutProvider
  const { isMinimalMode } = useLayout();
  const hasRouteSessionCache = useHasChatSessionCache(routeSessionId ?? null);

  const handleEditAgent = useCallback(
    (chatId: string, initialTab?: 'basic' | 'mcp' | 'prompt' | 'skills' | 'schedules') => {
      window.dispatchEvent(
        new CustomEvent('agent:editAgent', {
          detail: { chatId, initialTab },
        }),
      );
    },
    [],
  );

  const { showSuccess, showError } = useToast();
  const { agent: currentAgent } = useAgentConfig();

  const currentChat = chatId
    ? profileDataManager.getCurrentChat()
    : null;

  const isCurrentSessionScheduled = useMemo(() => {
    if (!currentChat?.chatSessions || !chatSessionId) {
      return false;
    }

    const currentSession = currentChat.chatSessions.find(
      (session) => session.chatSession_id === chatSessionId,
    );

    return !!currentSession?.schedulerJobId?.trim();
  }, [currentChat?.chatSessions, chatSessionId]);

  const scheduleSidepaneActions = ScheduleSidepaneAtom.useChange();
  useEffect(() => {
    if (!navigationState?.openSchedulesSidepane) {
      return;
    }

    if (!routeChatId || !routeSessionId) {
      return;
    }

    if (chatId !== routeChatId || chatSessionId !== routeSessionId) {
      return;
    }

    if (!isCurrentSessionScheduled) {
      return;
    }

    logger.debug('[ChatView] 📅 Opening SchedulesSidepane for scheduled ChatSession from navigation state', {
      routeChatId,
      routeSessionId,
      source: navigationState.source,
    });
    scheduleSidepaneActions.effectiveShow();

    navigate(location.pathname, {
      replace: true,
      state: {
        ...navigationState,
        openSchedulesSidepane: false,
      },
    });
  }, [
    navigationState,
    routeChatId,
    routeSessionId,
    chatId,
    chatSessionId,
    isCurrentSessionScheduled,
    navigate,
    location.pathname,
  ]);

  const isSessionSwitching = Boolean(
    routeSessionId && (chatSessionId !== routeSessionId || !hasRouteSessionCache)
  );

  // Get the current Agent's Zero States configuration
  const zeroStates = currentAgent?.zero_states;

  // Determine whether the current session is a remote session (read-only mode)
  const isRemoteSession = useMemo(() => {
    if (!currentChat?.chatSessions || !chatSessionId) return false;
    const session = currentChat.chatSessions.find(
      (s) => s.chatSession_id === chatSessionId
    );
    return session?.source?.type === 'remote';
  }, [currentChat?.chatSessions, chatSessionId]);

  // MCP Tools handler - must be defined after chatId
  const handleOpenMcpTools = useCallback(() => {
    if (chatId) {
      handleEditAgent(chatId, 'mcp');
    }
  }, [chatId, handleEditAgent]);

  // Skills handler - open editor and navigate to Skills tab
  const handleOpenSkills = useCallback(() => {
    if (chatId) {
      handleEditAgent(chatId, 'skills');
    }
  }, [chatId, handleEditAgent]);

  // Delete action is now event-triggered, with AppLayout handling the confirmation dialog

  // Handle fork chat session - uses the new backend IPC API
  const handleForkChatSession = useCallback(
    async (sessionId: string) => {
      if (!chatId) {
        showError('No current agent chat available');
        return;
      }

      try {
        // Call backend forkChatSession API
        // Backend will:
        // 1. Generate a new targetChatSessionId
        // 2. Copy ChatSession data (files and indexes) via chatSessionManager
        // 3. Switch to the new ChatSession (auto-creates AgentChat instance and notifies frontend)
        if (!window.electronAPI?.agentChat?.forkChatSession) {
          showError('Fork API not available');
          return;
        }

        const result = await window.electronAPI.agentChat.forkChatSession(
          chatId,
          sessionId,
        );

        if (!result.success) {
          showError(`Failed to fork session: ${result.error}`);
          return;
        }

        logger.debug('[ChatView] ✅ Fork ChatSession completed:', {
          chatId: chatId,
          sourceChatSessionId: sessionId,
          newChatSessionId: result.chatSessionId,
        });

        showSuccess('Session forked successfully, switched to new session');
      } catch (error) {
        showError(
          `Failed to fork session: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    },
    [chatId, showSuccess, showError],
  );

  // Handle session selection
  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      try {
        if (!chatId) {
          showError('Cannot switch chat session: current chat does not exist');
          return;
        }

        // Only update the route; let ChatView's route -> backend sync logic handle the switch uniformly.
        // Otherwise: sidepane switches to new session first, but URL stays on old session,
        // then syncRoute switches back per old route, making it look like nothing changed.
        if (chatSessionId === sessionId) {
          return;
        }

        logger.debug('[ChatView] 🔄 Navigating to scheduled ChatSession:', {
          chatId,
          chatSessionId,
          sessionId,
        });

        navigate(`/agent/chat/${chatId}/${sessionId}`);
      } catch (error) {
        showError('Failed to switch chat session');
      }
    },
    [showError, chatId, chatSessionId, navigate],
  );

  // Listen for chatSession:fork events
  useEffect(() => {
    const handleForkChatSessionEvent = (e: CustomEvent) => {
      const { sessionId } = e.detail;
      if (sessionId) {
        handleForkChatSession(sessionId);
      }
    };

    window.addEventListener(
      'chatSession:fork',
      handleForkChatSessionEvent as EventListener,
    );
    return () => {
      window.removeEventListener(
        'chatSession:fork',
        handleForkChatSessionEvent as EventListener,
      );
    };
  }, [handleForkChatSession]);

  return (
    <div className={`chat-view ${isMinimalMode ? 'minimal-mode' : ''}`}>
      <div className="chat-view-layout">
        {/* Chat Area */}
        <div className="chat-area">
          <ChatViewHeader
            onOpenMcpTools={handleOpenMcpTools}
            onOpenSkills={handleOpenSkills}
          />
          <ChatViewContent
            isSessionSwitching={isSessionSwitching}
            chatId={chatId}
            chatStatus={chatStatus}
            zeroStates={zeroStates}
            agentName={currentAgent?.name}
            onSelectScheduledSession={handleSessionSelect}
            isReadOnly={isRemoteSession}
          />
        </div>
      </div>
      <ContextMenu />
    </div>
  );
});

ChatView.displayName = 'ChatView';

export default ChatView;
