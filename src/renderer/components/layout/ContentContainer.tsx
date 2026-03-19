import React, { useState, useCallback, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLayout } from './LayoutProvider';
import { useProfileData } from '../userData/userDataProvider';
import { Message, Config as ChatConfig } from '../../types/chatTypes';
import { WorkspaceMenuActions } from '../chat/workspace/WorkspaceExplorerSidepane';
import { AgentContextType } from '../../types/agentContextTypes';
import AskForInfo from '../chat/AskForInfo';
import { usePendingInfoInputRequest } from '../../lib/chat/agentChatSessionCacheManager';

interface ContentContainerProps {
  // Chat props - passed through from ChatApp
  messages: Message[];
  allMessages: Message[];
  streamingMessageId?: string;
  onSendMessage: (message: Message) => void; // Unified message format
  onCancelChat?: () => void; // 🔥 New: Cancel chat callback
  onApprovalResponse?: (approved: boolean) => void; // 🔥 New: Approval request callback
  pendingApprovalRequest?: {
    requestId: string;
    toolName: string;
    path: string;
  } | null; // 🔥 New: Approval request state

  // Model config props
  config: ChatConfig;
  onSaveConfig: (config: ChatConfig) => void;

  // Agent navigation handlers
  onNewAgent?: () => void;
  onEditAgent?: (chatId: string) => void;
  onDeleteAgent?: (chatId: string) => void;

  // MCP Server menu handlers
  onMcpServerMenuToggle?: (
    serverName: string,
    buttonElement: HTMLElement,
  ) => void;
  mcpServerMenuState?: {
    isOpen: boolean;
    serverName: string | null;
    position: { top: number; left: number } | null;
  };

  // Workspace Explorer menu handlers
  onWorkspaceMenuToggle?: (
    buttonElement: HTMLElement,
    menuActions: WorkspaceMenuActions,
  ) => void;
  handleWorkspaceMenuClose?: () => void;
  workspaceMenuState?: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
    actions: WorkspaceMenuActions | null;
  };
  workspaceMenuRef?: React.RefObject<HTMLDivElement>;

  // MCP Server operation handlers
  onMcpServerConnect?: (serverName: string) => void;
  onMcpServerDisconnect?: (serverName: string) => void;
  onMcpServerReconnect?: (serverName: string) => void;
  onMcpServerDelete?: (serverName: string) => void;
  onMcpServerEdit?: (serverName: string) => void;

  // MCP Add menu handler
  onMcpAddMenuToggle?: (buttonElement: HTMLElement) => void;

  // Skills Add menu handler
  onSkillsAddMenuToggle?: (buttonElement: HTMLElement) => void;

  // Skills menu handler
  onSkillMenuToggle?: (skillName: string, buttonElement: HTMLElement) => void;

  // Edit Agent menu handler
  onEditAgentMenuToggle?: (buttonElement: HTMLElement) => void;

  // Attach menu handler
  onAttachMenuToggle?: (buttonElement: HTMLElement) => void;

  // FileTreeNode context menu handler
  onFileTreeNodeMenuToggle?: (
    event: React.MouseEvent,
    node: any,
    workspacePath: string,
  ) => void;

  // These props will be removed once we create ModelConfiguration/McpConfiguration components
  showConfigModal?: boolean;
  showMcpConfigModal?: boolean;
  sidepaneWidth?: number;
  setSidepaneWidth?: (width: number) => void;
  isDragging?: boolean;
}

const ContentContainer: React.FC<ContentContainerProps> = ({
  messages,
  allMessages,
  streamingMessageId,
  onSendMessage,
  onCancelChat,
  onApprovalResponse,
  pendingApprovalRequest,
  config,
  onSaveConfig,
  onNewAgent,
  onEditAgent,
  onDeleteAgent,
  onMcpServerMenuToggle,
  mcpServerMenuState,
  onWorkspaceMenuToggle,
  handleWorkspaceMenuClose,
  workspaceMenuState,
  workspaceMenuRef,
  onMcpServerConnect,
  onMcpServerDisconnect,
  onMcpServerReconnect,
  onMcpServerDelete,
  onMcpServerEdit,
  onMcpAddMenuToggle,
  onSkillsAddMenuToggle,
  onSkillMenuToggle,
  onEditAgentMenuToggle,
  onAttachMenuToggle,
  onFileTreeNodeMenuToggle,
  showConfigModal = false,
  showMcpConfigModal = false,
  sidepaneWidth = 450,
  setSidepaneWidth,
  isDragging = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    agentChatSessionCacheManager,
  } = require('../../lib/chat/agentChatSessionCacheManager');
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    agentChatSessionCacheManager.getCurrentChatId(),
  );

  // Listen for currentChatId changes
  useEffect(() => {
    const unsubscribe =
      agentChatSessionCacheManager.subscribeToCurrentChatSessionId(() => {
        const newChatId = agentChatSessionCacheManager.getCurrentChatId();
        setCurrentChatId(newChatId);
      });
    return unsubscribe;
  }, []);

  // 🔥 Handle creating new Agent - navigate to creation page
  const handleNewAgentInternal = useCallback(() => {
    navigate('/agent/chat/creation');
  }, [navigate]);

  // 🔥 Handle editing Agent - navigate to settings page
  const handleEditAgentInternal = useCallback(
    (chatId: string, initialTab?: 'basic' | 'mcp' | 'skills' | 'prompt' | 'context') => {
      // Tab route mapping - consistent with tabToRouteMap in AgentChatEditingView
      const tabToRouteMap: Record<string, string> = {
        'basic': 'basic',
        'mcp': 'mcp_servers',
        'skills': 'skills',
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

  // Get pending user info input request
  const pendingInfoRequest = usePendingInfoInputRequest();

  // Handle user info input confirmation
  const handleUserInfoConfirm = async (requestId: string, values: Record<string, any>) => {
    if (window.electronAPI?.agentChat?.sendUserInfoInputResponse) {
      try {
        await window.electronAPI.agentChat.sendUserInfoInputResponse({
          requestId,
          action: 'continue',
          userInputs: values
        });
        console.log('[ContentContainer] User info input confirmation sent:', values);
      } catch (error) {
        console.error('[ContentContainer] Failed to send user info input confirmation:', error);
      }
    }
  };

  // Handle user info input skip
  const handleUserInfoSkip = async (requestId: string) => {
    if (window.electronAPI?.agentChat?.sendUserInfoInputResponse) {
      try {
        await window.electronAPI.agentChat.sendUserInfoInputResponse({
          requestId,
          action: 'skip'
        });
        console.log('[ContentContainer] User info input skip sent');
      } catch (error) {
        console.error('[ContentContainer] Failed to send user info input skip:', error);
      }
    }
  };

  const agentContext: AgentContextType = {
    messages,
    allMessages,
    streamingMessageId,
    onSendMessage,
    onCancelChat,
    onApprovalResponse,
    pendingApprovalRequest,
    config,
    onSaveConfig,
    onNewAgent,
    onEditAgent,
    onDeleteAgent,
    onMcpServerConnect,
    onMcpServerDisconnect,
    onMcpServerReconnect,
    onMcpServerDelete,
    onMcpServerEdit,
    onMcpServerMenuToggle,
    mcpServerMenuState,
    onWorkspaceMenuToggle,
    workspaceMenuState,
    onMcpAddMenuToggle,
    onSkillsAddMenuToggle,
    onSkillMenuToggle,
    onEditAgentMenuToggle,
    onAttachMenuToggle,
    onFileTreeNodeMenuToggle,
    sidepaneWidth,
    setSidepaneWidth,
    isDragging,
  };

  // 🔥 DEBUG: Log current location
  console.log('[ContentContainer] 🔍 Rendering with location:', location.pathname);
  
  // 🔥 FIX: Fallback redirect mechanism - resolve occasional Navigate component not taking effect
  // If the route is the /agent root path, redirect to /agent/chat
  // This is a fallback for React Router index route Navigate
  useEffect(() => {
    if (location.pathname === '/agent' || location.pathname === '/agent/') {
      console.log('[ContentContainer] ⚠️ At /agent root, forcing redirect to /agent/chat');
      // Use setTimeout to ensure execution after the current render cycle
      const timer = setTimeout(() => {
        navigate('/agent/chat', { replace: true });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [location.pathname, navigate]);

  return (
    <main className="content-container" role="main" aria-live="polite">
      {/* Content Wrapper - contains actual view content */}
      <div className="content-wrapper">
        <Outlet context={agentContext} />
      </div>
      
      {/* AskForInfo overlay - inside ContentContainer, vertically centered with ChatInput */}
      {pendingInfoRequest && (
        <div className="ask-for-info-overlay">
          <AskForInfo
            request={pendingInfoRequest}
            onConfirm={handleUserInfoConfirm}
            onSkip={handleUserInfoSkip}
          />
        </div>
      )}
    </main>
  );
};

export default ContentContainer;
