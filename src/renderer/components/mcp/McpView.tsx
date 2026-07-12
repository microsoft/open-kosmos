'use client'

import React, { useState, useCallback } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom';
import { useMCPServers } from '../userData/userDataProvider';
import { useToast } from '../ui/ToastProvider';
import McpHeaderView from './McpHeaderView';
import McpContentView from './McpContentView';
import { McpOps } from '../../lib/mcp/mcpOps';
import { AgentContextType } from '../../types/agentContextTypes';

const McpView: React.FC = () => {
  const navigate = useNavigate();
  const {
    onMcpServerMenuToggle,
    mcpServerMenuState,
    onMcpServerConnect,
    onMcpServerDisconnect,
    onMcpServerReconnect,
    onMcpServerDelete,
    onMcpServerEdit,
    onMcpAddMenuToggle,
  } = useOutletContext<AgentContextType>();

  // Use ProfileDataManager for MCP servers data
  const {
    servers,
    stats: mcpStats,
    tools,
    refreshRuntimeInfo,
    isLoading,
  } = useMCPServers();

  const { showError } = useToast();

  // mcpStats already includes statistics for the builtin-tools server
  // ProfileDataManager automatically adds built-in servers to mcp_servers
  const totalServers = mcpStats.totalServers;
  const connectedServers = mcpStats.connectedServers;
  const totalTools = mcpStats.totalTools;

  // Local state management
  const [operationStates, setOperationStates] = useState<
    Record<
      string,
      {
        isOperating: boolean;
        operation?: 'connect' | 'disconnect' | 'reconnect';
      }
    >
  >({});

  // Helper function for server operations - using McpOps API
  const performServerOperation = useCallback(
    async (
      serverName: string,
      action: 'connect' | 'disconnect' | 'reconnect',
    ) => {
      // Set operation state
      setOperationStates((prev) => ({
        ...prev,
        [serverName]: { isOperating: true, operation: action },
      }));

      try {
        const operationMap = {
          connect: McpOps.connect,
          disconnect: McpOps.disconnect,
          reconnect: McpOps.reconnect,
        } as const;
        const result = await operationMap[action](serverName);

        if (!result.success) {
          throw new Error(result.error || `Failed to ${action} server`);
        }

        // Refresh global state and clear operation state after a delay
        // 🔧 Fix: delay clearing operation state to allow enough time for backend state updates to propagate to the frontend
        setTimeout(() => {
          refreshRuntimeInfo().catch(() => {});
          // Clear operation state to show the server's actual status
          setOperationStates((prev) => {
            const newStates = { ...prev };
            delete newStates[serverName];
            return newStates;
          });
        }, 500); // Increase delay to ensure backend state update has time to propagate
      } catch (error) {
        // Clear operation state immediately on error
        setOperationStates((prev) => {
          const newStates = { ...prev };
          delete newStates[serverName];
          return newStates;
        });
        throw error;
      }
    },
    [refreshRuntimeInfo],
  );

  // Server operation handlers - use externally passed handlers if available; otherwise use local ones
  const handleConnectServer = useCallback(
    async (serverName: string) => {
      try {
        await performServerOperation(serverName, 'connect');
      } catch (error) {
        showError(
          `Failed to connect server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [performServerOperation, showError],
  );

  const handleDisconnectServer = useCallback(
    async (serverName: string) => {
      try {
        await performServerOperation(serverName, 'disconnect');
      } catch (error) {
        showError(
          `Failed to disconnect server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [performServerOperation, showError],
  );

  const handleReconnectServer = useCallback(
    async (serverName: string) => {
      try {
        await performServerOperation(serverName, 'reconnect');
      } catch (error) {
        showError(
          `Failed to reconnect server: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    [performServerOperation, showError],
  );

  const handleDeleteServer = useCallback(
    (serverName: string) => {
      // Local handling (no longer uses window.confirm, deletes directly)
      // Note: when used in SettingsPage, the confirmation dialog is shown via the onMcpServerDelete callback
      // This local handler is a fallback and in practice will not be called
      (async () => {
        try {
          // Use McpOps API to delete server
          const result = await McpOps.delete(serverName);

          if (!result.success) {
            throw new Error(result.error || 'Failed to delete server');
          }

          // mcpClientManager will notify ProfileDataManager automatically via IPC
          // No need for manual cache updates here
        } catch (error) {
          showError(
            `Failed to delete server: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      })();
    },
    [showError],
  );

  const handleEditServer = useCallback(
    async (serverName: string) => {
      // Navigate to edit page
      navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
    },
    [navigate],
  );

  return (
    <div className="mcp-view">
      <McpHeaderView
        totalServers={totalServers}
        connectedServers={connectedServers}
        totalTools={totalTools}
        onAddMenuToggle={onMcpAddMenuToggle || (() => {})}
      />

      <McpContentView
        servers={servers}
        isLoading={isLoading}
        operationStates={operationStates}
        onConnect={onMcpServerConnect || handleConnectServer}
        onDisconnect={onMcpServerDisconnect || handleDisconnectServer}
        onReconnect={onMcpServerReconnect || handleReconnectServer}
        onDelete={onMcpServerDelete || handleDeleteServer}
        onEdit={onMcpServerEdit || handleEditServer}
        onMcpServerMenuToggle={onMcpServerMenuToggle}
        mcpServerMenuState={mcpServerMenuState}
      />
    </div>
  );
};


export default McpView
