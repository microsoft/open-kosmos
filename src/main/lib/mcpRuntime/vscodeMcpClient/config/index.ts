/**
 * Configuration Module Entry
 * VSCode MCP Client configuration compatibility integration
 */

// ==================== Main Exports ====================

// Configuration adapter
export { ConfigAdapter, createConfigAdapter, defaultConfigAdapter } from './ConfigAdapter';

// Configuration detector
export { 
  detectVSCodeConfigs,
  detectVscodeConfigFile,
  detectSingleConfigFile,
  detectCustomConfigFile,
  getPlatformDetectionInfo,
  isValidMcpConfig,
  getConfigQualityScore,
  getDetectionSummary
} from './detector';

// Configuration parser
export { 
  parseMcpConfig,
  parseVSCodeConfigToInternal,
  formatToStandardJson,
  formatToMcpServersWrapper,
  formatToVSCodeSettings,
  formatToVSCodeMcpJson,
  isExampleConfiguration
} from './parser';

// Configuration validator
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
} from './validator';

// Utility functions
export { 
  checkFileExists,
  checkFileReadable,
  readFileContent,
  getFileStats,
  expandPath,
  getCurrentPlatform,
  isPlatformSupported,
  getVSCodeConfigPaths,
  getPlatformInfo,
  detectConfigFormat,
  validateJsonFormat,
  safeJsonStringify,
  safeJsonParse,
  generateCacheKey,
  isCacheExpired
} from './utils';

// ==================== Type Exports ====================

export type {
  // Core configuration types
  McpServerConfig,
  TransportType,
  
  // Configuration file types
  VscodeConfigFile,
  VscodeConfigDetectionResult,
  ParsedMcpConfig,
  McpConfigParseResult,
  
  // Validation related types
  ConfigValidationReport,
  ValidationRuleResult,
  ImportValidationResult,
  
  // Platform related types
  PlatformInfo,
  SupportedPlatform,
  
  // Configuration adapter types
  ConfigAdapterOptions,
  ConfigMigrationResult,
  ConfigDetectionState,
  ConfigAdapterEvents,
  
  // Compatibility types
  KosmosAppMCPServerConfig,
  VSCodeMCPServerConfig,
  
  // File system types
  FileExistsResult,
  FileReadableResult,
  FileStatsResult,
  FileContentResult,
  FileSystemResult,
  
  // Format types
  SupportedConfigFormat,
  SupportedTransportType
} from './types';

// ==================== Constant Exports ====================

export {
  DEFAULT_CONFIG_ADAPTER_OPTIONS,
  SUPPORTED_CONFIG_FORMATS,
  SUPPORTED_TRANSPORT_TYPES,
  PLATFORM_NAMES
} from './types';

// ==================== Convenience Functions ====================

/**
 * Quick configuration detection and parsing
 */
export async function quickConfigDetection(): Promise<{
  success: boolean;
  bestConfigPath?: string;
  parsedConfig?: any;
  errors: string[];
}> {
  const { detectVSCodeConfigs } = await import('./detector');
  const { parseMcpConfig } = await import('./parser');
  const { readFileContent } = await import('./utils');
  
  try {
    const detection = await detectVSCodeConfigs();
    
    if (!detection.success || detection.configFiles.length === 0) {
      return {
        success: false,
        errors: [detection.error || 'No configuration files found']
      };
    }
    
    // Find the best configuration file
    const bestConfig = detection.configFiles.find(f => 
      f.exists && f.isValid && f.serverCount > 0
    );
    
    if (!bestConfig) {
      return {
        success: false,
        errors: ['No valid configuration files found']
      };
    }
    
    // Read and parse configuration
    const content = await readFileContent(bestConfig.expandedPath);
    if (!content.success) {
      return {
        success: false,
        errors: [content.error || 'Failed to read configuration file']
      };
    }
    
    const parseResult = parseMcpConfig(content.content!);
    if (!parseResult.success) {
      return {
        success: false,
        errors: [parseResult.error || 'Failed to parse configuration']
      };
    }
    
    return {
      success: true,
      bestConfigPath: bestConfig.expandedPath,
      parsedConfig: parseResult.data,
      errors: []
    };
    
  } catch (error) {
    return {
      success: false,
      errors: [`Quick detection failed: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Configuration compatibility check
 */
export function checkConfigCompatibility(config: any): {
  isCompatible: boolean;
  issues: string[];
  suggestions: string[];
} {
  const { isValidServerConfig } = require('./validator');
  
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  if (!isValidServerConfig(config)) {
    issues.push('Configuration format is incompatible');
    suggestions.push('Check if configuration contains required fields (name, transport)');
  }
  
  if (config.transport === 'stdio' && !config.command) {
    issues.push('stdio transport is missing command');
    suggestions.push('Add command field for stdio transport');
  }
  
  if (config.transport !== 'stdio' && !config.url) {
    issues.push('HTTP/SSE transport is missing URL');
    suggestions.push('Add url field for HTTP/SSE transport');
  }
  
  return {
    isCompatible: issues.length === 0,
    issues,
    suggestions
  };
}

/**
 * Create a default configuration adapter instance
 */
export function createDefaultConfigAdapter() {
  const { createConfigAdapter } = require('./ConfigAdapter');
  return createConfigAdapter({
    autoDetection: true,
    strictValidation: false,
    cacheTtl: 5 * 60 * 1000
  });
}

// ==================== Module Information ====================

export const CONFIG_MODULE_INFO = {
  name: 'VSCode MCP Client Configuration Module',
  version: '1.0.0',
  description: 'Configuration compatibility integration module based on existing Kosmos configuration components',
  features: [
    'Automatic configuration detection',
    'Multi-format configuration parsing',
    'Configuration validation and compatibility checking',
    'Configuration migration and conversion',
    'Platform-specific configuration handling',
    'Intelligent cache management'
  ],
  supportedPlatforms: ['macOS', 'Windows', 'Linux'],
  supportedFormats: ['settings.json', 'mcp.json', 'kosmos.json']
} as const;