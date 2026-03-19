import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, ChevronDown, Settings } from 'lucide-react';

import '../../../styles/Agent.css';
import { TabComponentProps, AgentMcpServer } from './types';
import { useMCPServers } from '../../userData/userDataProvider';
import { useLayout } from '../../layout/LayoutProvider';
import { useToast } from '../../ui/ToastProvider';

// Built-in server name constant
const BUILTIN_SERVER_NAME = 'builtin-tools';

// Server selection state: contains selected tools list
interface ServerSelection {
  serverName: string;
  selectedTools: Set<string>; // Empty set means all tools are selected
}

// Tool conflict information
interface ToolConflictInfo {
  toolName: string;
  servers: string[]; // List of servers providing this tool
}

const AgentMcpServersTab: React.FC<TabComponentProps> = ({
  mode,
  agentId,
  agentData,
  onSave,
  onDataChange,
  cachedData,
  readOnly = false,
}) => {
  const { servers, isLoading } = useMCPServers();
  const navigate = useNavigate();
  const location = useLocation();
  const { showSuccess, showError, showToast } = useToast();

  // Store selection state per server: Map<serverName, Set<toolName>>
  // Empty Set means all tools selected, undefined means server not selected
  const [serverSelections, setServerSelections] = useState<
    Map<string, Set<string>>
  >(new Map());

  // Store expanded servers
  const [expandedServers, setExpandedServers] = useState<Set<string>>(
    new Set(),
  );

  const [isInitialized, setIsInitialized] = useState(false);

  // Initial data for comparing changes
  const [initialSelections, setInitialSelections] = useState<
    Map<string, Set<string>>
  >(new Map());

  // Load selected servers and tools - reload when agentData or cachedData changes
  useEffect(() => {
    if (agentData?.id) {
      const baseSelections = new Map<string, Set<string>>();

      if (agentData?.mcpServers) {
        agentData.mcpServers.forEach((server) => {
          // Empty tools array means all tools selected
          // Non-empty tools means only selected tools are used
          const toolSet =
            server.tools && server.tools.length > 0
              ? new Set(server.tools)
              : new Set<string>();
          baseSelections.set(server.name, toolSet);
        });
      }

      // If cached data exists, use cached data first
      let finalSelections = baseSelections;
      if (cachedData?.mcpServers) {
        finalSelections = new Map<string, Set<string>>();
        cachedData.mcpServers.forEach((server) => {
          const toolSet =
            server.tools && server.tools.length > 0
              ? new Set(server.tools)
              : new Set<string>();
          finalSelections.set(server.name, toolSet);
        });
      }

      setServerSelections(finalSelections);
      if (!isInitialized) {
        setInitialSelections(new Map(baseSelections)); // Initial data is always the original data
        setIsInitialized(true);
      }
    }
  }, [agentData?.id, agentData?.mcpServers, cachedData?.mcpServers, isInitialized]);

  // Check if data has been modified - use useMemo to avoid function reference changes
  const hasChanges = useMemo(() => {
    if (serverSelections.size !== initialSelections.size) return true;

    for (const [serverName, selectedTools] of serverSelections) {
      const initialTools = initialSelections.get(serverName);
      if (!initialTools) return true;

      if (selectedTools.size !== initialTools.size) return true;

      for (const tool of selectedTools) {
        if (!initialTools.has(tool)) return true;
      }
    }
    return false;
  }, [serverSelections, initialSelections]);

  // Notify parent component when data changes - use useRef to track last notified data
  const lastNotifiedDataRef = React.useRef<string | null>(null);
  
  useEffect(() => {
    if (isInitialized && onDataChange) {
      const mcpServers = Array.from(serverSelections.entries()).map(
        ([name, tools]) => ({
          name,
          tools: Array.from(tools),
        }),
      );
      const dataKey = JSON.stringify(mcpServers);
      
      // Only notify parent when data actually changes, to avoid infinite loops
      if (lastNotifiedDataRef.current !== dataKey) {
        lastNotifiedDataRef.current = dataKey;
        onDataChange('mcp', { mcpServers }, hasChanges);
      }
    }
  }, [serverSelections, hasChanges, isInitialized, onDataChange]);

  // Check if this is a Kobi Agent (default agent, builtin-tools modification disabled)
  const isKobiAgent = useMemo(() => {
    return agentData?.name?.toLowerCase() === 'kobi';
  }, [agentData?.name]);
  
  // Check if editing is disabled (read-only mode or Kobi Agent built-in tools)
  const isEditDisabled = readOnly;

  // Check if server is selected (fully or partially)
  const isServerSelected = useCallback(
    (serverName: string) => {
      return serverSelections.has(serverName);
    },
    [serverSelections],
  );

  // Check if server is fully selected
  const isServerFullySelected = useCallback(
    (serverName: string, serverTools: any[]) => {
      const selection = serverSelections.get(serverName);
      if (!selection) return false;
      // Empty Set means all selected
      if (selection.size === 0) return true;
      // Check if all tools are selected
      return serverTools.every((tool) => selection.has(tool.name));
    },
    [serverSelections],
  );

  // Check if server is partially selected (some tools selected, some not)
  const isServerPartiallySelected = useCallback(
    (serverName: string, serverTools: any[]) => {
      const selection = serverSelections.get(serverName);
      if (!selection) return false;
      // Empty Set means all selected, not partially selected
      if (selection.size === 0) return false;
      // Check if some tools are not selected
      return selection.size > 0 && selection.size < serverTools.length;
    },
    [serverSelections],
  );

  // Get all selected tool names (from other servers)
  const getAllSelectedToolNames = useCallback(
    (excludeServerName?: string) => {
      const toolNames = new Set<string>();
      serverSelections.forEach((selectedTools, sName) => {
        if (excludeServerName && sName === excludeServerName) return;

        const server = servers?.find((s) => s.name === sName);
        if (!server) return;

        const serverTools = server.tools || [];

        if (selectedTools.size === 0) {
          // All selected, add all tools
          serverTools.forEach((tool) => toolNames.add(tool.name));
        } else {
          // Partially selected, only add selected tools
          selectedTools.forEach((toolName) => toolNames.add(toolName));
        }
      });
      return toolNames;
    },
    [serverSelections, servers],
  );

  // 🔥 New: Global conflict detection - detect name conflicts among all selected tools
  const detectGlobalConflicts = useCallback((): Map<
    string,
    ToolConflictInfo
  > => {
    const toolToServers = new Map<string, string[]>();

    // Iterate through all selected servers and tools
    serverSelections.forEach((selectedTools, serverName) => {
      const server = servers?.find((s) => s.name === serverName);
      if (!server || server.status !== 'connected') return;

      const serverTools = server.tools || [];

      // Get actually selected tools for this server
      const actualSelectedTools =
        selectedTools.size === 0
          ? serverTools
          : serverTools.filter((tool) => selectedTools.has(tool.name));

      // Record which servers each tool comes from
      actualSelectedTools.forEach((tool) => {
        const serversList = toolToServers.get(tool.name) || [];
        if (!serversList.includes(serverName)) {
          serversList.push(serverName);
        }
        toolToServers.set(tool.name, serversList);
      });
    });

    // Find conflicting tools (appearing in multiple servers)
    const conflicts = new Map<string, ToolConflictInfo>();
    toolToServers.forEach((serversList, toolName) => {
      if (serversList.length > 1) {
        conflicts.set(toolName, {
          toolName,
          servers: serversList,
        });
      }
    });

    return conflicts;
  }, [serverSelections, servers]);

  // Cache conflict detection results with useMemo
  const globalConflicts = useMemo(
    () => detectGlobalConflicts(),
    [detectGlobalConflicts],
  );

  // Check if a specific tool has conflicts
  const isToolConflicted = useCallback(
    (toolName: string, serverName: string): boolean => {
      const conflict = globalConflicts.get(toolName);
      return conflict !== undefined && conflict.servers.includes(serverName);
    },
    [globalConflicts],
  );

  // Check if a server has conflicting tools
  const serverHasConflicts = useCallback(
    (serverName: string): boolean => {
      let hasConflict = false;
      globalConflicts.forEach((conflict) => {
        if (conflict.servers.includes(serverName)) {
          hasConflict = true;
        }
      });
      return hasConflict;
    },
    [globalConflicts],
  );

  // Get detailed conflict information text for tooltip
  const getConflictTooltip = useCallback(
    (toolName: string): string => {
      const conflict = globalConflicts.get(toolName);
      if (!conflict) return '';

      return `⚠️ Tool Name Conflict!\n"${toolName}" appears in:\n${conflict.servers
        .map((s) => `  • ${s}`)
        .join(
          '\n',
        )}\n\n⚠️ IMPORTANT: LLM API will discard the entire tool list!`;
    },
    [globalConflicts],
  );

  // Check tool name conflicts
  const checkToolConflict = useCallback(
    (toolName: string, currentServerName: string): boolean => {
      const allSelectedTools = getAllSelectedToolNames(currentServerName);
      return allSelectedTools.has(toolName);
    },
    [getAllSelectedToolNames],
  );

  // Toggle server selection state
  const handleServerToggle = useCallback(
    (serverName: string, serverTools: any[]) => {
      if (isKobiAgent && serverName === BUILTIN_SERVER_NAME) {
        return;
      }

      setServerSelections((prev) => {
        const newSelections = new Map(prev);
        const currentSelection = newSelections.get(serverName);

        if (currentSelection !== undefined) {
          // Currently selected, deselect
          newSelections.delete(serverName);
        } else {
          // Currently not selected, check tool conflicts
          const allSelectedTools = getAllSelectedToolNames(serverName);
          const conflictingTools: string[] = [];
          const nonConflictingTools: string[] = [];

          serverTools.forEach((tool) => {
            if (allSelectedTools.has(tool.name)) {
              conflictingTools.push(tool.name);
            } else {
              nonConflictingTools.push(tool.name);
            }
          });

          if (conflictingTools.length > 0) {
            // Has conflicts, notify user and only select non-conflicting tools
            const conflictMessage = (
              <div>
                <div className="text-red-700 mb-3">
                  {conflictingTools.length} tools from{' '}
                  <span className="font-bold">{serverName}</span> cannot be
                  selected due to same name tools already selected in other MCP
                  servers.
                </div>
                <ul className="list-none space-y-1 mb-0 ml-2">
                  {conflictingTools.map((tool) => (
                    <li key={tool} className="text-red-600">
                      • {tool}
                    </li>
                  ))}
                </ul>
              </div>
            );

            showToast(conflictMessage, 'error', undefined, {
              persistent: true,
            });

            if (nonConflictingTools.length > 0) {
              // Only select non-conflicting tools
              newSelections.set(serverName, new Set(nonConflictingTools));
            }
            // If all tools conflict, do not select this server
          } else {
            // No conflicts, select all tools (empty Set)
            newSelections.set(serverName, new Set<string>());
          }
        }

        return newSelections;
      });
    },
    [isKobiAgent, getAllSelectedToolNames, showError],
  );

  // Toggle tool selection state
  const handleToolToggle = useCallback(
    (serverName: string, toolName: string, serverTools: any[]) => {
      setServerSelections((prev) => {
        const newSelections = new Map(prev);
        const currentSelection = newSelections.get(serverName);

        if (!currentSelection) {
          // Server not selected, check tool conflicts
          if (checkToolConflict(toolName, serverName)) {
            const conflictMessage = (
              <div>
                <div className="text-red-700">
                  <span className="font-bold">{toolName}</span> cannot be
                  selected due to same name tool already selected in other MCP
                  servers.
                </div>
              </div>
            );

            showToast(conflictMessage, 'error', undefined, {
              persistent: true,
            });
            return prev;
          }
          // No conflicts, select server first and only select this tool
          newSelections.set(serverName, new Set([toolName]));
        } else if (currentSelection.size === 0) {
          // Server fully selected, switch to excluding only this tool
          const allTools = new Set(serverTools.map((t) => t.name));
          allTools.delete(toolName);
          newSelections.set(serverName, allTools);
        } else {
          // Server partially selected state
          const newToolSet = new Set(currentSelection);
          if (newToolSet.has(toolName)) {
            // Deselect
            newToolSet.delete(toolName);
            // If no tools are selected, remove the entire server
            if (newToolSet.size === 0) {
              newSelections.delete(serverName);
            } else {
              newSelections.set(serverName, newToolSet);
            }
          } else {
            // Select tool, check conflicts
            if (checkToolConflict(toolName, serverName)) {
              const conflictMessage = (
                <div>
                  <div className="text-red-700">
                    <span className="font-bold">{toolName}</span> cannot be
                    selected due to same name tool already selected in other MCP
                    servers.
                  </div>
                </div>
              );

              showToast(conflictMessage, 'error', undefined, {
                persistent: true,
              });
              return prev;
            }
            newToolSet.add(toolName);
            // Check if all tools are now selected
            if (newToolSet.size === serverTools.length) {
              // All selected, represented by empty Set
              newSelections.set(serverName, new Set<string>());
            } else {
              newSelections.set(serverName, newToolSet);
            }
          }
        }

        return newSelections;
      });
    },
    [checkToolConflict, showError],
  );

  // Toggle server expanded state
  const handleServerExpand = useCallback((serverName: string) => {
    setExpandedServers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(serverName)) {
        newSet.delete(serverName);
      } else {
        newSet.add(serverName);
      }
      return newSet;
    });
  }, []);

  // Navigate to MCP management page (settings page)
  const handleManageServers = useCallback(() => {
    // Save current path to sessionStorage
    sessionStorage.setItem('previousPath', location.pathname);
    navigate('/settings/mcp');
  }, [navigate, location.pathname]);

  /**
   * Navigate to MCP Library View and select the corresponding MCP Server
   * Following ChatViewHeader implementation: use URL query params to pass selected item
   * Also pass returnPath state so SettingsPage Back button can navigate back correctly
   */

  // Get current server state
  const getCurrentState = useCallback((server: any) => {
    const serverTools = server.tools || [];
    const hasError = !!server.error;

    // Basic state determination - priority order
    // 1. If server status is explicitly connecting or disconnecting, use these states first
    // This resolves timing issues after reconnect: error message may still exist, but status is already connecting
    if (server.status === 'connecting') return 'connecting';
    if (server.status === 'disconnecting') return 'disconnecting';

    // 2. If server.status is explicitly error, return error directly
    if (server.status === 'error') return 'error';

    // 3. If connected and has tools, return connected
    if (server.status === 'connected' && serverTools.length > 0)
      return 'connected';

    // 4. If server status is not connected and has error message, return error
    if (server.status !== 'connected' && hasError) return 'error';

    // 5. Default: return server original status
    return server.status || 'disconnected';
  }, []);

  // Calculate total selected tools - only count connected servers
  const totalSelectedTools = useMemo(() => {
    let count = 0;
    serverSelections.forEach((selectedTools, serverName) => {
      const server = servers?.find((s) => s.name === serverName);
      if (server) {
        const currentState = getCurrentState(server);
        // Only count connected servers
        if (currentState === 'connected') {
          const serverTools = server.tools || [];
          // Empty Set means all tools selected
          if (selectedTools.size === 0) {
            count += serverTools.length;
          } else {
            count += selectedTools.size;
          }
        }
      }
    });
    return count;
  }, [serverSelections, servers, getCurrentState]);

  // Calculate total available tools - only count connected servers
  const totalAvailableTools = useMemo(() => {
    if (!servers) return 0;
    return servers.reduce((sum, server) => {
      const currentState = getCurrentState(server);
      // Only count connected servers
      if (currentState === 'connected') {
        return sum + (server.tools?.length || 0);
      }
      return sum;
    }, 0);
  }, [servers, getCurrentState]);

  // Get server status icon
  const getServerStatusIcon = (server: any) => {
    switch (server.status) {
      case 'connected':
        return '🟢';
      case 'disconnected':
        return '🔴';
      case 'error':
        return '⚠️';
      default:
        return '⚪';
    }
  };

  // Get server status text
  const getServerStatusText = (server: any) => {
    switch (server.status) {
      case 'connected':
        return 'Connected';
      case 'disconnected':
        return 'Disconnected';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="agent-tab">
      {/* Tab Header */}
      <div className="tab-header">
        <div className="header-summary">
          <span className="summary-text">
            {totalSelectedTools} tools selected from available servers
          </span>
        </div>
        <div className="header-actions">
          <button
            className="manage-servers-btn"
            onClick={handleManageServers}
            title="Manage available servers"
          >
            Manage Available Servers
          </button>
        </div>
      </div>
      
      {/* Tab Body */}
      <div className="tab-body">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner">🔄</div>
            <span>Loading MCP servers...</span>
          </div>
        ) : servers && servers.length > 0 ? (
          <>
            {/* Server List */}
            <div className="server-cards">
              {servers
                // Sort server list first: built-in server at the top
                .sort((a, b) => {
                  if (a.name === BUILTIN_SERVER_NAME) return -1;
                  if (b.name === BUILTIN_SERVER_NAME) return 1;
                  return 0;
                })
                .map((server) => {
                  const hasError = !!server.error;
                  const serverTools = server.tools || [];
                  const currentState = getCurrentState(server);
                  const isBuiltinServer = server.name === BUILTIN_SERVER_NAME;
                  const isDisabled = isEditDisabled || (isKobiAgent && isBuiltinServer);
                  const isSelected = isServerSelected(server.name);
                  const isFullySelected = isServerFullySelected(
                    server.name,
                    serverTools,
                  );
                  const isPartiallySelected = isServerPartiallySelected(
                    server.name,
                    serverTools,
                  );
                  const isExpanded = expandedServers.has(server.name);
                  const selectedToolsSet = serverSelections.get(server.name);
                  const hasConflicts = serverHasConflicts(server.name);

                  return (
                    <div
                      key={server.name}
                      className={`server-card ${isSelected ? 'selected' : ''} ${
                        isBuiltinServer ? 'builtin-server' : ''
                      } ${hasConflicts ? 'has-conflict' : ''}`}
                      title={
                        hasConflicts
                          ? '⚠️ This server contains conflicting tool names'
                          : ''
                      }
                    >
                      <div className="server-card-header">
                        <div className="server-info">
                          <input
                            type="checkbox"
                            className="server-checkbox"
                            checked={isSelected}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate = isPartiallySelected;
                              }
                            }}
                            onChange={(e) => {
                              e.stopPropagation();
                              if (!isDisabled && currentState === 'connected') {
                                handleServerToggle(server.name, serverTools);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            disabled={
                              isDisabled || currentState !== 'connected'
                            }
                          />
                          <div className="server-name-group">
                            <div className="server-title-row">
                              <h4 className="server-name">{server.name}</h4>
                              {isBuiltinServer && (
                                <span className="builtin-badge">Built-in</span>
                              )}
                              {hasConflicts && (
                                <span className="conflict-badge">
                                  ⚠️ CONFLICT
                                </span>
                              )}
                            </div>
                            <div className="server-status-group">
                              <span className={`server-status ${currentState}`}>
                                {currentState}
                              </span>
                              {currentState === 'connected' && (
                                <span className="tools-count">
                                  {isSelected && selectedToolsSet
                                    ? `${
                                        selectedToolsSet.size === 0
                                          ? serverTools.length
                                          : selectedToolsSet.size
                                      }/${serverTools.length} tools`
                                    : `${serverTools.length} tools`}
                                </span>
                              )}
                              {hasError && (
                                <span
                                  className="error-indicator"
                                  title={server.error || 'Connection error'}
                                >
                                  ⚠️
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="server-actions">
                          <button
                            className="manage-btn always-visible"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManageServers();
                            }}
                            title="Manage MCP Servers"
                          >
                            <Settings size={14} />
                          </button>
                          <button
                            className={`expand-btn ${
                              currentState !== 'connected' ||
                              serverTools.length === 0
                                ? 'disabled'
                                : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                currentState === 'connected' &&
                                serverTools.length > 0
                              ) {
                                handleServerExpand(server.name);
                              }
                            }}
                            disabled={
                              currentState !== 'connected' ||
                              serverTools.length === 0
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown size={14} />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Tool List - expandable */}
                      {isExpanded && serverTools.length > 0 && (
                        <div className="tool-list">
                          {serverTools.map((tool: any) => {
                            const isToolSelected = selectedToolsSet
                              ? selectedToolsSet.size === 0 ||
                                selectedToolsSet.has(tool.name)
                              : false;
                            const isConflicted = isToolConflicted(
                              tool.name,
                              server.name,
                            );
                            const conflictTooltip = isConflicted
                              ? getConflictTooltip(tool.name)
                              : '';

                            return (
                              <div
                                key={tool.name}
                                className={`tool-item ${
                                  isToolSelected ? 'selected' : ''
                                } ${isConflicted ? 'has-conflict' : ''}`}
                                title={
                                  isConflicted
                                    ? conflictTooltip
                                    : tool.description || ''
                                }
                              >
                                <div className="tool-info">
                                  <input
                                    type="checkbox"
                                    className="tool-checkbox"
                                    checked={isToolSelected}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      if (currentState === 'connected') {
                                        handleToolToggle(
                                          server.name,
                                          tool.name,
                                          serverTools,
                                        );
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    disabled={
                                      isDisabled || currentState !== 'connected'
                                    }
                                  />
                                  <div className="tool-details">
                                    <span className="tool-name">
                                      {tool.name}
                                      {isConflicted && (
                                        <span className="conflict-badge">
                                          ⚠️
                                        </span>
                                      )}
                                    </span>
                                    {tool.description && (
                                      <span className="tool-description">
                                        {tool.description}
                                      </span>
                                    )}
                                    {isConflicted && (
                                      <span
                                        className="tool-description"
                                        style={{
                                          color: '#dc2626',
                                          fontWeight: 600,
                                        }}
                                      >
                                        ⚠️ Conflict: Also appears in{' '}
                                        {globalConflicts
                                          .get(tool.name)
                                          ?.servers.join(', ')}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <h4>No MCP Servers Found</h4>
            <p>No MCP servers are currently configured.</p>
            <button className="btn-primary" onClick={handleManageServers}>
              Configure MCP Servers
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentMcpServersTab
