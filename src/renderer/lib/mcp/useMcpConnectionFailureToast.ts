/**
 * MCP Connection Failure Toast Hook
 * 
 * Listens for MCP server connection failure events and displays persistent Toast notifications
 * with Reconnect and Manage Server buttons. Toast will not auto-dismiss; user must manually close or click a button.
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/ui/ToastProvider'
import { mcpClientCacheManager } from './mcpClientCacheManager'

interface FailedConnection {
  serverName: string
  error: string
  toastId: string
}

/**
 * Hook: Listens for MCP connection failures and displays Toast notifications
 */
export const useMcpConnectionFailureToast = () => {
  const { showToast, removeToast } = useToast()
  const navigate = useNavigate()
  const failedConnectionsRef = useRef<Map<string, FailedConnection>>(new Map())

  /**
   * Clear the Toast and record for the specified server
   */
  const clearFailedConnection = useCallback((serverName: string) => {
    const failed = failedConnectionsRef.current.get(serverName)
    if (failed) {
      console.log(`[useMcpConnectionFailureToast] Clearing toast for "${serverName}", toastId: ${failed.toastId}`)
      removeToast(failed.toastId)
      failedConnectionsRef.current.delete(serverName)
    }
  }, [removeToast])

  /**
   * Handle reconnect operation
   */
  const handleReconnect = useCallback(async (serverName: string) => {
    try {
      clearFailedConnection(serverName)
      
      // Call reconnect API
      if (window.electronAPI?.profile?.reconnectMcpServer) {
        const result = await window.electronAPI.profile.reconnectMcpServer(serverName)
        if (!result.success) {
          console.error('[useMcpConnectionFailureToast] Reconnect failed:', result.error)
        }
      }
    } catch (error) {
      console.error('[useMcpConnectionFailureToast] Reconnect error:', error)
    }
  }, [clearFailedConnection])

  /**
   * Handle Manage Server action - navigate to MCP settings page and select the corresponding server
   */
  const handleManageServer = useCallback((serverName: string) => {
    clearFailedConnection(serverName)
    // Navigate to MCP settings page with the selectServer parameter
    navigate(`/settings/mcp?selectServer=${encodeURIComponent(serverName)}`)
  }, [clearFailedConnection, navigate])

  /**
   * Handle connection failure event
   */
  const handleConnectionFailure = useCallback((serverName: string, error: string) => {
    console.log('[useMcpConnectionFailureToast] Connection failure:', serverName, error)
    
    // Avoid duplicate notifications for the same server
    if (failedConnectionsRef.current.has(serverName)) {
      console.log('[useMcpConnectionFailureToast] Already notified for:', serverName)
      return
    }

    // Show Toast with Reconnect and Manage Server buttons
    // Use React.createElement to create styled message
    const toastMessage = React.createElement('div', { className: 'flex flex-col gap-1' },
      React.createElement('span', { className: 'font-medium' }, `MCP Server "${serverName}" connection failed`),
      React.createElement('span', { className: 'text-xs opacity-80 break-words max-w-[400px]' }, error)
    )

    // showToast returns the actual toastId, which we need to capture
    const actualToastId = showToast(
      toastMessage,
      'error',
      undefined, // persistent toast does not need duration
      {
        persistent: true, // persistent toast, requires user to manually close or click a button
        actions: [
          {
            label: 'Manage',
            onClick: () => handleManageServer(serverName),
            variant: 'secondary'
          },
          {
            label: 'Reconnect',
            onClick: () => handleReconnect(serverName),
            variant: 'primary'
          }
        ]
      }
    )

    console.log('[useMcpConnectionFailureToast] Created toast with id:', actualToastId)

    // Use the actual toastId returned by showToast
    failedConnectionsRef.current.set(serverName, {
      serverName,
      error,
      toastId: actualToastId
    })
  }, [showToast, handleReconnect, handleManageServer])

  useEffect(() => {
    console.log('[useMcpConnectionFailureToast] Setting up connection failure listener')
    
    // Subscribe to connection failure events
    const unsubscribeFailure = mcpClientCacheManager.subscribeConnectionFailure(handleConnectionFailure)
    
    // Subscribe to data changes; auto-dismiss toast when server status is no longer 'error'
    const unsubscribeData = mcpClientCacheManager.subscribe((data) => {
      // Iterate over currently tracked failed connections
      failedConnectionsRef.current.forEach((failed, serverName) => {
        // Find the current status of the server
        const server = data.servers.find(s => s.name === serverName)
        
        // If server status is no longer 'error', auto-dismiss the toast
        if (server && server.status !== 'error') {
          console.log(`[useMcpConnectionFailureToast] Server "${serverName}" status changed to "${server.status}", auto-dismissing toast`)
          clearFailedConnection(serverName)
        }
      })
    })

    return () => {
      console.log('[useMcpConnectionFailureToast] Cleaning up connection failure listener')
      unsubscribeFailure()
      unsubscribeData()
      failedConnectionsRef.current.clear()
    }
  }, [handleConnectionFailure, clearFailedConnection])
}

export default useMcpConnectionFailureToast
