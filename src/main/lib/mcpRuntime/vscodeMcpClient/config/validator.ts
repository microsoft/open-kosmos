/**
 * Configuration Validator
 * VSCode MCP Client configuration validation and compatibility checking
 */

import { 
  McpServerConfig,
  ConfigValidationReport,
  ValidationRuleResult,
  ImportValidationResult,
  VSCodeMCPServerConfig,
  KosmosAppMCPServerConfig,
  TransportType 
} from './types';

// ==================== Validation Rule Interface ====================

export interface ValidationRule {
  name: string;
  validate: (config: McpServerConfig) => ValidationRuleResult;
  severity: 'error' | 'warning' | 'info';
}

// ==================== Main Validation Functions ====================

/**
 * Validate a single MCP server configuration
 */
export function validateMcpServerConfig(config: McpServerConfig): ConfigValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  // Run all validation rules
  for (const rule of validationRules) {
    const result = rule.validate(config);
    
    if (!result.passed && result.message) {
      switch (rule.severity) {
        case 'error':
          errors.push(result.message);
          break;
        case 'warning':
          warnings.push(result.message);
          break;
        case 'info':
          info.push(result.message);
          break;
      }
    }
  }

  // Calculate quality score
  const score = calculateQualityScore(config, errors, warnings);

  return {
    serverName: config.name,
    isValid: errors.length === 0,
    errors,
    warnings,
    info,
    score
  };
}

/**
 * Batch validate multiple configurations for batch import
 */
export function validateBatchImport(configs: McpServerConfig[]): ImportValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  const reports: ConfigValidationReport[] = [];

  // Validate each configuration
  for (const config of configs) {
    const report = validateMcpServerConfig(config);
    reports.push(report);
    
    allErrors.push(...report.errors.map(err => `${config.name}: ${err}`));
    allWarnings.push(...report.warnings.map(warn => `${config.name}: ${warn}`));
  }

  // Check for duplicate names
  const duplicateErrors = checkForDuplicateNames(configs);
  allErrors.push(...duplicateErrors);

  // Check for conflicting configurations
  const conflictWarnings = checkForConflicts(configs);
  allWarnings.push(...conflictWarnings);

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    serverCount: configs.length
  };
}

/**
 * Validate VSCode configuration before import
 */
export function validateVSCodeConfigBeforeImport(
  serverName: string,
  vscodeConfig: VSCodeMCPServerConfig
): ValidationRuleResult {
  // Check if configuration is disabled
  if (vscodeConfig.disabled === true) {
    return {
      passed: false,
      message: 'Server is disabled in VSCode configuration'
    };
  }

  // Check if required fields exist
  const hasStdioConfig = !!(vscodeConfig.command || vscodeConfig.args);
  const hasHttpConfig = !!vscodeConfig.url;

  if (!hasStdioConfig && !hasHttpConfig) {
    return {
      passed: false,
      message: 'Missing required configuration (command/args or url)'
    };
  }

  // Validate stdio configuration
  if (vscodeConfig.type === 'stdio' || hasStdioConfig) {
    if (!vscodeConfig.command) {
      return {
        passed: false,
        message: 'stdio transport requires command'
      };
    }
  }

  // Validate HTTP configuration
  if (vscodeConfig.url) {
    try {
      new URL(vscodeConfig.url);
    } catch {
      return {
        passed: false,
        message: 'Invalid URL format'
      };
    }
  }

  return { passed: true };
}

// ==================== Validation Rule Definitions ====================

/**
 * Validation rules for MCP server configuration
 */
const validationRules: ValidationRule[] = [
  // Required field validation
  {
    name: 'serverName',
    severity: 'error',
    validate: (config) => ({
      passed: !!(config.name && config.name.trim()),
      message: !config.name?.trim() ? 'Server name is required' : undefined
    })
  },

  {
    name: 'transportType',
    severity: 'error',
    validate: (config) => ({
      passed: ['stdio', 'http', 'sse'].includes(config.transport),
      message: !['stdio', 'http', 'sse'].includes(config.transport)
        ? `Invalid transport type: ${config.transport}` : undefined
    })
  },

  // Transport-specific validation
  {
    name: 'stdioCommand',
    severity: 'error',
    validate: (config) => {
      if (config.transport !== 'stdio') return { passed: true };
      return {
        passed: !!(config.command && config.command.trim()),
        message: !config.command?.trim() ? 'stdio transport requires command' : undefined
      };
    }
  },

  {
    name: 'httpUrl',
    severity: 'error',
    validate: (config) => {
      if (config.transport === 'stdio') return { passed: true };
      return {
        passed: !!(config.url && config.url.trim()),
        message: !config.url?.trim() ? 'HTTP/SSE transport requires URL' : undefined
      };
    }
  },

  // URL format validation
  {
    name: 'urlFormat',
    severity: 'warning',
    validate: (config) => {
      if (config.transport === 'stdio' || !config.url) return { passed: true };
      
      try {
        new URL(config.url);
        return { passed: true };
      } catch {
        return {
          passed: false,
          message: 'Invalid URL format'
        };
      }
    }
  },

  // Server name format validation
  {
    name: 'serverNameFormat',
    severity: 'warning',
    validate: (config) => {
      const validNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
      return {
        passed: validNamePattern.test(config.name),
        message: !validNamePattern.test(config.name) 
          ? 'Server name should only contain alphanumeric characters, hyphens, and underscores' : undefined
      };
    }
  },

  // Command validation for stdio
  {
    name: 'commandExecutable',
    severity: 'warning',
    validate: (config) => {
      if (config.transport !== 'stdio' || !config.command) return { passed: true };
      
      // Check if command looks like a valid executable
      const commonExecutables = ['node', 'python', 'python3', 'npm', 'npx', 'uvx', 'uv', 'cargo', 'go'];
      const command = config.command.toLowerCase();
      
      const isCommonExecutable = commonExecutables.some(exec => 
        command === exec || command.endsWith(`/${exec}`) || command.endsWith(`\\${exec}.exe`)
      );
      
      return {
        passed: isCommonExecutable || command.includes('/') || command.includes('\\'),
        message: !isCommonExecutable && !command.includes('/') && !command.includes('\\')
          ? 'Command may not be a valid executable path' : undefined
      };
    }
  },

  // Environment variable validation
  {
    name: 'environmentVariables',
    severity: 'info',
    validate: (config) => {
      if (!config.env || Object.keys(config.env).length === 0) {
        return { passed: true };
      }
      
      // Check for sensitive data in environment variables
      const sensitiveKeys = ['password', 'secret', 'token', 'key', 'api_key'];
      const hasSensitiveData = Object.keys(config.env).some(key => 
        sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))
      );
      
      return {
        passed: true,
        message: hasSensitiveData ? 'Configuration contains environment variables that may contain sensitive data' : undefined
      };
    }
  },

  // Transport type consistency
  {
    name: 'transportConsistency',
    severity: 'warning',
    validate: (config) => {
      if (config.transport === 'sse' && config.url && !config.url.includes('sse')) {
        return {
          passed: false,
          message: 'Transport type is SSE but URL does not contain "sse"'
        };
      }
      
      return { passed: true };
    }
  },

  // Working directory validation
  {
    name: 'workingDirectory',
    severity: 'warning',
    validate: (config) => {
      if (!config.workingDirectory) return { passed: true };
      
      // Basic path validation
      if (config.workingDirectory.includes('..')) {
        return {
          passed: false,
          message: 'Working directory should not contain relative path components'
        };
      }
      
      return { passed: true };
    }
  }
];

// ==================== Utility Functions ====================

/**
 * Calculate configuration quality score
 */
function calculateQualityScore(
  config: McpServerConfig, 
  errors: string[], 
  warnings: string[]
): number {
  let score = 100;

  // Error and warning deductions
  score -= errors.length * 20;  // Deduct 20 points per error
  score -= warnings.length * 5; // Deduct 5 points per warning

  // Good practice bonuses
  if (config.name && config.name.length > 3) score += 5;
  if (config.env && Object.keys(config.env).length > 0) score += 5;
  if (config.transport === 'stdio' && config.args && config.args.length > 0) score += 5;
  if (config.workingDirectory) score += 3;
  if (config.trusted === true) score += 2;

  return Math.max(0, Math.min(100, score));
}

/**
 * Check for duplicate server names
 */
function checkForDuplicateNames(configs: McpServerConfig[]): string[] {
  const errors: string[] = [];
  const nameCount = new Map<string, number>();

  // Count occurrences of each name
  for (const config of configs) {
    const name = config.name.toLowerCase();
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }

  // Report duplicates
  for (const [name, count] of Array.from(nameCount.entries())) {
    if (count > 1) {
      errors.push(`Duplicate server name "${name}" appears ${count} times`);
    }
  }

  return errors;
}

/**
 * Check for configuration conflicts
 */
function checkForConflicts(configs: McpServerConfig[]): string[] {
  const warnings: string[] = [];
  const urlMap = new Map<string, string[]>();

  // Group HTTP/SSE transport servers by URL
  for (const config of configs) {
    if (config.transport !== 'stdio' && config.url) {
      const url = config.url.toLowerCase();
      if (!urlMap.has(url)) {
        urlMap.set(url, []);
      }
      urlMap.get(url)!.push(config.name);
    }
  }

  // Check for URL conflicts
  for (const [url, serverNames] of Array.from(urlMap.entries())) {
    if (serverNames.length > 1) {
      warnings.push(`Multiple servers (${serverNames.join(', ')}) use the same URL: ${url}`);
    }
  }

  return warnings;
}

// ==================== Validation Summary and Suggestions ====================

/**
 * Get validation summary for import preview
 */
export function getValidationSummary(reports: ConfigValidationReport[]): {
  totalServers: number;
  validServers: number;
  totalErrors: number;
  totalWarnings: number;
  averageScore: number;
} {
  const totalServers = reports.length;
  const validServers = reports.filter(r => r.isValid).length;
  const totalErrors = reports.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = reports.reduce((sum, r) => sum + r.warnings.length, 0);
  const averageScore = totalServers > 0 
    ? Math.round(reports.reduce((sum, r) => sum + r.score, 0) / totalServers)
    : 0;

  return {
    totalServers,
    validServers,
    totalErrors,
    totalWarnings,
    averageScore
  };
}

/**
 * Suggest fixes for common validation issues
 */
export function suggestConfigFixes(report: ConfigValidationReport): string[] {
  const suggestions: string[] = [];

  for (const error of report.errors) {
    if (error.includes('Server name is required')) {
      suggestions.push('Add a descriptive server name');
    } else if (error.includes('requires command')) {
      suggestions.push('Specify the command to execute (e.g., "python", "node", "uvx")');
    } else if (error.includes('requires URL')) {
      suggestions.push('Provide a valid HTTP/SSE endpoint URL');
    } else if (error.includes('Invalid transport type')) {
      suggestions.push('Use one of: stdio, http, sse');
    }
  }

  for (const warning of report.warnings) {
    if (warning.includes('Invalid URL format')) {
      suggestions.push('Check URL format (should start with http:// or https://)');
    } else if (warning.includes('Server name should only contain')) {
      suggestions.push('Use only alphanumeric characters, hyphens, and underscores');
    } else if (warning.includes('Command may not be a valid')) {
      suggestions.push('Verify the command is installed and accessible');
    }
  }

  return suggestions;
}

/**
 * Validate VSCode configuration format
 */
export function validateVSCodeConfig(input: string, format: 'settings.json' | 'mcp.json'): {
  isValid: boolean;
  errors: string[];
  serverCount: number;
} {
  const errors: string[] = [];
  let serverCount = 0;

  try {
    const parsedConfig = JSON.parse(input);
    
    let servers: Record<string, any> = {};
    
    if (format === 'settings.json') {
      if (!parsedConfig.mcp) {
        errors.push('Missing "mcp" section in settings.json');
        return { isValid: false, errors, serverCount: 0 };
      }
      if (!parsedConfig.mcp.servers) {
        errors.push('Missing "mcp.servers" section in settings.json');
        return { isValid: false, errors, serverCount: 0 };
      }
      servers = parsedConfig.mcp.servers;
    } else if (format === 'mcp.json') {
      if (!parsedConfig.servers) {
        errors.push('Missing "servers" section in mcp.json');
        return { isValid: false, errors, serverCount: 0 };
      }
      servers = parsedConfig.servers;
    }

    // Validate each server configuration
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        errors.push(`Server "${serverName}" has invalid configuration`);
        continue;
      }

      const config = serverConfig as any;
      
      // Check for command/args (stdio) or url (http/sse)
      const hasStdioConfig = config.command || config.args;
      const hasHttpConfig = config.url;
      
      if (!hasStdioConfig && !hasHttpConfig) {
        errors.push(`Server "${serverName}" is missing required configuration (command/args or url)`);
        continue;
      }

      // Count valid servers (not disabled)
      if (!config.disabled) {
        serverCount++;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      serverCount
    };
  } catch (parseError) {
    errors.push(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : 'parse error'}`);
    return { isValid: false, errors, serverCount: 0 };
  }
}

// ==================== Type Conversion Validation ====================

/**
 * Convert configuration to Kosmos format for validation
 */
export function convertToKosmosFormat(config: McpServerConfig): KosmosAppMCPServerConfig {
  return {
    name: config.name,
    transport: config.transport === 'http' ? 'StreamableHttp' : (config.transport as any),
    command: config.transport === 'stdio' ? config.command : undefined,
    args: config.transport === 'stdio' ? config.args : undefined,
    url: config.transport !== 'stdio' ? config.url : undefined,
    env: config.env
  };
}

/**
 * Validate transport type
 */
export function isValidTransportType(transport: string): transport is TransportType {
  return ['stdio', 'http', 'sse'].includes(transport);
}

/**
 * Validate server configuration object
 */
export function isValidServerConfig(config: any): config is McpServerConfig {
  return config &&
    typeof config.name === 'string' &&
    isValidTransportType(config.transport) &&
    (config.transport !== 'stdio' || config.command) &&
    (config.transport === 'stdio' || config.url);
}