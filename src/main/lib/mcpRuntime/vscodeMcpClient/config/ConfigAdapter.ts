/**
 * Configuration Adapter - VSCode MCP Client
 * Configuration compatibility integration based on existing Kosmos configuration components
 * Provides configuration detection, parsing, validation, and migration functionality
 */

import { EventEmitter } from 'events';

// Import local configuration modules
import {
  detectVSCodeConfigs,
  detectVscodeConfigFile,
  detectSingleConfigFile,
  detectCustomConfigFile
} from './detector';

import {
  parseMcpConfig,
  parseVSCodeConfigToInternal,
  formatToVSCodeSettings,
  formatToVSCodeMcpJson
} from './parser';

import {
  validateMcpServerConfig,
  validateBatchImport,
  validateVSCodeConfigBeforeImport
} from './validator';

import {
  getPlatformInfo,
  getVSCodeConfigPaths
} from './utils';

import {
  McpServerConfig,
  TransportType,
  VscodeConfigFile,
  VscodeConfigDetectionResult,
  ParsedMcpConfig,
  McpConfigParseResult,
  ConfigValidationReport,
  ValidationRuleResult,
  PlatformInfo,
  ConfigAdapterOptions,
  ConfigMigrationResult,
  ConfigDetectionState,
  ConfigAdapterEvents
} from './types';

/**
 * VSCode MCP Client Configuration Adapter
 * 
 * Provides seamless integration with existing Kosmos configuration components:
 * - Automatic configuration detection and discovery
 * - Multi-format configuration parsing
 * - Configuration validation and compatibility checking
 * - Configuration migration and conversion
 * - Platform-specific configuration handling
 */
export class ConfigAdapter extends EventEmitter {
  private options: Required<ConfigAdapterOptions>;
  private detectionState: ConfigDetectionState;
  private configCache = new Map<string, { config: ParsedMcpConfig; timestamp: number }>();

  constructor(options: ConfigAdapterOptions = {}) {
    super();
    
    this.options = {
      autoDetection: true,
      strictValidation: false,
      supportedPlatforms: ['macOS', 'Windows', 'Linux'],
      customConfigPaths: [],
      cacheTtl: 5 * 60 * 1000, // 5 minutes
      ...options
    };

    // Initialize detection state
    const platformInfo = getPlatformInfo();
    this.detectionState = {
      isDetecting: false,
      detectedConfigs: [],
      platformInfo,
      supportedFormats: this.getSupportedFormats(platformInfo.platform)
    };

    // If auto-detection is enabled, start detection immediately
    if (this.options.autoDetection) {
      this.startAutoDetection();
    }
  }

  /**
   * Start automatic configuration detection
   */
  public async startAutoDetection(): Promise<VscodeConfigDetectionResult> {
    if (this.detectionState.isDetecting) {
      throw new Error('Configuration detection is already in progress');
    }

    this.detectionState.isDetecting = true;
    this.detectionState.lastDetection = new Date();
    this.emit('detection-started');

    try {
      const result = await detectVSCodeConfigs();
      
      this.detectionState.detectedConfigs = result.configFiles;
      this.detectionState.isDetecting = false;
      
      this.emit('detection-completed', result);
      return result;
    } catch (error) {
      this.detectionState.isDetecting = false;
      const err = error instanceof Error ? error : new Error('Detection failed');
      this.emit('detection-failed', err);
      throw err;
    }
  }

  /**
   * Detect a specific configuration file
   */
  public async detectConfigFile(filePath: string): Promise<VscodeConfigFile> {
    try {
      return await detectCustomConfigFile(filePath);
    } catch (error) {
      throw new Error(`Configuration file detection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the first valid configuration file path
   */
  public async getFirstValidConfigPath(): Promise<string | null> {
    try {
      return await detectVscodeConfigFile();
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse configuration content
   */
  public parseConfig(
    content: string, 
    format?: 'settings.json' | 'mcp.json' | 'auto',
    currentTransport?: TransportType
  ): McpConfigParseResult {
    // Check cache
    const cacheKey = this.generateCacheKey(content, format);
    const cached = this.configCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.options.cacheTtl) {
      return { success: true, data: cached.config };
    }

    try {
      let result: McpConfigParseResult;

      if (format === 'settings.json' || format === 'mcp.json') {
        // Use VSCode format parser
        result = parseVSCodeConfigToInternal(content, format);
      } else {
        // Use generic format parser
        result = parseMcpConfig(content, currentTransport);
      }

      // Cache successfully parsed results
      if (result.success && result.data) {
        this.configCache.set(cacheKey, {
          config: result.data,
          timestamp: Date.now()
        });
      }

      return result;
    } catch (error) {
      return {
        success: false,
        error: `Configuration parsing failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Validate configuration
   */
  public validateConfig(config: McpServerConfig): ConfigValidationReport {
    try {
      // Convert to Kosmos format
      const kosmosConfig = this.convertToKosmosFormat(config);
      const report = validateMcpServerConfig(kosmosConfig);
      
      this.emit('config-validated', report);
      return report;
    } catch (error) {
      const errorReport: ConfigValidationReport = {
        serverName: config.name,
        isValid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
        info: [],
        score: 0
      };
      
      this.emit('config-validated', errorReport);
      return errorReport;
    }
  }

  /**
   * Batch validate configurations
   */
  public validateBatchConfigs(configs: McpServerConfig[]) {
    try {
      const kosmosConfigs = configs.map(config => this.convertToKosmosFormat(config));
      return validateBatchImport(kosmosConfigs);
    } catch (error) {
      return {
        isValid: false,
        errors: [`Batch validation failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
        serverCount: configs.length
      };
    }
  }

  /**
   * Migrate configurations to the specified format
   */
  public async migrateConfigs(
    sourceConfigs: McpServerConfig[],
    targetFormat: 'vscode-settings' | 'vscode-mcp' | 'kosmos'
  ): Promise<ConfigMigrationResult> {
    const migratedConfigs: McpServerConfig[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    let skippedConfigs = 0;

    try {
      for (const config of sourceConfigs) {
        try {
          // Validate source configuration
          const validation = this.validateConfig(config);
          
          if (!validation.isValid && this.options.strictValidation) {
            errors.push(`Skipping invalid configuration "${config.name}": ${validation.errors.join(', ')}`);
            skippedConfigs++;
            continue;
          }

          // Add warnings
          warnings.push(...validation.warnings);

          // Convert configuration
          const migratedConfig = await this.convertConfigFormat(config, targetFormat);
          migratedConfigs.push(migratedConfig);
          
        } catch (error) {
          errors.push(`Configuration "${config.name}" migration failed: ${error instanceof Error ? error.message : String(error)}`);
          skippedConfigs++;
        }
      }

      const result: ConfigMigrationResult = {
        success: errors.length === 0 || !this.options.strictValidation,
        migratedConfigs,
        errors,
        warnings,
        skippedConfigs,
        originalFormat: 'mcp-client',
        targetFormat
      };

      this.emit('config-migrated', result);
      return result;
      
    } catch (error) {
      const result: ConfigMigrationResult = {
        success: false,
        migratedConfigs: [],
        errors: [`Migration process failed: ${error instanceof Error ? error.message : String(error)}`],
        warnings: [],
        skippedConfigs: sourceConfigs.length,
        originalFormat: 'mcp-client',
        targetFormat
      };

      this.emit('config-migrated', result);
      return result;
    }
  }

  /**
   * Export configuration to VSCode format
   */
  public exportToVSCodeFormat(
    configs: McpServerConfig[],
    format: 'settings.json' | 'mcp.json'
  ): string {
    try {
      const kosmosConfigs = configs.map(config => this.convertToKosmosFormat(config));
      
      if (format === 'settings.json') {
        return formatToVSCodeSettings(kosmosConfigs);
      } else {
        return formatToVSCodeMcpJson(kosmosConfigs);
      }
    } catch (error) {
      throw new Error(`Failed to export VSCode format: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get platform information
   */
  public getPlatformInfo(): PlatformInfo {
    return this.detectionState.platformInfo;
  }

  /**
   * Get configuration detection state
   */
  public getDetectionState(): ConfigDetectionState {
    return { ...this.detectionState };
  }

  /**
   * Clear configuration cache
   */
  public clearCache(): void {
    this.configCache.clear();
  }

  /**
   * Update configuration options
   */
  public updateOptions(newOptions: Partial<ConfigAdapterOptions>): void {
    this.options = { ...this.options, ...newOptions };
    
    // If platform support has changed, update detection state
    if (newOptions.supportedPlatforms) {
      this.detectionState.supportedFormats = this.getSupportedFormats(this.detectionState.platformInfo.platform);
    }
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(content: string, format?: string): string {
    const hash = Buffer.from(content).toString('base64').slice(0, 16);
    return `${hash}-${format || 'auto'}`;
  }

  /**
   * Get supported formats for the platform
   */
  private getSupportedFormats(platform: string): string[] {
    switch (platform) {
      case 'macOS':
        return ['mcp.json', 'settings.json'];
      case 'Windows':
        return ['mcp.json'];
      case 'Linux':
        return ['settings.json'];
      default:
        return ['mcp.json', 'settings.json'];
    }
  }

  /**
   * Convert to Kosmos format
   */
  private convertToKosmosFormat(config: McpServerConfig): any {
    return {
      name: config.name,
      transport: config.transport as any,
      command: config.transport === 'stdio' ? config.command : undefined,
      args: config.transport === 'stdio' ? config.args : undefined,
      url: config.transport !== 'stdio' ? config.url : undefined,
      env: config.env
    };
  }

  /**
   * Convert configuration format
   */
  private async convertConfigFormat(
    config: McpServerConfig,
    targetFormat: string
  ): Promise<McpServerConfig> {
    // Specific format conversion logic can be implemented here
    // Currently returns the original config (since our config format is already generic)
    return { ...config };
  }
}

/**
 * Configuration adapter factory function
 */
export function createConfigAdapter(options?: ConfigAdapterOptions): ConfigAdapter {
  return new ConfigAdapter(options);
}

/**
 * Default configuration adapter instance
 */
export const defaultConfigAdapter = createConfigAdapter({
  autoDetection: true,
  strictValidation: false,
  cacheTtl: 5 * 60 * 1000
});