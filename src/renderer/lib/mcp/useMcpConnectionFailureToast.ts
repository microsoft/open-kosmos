/**
 * MCP Connection Failure Toast Hook
 *
 * Listens for MCP server connection failure events and displays a persistent Toast notification with Reconnect and Manage Server buttons.
 * The Toast does not auto-dismiss; the user must manually close it or click a button.
 */

import React, { useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../components/ui/ToastProvider'
import ErrorDetailsDialog from '../../components/ui/ErrorDetailsDialog'
import { mcpClientCacheManager } from './mcpClientCacheManager'
import { createLogger } from '../utilities/logger';
const logger = createLogger('[UseMcpConnectionFailureToast]');

interface FailedConnection {
  serverName: string
  error: string
  toastId: string
}

interface ErrorDetailsState {
  open: boolean
  serverName: string
  error: string
}

interface McpErrorSummary {
  summary: string
  preview: string[]
  remainingLineCount: number
}

const PREVIEW_LINE_COUNT = 4

const splitMcpError = (error: string): { primary: string; stderr: string } => {
  const normalized = error.trim()
  const stderrMatch = normalized.match(/^(.*?)\n+Stderr output:\n([\s\S]*)$/i)

  if (!stderrMatch) {
    return {
      primary: normalized,
      stderr: ''
    }
  }

  return {
    primary: stderrMatch[1].trim(),
    stderr: stderrMatch[2].trim()
  }
}

const summarizeMcpError = (error: string): McpErrorSummary => {
  const { primary, stderr } = splitMcpError(error)
  const normalizedPrimary = primary.replace(/^Failed to initialize MCP server:\s*/i, '').trim()
  const summary = normalizedPrimary.split('\n').find(Boolean)?.trim() || 'Connection failed'

  const detailLinesSource = stderr || normalizedPrimary
  const previewLines = detailLinesSource
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)

  const preview = previewLines.slice(0, PREVIEW_LINE_COUNT)
  const remainingLineCount = Math.max(0, previewLines.length - preview.length)

  return {
    summary,
    preview,
    remainingLineCount
  }
}

/**
 * Hook: listen for MCP connection failures and display Toast notifications
 */
export const useMcpConnectionFailureToast = () => {
  const { showToast, removeToast } = useToast()
  const navigate = useNavigate()
  const failedConnectionsRef = useRef<Map<string, FailedConnection>>(new Map())
  const [errorDetailsState, setErrorDetailsState] = React.useState<ErrorDetailsState>({
    open: false,
    serverName: '',
    error: ''
  })

  /**
   * Clear the Toast and record for a given server
   */
  const clearFailedConnection = useCallback((serverName: string) => {
    const failed = failedConnectionsRef.current.get(serverName)
    if (failed) {
      logger.debug(`[useMcpConnectionFailureToast] Clearing toast for "${serverName}", toastId: ${failed.toastId}`)
      removeToast(failed.toastId)
      failedConnectionsRef.current.delete(serverName)
    }
  }, [removeToast])

  /**
   * Handle reconnect action
   */
  const handleReconnect = useCallback(async (serverName: string) => {
    try {
      clearFailedConnection(serverName)

      // Call reconnect API
      if (window.electronAPI?.profile?.reconnectMcpServer) {
        const result = await window.electronAPI.profile.reconnectMcpServer(serverName)
        if (!result.success) {
          logger.error('[useMcpConnectionFailureToast] Reconnect failed:', result.error)
        }
      }
    } catch (error) {
      logger.error('[useMcpConnectionFailureToast] Reconnect error:', error)
    }
  }, [clearFailedConnection])

  /**
   * Handle Manage Server action - navigate to the MCP settings page and select the corresponding server
   */
  const handleManageServer = useCallback((serverName: string) => {
    clearFailedConnection(serverName)
    // Navigate to the MCP settings page with the selectServer query param
    navigate(`/settings/mcp?selectServer=${encodeURIComponent(serverName)}`)
  }, [clearFailedConnection, navigate])

  const handleShowDetails = useCallback((serverName: string, error: string) => {
    clearFailedConnection(serverName)
    setErrorDetailsState({
      open: true,
      serverName,
      error
    })
  }, [clearFailedConnection])

  /**
   * Handle connection failure events
   */
  const handleConnectionFailure = useCallback((serverName: string, error: string) => {
    logger.debug('[useMcpConnectionFailureToast] Connection failure:', serverName, error)

    // Avoid duplicate notifications for the same server
    if (failedConnectionsRef.current.has(serverName)) {
      logger.debug('[useMcpConnectionFailureToast] Already notified for:', serverName)
      return
    }

    const summary = summarizeMcpError(error)

    // Show a Toast with Reconnect and Manage Server buttons
    const toastMessage = React.createElement('div', { className: 'flex flex-col gap-1' },
      React.createElement('span', { className: 'font-medium' }, `MCP Server "${serverName}" connection failed`),
      React.createElement('span', { className: 'text-xs opacity-90 wrap-anywhere' }, summary.summary),
      summary.preview.length > 0
        ? React.createElement('div', { className: 'text-xs opacity-80 whitespace-pre-wrap wrap-anywhere' }, summary.preview.join('\n'))
        : null,
      summary.remainingLineCount > 0
        ? React.createElement('span', { className: 'text-[11px] opacity-70' }, `+${summary.remainingLineCount} more lines`)
        : null
    )

    // showToast returns the actual toastId; we need to capture it
    const actualToastId = showToast(
      toastMessage,
      'error',
      undefined, // persistent toast does not need a duration
      {
        persistent: true, // Persistent toast; requires user to manually dismiss or click a button
        onDismiss: () => {
          failedConnectionsRef.current.delete(serverName)
        },
        actions: [
          {
            label: 'Manage',
            onClick: () => handleManageServer(serverName),
            variant: 'secondary'
          },
          {
            label: 'Details',
            onClick: () => handleShowDetails(serverName, error),
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

    logger.debug('[useMcpConnectionFailureToast] Created toast with id:', actualToastId)

    // Use the actual toastId returned by showToast
    failedConnectionsRef.current.set(serverName, {
      serverName,
      error,
      toastId: actualToastId
    })
  }, [showToast, handleReconnect, handleManageServer, handleShowDetails])

  useEffect(() => {
    logger.debug('[useMcpConnectionFailureToast] Setting up connection failure listener')

    // Subscribe to connection failure events
    const unsubscribeFailure = mcpClientCacheManager.subscribeConnectionFailure(handleConnectionFailure)

    // Subscribe to data changes; auto-dismiss toast when server status is no longer 'error'
    const unsubscribeData = mcpClientCacheManager.subscribe((data) => {
      // Iterate over currently tracked failed connections
      failedConnectionsRef.current.forEach((failed, serverName) => {
        // Find the server's current status
        const server = data.servers.find(s => s.name === serverName)

        // If the server status is no longer 'error', auto-dismiss the toast
        if (server && server.status !== 'error') {
          logger.debug(`[useMcpConnectionFailureToast] Server "${serverName}" status changed to "${server.status}", auto-dismissing toast`)
          clearFailedConnection(serverName)
        }
      })
    })

    return () => {
      logger.debug('[useMcpConnectionFailureToast] Cleaning up connection failure listener')
      unsubscribeFailure()
      unsubscribeData()
      failedConnectionsRef.current.clear()
    }
  }, [handleConnectionFailure, clearFailedConnection])
  return React.createElement(ErrorDetailsDialog, {
    open: errorDetailsState.open,
    title: 'MCP connection error',
    subtitle: errorDetailsState.serverName ? `Server: ${errorDetailsState.serverName}` : undefined,
    details: errorDetailsState.error,
    onOpenChange: (open: boolean) => setErrorDetailsState(prev => ({ ...prev, open }))
  })
}

export default useMcpConnectionFailureToast
