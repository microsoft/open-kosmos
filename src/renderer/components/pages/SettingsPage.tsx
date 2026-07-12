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
import { resolveChatAgent } from '../../lib/agent';
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
import {
  ANCHORED_DROPDOWN_SIZE_PRESETS,
  AnchoredDropdownPosition,
  getAnchoredDropdownPosition,
} from '../../lib/utilities/dropdownPosition';
import '../../styles/ContentView.css';
import '../../styles/DropdownMenu.css';
import ResizableDivider from '../ui/ResizableDivider';
import { profileDataManager } from "../../lib/userData";
import { useI18n } from '../../lib/i18n/useI18n';

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
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

  // Hook dependencies
  const { chats } = useProfileData();
  const { showSuccess, showError } = useToast();

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

  // Handle skill deletion - open confirmation dialog
  const handleDeleteSkill = useCallback(
    (skillName: string) => {
      // Find all agents using this skill
      const usedByAgents = chats
        .map((chat) => resolveChatAgent(chat))
        .filter((agent) => agent?.skills?.includes(skillName))
        .map((agent) => agent?.name || t('settings.page.unknownAgent'));

      // Open confirmation dialog
      setDeleteSkillDialog({
        isOpen: true,
        skillName,
        usedByAgents,
      });
    },
    [chats, t],
  );

  // Confirm skill deletion
  const handleConfirmDeleteSkill = useCallback(async () => {
    const { skillName } = deleteSkillDialog;
    if (!skillName) return;

    try {
      if (!window.electronAPI?.skills?.deleteSkill) {
        showError(t('settings.page.skillDeletionApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.skills.deleteSkill(skillName);

      if (result.success) {
        showSuccess(t('settings.page.skillDeleted', { name: skillName }));
        // Refresh profile data
        await profileDataManager.refresh();
      } else {
        showError(
          t('settings.page.skillDeleteFailed', { error: result.error || t('common.unknownError') }),
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : t('settings.page.unknownErrorOccurred');
      showError(t('settings.page.deleteFailed', { error: errorMessage }));
    } finally {
      // Close dialog
      setDeleteSkillDialog({
        isOpen: false,
        skillName: null,
        usedByAgents: [],
      });
    }
  }, [deleteSkillDialog, showSuccess, showError, t]);

  // MCP Server action handler functions
  const handleMcpServerConnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.connectMcpServer) {
        showError(t('settings.page.mcpConnectApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.profile.connectMcpServer(serverName);
      if (result.success) {
        // Connection is async, don't show success immediately
        // Actual connection result will be notified via state update, errors will show error toast
        // Refresh data
        await profileDataManager.refresh();
      } else {
        showError(t('settings.page.mcpConnectFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('settings.page.mcpConnectFailed', { error: errorMessage }));
    }
  }, [showError, t]);

  const handleMcpServerDisconnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.disconnectMcpServer) {
        showError(t('settings.page.mcpDisconnectApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.profile.disconnectMcpServer(serverName);
      if (result.success) {
        showSuccess(t('settings.page.mcpDisconnected', { name: serverName }));
        // Refresh data
        await profileDataManager.refresh();
      } else {
        showError(t('settings.page.mcpDisconnectFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('settings.page.mcpDisconnectFailed', { error: errorMessage }));
    }
  }, [showError, showSuccess, t]);

  const handleMcpServerReconnect = useCallback(async (serverName: string) => {
    try {
      if (!window.electronAPI?.profile?.reconnectMcpServer) {
        showError(t('settings.page.mcpReconnectApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.profile.reconnectMcpServer(serverName);
      if (result.success) {
        // Reconnection is async, don't show success immediately
        // Actual connection result will be notified via state update, errors will show error toast
        // Refresh data
        await profileDataManager.refresh();
      } else {
        showError(t('settings.page.mcpReconnectFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('settings.page.mcpReconnectFailed', { error: errorMessage }));
    }
  }, [showError, t]);

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
        showError(t('settings.page.mcpDeleteApiUnavailable'));
        return;
      }

      const result = await window.electronAPI.profile.deleteMcpServer(serverName);
      if (result.success) {
        showSuccess(t('settings.page.mcpDeleted', { name: serverName }));
        // Refresh data
        await profileDataManager.refresh();
      } else {
        showError(t('settings.page.mcpDeleteFailed', { error: result.error || t('common.unknownError') }));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('common.unknownError');
      showError(t('settings.page.mcpDeleteFailed', { error: errorMessage }));
    } finally {
      // Close dialog
      setDeleteMcpDialog({
        isOpen: false,
        serverName: null,
      });
    }
  }, [deleteMcpDialog, showError, showSuccess, t]);

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
    // MCP-related events are handled by their respective View components to avoid duplicate listeners
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
  };

  return (
    <div className="h-full flex flex-col  bg-warm-50">
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
            <DialogTitle className="text-left">{t('settings.page.deleteSkillTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('settings.page.deleteSkillDescription', { name: deleteSkillDialog.skillName || '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {deleteSkillDialog.usedByAgents.length > 0 && (
              <p className="text-sm text-neutral-500 mb-4">
                {t('settings.page.skillUsedByAgents', { count: deleteSkillDialog.usedByAgents.length, agents: deleteSkillDialog.usedByAgents.join(', ') })}
              </p>
            )}
            <p className="text-sm text-danger-600">
              {t('settings.page.deleteSkillWarning')}
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
              {t('common.no')}
            </button>
            <button
              className="btn-danger"
              onClick={handleConfirmDeleteSkill}
            >
              {t('common.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Skill to Agents Dialog */}
      <ApplySkillToAgentsDialog />

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
            <DialogTitle className="text-left">{t('settings.page.deleteMcpTitle')}</DialogTitle>
            <DialogDescription className="text-left">
              {t('settings.page.deleteMcpDescription', { name: deleteMcpDialog.serverName || '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-danger-600">
              {t('settings.page.deleteMcpWarning')}
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
              {t('common.no')}
            </button>
            <button
              className="btn-danger"
              onClick={handleConfirmDeleteMcp}
            >
              {t('common.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default SettingsPage;
