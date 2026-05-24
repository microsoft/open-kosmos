import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import SettingsNavigation from '../settings/SettingsNavigation';
import { AgentContextType } from '../../types/agentContextTypes';
import {
  McpServerDropdownMenu,
  McpAddMenuDropdown,
  SkillsAddMenuDropdown,
  SkillDropdownMenu,
  SubAgentsAddMenuDropdown,
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
import SubAgentDropdownMenu from '../subAgents/SubAgentDropdownMenu';
import ApplySubAgentToAgentsDialog from '../subAgents/ApplySubAgentToAgentsDialog';
import {
  ANCHORED_DROPDOWN_SIZE_PRESETS,
  AnchoredDropdownPosition,
  getAnchoredDropdownPosition,
} from '../../lib/utilities/dropdownPosition';
import '../../styles/ContentView.css';
import '../../styles/DropdownMenu.css';
import ResizableDivider from '../ui/ResizableDivider';
import { profileDataManager } from "../../lib/userData";

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMac = window.electronAPI?.platform === 'darwin';

  // MCP Server dropdown menu state management
  const [mcpServerMenuState, setMcpServerMenuState] = useState<{
    isOpen: boolean;
    serverName: string | null;
    position: AnchoredDropdownPosition | null;
  }>({
    isOpen: false,
    serverName: null,
    position: null,
  });
  const mcpServerMenuRef = useRef<HTMLDivElement>(null);

  // MCP add menu state management
  const [mcpAddMenuState, setMcpAddMenuState] = useState<{
    isOpen: boolean;
    position: AnchoredDropdownPosition | null;
  }>({
    isOpen: false,
    position: null,
  });
  const mcpAddMenuRef = useRef<HTMLDivElement>(null);

  // Skills add menu state management
  const [skillsAddMenuState, setSkillsAddMenuState] = useState<{
    isOpen: boolean;
    position: AnchoredDropdownPosition | null;
  }>({
    isOpen: false,
    position: null,
  });
  const skillsAddMenuRef = useRef<HTMLDivElement>(null);

  // Skill dropdown menu state management
  const [skillMenuState, setSkillMenuState] = useState<{
    isOpen: boolean;
    skillName: string | null;
    position: AnchoredDropdownPosition | null;
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

  // Sub-Agents add menu state management
  const [subAgentsAddMenuState, setSubAgentsAddMenuState] = useState<{
    isOpen: boolean;
    position: AnchoredDropdownPosition | null;
  }>({
    isOpen: false,
    position: null,
  });
  const subAgentsAddMenuRef = useRef<HTMLDivElement>(null);

  // Sub-Agent dropdown menu state management
  const [subAgentMenuState, setSubAgentMenuState] = useState<{
    isOpen: boolean;
    subAgentName: string | null;
    position: AnchoredDropdownPosition | null;
  }>({
    isOpen: false,
    subAgentName: null,
    position: null,
  });
  const subAgentMenuRef = useRef<HTMLDivElement>(null);

  // Delete sub-agent confirmation dialog state
  const [deleteSubAgentDialog, setDeleteSubAgentDialog] = useState<{
    isOpen: boolean;
    subAgentName: string | null;
    usedByAgents: string[];
  }>({
    isOpen: false,
    subAgentName: null,
    usedByAgents: [],
  });

  // Apply sub-agent to agents dialog state
  const [applySubAgentDialogState, setApplySubAgentDialogState] = useState<{
    open: boolean;
    subAgentName: string;
  }>({ open: false, subAgentName: '' });

  // Hook dependencies
  const { chats } = useProfileData();
  const { showSuccess, showError } = useToast();

  // Global event listener for subAgents:applyToAgents
  useEffect(() => {
    const handleApplySubAgentToAgents = (event: CustomEvent<{ subAgentName: string }>) => {
      const { subAgentName } = event.detail;
      if (subAgentName) {
        setApplySubAgentDialogState({ open: true, subAgentName });
      }
    };

    window.addEventListener('subAgents:applyToAgents', handleApplySubAgentToAgents as EventListener);
    return () => {
      window.removeEventListener('subAgents:applyToAgents', handleApplySubAgentToAgents as EventListener);
    };
  }, []);

  // Close menu when clicking outside
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
      if (
        subAgentsAddMenuRef.current &&
        !subAgentsAddMenuRef.current.contains(event.target as Node)
      ) {
        setSubAgentsAddMenuState({ isOpen: false, position: null });
      }
      if (
        subAgentMenuRef.current &&
        !subAgentMenuRef.current.contains(event.target as Node)
      ) {
        setSubAgentMenuState({ isOpen: false, subAgentName: null, position: null });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // MCP Server menu handler functions
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
      const position = getAnchoredDropdownPosition(
        buttonElement,
        ANCHORED_DROPDOWN_SIZE_PRESETS.mcpServerMenu,
      );
      setMcpServerMenuState({ isOpen: true, serverName, position });
    }
  };

  const handleMcpServerMenuClose = () => {
    setMcpServerMenuState({ isOpen: false, serverName: null, position: null });
  };

  // MCP add menu handler functions
  const handleMcpAddMenuToggle = (buttonElement: HTMLElement) => {
    setMcpAddMenuState((prevState) => {
      // If menu is already open, close it
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }

      // Otherwise, open menu and calculate best position
      const position = getAnchoredDropdownPosition(
        buttonElement,
        ANCHORED_DROPDOWN_SIZE_PRESETS.mcpAddMenu,
      );
      return { isOpen: true, position };
    });
  };

  const handleMcpAddMenuClose = () => {
    setMcpAddMenuState({ isOpen: false, position: null });
  };

  // Skills add menu handler functions
  const handleSkillsAddMenuToggle = (buttonElement: HTMLElement) => {
    setSkillsAddMenuState((prevState) => {
      // If menu is already open, close it
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }

      // Otherwise, open menu and calculate best position
      const position = getAnchoredDropdownPosition(
        buttonElement,
        ANCHORED_DROPDOWN_SIZE_PRESETS.skillsAddMenu,
      );
      return { isOpen: true, position };
    });
  };

  const handleSkillsAddMenuClose = () => {
    setSkillsAddMenuState({ isOpen: false, position: null });
  };

  // Skill menu handler functions
  const handleSkillMenuToggle = (
    skillName: string,
    buttonElement: HTMLElement,
  ) => {
    if (skillMenuState.isOpen && skillMenuState.skillName === skillName) {
      // Close menu
      setSkillMenuState({ isOpen: false, skillName: null, position: null });
    } else {
      // Calculate menu position
      const position = getAnchoredDropdownPosition(
        buttonElement,
        ANCHORED_DROPDOWN_SIZE_PRESETS.skillMenu,
      );
      setSkillMenuState({ isOpen: true, skillName, position });
    }
  };

  const handleSkillMenuClose = () => {
    setSkillMenuState({ isOpen: false, skillName: null, position: null });
  };

  // Sub-Agents add menu handler functions
  const handleSubAgentsAddMenuToggle = (buttonElement: HTMLElement) => {
    setSubAgentsAddMenuState((prevState) => {
      if (prevState.isOpen) {
        return { isOpen: false, position: null };
      }

      const position = getAnchoredDropdownPosition(
        buttonElement,
        ANCHORED_DROPDOWN_SIZE_PRESETS.subAgentsAddMenu,
      );
      return { isOpen: true, position };
    });
  };

  const handleSubAgentsAddMenuClose = () => {
    setSubAgentsAddMenuState({ isOpen: false, position: null });
  };

  // Sub-Agent menu handler functions
  const handleSubAgentMenuToggle = (
    subAgentName: string,
    buttonElement: HTMLElement,
  ) => {
    if (subAgentMenuState.isOpen && subAgentMenuState.subAgentName === subAgentName) {
      setSubAgentMenuState({ isOpen: false, subAgentName: null, position: null });
    } else {
      const position = getAnchoredDropdownPosition(
        buttonElement,
        ANCHORED_DROPDOWN_SIZE_PRESETS.subAgentMenu,
      );
      setSubAgentMenuState({ isOpen: true, subAgentName, position });
    }
  };

  const handleSubAgentMenuClose = () => {
    setSubAgentMenuState({ isOpen: false, subAgentName: null, position: null });
  };

  // Handle sub-agent deletion - open confirmation dialog
  const handleDeleteSubAgent = useCallback(
    (subAgentName: string) => {
      const usedByAgents = chats
        .filter((chat) => chat.agent?.sub_agents?.includes(subAgentName))
        .map((chat) => chat.agent?.name || 'Unknown Agent');

      setDeleteSubAgentDialog({
        isOpen: true,
        subAgentName,
        usedByAgents,
      });
    },
    [chats],
  );

  // Confirm sub-agent deletion
  const handleConfirmDeleteSubAgent = useCallback(async () => {
    const { subAgentName } = deleteSubAgentDialog;
    if (!subAgentName) return;

    try {
      if (!window.electronAPI?.subAgent?.delete) {
        showError('Sub-agent deletion API not available');
        return;
      }

      const result = await window.electronAPI.subAgent.delete(subAgentName);

      if (result.success) {
        showSuccess(`Sub-agent "${subAgentName}" deleted successfully`);
        await profileDataManager.refresh();
        window.dispatchEvent(new CustomEvent('subAgents:refreshList'));
      } else {
        showError(`Failed to delete sub-agent: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      showError(`Failed to delete: ${errorMessage}`);
    } finally {
      setDeleteSubAgentDialog({
        isOpen: false,
        subAgentName: null,
        usedByAgents: [],
      });
    }
  }, [deleteSubAgentDialog, showSuccess, showError]);

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

  // MCP Server action handler functions
  const handleMcpServerConnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.connectMcpServer) {
        showError('MCP connect API not available');
        return;
      }

      const result = await window.electronAPI.profile.connectMcpServer(serverName);
      if (result.success) {
        // Connection is async, don't show success immediately
        // Actual connection result will be notified via state update, errors will show error toast
        // Refresh data
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
        // Reconnection is async, don't show success immediately
        // Actual connection result will be notified via state update, errors will show error toast
        // Refresh data
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

    const handleDeleteSubAgentEvent = (event: CustomEvent) => {
      const { subAgentName } = event.detail;
      handleDeleteSubAgent(subAgentName);
    };

    // Only register skill:delete event listener
    // MCP-related events are handled by their respective View components to avoid duplicate listeners
    window.addEventListener(
      'skill:delete',
      handleDeleteSkillEvent as EventListener,
    );
    window.addEventListener(
      'subAgent:delete',
      handleDeleteSubAgentEvent as EventListener,
    );

    return () => {
      window.removeEventListener(
        'skill:delete',
        handleDeleteSkillEvent as EventListener,
      );
      window.removeEventListener(
        'subAgent:delete',
        handleDeleteSubAgentEvent as EventListener,
      );
    };
  }, [handleDeleteSkill, handleDeleteSubAgent]);

  // Record path before entering settings page
  useEffect(() => {
    // Only record on first load of settings page
    const currentPath = location.pathname;
    if (currentPath.startsWith('/settings')) {
      // Get previously stored path from sessionStorage
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
    // Post-server-add handler
  };

  const handleMcpImportComplete = (importedCount: number) => {
    // Post-import handler
  };

  const handleSkillAdded = (count: number) => {
    // Post-skill-add handler
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
      // Default: navigate back to agent page chat view
      navigate('/agent/chat');
    }
  };

  // Create simplified AgentContext for Settings page
  const settingsContext: AgentContextType = {
    // MCP handlers - use local implementation
    onMcpServerConnect: handleMcpServerConnect,
    onMcpServerDisconnect: handleMcpServerDisconnect,
    onMcpServerReconnect: handleMcpServerReconnect,
    onMcpServerDelete: handleMcpServerDelete,
    onMcpServerEdit: handleMcpServerEdit,
    onMcpServerMenuToggle: handleMcpServerMenuToggle,
    mcpServerMenuState: mcpServerMenuState,
    onMcpAddMenuToggle: handleMcpAddMenuToggle,

    // Skills handlers - use local implementation
    onSkillsAddMenuToggle: handleSkillsAddMenuToggle,
    onSkillMenuToggle: handleSkillMenuToggle,

    // Sub-Agent handlers - use local implementation
    onSubAgentsAddMenuToggle: handleSubAgentsAddMenuToggle,
    onSubAgentMenuToggle: handleSubAgentMenuToggle,
    subAgentMenuState: subAgentMenuState,
  };

  return (
    <div className="h-full flex flex-col  bg-[#FFFBF8]">
      {isMac && <div className="mac-titlebar-region" aria-hidden="true" />}

      <div className="flex-1 flex min-h-0">
        {/* Left Navigation */}
        <SettingsNavigation onBack={handleBack} />
        <ResizableDivider />
        {/* Right Content Container */}
        <div className="flex-1 flex flex-col min-w-0 mr-2 mb-2 overflow-hidden rounded-lg border border-black/[0.075] shadow-[0px_2px_6px_rgba(0,0,0,0.05)]">
          <Outlet context={settingsContext} />
        </div>
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

      {/* Global Sub-Agents add dropdown menu - floating at SettingsPage level */}
      {subAgentsAddMenuState.isOpen && subAgentsAddMenuState.position && (
        <SubAgentsAddMenuDropdown
          subAgentsAddMenuRef={subAgentsAddMenuRef}
          position={subAgentsAddMenuState.position}
          onClose={handleSubAgentsAddMenuClose}
        />
      )}

      {/* Global Sub-Agent dropdown menu - floating at SettingsPage level */}
      {subAgentMenuState.isOpen && subAgentMenuState.position && subAgentMenuState.subAgentName && (
        <SubAgentDropdownMenu
          subAgentMenuRef={subAgentMenuRef}
          subAgentName={subAgentMenuState.subAgentName}
          position={subAgentMenuState.position}
          onClose={handleSubAgentMenuClose}
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
      <ApplySkillToAgentsDialog />

      {/* Apply Sub-Agent to Agents Dialog */}
      <ApplySubAgentToAgentsDialog
        open={applySubAgentDialogState.open}
        onOpenChange={(open) => setApplySubAgentDialogState(prev => ({ ...prev, open }))}
        subAgentName={applySubAgentDialogState.subAgentName}
      />

      {/* Delete Sub-Agent Confirmation Dialog */}
      <Dialog
        open={deleteSubAgentDialog.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteSubAgentDialog({
              isOpen: false,
              subAgentName: null,
              usedByAgents: [],
            });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">Delete Sub-Agent</DialogTitle>
            <DialogDescription className="text-left">
              Are you sure you want to delete {deleteSubAgentDialog.subAgentName}?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {deleteSubAgentDialog.usedByAgents.length > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                This sub-agent is currently being used by {deleteSubAgentDialog.usedByAgents.length} agent(s): {deleteSubAgentDialog.usedByAgents.join(', ')}
              </p>
            )}
            <p className="text-sm text-destructive">
              This action cannot be undone. After deletion, agents will no longer be able to use this sub-agent.
            </p>
          </div>
          <DialogFooter>
            <button
              className="btn-secondary"
              onClick={() =>
                setDeleteSubAgentDialog({
                  isOpen: false,
                  subAgentName: null,
                  usedByAgents: [],
                })
              }
            >
              No
            </button>
            <button
              className="btn-primary bg-destructive hover:bg-destructive/90"
              onClick={handleConfirmDeleteSubAgent}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
