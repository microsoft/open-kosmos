import React, { useCallback, useEffect, memo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AgentContextType } from '../../types/agentContextTypes';
import { useCurrentChatId } from '../../lib/chat/agentChatSessionCacheManager';
import { createLogger } from '../../lib/utilities/logger';
const logger = createLogger('[ContentContainer]');

interface ContentContainerProps {
  sidebarVisible?: boolean;
}

const ContentContainer: React.FC<ContentContainerProps> = ({
  sidebarVisible = true,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentChatId = useCurrentChatId();

  // 🔥 Handle new Agent - navigate to the creation page
  const handleNewAgentInternal = useCallback(() => {
    navigate('/agent/chat/creation');
  }, [navigate]);

  // 🔥 Handle edit Agent - navigate to the settings page
  const handleEditAgentInternal = useCallback(
    (chatId: string, initialTab?: 'basic' | 'mcp' | 'skills' | 'schedules' | 'prompt' | 'context') => {
      // Tab route mapping - kept in sync with tabToRouteMap in AgentChatEditingView
      const tabToRouteMap: Record<string, string> = {
        'basic': 'basic',
        'mcp': 'mcp_servers',
        'skills': 'skills',
        'schedules': 'schedules',
        'prompt': 'system_prompt',
        'context': 'context_enhancement'
      };

      const routeTab = initialTab ? tabToRouteMap[initialTab] || 'basic' : 'basic';
      navigate(`/agent/chat/${chatId}/settings/${routeTab}`);
    },
    [navigate],
  );

  // 🔥 Listen for agent operation events from LeftNavigation
  useEffect(() => {
    const handleNewAgentEvent = () => {
      handleNewAgentInternal();
    };

    const handleEditAgentEvent = (event: CustomEvent) => {
      const { chatId, initialTab } = event.detail;
      // If no chatId is provided, use the current chatId
      const targetChatId = chatId || currentChatId;
      if (targetChatId) {
        handleEditAgentInternal(targetChatId, initialTab);
      }
    };

    window.addEventListener('agent:newAgent', handleNewAgentEvent);
    window.addEventListener(
      'agent:editAgent',
      handleEditAgentEvent as EventListener,
    );

    return () => {
      window.removeEventListener('agent:newAgent', handleNewAgentEvent);
      window.removeEventListener(
        'agent:editAgent',
        handleEditAgentEvent as EventListener,
      );
    };
  }, [
    handleNewAgentInternal,
    handleEditAgentInternal,
    currentChatId,
  ]);

  const agentContext: AgentContextType = {};

  // 🔥 FIX: Fallback redirect mechanism - fixes occasional cases where the Navigate component has no effect
  // If the route is /agent root path, redirect to /agent/chat
  // This is a fallback for React Router's index route Navigate
  useEffect(() => {
    if (location.pathname === '/agent' || location.pathname === '/agent/') {
      logger.debug('[ContentContainer] ⚠️ At /agent root, forcing redirect to /agent/chat');
      // Use setTimeout to ensure execution happens after the current render cycle
      const timer = setTimeout(() => {
        navigate('/agent/chat', { replace: true });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [location.pathname, navigate]);

  return (
    <main className="content-container" role="main" aria-live="polite" style={{
      padding:  sidebarVisible ? '0 0 0 2px' : '0 0 0 8px',
      background: 'transparent',
      transition: 'padding 0.25s ease',
    }}>
      {/* Content Wrapper - contains the actual view content */}
      <div className="content-wrapper">
        <Outlet context={agentContext} />
      </div>
    </main>
  );
};

export default memo(ContentContainer);
