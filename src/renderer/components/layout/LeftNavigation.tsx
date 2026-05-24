import React from 'react';
import NavigationSection from './NavigationSection';
import UserSection from './UserSection';
import '../../styles/LeftNavigation.css';

interface LeftNavigationProps {
  sidebarWidth?: number;
  leftPanelCollapsed: boolean;
}

const LeftNavigation: React.FC<LeftNavigationProps> = ({
  sidebarWidth,
  leftPanelCollapsed,
}) => {
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
      style={sidebarWidth ? { width: sidebarWidth, minWidth: sidebarWidth } : undefined}
    >
      {/* Navigation Section - includes AgentList, New Agent button, Divider, and Function List */}
      <NavigationSection />

      {/* User Section */}
      <UserSection />
    </nav>
  );
};

export default LeftNavigation;
