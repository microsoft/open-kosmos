/**
 * VSCode MCP Client - Transport Factory (VSCode Standard Compatible)
 * Creates transport instances following VSCode's implementation patterns
 */

import { VscodeStdioTransport, StdioTransportConfig } from './VscodeStdioTransport';
import { VscodeHttpTransport, HttpTransportConfig } from './VscodeHttpTransport';

export type TransportType = 'stdio' | 'http' | 'sse';

export interface BaseTransportConfig {
  type?: TransportType;
  timeout?: number;
}

export type VscodeTransportConfig = 
  | (StdioTransportConfig & { type: 'stdio' })
  | (HttpTransportConfig & { type: 'http' | 'sse' });

export interface VscodeTransport {
  readonly state: { state: 'stopped' | 'starting' | 'running' | 'error'; message?: string };
  start(): Promise<void>;
  send(message: string): Promise<void> | void;
  stop(): Promise<void>;
  on(event: 'message', listener: (message: string) => void): this;
  on(event: 'stateChange', listener: (state: any) => void): this;
  on(event: 'log', listener: (level: string, message: string) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

/**
 * Factory for creating VSCode-compatible MCP transports
 */
export class VscodeTransportFactory {
  /**
   * Create transport from VSCode MCP server configuration
   */
  static createFromVscodeConfig(serverName: string, config: any): VscodeTransport {
    const transportConfig = this.normalizeVscodeConfig(serverName, config);
    return this.createTransport(transportConfig);
  }
  
  /**
   * Create transport instance
   */
  static createTransport(config: VscodeTransportConfig): VscodeTransport {
    switch (config.type) {
      case 'stdio':
        return new VscodeStdioTransport(config);
      
      case 'http':
      case 'sse':
        return new VscodeHttpTransport(config);
      
      default:
        throw new Error(`Unsupported transport type: ${(config as any).type}`);
    }
  }
  
  /**
   * Normalize VSCode MCP configuration to transport config
   */
  static normalizeVscodeConfig(serverName: string, vscodeConfig: any): VscodeTransportConfig {
    // Detect transport type
    const transportType = this.detectTransportType(vscodeConfig);
    
    const baseConfig = {
      timeout: vscodeConfig.timeout || 60000,
    };
    
    switch (transportType) {
      case 'stdio': {
        if (!vscodeConfig.command) {
          throw new Error(`Stdio transport requires 'command' field for server ${serverName}`);
        }
        
        return {
          type: 'stdio',
          command: vscodeConfig.command,
          args: vscodeConfig.args || [],
          cwd: vscodeConfig.cwd,
          env: vscodeConfig.env || {},
          envFile: vscodeConfig.envFile,
          ...baseConfig,
        };
      }
      
      case 'http':
      case 'sse': {
        if (!vscodeConfig.url) {
          throw new Error(`HTTP/SSE transport requires 'url' field for server ${serverName}`);
        }
        
        return {
          type: transportType,
          url: vscodeConfig.url,
          headers: {
            'Content-Type': 'application/json',
            'Accept': transportType === 'sse' ? 'text/event-stream' : 'application/json',
            'User-Agent': 'VSCode-MCP-Client/1.0.0',
            ...vscodeConfig.headers,
          },
          method: vscodeConfig.method || 'POST',
          ...baseConfig,
        };
      }
      
      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }
  
  /**
   * Detect transport type from VSCode configuration
   */
  static detectTransportType(config: any): TransportType {
    // Check explicit type field
    if (config.type) {
      const normalizedType = config.type.toLowerCase();
      
      switch (normalizedType) {
        case 'stdio':
          return 'stdio';
        case 'http':
        case 'streamablehttp':
          return 'http';
        case 'sse':
          return 'sse';
        default:
          // Continue with auto-detection
          break;
      }
    }
    
    // Auto-detect based on configuration fields
    if (config.command || config.args) {
      return 'stdio';
    }
    
    if (config.url) {
      const url = config.url.toLowerCase();
      
      // Check for SSE patterns
      if (url.includes('/sse') || 
          url.includes('text/event-stream') || 
          url.includes('server-sent-events')) {
        return 'sse';
      }
      
      // Default to HTTP for URLs
      return 'http';
    }
    
    // Default fallback
    return 'stdio';
  }
  
  /**
   * Validate configuration for transport type
   */
  static validateConfig(config: VscodeTransportConfig): void {
    switch (config.type) {
      case 'stdio':
        if (!config.command) {
          throw new Error('Stdio transport requires a command');
        }
        if (!Array.isArray(config.args)) {
          throw new Error('Stdio transport requires args array');
        }
        break;
        
      case 'http':
      case 'sse':
        if (!config.url) {
          throw new Error(`${config.type.toUpperCase()} transport requires a URL`);
        }
        if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
          throw new Error(`${config.type.toUpperCase()} transport URL must start with http:// or https://`);
        }
        break;
        
      default:
        throw new Error(`Unknown transport type: ${(config as any).type}`);
    }
  }
  
  /**
   * Get supported transport types
   */
  static getSupportedTypes(): TransportType[] {
    return ['stdio', 'http', 'sse'];
  }
}

/**
 * Helper function to create transport from VSCode MCP configuration
 */
export function createVscodeTransport(serverName: string, vscodeConfig: any): VscodeTransport {
  return VscodeTransportFactory.createFromVscodeConfig(serverName, vscodeConfig);
}

/**
 * Helper function to detect if URL is SSE-based
 */
export function isSSEUrl(url: string): boolean {
  return url.includes('/sse') || 
         url.includes('text/event-stream') || 
         url.includes('server-sent-events');
}

/**
 * Helper function to check if config is for stdio transport
 */
export function isStdioConfig(config: any): boolean {
  return !!(config.command || config.args) || config.type?.toLowerCase() === 'stdio';
}

/**
 * Helper function to check if config is for HTTP/SSE transport
 */
export function isHttpConfig(config: any): boolean {
  return !!config.url || ['http', 'sse', 'streamablehttp'].includes(config.type?.toLowerCase());
}