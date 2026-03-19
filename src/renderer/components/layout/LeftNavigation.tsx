import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLayout } from './LayoutProvider';
import { AuthData } from '../../types/authTypes';
import NavigationSection from './NavigationSection';
import UserSection from './UserSection';
import '../../styles/LeftNavigation.css';

interface LeftNavigationProps {
  authData: AuthData | null;
  onNewChat?: () => void;
  onLogout: () => void;
  onUserMenuToggle: () => void;
  isUserMenuOpen: boolean;
  onNewAgent: () => void;
  onAgentMenuToggle: (chatId: string, buttonElement: HTMLElement) => void;
  openMenuChatId: string | null;
  onChatSessionMenuToggle?: (
    chatId: string,
    sessionId: string,
    title: string,  // 🔥 New: ChatSession title
    buttonElement: HTMLElement,
  ) => void;
  openMenuChatSessionId?: string | null;
}

const LeftNavigation: React.FC<LeftNavigationProps> = ({
  authData,
  onNewChat,
  onLogout,
  onUserMenuToggle,
  isUserMenuOpen,
  onNewAgent,
  onAgentMenuToggle,
  openMenuChatId,
  onChatSessionMenuToggle,
  openMenuChatSessionId,
}) => {
  const { leftPanelCollapsed } = useLayout();

  const navigationClasses = [
    'left-navigation',
    leftPanelCollapsed ? 'collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav
      className={navigationClasses}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Navigation Section - includes AgentList, New Agent button, Divider, and Function List */}
      <NavigationSection
        onNewAgent={onNewAgent}
        onAgentMenuToggle={onAgentMenuToggle}
        openMenuChatId={openMenuChatId}
        onChatSessionMenuToggle={onChatSessionMenuToggle}
        openMenuChatSessionId={openMenuChatSessionId}
      />

      {/* User Section */}
      <UserSection
        authData={authData}
        onLogout={onLogout}
        onUserMenuToggle={onUserMenuToggle}
        isUserMenuOpen={isUserMenuOpen}
      />
    </nav>
  );
};

export default LeftNavigation;
