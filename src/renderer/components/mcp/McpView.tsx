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
    sidepaneWidth: width,
    setSidepaneWidth: setWidth,
    isDragging,
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

  // mcpStats already includes builtin-tools server statistics
  // ProfileDataManager automatically adds the built-in server to mcp_servers
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
        let result: { success: boolean; error?: string };

        // Call appropriate McpOps method based on action
        switch (action) {
          case 'connect':
            result = await McpOps.connect(serverName);
            break;
          case 'disconnect':
            result = await McpOps.disconnect(serverName);
            break;
          case 'reconnect':
            result = await McpOps.reconnect(serverName);
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        if (!result.success) {
          throw new Error(result.error || `Failed to ${action} server`);
        }

        // Refresh global state and clear operation state after a delay
        // 🔧 Fix: delay clearing operation state to ensure backend state updates have enough time to propagate to frontend
        setTimeout(() => {
          refreshRuntimeInfo().catch(() => {});
          // Clear operation state to show real server status
          setOperationStates((prev) => {
            const newStates = { ...prev };
            delete newStates[serverName];
            return newStates;
          });
        }, 500); // Extended delay to ensure backend state updates have time to propagate
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

  // Server operation handlers - if external handlers are provided, use them; otherwise use local ones
  const handleConnectServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerConnect) {
        onMcpServerConnect(serverName);
        return;
      }

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
    [performServerOperation, showError, servers, onMcpServerConnect],
  );

  const handleDisconnectServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerDisconnect) {
        onMcpServerDisconnect(serverName);
        return;
      }

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
    [performServerOperation, showError, servers, onMcpServerDisconnect],
  );

  const handleReconnectServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerReconnect) {
        onMcpServerReconnect(serverName);
        return;
      }

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
    [performServerOperation, showError, servers, onMcpServerReconnect],
  );

  const handleDeleteServer = useCallback(
    (serverName: string) => {
      // If external handler is provided, use it (will show confirmation dialog)
      if (onMcpServerDelete) {
        onMcpServerDelete(serverName);
        return;
      }

      // Local handler (no longer uses window.confirm, deletes directly)
      // Note: when used in SettingsPage, the onMcpServerDelete callback shows a confirmation dialog
      // This local handler is only a fallback and won't actually be called
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
    [showError, servers, onMcpServerDelete],
  );

  const handleEditServer = useCallback(
    async (serverName: string) => {
      if (onMcpServerEdit) {
        onMcpServerEdit(serverName);
        return;
      }

      // Navigate to edit page
      navigate(`/settings/mcp/edit/${encodeURIComponent(serverName)}`);
    },
    [navigate, onMcpServerEdit],
  );

  // Handle server added callback
  const handleServerAdded = useCallback(() => {
    // Refresh global state to reflect newly added/updated server
    setTimeout(async () => {
      try {
        await refreshRuntimeInfo();
      } catch (error) {}
    }, 500); // Slightly extend wait time to ensure server initialization is complete
  }, [refreshRuntimeInfo]);


  // Note: MCP servers can be added via the New Server button or VS Code import

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
