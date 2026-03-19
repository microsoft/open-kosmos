import React, { useEffect, useState, useCallback } from 'react';

import '../../styles/Header.css';
import { Eye, EyeOff, Pin, PinOff, Play, Square } from 'lucide-react';
import StatusBadges from '../ui/StatusBadges';
import { useAgentConfig } from '../userData/userDataProvider';
import { useLayout } from '../layout/LayoutProvider';
import { agentChatSessionCacheManager, useIsReplaying, useChatStatus, useMessages } from '../../lib/chat/agentChatSessionCacheManager';
import { AgentAvatar } from '../common/AgentAvatar';

interface ChatViewHeaderProps {
  agentChat?: any | null; // Generic type since AgentChat is now in main process
  onToggleMinimalMode?: () => void;
  onToggleWorkspaceExplorer?: () => void;
  isWorkspaceExplorerVisible?: boolean;
  onOpenMcpTools?: () => void;
  onOpenSkills?: () => void;
  currentChatSessionId?: string | null;
}

const ChatViewHeader: React.FC<ChatViewHeaderProps> = ({
  agentChat,
  onToggleMinimalMode,
  onToggleWorkspaceExplorer,
  isWorkspaceExplorerVisible = false,
  onOpenMcpTools,
  onOpenSkills,
  currentChatSessionId
}) => {
  // Get minimal-mode state and always-on-top toggle from LayoutProvider
  const { isMinimalMode, isAlwaysOnTop, toggleAlwaysOnTop } = useLayout();
  
  // Replay state and related data
  const isReplaying = useIsReplaying();
  const currentChatStatus = useChatStatus();
  const allMessages = useMessages();
  const canReplay = currentChatStatus === 'idle' &&
    allMessages.some(msg => msg.role !== 'system' && msg.role !== 'tool');

  const handleReplayToggle = useCallback(() => {
    if (!currentChatSessionId) {
      console.warn('[Replay] handleReplayToggle: no currentChatSessionId, cannot toggle replay');
      return;
    }
    const nextState = !isReplaying;
    console.log('[Replay] handleReplayToggle:', {
      currentChatSessionId,
      isReplaying,
      nextState,
      canReplay,
      currentChatStatus,
      allMessagesCount: allMessages.length,
      nonSystemMessages: allMessages.filter(m => m.role !== 'system' && m.role !== 'tool').length
    });
    agentChatSessionCacheManager.setReplayingStatus(currentChatSessionId, nextState);
  }, [currentChatSessionId, isReplaying, canReplay, currentChatStatus, allMessages]);

  // Get currentChatId from agentChatSessionCacheManager
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId()
  );
  
  // Get app version for development mode display
  const [appVersion, setAppVersion] = useState<string>('1.15.6');
  
  useEffect(() => {
    const unsubscribe = agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
      const newChatId = agentChatSessionCacheManager.getCurrentChatId();
      setCurrentChatId(newChatId);
    });
    return unsubscribe;
  }, []);
  
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      window.electronAPI?.getVersion?.().then((version) => {
        setAppVersion(version);
      }).catch(() => {
        setAppVersion('1.15.6');
      });
    }
  }, []);
  
  // Get current agent configuration data - depends on currentChatId to update on switch
  const { agent } = useAgentConfig();
  
  return (
    <header className="unified-header">
      <div className="header-title">
        {agent && (
          <span className="header-icon">
            <AgentAvatar
              emoji={agent.emoji}
              avatar={agent.avatar}
              name={agent.name}
              size="md"
              version={agent.version}
            />
          </span>
        )}
        <span className="header-name">{agent ? agent.name : 'Chat'}</span>
        <StatusBadges
          currentAgent={agent}
          agentChat={agentChat}
          onOpenMcpTools={onOpenMcpTools}
          onOpenSkills={onOpenSkills}
        />
        {/* Development mode: Display version and current chat IDs */}
        {process.env.NODE_ENV === 'development' && (
          <div style={{
            marginLeft: '12px',
            fontSize: '11px',
            color: '#666',
            display: 'flex',
            gap: '8px'
          }}
          className="code-text">
            <span title="App Version" style={{ color: '#0066cc', fontWeight: 'bold' }}>
              v{appVersion}
            </span>
            {currentChatId && (
              <span title="Current Chat ID">
                💬 {currentChatId}
              </span>
            )}
            {currentChatSessionId && (
              <span title="Current Chat Session ID">
                📝 {currentChatSessionId}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="header-actions">
        {/* Replay / Stop button - replays the current session's chat history */}
        {(canReplay || isReplaying) && (
          <button
            className={`btn-action ${isReplaying ? 'active' : ''}`}
            onClick={handleReplayToggle}
            title={isReplaying ? 'Stop replay' : 'Replay chat'}
            aria-label={isReplaying ? 'Stop replay' : 'Replay chat'}
          >
            {isReplaying ? <Square size={20} fill="#dc2626" color="#dc2626" /> : <Play size={20} />}
          </button>
        )}

        {/* Always on top toggle button - only shown in minimal mode */}
        {isMinimalMode && (
          <button
            className={`btn-action ${isAlwaysOnTop ? 'active' : ''}`}
            onClick={toggleAlwaysOnTop}
            title={isAlwaysOnTop ? "Disable always on top" : "Enable always on top"}
            aria-label={isAlwaysOnTop ? "Disable always on top" : "Enable always on top"}
          >
            {isAlwaysOnTop ? <Pin size={24} /> : <PinOff size={24} />}
          </button>
        )}

        {/* Workspace Explorer toggle button - only shown in non-minimal mode */}
        {!isMinimalMode && onToggleWorkspaceExplorer && (
          <button
            className={`btn-action ${isWorkspaceExplorerVisible ? 'active' : ''}`}
            onClick={onToggleWorkspaceExplorer}
            title={isWorkspaceExplorerVisible ? "Hide workspace explorer" : "Show workspace explorer"}
            aria-label={isWorkspaceExplorerVisible ? "Hide workspace explorer" : "Show workspace explorer"}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <mask id="mask0_428_1507" style={{maskType:'alpha'}} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                <path d="M3.5 6.25V8H8.12868C8.32759 8 8.51836 7.92098 8.65901 7.78033L10.1893 6.25L8.65901 4.71967C8.51836 4.57902 8.32759 4.5 8.12868 4.5H5.25C4.2835 4.5 3.5 5.2835 3.5 6.25ZM2 6.25C2 4.45507 3.45507 3 5.25 3H8.12868C8.72542 3 9.29771 3.23705 9.71967 3.65901L11.5607 5.5H18.75C20.5449 5.5 22 6.95507 22 8.75V17.75C22 19.5449 20.5449 21 18.75 21H5.25C3.45507 21 2 19.5449 2 17.75V6.25ZM3.5 9.5V17.75C3.5 18.7165 4.2835 19.5 5.25 19.5H18.75C19.7165 19.5 20.5 18.7165 20.5 17.75V8.75C20.5 7.7835 19.7165 7 18.75 7H11.5607L9.71967 8.84099C9.29771 9.26295 8.72542 9.5 8.12868 9.5H3.5Z" fill="#242424"/>
              </mask>
              <g mask="url(#mask0_428_1507)">
                <rect width="24" height="24" fill="#272320"/>
              </g>
            </svg>
          </button>
        )}
        
        {/* Minimal/Focus mode toggle - currently disabled */}
        {/* {onToggleMinimalMode && (
          <button
            className={`btn-action ${isMinimalMode ? 'active' : ''}`}
            onClick={onToggleMinimalMode}
            disabled={disabled}
            title={isMinimalMode ? "Exit minimal mode" : "Enter minimal mode"}
            aria-label={isMinimalMode ? "Exit minimal mode" : "Enter minimal mode"}
          >
            {isMinimalMode ? <Eye size={24} /> : <EyeOff size={24} />}
          </button>
        )} */}
      </div>
      
      </header>
  );
};

export default ChatViewHeader;