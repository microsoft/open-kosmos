/**
 * Unified Terminal Instance Manager - Type Definitions
 * Supports cross-platform terminal management for Windows and macOS
 */

import { ChildProcessWithoutNullStreams } from 'child_process';

export type TerminalInstanceType = 'command' | 'mcp_transport';
export type TerminalState = 'idle' | 'running' | 'stopping' | 'stopped' | 'error';
export type ShellType = 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';

/**
 * Terminal instance configuration
 */
export interface TerminalConfig {
  // Basic configuration
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | null | undefined>;
  
  // Execution type
  type: TerminalInstanceType;
  
  // Shell configuration
  shell?: ShellType;
  
  // Timeout setting
  timeoutMs?: number;
  
  // Output limit
  maxOutputLength?: number;
  
  // Environment file
  envFile?: string;
  
  // Whether this is a long-running process (e.g., MCP server)
  persistent?: boolean;
  
  // Instance identifier (for reuse)
  instanceId?: string;
}

/**
 * Terminal execution result
 */
export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  truncated?: boolean;
}

/**
 * Terminal instance status information
 */
export interface TerminalInstanceInfo {
  id: string;
  type: TerminalInstanceType;
  state: TerminalState;
  config: TerminalConfig;
  pid?: number;
  startTime: number;
  lastActivity: number;
  error?: string;
}

/**
 * Terminal instance interface
 */
export interface ITerminalInstance {
  readonly id: string;
  readonly type: TerminalInstanceType;
  readonly state: TerminalState;
  readonly config: TerminalConfig;
  readonly process: ChildProcessWithoutNullStreams | null;
  readonly pid: number | undefined;
  
  /**
   * Start the terminal instance
   */
  start(): Promise<void>;
  
  /**
   * Execute a command (for command type)
   */
  execute(): Promise<TerminalResult>;
  
  /**
   * Send a message (for mcp_transport type)
   */
  send(message: string): void;
  
  /**
   * Stop the terminal instance
   */
  stop(force?: boolean): Promise<void>;
  
  /**
   * Get instance information
   */
  getInfo(): TerminalInstanceInfo;
  
  /**
   * Event listeners
   */
  on(event: 'message', listener: (message: string) => void): void;
  on(event: 'stderr', listener: (message: string) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void;
  on(event: 'stateChange', listener: (state: TerminalState) => void): void;
  
  /**
   * Clean up resources
   */
  dispose(): void;
}

/**
 * Terminal manager interface
 */
export interface ITerminalManager {
  /**
   * Create a new terminal instance
   */
  createInstance(config: TerminalConfig): Promise<ITerminalInstance>;
  
  /**
   * Get an existing instance (if it exists)
   */
  getInstance(id: string): ITerminalInstance | null;
  
  /**
   * Execute a one-time command
   */
  executeCommand(config: TerminalConfig): Promise<TerminalResult>;
  
  /**
   * Create a persistent MCP transport instance
   */
  createMcpTransport(config: TerminalConfig): Promise<ITerminalInstance>;
  
  /**
   * Get all instance information
   */
  getAllInstances(): TerminalInstanceInfo[];
  
  /**
   * Stop a specific instance
   */
  stopInstance(id: string, force?: boolean): Promise<void>;
  
  /**
   * Stop all instances
   */
  stopAllInstances(force?: boolean): Promise<void>;
  
  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

/**
 * Shell profile configuration
 */
export interface ShellProfile {
  command: string;
  args: string[];
  supportsPersistent: boolean;
}

/**
 * Platform-specific configuration
 */
export interface PlatformConfig {
  shells: Record<ShellType, ShellProfile>;
  defaultShell: ShellType;
  pathSeparator: string;
  executableExtensions: string[];
}