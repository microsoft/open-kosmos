import React, { useState, useEffect } from 'react';
import { PanelLeft } from 'lucide-react';
import { LeftNavCollapsedAtom, LeftNavSizeAtom } from '@/states/left-nav.atom';
import LeftNavigation from './LeftNavigation';
import ContentContainer from './ContentContainer';
import ResizableDivider from '../ui/ResizableDivider';
import { useLayout } from './LayoutProvider';
import { OverlayImageViewer } from '../ui/OverlayImageViewer';
import { OverlayFileViewer } from '../ui/OverlayFileViewer';
import ApplySkillToAgentsDialog from '../skills/ApplySkillToAgentsDialog';
import {
  AgentDropdownMenu,
  WorkspaceMenuDropdown,
  EditAgentMenuDropdown,
  AttachMenuDropdown,
  ChatSessionDropdownMenu,
  FileTreeNodeContextMenu,
  ImageGalleryContextMenu,
} from '../menu';
import Buddy from '../buddy';
import { UserMenu } from './UserMenu';
import { DeleteOverlay } from '../overlay/DeleteOverlay';
import { DuplicateAgentOverlay } from '../overlay/DuplicateAgentOverlay';
import { RenameChatSessionOverlay } from '../overlay/RenameChatSessionOverlay';


// Internal component with access to LayoutProvider context
interface AppLayoutContentProps {
  handleFileTreeNodeInstallSkill: (filePath: string) => void;
  handleFileTreeNodeMoveToKnowledge: (filePath: string) => void;
  currentKnowledgeBasePath: string;
}

export const AppLayoutContent: React.FC<AppLayoutContentProps> = ({
  handleFileTreeNodeInstallSkill,
  handleFileTreeNodeMoveToKnowledge,
  currentKnowledgeBasePath,
}) => {
  const { isMinimalMode } = useLayout();

  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const checkPlatform = async () => {
      if (window.electronAPI?.platform === 'darwin') {
        setIsMac(true);
        return;
      }

      try {
        const info = await window.electronAPI.getPlatformInfo();
        if (info.platform === 'darwin') {
          setIsMac(true);
        }
      } catch (e) {
        // Ignore
      }
    };

    checkPlatform();
  }, []);

  // macOS: track fullscreen state (traffic lights hidden in fullscreen)
  const [isMacFullScreen, setIsMacFullScreen] = useState(false);

  useEffect(() => {
    if (!isMac) return;

    const checkFullScreen = async () => {
      try {
        const fs = await window.electronAPI?.window?.isFullScreen?.();
        if (typeof fs === 'boolean') setIsMacFullScreen(fs);
      } catch {
        // Ignore
      }
    };

    checkFullScreen();

    const cleanup = window.electronAPI?.window?.onFullScreenChanged?.((isFullScreen) => {
      setIsMacFullScreen(isFullScreen);
    });

    return () => { cleanup?.(); };
  }, [isMac]);

  // macOS: sync CSS custom properties for zoom-compensated titlebar layout.
  // Native traffic lights are not affected by webContents zoom, but CSS px values are.
  // By writing --mac-zoom-factor directly to documentElement, CSS calc() picks it up
  // in the same frame — no React render delay, no jitter.
  useEffect(() => {
    if (!isMac) return;
    const root = document.documentElement;
    root.style.setProperty('--mac-zoom-factor', String(Math.pow(1.2, 0)));
    root.classList.add('macos-platform');

    const cleanupZoom = window.electronAPI?.window?.onZoomChanged?.((level) => {
      root.style.setProperty('--mac-zoom-factor', String(Math.pow(1.2, level)));
    });

    // Read initial zoom level synchronously
    void window.electronAPI?.window?.getZoomLevel?.().then((level) => {
      if (typeof level === 'number') {
        root.style.setProperty('--mac-zoom-factor', String(Math.pow(1.2, level)));
      }
    });

    return () => {
      cleanupZoom?.();
      root.style.removeProperty('--mac-zoom-factor');
      root.classList.remove('macos-platform');
    };
  }, [isMac]);

  // macOS: sync fullscreen state as CSS class for traffic light padding
  useEffect(() => {
    if (!isMac) return;
    const root = document.documentElement;
    if (isMacFullScreen) {
      root.classList.add('mac-fullscreen');
    } else {
      root.classList.remove('mac-fullscreen');
    }
    return () => { root.classList.remove('mac-fullscreen'); };
  }, [isMac, isMacFullScreen]);



  const [leftPanelCollapsed, { toggle: toggleLeftPanel }] = LeftNavCollapsedAtom.use();
  const { width: leftNavWidth, resizing: leftNavResizing } = LeftNavSizeAtom.useData();
  const isSidebarVisible = !isMinimalMode && !leftPanelCollapsed;

  return (
    <div
      className={[
        'app-layout',
        isMinimalMode ? 'minimal-mode' : '',
        isMac ? 'macos-layout' : '',
        leftPanelCollapsed ? 'left-panel-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* macOS title bar drag region and sidebar toggle */}
      {isMac && !isMinimalMode && (
        <div className="mac-titlebar-region">
          <button
            className={`ml-2 mac-sidebar-toggle ${leftPanelCollapsed ? 'active' : ''}`}
            onClick={toggleLeftPanel}
            aria-label={leftPanelCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-pressed={leftPanelCollapsed}
            title={leftPanelCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
          >
            <PanelLeft size={16} />
          </button>
        </div>
      )}

      {/* Main body with navigation and content - WindowsTitleBar moved to App.tsx level */}
      <div className="app-body">

        {/* LeftNavigation - hidden in minimal mode, collapses with CSS transition */}
        {!isMinimalMode && (
          <div
            className={`left-navigation-wrapper ${leftPanelCollapsed ? 'collapsed' : ''}`}
            style={{
              width: leftPanelCollapsed ? undefined : leftNavWidth,
              transition: leftNavResizing ? 'unset': undefined,
            }}
          >
            <LeftNavigation
              sidebarWidth={leftNavWidth}
              leftPanelCollapsed={leftPanelCollapsed}
            />
          </div>
        )}

        {/* Resize divider between sidebar and content */}
        {isSidebarVisible && <ResizableDivider />}

        <ContentContainer sidebarVisible={isSidebarVisible} />

        {/* Right global sidepane for UserTask */}


        {/* Global Agent dropdown menu - state managed via atom */}
        {!isMinimalMode && <AgentDropdownMenu />}

        {/* Global user dropdown menu - hidden in minimal mode */}
        {!isMinimalMode && <UserMenu />}

        {/* Global Workspace Explorer dropdown menu */}
        {!isMinimalMode && <WorkspaceMenuDropdown />}

        {/* Global Edit Agent dropdown menu */}
        {!isMinimalMode && <EditAgentMenuDropdown />}

        {/* Global Attach dropdown menu */}
        {!isMinimalMode && <AttachMenuDropdown />}

        {/* Global ChatSession dropdown menu */}
        {!isMinimalMode && <ChatSessionDropdownMenu />}

        {/* Global FileTreeNode context menu */}
        <FileTreeNodeContextMenu
          onInstallSkill={handleFileTreeNodeInstallSkill}
          onMoveToKnowledge={handleFileTreeNodeMoveToKnowledge}
          knowledgeBasePath={currentKnowledgeBasePath}
        />

        {/* Global ImageGallery context menu */}
        <ImageGalleryContextMenu />

        {/* Global delete confirmation dialog - floats at AppLayout level, visible in all views */}
        <DeleteOverlay />

        {/* Global duplicate Agent dialog - floats at AppLayout level */}
        <DuplicateAgentOverlay />

        {/* Global rename ChatSession dialog - floats at AppLayout level */}
        <RenameChatSessionOverlay />

        {/* Global OverlayImageViewer - floats at top level */}
        <OverlayImageViewer />

        {/* Global OverlayFileViewer - floats at top level */}
        <OverlayFileViewer onInstallSkill={handleFileTreeNodeInstallSkill} />

        {/* Global Install Skill Apply to Agents Dialog - floats at top level */}
        <ApplySkillToAgentsDialog />

        {/* Buddy Hatching Ceremony — mounted at root level for first-time users */}
        {/* Buddy Main Page modal */}
        {/* Buddy Companion floating widget — hidden during hatching ceremony */}
        <Buddy />
      </div>
    </div>
  );
};
