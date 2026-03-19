import React, { useLayoutEffect } from 'react';
import { Pencil, Play, Pause, RotateCw, Trash2 } from 'lucide-react';
import { useProfileData } from '../userData/userDataProvider';

interface McpServerDropdownMenuProps {
  mcpServerMenuRef: React.RefObject<HTMLDivElement>;
  serverName: string;
  position: { top: number; left: number };
  onConnect?: (serverName: string) => void;
  onDisconnect?: (serverName: string) => void;
  onReconnect?: (serverName: string) => void;
  onDelete?: (serverName: string) => void;
  onEdit?: (serverName: string) => void;
  onClose: () => void;
}

const McpServerDropdownMenu: React.FC<McpServerDropdownMenuProps> = ({
  mcpServerMenuRef,
  serverName,
  position,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  onClose,
}) => {
  const { mcpServers } = useProfileData();
  
  // Find the current server
  const currentServer = mcpServers.find((s: any) => s.name === serverName);
  
  // Check if it's a built-in server
  const BUILTIN_SERVER_NAME = 'builtin-tools';
  const isBuiltinServer = serverName === BUILTIN_SERVER_NAME;
  
  // If it's a built-in server, don't show the menu
  if (isBuiltinServer) {
    return null;
  }
  
  // Get operation functions from window object (if not provided via props)
  const mcpOps = (window as any).__mcpServerOperations;
  const finalOnConnect = onConnect || mcpOps?.onConnect;
  const finalOnDisconnect = onDisconnect || mcpOps?.onDisconnect;
  const finalOnReconnect = onReconnect || mcpOps?.onReconnect;
  const finalOnDelete = onDelete || mcpOps?.onDelete;
  const finalOnEdit = onEdit || mcpOps?.onEdit;
  
  // 🔧 Fix: Adjust menu position if it overflows window bottom
  useLayoutEffect(() => {
    if (mcpServerMenuRef.current) {
      const rect = mcpServerMenuRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const padding = 10;
      
      // Check if we have triggerTop info (passed via position prop extension)
      const triggerTop = (position as any).triggerTop;
      
      if (rect.bottom > windowHeight - padding) {
        // If it overflows bottom, try to position above the trigger
        if (triggerTop !== undefined) {
           const newTop = triggerTop - rect.height - 4;
           // Ensure we don't go off the top either
           mcpServerMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        } else {
           // Fallback to just shifting up if no trigger info
           const newTop = windowHeight - rect.height - padding;
           mcpServerMenuRef.current.style.top = `${Math.max(padding, newTop)}px`;
        }
      }
    }
  }, [position]);

  // Get server status and available actions
  const getAvailableActions = () => {
    if (!currentServer) return { connect: true, disconnect: false, reconnect: false };
    
    const status = currentServer.status || 'disconnected';
    const hasError = !!currentServer.error;
    
    switch (status) {
      case 'disconnected':
        return { connect: true, disconnect: false, reconnect: false };
      case 'connected':
        return { connect: false, disconnect: true, reconnect: false };
      case 'error':
        return { connect: false, disconnect: true, reconnect: true };
      case 'connecting':
      case 'disconnecting':
        // 🔧 Fix: disable all actions when in connecting/disconnecting state
        return { connect: false, disconnect: false, reconnect: false };
      default:
        return { connect: true, disconnect: false, reconnect: false };
    }
  };
  
  const availableActions = getAvailableActions();
  
  // Check if any action handlers are available
  const hasAnyAction = finalOnConnect || finalOnDisconnect || finalOnReconnect || finalOnEdit || finalOnDelete;
  
  return (
    <div
      ref={mcpServerMenuRef}
      className="dropdown-menu mcp-server-dropdown-menu"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`
      }}
      role="menu"
    >
      {/* If all action handlers are undefined, show a hint */}
      {!hasAnyAction && (
        <div className="dropdown-menu-item" style={{ opacity: 0.6, cursor: 'default' }}>
          No actions available
        </div>
      )}
      
      {availableActions.connect && finalOnConnect && (
        <button
          className="dropdown-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            finalOnConnect(serverName);
            onClose();
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Play size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Connect</span>
        </button>
      )}
      {availableActions.disconnect && finalOnDisconnect && (
        <button
          className="dropdown-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            finalOnDisconnect(serverName);
            onClose();
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Pause size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Disconnect</span>
        </button>
      )}
      {availableActions.reconnect && finalOnReconnect && (
        <button
          className="dropdown-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            finalOnReconnect(serverName);
            onClose();
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><RotateCw size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Reconnect</span>
        </button>
      )}
      {finalOnEdit && (
        <button
          className={`dropdown-menu-item ${(currentServer?.status === 'connecting' || currentServer?.status === 'disconnecting') ? 'disabled' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            // 🔧 Fix: disable Edit action when in connecting/disconnecting state
            if (currentServer?.status === 'connecting' || currentServer?.status === 'disconnecting') {
              return;
            }
            finalOnEdit(serverName);
            onClose();
          }}
          role="menuitem"
          disabled={currentServer?.status === 'connecting' || currentServer?.status === 'disconnecting'}
        >
          <span className="dropdown-menu-item-icon"><Pencil size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Edit</span>
        </button>
      )}
      {finalOnDelete && (
        <button
          className="dropdown-menu-item danger"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            finalOnDelete(serverName);
            onClose();
          }}
          role="menuitem"
        >
          <span className="dropdown-menu-item-icon"><Trash2 size={16} strokeWidth={1.5} /></span>
          <span className="dropdown-menu-item-text">Delete</span>
        </button>
      )}
    </div>
  );
};

export default McpServerDropdownMenu;