/**
 * VSCode MCP Client - Main Export Index
 * Exports all public types and classes for the VSCode MCP Client implementation
 */

// Core types - explicit exports to avoid conflicts
export type {
  McpServerDefinition,
  McpCollectionDefinition,
  McpTransportType,
  ConnectionState,
  ServerCapabilities,
  McpTool,
  McpResource,
  McpPrompt,
  ToolCallOptions,
  ToolCallRequest,
  ToolCallResult,
  ResourceRequest,
  PromptRequest,
  PromptResult,
  ProgressToken,
  CancelRequest,
  ServerStartOptions,
  ConnectionConfig,
  ServerStateChangedEvent,
  ToolsChangedEvent,
  ResourcesChangedEvent,
  PromptsChangedEvent,
  McpError,
  ConnectionError,
  TimeoutError,
  ValidationError,
  McpServerRuntimeState,
  CacheEntry,
  CacheStats,
  Observable,
  Event,
  ProgressCallback,
  DEFAULT_CONNECTION_CONFIG,
  DEFAULT_SERVER_START_OPTIONS,
} from './types/mcpTypes';

export type {
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  InitializeRequest,
  InitializeResult,
  ClientCapabilities,
  ToolsListRequest,
  ToolsListResult,
  Tool,
  ToolsCallRequest,
  ToolsCallResult,
  ResourcesListRequest,
  ResourcesListResult,
  Resource,
  ResourcesReadRequest,
  ResourcesReadResult,
  ResourceContents,
  PromptsListRequest,
  PromptsListResult,
  Prompt,
  PromptArgument,
  PromptsGetRequest,
  PromptsGetResult,
  PromptMessage,
  Content,
  TextContent,
  ImageContent,
  ResourceContent,
  ProgressNotification,
  CancelledNotification,
  LoggingMessageNotification,
  PingRequest,
  PingResult,
  McpRequestResponseMap,
  McpMethod,
  McpRequestType,
  McpResponseType,
  ValidationSchema,
  MCP_METHODS,
  MCP_PROTOCOL_VERSION,
  MCP_CLIENT_INFO,
  JSON_RPC_ERROR_CODES,
} from './types/protocolTypes';

// Core implementations
export * from './core/JsonRpc';

// VSCode Transport layer (New Standard Implementation)
export { VscodeTransportFactory, createVscodeTransport } from './transport/VscodeTransportFactory';
export { VscodeStdioTransport } from './transport/VscodeStdioTransport';
export { VscodeHttpTransport } from './transport/VscodeHttpTransport';
export type {
  VscodeTransport,
  VscodeTransportConfig,
  TransportType as VscodeTransportType
} from './transport/VscodeTransportFactory';
export type {
  StdioTransportConfig as VscodeStdioTransportConfig
} from './transport/VscodeStdioTransport';
export type {
  HttpTransportConfig as VscodeHttpTransportConfig
} from './transport/VscodeHttpTransport';

// Transport Adapters
export { VscodeToJsonRpcTransportAdapter } from './adapters/VscodeToJsonRpcTransportAdapter';

// Core JSON-RPC Implementation
export { JsonRpcClient } from './core/JsonRpc';

// Connection Management
export { McpConnection } from './connection/McpConnection';
export { McpRequestHandler } from './connection/McpRequestHandler';

// Legacy Transport Interfaces (for backward compatibility)
export type {
  ITransport,
  TransportConfig,
  StdioTransportConfig,
  SseTransportConfig,
  HttpTransportConfig,
} from './transport/ITransport';

// Cache and Service Management
export { CacheManager } from './cache/CacheManager';
export type { CacheConfig, CacheKey } from './cache/CacheManager';
export { ServiceRegistry } from './registry/ServiceRegistry';
export type {
  ServiceRegistryConfig,
  RegisteredService,
  ServiceQuery,
  ServiceDiscoveryProvider,
  ServiceMetadata,
  ServiceHealth
} from './registry/ServiceRegistry';
export { ServiceManager } from './services/ServiceManager';
export type {
  ServiceManagerConfig,
  ServicePerformanceReport
} from './services/ServiceManager';

// Tool Management
export { ToolManager } from './tools/ToolManager';
export type {
  ToolManagerConfig,
  ToolMetadata,
  ToolPermissions,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolAuditEntry
} from './tools/ToolManager';

// Resource Management
export { ResourceManager } from './resources/ResourceManager';
export type {
  ResourceManagerConfig,
  ResourceMetadata,
  ResourcePermissions,
  ResourceCacheEntry,
  ResourceOperation,
  BulkOperation
} from './resources/ResourceManager';

// Main client class
export { VscodeMcpClient } from './VscodeMcpClient';
export type { VscodeMcpServerConfig } from './VscodeMcpClient';

// Configuration Compatibility Integration - explicit exports to avoid conflicts
export { ConfigAdapter, createConfigAdapter, defaultConfigAdapter } from './config/ConfigAdapter';
export {
  detectVSCodeConfigs,
  detectVscodeConfigFile,
  detectSingleConfigFile,
  detectCustomConfigFile,
  getPlatformDetectionInfo,
  isValidMcpConfig,
  getConfigQualityScore,
  getDetectionSummary
} from './config/detector';
export {
  parseMcpConfig,
  parseVSCodeConfigToInternal,
  formatToStandardJson,
  formatToMcpServersWrapper,
  formatToVSCodeSettings,
  formatToVSCodeMcpJson,
  isExampleConfiguration
} from './config/parser';
export {
  validateMcpServerConfig,
  validateBatchImport,
  validateVSCodeConfigBeforeImport,
  validateVSCodeConfig,
  getValidationSummary,
  suggestConfigFixes,
  convertToKosmosFormat,
  isValidTransportType,
  isValidServerConfig
} from './config/validator';
export { quickConfigDetection, checkConfigCompatibility, createDefaultConfigAdapter } from './config';

// Configuration types - with aliases to avoid conflicts
export type {
  McpServerConfig as ConfigMcpServerConfig,
  TransportType as ConfigTransportType,
  VscodeConfigFile,
  VscodeConfigDetectionResult,
  ParsedMcpConfig,
  McpConfigParseResult,
  ConfigValidationReport,
  ValidationRuleResult,
  ImportValidationResult,
  PlatformInfo as ConfigPlatformInfo,
  ConfigAdapterOptions,
  ConfigMigrationResult,
  ConfigDetectionState,
  ConfigAdapterEvents,
  KosmosAppMCPServerConfig,
  VSCodeMCPServerConfig,
  SupportedConfigFormat,
  SupportedTransportType as ConfigSupportedTransportType
} from './config/types';

// Legacy compatibility export
export { VscodeMcpClient as MCPClient } from './VscodeMcpClient';

// ==================== Enhanced Factory Functions ====================

/**
 * Create a VSCode MCP Client with automatic configuration detection
 */
export async function createAutoConfiguredMcpClient() {
  const { quickConfigDetection, createDefaultConfigAdapter } = await import('./config');
  const { VscodeMcpClient } = await import('./VscodeMcpClient');
  
  // Try to auto-detect configuration
  const detection = await quickConfigDetection();
  
  if (detection.success && detection.parsedConfig) {
    
    const configAdapter = createDefaultConfigAdapter();
    
    return {
      client: new VscodeMcpClient({
        name: 'auto-detected-server',
        type: 'stdio' as const
      }),
      configAdapter,
      detectedConfig: detection.parsedConfig,
      configPath: detection.bestConfigPath
    };
  } else {
    return {
      client: new VscodeMcpClient({
        name: 'default-server',
        type: 'stdio' as const
      }),
      configAdapter: createDefaultConfigAdapter(),
      detectedConfig: null,
      configPath: null
    };
  }
}

// ==================== Module Information ====================
export const VSCODE_MCP_CLIENT_VERSION = '1.0.0';
export const VSCODE_MCP_CLIENT_NAME = 'VSCode MCP Client';

export const MODULE_INFO = {
  name: VSCODE_MCP_CLIENT_NAME,
  version: VSCODE_MCP_CLIENT_VERSION,
  description: 'Enterprise-grade MCP client implementation for VSCode integration',
  features: [
    'Zero external dependencies',
    'Enterprise-grade architecture',
    'Intelligent caching system',
    'Service discovery and management',
    'Advanced transport layer',
    'Tool and resource management',
    'Configuration compatibility integration',
    'Auto-configuration detection',
    '100% backward compatibility'
  ],
  compatibility: {
    node: '>=16.0.0',
    platforms: ['win32', 'darwin', 'linux'],
    mcpVersion: '1.0.0'
  },
  configSupport: {
    formats: ['settings.json', 'mcp.json', 'kosmos.json'],
    platforms: ['macOS', 'Windows', 'Linux'],
    autoDetection: true,
    migration: true
  }
} as const;