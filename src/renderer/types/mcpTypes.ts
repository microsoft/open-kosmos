export interface MCPTool {
  name: string;
  description?: string;  // Make optional to match backend consistency
  inputSchema: any;
  serverId: string;
}

export interface MCPServerState {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  tools: MCPTool[];
  lastUpdated: number;
  error?: string;
}

export interface GlobalMCPState {
  servers: MCPServerState[];
  tools: MCPTool[];
  isInitialized: boolean;
  lastUpdated: number;
}

// VSCode Import related types
export interface VSCodeMCPServerConfig {
  name: string
  type?: 'stdio' | 'http' | 'sse' | 'StreamableHttp'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  disabled?: boolean
}

export interface VSCodeConfigFormat {
  // Windows mcp.json format
  servers?: Record<string, VSCodeMCPServerConfig>
  inputs?: any[]
  
  // macOS settings.json format
  mcp?: {
    servers: Record<string, VSCodeMCPServerConfig>
  }
}

// Detection state interfaces
export interface DetectionState {
  isScanning: boolean
  detectedFiles: Array<{
    path: string
    exists: boolean
    isValid: boolean
    serverCount: number
    error?: string
  }>
}

// Import state interfaces
export interface ImportState {
  conflictResolution: 'skip' | 'rename' | 'overwrite'
  validateBeforeImport: boolean
  isImporting: boolean
  importProgress: number
  importResults?: ImportResult[]
}

export interface ImportResult {
  serverName: string
  status: 'success' | 'failed' | 'skipped' | 'renamed'
  originalName?: string
  error?: string
}

// Configuration state interfaces
export interface ConfigState {
  availableConfigs: KosmosAppMCPServerConfig[]
  selectedConfigs: Set<string>
  conflictingConfigs: Set<string>
  previewConfig?: KosmosAppMCPServerConfig
}

// Kosmos internal MCP server configuration format
export interface KosmosAppMCPServerConfig {
  name: string
  transport: 'stdio' | 'sse' | 'StreamableHttp'
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  in_use: boolean
  version?: string
}

// Import dialog state
export interface VscodeImporterState {
  isOpen: boolean
  detection: DetectionState
  config: ConfigState
  import: ImportState
  selectedFilePath?: string
}

// Transport type mapping for conversion
export interface TransportMapping {
  vscodeType?: string
  vscodeUrl?: string
  kosmosTransport: 'stdio' | 'sse' | 'StreamableHttp'
}

// Conflict resolution strategies
export type ConflictResolutionStrategy = 'skip' | 'rename' | 'overwrite'

// Import validation result
export interface ImportValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
  serverCount: number
}

// Batch import operation
export interface BatchImportOperation {
  selectedConfigs: VSCodeMCPServerConfig[]
  conflictResolution: ConflictResolutionStrategy
  validateBeforeImport: boolean
}

// Import progress tracking
export interface ImportProgress {
  total: number
  completed: number
  current?: string
  errors: ImportResult[]
}