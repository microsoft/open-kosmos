'use client'

import React from 'react'
import { MoreHorizontal } from 'lucide-react';
import '../../styles/ServerCard.css';
import { useMCPServers } from '../userData/userDataProvider'

interface ServerCardProps {
  serverName: string
  operationState?: {
    isOperating: boolean
    operation?: 'connect' | 'disconnect' | 'reconnect'
  }
  onConnect: () => void
  onDisconnect: () => void
  onReconnect: () => void
  onDelete: () => void
  onEdit: () => void
  onMenuToggle?: (event: React.MouseEvent) => void
  isMenuOpen?: boolean
  isSelected?: boolean
}

const ServerCard: React.FC<ServerCardProps> = ({
  serverName,
  operationState,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  onMenuToggle,
  isMenuOpen = false,
  isSelected = false
}) => {
  const { servers, tools } = useMCPServers()

  // Find the server by name
  const server = servers.find(s => s.name === serverName)
  if (!server) return null

  // 🆕 Check if this is the built-in server
  const BUILTIN_SERVER_NAME = 'builtin-tools'
  const isBuiltinServer = server.name === BUILTIN_SERVER_NAME

  // 🔌 Check if this is a plugin server (source === 'PLUGIN' or name starts with 'plugin:')
  const isPluginServer = server.source === 'PLUGIN' || server.name.startsWith('plugin--')

  const isOperating = operationState?.isOperating || false
  const currentOperation = operationState?.operation

  // Get tools for this server
  const serverTools = server.tools || []
  const hasError = !!server.error
  const error = server.error

  // Calculate current state - according to state transition matrix
  const getCurrentState = () => {
    // 🔧 Fix: operation state should have the highest priority
    // When user is performing an operation, the in-progress state should take priority over any stale server state
    if (isOperating) {
      // Operation in progress state - these states have the highest priority
      if (currentOperation === 'connect') return 'connecting'
      if (currentOperation === 'disconnect') return 'disconnecting'
      if (currentOperation === 'reconnect') return 'connecting'
    }

    // 🔧 Fix: if server status is explicitly 'connecting' or 'disconnecting', prioritize those statuses
    // This resolves timing issues with status updates after a reconnect operation calls connect
    if (server.status === 'connecting') return 'connecting'
    if (server.status === 'disconnecting') return 'disconnecting'
    if (server.status === 'needs-user-interaction') return 'needs-user-interaction'

    // Basic state judgment - priority order
    // 1. If connected and has tools, return connected
    if (server.status === 'connected' && serverTools.length > 0) return 'connected'

    // 2. If server.status is explicitly error, return error
    if (server.status === 'error') return 'error'

    // 3. If server status is not connected and has error info, return error
    if (server.status !== 'connected' && hasError) return 'error'

    // 4. Default return server original status
    return server.status || 'disconnected'
  }

  const currentState = getCurrentState()

  // Determine available operations according to state transition matrix - allow disconnect from connecting state
  const getAvailableActions = () => {
    if (isOperating) return { connect: false, disconnect: false, reconnect: false }

    switch (currentState) {
      case 'disconnected':
        return { connect: true, disconnect: false, reconnect: false }
      case 'connected':
        return { connect: false, disconnect: true, reconnect: false }
      case 'error':
        // error state can both reconnect and disconnect
        return { connect: false, disconnect: true, reconnect: true }
      case 'needs-user-interaction':
        return { connect: false, disconnect: true, reconnect: true }
      case 'connecting':
        // connecting state allows disconnect (cancel connection)
        return { connect: false, disconnect: true, reconnect: false }
      case 'disconnecting':
        return { connect: false, disconnect: false, reconnect: false }
      default:
        return { connect: false, disconnect: false, reconnect: false }
    }
  }

  const availableActions = getAvailableActions()

  // Check if buttons should be disabled (connecting/disconnecting states)
  const shouldDisableButtons = currentState === 'connecting' || currentState === 'disconnecting'

  // Status style mapping
  const statusClass = currentState === 'disconnecting'
    ? 'connecting'
    : currentState === 'needs-user-interaction'
      ? 'connecting'
      : currentState
  const statusLabel = currentState === 'needs-user-interaction' ? 'needs sign-in' : currentState


  return (
    <div className="server-card">
      <div className="server-card-header">
        <div className="server-info">
          <div className="server-name-group">
            <div className="server-title-row">
              <h4 className="server-name">{serverName}</h4>
              {isBuiltinServer && <span className="builtin-badge">Built-in</span>}
              {isPluginServer && <span className="builtin-badge" style={{ background: 'var(--color-accent-secondary, #6b5ce7)', opacity: 0.85 }}>Plugin</span>}
            </div>
            {/* Row 2: version and source */}
            {(server.version || server.source) && (
              <div className="server-meta-group">
                {server.version && (
                  <span className="server-version-badge">v{server.version}</span>
                )}
                {server.source && (
                  <span className="server-source-badge">{server.source}</span>
                )}
                {/[/\\]agency(?:\.exe)?$/.test(server.command) && (
                  <span className="server-source-badge" style={{ backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>M365</span>
                )}
              </div>
            )}
            {/* Row 3: status and tool count */}
            <div className="server-status-group">
              <span className={`server-status ${statusClass}`}>{statusLabel}</span>
              {currentState === 'connected' && (
                <span className="tools-badge">
                  tools: {serverTools.length}
                </span>
              )}
              {hasError && (currentState === 'error' || currentState === 'needs-user-interaction') && (
                <span className="error-indicator" title={error || 'Connection error'}>
                  ⚠️
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Menu Button - 🆕 built-in and plugin servers do not show the menu button */}
        {!isBuiltinServer && !isPluginServer && (
          <div className={`server-menu-container ${isMenuOpen ? 'menu-open' : ''}`}>
            <button
              className="server-menu-btn"
              onClick={onMenuToggle}
              title="More options"
            >
              <MoreHorizontal size={16} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      </div>
  )
}

export default ServerCard