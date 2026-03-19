/**
 * VSCode MCP Client - Core MCP Protocol Types
 * Based on VSCode's enterprise-grade MCP implementation
 */

// ==================== Core MCP Protocol Types ====================

export interface McpServerDefinition {
  name: string;
  transport: McpTransportType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  workingDirectory?: string;
  disabled?: boolean;
  trusted?: boolean;
}

export interface McpCollectionDefinition {
  name: string;
  description?: string;
  servers: McpServerDefinition[];
  enabled: boolean;
}

export type McpTransportType = 'stdio' | 'http' | 'sse';

export type ConnectionState = 
  | 'stopped' 
  | 'starting' 
  | 'running' 
  | 'error' 
  | 'disconnecting';

// ==================== Server Capabilities ====================

export interface ServerCapabilities {
  experimental?: Record<string, any>;
  logging?: Record<string, any>;
  prompts?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  tools?: {
    listChanged?: boolean;
  };
}

// ==================== Tools ====================

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any; // JSON Schema
}

export interface ToolCallOptions {
  timeout?: number;
  onProgress?: (data: ProgressToken) => void;
  signal?: AbortSignal;
}

export interface ToolCallRequest {
  name: string;
  arguments?: Record<string, any>;
}

export interface ToolCallResult {
  content: any;
  isError?: boolean;
  meta?: Record<string, any>;
}

// ==================== Resources ====================

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceRequest {
  uri: string;
}

export interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: Uint8Array;
}

// ==================== Prompts ====================

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptRequest {
  name: string;
  arguments?: Record<string, any>;
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  };
}

export interface PromptResult {
  description?: string;
  messages: PromptMessage[];
}

// ==================== Progress and Cancellation ====================

export interface ProgressToken {
  progressToken: string | number;
  progress?: number;
  total?: number;
  message?: string;
}

export interface CancelRequest {
  requestId: string | number;
}

// ==================== Configuration ====================

export interface ServerStartOptions {
  timeout?: number;
  retries?: number;
  backoffMs?: number;
  env?: Record<string, string>;
  cwd?: string;
  signal?: AbortSignal;
}

export interface ConnectionConfig {
  timeout: number;
  retries: number;
  retryDelayMs: number;
  healthCheckIntervalMs: number;
  gracefulShutdownTimeoutMs: number;
}

// ==================== Events and Observables ====================

export interface ServerStateChangedEvent {
  serverId: string;
  previousState: ConnectionState;
  currentState: ConnectionState;
  error?: Error;
  timestamp: number;
}

export interface ToolsChangedEvent {
  serverId: string;
  tools: McpTool[];
  timestamp: number;
}

export interface ResourcesChangedEvent {
  serverId: string;
  resources: McpResource[];
  timestamp: number;
}

export interface PromptsChangedEvent {
  serverId: string;
  prompts: McpPrompt[];
  timestamp: number;
}

// ==================== Error Types ====================

export class McpError extends Error {
  public readonly code: number;
  public readonly data?: any;

  constructor(message: string, code: number, data?: any) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.data = data;
  }
}

export class ConnectionError extends McpError {
  constructor(message: string, data?: any) {
    super(message, -32000, data);
    this.name = 'ConnectionError';
  }
}

export class TimeoutError extends McpError {
  constructor(message: string, data?: any) {
    super(message, -32001, data);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends McpError {
  constructor(message: string, data?: any) {
    super(message, -32002, data);
    this.name = 'ValidationError';
  }
}

export class TransportError extends McpError {
  constructor(message: string, data?: any) {
    super(message, -32003, data);
    this.name = 'TransportError';
  }
}

export class ProtocolError extends McpError {
  constructor(message: string, data?: any) {
    super(message, -32004, data);
    this.name = 'ProtocolError';
  }
}

// ==================== Server Runtime State ====================

export interface McpServerRuntimeState {
  serverId: string;
  state: ConnectionState;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  capabilities: ServerCapabilities;
  error?: Error;
  startTime?: number;
  lastActivityTime?: number;
  stats: {
    toolCalls: number;
    resourceReads: number;
    promptCalls: number;
    errors: number;
  };
}

// ==================== Cache Types ====================

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  nonce?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  memoryUsage: number;
}

// ==================== Type Guards ====================

export function isMcpTool(obj: any): obj is McpTool {
  return obj && 
    typeof obj.name === 'string' && 
    obj.inputSchema !== undefined;
}

export function isMcpResource(obj: any): obj is McpResource {
  return obj && 
    typeof obj.uri === 'string' && 
    typeof obj.name === 'string';
}

export function isMcpPrompt(obj: any): obj is McpPrompt {
  return obj && 
    typeof obj.name === 'string';
}

export function isConnectionState(state: string): state is ConnectionState {
  return ['stopped', 'starting', 'running', 'error', 'disconnecting'].includes(state);
}

export function isTransportType(type: string): type is McpTransportType {
  return ['stdio', 'http', 'sse'].includes(type);
}

// ==================== Utility Types ====================

export type Observable<T> = {
  readonly value: T;
  subscribe(callback: (value: T) => void): () => void;
  dispose(): void;
};

export type Event<T> = {
  (listener: (event: T) => void): () => void;
};

export type ProgressCallback = (progress: ProgressToken) => void;

// ==================== Defaults ====================

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfig = {
  timeout: 30000,
  retries: 3,
  retryDelayMs: 1000,
  healthCheckIntervalMs: 30000,
  gracefulShutdownTimeoutMs: 5000,
};

export const DEFAULT_SERVER_START_OPTIONS: ServerStartOptions = {
  timeout: 10000,
  retries: 3,
  backoffMs: 1000,
};