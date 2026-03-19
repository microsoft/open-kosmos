/**
 * VSCode MCP Client - Transport Layer Interfaces
 * Defines the contract for all transport implementations
 */

import { EventEmitter } from 'events';
import { ConnectionState } from '../types/mcpTypes';

// ==================== Transport Interfaces ====================

export interface ITransport {
  readonly state: ConnectionState;
  readonly onStateChanged: (callback: (state: ConnectionState) => void) => () => void;
  readonly onMessage: (callback: (message: string) => void) => () => void;
  readonly onError: (callback: (error: Error) => void) => () => void;
  readonly onClose: (callback: () => void) => () => void;
  
  connect(): Promise<void>;
  send(message: string): void;
  close(): Promise<void>;
  dispose(): void;
}

export interface TransportConfig {
  timeout: number;
  retries: number;
  retryDelayMs: number;
  gracefulShutdownTimeoutMs: number;
}

export interface StdioTransportConfig extends TransportConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTransportConfig extends TransportConfig {
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'GET';
}

export interface SseTransportConfig extends TransportConfig {
  url: string;
  headers?: Record<string, string>;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

// ==================== Abstract Base Transport ====================

export abstract class BaseTransport extends EventEmitter implements ITransport {
  protected _state: ConnectionState = 'stopped';
  protected config: TransportConfig;
  protected isDisposed = false;

  public static readonly EVENTS = {
    STATE_CHANGED: 'stateChanged',
    MESSAGE: 'message',
    ERROR: 'error',
    CLOSE: 'close',
  } as const;

  constructor(config: TransportConfig) {
    super();
    this.config = config;
  }

  get state(): ConnectionState {
    return this._state;
  }

  protected setState(newState: ConnectionState): void {
    if (this._state !== newState) {
      const previousState = this._state;
      this._state = newState;
      this.emit(BaseTransport.EVENTS.STATE_CHANGED, newState, previousState);
    }
  }

  onStateChanged(callback: (state: ConnectionState) => void): () => void {
    this.on(BaseTransport.EVENTS.STATE_CHANGED, callback);
    return () => this.off(BaseTransport.EVENTS.STATE_CHANGED, callback);
  }

  onMessage(callback: (message: string) => void): () => void {
    this.on(BaseTransport.EVENTS.MESSAGE, callback);
    return () => this.off(BaseTransport.EVENTS.MESSAGE, callback);
  }

  onError(callback: (error: Error) => void): () => void {
    this.on(BaseTransport.EVENTS.ERROR, callback);
    return () => this.off(BaseTransport.EVENTS.ERROR, callback);
  }

  onClose(callback: () => void): () => void {
    this.on(BaseTransport.EVENTS.CLOSE, callback);
    return () => this.off(BaseTransport.EVENTS.CLOSE, callback);
  }

  abstract connect(): Promise<void>;
  abstract send(message: string): void;
  abstract close(): Promise<void>;

  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.close().catch(() => {
      // Ignore errors during disposal
    });
    this.removeAllListeners();
  }

  protected throwIfDisposed(): void {
    if (this.isDisposed) {
      throw new Error('Transport is disposed');
    }
  }
}

// ==================== Transport Factory ====================

export type TransportType = 'stdio' | 'http' | 'sse';

export interface TransportFactory {
  create(type: TransportType, config: any): ITransport;
  getSupportedTypes(): TransportType[];
}

// ==================== Transport Statistics ====================

export interface TransportStats {
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
  errors: number;
  connectionTime: number;
  lastActivity: number;
  uptime: number;
}

export abstract class StatsTrackingTransport extends BaseTransport {
  protected stats: TransportStats = {
    messagesReceived: 0,
    messagesSent: 0,
    bytesReceived: 0,
    bytesSent: 0,
    errors: 0,
    connectionTime: 0,
    lastActivity: 0,
    uptime: 0,
  };

  protected connectTime = 0;

  getStats(): TransportStats {
    return {
      ...this.stats,
      uptime: this.connectTime > 0 ? Date.now() - this.connectTime : 0,
    };
  }

  protected trackMessageReceived(message: string): void {
    this.stats.messagesReceived++;
    this.stats.bytesReceived += Buffer.byteLength(message, 'utf8');
    this.stats.lastActivity = Date.now();
  }

  protected trackMessageSent(message: string): void {
    this.stats.messagesSent++;
    this.stats.bytesSent += Buffer.byteLength(message, 'utf8');
    this.stats.lastActivity = Date.now();
  }

  protected trackError(): void {
    this.stats.errors++;
  }

  protected trackConnectionEstablished(): void {
    this.connectTime = Date.now();
    this.stats.connectionTime = this.connectTime;
  }

  protected resetStats(): void {
    this.stats = {
      messagesReceived: 0,
      messagesSent: 0,
      bytesReceived: 0,
      bytesSent: 0,
      errors: 0,
      connectionTime: 0,
      lastActivity: 0,
      uptime: 0,
    };
    this.connectTime = 0;
  }
}

// ==================== Transport Utilities ====================

export class TransportError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly transport: string
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export class ConnectionTimeoutError extends TransportError {
  constructor(transport: string, timeout: number) {
    super(`Connection timeout after ${timeout}ms`, 'CONNECTION_TIMEOUT', transport);
    this.name = 'ConnectionTimeoutError';
  }
}

export class MessageSendError extends TransportError {
  constructor(transport: string, originalError?: Error) {
    super(
      `Failed to send message: ${originalError?.message || 'Unknown error'}`,
      'MESSAGE_SEND_ERROR',
      transport
    );
    this.name = 'MessageSendError';
  }
}

export class TransportClosedError extends TransportError {
  constructor(transport: string) {
    super('Transport is closed', 'TRANSPORT_CLOSED', transport);
    this.name = 'TransportClosedError';
  }
}

// ==================== Default Configurations ====================

export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  timeout: 30000,
  retries: 3,
  retryDelayMs: 1000,
  gracefulShutdownTimeoutMs: 5000,
};

export const DEFAULT_STDIO_CONFIG: Omit<StdioTransportConfig, 'command' | 'args'> = {
  ...DEFAULT_TRANSPORT_CONFIG,
  env: {},
};

export const DEFAULT_HTTP_CONFIG: Omit<HttpTransportConfig, 'url'> = {
  ...DEFAULT_TRANSPORT_CONFIG,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  method: 'POST',
};

export const DEFAULT_SSE_CONFIG: Omit<SseTransportConfig, 'url'> = {
  ...DEFAULT_TRANSPORT_CONFIG,
  headers: {
    'Accept': 'text/event-stream',
    'Cache-Control': 'no-cache',
  },
  reconnectIntervalMs: 1000,
  maxReconnectAttempts: 5,
};