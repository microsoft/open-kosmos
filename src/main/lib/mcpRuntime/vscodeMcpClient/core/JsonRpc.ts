/**
 * VSCode MCP Client - JSON-RPC 2.0 Implementation
 * Enterprise-grade JSON-RPC implementation with timeout, cancellation, and error handling
 */

import { EventEmitter } from 'events';
import {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  JSON_RPC_ERROR_CODES,
  createJsonRpcError,
  createInternalError,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isJsonRpcNotification,
  isJsonRpcMessage
} from '../types/protocolTypes';
import { AbortSignalMonitor } from '../utils/AbortSignalMonitor';

// ==================== Interfaces ====================

export interface JsonRpcTransport {
  send(message: string): void;
  onMessage: (callback: (message: string) => void) => () => void;
  onError: (callback: (error: Error) => void) => () => void;
  onClose: (callback: () => void) => () => void;
  close(): Promise<void>;
}

export interface PendingRequest {
  id: string | number;
  method: string;
  timestamp: number;
  timeout: NodeJS.Timeout;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
}

export interface JsonRpcOptions {
  timeout?: number;
  maxPendingRequests?: number;
  enableRequestTracking?: boolean;
}

// ==================== JSON-RPC Client Implementation ====================

export class JsonRpcClient extends EventEmitter {
  private transport: JsonRpcTransport;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private requestIdCounter = 0;
  private options: Required<JsonRpcOptions>;
  private isDisposed = false;

  // Event types
  public static readonly EVENTS = {
    NOTIFICATION: 'notification',
    ERROR: 'error',
    CLOSE: 'close',
    REQUEST: 'request',
  } as const;

  constructor(transport: JsonRpcTransport, options: JsonRpcOptions = {}) {
    super();
    
    this.transport = transport;
    this.options = {
      timeout: options.timeout ?? 30000,
      maxPendingRequests: options.maxPendingRequests ?? 100,
      enableRequestTracking: options.enableRequestTracking ?? true,
    };

    this.setupTransportListeners();
  }

  // ==================== Public API ====================

  /**
   * Send a request and wait for response
   */
  async request<T = any>(
    method: string, 
    params?: any, 
    options?: { timeout?: number; signal?: AbortSignal }
  ): Promise<T> {
    if (this.isDisposed) {
      throw new Error('JsonRpcClient is disposed');
    }

    // Check pending request limit
    if (this.pendingRequests.size >= this.options.maxPendingRequests) {
      throw new Error('Too many pending requests');
    }

    const id = this.generateRequestId();
    const timeout = options?.timeout ?? this.options.timeout;
    const signal = options?.signal;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      // Setup timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout after ${timeout}ms: ${method}`));
      }, timeout);

      // Setup abort signal
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeoutHandle);
          reject(new Error(`Request aborted: ${method}`));
          return;
        }

        const abortHandler = () => {
          clearTimeout(timeoutHandle);
          this.pendingRequests.delete(id);
          reject(new Error(`Request aborted: ${method}`));
        };

        // Use monitored listener addition to prevent memory leaks
        AbortSignalMonitor.addListener(signal, abortHandler, {
          source: `JsonRpc-${method}`,
          once: true
        });
      }

      // Store pending request
      const pendingRequest: PendingRequest = {
        id,
        method,
        timestamp: Date.now(),
        timeout: timeoutHandle,
        resolve: (result: T) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        },
        signal,
      };

      this.pendingRequests.set(id, pendingRequest);

      try {
        this.sendMessage(request);
      } catch (error) {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
  }

  /**
   * Send a notification (no response expected)
   */
  notify(method: string, params?: any): void {
    if (this.isDisposed) {
      throw new Error('JsonRpcClient is disposed');
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.sendMessage(notification);
  }

  /**
   * Send a response to an incoming request
   */
  respond(id: string | number, result?: any, error?: JsonRpcError): void {
    if (this.isDisposed) {
      throw new Error('JsonRpcClient is disposed');
    }

    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result }),
    };

    this.sendMessage(response);
  }

  /**
   * Get statistics about pending requests
   */
  getStats(): {
    pendingRequests: number;
    oldestRequestAge: number;
    totalRequests: number;
  } {
    const now = Date.now();
    let oldestRequestAge = 0;

    if (this.pendingRequests.size > 0) {
      const oldestTimestamp = Math.min(
        ...Array.from(this.pendingRequests.values()).map(req => req.timestamp)
      );
      oldestRequestAge = now - oldestTimestamp;
    }

    return {
      pendingRequests: this.pendingRequests.size,
      oldestRequestAge,
      totalRequests: this.requestIdCounter,
    };
  }

  /**
   * Cancel all pending requests
   */
  cancelAllRequests(reason = 'Client disposed'): void {
    const error = new Error(reason);
    
    for (const [id, pendingRequest] of Array.from(this.pendingRequests.entries())) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
    
    this.pendingRequests.clear();
  }

  /**
   * Cancel a specific request
   */
  cancelRequest(id: string | number, reason = 'Request cancelled'): boolean {
    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      return false;
    }

    clearTimeout(pendingRequest.timeout);
    pendingRequest.reject(new Error(reason));
    this.pendingRequests.delete(id);
    return true;
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.cancelAllRequests('Client closing');
    await this.transport.close();
    this.removeAllListeners();
  }

  /**
   * Dispose the client
   */
  dispose(): void {
    this.close().catch(() => {
      // Ignore errors during disposal
    });
  }

  // ==================== Private Methods ====================

  private setupTransportListeners(): void {
    const messageUnsubscribe = this.transport.onMessage((message: string) => {
      this.handleTransportMessage(message);
    });

    const errorUnsubscribe = this.transport.onError((error: Error) => {
      this.emit(JsonRpcClient.EVENTS.ERROR, error);
    });

    const closeUnsubscribe = this.transport.onClose(() => {
      this.handleTransportClose();
    });

    // Store unsubscribe functions for cleanup
    this.once('close', () => {
      messageUnsubscribe();
      errorUnsubscribe();
      closeUnsubscribe();
    });
  }

  private handleTransportMessage(messageStr: string): void {
    try {
      const message = this.parseMessage(messageStr);
      
      if (isJsonRpcResponse(message)) {
        this.handleResponse(message);
      } else if (isJsonRpcRequest(message)) {
        this.handleRequest(message);
      } else if (isJsonRpcNotification(message)) {
        this.handleNotification(message);
      } else {
        this.emit(JsonRpcClient.EVENTS.ERROR, new Error('Invalid JSON-RPC message'));
      }
    } catch (error) {
      this.emit(JsonRpcClient.EVENTS.ERROR, error);
    }
  }

  private parseMessage(messageStr: string): JsonRpcMessage {
    try {
      const parsed = JSON.parse(messageStr);
      
      if (!isJsonRpcMessage(parsed)) {
        throw new Error('Invalid JSON-RPC message format');
      }
      
      return parsed;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse JSON-RPC message: ${errorMessage}`);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const { id, result, error } = response;
    
    if (id === null || id === undefined) {
      this.emit(JsonRpcClient.EVENTS.ERROR, new Error('Response missing ID'));
      return;
    }

    const pendingRequest = this.pendingRequests.get(id);
    if (!pendingRequest) {
      // Response for unknown request - might be from a cancelled request
      return;
    }

    this.pendingRequests.delete(id);
    clearTimeout(pendingRequest.timeout);

    if (error) {
      const err = new Error(error.message || 'JSON-RPC error');
      (err as any).code = error.code;
      (err as any).data = error.data;
      pendingRequest.reject(err);
    } else {
      pendingRequest.resolve(result);
    }
  }

  private handleRequest(request: JsonRpcRequest): void {
    this.emit(JsonRpcClient.EVENTS.REQUEST, request);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    this.emit(JsonRpcClient.EVENTS.NOTIFICATION, notification);
  }

  private handleTransportClose(): void {
    this.cancelAllRequests('Transport closed');
    this.emit(JsonRpcClient.EVENTS.CLOSE);
  }

  private sendMessage(message: JsonRpcMessage): void {
    try {
      const messageStr = JSON.stringify(message);
      this.transport.send(messageStr);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to send JSON-RPC message: ${errorMessage}`);
    }
  }

  private generateRequestId(): number {
    return ++this.requestIdCounter;
  }
}

// ==================== Utility Functions ====================

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: any
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

/**
 * Create a JSON-RPC success response
 */
export function createSuccessResponse(
  id: string | number,
  result: any
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Validate JSON-RPC message structure
 */
export function validateJsonRpcMessage(message: any): {
  valid: boolean;
  error?: string;
} {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message must be an object' };
  }

  if (message.jsonrpc !== '2.0') {
    return { valid: false, error: 'Invalid or missing jsonrpc version' };
  }

  if (isJsonRpcRequest(message)) {
    if (typeof message.method !== 'string') {
      return { valid: false, error: 'Request method must be a string' };
    }
    if (message.id === undefined) {
      return { valid: false, error: 'Request must have an id' };
    }
  } else if (isJsonRpcResponse(message)) {
    if (message.id === undefined) {
      return { valid: false, error: 'Response must have an id' };
    }
    if (!('result' in message) && !('error' in message)) {
      return { valid: false, error: 'Response must have result or error' };
    }
    if ('result' in message && 'error' in message) {
      return { valid: false, error: 'Response cannot have both result and error' };
    }
  } else if (isJsonRpcNotification(message)) {
    if (typeof message.method !== 'string') {
      return { valid: false, error: 'Notification method must be a string' };
    }
    if ('id' in message) {
      return { valid: false, error: 'Notification cannot have an id' };
    }
  } else {
    return { valid: false, error: 'Invalid message type' };
  }

  return { valid: true };
}

/**
 * Batch multiple JSON-RPC messages
 */
export function createBatchMessage(messages: JsonRpcMessage[]): string {
  if (messages.length === 0) {
    throw new Error('Batch cannot be empty');
  }
  
  if (messages.length === 1) {
    return JSON.stringify(messages[0]);
  }
  
  return JSON.stringify(messages);
}

/**
 * Parse batch JSON-RPC message
 */
export function parseBatchMessage(messageStr: string): JsonRpcMessage[] {
  const parsed = JSON.parse(messageStr);
  
  if (Array.isArray(parsed)) {
    return parsed;
  } else {
    return [parsed];
  }
}