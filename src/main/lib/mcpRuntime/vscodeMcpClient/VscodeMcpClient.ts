/**
 * VSCode MCP Client - Main Client Implementation (VSCode Standard Compatible)
 * Based on VSCode's MCP implementation patterns
 */

import { EventEmitter } from 'events';
import { VscodeTransportFactory, VscodeTransport } from './transport/VscodeTransportFactory';
import { UnifiedLogger, createConsoleLogger } from '../../unifiedLogger';

export interface VscodeMcpServerConfig {
  name: string;
  type?: 'stdio' | 'http' | 'sse' | 'streamablehttp';
  
  // Stdio-specific fields
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | null>;
  envFile?: string;
  
  // HTTP/SSE-specific fields
  url?: string;
  headers?: Record<string, string>;
  method?: string;
  
  // Common fields
  timeout?: number;
  initTimeout?: number;  // Separate timeout for initialization
  retryAttempts?: number;  // Number of retry attempts
  retryDelay?: number;     // Delay between retries
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  message?: string;
  code?: string;
}

/**
 * VSCode-compatible MCP Client
 * Implements behavior similar to VSCode's MCP client implementation
 */
export class VscodeMcpClient extends EventEmitter {
  private transport: VscodeTransport | null = null;
  private currentState: ConnectionState = { state: 'stopped' };
  private tools: McpTool[] = [];
  private resources: McpResource[] = [];
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: Function; reject: Function; timeout?: NodeJS.Timeout }>();
  private isInitialized = false;
  private logger: UnifiedLogger;
  
  constructor(private config: VscodeMcpServerConfig) {
    super();
    this.logger = createConsoleLogger();
    this.log('debug', `Creating MCP client for server: ${config.name}`);
  }
  
  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.currentState.state === 'running' || this.currentState.state === 'starting') {
      return;
    }
    
    this.setState({ state: 'starting' });
    
    try {
      // Create transport
      this.transport = VscodeTransportFactory.createFromVscodeConfig(this.config.name, this.config);
      
      // Setup transport event handlers
      this.setupTransportHandlers();
      
      // Start transport
      await this.transport.start();
      
      // Initialize MCP connection
      await this.initializeMcp();
      
      // List available tools and resources
      await this.discoverCapabilities();
      
      this.setState({ state: 'running' });
      this.log('info', `Connected to MCP server: ${this.config.name}`);
      
    } catch (error) {
      // Try to get the transport's stderr output to provide more detailed error information
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if the error message already contains stderr output to avoid duplicate appending
      // (initializeMcp and other methods may have already included stderr in the error message)
      const alreadyHasStderr = /stderr output:/i.test(errorMessage);
      
      if (!alreadyHasStderr && this.transport && 'getStderrOutput' in this.transport) {
        const stderrOutput = (this.transport as any).getStderrOutput();
        if (stderrOutput && stderrOutput.trim().length > 0) {
          errorMessage = `${errorMessage}\n\nStderr output:\n${stderrOutput.trim()}`;
        }
      }
      this.setState({
        state: 'error',
        message: errorMessage
      });
      throw new Error(errorMessage);
    }
  }
  
  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.currentState.state === 'stopped') {
      return;
    }
    
    try {
      // Clear pending requests
      this.pendingRequests.forEach((pending, id) => {
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        pending.reject(new Error('Connection closed'));
      });
      this.pendingRequests.clear();
      
      // Stop transport
      if (this.transport) {
        await this.transport.stop();
      }
      
    } finally {
      this.transport = null;
      this.isInitialized = false;
      this.tools = [];
      this.resources = [];
      this.setState({ state: 'stopped' });
      this.log('info', `Disconnected from MCP server: ${this.config.name}`);
    }
  }
  
  /**
   * Execute a tool
   */
  async callTool(name: string, arguments_: Record<string, any>): Promise<any> {
    if (this.currentState.state !== 'running') {
      throw new Error('Client is not connected');
    }
    
    const request = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'tools/call',
      params: {
        name,
        arguments: arguments_
      }
    };
    
    this.log('debug', `Calling tool: ${name}`);
    return this.sendRequest(request);
  }
  
  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<any> {
    if (this.currentState.state !== 'running') {
      throw new Error('Client is not connected');
    }
    
    const request = {
      jsonrpc: '2.0',
      id: this.getNextRequestId(),
      method: 'resources/read',
      params: { uri }
    };
    
    this.log('debug', `Reading resource: ${uri}`);
    return this.sendRequest(request);
  }
  
  /**
   * Get available tools
   */
  getTools(): McpTool[] {
    return [...this.tools];
  }
  
  /**
   * Get available resources
   */
  getResources(): McpResource[] {
    return [...this.resources];
  }
  
  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return { ...this.currentState };
  }
  
  /**
   * Get server configuration
   */
  getConfig(): VscodeMcpServerConfig {
    return { ...this.config };
  }
  
  // Private methods
  
  private setupTransportHandlers(): void {
    if (!this.transport) return;
    
    this.transport.on('message', (message: string) => {
      this.handleMessage(message);
    });
    
    this.transport.on('stateChange', (state: any) => {
      if (state.state === 'error') {
        this.setState({
          state: 'error',
          message: state.message || 'Transport error'
        });
      }
    });
    
    this.transport.on('log', (level: string, message: string) => {
      this.log(level as any, message);
    });
  }
  
  private async initializeMcp(): Promise<void> {
    // Align with VS Code: no initialization timeout or retry mechanism
    // MCP server may need to download dependencies during startup, making the time unpredictable
    this.log('debug', 'Initializing MCP server...');
    
    try {
      const initRequest = {
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {}
          },
          clientInfo: {
            name: 'VSCode-MCP-Client',
            version: '1.0.0'
          }
        }
      };
      
      // No timeout, wait for MCP server response
      const response = await this.sendRequestNoTimeout(initRequest);
      this.log('debug', `MCP server capabilities: ${JSON.stringify(response.capabilities)}`);
      
      // Send initialized notification
      await this.sendNotification({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      });
      
      this.isInitialized = true;
      this.log('info', 'Successfully initialized MCP server');
      
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      
      // Get stderr output to provide more detailed error information
      let stderrInfo = '';
      let errorMsg = errorObj.message;
      
      // Clean up any existing Stderr output section in errorMsg to avoid duplication
      errorMsg = errorMsg.replace(/\n+stderr output:[\s\S]*$/i, '').trimEnd();
      
      // Get the latest stderr from transport in a unified way
      if (this.transport && 'getStderrOutput' in this.transport) {
        const stderrOutput = (this.transport as any).getStderrOutput();
        
        if (stderrOutput && stderrOutput.length > 0) {
          const cleanOutput = stderrOutput.trim();
          
          // If the truncated message already contains substantial stderr content, don't add more
          if (!errorMsg.includes(cleanOutput.substring(0, Math.min(50, cleanOutput.length)))) {
            stderrInfo = `\n\nStderr output:\n${cleanOutput}`;
          }
        }
      }
      
      const finalErrorMessage = `Failed to initialize MCP server: ${errorMsg}${stderrInfo}`;
      this.log('error', finalErrorMessage);
      throw new Error(finalErrorMessage);
    }
  }
  
  private async discoverCapabilities(): Promise<void> {
    try {
      // List tools
      const toolsResponse = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'tools/list'
      });
      
      this.tools = toolsResponse.tools || [];
      this.log('debug', `Discovered ${this.tools.length} tools`);
      
    } catch (error) {
      this.log('warning', `Failed to list tools: ${error}`);
    }
    
    try {
      // List resources
      const resourcesResponse = await this.sendRequest({
        jsonrpc: '2.0',
        id: this.getNextRequestId(),
        method: 'resources/list'
      });
      
      this.resources = resourcesResponse.resources || [];
      this.log('debug', `Discovered ${this.resources.length} resources`);
      
    } catch (error) {
      this.log('warning', `Failed to list resources: ${error}`);
    }
  }
  
  private async sendRequest(request: any): Promise<any> {
    return this.sendRequestWithTimeout(request, this.config.timeout || 30000);
  }
  
  /**
   * Send request without timeout (used for operations that may take a long time, such as initialization)
   * Align with VS Code: MCP server may need to download dependencies during startup, making the time unpredictable
   */
  private async sendRequestNoTimeout(request: any): Promise<any> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, { resolve, reject, timeout: undefined });
      
      const messageStr = JSON.stringify(request);
      this.log('trace', `Sending request (no timeout): ${messageStr}`);
      
      if (!this.transport) {
        this.pendingRequests.delete(request.id);
        reject(new Error('Transport not available'));
        return;
      }
      
      try {
        // Call send and check if it is async (returns a Promise)
        const sendResult = this.transport.send(messageStr);
        if (sendResult instanceof Promise) {
          sendResult.catch(error => {
            if (this.pendingRequests.has(request.id)) {
              this.pendingRequests.delete(request.id);
              reject(error);
            }
          });
        }
      } catch (error) {
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          reject(error);
        }
      }
    });
  }
  
  private async sendRequestWithTimeout(request: any, timeoutMs: number): Promise<any> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        const errorMsg = `Request timeout: ${request.method} (${timeoutMs}ms)`;
        this.log('error', errorMsg);
        reject(new Error(errorMsg));
      }, timeoutMs);
      
      this.pendingRequests.set(request.id, { resolve, reject, timeout });
      
      const messageStr = JSON.stringify(request);
      this.log('trace', `Sending request: ${messageStr} (timeout: ${timeoutMs}ms)`);
      
      if (!this.transport) {
        this.pendingRequests.delete(request.id);
        clearTimeout(timeout);
        reject(new Error('Transport not available'));
        return;
      }
      
      try {
        // Call send and check if it is async (returns a Promise)
        const sendResult = this.transport.send(messageStr);
        if (sendResult instanceof Promise) {
          sendResult.catch(error => {
            // Only reject if request is still pending to avoid double rejection
            if (this.pendingRequests.has(request.id)) {
              this.pendingRequests.delete(request.id);
              clearTimeout(timeout);
              reject(error);
            }
          });
        }
      } catch (error) {
        // Only reject if request is still pending to avoid double rejection
        if (this.pendingRequests.has(request.id)) {
          this.pendingRequests.delete(request.id);
          clearTimeout(timeout);
          reject(error);
        }
      }
    });
  }
  
  private async sendNotification(notification: any): Promise<void> {
    if (!this.transport) {
      throw new Error('Transport not available');
    }
    
    const messageStr = JSON.stringify(notification);
    this.log('trace', `Sending notification: ${messageStr}`);
    
    // Call send and check if it is async (returns a Promise)
    const sendResult = this.transport.send(messageStr);
    if (sendResult instanceof Promise) {
      await sendResult;
    }
  }
  
  private handleMessage(messageStr: string): void {
    try {
      const message = JSON.parse(messageStr);
      this.log('trace', `Received message: ${messageStr}`);
      
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        // Response to a request
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        
        if (pending.timeout) {
          clearTimeout(pending.timeout);
        }
        
        if (message.error) {
          pending.reject(new Error(`MCP Error: ${message.error.message} (${message.error.code})`));
        } else {
          pending.resolve(message.result);
        }
      } else if (!message.id) {
        // Notification from server
        this.handleNotification(message);
      }
      
    } catch (error) {
      this.log('error', `Failed to parse message: ${error}`);
    }
  }
  
  private handleNotification(notification: any): void {
    this.log('debug', `Received notification: ${notification.method}`);
    this.emit('notification', notification);
  }
  
  private getNextRequestId(): number {
    return ++this.requestId;
  }
  
  private setState(newState: ConnectionState): void {
    this.currentState = newState;
    this.emit('stateChange', newState);
  }
  
  private log(level: 'trace' | 'debug' | 'info' | 'warning' | 'error', message: string): void {
    const logMessage = `[${this.config.name}] ${message}`;
    this.emit('log', level, logMessage);

    if (this.logger) {
      let upperLevel = level.toUpperCase();
      // Map levels to match UnifiedLogger expectations
      if (upperLevel === 'TRACE') upperLevel = 'DEBUG';
      if (upperLevel === 'WARNING') upperLevel = 'WARN';
      
      this.logger.log(upperLevel as any, message, 'VscodeMcpClient', {
        serverName: this.config.name
      });
    }
  }
}