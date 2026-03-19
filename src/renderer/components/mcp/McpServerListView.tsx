'use client'

import React, { useState, useRef, useEffect } from 'react'
import '../../styles/ServerCard.css';
import '../../styles/McpServerListView.css';
import ServerCard from './McpServerCard'
import { MCPServerExtended } from '../../lib/userData/types'
// Builtin tools now accessed via IPC

interface McpServerListViewProps {
  servers: MCPServerExtended[]
  isLoading: boolean
  operationStates: Record<string, {
    isOperating: boolean
    operation?: 'connect' | 'disconnect' | 'reconnect'
  }>
  onConnect: (serverName: string) => void
  onDisconnect: (serverName: string) => void
  onReconnect: (serverName: string) => void
  onDelete: (serverName: string) => void
  onEdit: (serverName: string) => void
  selectedServer?: MCPServerExtended | null
  onSelectServer?: (server: MCPServerExtended) => void
  onMcpServerMenuToggle?: (serverName: string, buttonElement: HTMLElement) => void
  mcpServerMenuState?: {
    isOpen: boolean
    serverName: string | null
    position: { top: number; left: number } | null
  }
  mcpServerOperations?: {
    onConnect: (serverName: string) => void
    onDisconnect: (serverName: string) => void
    onReconnect: (serverName: string) => void
    onDelete: (serverName: string) => void
    onEdit: (serverName: string) => void
  }
}

const McpServerListView: React.FC<McpServerListViewProps> = ({
  servers,
  isLoading,
  operationStates,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  selectedServer,
  onSelectServer,
  onMcpServerMenuToggle,
  mcpServerMenuState,
  mcpServerOperations
}) => {
  // Store operation functions on window object for AppLayout menu component access
  React.useEffect(() => {
    if (mcpServerOperations) {
      (window as any).__mcpServerOperations = mcpServerOperations;
    }
    return () => {
      delete (window as any).__mcpServerOperations;
    };
  }, [mcpServerOperations]);
  // Menu state is now managed centrally by AppLayout, local state no longer needed
  const handleMenuToggle = (serverName: string) => (event: React.MouseEvent) => {
    event.stopPropagation()
    if (onMcpServerMenuToggle) {
      onMcpServerMenuToggle(serverName, event.currentTarget as HTMLElement)
    }
  }

  const handleMenuAction = (action: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation()
    action()
  }

  // Helper function to get available actions and state for a server
  const getServerActionState = (server: MCPServerExtended, serverName: string) => {
    const operationState = operationStates[serverName]
    const isOperating = operationState?.isOperating || false
    const currentOperation = operationState?.operation
    const serverTools = server.tools || []
    const hasError = !!server.error

    const getCurrentState = () => {
      // 🔧 Fix: consistent state judgment logic with McpServerCard.tsx
      // Operation state should have the highest priority
      if (isOperating) {
        if (currentOperation === 'connect') return 'connecting'
        if (currentOperation === 'disconnect') return 'disconnecting'
        if (currentOperation === 'reconnect') return 'connecting'
      }
      
      // 🔧 Fix: if server status is explicitly connecting or disconnecting, prioritize these states
      if (server.status === 'connecting') return 'connecting'
      if (server.status === 'disconnecting') return 'disconnecting'
      
      // Basic state judgment - priority order
      if (server.status === 'connected' && serverTools.length > 0) return 'connected'
      if (server.status === 'error') return 'error'
      if (server.status !== 'connected' && hasError) return 'error'
      
      return server.status || 'disconnected'
    }

    const currentState = getCurrentState()

    const getAvailableActions = () => {
      if (isOperating) return { connect: false, disconnect: false, reconnect: false }
      
      switch (currentState) {
        case 'disconnected':
          return { connect: true, disconnect: false, reconnect: false }
        case 'connected':
          return { connect: false, disconnect: true, reconnect: false }
        case 'error':
          return { connect: false, disconnect: true, reconnect: true }
        case 'connecting':
          return { connect: false, disconnect: true, reconnect: false }
        case 'disconnecting':
          return { connect: false, disconnect: false, reconnect: false }
        default:
          return { connect: false, disconnect: false, reconnect: false }
      }
    }

    const availableActions = getAvailableActions()
    const shouldDisableButtons = currentState === 'connecting' || currentState === 'disconnecting'

    return { availableActions, shouldDisableButtons, isOperating, currentOperation }
  }

  // 🆕 Built-in server constant
  const BUILTIN_SERVER_NAME = 'builtin-tools'
  
  // 🆕 Separate built-in server and regular servers, built-in server fixed at first position
  const builtinServer = servers.find(s => s.name === BUILTIN_SERVER_NAME)
  const regularServers = servers.filter(s => s.name !== BUILTIN_SERVER_NAME)
  
  // 🆕 Regular servers in reverse order (newest first), built-in server at the top
  const sortedServers = builtinServer
    ? [builtinServer, ...regularServers.slice().reverse()]
    : regularServers.slice().reverse()

  return (
    <div className="mcp-server-list-container">
      {/* Server list */}
      {isLoading ? (
        <div className="loading-indicator">Loading servers...</div>
      ) : (
        <div className="server-cards">
          {servers && servers.length > 0 ? (
            sortedServers.map((server, index) => {
              const isSelected = selectedServer?.name === server.name
              const serverName = server.name || `Server ${index + 1}`
              const isMenuOpen = mcpServerMenuState?.isOpen && mcpServerMenuState?.serverName === serverName
              const actionState = getServerActionState(server, serverName)
              
              // 🆕 Built-in server doesn't show menu
              const isBuiltinServer = server.name === BUILTIN_SERVER_NAME
              
              return (
                <div
                  key={server.name || index}
                  className={`server-card-wrapper ${isSelected ? 'selected' : ''} ${isMenuOpen ? 'menu-open' : ''} ${isBuiltinServer ? 'builtin-server' : ''}`}
                  onClick={() => onSelectServer?.(server)}
                >
                  <ServerCard
                    serverName={serverName}
                    operationState={operationStates[serverName]}
                    onConnect={() => onConnect(serverName)}
                    onDisconnect={() => onDisconnect(serverName)}
                    onReconnect={() => onReconnect(serverName)}
                    onDelete={() => onDelete(serverName)}
                    onEdit={() => onEdit(serverName)}
                    onMenuToggle={handleMenuToggle(serverName)}
                    isMenuOpen={isMenuOpen}
                    isSelected={isSelected}
                  />
                  
                  {/* Dropdown Menu moved to AppLayout for centralized management */}
                </div>
              )
            })
          ) : (
            <div className="empty-state">
              <div>No MCP servers configured. Click "Add Server" to get started.</div>
            </div>
          )}
        </div>
      )}

      </div>
  )
}

export default McpServerListView