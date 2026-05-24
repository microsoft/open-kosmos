/**
 * Configuration module entry point
 * VSCode MCP Client configuration compatibility integration
 */

// ==================== Main exports ====================

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
  convertToOpenKosmosFormat,
  isValidTransportType,
  isValidServerConfig
} from './validator';
import { isValidServerConfig } from './validator';
import { createConfigAdapter } from './ConfigAdapter';

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

// ==================== Type exports ====================

export type {
  // Core configuration types
  McpServerConfig,
  TransportType,

  // Configuration file types
  VscodeConfigFile,
  VscodeConfigDetectionResult,
  ParsedMcpConfig,
  McpConfigParseResult,

  // Validation-related types
  ConfigValidationReport,
  ValidationRuleResult,
  ImportValidationResult,

  // Platform-related types
  PlatformInfo,
  SupportedPlatform,

  // Config adapter types
  ConfigAdapterOptions,
  ConfigMigrationResult,
  ConfigDetectionState,
  ConfigAdapterEvents,

  // Compatibility types
  OpenKosmosAppMCPServerConfig,
  VSCodeMCPServerConfig,

  // Filesystem types
  FileExistsResult,
  FileReadableResult,
  FileStatsResult,
  FileContentResult,
  FileSystemResult,

  // Format types
  SupportedConfigFormat,
  SupportedTransportType
} from './types';

// ==================== Constant exports ====================

export {
  DEFAULT_CONFIG_ADAPTER_OPTIONS,
  SUPPORTED_CONFIG_FORMATS,
  SUPPORTED_TRANSPORT_TYPES,
  PLATFORM_NAMES
} from './types';
import { detectVSCodeConfigs } from "./detector";
import { parseMcpConfig } from "./parser";
import { readFileContent } from "./utils";

// ==================== Convenience functions ====================

/**
 * Quick configuration detection and parsing
 */
export async function quickConfigDetection(): Promise<{
  success: boolean;
  bestConfigPath?: string;
  parsedConfig?: any;
  errors: string[];
}> {

  try {
    const detection = await detectVSCodeConfigs();

    if (!detection.success || detection.configFiles.length === 0) {
      return {
        success: false,
        errors: [detection.error || 'No configuration file found']
      };
    }

    // Find the best configuration file
    const bestConfig = detection.configFiles.find(f =>
      f.exists && f.isValid && f.serverCount > 0
    );

    if (!bestConfig) {
      return {
        success: false,
        errors: ['No valid configuration file found']
      };
    }

    // Read and parse the configuration
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
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!isValidServerConfig(config)) {
    issues.push('Configuration format is incompatible');
    suggestions.push('Check that the configuration contains the required fields (name, transport)');
  }

  if (config.transport === 'stdio' && !config.command) {
    issues.push('stdio transport is missing the command field');
    suggestions.push('Add a command field for stdio transport');
  }

  if (config.transport !== 'stdio' && !config.url) {
    issues.push('HTTP/SSE transport is missing the URL');
    suggestions.push('Add a url field for HTTP/SSE transport');
  }

  return {
    isCompatible: issues.length === 0,
    issues,
    suggestions
  };
}

/**
 * Create a default config adapter instance
 */
export function createDefaultConfigAdapter() {
  return createConfigAdapter({
    autoDetection: true,
    strictValidation: false,
    cacheTtl: 5 * 60 * 1000
  });
}

// ==================== Module information ====================

export const CONFIG_MODULE_INFO = {
  name: 'VSCode MCP Client Configuration Module',
  version: '1.0.0',
  description: 'Configuration compatibility integration module based on existing OpenKosmos configuration components',
  features: [
    'Automatic configuration detection',
    'Multi-format configuration parsing',
    'Configuration validation and compatibility checking',
    'Configuration migration and conversion',
    'Platform-specific configuration handling',
    'Intelligent cache management'
  ],
  supportedPlatforms: ['macOS', 'Windows', 'Linux'],
  supportedFormats: ['settings.json', 'mcp.json', 'openkosmos.json']
} as const;