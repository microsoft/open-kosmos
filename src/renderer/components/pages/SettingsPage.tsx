import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import SettingsNavigation from '../settings/SettingsNavigation';
import { AgentContextType } from '../../types/agentContextTypes';
import {
  McpServerDropdownMenu,
  McpAddMenuDropdown,
  SkillsAddMenuDropdown,
  SkillDropdownMenu,
} from '../menu';
import { useProfileData, useChats, useProfileDataRefresh } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import ApplySkillToAgentsDialog from '../skills/ApplySkillToAgentsDialog';
import '../../styles/ContentView.css';
import '../../styles/DropdownMenu.css';

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Settings page simplified context state
  const [sidepaneWidth, setSidepaneWidth] = useState(300);

  // MCP Server dropdown menu state management
  const [mcpServerMenuState, setMcpServerMenuState] = useState<{
    isOpen: boolean;
    serverName: string | null;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    serverName: null,
    position: null,
  });
  const mcpServerMenuRef = useRef<HTMLDivElement>(null);

  // MCP add menu state management
  const [mcpAddMenuState, setMcpAddMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    position: null,
  });
  const mcpAddMenuRef = useRef<HTMLDivElement>(null);

  // Skills add menu state management
  const [skillsAddMenuState, setSkillsAddMenuState] = useState<{
    isOpen: boolean;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    position: null,
  });
  const skillsAddMenuRef = useRef<HTMLDivElement>(null);

  // Skill dropdown menu state management
  const [skillMenuState, setSkillMenuState] = useState<{
    isOpen: boolean;
    skillName: string | null;
    position: { top: number; left: number } | null;
  }>({
    isOpen: false,
    skillName: null,
    position: null,
  });
  const skillMenuRef = useRef<HTMLDivElement>(null);

  // Delete skill confirmation dialog state
  const [deleteSkillDialog, setDeleteSkillDialog] = useState<{
    isOpen: boolean;
    skillName: string | null;
    usedByAgents: string[];
  }>({
    isOpen: false,
    skillName: null,
    usedByAgents: [],
  });

  // Delete MCP server confirmation dialog state
  const [deleteMcpDialog, setDeleteMcpDialog] = useState<{
    isOpen: boolean;
    serverName: string | null;
  }>({
    isOpen: false,
    serverName: null,
  });

  // Apply skill to agents dialog state
  const [applySkillDialogState, setApplySkillDialogState] = useState<{
    open: boolean;
    skillName: string;
  }>({ open: false, skillName: '' });

  // Hook dependencies
  const { chats } = useProfileData();
  const { showSuccess, showError } = useToast();

  // Global event listener for skills:applyToAgents - allows SkillsView to trigger the dialog
  useEffect(() => {
    const handleApplyToAgents = (event: CustomEvent<{ skillName: string }>) => {
      const { skillName } = event.detail;
      if (skillName) {
        setApplySkillDialogState({ open: true, skillName });
      }
    };

    window.addEventListener('skills:applyToAgents', handleApplyToAgents as EventListener);
    return () => {
      window.removeEventListener('skills:applyToAgents', handleApplyToAgents as EventListener);
    };
  }, []);

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        mcpServerMenuRef.current &&
        !mcpServerMenuRef.current.contains(event.target as Node)
      ) {
        setMcpServerMenuState({
          isOpen: false,
          serverName: null,
          position: null,
        });
      }
      if (
        mcpAddMenuRef.current &&
        !mcpAddMenuRef.current.contains(event.target as Node)
      ) {
        setMcpAddMenuState({ isOpen: false, position: null });
      }
      if (
        skillsAddMenuRef.current &&
        !skillsAddMenuRef.current.contains(event.target as Node)
      ) {
        setSkillsAddMenuState({ isOpen: false, position: null });
      }
      if (
        skillMenuRef.current &&
        !skillMenuRef.current.contains(event.target as Node)
      ) {
        setSkillMenuState({ isOpen: false, skillName: null, position: null });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // MCP Server menu handler
  const handleMcpServerMenuToggle = (
    serverName: string,
    buttonElement: HTMLElement,
  ) => {
    if (
      mcpServerMenuState.isOpen &&
      mcpServerMenuState.serverName === serverName
    ) {
      // Close menu
      setMcpServerMenuState({
        isOpen: false,
        serverName: null,
        position: null,
      });
    } else {
      // Calculate menu position
      const rect = buttonElement.getBoundingClientRect();
      const position = {
        top: rect.bottom + 4,
        left: rect.left,
        triggerTop: rect.top, // Pass trigger top for upward positioning
      };
      setMcpServerMenuState({ isOpen: true, serverName, position });
    }
  };

  const handleMcpServerMenuClose = () => {
    setMcpServerMenuState({ isOpen: false, serverName: null, position: null });
  };

  // MCP add menu handler
  const handleMcpAddMenuToggle = (buttonElement: HTMLElement) => {
    setMcpAddMenuState((prevState) => {
      // If menu is already open, close it
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }

      // Otherwise, open menu and calculate best position
      const rect = buttonElement.getBoundingClientRect();
      const menuWidth = 200; // Estimated menu width
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Calculate horizontal position - prevent exceeding right boundary
      let left = rect.left;
      if (left + menuWidth > windowWidth) {
        left = rect.right - menuWidth; // Right-align to button's right edge
      }

      // Calculate vertical position - prevent exceeding bottom boundary
      let top = rect.bottom + 4;
      const menuHeight = 120; // Estimated menu height (3 items)
      if (top + menuHeight > windowHeight) {
        top = rect.top - menuHeight - 4; // Show above the button
      }

      const position = { top, left, triggerTop: rect.top };
      return { isOpen: true, position };
    });
  };

  const handleMcpAddMenuClose= () => {
    setMcpAddMenuState({ isOpen: false, position: null });
  };

  // Skills add menu handler
  const handleSkillsAddMenuToggle = (buttonElement: HTMLElement) => {
    setSkillsAddMenuState((prevState) => {
      // If menu is already open, close it
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }

      // Otherwise, open menu and calculate best position
      const rect = buttonElement.getBoundingClientRect();
      const menuWidth = 200; // Estimated menu width
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Calculate horizontal position - prevent exceeding right boundary
      let left = rect.left;
      if (left + menuWidth > windowWidth) {
        left = rect.right - menuWidth; // Right-align to button's right edge
      }

      // Calculate vertical position - prevent exceeding bottom boundary
      let top = rect.bottom + 4;
      const menuHeight = 80; // Estimated menu height (2 items)
      if (top + menuHeight > windowHeight) {
        top = rect.top - menuHeight - 4; // Show above the button
      }

      const position = { top, left, triggerTop: rect.top };
      return { isOpen: true, position };
    });
  };

  const handleSkillsAddMenuClose= () => {
    setSkillsAddMenuState({ isOpen: false, position: null });
  };

  // Skill menu handler
  const handleSkillMenuToggle = (
    skillName: string,
    buttonElement: HTMLElement,
  ) => {
    if (skillMenuState.isOpen && skillMenuState.skillName === skillName) {
      // Close menu
      setSkillMenuState({ isOpen: false, skillName: null, position: null });
    } else {
      // Calculate menu position
      const rect = buttonElement.getBoundingClientRect();
      const menuWidth = 200;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Calculate horizontal position - prevent exceeding right boundary
      let left = rect.left;
      if (left + menuWidth > windowWidth) {
        left = rect.right - menuWidth;
      }

      // Calculate vertical position - prevent exceeding bottom boundary
      let top = rect.bottom + 4;
      const menuHeight = 80; // Estimated menu height (2 items)
      if (top + menuHeight > windowHeight) {
        top = rect.top - menuHeight - 4;
      }

      const position = { top, left, triggerTop: rect.top };
      setSkillMenuState({ isOpen: true, skillName, position });
    }
  };

  const handleSkillMenuClose = () => {
    setSkillMenuState({ isOpen: false, skillName: null, position: null });
  };

  // Handle skill deletion - open confirmation dialog
  const handleDeleteSkill = useCallback(
    (skillName: string) => {
      // Find all agents using this skill
      const usedByAgents = chats
        .filter((chat) => chat.agent?.skills?.includes(skillName))
        .map((chat) => chat.agent?.name || 'Unknown Agent');

      // Open confirmation dialog
      setDeleteSkillDialog({
        isOpen: true,
        skillName,
        usedByAgents,
      });
    },
    [chats],
  );

  // Confirm skill deletion
  const handleConfirmDeleteSkill = useCallback(async () => {
    const { skillName } = deleteSkillDialog;
    if (!skillName) return;

    try {
      if (!window.electronAPI?.skills?.deleteSkill) {
        showError('Skill deletion API not available');
        return;
      }

      const result = await window.electronAPI.skills.deleteSkill(skillName);

      if (result.success) {
        showSuccess(`Skill "${skillName}" deleted successfully`);
        // Refresh profile data
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
      } else {
        showError(
          `Failed to delete skill: ${result.error || 'Unknown error'}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      // Close dialog
      setDeleteSkillDialog({
        isOpen: false,
        skillName: null,
        usedByAgents: [],
      });
    }
  }, [deleteSkillDialog, showSuccess, showError]);

  // MCP Server operation handler
  const handleMcpServerConnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.connectMcpServer) {
        showError('MCP connect API not available');
        return;
      }

      const result = await window.electronAPI.profile.connectMcpServer(serverName);
      if (result.success) {
        // Connection is async, don't show success message immediately
        // Actual connection result will be notified via status update, error toast will pop up on failure
        // Refresh data
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
      } else {
        showError(`Failed to connect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to connect server: ${errorMessage}`);
    }
  }, [showError, showSuccess]);

  const handleMcpServerDisconnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.disconnectMcpServer) {
        showError('MCP disconnect API not available');
        return;
      }

      const result = await window.electronAPI.profile.disconnectMcpServer(serverName);
      if (result.success) {
        showSuccess(`Server "${serverName}" disconnected successfully`);
        // Refresh data
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
      } else {
        showError(`Failed to disconnect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to disconnect server: ${errorMessage}`);
    }
  }, [showError, showSuccess]);

  const handleMcpServerReconnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.reconnectMcpServer) {
        showError('MCP reconnect API not available');
        return;
      }

      const result = await window.electronAPI.profile.reconnectMcpServer(serverName);
      if (result.success) {
        // Reconnection is async, don't show success message immediately
        // Actual connection result will be notified via status update, error toast will pop up on failure
        // Refresh data
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
      } else {
        showError(`Failed to reconnect server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to reconnect server: ${errorMessage}`);
    }
  }, [showError, showSuccess]);

  // Handle MCP server deletion - open confirmation dialog
  const handleMcpServerDelete = useCallback((serverName: string) => {
    // Open confirmation dialog
    setDeleteMcpDialog({
      isOpen: true,
      serverName,
    });
  }, []);

  // Confirm MCP server deletion
  const handleConfirmDeleteMcp = useCallback(async () => {
    const { serverName } = deleteMcpDialog;
    if (!serverName) return;

    try {
      if (!window.electronAPI?.profile?.deleteMcpServer) {
        showError('MCP delete API not available');
        return;
      }

      const result = await window.electronAPI.profile.deleteMcpServer(serverName);
      if (result.success) {
        showSuccess(`Server "${serverName}" deleted successfully`);
        // Refresh data
        const { profileDataManager } = await import('../../lib/userData');
        await profileDataManager.refresh();
      } else {
        showError(`Failed to delete server: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showError(`Failed to delete server: ${errorMessage}`);
    } finally {
      // Close dialog
      setDeleteMcpDialog({
        isOpen: false,
        serverName: null,
      });
    }
  }, [deleteMcpDialog, showError, showSuccess]);

  const handleMcpServerEdit = useCallback((serverName: string) => {
    // Navigate to edit page
    navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
    handleMcpServerMenuClose();
  }, [navigate]);

  // Event listeners
  useEffect(() => {
    const handleDeleteSkillEvent = (event: CustomEvent) => {
      const { skillName } = event.detail;
      handleDeleteSkill(skillName);
    };

    // Only register skill:delete event listener
    // MCP-related events are handled by respective View components, avoid duplicate listeners
    window.addEventListener(
      'skill:delete',
      handleDeleteSkillEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'skill:delete',
        handleDeleteSkillEvent as EventListener,
      );
    };
  }, [handleDeleteSkill]);

  // Record path before entering settings page
  useEffect(() => {
    // Only record on first settings page load
    const currentPath = location.pathname;
    if (currentPath.startsWith('/settings')) {
      // Get previously saved path from sessionStorage
      const storedPreviousPath = sessionStorage.getItem('previousPath');
      if (!storedPreviousPath) {
        // If no stored path, use default path
        sessionStorage.setItem('settingsReturnPath', '/agent/chat');
      } else {
        // Use stored path
        sessionStorage.setItem('settingsReturnPath', storedPreviousPath);
      }
    }
  }, [location.pathname]);


  const handleMcpServerAdded = () => {
    // Post server-add handling logic
  };

  const handleMcpImportComplete = (importedCount: number) => {
    // Post import-complete handling logic
  };

  const handleSkillAdded = (count: number) => {
    // Post skill-add handling logic
  };

  const handleBack = () => {
    // Get returnPath from route state, fall back to sessionStorage
    const returnPath = location.state?.returnPath || sessionStorage.getItem('settingsReturnPath');
    
    if (returnPath && returnPath !== '/settings') {
      // Clear stored return path
      sessionStorage.removeItem('settingsReturnPath');
      // Navigate to return path
      navigate(returnPath);
    } else {
      // Default return to agent page chat view
      navigate('/agent/chat');
    }
  };

  // Create simplified AgentContext for Settings page
  const settingsContext: AgentContextType = {
    messages: [],
    allMessages: [],
    streamingMessageId: undefined,
    onSendMessage: () => Promise.resolve(),
    onCancelChat: () => Promise.resolve(),
    onApprovalResponse: () => Promise.resolve(),
    pendingApprovalRequest: null,
    config: {
      apiKey: '',
      endpoint: '',
      deploymentName: '',
      apiVersion: '2023-05-15',
    },
    onSaveConfig: () => Promise.resolve(),
    
    // Agent navigation handlers - not needed in settings
    onNewAgent: undefined,
    onEditAgent: undefined,
    onDeleteAgent: undefined,
    
    // MCP handlers - using local implementation
    onMcpServerConnect: handleMcpServerConnect,
    onMcpServerDisconnect: handleMcpServerDisconnect,
    onMcpServerReconnect: handleMcpServerReconnect,
    onMcpServerDelete: handleMcpServerDelete,
    onMcpServerEdit: handleMcpServerEdit,
    onMcpServerMenuToggle: handleMcpServerMenuToggle,
    mcpServerMenuState: mcpServerMenuState,
    onMcpAddMenuToggle: handleMcpAddMenuToggle,
    
    // Skills handlers - using local implementation
    onSkillsAddMenuToggle: handleSkillsAddMenuToggle,
    onSkillMenuToggle: handleSkillMenuToggle,
    
    // UI state
    sidepaneWidth,
    setSidepaneWidth,
    isDragging: false,
    
    // Other handlers - not needed in settings
    onEditAgentMenuToggle: undefined,
    onFileTreeNodeMenuToggle: undefined,
    onWorkspaceMenuToggle: undefined,
    workspaceMenuState: undefined,
  };

  return (
    <div className="h-full flex">
      {/* Left Navigation */}
      <SettingsNavigation onBack={handleBack} />
      
      {/* Right Content Container */}
      <div className="flex-1 flex flex-col min-w-0">
        <Outlet context={settingsContext} />
      </div>

      {/* Global MCP Server dropdown menu - floating at SettingsPage level */}
      {mcpServerMenuState.isOpen && mcpServerMenuState.position && mcpServerMenuState.serverName && (
        <McpServerDropdownMenu
          mcpServerMenuRef={mcpServerMenuRef}
          serverName={mcpServerMenuState.serverName}
          position={mcpServerMenuState.position}
          onConnect={handleMcpServerConnect}
          onDisconnect={handleMcpServerDisconnect}
          onReconnect={handleMcpServerReconnect}
          onDelete={handleMcpServerDelete}
          onEdit={handleMcpServerEdit}
          onClose={handleMcpServerMenuClose}
        />
      )}

      {/* Global MCP add dropdown menu - floating at SettingsPage level */}
      {mcpAddMenuState.isOpen && mcpAddMenuState.position && (
        <McpAddMenuDropdown
          mcpAddMenuRef={mcpAddMenuRef}
          position={mcpAddMenuState.position}
          onClose={handleMcpAddMenuClose}
        />
      )}

      {/* Global Skills add dropdown menu - floating at SettingsPage level */}
      {skillsAddMenuState.isOpen && skillsAddMenuState.position && (
        <SkillsAddMenuDropdown
          skillsAddMenuRef={skillsAddMenuRef}
          position={skillsAddMenuState.position}
          onClose={handleSkillsAddMenuClose}
        />
      )}

      {/* Global Skill dropdown menu - floating at SettingsPage level */}
      {skillMenuState.isOpen && skillMenuState.position && skillMenuState.skillName && (
        <SkillDropdownMenu
          skillMenuRef={skillMenuRef}
          skillName={skillMenuState.skillName}
          position={skillMenuState.position}
          onClose={handleSkillMenuClose}
        />
      )}

      {/* Delete Skill Confirmation Dialog */}
      <Dialog
        open={deleteSkillDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteSkillDialog({
              isOpen: false,
              skillName: null,
              usedByAgents: [],
            });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Delete Skill</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete {deleteSkillDialog.skillName}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {deleteSkillDialog.usedByAgents.length > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                This skill is currently being used by {deleteSkillDialog.usedByAgents.length} agent(s): {deleteSkillDialog.usedByAgents.join(', ')}
              </p>
            )}
            <p className="text-sm text-destructive">
              This action cannot be undone. After deletion, agents will no longer be able to use this skill.
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() =>
                setDeleteSkillDialog({
                  isOpen: false,
                  skillName: null,
                  usedByAgents: [],
                })
              }
            >
              No
            </button>
            <button
              className="btn-primary bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDeleteSkill}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Skill to Agents Dialog */}
      <ApplySkillToAgentsDialog
        open={applySkillDialogState.open}
        onOpenChange={(open) => setApplySkillDialogState(prev => ({ ...prev, open }))}
        skillName={applySkillDialogState.skillName}
      />

      {/* Delete MCP Server Confirmation Dialog */}
      <Dialog
        open={deleteMcpDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteMcpDialog({
              isOpen: false,
              serverName: null,
            });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Delete MCP Server</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete {deleteMcpDialog.serverName}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-destructive">
              This action cannot be undone. The MCP server configuration will be permanently deleted.
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() =>
                setDeleteMcpDialog({
                  isOpen: false,
                  serverName: null,
                })
              }
            >
              No
            </button>
            <button
              className="btn-primary bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDeleteMcp}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default SettingsPage;
