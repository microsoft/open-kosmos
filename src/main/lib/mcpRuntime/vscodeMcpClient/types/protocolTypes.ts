/**
 * VSCode MCP Client - JSON-RPC and MCP Protocol Types
 * Complete MCP protocol implementation based on the official specification
 */

// ==================== JSON-RPC 2.0 Base Types ====================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ==================== JSON-RPC Error Codes ====================

export const JSON_RPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SERVER_ERROR_START: -32000,
  SERVER_ERROR_END: -32099,
} as const;

// ==================== MCP Protocol Methods ====================

export const MCP_METHODS = {
  // Client to Server
  INITIALIZE: 'initialize',
  PING: 'ping',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  RESOURCES_LIST: 'resources/list',
  RESOURCES_READ: 'resources/read',
  RESOURCES_SUBSCRIBE: 'resources/subscribe',
  RESOURCES_UNSUBSCRIBE: 'resources/unsubscribe',
  PROMPTS_LIST: 'prompts/list',
  PROMPTS_GET: 'prompts/get',
  LOGGING_SET_LEVEL: 'logging/setLevel',
  
  // Server to Client
  NOTIFICATIONS_INITIALIZED: 'notifications/initialized',
  NOTIFICATIONS_CANCELLED: 'notifications/cancelled',
  NOTIFICATIONS_PROGRESS: 'notifications/progress',
  NOTIFICATIONS_MESSAGE: 'notifications/message',
  NOTIFICATIONS_RESOURCES_UPDATED: 'notifications/resources/updated',
  NOTIFICATIONS_RESOURCES_LIST_CHANGED: 'notifications/resources/list_changed',
  NOTIFICATIONS_TOOLS_LIST_CHANGED: 'notifications/tools/list_changed',
  NOTIFICATIONS_PROMPTS_LIST_CHANGED: 'notifications/prompts/list_changed',
  
  // Bidirectional
  ROOTS_LIST: 'roots/list',
  SAMPLING_CREATE: 'sampling/create',
} as const;

// ==================== MCP Protocol Request/Response Types ====================

// Initialize
export interface InitializeRequest {
  protocolVersion: string;
  capabilities: ClientCapabilities;
  clientInfo: {
    name: string;
    version: string;
  };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: ServerCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
  instructions?: string;
}

export interface ClientCapabilities {
  experimental?: Record<string, any>;
  sampling?: Record<string, any>;
}

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

// Tools
export interface ToolsListRequest {
  cursor?: string;
}

export interface ToolsListResult {
  tools: Tool[];
  nextCursor?: string;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema: any; // JSON Schema
}

export interface ToolsCallRequest {
  name: string;
  arguments?: Record<string, any>;
}

export interface ToolsCallResult {
  content: Content[];
  isError?: boolean;
  _meta?: Record<string, any>;
}

// Resources
export interface ResourcesListRequest {
  cursor?: string;
}

export interface ResourcesListResult {
  resources: Resource[];
  nextCursor?: string;
}

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourcesReadRequest {
  uri: string;
}

export interface ResourcesReadResult {
  contents: ResourceContents[];
}

export interface ResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64 encoded
}

export interface ResourcesSubscribeRequest {
  uri: string;
}

export interface ResourcesUnsubscribeRequest {
  uri: string;
}

// Prompts
export interface PromptsListRequest {
  cursor?: string;
}

export interface PromptsListResult {
  prompts: Prompt[];
  nextCursor?: string;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptsGetRequest {
  name: string;
  arguments?: Record<string, any>;
}

export interface PromptsGetResult {
  description?: string;
  messages: PromptMessage[];
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: Content;
}

// Content Types
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string; // base64 encoded
  mimeType: string;
}

export interface ResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    text?: string;
    blob?: string; // base64 encoded
    mimeType?: string;
  };
}

export type Content = TextContent | ImageContent | ResourceContent;

// Notifications
export interface ProgressNotification {
  progressToken: string | number;
  progress?: number;
  total?: number;
}

export interface CancelledNotification {
  requestId: string | number;
  reason?: string;
}

export interface LoggingMessageNotification {
  level: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
  data?: any;
  logger?: string;
}

export interface ResourceUpdatedNotification {
  uri: string;
}

export interface ResourcesListChangedNotification {
  // No additional data
}

export interface ToolsListChangedNotification {
  // No additional data
}

export interface PromptsListChangedNotification {
  // No additional data
}

// Ping
export interface PingRequest {
  // No additional data required
}

export interface PingResult {
  // Implementation-specific data
  [key: string]: any;
}

// Roots
export interface RootsListRequest {
  // No additional data
}

export interface RootsListResult {
  roots: Root[];
}

export interface Root {
  uri: string;
  name?: string;
}

// Logging
export interface LoggingSetLevelRequest {
  level: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
}

// Sampling
export interface SamplingCreateRequest {
  method: string;
  params?: any;
}

export interface SamplingCreateResult {
  // Implementation-specific
  [key: string]: any;
}

// ==================== Request/Response Mapping ====================

export interface McpRequestResponseMap {
  [MCP_METHODS.INITIALIZE]: [InitializeRequest, InitializeResult];
  [MCP_METHODS.PING]: [PingRequest, PingResult];
  [MCP_METHODS.TOOLS_LIST]: [ToolsListRequest, ToolsListResult];
  [MCP_METHODS.TOOLS_CALL]: [ToolsCallRequest, ToolsCallResult];
  [MCP_METHODS.RESOURCES_LIST]: [ResourcesListRequest, ResourcesListResult];
  [MCP_METHODS.RESOURCES_READ]: [ResourcesReadRequest, ResourcesReadResult];
  [MCP_METHODS.RESOURCES_SUBSCRIBE]: [ResourcesSubscribeRequest, void];
  [MCP_METHODS.RESOURCES_UNSUBSCRIBE]: [ResourcesUnsubscribeRequest, void];
  [MCP_METHODS.PROMPTS_LIST]: [PromptsListRequest, PromptsListResult];
  [MCP_METHODS.PROMPTS_GET]: [PromptsGetRequest, PromptsGetResult];
  [MCP_METHODS.LOGGING_SET_LEVEL]: [LoggingSetLevelRequest, void];
  [MCP_METHODS.ROOTS_LIST]: [RootsListRequest, RootsListResult];
  [MCP_METHODS.SAMPLING_CREATE]: [SamplingCreateRequest, SamplingCreateResult];
}

// ==================== Type Helpers ====================

export type McpMethod = keyof McpRequestResponseMap;
export type McpRequestType<T extends McpMethod> = McpRequestResponseMap[T][0];
export type McpResponseType<T extends McpMethod> = McpRequestResponseMap[T][1];

// ==================== Protocol Constants ====================

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export const MCP_CLIENT_INFO = {
  name: 'KosmosMcpClient',
  version: '2.0.0',
} as const;

// ==================== Validation Schemas ====================

export interface ValidationSchema {
  type: string;
  properties?: Record<string, ValidationSchema>;
  required?: string[];
  items?: ValidationSchema;
  additionalProperties?: boolean;
}

export const MCP_SCHEMAS: Record<string, ValidationSchema> = {
  InitializeRequest: {
    type: 'object',
    properties: {
      protocolVersion: { type: 'string' },
      capabilities: { type: 'object' },
      clientInfo: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
        },
        required: ['name', 'version'],
      },
    },
    required: ['protocolVersion', 'capabilities', 'clientInfo'],
  },
  
  ToolsCallRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      arguments: { type: 'object' },
    },
    required: ['name'],
  },
  
  ResourcesReadRequest: {
    type: 'object',
    properties: {
      uri: { type: 'string' },
    },
    required: ['uri'],
  },
  
  PromptsGetRequest: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      arguments: { type: 'object' },
    },
    required: ['name'],
  },
};

// ==================== Error Helpers ====================

export function createJsonRpcError(
  code: number,
  message: string,
  data?: any
): JsonRpcError {
  return { code, message, data };
}

export function createMethodNotFoundError(method: string): JsonRpcError {
  return createJsonRpcError(
    JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
    `Method not found: ${method}`
  );
}

export function createInvalidParamsError(details?: string): JsonRpcError {
  return createJsonRpcError(
    JSON_RPC_ERROR_CODES.INVALID_PARAMS,
    `Invalid params${details ? `: ${details}` : ''}`
  );
}

export function createInternalError(details?: string): JsonRpcError {
  return createJsonRpcError(
    JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
    `Internal error${details ? `: ${details}` : ''}`
  );
}

// ==================== Type Guards ====================

export function isJsonRpcRequest(message: any): message is JsonRpcRequest {
  return message && 
    message.jsonrpc === '2.0' && 
    typeof message.method === 'string' &&
    ('id' in message);
}

export function isJsonRpcResponse(message: any): message is JsonRpcResponse {
  return message && 
    message.jsonrpc === '2.0' && 
    ('result' in message || 'error' in message) &&
    ('id' in message);
}

export function isJsonRpcNotification(message: any): message is JsonRpcNotification {
  return message && 
    message.jsonrpc === '2.0' && 
    typeof message.method === 'string' &&
    !('id' in message);
}

export function isJsonRpcMessage(message: any): message is JsonRpcMessage {
  return isJsonRpcRequest(message) || 
    isJsonRpcResponse(message) || 
    isJsonRpcNotification(message);
}

export function isMcpMethod(method: string): method is McpMethod {
  return Object.values(MCP_METHODS).includes(method as any);
}