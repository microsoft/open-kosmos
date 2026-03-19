'use client'

import React, { useState, useCallback, useMemo, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import '../../styles/ContentView.css';
import '../../styles/McpContentView.css';
import { useMCPServers } from '../userData/userDataProvider'
import McpServerListView from './McpServerListView'
import McpToolListView from './McpToolListView'
import McpToolDetailView from './McpToolDetailView'
import { MCPServerExtended } from '../../lib/userData/types'
import { MCPTool } from '../../types/mcpTypes'
// Builtin tools now accessed via IPC

interface McpContentViewProps {
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
  onMcpServerMenuToggle?: (serverName: string, buttonElement: HTMLElement) => void
  mcpServerMenuState?: {
    isOpen: boolean
    serverName: string | null
    position: { top: number; left: number } | null
  }
}

const McpContentView: React.FC<McpContentViewProps> = ({
  servers,
  isLoading,
  operationStates,
  onConnect,
  onDisconnect,
  onReconnect,
  onDelete,
  onEdit,
  onMcpServerMenuToggle,
  mcpServerMenuState
}) => {
  // Builtin tools are now initialized in main process automatically
  
  // Get URL parameters
  const [searchParams, setSearchParams] = useSearchParams()
  const selectServerFromUrl = searchParams.get('selectServer')

  // Selected server (default: built-in tools server)
  const [selectedServer, setSelectedServer] = useState<MCPServerExtended | null>({
    name: 'builtin-tools',
    transport: 'stdio' as const,
    command: '',
    args: [],
    env: {},
    url: '',
    in_use: true,
    status: 'connected' as const,
    tools: [],
    error: undefined
  })
  
  // Selected tool
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null)
  
  // View state: 'list' shows tool list, 'detail' shows tool details
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')

  // Handle URL parameter selectServer, auto-select the corresponding server
  useEffect(() => {
    if (selectServerFromUrl && servers.length > 0) {
      const targetServer = servers.find(s => s.name === selectServerFromUrl)
      if (targetServer) {
        setSelectedServer(targetServer)
        // Clear URL parameter to avoid repeated triggering
        setSearchParams(prev => {
          prev.delete('selectServer')
          return prev
        }, { replace: true })
      }
    }
  }, [selectServerFromUrl, servers, setSearchParams])

  // When servers change, update selected server (but keep built-in tools server selection)
  React.useEffect(() => {
    if (selectedServer && selectedServer.name !== 'builtin-tools') {
      // If currently selected server is not the built-in tools server and it was deleted
      if (!servers.find(s => s.name === selectedServer.name)) {
        // Fall back to the built-in tools server
        setSelectedServer({
          name: 'builtin-tools',
          transport: 'stdio' as const,
          command: '',
          args: [],
          env: {},
          url: '',
          in_use: true,
          status: 'connected' as const,
          tools: [],
          error: undefined
        })
      }
    }
  }, [servers, selectedServer])

  // Get tools for the selected server
  const [builtinTools, setBuiltinTools] = React.useState<MCPTool[]>([])
  
  React.useEffect(() => {
    if (selectedServer?.name === 'builtin-tools') {
      const fetchBuiltinTools = async () => {
        try {
          const result = await window.electronAPI?.builtinTools?.getAllTools?.()
          if (result?.success && result.data) {
            setBuiltinTools(result.data)
          }
        } catch (error) {
        }
      }
      fetchBuiltinTools()
    } else {
      setBuiltinTools([])
    }
  }, [selectedServer])
  
  const selectedServerTools = useMemo(() => {
    // If it's the built-in tools server, use the IPC-fetched tool list
    if (selectedServer?.name === 'builtin-tools') {
      return builtinTools
    }
    return selectedServer?.tools || []
  }, [selectedServer, builtinTools])

  // When selected server changes, auto-select the first tool
  React.useEffect(() => {
    if (selectedServerTools.length > 0) {
      setSelectedTool(selectedServerTools[0])
    } else {
      setSelectedTool(null)
    }
  }, [selectedServerTools])

  // Handle server selection
  const handleServerSelect = useCallback((server: MCPServerExtended) => {
    setSelectedServer(server)
  }, [])

  // Handle tool selection
  const handleToolSelect = useCallback((tool: MCPTool) => {
    setSelectedTool(tool)
    setViewMode('detail') // Switch to detail view
  }, [])
  
  // Handle back to list
  const handleBackToList = useCallback(() => {
    setViewMode('list')
  }, [])

  // Wrap server actions to maintain selected state after operation
  const handleConnect = useCallback((serverName: string) => {
    onConnect(serverName)
  }, [onConnect])

  const handleDisconnect = useCallback((serverName: string) => {
    onDisconnect(serverName)
  }, [onDisconnect])

  const handleReconnect = useCallback((serverName: string) => {
    onReconnect(serverName)
  }, [onReconnect])

  const handleDelete = useCallback((serverName: string) => {
    onDelete(serverName)
  }, [onDelete])

  const handleEdit = useCallback((serverName: string) => {
    onEdit(serverName)
  }, [onEdit])

  return (
    <div className="mcp-content-view">
      {/* Left side: Server list */}
      <div className="server-list-panel">
        <McpServerListView
          servers={servers}
          isLoading={isLoading}
          operationStates={operationStates}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onReconnect={handleReconnect}
          onDelete={handleDelete}
          onEdit={handleEdit}
          selectedServer={selectedServer}
          onSelectServer={handleServerSelect}
          onMcpServerMenuToggle={onMcpServerMenuToggle}
          mcpServerMenuState={mcpServerMenuState}
          mcpServerOperations={{
            onConnect: handleConnect,
            onDisconnect: handleDisconnect,
            onReconnect: handleReconnect,
            onDelete: handleDelete,
            onEdit: handleEdit
          }}
        />
      </div>

      {/* Tool view area - single view mode */}
      <div className="tool-view-panel">
        {viewMode === 'list' ? (
          <McpToolListView
            tools={selectedServerTools}
            selectedTool={selectedTool}
            onSelectTool={handleToolSelect}
            isLoading={isLoading && !selectedServer}
          />
        ) : (
          <McpToolDetailView
            tool={selectedTool}
            serverName={selectedServer?.name}
            onBack={handleBackToList}
          />
        )}
      </div>

      </div>
  )
}

export default McpContentView