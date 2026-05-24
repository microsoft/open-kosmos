import React, { useMemo, useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AgentList from '../chat/agent-area/AgentList';
import { useProfileData } from '../userData/userDataProvider';
import NavItem from '../ui/navigation/NavItem';
import Divider from '../ui/Divider';
import { useToast } from '../ui/ToastProvider';
import { agentChatSessionCacheManager } from '../../lib/chat/agentChatSessionCacheManager';
import { isBuiltinAgent } from '../../lib/userData/types';
import { BRAND_NAME } from '@shared/constants/branding'; // used in isBuiltinAgent calls

const PlusIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <mask
      id="mask0_322_2677"
      style={{ maskType: 'alpha' }}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width="24"
      height="24"
    >
      <path
        d="M12 3.25C12.4142 3.25 12.75 3.58579 12.75 4V11.25H20C20.4142 11.25 20.75 11.5858 20.75 12C20.75 12.4142 20.4142 12.75 20 12.75H12.75V20C12.75 20.4142 12.4142 20.75 12 20.75C11.5858 20.75 11.25 20.4142 11.25 20V12.75H4C3.58579 12.75 3.25 12.4142 3.25 12C3.25 11.5858 3.58579 11.25 4 11.25H11.25V4C11.25 3.58579 11.5858 3.25 12 3.25Z"
        fill="#242424"
      />
    </mask>
    <g mask="url(#mask0_322_2677)">
      <rect width="24" height="24" fill="#272320" />
    </g>
  </svg>
);



const NavigationSection: React.FC = () => {
  const [isAgentSearchActive, setIsAgentSearchActive] = useState(false);

  const { chats, data } = useProfileData();
  const { showSuccess, showError } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // 🔥 Refactor: both currentChatId and currentChatSessionId are obtained from AgentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId(),
  );
  const [currentChatSessionId, setCurrentChatSessionId] = useState<
    string | null
  >(agentChatSessionCacheManager.getCurrentChatSessionId());

  // 🔥 Listen for changes to agentChatSessionCacheManager's currentChatSessionId and sync local state
  useEffect(() => {
    const unsubscribe =
      agentChatSessionCacheManager.subscribeToCurrentChatSessionId(
        (newSessionId) => {
          setCurrentChatSessionId(newSessionId);
          // Also update currentChatId (switching session may mean switching agent)
          const newChatId = agentChatSessionCacheManager.getCurrentChatId();
          setCurrentChatId(newChatId);
        },
      );

    return unsubscribe;
  }, []);

  const handleSelectChat = (chatId: string) => {
    // Navigate to the chat route with explicit new-chat intent.
    // ChatView should only auto-create a session for this user-driven path.
    navigate(`/agent/chat/${chatId}`, {
      state: {
        intent: 'new-chat',
        source: 'agent-list',
      },
    });
  };

  // 🔥 Handle New Agent: navigate to the creation page
  const handleNewAgent = () => {
    if (isAgentCreationView) {
      // If already in Agent Creation view, force refresh to default state
      navigate('/agent/chat/creation', { replace: true, state: { refresh: Date.now() } });
    } else {
      navigate('/agent/chat/creation');
    }
  };

  // 🔥 Fix: handle ChatSession selection - true two-step flow
  const handleSelectChatSession = (chatId: string, sessionId: string) => {
    // Navigate to the specific chat session
    navigate(`/agent/chat/${chatId}/${sessionId}`);
  };

  // 🔥 Added: handle delete ChatSession
  const handleDeleteChatSession = async (chatId: string, sessionId: string) => {
    try {
      // Directly call the delete logic in ChatView
      window.dispatchEvent(
        new CustomEvent('chatSession:delete', {
          detail: { sessionId },
        }),
      );
    } catch (error) {
      showError(
        `Failed to delete chat session: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  };

  // 🔥 Added: handle fork ChatSession
  const handleForkChatSession = async (chatId: string, sessionId: string) => {
    try {
      // Directly call the fork logic in ChatView
      window.dispatchEvent(
        new CustomEvent('chatSession:fork', {
          detail: { sessionId },
        }),
      );
    } catch (error) {
      showError(
        `Failed to fork chat session: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  };

  // 🔥 Get primaryAgent config
  const primaryAgent = data?.profile?.primaryAgent || 'Kobi';

  // 🔥 Extract chatId from URL (supports /agent/chat/:chatId and /agent/chat/:chatId/settings routes)
  const urlChatId = useMemo(() => {
    const match = location.pathname.match(/\/agent\/chat\/([^\/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // 🔥 Determine whether currently in settings view
  const isSettingsView = location.pathname.includes('/settings');

  // 🔥 Determine whether currently in Agent Creation view (including sub-routes)
  const isAgentCreationView = location.pathname.startsWith('/agent/chat/creation');

  // 🔥 Determine the actually displayed currentChatId (URL chatId takes priority)
  const displayCurrentChatId = urlChatId || currentChatId;

  /**
   * 🔥 Calculate the list of Built-in Agents to display below the Divider
   * Kobi is always visible.
   */
  const builtinChats = useMemo(() => {
    return chats.filter(chat => isBuiltinAgent(chat.agent?.name, BRAND_NAME));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats]);

  // 🔥 Determine whether to show Built-in Agents below the Divider
  // Show as long as any built-in agent exists (regardless of whether it is primary)
  const showBuiltinBelowDivider = useMemo(() => {
    return builtinChats.length > 0;
  }, [builtinChats]);

  const visibleSearchSourceChats = useMemo(() => {
    const regularChats = chats.filter(chat => !isBuiltinAgent(chat.agent?.name, BRAND_NAME));
    return [...regularChats, ...builtinChats];
  }, [builtinChats, chats]);

  const chatProps = useMemo(
    () => ({
      chats,
      primaryAgent, // 🔥 Added: get primaryAgent from profile data
      excludeBuiltinAgents: true, // 🔥 Modified: main list excludes all built-in agents (they are shown separately below the Divider)
      currentChatId: displayCurrentChatId, // 🔥 Modified: use displayCurrentChatId
      onSelectChat: handleSelectChat,
      // 🔥 Modified: show selected state in both chat view and settings view
      activeView: location.pathname.includes('/agent/chat')
        ? (isSettingsView ? 'settings' : 'chat')
        : undefined,
      // 🔥 Added: ChatSession-related props
      currentChatSessionId,
      onSelectChatSession: handleSelectChatSession,
      onDeleteChatSession: handleDeleteChatSession,
      onForkChatSession: handleForkChatSession,
    }),
    [
      chats,
      primaryAgent,
      displayCurrentChatId,
      location.pathname,
      isSettingsView,
      currentChatSessionId,
    ],
  );

  // 🔥 Props for Built-in Agents displayed below the Divider
  const builtinChatProps = useMemo(
    () => ({
      chats: builtinChats,
      primaryAgent, // 🔥 Pass primaryAgent so built-in agents can also show the Primary badge (badge rendering is independent)
      excludeBuiltinAgents: false, // Do not exclude; this list is specifically for built-in agents
      currentChatId: displayCurrentChatId, // 🔥 Modified: use displayCurrentChatId
      onSelectChat: handleSelectChat,
      // 🔥 Modified: show selected state in both chat view and settings view
      activeView: location.pathname.includes('/agent/chat')
        ? (isSettingsView ? 'settings' : 'chat')
        : undefined,
      currentChatSessionId,
      onSelectChatSession: handleSelectChatSession,
      onDeleteChatSession: handleDeleteChatSession,
      onForkChatSession: handleForkChatSession,
    }),
    [
      builtinChats,
      primaryAgent,
      displayCurrentChatId,
      location.pathname,
      isSettingsView,
      currentChatSessionId,
    ],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '0px',
        gap: '8px',
        minWidth: '264px',
        maxWidth: '364px',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* New Agent Button - pinned at the top */}
      <NavItem
        icon={<PlusIcon />}
        label="New Agent"
        onClick={handleNewAgent}
        title="Create a new agent"
        role="button"
        tabIndex={0}
        isActive={isAgentCreationView}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleNewAgent();
          }
        }}
      />

      {/* AgentList - scrollable area */}
      <div
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          width: '100%',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        className="agent-list-scroll-container"
      >
        <AgentList
          chats={chatProps.chats}
          searchSourceChats={visibleSearchSourceChats}
          primaryAgent={chatProps.primaryAgent}
          excludeBuiltinAgents={chatProps.excludeBuiltinAgents}
          showSearch={true}
          currentChatId={chatProps.currentChatId}
          onSelectChat={chatProps.onSelectChat}
          activeView={chatProps.activeView as any}
          currentChatSessionId={chatProps.currentChatSessionId}
          onSelectChatSession={chatProps.onSelectChatSession}
          onDeleteChatSession={chatProps.onDeleteChatSession}
          onForkChatSession={chatProps.onForkChatSession}
          onSearchActiveChange={setIsAgentSearchActive}
        />
      </div>

      {/* Divider - fixed position */}
      {!isAgentSearchActive && <Divider />}

      {/* 🔥 Built-in Agents shown below the Divider */}
      {showBuiltinBelowDivider && !isAgentSearchActive && (
        <div
          style={{
            width: '100%',
            flexShrink: 0,
          }}
        >
          <AgentList
            chats={builtinChatProps.chats}
            primaryAgent={builtinChatProps.primaryAgent}
            excludeBuiltinAgents={builtinChatProps.excludeBuiltinAgents}
            showSearch={false}
            currentChatId={builtinChatProps.currentChatId}
            onSelectChat={builtinChatProps.onSelectChat}
            activeView={builtinChatProps.activeView as any}
            currentChatSessionId={builtinChatProps.currentChatSessionId}
            onSelectChatSession={builtinChatProps.onSelectChatSession}
            onDeleteChatSession={builtinChatProps.onDeleteChatSession}
            onForkChatSession={builtinChatProps.onForkChatSession}
          />
        </div>
      )}

      {/* Function List - Chat, MCP, Memory - migrated to settings page */}
    </div>
  );
};

export default NavigationSection;