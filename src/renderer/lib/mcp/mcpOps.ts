/**
 * MCP Operations API
 * Provides frontend API layer for MCP server operations, including IPC communication and validation functionality
 */

import { validateMcpServerConfig, ConfigValidationReport } from './configValidator';
import { KosmosAppMCPServerConfig } from '../../types/mcpTypes';

// Helper function for safe access to electronAPI
function getElectronAPI() {
  return (window as any).electronAPI;
}

export interface McpOpsResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface McpServerValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
  score: number;
}

/**
 * MCP Operations class, provides unified frontend API
 */
export class McpOps {
  /**
   * Connect to MCP server - new process
   * Now handled through ProfileCacheManager instead of direct IPC calls
   */
  static async connect(serverName: string): Promise<McpOpsResult> {
    try {
      if (!serverName || !serverName.trim()) {
        return {
          success: false,
          error: 'Server name is required'
        };
      }

      const result = await getElectronAPI().profile.connectMcpServer(serverName);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Disconnect from MCP server - new process
   * Now handled through ProfileCacheManager instead of direct IPC calls
   */
  static async disconnect(serverName: string): Promise<McpOpsResult> {
    try {
      if (!serverName || !serverName.trim()) {
        return {
          success: false,
          error: 'Server name is required'
        };
      }

      const result = await getElectronAPI().profile.disconnectMcpServer(serverName);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Reconnect to MCP server - new process
   * Now handled through ProfileCacheManager instead of direct IPC calls
   */
  static async reconnect(serverName: string): Promise<McpOpsResult> {
    try {
      if (!serverName || !serverName.trim()) {
        return {
          success: false,
          error: 'Server name is required'
        };
      }

      const result = await getElectronAPI().profile.reconnectMcpServer(serverName);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Add new MCP server - new process
   * Now handled through ProfileCacheManager instead of direct IPC calls
   */
  static async add(serverConfig: KosmosAppMCPServerConfig): Promise<McpOpsResult<string>> {
    try {
      // Validate configuration before adding
      const validation = this.validate(serverConfig.name, serverConfig);
      
      if (!validation.isValid) {
        return {
          success: false,
          error: `Configuration validation failed: ${validation.errors.join(', ')}`
        };
      }

      const result = await getElectronAPI().profile.addMcpServer(serverConfig.name, serverConfig);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Update existing MCP server configuration - new process
   * Now handled through ProfileCacheManager instead of direct IPC calls
   */
  static async update(serverName: string, serverConfig: Partial<KosmosAppMCPServerConfig>): Promise<McpOpsResult<string>> {
    try {
      if (!serverName || !serverName.trim()) {
        return {
          success: false,
          error: 'Server name is required'
        };
      }

      // If this is a complete configuration update, validate it
      if (serverConfig.name && serverConfig.transport) {
        const validation = this.validate(serverConfig.name, serverConfig as KosmosAppMCPServerConfig);
        
        if (!validation.isValid) {
          return {
            success: false,
            error: `Configuration validation failed: ${validation.errors.join(', ')}`
          };
        }
      }

      const result = await getElectronAPI().profile.updateMcpServer(serverName, serverConfig);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Delete MCP server - new process
   * Now handled through ProfileCacheManager instead of direct IPC calls
   */
  static async delete(serverName: string): Promise<McpOpsResult> {
    try {
      if (!serverName || !serverName.trim()) {
        return {
          success: false,
          error: 'Server name is required'
        };
      }

      const result = await getElectronAPI().profile.deleteMcpServer(serverName);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get status of all servers
   */
  static async getServerStatus(): Promise<McpOpsResult<any[]>> {
    try {
      const result = await getElectronAPI().mcp.getServerStatus();
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Get all available tools from connected servers
   */
  static async getAllTools(): Promise<McpOpsResult<any[]>> {
    try {
      const result = await getElectronAPI().mcp.getAllTools();
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Execute tool
   */
  static async executeTool(toolName: string, toolArgs: any): Promise<McpOpsResult<any>> {
    try {
      if (!toolName || !toolName.trim()) {
        return {
          success: false,
          error: 'Tool name is required'
        };
      }

      const result = await getElectronAPI().mcp.executeTool(toolName, toolArgs);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Validate server name and configuration (frontend-only method)
   * Migrated from existing validation implementation
   */
  static validate(serverName: string, serverConfig: KosmosAppMCPServerConfig): McpServerValidationResult {
    try {
      // Basic server name validation
      const serverNameErrors: string[] = [];
      if (!serverName || !serverName.trim()) {
        serverNameErrors.push('Server name is required');
      } else {
        // Server name format validation
        const validNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
        if (!validNamePattern.test(serverName)) {
          serverNameErrors.push('Server name should only contain alphanumeric characters, hyphens and underscores');
        }
      }

      // Ensure server configuration has matching name field
      const configToValidate: KosmosAppMCPServerConfig = {
        ...serverConfig,
        name: serverName
      };

      // Use existing validation function
      const report: ConfigValidationReport = validateMcpServerConfig(configToValidate);
      
      // Merge server name errors and configuration validation errors
      const allErrors = [...serverNameErrors, ...report.errors];
      
      // Generate suggestions based on errors and warnings
      const suggestions = this.generateSuggestions(allErrors, report.warnings);

      return {
        isValid: allErrors.length === 0,
        errors: allErrors,
        warnings: report.warnings,
        suggestions,
        score: report.score
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [error instanceof Error ? error.message : 'Validation error occurred'],
        warnings: [],
        suggestions: ['Please check configuration format and try again'],
        score: 0
      };
    }
  }

  /**
   * Validate server name only
   */
  static validateServerName(serverName: string): { isValid: boolean; error?: string } {
    if (!serverName || !serverName.trim()) {
      return {
        isValid: false,
        error: 'Server name is required'
      };
    }

    // Check for invalid characters
    const validNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9\-_]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/;
    if (!validNamePattern.test(serverName)) {
      return {
        isValid: false,
        error: 'Server name should only contain alphanumeric characters, hyphens and underscores'
      };
    }

    // Check length limits
    if (serverName.length < 1) {
      return {
        isValid: false,
        error: 'Server name cannot be empty'
      };
    }

    if (serverName.length > 50) {
      return {
        isValid: false,
        error: 'Server name too long (maximum 50 characters)'
      };
    }

    return { isValid: true };
  }

  /**
   * Quick validation for transport-specific requirements
   */
  static validateTransportConfig(transport: 'stdio' | 'sse' | 'StreamableHttp', config: Partial<KosmosAppMCPServerConfig>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    switch (transport) {
      case 'stdio':
        if (!config.command || !config.command.trim()) {
          errors.push('stdio transport requires command');
        }
        break;
      
      case 'sse':
      case 'StreamableHttp':
        if (!config.url || !config.url.trim()) {
          errors.push('HTTP/SSE transport requires URL');
        } else {
          try {
            new URL(config.url);
          } catch {
            errors.push('Invalid URL format');
          }
        }
        break;
      
      default:
        errors.push('Invalid transport type');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate helpful suggestions based on validation errors and warnings
   */
  private static generateSuggestions(errors: string[], warnings: string[]): string[] {
    const suggestions: string[] = [];

    // Error suggestions
    for (const error of errors) {
      if (error.includes('Server name is required')) {
        suggestions.push('Add a descriptive server name (e.g., "my-python-server")');
      } else if (error.includes('stdio transport requires command')) {
        suggestions.push('Specify the command to execute (e.g., "python", "node", "uvx")');
      } else if (error.includes('HTTP/SSE transport requires URL')) {
        suggestions.push('Provide a valid HTTP/SSE endpoint URL (e.g., "http://localhost:8000")');
      } else if (error.includes('Invalid transport type')) {
        suggestions.push('Use one of: stdio, sse, StreamableHttp');
      } else if (error.includes('Server name should only contain')) {
        suggestions.push('Only use alphanumeric characters, hyphens and underscores (e.g., "my-server-1")');
      }
    }

    // Warning suggestions
    for (const warning of warnings) {
      if (warning.includes('Invalid URL format')) {
        suggestions.push('Check URL format (should start with http:// or https://)');
      } else if (warning.includes('Command may not be a valid')) {
        suggestions.push('Verify command is installed and accessible in PATH');
      } else if (warning.includes('Transport type is SSE but URL does not contain')) {
        suggestions.push('Consider using SSE-specific endpoint URL (e.g., ending with "/sse")');
      }
    }

    // Remove duplicates
    return Array.from(new Set(suggestions));
  }

  /**
   * Check if MCP operations are available
   */
  static isAvailable(): boolean {
    return !!(getElectronAPI()?.mcp);
  }
}

// Export default instance for convenience
export const mcpOps = McpOps;

// Default export
export default McpOps;