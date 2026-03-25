/**
 * VSCode MCP Client - Connection Manager
 * Manages individual MCP server connections with state machine, auto-reconnect, and health checking
 */

import { EventEmitter } from 'events';
import { JsonRpcClient } from '../core/JsonRpc';
import { VscodeTransportFactory, VscodeTransport } from '../transport/VscodeTransportFactory';
import { VscodeToJsonRpcTransportAdapter } from '../adapters/VscodeToJsonRpcTransportAdapter';
import {
  ConnectionState,
  McpServerDefinition,
  ConnectionConfig,
  DEFAULT_CONNECTION_CONFIG,
  McpError,
  ConnectionError,
  TimeoutError,
  ValidationError,
} from '../types/mcpTypes';
import {
  MCP_METHODS,
  InitializeRequest,
  InitializeResult,
  MCP_PROTOCOL_VERSION,
  MCP_CLIENT_INFO,
  JsonRpcNotification,
  JsonRpcRequest,
} from '../types/protocolTypes';

// ==================== Connection Events ====================

export interface ConnectionEvents {
  stateChanged: (previousState: ConnectionState, currentState: ConnectionState) => void;
  error: (error: Error) => void;
  initialized: (serverInfo: InitializeResult) => void;
  disconnected: (reason?: string) => void;
  notification: (notification: JsonRpcNotification) => void;
  request: (request: JsonRpcRequest) => void;
}

// ==================== Connection Statistics ====================

export interface ConnectionStats {
  connectTime: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  reconnectAttempts: number;
  lastActivity: number;
  uptime: number;
  bytesReceived: number;
  bytesSent: number;
}

// ==================== MCP Connection Implementation ====================

export class McpConnection extends EventEmitter {
  private serverDefinition: McpServerDefinition;
  private config: ConnectionConfig;
  private transport: VscodeTransport | null = null;
  private jsonRpcClient: JsonRpcClient | null = null;
  private _state: ConnectionState = 'stopped';
  private initializePromise: Promise<InitializeResult> | null = null;
  private closePromise: Promise<void> | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isDisposed = false;

  // Statistics
  private stats: ConnectionStats = {
    connectTime: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    reconnectAttempts: 0,
    lastActivity: 0,
    uptime: 0,
    bytesReceived: 0,
    bytesSent: 0,
  };

  // Server information
  private serverInfo: InitializeResult | null = null;

  public static readonly EVENTS = {
    STATE_CHANGED: 'stateChanged',
    ERROR: 'error',
    INITIALIZED: 'initialized',
    DISCONNECTED: 'disconnected',
    NOTIFICATION: 'notification',
    REQUEST: 'request',
  } as const;

  constructor(
    serverDefinition: McpServerDefinition,
    config: Partial<ConnectionConfig> = {}
  ) {
    super();
    
    this.serverDefinition = { ...serverDefinition };
    this.config = { ...DEFAULT_CONNECTION_CONFIG, ...config };
  }

  // ==================== Public API ====================

  get state(): ConnectionState {
    return this._state;
  }

  get isConnected(): boolean {
    return this._state === 'running';
  }

  get definition(): McpServerDefinition {
    return { ...this.serverDefinition };
  }

  get serverInformation(): InitializeResult | null {
    return this.serverInfo;
  }

  getStats(): ConnectionStats {
    return {
      ...this.stats,
      uptime: this.stats.connectTime > 0 ? Date.now() - this.stats.connectTime : 0,
    };
  }

  /**
   * Start the connection
   */
  async start(): Promise<InitializeResult> {
    this.throwIfDisposed();

    if (this._state === 'running') {
      return this.serverInfo!;
    }

    if (this._state === 'starting' && this.initializePromise) {
      return this.initializePromise;
    }

    this.setState('starting');
    this.initializePromise = this.performConnect();

    try {
      const result = await this.initializePromise;
      return result;
    } finally {
      this.initializePromise = null;
    }
  }

  /**
   * Stop the connection
   */
  async stop(reason?: string): Promise<void> {
    if (this.isDisposed || this._state === 'stopped') {
      return;
    }

    if (this.closePromise) {
      return this.closePromise;
    }

    this.setState('disconnecting');
    this.closePromise = this.performDisconnect(reason);

    try {
      await this.closePromise;
    } finally {
      this.closePromise = null;
    }
  }

  /**
   * Send a request through the connection
   */
  async request<T = any>(
    method: string,
    params?: any,
    options?: { timeout?: number; signal?: AbortSignal }
  ): Promise<T> {
    this.throwIfDisposed();

    if (!this.isConnected || !this.jsonRpcClient) {
      throw new ConnectionError('Connection not established');
    }

    this.stats.totalRequests++;
    this.stats.lastActivity = Date.now();

    try {
      const result = await this.jsonRpcClient.request<T>(method, params, options);
      this.stats.successfulRequests++;
      return result;
    } catch (error) {
      this.stats.failedRequests++;
      throw error;
    }
  }

  /**
   * Send a notification through the connection
   */
  notify(method: string, params?: any): void {
    this.throwIfDisposed();

    if (!this.isConnected || !this.jsonRpcClient) {
      throw new ConnectionError('Connection not established');
    }

    this.stats.lastActivity = Date.now();
    this.jsonRpcClient.notify(method, params);
  }

  /**
   * Dispose the connection
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.clearTimers();
    this.stop('Connection disposed').catch(() => {
      // Ignore errors during disposal
    });
    this.removeAllListeners();
  }

  // ==================== Private Implementation ====================

  private async performConnect(): Promise<InitializeResult> {
    try {
      this.clearTimers();
      this.reconnectAttempts = 0;

      // Create transport
      this.transport = this.createTransport();
      this.setupTransportListeners();

      // Start VSCode transport
      await this.transport.start();

      // Create JSON-RPC client with VSCode transport adapter
      const transportAdapter = new VscodeToJsonRpcTransportAdapter(this.transport);
      this.jsonRpcClient = new JsonRpcClient(transportAdapter, {
        timeout: this.config.timeout,
      });
      this.setupJsonRpcListeners();

      // Initialize MCP protocol
      const serverInfo = await this.initializeMcp();
      this.serverInfo = serverInfo;

      // Start health checking
      this.startHealthChecking();

      this.setState('running');
      this.stats.connectTime = Date.now();
      this.emit(McpConnection.EVENTS.INITIALIZED, serverInfo);

      return serverInfo;

    } catch (error) {
      this.setState('error');
      await this.cleanup();
      throw error;
    }
  }

  private async performDisconnect(reason?: string): Promise<void> {
    this.clearTimers();

    try {
      // Close JSON-RPC client
      if (this.jsonRpcClient) {
        await this.jsonRpcClient.close();
        this.jsonRpcClient = null;
      }

      // Stop transport
      if (this.transport) {
        await this.transport.stop();
        this.transport = null;
      }

    } catch (error) {
      // Log error but continue with cleanup
    } finally {
      this.setState('stopped');
      this.serverInfo = null;
      this.emit(McpConnection.EVENTS.DISCONNECTED, reason);
    }
  }

  private createTransport(): VscodeTransport {
    try {
      // Use VSCode transport factory for automatic configuration handling
      return VscodeTransportFactory.createFromVscodeConfig(
        this.serverDefinition.name,
        this.normalizeServerDefinition()
      );
    } catch (error) {
      throw new ValidationError(`Failed to create transport: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private normalizeServerDefinition(): any {
    // Convert McpServerDefinition to VSCode configuration format
    return {
      type: this.serverDefinition.transport,
      command: this.serverDefinition.command,
      args: this.serverDefinition.args,
      env: this.serverDefinition.env,
      cwd: this.serverDefinition.workingDirectory,
      url: this.serverDefinition.url,
      timeout: this.config.timeout,
      // Add any additional configuration needed
      headers: this.serverDefinition.transport === 'http' ? {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      } : this.serverDefinition.transport === 'sse' ? {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      } : undefined,
    };
  }

  private setupTransportListeners(): void {
    if (!this.transport) return;

    this.transport.on('stateChange', (state: any) => {
      if (state.state === 'error' && this._state === 'running') {
        this.handleTransportError();
      }
    });

    this.transport.on('log', (level: string, message: string) => {
      if (level === 'error') {
        try {
          this.handleError(new ConnectionError(`Transport error: ${message}`));
        } catch (handlerError) {
          // If error handler fails, log directly to prevent unhandled errors
        }
      }
    });

    this.transport.on('stateChange', (state: any) => {
      if (state.state === 'stopped' && this._state === 'running') {
        this.handleUnexpectedDisconnection();
      }
    });
  }

  private setupJsonRpcListeners(): void {
    if (!this.jsonRpcClient) return;

    this.jsonRpcClient.on(JsonRpcClient.EVENTS.ERROR, (error) => {
      try {
        this.handleError(new ConnectionError(`JSON-RPC error: ${error.message}`));
      } catch (handlerError) {
        // If error handler fails, log directly to prevent unhandled errors
      }
    });

    this.jsonRpcClient.on(JsonRpcClient.EVENTS.CLOSE, () => {
      if (this._state === 'running') {
        this.handleUnexpectedDisconnection();
      }
    });

    // Handle incoming notifications
    this.jsonRpcClient.on(JsonRpcClient.EVENTS.NOTIFICATION, (notification) => {
      this.handleNotification(notification);
    });

    // Handle incoming requests (for bidirectional protocols)
    this.jsonRpcClient.on(JsonRpcClient.EVENTS.REQUEST, (request) => {
      this.handleRequest(request);
    });
  }

  private async initializeMcp(): Promise<InitializeResult> {
    if (!this.jsonRpcClient) {
      throw new ConnectionError('JSON-RPC client not available');
    }

    const initRequest: InitializeRequest = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        experimental: {},
        sampling: {},
      },
      clientInfo: MCP_CLIENT_INFO,
    };

    try {
      const result = await this.jsonRpcClient.request<InitializeResult>(
        MCP_METHODS.INITIALIZE,
        initRequest,
        { timeout: this.config.timeout }
      );

      // Send initialized notification (no params)
      this.jsonRpcClient.notify(MCP_METHODS.NOTIFICATIONS_INITIALIZED, undefined);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new ConnectionError(`MCP initialization failed: ${errorMessage}`);
    }
  }

  private startHealthChecking(): void {
    if (this.config.healthCheckIntervalMs <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch((error) => {
        try {
          this.handleError(new ConnectionError(`Health check failed: ${error.message}`));
        } catch (handlerError) {
          // If error handler fails, log directly to prevent unhandled errors
        }
      });
    }, this.config.healthCheckIntervalMs);
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.isConnected || !this.jsonRpcClient) {
      return;
    }

    try {
      await this.jsonRpcClient.request(MCP_METHODS.PING, {}, { timeout: 5000 });
    } catch (error) {
      throw new TimeoutError('Health check ping failed');
    }
  }

  private handleTransportError(): void {
    this.setState('error');
    this.scheduleReconnect();
  }

  private handleUnexpectedDisconnection(): void {
    this.setState('error');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isDisposed || this.reconnectAttempts >= this.config.retries) {
      this.setState('stopped');
      return;
    }

    this.reconnectAttempts++;
    this.stats.reconnectAttempts++;

    const delay = this.config.retryDelayMs * Math.pow(2, this.reconnectAttempts - 1);

    this.reconnectTimer = setTimeout(() => {
      if (!this.isDisposed && this._state === 'error') {
        this.attemptReconnect();
      }
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    try {
      await this.cleanup();
      await this.performConnect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        this.handleError(new ConnectionError(`Reconnection failed: ${errorMessage}`));
      } catch (handlerError) {
        // If error handler fails, log directly to prevent unhandled errors
      }
      this.scheduleReconnect();
    }
  }

  private async cleanup(): Promise<void> {
    this.clearTimers();

    if (this.jsonRpcClient) {
      try {
        await this.jsonRpcClient.close();
      } catch (error) {
        // Ignore cleanup errors
      }
      this.jsonRpcClient = null;
    }

    if (this.transport) {
      try {
        await this.transport.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
      this.transport = null;
    }

    this.serverInfo = null;
  }

  private clearTimers(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(newState: ConnectionState): void {
    if (this._state !== newState) {
      const previousState = this._state;
      this._state = newState;
      this.emit(McpConnection.EVENTS.STATE_CHANGED, previousState, newState);
    }
  }

  private handleError(error: Error): void {
    try {
      this.emit(McpConnection.EVENTS.ERROR, error);
    } catch (emitError) {
      // If no listeners, log to console to avoid silent failures
      console.error('[McpConnection] Unhandled error (no listeners):', error.message);
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    this.stats.lastActivity = Date.now();
    this.emit(McpConnection.EVENTS.NOTIFICATION, notification);
  }

  private handleRequest(request: JsonRpcRequest): void {
    this.stats.lastActivity = Date.now();

    // Respond to server-initiated ping requests
    if (request.method === MCP_METHODS.PING && this.jsonRpcClient) {
      this.jsonRpcClient.respond(request.id, {});
    }

    this.emit(McpConnection.EVENTS.REQUEST, request);
  }

  private throwIfDisposed(): void {
    if (this.isDisposed) {
      throw new Error('Connection is disposed');
    }
  }
}