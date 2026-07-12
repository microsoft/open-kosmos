'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import '../../styles/ServerCard.css';
import '../../styles/McpServerListView.css';
import ServerCard from './McpServerCard'
import { MCPServerExtended } from '../../lib/userData/types'
import ListSearchBox from '../ui/ListSearchBox'
import { useAutoHideScrollbar } from '../../lib/hooks/useAutoHideScrollbar'
import { useI18n } from '../../lib/i18n/useI18n'
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
  onSelectServer?: (server: MCPServerExtended | null) => void
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
  const { t } = useI18n()

  // Store operation functions on the window object for access by the AppLayout menu components
  React.useEffect(() => {
    if (mcpServerOperations) {
      (window as any).__mcpServerOperations = mcpServerOperations;
    }
    return () => {
      delete (window as any).__mcpServerOperations;
    };
  }, [mcpServerOperations]);
  // Menu state is now managed centrally by AppLayout; local state is no longer needed
  const handleMenuToggle = (serverName: string) => (event: React.MouseEvent) => {
    event.stopPropagation()
    if (onMcpServerMenuToggle) {
      onMcpServerMenuToggle(serverName, event.currentTarget as HTMLElement)
    }
  }

  // 🆕 Built-in server constant
  const BUILTIN_SERVER_NAME = 'builtin-tools'

  // 🆕 Separate built-in server from regular servers; built-in server is pinned at the top
  const builtinServer = servers.find(s => s.name === BUILTIN_SERVER_NAME)
  const regularServers = servers.filter(s => s.name !== BUILTIN_SERVER_NAME && !s.hidden)

  // 🆕 Regular servers in reverse order (newest first), with built-in server at the very top
  const sortedServers = builtinServer
    ? [builtinServer, ...regularServers.slice().reverse()]
    : regularServers.slice().reverse()

  // 🆕 Search filter
  const [searchQuery, setSearchQuery] = useState('')
  const scrollRef = useAutoHideScrollbar<HTMLDivElement>()
  const searchChangedRef = useRef(false)
  const handleSearchChange = (value: string) => {
    searchChangedRef.current = true
    setSearchQuery(value)
  }
  const filteredServers = searchQuery
    ? sortedServers.filter(s => s.name?.includes(searchQuery))
    : sortedServers

  // Stable identity for filtered list — catches same-length content changes
  const filteredIdentity = useMemo(
    () => filteredServers.map(s => s.name ?? '').join('\0'),
    [filteredServers]
  )

  // Keep selection in sync with filtered results (also handles initial selection)
  // Depend on selectedServer?.name so external selection changes (e.g. URL selectServer param) are caught
  useEffect(() => {
    const isUserSearch = searchChangedRef.current
    searchChangedRef.current = false

    if (filteredServers.length === 0) {
      if (selectedServer) {
        // External selection while filter yields zero — clear search to reveal the item
        if (!isUserSearch && searchQuery && sortedServers.some(s => s.name === selectedServer.name)) {
          setSearchQuery('')
          return
        }
        if (isUserSearch) return
        onSelectServer?.(null)
      }
      return
    }
    if (!selectedServer) {
      onSelectServer?.(filteredServers[0])
      return
    }
    const currentInFiltered = filteredServers.some(s => s.name === selectedServer.name)
    if (!currentInFiltered) {
      // External selection of an off-filter item — clear search to reveal it
      if (!isUserSearch && searchQuery && sortedServers.some(s => s.name === selectedServer.name)) {
        setSearchQuery('')
        return
      }
      onSelectServer?.(filteredServers[0])
    }
  }, [searchQuery, filteredIdentity, selectedServer?.name])

  return (
    <div className="mcp-server-list-container">
      {/* Server list */}
      {isLoading ? (
        <div className="loading-indicator">{t('mcp.server.loading')}</div>
      ) : (
        <>
          {servers && servers.length > 0 && (
            <ListSearchBox
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={t('mcp.server.searchPlaceholder')}
            />
          )}
          <div className="server-cards" ref={scrollRef}>
          {servers && servers.length > 0 ? (
            filteredServers.map((server, index) => {
              const isSelected = selectedServer?.name === server.name
              const serverName = server.name || `Server ${index + 1}`
              const isMenuOpen = mcpServerMenuState?.isOpen && mcpServerMenuState?.serverName === serverName

              // 🆕 Built-in server does not show the menu
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

                  {/* Dropdown Menu is now managed centrally by AppLayout */}
                </div>
              )
            })
          ) : (
            <div className="empty-state">
              <div>{t('mcp.server.empty')}</div>
            </div>
          )}
          </div>
        </>
      )}

      </div>
  )
}

export default McpServerListView