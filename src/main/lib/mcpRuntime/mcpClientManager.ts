// import { MCPClient } from './mcpClient'; // 🚫 Disabled MCPClient (SDK)
import { VscMcpClient } from './vscMcpClient';
import { BuiltinMcpClient, BUILTIN_SERVER_NAME } from './builtinMcpClient';
import { McpServerConfig } from '../userDataADO/types';
import { createConsoleLogger } from '../unifiedLogger';
import { BrowserWindow, ipcMain } from 'electron';
import { kosmosPlaceholderManager, containsKosmosPlaceholder } from '../userDataADO/kosmosPlaceholders';

/**
 * Client implementation type
 */
type ClientImplementation = 'sdk' | 'vscodeMcpClient';

/**
 * Unified client interface for both implementations
 */
interface IUnifiedMcpClient {
  connectToServer(): Promise<string | Error>;
  getTools(): Promise<{ name: string; description?: string; inputSchema: any }[]>;
  executeTool({ toolName, toolArgs }: { toolName: string; toolArgs: { [key: string]: unknown } }): Promise<string>;
  cleanup(): Promise<void>;
}

// Initialize console-only logger for MCP client manager
let advancedLogger: any;
(async () => {
  advancedLogger = await createConsoleLogger();
})();

/**
 * MCP Server status enumeration
 */
export type MCPServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'disconnecting';

/**
 * Runtime state for MCP servers (memory-only, not persisted)
 * 🆕 Refactor: Managed directly by mcpClientManager, no longer delegated through profileCacheManager
 */
export interface MCPServerRuntimeState {
  serverName: string;
  status: MCPServerStatus;
  tools: { name: string; description?: string; inputSchema: any }[];
  lastError: Error | null;
}

/**
 * Operation lock interface
 */
interface OperationLock {
  operation: 'connect' | 'disconnect' | 'reconnect';
  promise: Promise<void>;
  timestamp: number;
  abortController?: AbortController; // Add abort controller
}

/**
 * Connection process interface for tracking ongoing connections
 */
interface ConnectionProcess {
  serverName: string;
  abortController: AbortController;
  client: IUnifiedMcpClient;
  startTime: number;
}

/**
 * Enhanced MCP client manager with ALL vscMcpClient approach (Singleton)
 * 🆕 Refactor: Directly manages MCP server runtime state, notifies frontend mcpClientCacheManager
 *
 * Responsibilities:
 * - Manage MCP client runtime instances (Map<mcp name, unified client>)
 * - Use ALL vscMcpClient approach: stdio/sse/streamablehttp → vscMcpClient
 * - Manage tool to server mappings (Map<tool name, mcp name>)
 * - Handle connection/disconnection operations
 * - 🆕 Directly manage MCP server runtime state (status, tools, error)
 * - 🆕 Notify frontend mcpClientCacheManager of state changes via IPC
 *
 * Client Implementation Strategy:
 * - ALL transport types: Use VscMcpClient (zero-dependency, VSCode-standard implementation)
 * - stdio/sse/streamablehttp transports: ALL use VscMcpClient
 * - VscMcpClient's HttpTransport now uses VSCode-standard implementation (memory leak fixed)
 *
 * Client Implementation Support:
 * - 'vscodeMcpClient': Uses VscMcpClient - for ALL transport types
 * - 'sdk': DISABLED - No longer used to avoid potential issues
 *
 * Delegates to ProfileCacheManager:
 * - Server configuration management (config persistence only)
 */
export class MCPClientManager {
  private static instance: MCPClientManager | null = null;
  private mcpClients: Map<string, IUnifiedMcpClient> = new Map(); // serverName -> Unified Client
  private clientImplementations: Map<string, ClientImplementation> = new Map(); // serverName -> implementation type
  private toolToServerMap: Map<string, string> = new Map(); // toolName -> serverName
  private operationLocks: Map<string, OperationLock> = new Map(); // serverName -> OperationLock
  private activeConnections: Map<string, ConnectionProcess> = new Map(); // serverName -> ConnectionProcess
  private instanceId: string = Math.random().toString(36).substr(2, 9);
  private currentUserAlias: string | null = null;
  private defaultImplementation: ClientImplementation = 'vscodeMcpClient'; // Default to vscMcpClient for all transports
  
  // 🆕 Refactor: Runtime state managed directly by mcpClientManager
  private runtimeStates: Map<string, MCPServerRuntimeState> = new Map(); // serverName -> runtimeState
  
  // Batch notification mechanism
  private notificationTimeout: NodeJS.Timeout | null = null;
  private pendingNotification = false;

  private constructor() {
  }

  // ==================== 🆕 Runtime State Management Methods ====================

  /**
   * 🆕 Update MCP server status
   * @param serverName - Server name
   * @param status - New status
   */
  private _updateServerStatus(serverName: string, status: MCPServerStatus): void {
    let state = this.runtimeStates.get(serverName);
    if (!state) {
      state = {
        serverName,
        status: 'disconnected',
        tools: [],
        lastError: null
      };
      this.runtimeStates.set(serverName, state);
    }
    state.status = status;
    this._scheduleNotification();
  }

  /**
   * 🆕 Update MCP server tool list
   * @param serverName - Server name
   * @param tools - Tool list
   */
  private _updateServerTools(serverName: string, tools: { name: string; description?: string; inputSchema: any }[]): void {
    let state = this.runtimeStates.get(serverName);
    if (!state) {
      state = {
        serverName,
        status: 'disconnected',
        tools: [],
        lastError: null
      };
      this.runtimeStates.set(serverName, state);
    }
    state.tools = tools;
    this._scheduleNotification();
  }

  /**
   * 🆕 Update MCP server error
   * @param serverName - Server name
   * @param error - Error information
   */
  private _updateServerError(serverName: string, error: Error | null): void {
    let state = this.runtimeStates.get(serverName);
    if (!state) {
      state = {
        serverName,
        status: 'disconnected',
        tools: [],
        lastError: null
      };
      this.runtimeStates.set(serverName, state);
    }
    state.lastError = error;
    this._scheduleNotification();
  }

  /**
   * 🆕 Clear MCP server runtime state
   * 🆕 Refactor: Changed from private to public, allowing profileCacheManager to call it
   * @param serverName - Server name
   */
  _clearServerRuntimeState(serverName: string): void {
    this.runtimeStates.delete(serverName);
    this._scheduleNotification();
  }

  /**
   * 🆕 Get all MCP server runtime states
   * @returns Array of runtime states
   */
  getAllMcpServerRuntimeStates(): MCPServerRuntimeState[] {
    return Array.from(this.runtimeStates.values());
  }

  /**
   * 🆕 Get a single MCP server runtime state
   * @param serverName - Server name
   * @returns Runtime state or undefined
   */
  getMcpServerRuntimeState(serverName: string): MCPServerRuntimeState | undefined {
    return this.runtimeStates.get(serverName);
  }

  /**
   * 🆕 Schedule frontend notification (with debounce)
   */
  private _scheduleNotification(): void {
    this.pendingNotification = true;
    
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }
    
    this.notificationTimeout = setTimeout(() => {
      if (this.pendingNotification) {
        this._notifyFrontend();
        this.pendingNotification = false;
      }
      this.notificationTimeout = null;
    }, 50); // 50ms debounce for fast response
  }

  /**
   * 🆕 Immediately notify frontend
   */
  private _notifyFrontend(): void {
    const states = this.getAllMcpServerRuntimeStates();
    
    // Serialize error objects for IPC transport
    const serializedStates = states.map(state => ({
      serverName: state.serverName,
      status: state.status,
      tools: state.tools,
      lastError: state.lastError ? state.lastError.message : null
    }));
    
    // Notify all renderer process windows
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed() && win.webContents) {
        win.webContents.send('mcp:serverStatesUpdated', serializedStates);
      }
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): MCPClientManager {
    if (!MCPClientManager.instance) {
      MCPClientManager.instance = new MCPClientManager();
    }
    return MCPClientManager.instance;
  }

  /**
   * Initialize manager with user alias
   * 🔧 Core improvement: Ensure runtime state is fully synced with ProfileCacheManager baseline data
   *
   * @param user_alias - User alias
   */
  async initialize(user_alias: string): Promise<void> {
    this.currentUserAlias = user_alias;

    try {
      // 🔧 Step 1: Clean existing runtime state, ensure starting from a clean state
      await this._syncWithProfileCacheManagerBaseline(user_alias);

      // 🆕 Step 1.5: Initialize and register builtin server
      await this._initializeBuiltinServer();

      // Step 2: Get baseline configuration from ProfileCacheManager
      // 🆕 Use dynamic import to avoid circular dependency
      const { profileCacheManager } = await import('../userDataADO');
      const serverInfos = profileCacheManager.getAllMcpServerInfo(user_alias);
      
      // Step 3: Start connections based on baseline data
      let inUseCount = 0;
      for (const serverInfo of serverInfos) {
        if (serverInfo.config.in_use) {
          this._startConnectionAsync(serverInfo.config.name);
          inUseCount++;
        }
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * 🔧 Refactor: Sync with ProfileCacheManager baseline configuration
   * Clean up clients and runtime states not in baseline configuration
   */
  private async _syncWithProfileCacheManagerBaseline(user_alias: string): Promise<void> {
    const syncStart = Date.now();
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    
    try {
      // Phase 1: Get current runtime state
      const currentRuntimeClients = Array.from(this.mcpClients.keys());
      const currentRuntimeStates = this.getAllMcpServerRuntimeStates();
      // 🆕 Use dynamic import to avoid circular dependency
      const { profileCacheManager } = await import('../userDataADO');
      const baselineConfigs = profileCacheManager.getAllMcpServerInfo(user_alias);
      
      
      // Phase 2: Identify "ghost" runtime states not in baseline configuration
      // 🆕 Builtin server is not in baseline config, but is not a ghost server
      const baselineServerNames = new Set(baselineConfigs.map(info => info.config.name));
      const ghostRuntimeClients = currentRuntimeClients.filter(name =>
        !baselineServerNames.has(name) && name !== BUILTIN_SERVER_NAME
      );
      const ghostRuntimeStates = currentRuntimeStates.filter(state =>
        !baselineServerNames.has(state.serverName) && state.serverName !== BUILTIN_SERVER_NAME
      );
      
      
      // Phase 3: Clean up "ghost" runtime clients
      if (ghostRuntimeClients.length > 0) {
        
        for (const ghostClientName of ghostRuntimeClients) {
          try {
            const ghostClient = this.mcpClients.get(ghostClientName);
            if (ghostClient) {
              await ghostClient.cleanup();
              this.mcpClients.delete(ghostClientName);
              this._removeToolMappings(ghostClientName);
            }
          } catch (error) {
          }
        }
      }
      
      // Phase 4: Clean up "ghost" runtime states (using internal methods)
      if (ghostRuntimeStates.length > 0) {
        
        for (const ghostState of ghostRuntimeStates) {
          try {
            this._clearServerRuntimeState(ghostState.serverName);
          } catch (error) {
          }
        }
      }
      
      // Phase 5: Verify sync results
      const finalRuntimeClients = Array.from(this.mcpClients.keys());
      const finalRuntimeStates = this.getAllMcpServerRuntimeStates();
      
      const syncDuration = Date.now() - syncStart;
      
      // Ensure runtime state is fully consistent with baseline data
      const isFullySynced = finalRuntimeStates.every(state => baselineServerNames.has(state.serverName));
      if (isFullySynced) {
      } else {
      }
      
    } catch (error) {
      const syncDuration = Date.now() - syncStart;
      throw error;
    }
  }

  /**
   * Connect to specified MCP server
   *
   * Preconditions: Server must exist in configuration and have status 'disconnected'
   *
   * @param serverName - Server name
   */
  async connect(serverName: string): Promise<void> {

    if (!this.currentUserAlias) {
      const error = 'Manager not initialized with user alias'
      throw new Error(error);
    }

    // 🆕 Protect builtin server: builtin server is always connected, manual connect not allowed
    if (serverName === BUILTIN_SERVER_NAME) {
      throw new Error(`Builtin server "${BUILTIN_SERVER_NAME}" is always connected and cannot be manually connected`);
    }

    // Remove all status validation - handled by ProfileCacheManager
    await this._executeWithLock(serverName, 'connect', async () => {
      await this._performConnect(serverName);
    });
  }

  /**
   * Disconnect specified MCP server connection
   *
   * Preconditions: Server must exist in configuration and have status 'connected', 'connecting', or 'error'
   *
   * @param serverName - Server name
   */
  async disconnect(serverName: string): Promise<void> {

    if (!this.currentUserAlias) {
      const error = 'Manager not initialized with user alias'
      throw new Error(error);
    }

    // 🆕 Protect builtin server: disconnecting builtin server not allowed
    if (serverName === BUILTIN_SERVER_NAME) {
      throw new Error(`Builtin server "${BUILTIN_SERVER_NAME}" cannot be disconnected`);
    }

    // Remove all status validation - handled by ProfileCacheManager
    await this._executeWithLock(serverName, 'disconnect', async () => {
      await this._performDisconnect(serverName);
    });
  }

  /**
   * Reconnect specified MCP server
   *
   * Preconditions: Server must exist in configuration and have status 'error'
   *
   * @param serverName - Server name
   */
  async reconnect(serverName: string): Promise<void> {

    if (!this.currentUserAlias) {
      const error = 'Manager not initialized with user alias'
      throw new Error(error);
    }

    // 🆕 Protect builtin server: reconnecting builtin server not allowed
    if (serverName === BUILTIN_SERVER_NAME) {
      throw new Error(`Builtin server "${BUILTIN_SERVER_NAME}" cannot be reconnected`);
    }

    // Remove all status validation - handled by ProfileCacheManager
    await this._executeWithLock(serverName, 'reconnect', async () => {
      await this._performReconnect(serverName);
    });
  }

  /**
   * Get client by server name
   *
   * @param serverName - Server name
   */
  getClientByServerName(serverName: string): IUnifiedMcpClient | undefined {
    return this.mcpClients.get(serverName);
  }

  /**
   * Get client by tool name
   *
   * @param toolName - Tool name
   */
  getClientByToolName(toolName: string): IUnifiedMcpClient | undefined {
    const serverName = this.toolToServerMap.get(toolName);
    if (!serverName) return undefined;
    return this.getClientByServerName(serverName);
  }

  /**
   * Get client implementation type by server name
   *
   * @param serverName - Server name
   */
  getClientImplementation(serverName: string): ClientImplementation | undefined {
    return this.clientImplementations.get(serverName);
  }

  /**
   * Set default client implementation
   * Note: Actual implementation depends on transport type in hybrid mode
   *
   * @param implementation - Client implementation type (used as fallback)
   */
  setDefaultImplementation(implementation: ClientImplementation): void {
    this.defaultImplementation = implementation;
  }

  /**
   * Get current default implementation
   * Note: Actual implementation depends on transport type in hybrid mode
   */
  getDefaultImplementation(): ClientImplementation {
    return this.defaultImplementation;
  }

  /**
   * Get all available tools
   * 🆕 Refactor: Retrieved from internal runtimeStates, no longer through profileCacheManager
   */
  async getAllTools(): Promise<{ name: string; description?: string; inputSchema: any; serverName: string }[]> {
    const allTools: { name: string; description?: string; inputSchema: any; serverName: string }[] = [];
    
    if (!this.currentUserAlias) {
      return allTools;
    }

    // 🆕 Retrieve from internal runtimeStates
    const runtimeStates = this.getAllMcpServerRuntimeStates();
    
    for (const runtimeState of runtimeStates) {
      if (runtimeState.status === 'connected') {
        for (const tool of runtimeState.tools) {
          allTools.push({
            ...tool,
            serverName: runtimeState.serverName
          });
        }
      }
    }
    
    return allTools;
  }

  /**
   * Execute tool
   * 
   * @param toolName - Tool name
   * @param toolArgs - Tool arguments
   */
  async executeTool({ toolName, toolArgs }: { toolName: string; toolArgs: { [key: string]: unknown } }): Promise<string> {
    const client = this.getClientByToolName(toolName);
    
    if (!client) {
      throw new Error(`No client found for tool: ${toolName}`);
    }
    
    return client.executeTool({ toolName, toolArgs });
  }

  /**
   * Add new MCP server
   * 🆕 Refactor: Config saved immediately, connection runs asynchronously in background, non-blocking for UI
   *
   * @param serverName - Server name
   * @param newConfig - New server configuration
   */
  async add(serverName: string, newConfig: McpServerConfig): Promise<void> {

    if (!this.currentUserAlias) {
      throw new Error('Manager not initialized with user alias');
    }

    // 🆕 Protect builtin server: adding a server with the same name not allowed
    if (serverName === BUILTIN_SERVER_NAME) {
      throw new Error(`Server name "${BUILTIN_SERVER_NAME}" is reserved for builtin server`);
    }

    // Validate input
    if (!serverName || !newConfig) {
      throw new Error('Server name and configuration are required');
    }

    if (newConfig.name !== serverName) {
      throw new Error('Server name must match configuration name');
    }

    // 🆕 Use dynamic import to avoid circular dependency
    const { profileCacheManager } = await import('../userDataADO');
    
    // Check if server already exists
    const existingServerInfo = profileCacheManager.getMcpServerInfo(this.currentUserAlias, serverName);
    if (existingServerInfo.config) {
      throw new Error(`Server "${serverName}" already exists`);
    }

    // Set initial config with status=disconnected, in_use=true
    const configToAdd: McpServerConfig = {
      ...newConfig,
      in_use: true
    };

    // Add config to ProfileCacheManager
    const success = await profileCacheManager.addMcpServerConfig(this.currentUserAlias, configToAdd);
    if (!success) {
      throw new Error(`Failed to add server configuration for "${serverName}"`);
    }

    // 🆕 Refactor: Use internal methods to initialize runtime state to connecting
    this._updateServerStatus(serverName, 'connecting');
    this._updateServerTools(serverName, []);
    this._updateServerError(serverName, null);

    // 🆕 Config saved, return to frontend immediately, connection runs asynchronously in background
    // Use setImmediate to ensure execution after current event loop ends
    setImmediate(() => {
      this._performConnect(serverName).catch(error => {
        // Error already handled and status updated inside _performConnect
        advancedLogger?.error('[MCPClientManager] Background connect failed for add', 'add', {
          serverName,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    });
  }

  /**
   * Update existing MCP server configuration
   * 🆕 Refactor: Config saved immediately, reconnection runs asynchronously in background, non-blocking for UI
   *
   * @param serverName - Server name
   * @param newConfig - Updated server configuration
   */
  async update(serverName: string, newConfig: McpServerConfig): Promise<void> {

    if (!this.currentUserAlias) {
      throw new Error('Manager not initialized with user alias');
    }

    // 🆕 Protect builtin server: updating builtin server not allowed
    if (serverName === BUILTIN_SERVER_NAME) {
      throw new Error(`Builtin server "${BUILTIN_SERVER_NAME}" cannot be updated`);
    }

    // Validate input
    if (!serverName || !newConfig) {
      throw new Error('Server name and configuration are required');
    }

    if (newConfig.name !== serverName) {
      throw new Error('Server name must match configuration name');
    }

    // 🆕 Use dynamic import to avoid circular dependency
    const { profileCacheManager } = await import('../userDataADO');
    
    // Check if server exists
    const existingServerInfo = profileCacheManager.getMcpServerInfo(this.currentUserAlias, serverName);
    if (!existingServerInfo.config) {
      throw new Error(`Server "${serverName}" not found`);
    }

    // 🆕 Get current status for async background processing
    const currentStatus = existingServerInfo.runtime?.status || 'disconnected';

    // Update config with status=disconnected, in_use=true
    const configToUpdate: Partial<McpServerConfig> = {
      ...newConfig,
      in_use: true
    };

    // Update config in ProfileCacheManager
    const success = await profileCacheManager.updateMcpServerConfig(this.currentUserAlias, serverName, configToUpdate);
    if (!success) {
      throw new Error(`Failed to update server configuration for "${serverName}"`);
    }

    // 🆕 Refactor: Use internal methods to update runtime state to connecting
    this._updateServerStatus(serverName, 'connecting');
    this._updateServerTools(serverName, []);
    this._updateServerError(serverName, null);

    // 🆕 Config saved, return to frontend immediately, disconnect + reconnect handled asynchronously in background
    // Use setImmediate to ensure execution after current event loop ends
    setImmediate(async () => {
      try {
        // If server was connected, disconnect first
        if (currentStatus !== 'disconnected') {
          await this._performDisconnect(serverName);
        }
        
        // Connect to the server with new config
        await this._performConnect(serverName);
      } catch (error) {
        // Error already handled and status updated inside _performConnect/_performDisconnect
        advancedLogger?.error('[MCPClientManager] Background update failed', 'update', {
          serverName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  /**
   * Delete MCP server
   *
   * @param serverName - Server name
   */
  async delete(serverName: string): Promise<void> {

    if (!this.currentUserAlias) {
      throw new Error('Manager not initialized with user alias');
    }

    // 🆕 Protect builtin server: deleting builtin server not allowed
    if (serverName === BUILTIN_SERVER_NAME) {
      throw new Error(`Builtin server "${BUILTIN_SERVER_NAME}" cannot be deleted`);
    }

    // Validate input
    if (!serverName) {
      throw new Error('Server name is required');
    }

    // 🆕 Use dynamic import to avoid circular dependency
    const { profileCacheManager } = await import('../userDataADO');
    
    // Check if server exists
    const existingServerInfo = profileCacheManager.getMcpServerInfo(this.currentUserAlias, serverName);
    if (!existingServerInfo.config) {
      throw new Error(`Server "${serverName}" not found`);
    }

    try {
      // If server is connected, disconnect first
      const currentStatus = existingServerInfo.runtime?.status || 'disconnected';
      if (currentStatus !== 'disconnected') {
        await this.disconnect(serverName);
      }

      // Delete config from ProfileCacheManager
      const success = await profileCacheManager.deleteMcpServerConfig(this.currentUserAlias, serverName);
      if (!success) {
        throw new Error(`Failed to delete server configuration for "${serverName}"`);
      }

      // 🆕 Refactor: Use internal methods to clear runtime state
      this._clearServerRuntimeState(serverName);

    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to delete MCP server');
      throw err;
    }
  }

  /**
   * Clean up all resources with enhanced child process management
   */
  async cleanup(): Promise<void> {
    const cleanupStart = Date.now();
    const cleanupId = `cleanup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    
    // Phase 1: Inventory current resources
    const resourceInventory = {
      mcpClientCount: this.mcpClients.size,
      clientNames: Array.from(this.mcpClients.keys()),
      toolMappingCount: this.toolToServerMap.size,
      operationLockCount: this.operationLocks.size,
      currentUser: this.currentUserAlias,
      instanceId: this.instanceId,
      hasBuiltinServer: this.mcpClients.has(BUILTIN_SERVER_NAME)
    };
    
    
    if (resourceInventory.mcpClientCount === 0) {
    } else {
      // Phase 2: Cleanup individual MCP clients with timeout and force termination
      
      const cleanupPromises = Array.from(this.mcpClients.entries()).map(async ([serverName, client], index) => {
        const clientCleanupStart = Date.now();
        try {
          
          // Set timeout for individual client cleanup to prevent hanging
          await Promise.race([
            client.cleanup(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client cleanup timeout')), 10000) // 10 second timeout
            )
          ]);
          
          const clientCleanupDuration = Date.now() - clientCleanupStart;
          
          return { serverName, success: true, duration: clientCleanupDuration, error: null };
        } catch (error) {
          const clientCleanupDuration = Date.now() - clientCleanupStart;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          if (errorMessage.includes('timeout')) {
          } else {
          }
          return { serverName, success: false, duration: clientCleanupDuration, error: errorMessage };
        }
      });

      // Set overall timeout for all client cleanups
      try {
        await Promise.race([
          Promise.allSettled(cleanupPromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Overall cleanup timeout')), 15000) // 15 second overall timeout
          )
        ]);
      } catch (overallTimeoutError) {
      }
      
      const cleanupResults = await Promise.allSettled(cleanupPromises);
      
      // Analyze cleanup results
      const successfulCleanups = cleanupResults.filter(result =>
        result.status === 'fulfilled' && result.value.success
      ).length;
      const failedCleanups = cleanupResults.length - successfulCleanups;
      const timeoutCleanups = cleanupResults.filter(result =>
        result.status === 'fulfilled' && result.value.error?.includes('timeout')
      ).length;
      const totalClientCleanupTime = cleanupResults
        .filter(result => result.status === 'fulfilled')
        .reduce((sum, result) => sum + (result.value as any).duration, 0);
      
      
      if (failedCleanups > 0 || timeoutCleanups > 0) {
      }
      
      // Phase 2.5: Additional system-level child process cleanup if there were timeouts
      if (timeoutCleanups > 0) {
        await this.performSystemLevelCleanup(cleanupId);
      }
    }
    
    // Phase 3: Clear all internal data structures
    
    const structureClearStart = Date.now();
    
    // Clear maps and references
    const previousMcpClientSize = this.mcpClients.size;
    const previousToolMapSize = this.toolToServerMap.size;
    const previousOperationLockSize = this.operationLocks.size;
    const previousUserAlias = this.currentUserAlias;
    
    this.mcpClients.clear();
    this.operationLocks.clear();
    this.toolToServerMap.clear();
    this.runtimeStates.clear();  // 🆕 Clean up runtime states
    this.currentUserAlias = null;
    
    // 🆕 Clean up notification timer
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
      this.notificationTimeout = null;
    }
    this.pendingNotification = false;
    
    const structureClearDuration = Date.now() - structureClearStart;
    
    
    // Phase 4: Final verification
    
    const verificationPassed =
      this.mcpClients.size === 0 &&
      this.toolToServerMap.size === 0 &&
      this.operationLocks.size === 0 &&
      this.currentUserAlias === null;
    
    if (verificationPassed) {
    } else {
    }
    
    // Phase 5: Summary
    const totalCleanupDuration = Date.now() - cleanupStart;
  }

  /**
   * Perform system-level child process cleanup when timeouts occur
   */
  private async performSystemLevelCleanup(cleanupId: string): Promise<void> {
    try {
      
      // On macOS/Linux, try to find and kill any hanging npm/uvx/python processes that might be children of this app
      if (process.platform !== 'win32') {
        const { execSync } = require('child_process');
        const appPid = process.pid;
        
        try {
          // Find child processes of the current app that might be hanging
          const psCommand = `ps -eo pid,ppid,comm | grep -E "(npm|uvx|python|pip|uv)" | grep -v grep`;
          const psResult = execSync(psCommand, { encoding: 'utf8', timeout: 5000 });
          
          if (psResult.trim()) {
            
            // Parse and kill processes that are children of our app
            const lines = psResult.trim().split('\n');
            for (const line of lines) {
              const [pid, ppid, comm] = line.trim().split(/\s+/);
              if (ppid && parseInt(ppid) === appPid) {
                try {
                  process.kill(parseInt(pid), 'SIGTERM');
                  
                  // Wait a bit, then force kill if still running
                  setTimeout(() => {
                    try {
                      process.kill(parseInt(pid), 'SIGKILL');
                    } catch (error) {
                      // Process probably already dead, ignore
                    }
                  }, 2000);
                } catch (error) {
                }
              }
            }
          } else {
          }
        } catch (error) {
        }
      } else {
      }
    } catch (error) {
    }
  }


  /**
   * Reset instance for user sign-out - clear all user data and connections
   */
  async resetForSignOut(): Promise<void> {
    const resetStart = Date.now();
    const resetId = `reset_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    
    // Phase 1: Gather current state for logging
    const initialState = {
      instanceId: this.instanceId,
      currentUser: this.currentUserAlias,
      mcpClientCount: this.mcpClients.size,
      toolMappingCount: this.toolToServerMap.size,
      operationLockCount: this.operationLocks.size,
      clientNames: Array.from(this.mcpClients.keys()),
      toolNames: Array.from(this.toolToServerMap.keys())
    };
    
    
    // Phase 2: Perform complete cleanup
    
    const cleanupStart = Date.now();
    try {
      await this.cleanup();
      const cleanupDuration = Date.now() - cleanupStart;
    } catch (cleanupError) {
      const cleanupDuration = Date.now() - cleanupStart;
      // Continue with reset even if cleanup partially failed
    }
    
    // Phase 3: Verify cleanup completion
    
    const postCleanupState = {
      mcpClientCount: this.mcpClients.size,
      toolMappingCount: this.toolToServerMap.size,
      operationLockCount: this.operationLocks.size,
      currentUserCleared: this.currentUserAlias === null
    };
    
    
    if (postCleanupState.mcpClientCount > 0 || postCleanupState.toolMappingCount > 0) {
      
      // Force cleanup if needed
      this.mcpClients.clear();
      this.toolToServerMap.clear();
      this.operationLocks.clear();
      this.runtimeStates.clear();  // 🆕 Clean up runtime states
      this.currentUserAlias = null;
      
    }
    
    // Phase 4: Reset singleton instance
    
    const previousInstance = MCPClientManager.instance;
    MCPClientManager.instance = null;
    
    
    // Phase 5: Final summary
    const totalDuration = Date.now() - resetStart;
  }

  // ==================== Private Methods ====================

  /**
   * 🆕 Initialize builtin server
   * Automatically connect builtin tool server during manager initialization
   */
  private async _initializeBuiltinServer(): Promise<void> {
    const initId = `builtin_init_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    if (!this.currentUserAlias) {
      return;
    }

    try {
      // Create builtin client instance
      const builtinClient = new BuiltinMcpClient();
      
      // Connect to builtin server (always succeeds)
      const result = await builtinClient.connectToServer();
      
      if (result === 'connected') {
        // Get tool list
        const tools = await builtinClient.getTools();
        
        
        // Register to client mappings
        this.mcpClients.set(BUILTIN_SERVER_NAME, builtinClient);
        this.clientImplementations.set(BUILTIN_SERVER_NAME, 'vscodeMcpClient'); // Mark as vscMcpClient type for consistency
        
        // Update tool mappings
        this._updateToolMappings(BUILTIN_SERVER_NAME, tools);
        
        // 🆕 Refactor: Use internal methods to register builtin server state
        this._updateServerStatus(BUILTIN_SERVER_NAME, 'connected');
        this._updateServerTools(BUILTIN_SERVER_NAME, tools);
        this._updateServerError(BUILTIN_SERVER_NAME, null);
        
      } else {
        const error = result instanceof Error ? result : new Error('Failed to connect to builtin server');
        throw error;
      }
    } catch (error) {
      // Don't throw error, allow system to continue running (builtin server is optional)
    }
  }

  /**
   * Start connection asynchronously (don't wait for result)
   * Modified to use _executeWithLock to prevent race conditions with manual connect calls
   */
  private _startConnectionAsync(serverName: string): void {
    this._executeWithLock(serverName, 'connect', async () => {
      await this._performConnect(serverName);
    }).catch(error => {
      // Ignore "currently connecting" errors as that's the desired behavior (deduplication)
      if (error.message && error.message.includes('is currently connecting')) {
        return;
      }
      advancedLogger.error(`Failed to auto-connect server "${serverName}": ${error.message}`);
    });
  }

  /**
   * Execute operation with lock
   */
  private async _executeWithLock(
    serverName: string,
    operation: 'connect' | 'disconnect' | 'reconnect',
    action: () => Promise<void>
  ): Promise<void> {
    // Check if operation is already in progress
    const existingLock = this.operationLocks.get(serverName);
    if (existingLock) {
      throw new Error(`Server "${serverName}" is currently ${existingLock.operation}ing, please wait`);
    }

    // Create abort controller for cancellation
    const abortController = new AbortController();
    
    const lockPromise = action();
    const lock: OperationLock = {
      operation,
      promise: lockPromise,
      timestamp: Date.now(),
      abortController
    };

    this.operationLocks.set(serverName, lock);

    try {
      await lockPromise;
    } finally {
      this.operationLocks.delete(serverName);
    }
  }

  /**
   * Force cancel ongoing connection process for a server
   */
  private async _forceCancelConnection(serverName: string): Promise<void> {
    const cancelId = `cancel_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    try {
      // 1. Cancel operation lock if exists
      const operationLock = this.operationLocks.get(serverName);
      if (operationLock) {
        if (operationLock.abortController) {
          operationLock.abortController.abort();
        }
        this.operationLocks.delete(serverName);
      }

      // 2. Cancel active connection process if exists
      const connectionProcess = this.activeConnections.get(serverName);
      if (connectionProcess) {
        connectionProcess.abortController.abort();
        
        // Try to cleanup the client
        try {
          await connectionProcess.client.cleanup();
        } catch (error) {
        }
        
        this.activeConnections.delete(serverName);
      }

      // 3. Remove client and mappings if they exist
      const client = this.mcpClients.get(serverName);
      if (client) {
        try {
          await client.cleanup();
        } catch (error) {
        }
        
        this.mcpClients.delete(serverName);
        this.clientImplementations.delete(serverName);
        this._removeToolMappings(serverName);
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * Perform connect operation
   */
  private async _performConnect(serverName: string): Promise<void> {
    const connectId = `connect_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    if (!this.currentUserAlias) {
      throw new Error('Manager not initialized with user alias');
    }

    // 🆕 Use dynamic import to avoid circular dependency
    const { profileCacheManager } = await import('../userDataADO');
    
    // Get server config from ProfileCacheManager
    const serverInfo = profileCacheManager.getMcpServerInfo(this.currentUserAlias, serverName);
    if (!serverInfo.config) {
      throw new Error(`Server "${serverName}" not found in configuration`);
    }

    // Convert to McpServerConfig format
    const serverConfig: McpServerConfig = {
      name: serverInfo.config.name,
      transport: serverInfo.config.transport,
      command: serverInfo.config.command,
      args: serverInfo.config.args,
      url: serverInfo.config.url,
      env: serverInfo.config.env,
      in_use: serverInfo.config.in_use,
      version: serverInfo.config.version,
      source: serverInfo.config.source as 'ON-DEVICE' | undefined
    };

    // 🔥 Handle KOSMOS placeholders: replace placeholders in url and env
    if (this.currentUserAlias) {
      // Replace placeholders in url
      if (serverConfig.url && typeof serverConfig.url === 'string' && containsKosmosPlaceholder(serverConfig.url)) {
        serverConfig.url = kosmosPlaceholderManager.replacePlaceholders(serverConfig.url, { alias: this.currentUserAlias });
        advancedLogger?.info('[MCPClientManager] Replaced KOSMOS placeholders in url', '_performConnect', { serverName });
      }
      
      // Replace placeholders in env
      if (serverConfig.env && typeof serverConfig.env === 'object') {
        const envEntries = Object.entries(serverConfig.env);
        let hasPlaceholder = false;
        for (const [, value] of envEntries) {
          if (typeof value === 'string' && containsKosmosPlaceholder(value)) {
            hasPlaceholder = true;
            break;
          }
        }
        if (hasPlaceholder) {
          serverConfig.env = kosmosPlaceholderManager.replacePlaceholdersInObject(serverConfig.env, { alias: this.currentUserAlias });
          advancedLogger?.info('[MCPClientManager] Replaced KOSMOS placeholders in env', '_performConnect', { serverName });
        }
      }
    }

    // 🆕 Refactor: Use internal methods to update state
    this._updateServerStatus(serverName, 'connecting');

    // Create abort controller for this connection
    const abortController = new AbortController();
    let client: IUnifiedMcpClient | null = null;

    try {
      // Create new client - use hybrid mode based on transport type
      const implementation = this._determineImplementation(serverConfig);
      client = this._createClient(serverConfig, implementation);
      
      // Track this connection process
      const connectionProcess: ConnectionProcess = {
        serverName,
        abortController,
        client,
        startTime: Date.now()
      };
      this.activeConnections.set(serverName, connectionProcess);
      

      // Check if connection was cancelled before proceeding
      if (abortController.signal.aborted) {
        return;
      }

      // Attempt connection with cancellation support
      const result = await this._connectWithCancellation(client, abortController.signal);
      
      if (abortController.signal.aborted) {
        return;
      }
      
      if (result === 'connected') {
        // Get tools list
        const tools = await client.getTools();
        
        if (!tools || tools.length === 0) {
          // No tools available - set error state
          const error = new Error('Connection successful but no tools available');
          // 🆕 Refactor: Use internal methods to update runtime state
          this._updateServerError(serverName, error);
          this._updateServerTools(serverName, []); // Clear tools list for error state
          this._updateServerStatus(serverName, 'error');
          
          // Still update in_use to true (user wants to use this server)
          await profileCacheManager.updateMcpServerConfig(this.currentUserAlias, serverName, { in_use: true });
          
          return; // Don't throw error - connection operation completed, just in error state
        }
        
        // Success - update runtime state
        this.mcpClients.set(serverName, client);
        this.clientImplementations.set(serverName, implementation);
        
        // 🔧 Important: Update toolToServerMap first, then set status='connected'
        // This ensures toolToServerMap is ready when external polling detects connected status
        this._updateToolMappings(serverName, tools);
        
        // 🆕 Refactor: Use internal methods to update runtime state
        this._updateServerTools(serverName, tools);
        this._updateServerError(serverName, null);
        this._updateServerStatus(serverName, 'connected');
        
        // Update config in_use to true
        await profileCacheManager.updateMcpServerConfig(this.currentUserAlias, serverName, { in_use: true });
        
      } else {
        // Connection failed
        const error = result instanceof Error ? result : new Error('Connection failed');
        // 🆕 Refactor: Use internal methods to update runtime state
        this._updateServerError(serverName, error);
        this._updateServerTools(serverName, []); // Clear tools list for error state
        this._updateServerStatus(serverName, 'error');
        
        // Still update in_use to true (user wants to use this server)
        await profileCacheManager.updateMcpServerConfig(this.currentUserAlias, serverName, { in_use: true });
        
        return; // Don't throw error - connection operation completed, just in error state
      }
    } catch (error) {
      // Check if this was a cancellation
      if (abortController.signal.aborted) {
        // Don't update status to error for cancelled connections
        // 🆕 Refactor: Use internal methods to update runtime state
        this._updateServerStatus(serverName, 'disconnected');
        return;
      }

      // Exception handling
      const err = error instanceof Error ? error : new Error('Connection failed');
      // 🆕 Refactor: Use internal methods to update runtime state
      this._updateServerError(serverName, err);
      this._updateServerTools(serverName, []); // Clear tools list for error state
      this._updateServerStatus(serverName, 'error');
      
      // Still update in_use to true
      try {
        await profileCacheManager.updateMcpServerConfig(this.currentUserAlias, serverName, { in_use: true });
      } catch (profileError) {
      }
      
      // Don't throw error - connection operation completed, just in error state
      return; // Explicitly return to prevent any further execution
    } finally {
      // Clean up connection tracking
      this.activeConnections.delete(serverName);
      
      // If connection failed and client was created, clean it up
      if (client && !this.mcpClients.has(serverName)) {
        try {
          await client.cleanup();
        } catch (cleanupError) {
        }
      }
    }
  }

  /**
   * Connect with cancellation support
   */
  private async _connectWithCancellation(client: IUnifiedMcpClient, abortSignal: AbortSignal): Promise<string | Error> {
    return new Promise((resolve, reject) => {
      // Handle cancellation
      const onAbort = () => {
        reject(new Error('Connection cancelled'));
      };

      if (abortSignal.aborted) {
        reject(new Error('Connection cancelled'));
        return;
      }

      abortSignal.addEventListener('abort', onAbort);

      // Start the connection
      client.connectToServer()
        .then(result => {
          abortSignal.removeEventListener('abort', onAbort);
          resolve(result);
        })
        .catch(error => {
          abortSignal.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }

  /**
   * Perform disconnect operation
   */
  private async _performDisconnect(serverName: string): Promise<void> {
    const disconnectId = `disconnect_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    if (!this.currentUserAlias) {
      const error = 'Manager not initialized with user alias'
      throw new Error(error);
    }

    let disconnectError: Error | null = null;

    try {
      // Step 1: Force cancel any ongoing connection process first
      await this._forceCancelConnection(serverName);

      // Step 2: 🆕 Refactor: Use internal methods to update state
      this._updateServerStatus(serverName, 'disconnecting');

      // Step 3: Clean up any remaining resources
      const client = this.mcpClients.get(serverName);
      
      if (client) {
        this._removeToolMappings(serverName);
        
        await client.cleanup();
        
        this.mcpClients.delete(serverName);
        this.clientImplementations.delete(serverName);
        
      } else {
      }
    } catch (error) {
      // Log cleanup error but don't fail the disconnect operation
      disconnectError = error instanceof Error ? error : new Error('Cleanup failed during disconnect');
    }

    try {
      // 🆕 Use dynamic import to avoid circular dependency
      const { profileCacheManager } = await import('../userDataADO');
      // Update config in_use to false
      await profileCacheManager.updateMcpServerConfig(this.currentUserAlias, serverName, { in_use: false });
    } catch (error) {
      // Log config update error but don't fail the disconnect operation
      const configError = error instanceof Error ? error : new Error('Config update failed during disconnect');
      if (!disconnectError) {
        disconnectError = configError;
      }
    }

    // Always set final state to disconnected, regardless of cleanup errors
    // The goal of disconnect is to reach disconnected state
    // 🆕 Refactor: Use internal methods to update runtime state
    this._updateServerTools(serverName, []);
    this._updateServerError(serverName, disconnectError);
    this._updateServerStatus(serverName, 'disconnected');
    
    if (disconnectError) {
    } else {
    }

    // Don't throw error - disconnect operation should always succeed in reaching disconnected state
    // Even if there were cleanup issues, the server is considered disconnected
  }

  /**
   * Perform reconnect operation
   * 🔧 Fix: If no existing client instance, perform a full connect operation to recreate the instance
   */
  private async _performReconnect(serverName: string): Promise<void> {

    if (!this.currentUserAlias) {
      throw new Error('Manager not initialized with user alias');
    }

    // Check if client exists
    const client = this.mcpClients.get(serverName);
    
    if (!client) {
      // 🆕 No existing client instance, perform a full connect operation to recreate the instance and connect
      // This solves the issue where reconnect fails due to no client instance in error state
      await this._performConnect(serverName);
      return;
    }

    // 🔧 Existing client instance found, attempt reconnection directly
    // 🆕 Refactor: Use internal methods to update state
    this._updateServerStatus(serverName, 'connecting');

    try {
      // Reuse existing client, call connectToServer() to reconnect
      const result = await client.connectToServer();
      
      if (result === 'connected') {
        // Get tools
        const tools = await client.getTools();
        
        if (tools && tools.length > 0) {
          // Success
          // 🔧 Important: Update toolToServerMap first, then set status='connected'
          this._updateToolMappings(serverName, tools);
          
          // 🆕 Refactor: Use internal methods to update runtime state
          this._updateServerTools(serverName, tools);
          this._updateServerError(serverName, null);
          this._updateServerStatus(serverName, 'connected');
          
        } else {
          // No tools
          this._removeToolMappings(serverName);
          const error = new Error('Reconnection successful but no tools returned from server');
          // 🆕 Refactor: Use internal methods to update runtime state
          this._updateServerError(serverName, error);
          this._updateServerStatus(serverName, 'error');
          this._updateServerTools(serverName, []); // Clear tools list for error state
          
          // Don't throw error - reconnect operation completed, just in error state          return;
        }
      } else {
        // Connection failed
        const error = result instanceof Error ? result : new Error('Reconnection failed');
        // 🆕 Refactor: Use internal methods to update runtime state
        this._updateServerError(serverName, error);
        this._updateServerTools(serverName, []); // Clear tools list for error state
        this._updateServerStatus(serverName, 'error');
        
        // Don't throw error - reconnect operation completed, just in error state
        return;
      }
    } catch (error) {
      // Exception occurred
      this._removeToolMappings(serverName);
      const err = error instanceof Error ? error : new Error('Reconnect failed');
      // 🆕 Refactor: Use internal methods to update runtime state
      this._updateServerError(serverName, err);
      this._updateServerTools(serverName, []); // Clear tools list for error state
      this._updateServerStatus(serverName, 'error');
      
      // Don't throw error - reconnect operation completed, just in error state
      return;
    }
  }

  /**
   * Update tool mappings
   */
  private _updateToolMappings(serverName: string, tools: { name: string }[]): void {
    // Remove old mappings first
    this._removeToolMappings(serverName);
    
    // Add new mappings
    for (const tool of tools) {
      this.toolToServerMap.set(tool.name, serverName);
    }
  }

  /**
   * Remove tool mappings
   */
  private _removeToolMappings(serverName: string): void {
    const entries = Array.from(this.toolToServerMap.entries());
    for (const [toolName, mappedServerName] of entries) {
      if (mappedServerName === serverName) {
        this.toolToServerMap.delete(toolName);
      }
    }
  }

  /**
   * Create client instance using ALL vscMcpClient strategy
   * 🆕 Modified: All transport types use VscMcpClient, MCPClient completely disabled
   * - ALL transports: use VscMcpClient (zero-dependency, VSCode-standard)
   *
   * @param serverConfig - Server configuration
   * @param implementation - Client implementation type (always forced to vscodeMcpClient)
   */
  private _createClient(serverConfig: McpServerConfig, implementation: ClientImplementation): IUnifiedMcpClient {
    // 🚫 MCPClient completely disabled, VscMcpClient used for all cases
    if (implementation !== 'vscodeMcpClient') {
    }
    
    return new VscMcpClient(serverConfig);
  }

  /**
   * Determine client implementation based on transport type (ALL USE vscMcpClient mode)
   * 🆕 Modified: All transport types use vscMcpClient, MCPClient (SDK) disabled
   *
   * @param serverConfig - Server configuration
   */
  private _determineImplementation(serverConfig: McpServerConfig): ClientImplementation {
    // 🆕 All transport types use vscMcpClient, including HTTP transport
    // stdio, sse, streamablehttp all use VscMcpClient
    return 'vscodeMcpClient';
  }

  /**
   * Force client implementation for specific server
   * 🆕 Modified: Now only allows vscodeMcpClient, forcing sdk is not allowed
   *
   * @param serverName - Server name
   * @param implementation - Client implementation type
   */
  async forceClientImplementation(serverName: string, implementation: ClientImplementation): Promise<void> {
    if (!this.currentUserAlias) {
      throw new Error('Manager not initialized with user alias');
    }

    // 🆕 Use dynamic import to avoid circular dependency
    const { profileCacheManager } = await import('../userDataADO');
    const serverInfo = profileCacheManager.getMcpServerInfo(this.currentUserAlias, serverName);
    if (!serverInfo.config) {
      throw new Error(`Server "${serverName}" not found`);
    }

    // Only allow vscodeMcpClient
    if (implementation === 'sdk') {
      implementation = 'vscodeMcpClient';
    }

    this.clientImplementations.set(serverName, implementation);
  }

  /**
   * Get implementation statistics showing ALL vscMcpClient distribution
   * 🆕 Modified: Should now show all as vscMcpClient
   */
  getImplementationStats(): { sdk: number; vscodeMcpClient: number; total: number } {
    const stats = { sdk: 0, vscodeMcpClient: 0, total: 0 };
    
    // Count actual implementations - should be ALL vscMcpClient now
    this.clientImplementations.forEach((implementation) => {
      if (implementation === 'sdk') {
        // This should not happen since we disabled sdk
        stats.sdk++;
      } else if (implementation === 'vscodeMcpClient') {
        stats.vscodeMcpClient++;
      }
    });
    
    stats.total = this.clientImplementations.size;
    return stats;
  }

  /**
   * 🆕 Check if this is a builtin server
   * @param serverName - Server name
   * @returns Whether it is a builtin server
   */
  isBuiltinServer(serverName: string): boolean {
    return serverName === BUILTIN_SERVER_NAME;
  }

  /**
   * 🆕 Get builtin server name
   * @returns Builtin server name
   */
  getBuiltinServerName(): string {
    return BUILTIN_SERVER_NAME;
  }
}

// Export singleton instance
export const mcpClientManager = MCPClientManager.getInstance();