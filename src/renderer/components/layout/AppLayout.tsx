import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings, LogOut, MessageSquareText } from 'lucide-react';
import LeftNavigation from './LeftNavigation';
import ContentContainer from './ContentContainer';
import { LayoutProvider, useLayout } from './LayoutProvider';
import { AuthData } from '../../types/authTypes';
import { Message, Config as ChatConfig, ChatReferenceBinaryData, ChatReferenceFileData } from '../../types/chatTypes';
import { useProfileData, useChats, useProfileDataRefresh } from '../userData/userDataProvider';
import { useCurrentChatId } from '../../lib/chat/agentChatSessionCacheManager';
import { useToast } from '../ui/ToastProvider';
import { WorkspaceMenuActions } from '../chat/workspace/WorkspaceExplorerSidepane';
import { PasteToWorkspaceProvider } from '../chat/workspace/PasteToWorkspaceProvider';
import { OverlayImageViewer } from '../ui/OverlayImageViewer';
import { OverlayFileViewer, OverlayFileDescriptor } from '../ui/OverlayFileViewer';
import { BRAND_CONFIG } from '@shared/constants/branding';
import ApplySkillToAgentsDialog from '../skills/ApplySkillToAgentsDialog';
import {
  AgentDropdownMenu,
  WorkspaceMenuDropdown,
  EditAgentMenuDropdown,
  AttachMenuDropdown,
  ChatSessionDropdownMenu,
  FileTreeNodeContextMenu,
  ImageGalleryContextMenu
} from '../menu';
import '../../styles/DropdownMenu.css';
import '../../styles/Modal.css';

interface AppLayoutProps {
  // Auth data
  authData: AuthData | null;
  onLogout: () => void;

  // Chat functionality
  messages: Message[];
  allMessages: Message[];
  streamingMessageId?: string;
  onSendMessage: (message: Message) => void; // 🔄 Updated: Use unified Message interface
  onCancelChat?: () => void; // 🔥 New: Cancel chat callback
  onApprovalResponse?: (approved: boolean) => void; // 🔥 New: Approval request callback
  pendingApprovalRequest?: {
    requestId: string;
    toolName: string;
    path: string;
  } | null; // 🔥 New: Approval request state

  // Configuration
  config: ChatConfig;
  onSaveConfig: (config: ChatConfig) => void;

  // Agent navigation handlers
  onNewAgent?: () => void;
  onEditAgent?: (chatId: string) => void;
  onDeleteAgent?: (chatId: string) => void;

  // MCP Server operation handlers (passed to McpView)
  onMcpServerConnect?: (serverName: string) => void;
  onMcpServerDisconnect?: (serverName: string) => void;
  onMcpServerReconnect?: (serverName: string) => void;
  onMcpServerDelete?: (serverName: string) => void;
  onMcpServerEdit?: (serverName: string) => void;

  // Legacy props for Phase 1 compatibility
  showConfigModal?: boolean;
  showMcpConfigModal?: boolean;
  sidepaneWidth?: number;
  setSidepaneWidth?: (width: number) => void;
  isDragging?: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({
  authData,
  onLogout,
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
  showConfigModal,
  showMcpConfigModal,
  sidepaneWidth,
  setSidepaneWidth,
  isDragging,
}) => {
  // 🔧 Fix: Use navigate and location in AppLayout to update routes after deleting an agent
  const navigate = useNavigate();
  const location = useLocation();
  
  // User menu state management
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Agent dropdown menu state management
  const [agentMenuState, setAgentMenuState] = useState<{
    isOpen: boolean;
    chatId: string | null;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    chatId: null,
    position: null,
  });
  const agentMenuRef = useRef<HTMLDivElement>(null);


  // Edit Agent dropdown menu state management
  const [editAgentMenuState, setEditAgentMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    position: null,
  });
  const editAgentMenuRef = useRef<HTMLDivElement>(null);

  // Attach dropdown menu state management
  const [attachMenuState, setAttachMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    position: null,
  });
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Workspace Explorer dropdown menu state management
  const [workspaceMenuState, setWorkspaceMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
    actions: WorkspaceMenuActions | null;
  }>({
    isOpen: false,
    position: null,
    actions: null,
  });
  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  // FileTreeNode context menu state management
  const [fileTreeNodeMenuState, setFileTreeNodeMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
    node: any | null;
    workspacePath: string | null;
  }>({
    isOpen: false,
    position: null,
    node: null,
    workspacePath: null,
  });
  const fileTreeNodeMenuRef = useRef<HTMLDivElement>(null);

  // ChatSession dropdown menu state management
  const [chatSessionMenuState, setChatSessionMenuState] = useState<{
    isOpen: boolean;
    chatId: string | null;
    sessionId: string | null;
    title: string | null;  // 🔥 New: ChatSession title
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    chatId: null,
    sessionId: null,
    title: null,
    position: null,
  });
  const chatSessionMenuRef = useRef<HTMLDivElement>(null);

  // ImageViewer state management
  const [imageViewerState, setImageViewerState] = useState<{
    isOpen: boolean;
    images: Array<{ id: string; url: string; alt?: string }>;
    initialIndex: number;
  }>({
    isOpen: false,
    images: [],
    initialIndex: 0,
  });

  // FileViewer state management
  const [fileViewerState, setFileViewerState] = useState<{
    isOpen: boolean;
    file: OverlayFileDescriptor | null;
  }>({
    isOpen: false,
    file: null,
  });

  // ImageGallery context menu state management
  const [imageGalleryMenuState, setImageGalleryMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
    imageData: { url: string; alt?: string; index: number } | null;
    galleryImages: Array<{ id: string; url: string; alt?: string }> | null;
    initialIndex: number;
  }>({
    isOpen: false,
    position: null,
    imageData: null,
    galleryImages: null,
    initialIndex: 0,
  });
  const imageGalleryMenuRef = useRef<HTMLDivElement>(null);

  // Delete confirmation dialog state (for agents and chat sessions)
  const [deleteConfirmState, setDeleteConfirmState] = useState<{
    isOpen: boolean;
    type: 'agent' | 'chat-session';
    id: string | null;
    name: string | null;
    isCurrentSession?: boolean;
  }>({
    isOpen: false,
    type: 'agent',
    id: null,
    name: null,
    isCurrentSession: false,
  });

  // Duplicate agent dialog state
  const [duplicateAgentState, setDuplicateAgentState] = useState<{
    isOpen: boolean;
    chatId: string | null;
    agentName: string | null;
    newName: string;
  }>({
    isOpen: false,
    chatId: null,
    agentName: null,
    newName: '',
  });

  // Rename chat session dialog state
  const [renameChatSessionState, setRenameChatSessionState] = useState<{
    isOpen: boolean;
    chatId: string | null;
    sessionId: string | null;
    newTitle: string;
  }>({
    isOpen: false,
    chatId: null,
    sessionId: null,
    newTitle: '',
  });

  // Handle user menu
  const handleUserMenuToggle = () => {
    setIsUserMenuOpen(!isUserMenuOpen);
  };

  const handleUserLogout = () => {
    setIsUserMenuOpen(false);
    onLogout();
  };

  const handleSendFeedback = () => {
    setIsUserMenuOpen(false);
    const feedbackLink = BRAND_CONFIG.feedbackLink;
    console.log('[Send Feedback] BRAND_CONFIG:', BRAND_CONFIG);
    console.log('[Send Feedback] feedbackLink:', feedbackLink);
    if (feedbackLink) {
      console.log('[Send Feedback] Opening URL:', feedbackLink);
      window.open(feedbackLink, '_blank');
    } else {
      console.warn('[Send Feedback] No feedbackLink configured in BRAND_CONFIG');
    }
  };

  // ImageGallery context menu handler
  const handleImageGalleryMenuToggle = (
    event: React.MouseEvent,
    imageData: { url: string; alt?: string; index: number },
    galleryImages?: Array<{ id: string; url: string; alt?: string }>,
    initialIndex?: number,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 180;
    const menuHeight = 80;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = event.clientX;
    let top = event.clientY;

    // Prevent exceeding right boundary
    if (left + menuWidth > windowWidth) {
      left = windowWidth - menuWidth - 8;
    }

    // Prevent exceeding bottom boundary
    if (top + menuHeight > windowHeight) {
      top = windowHeight - menuHeight - 8;
    }

    // Prevent exceeding top boundary
    if (top < 8) {
      top = 8;
    }

    // Prevent exceeding left boundary
    if (left < 8) {
      left = 8;
    }

    setImageGalleryMenuState({
      isOpen: true,
      position: { top, left },
      imageData,
      galleryImages: galleryImages || null,
      initialIndex: initialIndex ?? 0,
    });
  };

  const handleImageGalleryMenuClose = () => {
    setImageGalleryMenuState({
      isOpen: false,
      position: null,
      imageData: null,
      galleryImages: null,
      initialIndex: 0,
    });
  };

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        userMenuRef.current &&
        !userMenuRef.current.contains(event.target as Node)
      ) {
        setIsUserMenuOpen(false);
      }
      if (
        agentMenuRef.current &&
        !agentMenuRef.current.contains(event.target as Node)
      ) {
        setAgentMenuState({ isOpen: false, chatId: null, position: null });
      }
      if (
        workspaceMenuRef.current &&
        !workspaceMenuRef.current.contains(event.target as Node)
      ) {
        setWorkspaceMenuState({ isOpen: false, position: null, actions: null });
      }
      if (
        editAgentMenuRef.current &&
        !editAgentMenuRef.current.contains(event.target as Node)
      ) {
        setEditAgentMenuState({ isOpen: false, position: null });
      }
      if (
        attachMenuRef.current &&
        !attachMenuRef.current.contains(event.target as Node)
      ) {
        setAttachMenuState({ isOpen: false, position: null });
      }
      if (
        chatSessionMenuRef.current &&
        !chatSessionMenuRef.current.contains(event.target as Node)
      ) {
        setChatSessionMenuState({
          isOpen: false,
          chatId: null,
          sessionId: null,
          title: null,
          position: null,
        });
      }
      if (
        fileTreeNodeMenuRef.current &&
        !fileTreeNodeMenuRef.current.contains(event.target as Node)
      ) {
        setFileTreeNodeMenuState({
          isOpen: false,
          position: null,
          node: null,
          workspacePath: null,
        });
      }
      if (
        imageGalleryMenuRef.current &&
        !imageGalleryMenuRef.current.contains(event.target as Node)
      ) {
        setImageGalleryMenuState({
          isOpen: false,
          position: null,
          imageData: null,
          galleryImages: null,
          initialIndex: 0,
        });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Agent menu handler
  const handleAgentMenuToggle = (
    chatId: string,
    buttonElement: HTMLElement,
  ) => {
    if (agentMenuState.isOpen && agentMenuState.chatId === chatId) {
      // Close menu
      setAgentMenuState({ isOpen: false, chatId: null, position: null });
    } else {
      // Calculate menu position
      const rect = buttonElement.getBoundingClientRect();
      const position = {
        top: rect.bottom + 4,
        left: rect.left,
        triggerTop: rect.top, // Pass trigger top for upward positioning
      };
      setAgentMenuState({ isOpen: true, chatId, position });
    }
  };

  const handleAgentMenuClose = () => {
    setAgentMenuState({ isOpen: false, chatId: null, position: null });
  };

  const handleEditAgentClick = (chatId: string) => {
    handleAgentMenuClose();
    onEditAgent?.(chatId);
  };

  const handleDeleteAgentClick = (chatId: string) => {
    handleAgentMenuClose();
    // Trigger delete confirmation event instead of directly calling onDeleteAgent
    window.dispatchEvent(
      new CustomEvent('agent:deleteAgent', {
        detail: { chatId },
      }),
    );
  };


  // Workspace menu handler
  const handleWorkspaceMenuToggle = (
    buttonElement: HTMLElement,
    menuActions: WorkspaceMenuActions,
  ) => {
    setWorkspaceMenuState((prevState) => {
      // If menu is already open, close it
      if (prevState.isOpen) {
        return { isOpen: false, position: null, actions: null };
      }

      // Otherwise, open menu
      const rect = buttonElement.getBoundingClientRect();
      const position = {
        top: rect.bottom + 4,
        left: rect.right - 200, // 200px is the minimum menu width
        triggerTop: rect.top, // Pass trigger top for upward positioning
      };
      return { isOpen: true, position, actions: menuActions };
    });
  };

  const handleWorkspaceMenuClose = () => {
    setWorkspaceMenuState({ isOpen: false, position: null, actions: null });
  };


  // Edit Agent menu handler
  const handleEditAgentMenuToggle = (buttonElement: HTMLElement) => {
    setEditAgentMenuState((prevState) => {
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }

      const rect = buttonElement.getBoundingClientRect();
      const menuWidth = 240;
      const windowWidth = window.innerWidth;

      // Calculate horizontal position - prevent exceeding right boundary
      let left = rect.left;
      if (left + menuWidth > windowWidth) {
        left = rect.right - menuWidth;
      }

      // Place vertically below button first, useLayoutEffect will correct with actual measured height
      const top = rect.bottom + 4;

      const position = { top, left, triggerTop: rect.top };
      return { isOpen: true, position };
    });
  };

  const handleEditAgentMenuClose = () => {
    setEditAgentMenuState({ isOpen: false, position: null });
  };

  // Attach menu handler
  const handleAttachMenuToggle = (buttonElement: HTMLElement) => {
    setAttachMenuState((prevState) => {
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }
      const rect = buttonElement.getBoundingClientRect();
      const menuWidth = 200;
      const windowWidth = window.innerWidth;

      let left = rect.left;
      if (left + menuWidth > windowWidth) {
        left = rect.right - menuWidth;
      }

      // Place vertically below button first, useLayoutEffect will correct with actual measured height
      const top = rect.bottom + 4;

      const position = { top, left, triggerTop: rect.top };
      return { isOpen: true, position };
    });
  };

  const handleAttachMenuClose= () => {
    setAttachMenuState({ isOpen: false, position: null });
  };

  // ChatSession menu handler
  const handleChatSessionMenuToggle = (
    chatId: string,
    sessionId: string,
    title: string,  // 🔥 New: ChatSession title
    buttonElement: HTMLElement,
  ) => {
    if (
      chatSessionMenuState.isOpen &&
      chatSessionMenuState.sessionId === sessionId
    ) {
      // Close menu
      setChatSessionMenuState({
        isOpen: false,
        chatId: null,
        sessionId: null,
        title: null,
        position: null,
      });
    } else {
      // Calculate menu position
      const rect = buttonElement.getBoundingClientRect();
      const menuWidth = 180; // Estimated menu width
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Calculate horizontal position - prevent exceeding right boundary
      let left = rect.right - menuWidth; // Right-align to button's right edge
      if (left < 8) {
        left = rect.left; // If exceeds left boundary, left-align to button's left edge
      }

      // Calculate vertical position - prevent exceeding bottom boundary
      let top = rect.bottom + 4;
      const menuHeight = 120; // Estimated menu height (3 items: Fork, Download, Delete)
      if (top + menuHeight > windowHeight) {
        top = rect.top - menuHeight - 4; // Show above the button
      }

      const position = { top, left, triggerTop: rect.top };
      setChatSessionMenuState({ isOpen: true, chatId, sessionId, title, position });
    }
  };

  const handleChatSessionMenuClose = () => {
    setChatSessionMenuState({
      isOpen: false,
      chatId: null,
      sessionId: null,
      title: null,
      position: null,
    });
  };

  // FileTreeNode context menu handler
  const handleFileTreeNodeMenuToggle = (
    event: React.MouseEvent,
    node: any,
    workspacePath: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    // Calculate menu position, handle window boundaries
    const menuWidth = 200;
    const menuHeight = 50; // Estimated single menu item height
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = event.clientX;
    let top = event.clientY;

    // Prevent exceeding right boundary
    if (left + menuWidth > windowWidth) {
      left = windowWidth - menuWidth - 8;
    }

    // Prevent exceeding bottom boundary
    if (top + menuHeight > windowHeight) {
      top = windowHeight - menuHeight - 8;
    }

    // Prevent exceeding top boundary
    if (top < 8) {
      top = 8;
    }

    // Prevent exceeding left boundary
    if (left < 8) {
      left = 8;
    }

    setFileTreeNodeMenuState({
      isOpen: true,
      position: { top, left },
      node,
      workspacePath,
    });
  };

  const handleFileTreeNodeMenuClose = () => {
    setFileTreeNodeMenuState({
      isOpen: false,
      position: null,
      node: null,
      workspacePath: null,
    });
  };

  // Handle refresh after file tree node deletion
  const handleFileTreeNodeDelete = useCallback(async (deletedPath: string) => {
    const { workspaceOps } = await import('../../lib/chat/workspaceOps');
    // Clear cache to ensure reload on next fetch
    if (fileTreeNodeMenuState.workspacePath) {
      await workspaceOps.clearFileTreeCache(fileTreeNodeMenuState.workspacePath);
    }
    // Proactively notify all FileExplorerSections to refresh, don't rely on file watcher auto-detection
    workspaceOps.triggerRefresh();
  }, [fileTreeNodeMenuState.workspacePath]);

  // Delete confirmation handler
  const { data, chats } = useProfileData();
  const {
    agentChatSessionCacheManager,
  } = require('../../lib/chat/agentChatSessionCacheManager');
  const { deleteChat, addChat } = useChats();
  const { showToast, showSuccess, showError } = useToast();

  // Reactively get current chatId, auto-update when switching Agent
  const reactiveChatId = useCurrentChatId();

  // Get current chat's knowledgeBase path (for context menu)
  // Use reactiveChatId as dependency to ensure path updates correctly after switching Agent
  const currentKnowledgeBasePath = useMemo(() => {
    if (!reactiveChatId || !data?.chats) return '';
    const currentChat = data.chats.find((chat: any) => chat.chat_id === reactiveChatId);
    return currentChat?.agent?.knowledgeBase || '';
  }, [reactiveChatId, data?.chats, data?.lastUpdated]);

  // Handle moving file to Agent Knowledge
  const handleFileTreeNodeMoveToKnowledge = useCallback(async (filePath: string) => {
    try {
      if (!currentKnowledgeBasePath) {
        console.error('[FileTreeNode] No knowledge base path configured');
        window.alert('No knowledge base path configured for current agent.');
        return;
      }

      // Call movePath IPC
      let result = await (window as any).electronAPI?.workspace?.movePath?.(filePath, currentKnowledgeBasePath);

      // Target already exists, ask user whether to replace
      if (!result?.success && result?.error === 'TARGET_EXISTS') {
        const fileName = result?.data?.sourceName || filePath.split(/[/\\]/).pop();
        const confirmed = window.confirm(
          `A file named "${fileName}" already exists in Agent Knowledge.\n\nDo you want to replace it?`
        );
        if (!confirmed) return;
        // Retry with force mode
        result = await (window as any).electronAPI?.workspace?.movePath?.(filePath, currentKnowledgeBasePath, { force: true });
      }

      if (result?.success) {
        // Clear file tree cache for source directory and knowledge base directory
        const { workspaceOps } = await import('../../lib/chat/workspaceOps');
        if (fileTreeNodeMenuState.workspacePath) {
          await workspaceOps.clearFileTreeCache(fileTreeNodeMenuState.workspacePath);
        }
        await workspaceOps.clearFileTreeCache(currentKnowledgeBasePath);
        // Proactively notify all FileExplorerSections to refresh (including knowledge section that was previously empty)
        workspaceOps.triggerRefresh();
      } else {
        console.error('[FileTreeNode] Failed to move file to knowledge:', result?.error);
        const errMsg = result?.error || 'Unknown error';
        const userMsg = errMsg.includes('EACCES')
          ? `Permission denied.\n\nThe app cannot access this file or folder. Please grant access in System Settings → Privacy & Security → Files and Folders, then try again.`
          : `Failed to move file: ${errMsg}`;
        window.alert(userMsg);
      }
    } catch (error) {
      console.error('[FileTreeNode] Error moving file to knowledge:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const userMsg = errMsg.includes('EACCES')
        ? `Permission denied.\n\nThe app cannot access this file or folder. Please grant access in System Settings → Privacy & Security → Files and Folders, then try again.`
        : `Failed to move file: ${errMsg}`;
      window.alert(userMsg);
    }
  }, [fileTreeNodeMenuState.workspacePath, currentKnowledgeBasePath]);

  // Install skill from file tree node
  const [installSkillDialogState, setInstallSkillDialogState] = useState<{
    open: boolean;
    skillName: string;
  }>({ open: false, skillName: '' });

  const handleFileTreeNodeInstallSkill = useCallback(async (filePath: string) => {
    try {
      if (!window.electronAPI?.skillLibrary?.installSkillFromFilePath) {
        showError('Install skill API not available');
        return;
      }

      const result = await window.electronAPI.skillLibrary.installSkillFromFilePath(filePath);

      if (result.success) {
        showSuccess(`Skill "${result.skillName}" installed successfully`);
        // Trigger skills list refresh
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('skills:refreshFolderExplorer', {
            detail: { skillName: result.skillName }
          }));
        }, 600);

        // Show Apply to Agents dialog only for new installs (not overwrites)
        if (result.skillName && !result.isOverwrite) {
          setInstallSkillDialogState({ open: true, skillName: result.skillName });
        }
      } else if (result.error && result.error !== 'User cancelled the operation') {
        showToast(result.error, 'error', undefined, { persistent: true });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to install skill: ${errorMessage}`);
    }
  }, [showSuccess, showError, showToast]);

  // Global event listener for skills:applyToAgents - allows any component to trigger the dialog
  useEffect(() => {
    const handleApplyToAgents = (event: CustomEvent<{ skillName: string }>) => {
      const { skillName } = event.detail;
      if (skillName) {
        setInstallSkillDialogState({ open: true, skillName });
      }
    };

    window.addEventListener('skills:applyToAgents', handleApplyToAgents as EventListener);
    return () => {
      window.removeEventListener('skills:applyToAgents', handleApplyToAgents as EventListener);
    };
  }, []);

  // Handle showing delete confirmation dialog for agents
  const handleShowDeleteAgentConfirm = useCallback(
    (chatId: string) => {
      const chat = chats.find((c) => c.chat_id === chatId);
      const agentName = chat?.agent?.name || 'Unknown Agent';

      setDeleteConfirmState({
        isOpen: true,
        type: 'agent',
        id: chatId,
        name: agentName,
        isCurrentSession: false,
      });
    },
    [chats],
  );

  // Handle showing delete confirmation dialog for chat sessions
  const handleShowDeleteChatSessionConfirm = useCallback(
    (sessionId: string) => {
      const {
        agentChatSessionCacheManager,
      } = require('../../lib/chat/agentChatSessionCacheManager');
      const currentSessionId =
        agentChatSessionCacheManager.getCurrentChatSessionId();
      const isCurrentSession = currentSessionId === sessionId;

      const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
      const currentAgentChat = chats.find((c) => c.chat_id === currentChatId);
      const session = currentAgentChat?.chatSessions?.find(
        (s) => s.chatSession_id === sessionId,
      );
      const sessionTitle = session?.title || 'Unnamed Session';

      setDeleteConfirmState({
        isOpen: true,
        type: 'chat-session',
        id: sessionId,
        name: sessionTitle,
        isCurrentSession,
      });
    },
    [chats],
  );


  // Handle confirming the deletion
  const handleConfirmDelete = useCallback(async () => {
    const { type, id } = deleteConfirmState;
    if (!id) return;

    try {
      if (type === 'agent') {
        // 🔧 Fix: Check if Agent switch is needed
        // 1. Check if the deleted one is the current chat in cache manager
        const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
        const isDeletingCurrentChat = id === currentChatId;
        
        // 2. 🔧 New: Check if current route belongs to deleted agent (handles deletion from settings page)
        const currentPath = location.pathname;
        const isOnDeletedAgentRoute = currentPath.includes(`/agent/chat/${id}`);
        
        // Switch needed if: deleting current chat, or current route belongs to deleted agent
        const needsSwitch = isDeletingCurrentChat || isOnDeletedAgentRoute;

        console.log('[AppLayout] Delete agent check:', {
          deletedChatId: id,
          currentChatId,
          isDeletingCurrentChat,
          currentPath,
          isOnDeletedAgentRoute,
          needsSwitch,
        });

        if (isDeletingCurrentChat) {
          // Step 1: Notify AgentPage to clean up current Agent
          window.dispatchEvent(
            new CustomEvent('agent:cleanup', {
              detail: { chatId: id, isDeletingCurrentChat: true },
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Step 2: Execute delete operation
        const result = await deleteChat(id);

        if (result.success) {
          // Step 3: If switch needed, switch to Primary Agent
          if (needsSwitch) {
            // Get Primary Agent (from profile data)
            const { profileDataManager } = await import('../../lib/userData');
            // 🔧 Refresh profile data to get latest chats list
            await profileDataManager.refresh();
            const profileCache = profileDataManager.getCache();
            const primaryAgentName = profileCache?.profile?.primaryAgent || 'Kobi';
            
            // 🔧 Get chats from latest profileCache instead of using stale chats from closure
            const latestChats = profileCache?.chats || [];
            const primaryAgentChat = latestChats.find(
              (c: any) => c.agent?.name === primaryAgentName,
            );
            const primaryAgentChatId = primaryAgentChat?.chat_id;

            console.log('[AppLayout] Delete agent - switching to Primary Agent:', {
              deletedChatId: id,
              primaryAgentName,
              primaryAgentChatId,
              latestChatsCount: latestChats.length,
            });

            if (primaryAgentChatId) {
              // 🔧 Fix: Use startNewChatFor to switch to Primary Agent (unified API usage)
              if (window.electronAPI?.agentChat?.startNewChatFor) {
                const result = await window.electronAPI.agentChat.startNewChatFor(primaryAgentChatId);
                console.log('[AppLayout] startNewChatFor result:', result);
                
                if (result.success && result.chatSessionId) {
                  // 🔧 Use returned chatSessionId directly, no waiting needed
                  console.log('[AppLayout] Navigating to new agent route:', {
                    primaryAgentChatId,
                    newChatSessionId: result.chatSessionId,
                  });
                  navigate(`/agent/chat/${primaryAgentChatId}/${result.chatSessionId}`, { replace: true });
                } else {
                  console.error('[AppLayout] Failed to start new chat for Primary Agent:', result);
                }
              }
            } else {
              console.error('[AppLayout] Primary Agent not found:', {
                primaryAgentName,
                availableAgents: latestChats.map((c: any) => c.agent?.name),
              });
            }
          }
          // 🔧 Fix: Show message after successful deletion
          showSuccess(
            `Agent "${deleteConfirmState.name}" deleted successfully`,
          );
        } else {
          showError(
            `Failed to delete agent: ${result.error || 'Unknown error'}`,
          );
        }
      } else if (type === 'chat-session') {
        const currentChatId = agentChatSessionCacheManager.getCurrentChatId();
        if (!currentChatId) {
          showError('No current agent chat available');
          return;
        }

        const { profileDataManager } = await import('../../lib/userData');
        const profileCache = profileDataManager.getCache();
        const profileAlias = profileCache?.profile?.alias;

        if (!profileAlias) {
          showError('No profile alias available');
          return;
        }

        // 🔥 Fix: Adjust deletion order per design document
        // Step 3: If deleting CurrentChatSessionId, switch to new session first
        if (deleteConfirmState.isCurrentSession) {
          // 3a. Record ChatSessionId to delete (already in deleteConfirmState.id)
          const deletingChatSessionId = id;

          // 3b. Switch to new ChatSession via AgentChatManager.startNewChatFor
          // Note: Must use startNewChatFor(chatId) instead of startNewChat()
          // startNewChat() only resets on current instance, doesn't create new ChatSession
          if (window.electronAPI?.agentChat?.startNewChatFor && currentChatId) {
            await window.electronAPI.agentChat.startNewChatFor(currentChatId);
            // 3c. AgentChatManager.switchToChatSession will auto-call notifyCurrentChatSessionIdChanged
            //     Frontend agentChatSessionCacheManager listens to IPC events and auto-syncs currentChatId/currentChatSessionId
            // 3d. Frontend UI auto-renders after data changes via useCurrentChatSessionId hook
          }
        }

        // Step 4: Delete the ChatSession with the corresponding chatSessionId
        // 4a. AgentChatManager deletes corresponding AgentChat instance and registration info
        if (window.electronAPI?.agentChat?.removeAgentChatInstance) {
          await window.electronAPI.agentChat.removeAgentChatInstance(id);
        }

        // 4b & 4c. ProfileCacheManager deletes metadata and local records, syncs to ProfileDataManager
        const { deleteChatSession } = await import(
          '../../lib/chat/chatSessionOps'
        );
        const deleteResult = await deleteChatSession(
          profileAlias,
          currentChatId,
          id,
        );
        if (!deleteResult.success) {
          showError(`Failed to delete session: ${deleteResult.error}`);
          return;
        }

        // 4d. ProfileDataManager returns to frontend for rendering
        await profileDataManager.refresh();

        showSuccess(
          `Session "${deleteConfirmState.name}" deleted successfully`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      setDeleteConfirmState({
        isOpen: false,
        type: 'agent',
        id: null,
        name: null,
        isCurrentSession: false,
      });
    }
  }, [deleteConfirmState, deleteChat, chats, showSuccess, showError, navigate, location.pathname]);

  // Handle canceling the deletion
  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmState({
      isOpen: false,
      type: 'agent',
      id: null,
      name: null,
      isCurrentSession: false,
    });
  }, []);

  // Handle showing duplicate agent dialog
  const handleShowDuplicateAgentDialog = useCallback((chatId: string, agentName: string) => {
    setDuplicateAgentState({
      isOpen: true,
      chatId,
      agentName,
      newName: `${agentName} Copy`,
    });
  }, []);

  // Handle confirming the duplicate action
  const handleConfirmDuplicate = useCallback(async () => {
    const { chatId, newName } = duplicateAgentState;
    
    if (!chatId || !newName.trim()) {
      showError('Invalid agent data for duplication');
      setDuplicateAgentState({
        isOpen: false,
        chatId: null,
        agentName: null,
        newName: '',
      });
      return;
    }
    
    // Find original chat config
    const originalChat = chats.find(c => c.chat_id === chatId);
    if (!originalChat || !originalChat.agent) {
      showError('Original agent not found');
      setDuplicateAgentState({
        isOpen: false,
        chatId: null,
        agentName: null,
        newName: '',
      });
      return;
    }
    
    try {
      // Copy agent config, replace name, set to ON-DEVICE
      const duplicatedAgent = {
        ...originalChat.agent,
        name: newName.trim(),
        source: 'ON-DEVICE' as const,
        version: '1.0.0',
      };
      
      // Create new chat config
      const result = await addChat({
        chat_type: originalChat.chat_type || 'single_agent',
        agent: duplicatedAgent,
      });
      
      if (result.success) {
        showSuccess(`Agent "${newName.trim()}" created successfully!`);
        // Close dialog
        setDuplicateAgentState({
          isOpen: false,
          chatId: null,
          agentName: null,
          newName: '',
        });
        
        // Refresh data
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
      } else {
        showError(result.error || 'Failed to duplicate agent');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to duplicate agent: ${errorMessage}`);
    }
  }, [duplicateAgentState, chats, addChat, showSuccess, showError]);

  // Handle canceling the duplicate action
  const handleCancelDuplicate = useCallback(() => {
    setDuplicateAgentState({
      isOpen: false,
      chatId: null,
      agentName: null,
      newName: '',
    });
  }, []);

  // Handle showing rename chat session dialog
  const handleShowRenameChatSessionDialog = useCallback((chatId: string, sessionId: string, title: string) => {
    setRenameChatSessionState({
      isOpen: true,
      chatId,
      sessionId,
      newTitle: title,
    });
  }, []);

  // Handle confirming the rename action
  const handleConfirmRenameChatSession = useCallback(async () => {
    const { chatId, sessionId, newTitle } = renameChatSessionState;

    if (!chatId || !sessionId || !newTitle.trim()) {
      return;
    }

    try {
      const { profileDataManager } = await import('../../lib/userData');
      const profileCache = profileDataManager.getCache();
      const alias = profileCache?.profile?.alias;

      if (!alias) {
        showError('User not authenticated');
        return;
      }

      const result = await (window as any).electronAPI?.profile?.renameChatSession(
        alias,
        chatId,
        sessionId,
        newTitle.trim(),
      );

      if (result?.success) {
        showSuccess('Chat session renamed successfully');
      } else {
        showError(result?.error || 'Failed to rename chat session');
      }
    } catch (error) {
      showError('Failed to rename chat session');
    } finally {
      setRenameChatSessionState({
        isOpen: false,
        chatId: null,
        sessionId: null,
        newTitle: '',
      });
    }
  }, [renameChatSessionState, showSuccess, showError]);

  // Handle canceling the rename action
  const handleCancelRenameChatSession = useCallback(() => {
    setRenameChatSessionState({
      isOpen: false,
      chatId: null,
      sessionId: null,
      newTitle: '',
    });
  }, []);

  // Listen for delete events
  useEffect(() => {
    const handleDeleteAgentEvent = (event: CustomEvent) => {
      const { chatId } = event.detail;
      handleShowDeleteAgentConfirm(chatId);
    };

    const handleDeleteChatSessionEvent = (event: CustomEvent) => {
      const { sessionId } = event.detail;
      handleShowDeleteChatSessionConfirm(sessionId);
    };

    const handleRenameChatSessionEvent = (event: CustomEvent) => {
      const { chatId, sessionId, title } = event.detail;
      handleShowRenameChatSessionDialog(chatId, sessionId, title);
    };

    window.addEventListener(
      'agent:deleteAgent',
      handleDeleteAgentEvent as EventListener,
    );
    window.addEventListener(
      'chatSession:delete',
      handleDeleteChatSessionEvent as EventListener,
    );
    window.addEventListener(
      'chatSession:rename',
      handleRenameChatSessionEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'agent:deleteAgent',
        handleDeleteAgentEvent as EventListener,
      );
      window.removeEventListener(
        'chatSession:delete',
        handleDeleteChatSessionEvent as EventListener,
      );
      window.removeEventListener(
        'chatSession:rename',
        handleRenameChatSessionEvent as EventListener,
      );
    };
  }, [
    handleShowDeleteAgentConfirm,
    handleShowDeleteChatSessionConfirm,
    handleShowRenameChatSessionDialog,
  ]);

  // 🔥 Listen for download ChatSession events
  useEffect(() => {
    const handleDownloadChatSessionEvent = async (event: Event) => {
      const customEvent = event as CustomEvent<{
        chatId: string;
        sessionId: string;
        title: string;
      }>;
      const { chatId, sessionId, title } = customEvent.detail;
      
      try {
        const { profileDataManager } = await import('../../lib/userData');
        const profileCache = profileDataManager.getCache();
        const alias = profileCache?.profile?.alias;
        
        if (!alias) {
          showError('User not authenticated');
          return;
        }
        
        const result = await (window as any).electronAPI?.chatSessionOps?.downloadChatSession(
          alias,
          chatId,
          sessionId,
          title
        );
        
        if (result?.success && result?.filePath) {
          // Success: persistent toast + Open Folder button
          showToast(
            `Chat session saved as "${result.fileName}"`,
            'success',
            undefined,
            {
              persistent: true,
              actions: [
                {
                  label: 'Open Folder',
                  variant: 'primary' as const,
                  onClick: () => {
                    (window as any).electronAPI?.workspace?.showInFolder(result.filePath);
                  }
                }
              ]
            }
          );
        } else {
          // Failure: non-persistent toast
          showError(result?.error || 'Failed to download chat session');
        }
      } catch (error) {
        showError('Failed to download chat session');
      }
    };
    
    window.addEventListener(
      'chatSession:download',
      handleDownloadChatSessionEvent as EventListener,
    );
    
    return () => {
      window.removeEventListener(
        'chatSession:download',
        handleDownloadChatSessionEvent as EventListener,
      );
    };
  }, [showToast, showError]);

  // ImageViewer event handling
  useEffect(() => {
    const handleOpenImageViewer = (event: CustomEvent) => {
      const { images, initialIndex } = event.detail;
      setImageViewerState({
        isOpen: true,
        images,
        initialIndex,
      });
    };

    window.addEventListener(
      'imageViewer:open',
      handleOpenImageViewer as EventListener,
    );

    return () => {
      window.removeEventListener(
        'imageViewer:open',
        handleOpenImageViewer as EventListener,
      );
    };
  }, []);

  // ImageGallery context menu event handling
  useEffect(() => {
    const handleImageGalleryContextMenu = (event: CustomEvent) => {
      const {
        event: mouseEvent,
        imageData,
        galleryImages,
        initialIndex,
      } = event.detail;
      handleImageGalleryMenuToggle(
        mouseEvent,
        imageData,
        galleryImages,
        initialIndex,
      );
    };

    window.addEventListener(
      'imageGallery:contextMenu',
      handleImageGalleryContextMenu as EventListener,
    );

    return () => {
      window.removeEventListener(
        'imageGallery:contextMenu',
        handleImageGalleryContextMenu as EventListener,
      );
    };
  }, []);

  const handleCloseImageViewer = useCallback(() => {
    setImageViewerState({
      isOpen: false,
      images: [],
      initialIndex: 0,
    });
  }, []);

  // FileViewer event handling
  useEffect(() => {
    const handleOpenFileViewer = (event: CustomEvent) => {
      const { file } = event.detail;
      setFileViewerState({
        isOpen: true,
        file,
      });
    };

    window.addEventListener(
      'fileViewer:open',
      handleOpenFileViewer as EventListener,
    );

    return () => {
      window.removeEventListener(
        'fileViewer:open',
        handleOpenFileViewer as EventListener,
      );
    };
  }, []);

  const handleCloseFileViewer = useCallback(() => {
    setFileViewerState({
      isOpen: false,
      file: null,
    });
  }, []);

  // Removed window menu operation handlers as custom WindowHeader is no longer used

  // Get user display name (kept for logging purposes)
  const user = authData?.ghcAuth?.user;
  const userDisplayName =
    user?.name || user?.login || authData?.ghcAuth?.alias || 'Unknown User';

  return (
    <LayoutProvider>
      <PasteToWorkspaceProvider>
      <AppLayoutContent
        authData={authData}
        onLogout={handleUserLogout}
        onUserMenuToggle={handleUserMenuToggle}
        isUserMenuOpen={isUserMenuOpen}
        onNewAgent={onNewAgent}
        onEditAgent={onEditAgent}
        onDeleteAgent={onDeleteAgent}
        handleEditAgentClick={handleEditAgentClick}
        handleDeleteAgentClick={handleDeleteAgentClick}
        onAgentMenuToggle={handleAgentMenuToggle}
        handleAgentMenuClose={handleAgentMenuClose}
        agentMenuState={agentMenuState}
        userMenuRef={userMenuRef}
        agentMenuRef={agentMenuRef}
        onWorkspaceMenuToggle={handleWorkspaceMenuToggle}
        handleWorkspaceMenuClose={handleWorkspaceMenuClose}
        workspaceMenuState={workspaceMenuState}
        workspaceMenuRef={workspaceMenuRef}
        onEditAgentMenuToggle={handleEditAgentMenuToggle}
        handleEditAgentMenuClose={handleEditAgentMenuClose}
        editAgentMenuState={editAgentMenuState}
        editAgentMenuRef={editAgentMenuRef}
        onAttachMenuToggle={handleAttachMenuToggle}
        handleAttachMenuClose={handleAttachMenuClose}
        attachMenuState={attachMenuState}
        attachMenuRef={attachMenuRef}
        onChatSessionMenuToggle={handleChatSessionMenuToggle}
        handleChatSessionMenuClose={handleChatSessionMenuClose}
        chatSessionMenuState={chatSessionMenuState}
        chatSessionMenuRef={chatSessionMenuRef}
        onFileTreeNodeMenuToggle={handleFileTreeNodeMenuToggle}
        handleFileTreeNodeMenuClose={handleFileTreeNodeMenuClose}
        handleFileTreeNodeDelete={handleFileTreeNodeDelete}
        fileTreeNodeMenuState={fileTreeNodeMenuState}
        fileTreeNodeMenuRef={fileTreeNodeMenuRef}
        handleFileTreeNodeInstallSkill={handleFileTreeNodeInstallSkill}
        handleFileTreeNodeMoveToKnowledge={handleFileTreeNodeMoveToKnowledge}
        currentKnowledgeBasePath={currentKnowledgeBasePath}
        installSkillDialogState={installSkillDialogState}
        setInstallSkillDialogState={setInstallSkillDialogState}
        handleSendFeedback={handleSendFeedback}
        messages={messages}
        allMessages={allMessages}
        streamingMessageId={streamingMessageId}
        onSendMessage={onSendMessage}
        onCancelChat={onCancelChat}
        onApprovalResponse={onApprovalResponse}
        pendingApprovalRequest={pendingApprovalRequest}
        config={config}
        onSaveConfig={onSaveConfig}
        showConfigModal={showConfigModal}
        showMcpConfigModal={showMcpConfigModal}
        sidepaneWidth={sidepaneWidth}
        setSidepaneWidth={setSidepaneWidth}
        isDragging={isDragging}
        onMcpServerConnect={onMcpServerConnect}
        onMcpServerDisconnect={onMcpServerDisconnect}
        onMcpServerReconnect={onMcpServerReconnect}
        onMcpServerDelete={onMcpServerDelete}
        onMcpServerEdit={onMcpServerEdit}
        deleteConfirmState={deleteConfirmState}
        onConfirmDelete={handleConfirmDelete}
        onCancelDelete={handleCancelDelete}
        duplicateAgentState={duplicateAgentState}
        onShowDuplicateAgentDialog={handleShowDuplicateAgentDialog}
        onConfirmDuplicate={handleConfirmDuplicate}
        onCancelDuplicate={handleCancelDuplicate}
        setDuplicateAgentState={setDuplicateAgentState}
        renameChatSessionState={renameChatSessionState}
        onConfirmRenameChatSession={handleConfirmRenameChatSession}
        onCancelRenameChatSession={handleCancelRenameChatSession}
        setRenameChatSessionState={setRenameChatSessionState}
        imageViewerState={imageViewerState}
        onCloseImageViewer={handleCloseImageViewer}
        fileViewerState={fileViewerState}
        onCloseFileViewer={handleCloseFileViewer}
        onImageGalleryMenuToggle={handleImageGalleryMenuToggle}
        handleImageGalleryMenuClose={handleImageGalleryMenuClose}
        imageGalleryMenuState={imageGalleryMenuState}
        imageGalleryMenuRef={imageGalleryMenuRef}
      />
      </PasteToWorkspaceProvider>
    </LayoutProvider>
  );
};

// Internal component with access to LayoutProvider context
interface AppLayoutContentProps {
  authData: AuthData | null;
  onLogout: () => void;
  onUserMenuToggle: () => void;
  isUserMenuOpen: boolean;
  onNewAgent?: () => void;
  onEditAgent?: (chatId: string) => void;
  onDeleteAgent?: (chatId: string) => void;
  onMcpServerConnect?: (serverName: string) => void;
  onMcpServerDisconnect?: (serverName: string) => void;
  onMcpServerReconnect?: (serverName: string) => void;
  onMcpServerDelete?: (serverName: string) => void;
  onMcpServerEdit?: (serverName: string) => void;
  handleEditAgentClick: (chatId: string) => void;
  handleDeleteAgentClick: (chatId: string) => void;
  onAgentMenuToggle: (chatId: string, buttonElement: HTMLElement) => void;
  handleAgentMenuClose: () => void;
  agentMenuState: {
    isOpen: boolean;
    chatId: string | null;
    position: { top: number; left: number } | null;
  };
  userMenuRef: React.RefObject<HTMLDivElement>;
  agentMenuRef: React.RefObject<HTMLDivElement>;
  handleSendFeedback: () => void;
  onWorkspaceMenuToggle: (
    buttonElement: HTMLElement,
    menuActions: WorkspaceMenuActions,
  ) => void;
  handleWorkspaceMenuClose: () => void;
  workspaceMenuState: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
    actions: WorkspaceMenuActions | null;
  };
  workspaceMenuRef: React.RefObject<HTMLDivElement>;
  onEditAgentMenuToggle: (buttonElement: HTMLElement) => void;
  handleEditAgentMenuClose: () => void;
  editAgentMenuState: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
  };
  editAgentMenuRef: React.RefObject<HTMLDivElement>;
  onAttachMenuToggle: (buttonElement: HTMLElement) => void;
  handleAttachMenuClose: () => void;
  attachMenuState: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
  };
  attachMenuRef: React.RefObject<HTMLDivElement>;
  onChatSessionMenuToggle: (
    chatId: string,
    sessionId: string,
    title: string,  // 🔥 New: ChatSession title
    buttonElement: HTMLElement,
  ) => void;
  handleChatSessionMenuClose: () => void;
  chatSessionMenuState: {
    isOpen: boolean;
    chatId: string | null;
    sessionId: string | null;
    title: string | null;  // 🔥 New: ChatSession title
    position: { top: number; left: number } | null;
  };
  chatSessionMenuRef: React.RefObject<HTMLDivElement>;
  onFileTreeNodeMenuToggle: (
    event: React.MouseEvent,
    node: any,
    workspacePath: string,
  ) => void;
  handleFileTreeNodeMenuClose: () => void;
  handleFileTreeNodeDelete: (deletedPath: string) => void;
  fileTreeNodeMenuState: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
    node: any | null;
    workspacePath: string | null;
  };
  fileTreeNodeMenuRef: React.RefObject<HTMLDivElement>;
  handleFileTreeNodeInstallSkill: (filePath: string) => void;
  handleFileTreeNodeMoveToKnowledge: (filePath: string) => void;
  currentKnowledgeBasePath: string;
  installSkillDialogState: { open: boolean; skillName: string };
  setInstallSkillDialogState: React.Dispatch<React.SetStateAction<{ open: boolean; skillName: string }>>;
  onImageGalleryMenuToggle: (
    event: React.MouseEvent,
    imageData: { url: string; alt?: string; index: number },
    galleryImages?: Array<{ id: string; url: string; alt?: string }>,
    initialIndex?: number,
  ) => void;
  handleImageGalleryMenuClose: () => void;
  imageGalleryMenuState: {
    isOpen: boolean;
    position: { top: number; left: number } | null;
    imageData: { url: string; alt?: string; index: number } | null;
    galleryImages: Array<{ id: string; url: string; alt?: string }> | null;
    initialIndex: number;
  };
  imageGalleryMenuRef: React.RefObject<HTMLDivElement>;
  deleteConfirmState: {
    isOpen: boolean;
    type: 'agent' | 'chat-session';
    id: string | null;
    name: string | null;
    isCurrentSession?: boolean;
  };
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  duplicateAgentState: {
    isOpen: boolean;
    chatId: string | null;
    agentName: string | null;
    newName: string;
  };
  onShowDuplicateAgentDialog: (chatId: string, agentName: string) => void;
  onConfirmDuplicate: () => void;
  onCancelDuplicate: () => void;
  setDuplicateAgentState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    chatId: string | null;
    agentName: string | null;
    newName: string;
  }>>;
  renameChatSessionState: {
    isOpen: boolean;
    chatId: string | null;
    sessionId: string | null;
    newTitle: string;
  };
  onConfirmRenameChatSession: () => void;
  onCancelRenameChatSession: () => void;
  setRenameChatSessionState: React.Dispatch<React.SetStateAction<{
    isOpen: boolean;
    chatId: string | null;
    sessionId: string | null;
    newTitle: string;
  }>>;
  imageViewerState: {
    isOpen: boolean;
    images: Array<{ id: string; url: string; alt?: string }>;
    initialIndex: number;
  };
  onCloseImageViewer: () => void;
  fileViewerState: {
    isOpen: boolean;
    file: OverlayFileDescriptor | null;
  };
  onCloseFileViewer: () => void;
  messages: Message[];
  allMessages: Message[];
  streamingMessageId?: string;
  onSendMessage: (message: Message) => void;
  onCancelChat?: () => void; // 🔥 New: Cancel chat callback
  onApprovalResponse?: (approved: boolean) => void; // 🔥 New: Approval request callback
  pendingApprovalRequest?: {
    requestId: string;
    toolName: string;
    path: string;
  } | null; // 🔥 New: Approval request state
  config: ChatConfig;
  onSaveConfig: (config: ChatConfig) => void;
  showConfigModal?: boolean;
  showMcpConfigModal?: boolean;
  sidepaneWidth?: number;
  setSidepaneWidth?: (width: number) => void;
  isDragging?: boolean;
}

const AppLayoutContent: React.FC<AppLayoutContentProps> = ({
  authData,
  onLogout,
  onUserMenuToggle,
  isUserMenuOpen,
  onNewAgent,
  onEditAgent,
  onDeleteAgent,
  onMcpServerConnect,
  onMcpServerDisconnect,
  onMcpServerReconnect,
  onMcpServerDelete,
  onMcpServerEdit,
  handleEditAgentClick,
  handleDeleteAgentClick,
  onAgentMenuToggle,
  handleAgentMenuClose,
  agentMenuState,
  userMenuRef,
  agentMenuRef,
  handleSendFeedback,
  onEditAgentMenuToggle,
  handleEditAgentMenuClose,
  editAgentMenuState,
  editAgentMenuRef,
  onAttachMenuToggle,
  handleAttachMenuClose,
  attachMenuState,
  attachMenuRef,
  onChatSessionMenuToggle,
  handleChatSessionMenuClose,
  chatSessionMenuState,
  chatSessionMenuRef,
  onFileTreeNodeMenuToggle,
  handleFileTreeNodeMenuClose,
  handleFileTreeNodeDelete,
  fileTreeNodeMenuState,
  fileTreeNodeMenuRef,
  handleFileTreeNodeInstallSkill,
  handleFileTreeNodeMoveToKnowledge,
  currentKnowledgeBasePath,
  installSkillDialogState,
  setInstallSkillDialogState,
  onImageGalleryMenuToggle,
  handleImageGalleryMenuClose,
  imageGalleryMenuState,
  imageGalleryMenuRef,
  onWorkspaceMenuToggle,
  handleWorkspaceMenuClose,
  workspaceMenuState,
  workspaceMenuRef,
  messages,
  allMessages,
  streamingMessageId,
  onSendMessage,
  onCancelChat,
  onApprovalResponse,
  pendingApprovalRequest,
  config,
  onSaveConfig,
  showConfigModal,
  showMcpConfigModal,
  sidepaneWidth,
  setSidepaneWidth,
  isDragging,
  deleteConfirmState,
  onConfirmDelete,
  onCancelDelete,
  duplicateAgentState,
  onShowDuplicateAgentDialog,
  onConfirmDuplicate,
  onCancelDuplicate,
  setDuplicateAgentState,
  renameChatSessionState,
  onConfirmRenameChatSession,
  onCancelRenameChatSession,
  setRenameChatSessionState,
  imageViewerState,
  onCloseImageViewer,
  fileViewerState,
  onCloseFileViewer,
}) => {
  const { isMinimalMode } = useLayout();
  const navigate = useNavigate();
  const location = useLocation();
  const { chats } = useProfileData();

  // Check if agent name already exists
  const isDuplicateNameExists = duplicateAgentState.newName.trim() 
    ? chats.some(chat => chat.agent?.name?.toLowerCase() === duplicateAgentState.newName.trim().toLowerCase())
    : false;

  const handleSettingsClick = () => {
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings');
  };

  return (
    <div className={`app-layout ${isMinimalMode ? 'minimal-mode' : ''}`}>
      {/* Main body with navigation and content - WindowsTitleBar moved to App.tsx level */}
      <div className="app-body">
        {/* LeftNavigation - hidden in minimal mode */}
        {!isMinimalMode && (
          <LeftNavigation
            authData={authData}
            onLogout={onLogout}
            onUserMenuToggle={onUserMenuToggle}
            isUserMenuOpen={isUserMenuOpen}
            onNewAgent={onNewAgent || (() => {})}
            onAgentMenuToggle={onAgentMenuToggle}
            openMenuChatId={
              agentMenuState.isOpen ? agentMenuState.chatId : null
            }
            onChatSessionMenuToggle={onChatSessionMenuToggle}
            openMenuChatSessionId={
              chatSessionMenuState.isOpen
                ? chatSessionMenuState.sessionId
                : null
            }
          />
        )}

        <ContentContainer
          messages={messages}
          allMessages={allMessages}
          streamingMessageId={streamingMessageId}
          onSendMessage={onSendMessage}
          onCancelChat={onCancelChat}
          onApprovalResponse={onApprovalResponse}
          pendingApprovalRequest={pendingApprovalRequest}
          config={config}
          onSaveConfig={onSaveConfig}
          onNewAgent={onNewAgent}
          onEditAgent={onEditAgent}
          onDeleteAgent={onDeleteAgent}
          showConfigModal={showConfigModal}
          showMcpConfigModal={showMcpConfigModal}
          sidepaneWidth={sidepaneWidth}
          setSidepaneWidth={setSidepaneWidth}
          isDragging={isDragging}
          onWorkspaceMenuToggle={onWorkspaceMenuToggle}
          handleWorkspaceMenuClose={handleWorkspaceMenuClose}
          workspaceMenuState={workspaceMenuState}
          workspaceMenuRef={workspaceMenuRef}
          onEditAgentMenuToggle={onEditAgentMenuToggle}
          onAttachMenuToggle={onAttachMenuToggle}
          onFileTreeNodeMenuToggle={onFileTreeNodeMenuToggle}
        />


        {/* Global Agent dropdown menu - floating at AppLayout level */}
        {!isMinimalMode && agentMenuState.isOpen && agentMenuState.position && (
          <AgentDropdownMenu
            agentMenuRef={agentMenuRef}
            chatId={agentMenuState.chatId}
            position={agentMenuState.position}
            onEditAgent={onEditAgent}
            onDeleteAgent={onDeleteAgent}
            onDuplicateAgent={onShowDuplicateAgentDialog}
            handleEditAgentClick={handleEditAgentClick}
            handleDeleteAgentClick={handleDeleteAgentClick}
            onClose={handleAgentMenuClose}
          />
        )}

        {/* Global user dropdown menu - only shown in non-minimal mode */}
        {!isMinimalMode && isUserMenuOpen && (
          <div ref={userMenuRef} className="dropdown-menu user-dropdown-menu">
            <button
              className="dropdown-menu-item"
              onClick={handleSettingsClick}
              title="Open Settings"
            >
              <span className="dropdown-menu-item-icon">
                <Settings size={16} strokeWidth={1.5} />
              </span>
              <span className="dropdown-menu-item-text">Settings</span>
            </button>
            <button
              className="dropdown-menu-item"
              onClick={handleSendFeedback}
              title="Send feedback"
            >
              <span className="dropdown-menu-item-icon">
                <MessageSquareText size={16} strokeWidth={1.5} />
              </span>
              <span className="dropdown-menu-item-text">Send Feedback</span>
            </button>
            <button className="dropdown-menu-item danger" onClick={onLogout}>
              <span className="dropdown-menu-item-icon">
                <LogOut size={16} strokeWidth={1.5} />
              </span>
              <span className="dropdown-menu-item-text">Logout</span>
            </button>
          </div>
        )}


        {/* Global Workspace Explorer dropdown menu - floating at AppLayout level */}
        {!isMinimalMode && workspaceMenuState.isOpen && workspaceMenuState.position && workspaceMenuState.actions && (
          <WorkspaceMenuDropdown
            workspaceMenuRef={workspaceMenuRef}
            position={workspaceMenuState.position}
            actions={workspaceMenuState.actions}
            onClose={handleWorkspaceMenuClose}
          />
        )}

        {/* Global Edit Agent dropdown menu - floating at AppLayout level */}
        {!isMinimalMode && editAgentMenuState.isOpen && editAgentMenuState.position && (
          <EditAgentMenuDropdown
            editAgentMenuRef={editAgentMenuRef}
            position={editAgentMenuState.position}
            onClose={handleEditAgentMenuClose}
          />
        )}

        {/* Global Attach dropdown menu - floating at AppLayout level */}
        {!isMinimalMode && attachMenuState.isOpen && attachMenuState.position && (
          <AttachMenuDropdown
            attachMenuRef={attachMenuRef}
            position={attachMenuState.position}
            onClose={handleAttachMenuClose}
          />
        )}

        {/* Global ChatSession dropdown menu - floating at AppLayout level */}
        {!isMinimalMode && chatSessionMenuState.isOpen && chatSessionMenuState.position && chatSessionMenuState.sessionId && (
          <ChatSessionDropdownMenu
            chatSessionMenuRef={chatSessionMenuRef}
            chatId={chatSessionMenuState.chatId}
            sessionId={chatSessionMenuState.sessionId}
            title={chatSessionMenuState.title || 'Chat Session'}
            position={chatSessionMenuState.position}
            onClose={handleChatSessionMenuClose}
          />
        )}

        {/* Global FileTreeNode context menu - floating at AppLayout level */}
        {fileTreeNodeMenuState.isOpen && fileTreeNodeMenuState.position && fileTreeNodeMenuState.node && fileTreeNodeMenuState.workspacePath && (
          <FileTreeNodeContextMenu
            fileTreeNodeMenuRef={fileTreeNodeMenuRef}
            node={fileTreeNodeMenuState.node}
            workspacePath={fileTreeNodeMenuState.workspacePath}
            position={fileTreeNodeMenuState.position}
            onClose={handleFileTreeNodeMenuClose}
            onDelete={handleFileTreeNodeDelete}
            onInstallSkill={handleFileTreeNodeInstallSkill}
            onMoveToKnowledge={handleFileTreeNodeMoveToKnowledge}
            knowledgeBasePath={currentKnowledgeBasePath}
          />
        )}

        {/* Global ImageGallery context menu - floating at AppLayout level */}
        {imageGalleryMenuState.isOpen && imageGalleryMenuState.position && imageGalleryMenuState.imageData && (
          <ImageGalleryContextMenu
            imageGalleryMenuRef={imageGalleryMenuRef}
            imageData={imageGalleryMenuState.imageData}
            galleryImages={imageGalleryMenuState.galleryImages}
            initialIndex={imageGalleryMenuState.initialIndex}
            position={imageGalleryMenuState.position}
            onClose={handleImageGalleryMenuClose}
          />
        )}

        {/* Global delete confirmation dialog - floating at AppLayout level, visible in all views */}
        {deleteConfirmState.isOpen && (
          <div className="delete-confirm-overlay">
            <div className="delete-confirm-modal">
              <div className="modal-header">
                <h2>
                  {deleteConfirmState.type === 'agent' ? 'Delete Agent' : 'Delete Chat Session'}
                </h2>
              </div>
              <div className="modal-content">
                <p>Are you sure you want to delete <strong>{deleteConfirmState.name}</strong>?</p>
                <p className="warning-text">
                  {deleteConfirmState.type === 'chat-session' && deleteConfirmState.isCurrentSession
                    ? "This is the currently selected session. After deletion, it will switch to a new conversation. This action cannot be undone and all chat history will be permanently deleted."
                    : "This action cannot be undone. All chat history will be permanently deleted."
                  }
                </p>
              </div>
              <div className="modal-actions">
                <button className="btn-cancel" onClick={onCancelDelete}>
                  Cancel
                </button>
                <button
                  className="btn-delete"
                  onClick={onConfirmDelete}
                >
                  {deleteConfirmState.type === 'agent' ? 'Delete Agent' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global duplicate Agent dialog - floating at AppLayout level */}
        {duplicateAgentState.isOpen && (
          <div className="delete-confirm-overlay">
            <div className="delete-confirm-modal duplicate-agent-modal">
              <div className="modal-header">
                <h2>Duplicate Agent</h2>
              </div>
              <div className="modal-content">
                <p>Enter a name for the copy of <strong>{duplicateAgentState.agentName}</strong></p>
                <input
                  type="text"
                  className={`duplicate-agent-input ${isDuplicateNameExists ? 'warning' : ''}`}
                  value={duplicateAgentState.newName}
                  onChange={(e) => setDuplicateAgentState((prev: typeof duplicateAgentState) => ({ ...prev, newName: e.target.value }))}
                  placeholder="Enter new agent name"
                  autoFocus
                />
                {isDuplicateNameExists && (
                  <div className="warning-message">⚠️ Agent name already exists</div>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn-cancel" onClick={onCancelDuplicate}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={onConfirmDuplicate}
                  disabled={!duplicateAgentState.newName.trim() || isDuplicateNameExists}
                >
                  Duplicate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global rename ChatSession dialog - floating at AppLayout level */}
        {renameChatSessionState.isOpen && (
          <div className="delete-confirm-overlay">
            <div className="delete-confirm-modal duplicate-agent-modal">
              <div className="modal-header">
                <h2>Rename Chat Session</h2>
              </div>
              <div className="modal-content">
                <p>Enter a new name for this chat session</p>
                <input
                  type="text"
                  className="duplicate-agent-input"
                  value={renameChatSessionState.newTitle}
                  onChange={(e) => setRenameChatSessionState((prev: typeof renameChatSessionState) => ({ ...prev, newTitle: e.target.value }))}
                  placeholder="Enter session name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameChatSessionState.newTitle.trim()) {
                      onConfirmRenameChatSession();
                    }
                  }}
                />
              </div>
              <div className="modal-actions">
                <button className="btn-cancel" onClick={onCancelRenameChatSession}>
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={onConfirmRenameChatSession}
                  disabled={!renameChatSessionState.newTitle.trim()}
                >
                  Rename
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global OverlayImageViewer - floating at top level */}
        <OverlayImageViewer
          images={imageViewerState.images}
          initialIndex={imageViewerState.initialIndex}
          isOpen={imageViewerState.isOpen}
          onClose={onCloseImageViewer}
        />

        {/* Global OverlayFileViewer - floating at top level */}
        <OverlayFileViewer
          file={fileViewerState.file}
          isOpen={fileViewerState.isOpen}
          onClose={onCloseFileViewer}
          onInstallSkill={handleFileTreeNodeInstallSkill}
        />

        {/* Global Install Skill Apply to Agents Dialog - floating at top level */}
        <ApplySkillToAgentsDialog
          open={installSkillDialogState.open}
          onOpenChange={(open) => setInstallSkillDialogState(prev => ({ ...prev, open }))}
          skillName={installSkillDialogState.skillName}
        />
      </div>
    </div>
  );
};


export default AppLayout;