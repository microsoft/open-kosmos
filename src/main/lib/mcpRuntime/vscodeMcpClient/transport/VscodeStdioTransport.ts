/**
 * VSCode MCP Client - Stdio Transport Implementation
 * Uses unified terminal instance manager, supports cross-platform terminal management
 */

import { EventEmitter } from 'events';
import { homedir } from 'os';
import * as path from 'path';
import { getTerminalManager } from '../../../terminalManager';
import { ITerminalInstance, TerminalConfig, TerminalState } from '../../../terminalManager/types';
import { getUnifiedLogger, UnifiedLogger } from '../../../unifiedLogger';

export interface StdioTransportConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string | null>;
  envFile?: string;
}

export interface ConnectionState {
  state: 'stopped' | 'starting' | 'running' | 'error';
  code?: string;
  message?: string;
}

/**
 * VSCode-compatible Stdio Transport
 * Uses unified terminal manager while maintaining the original interface and behavior
 */
export class VscodeStdioTransport extends EventEmitter {
  private terminalInstance: ITerminalInstance | null = null;
  private currentState: ConnectionState = { state: 'stopped' };
  private terminalManager = getTerminalManager();
  private logger: UnifiedLogger = getUnifiedLogger();
  private instanceId: string;
  // Collect stderr output for error reporting
  private stderrBuffer: string[] = [];
  private readonly maxStderrLines = 50; // Keep at most 50 lines of stderr
  
  constructor(private config: StdioTransportConfig) {
    super();
    this.instanceId = this.generateInstanceId();
    
    this.logger.info(
      `VscodeStdioTransport created`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        command: config.command,
        argsCount: config.args?.length || 0,
        cwd: config.cwd,
        hasEnvFile: !!config.envFile,
        envVarsCount: Object.keys(config.env || {}).length
      }
    );
  }

  /**
   * Generate instance ID for log tracing
   */
  private generateInstanceId(): string {
    return `stdio_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
  
  public get state(): ConnectionState {
    return this.currentState;
  }
  
  /**
   * Start MCP server process
   */
  async start(): Promise<void> {
    const startTime = Date.now();
    
    this.logger.info(
      `Starting VscodeStdioTransport`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        currentState: this.currentState.state,
        command: this.config.command,
        args: this.config.args
      }
    );

    if (this.currentState.state === 'running' || this.currentState.state === 'starting') {
      this.logger.debug(
        `Transport already running or starting, skipping`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, currentState: this.currentState.state }
      );
      return;
    }
    
    this.setState({ state: 'starting' });
    
    // Clear stderr buffer to ensure only error logs related to this startup are collected
    this.stderrBuffer = [];
    
    try {
      // Prepare working directory
      this.logger.debug(`Preparing working directory`, 'VscodeStdioTransport', { instanceId: this.instanceId });
      const cwd = this.prepareCwd();
      
      // Create terminal configuration
      // Environment variables are managed uniformly by TerminalInstance (decides whether to add bin directory based on runtime mode)
      // Only pass env and envFile specified in config, let TerminalInstance handle it
      const terminalConfig: TerminalConfig = {
        command: this.expandTildePath(this.config.command),
        args: this.config.args.map(arg => this.expandTildePath(arg)),
        cwd,
        env: this.config.env as Record<string, string> | undefined,
        envFile: this.config.envFile,
        type: 'mcp_transport',
        persistent: true,
        instanceId: `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
      };
      
      this.logger.info(
        `Creating MCP transport terminal instance`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          terminalInstanceId: terminalConfig.instanceId,
          expandedCommand: terminalConfig.command,
          expandedArgs: terminalConfig.args,
          cwd: terminalConfig.cwd,
          envVarsCount: Object.keys(this.config.env || {}).length
        }
      );
      
      // Use terminal manager to create instance
      this.terminalInstance = await this.terminalManager.createMcpTransport(terminalConfig);
      
      // Set up event handlers
      this.setupEventHandlers();
      
      const startupTime = Date.now() - startTime;
      
      this.emit('log', 'debug', `Starting MCP server: ${terminalConfig.command} ${terminalConfig.args.join(' ')}`);
      
      // Instance is already started on creation, set state to running directly
      this.setState({ state: 'running' });
      
      this.logger.info(
        `VscodeStdioTransport started successfully`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          terminalInstanceId: this.terminalInstance.id,
          startupTimeMs: startupTime
        }
      );
      
      this.emit('log', 'debug', 'Stdio transport started and running');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const startupTime = Date.now() - startTime;
      
      this.logger.error(
        `Failed to start VscodeStdioTransport`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          error: errorMessage,
          startupTimeMs: startupTime,
          config: {
            command: this.config.command,
            argsCount: this.config.args?.length || 0,
            cwd: this.config.cwd
          }
        }
      );
      
      this.setState({
        state: 'error',
        message: errorMessage
      });
      throw error;
    }
  }
  
  /**
   * Send message to server
   */
  send(message: string): void {
    this.logger.debug(
      `Sending message to MCP server`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        messageLength: message.length,
        currentState: this.currentState.state,
        hasTerminalInstance: !!this.terminalInstance
      }
    );

    if (this.currentState.state !== 'running') {
      // If already in error state with a clear error message, use that message directly
      // Avoid wrapping it as "Transport is not running (state: error)" which is unhelpful
      if (this.currentState.state === 'error' && this.currentState.message) {
         throw new Error(this.currentState.message);
      }

      // Build error message including stderr output to diagnose the actual cause of failure
      const baseError = `Transport is not running (state: ${this.currentState.state})`;
      const errorWithStderr = this.buildErrorMessage(baseError);
      this.logger.error(
        `Cannot send message: transport not running`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, currentState: this.currentState.state }
      );
      throw new Error(errorWithStderr);
    }
    
    if (!this.terminalInstance) {
      // Build error message including stderr output
      const baseError = 'Terminal instance not available';
      const errorWithStderr = this.buildErrorMessage(baseError);
      this.logger.error(
        `Cannot send message: terminal instance not available`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId }
      );
      throw new Error(errorWithStderr);
    }
    
    try {
      this.terminalInstance.send(message);
      this.logger.debug(
        `Message sent successfully`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, terminalInstanceId: this.terminalInstance.id }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Build error message including stderr output
      const errorWithStderr = this.buildErrorMessage(`Failed to send message: ${errorMessage}`);
      this.logger.error(
        `Failed to send message to MCP server`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          error: errorMessage,
          terminalInstanceId: this.terminalInstance.id
        }
      );
      this.emit('log', 'error', errorWithStderr);
      throw new Error(errorWithStderr);
    }
  }

  /**
   * Stop server process
   */
  async stop(): Promise<void> {
    const stopTime = Date.now();
    
    this.logger.info(
      `Stopping VscodeStdioTransport`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        currentState: this.currentState.state,
        hasTerminalInstance: !!this.terminalInstance
      }
    );

    if (this.currentState.state === 'stopped') {
      this.logger.debug(
        `Transport already stopped`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId }
      );
      return;
    }
    
    if (this.terminalInstance) {
      const terminalInstanceId = this.terminalInstance.id;
      this.logger.debug(
        `Stopping terminal instance`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, terminalInstanceId }
      );
      
      try {
        await this.terminalInstance.stop();
        this.logger.debug(
          `Terminal instance stopped successfully`,
          'VscodeStdioTransport',
          { instanceId: this.instanceId, terminalInstanceId }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Error stopping terminal instance`,
          'VscodeStdioTransport',
          {
            instanceId: this.instanceId,
            terminalInstanceId,
            error: errorMessage
          }
        );
        this.emit('log', 'error', `Error during stop: ${errorMessage}`);
      } finally {
        this.terminalInstance = null;
      }
    }
    
    this.setState({ state: 'stopped' });
    
    const stopDuration = Date.now() - stopTime;
    this.logger.info(
      `VscodeStdioTransport stopped`,
      'VscodeStdioTransport',
      { instanceId: this.instanceId, stopDurationMs: stopDuration }
    );
  }
  
  private prepareCwd(): string {
    this.logger.debug(
      `Preparing working directory`,
      'VscodeStdioTransport',
      { instanceId: this.instanceId, configCwd: this.config.cwd }
    );

    const home = homedir();
    let cwd = this.config.cwd ? this.expandTildePath(this.config.cwd) : home;
    
    if (!path.isAbsolute(cwd)) {
      cwd = path.join(home, cwd);
      this.logger.debug(
        `Converted relative path to absolute`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, relativePath: this.config.cwd, absolutePath: cwd }
      );
    }
    
    this.logger.debug(
      `Working directory prepared`,
      'VscodeStdioTransport',
      { instanceId: this.instanceId, finalCwd: cwd }
    );
    
    return cwd;
  }
  
  private expandTildePath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(homedir(), filePath.slice(2));
    }
    return filePath;
  }
  
  private setupEventHandlers(): void {
    if (!this.terminalInstance) {
      this.logger.warn(
        `Cannot setup event handlers: terminal instance not available`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId }
      );
      return;
    }
    
    const terminalInstanceId = this.terminalInstance.id;
    this.logger.debug(
      `Setting up event handlers for terminal instance`,
      'VscodeStdioTransport',
      { instanceId: this.instanceId, terminalInstanceId }
    );
    
    // Handle incoming messages
    this.terminalInstance.on('message', (message: string) => {
      this.logger.debug(
        `Received message from MCP server`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          terminalInstanceId,
          messageLength: message.length
        }
      );
      this.emit('message', message);
    });
    
    const currentTerminalInstance = this.terminalInstance;

    // Collect stderr output for error diagnosis
    this.terminalInstance.on('stderr', (message: string) => {
      // Check if from the current terminal instance, ignore delayed/zombie output from old instances
      if (this.terminalInstance !== currentTerminalInstance) {
         return;
      }

      // Keep recent stderr lines
      this.stderrBuffer.push(message);
      if (this.stderrBuffer.length > this.maxStderrLines) {
        this.stderrBuffer.shift();
      }
      this.emit('log', 'debug', `[stderr] ${message}`);
    });
    
    // Handle errors
    this.terminalInstance.on('error', (error: Error) => {
      this.logger.error(
        `Terminal instance error occurred`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          terminalInstanceId,
          error: error.message,
          stack: error.stack
        }
      );
      
      // Build error message including stderr
      const errorMessage = this.buildErrorMessage(`Process error: ${error.message}`);
      this.setState({
        state: 'error',
        message: errorMessage
      });
      this.emit('log', 'error', `Terminal instance error: ${errorMessage}`);
    });
    
    // Handle process exit
    this.terminalInstance.on('exit', (code: number | null, signal: string | null) => {
      const instanceInfo = this.terminalInstance!.getInfo();
      const isExpectedExit = instanceInfo.state === 'stopping';
      
      this.logger.info(
        `Terminal instance process exited`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          terminalInstanceId,
          exitCode: code,
          signal,
          isExpectedExit,
          instanceState: instanceInfo.state
        }
      );
      
      if (isExpectedExit || code === 0) {
        this.setState({ state: 'stopped' });
        this.logger.debug(
          `Process exit was expected or successful, setting state to stopped`,
          'VscodeStdioTransport',
          { instanceId: this.instanceId }
        );
      } else {
        this.logger.error(
          `Unexpected process exit, setting state to error`,
          'VscodeStdioTransport',
          { instanceId: this.instanceId, exitCode: code, signal }
        );
        // Build error message including stderr
        const errorMessage = this.buildErrorMessage(`Process exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
        this.setState({
          state: 'error',
          message: errorMessage
        });
      }
      
      this.cleanup();
    });
    
    // Handle state changes
    this.terminalInstance.on('stateChange', (state: TerminalState) => {
      this.logger.debug(
        `Terminal instance state changed`,
        'VscodeStdioTransport',
        {
          instanceId: this.instanceId,
          terminalInstanceId,
          newState: state
        }
      );
      this.emit('log', 'debug', `Terminal instance state changed to: ${state}`);
    });
    
    this.logger.debug(
      `Event handlers setup completed`,
      'VscodeStdioTransport',
      { instanceId: this.instanceId, terminalInstanceId }
    );
  }
  
  private setState(newState: ConnectionState): void {
    const previousState = this.currentState.state;
    this.logger.debug(
      `Transport state changing`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        previousState,
        newState: newState.state,
        message: newState.message
      }
    );
    
    this.currentState = newState;
    this.emit('stateChange', newState);
    
    this.logger.info(
      `Transport state changed`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        previousState,
        currentState: newState.state
      }
    );
  }
  
  private cleanup(): void {
    this.logger.debug(
      `Cleaning up VscodeStdioTransport resources`,
      'VscodeStdioTransport',
      {
        instanceId: this.instanceId,
        hasTerminalInstance: !!this.terminalInstance
      }
    );
    
    if (this.terminalInstance) {
      const terminalInstanceId = this.terminalInstance.id;
      this.logger.debug(
        `Disposing terminal instance`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, terminalInstanceId }
      );
      
      this.terminalInstance.dispose();
      this.terminalInstance = null;
      
      this.logger.debug(
        `Terminal instance disposed`,
        'VscodeStdioTransport',
        { instanceId: this.instanceId, terminalInstanceId }
      );
    }
    
    this.logger.info(
      `VscodeStdioTransport cleanup completed`,
      'VscodeStdioTransport',
      { instanceId: this.instanceId }
    );
  }
  
  /**
   * Strip ANSI escape codes
   */
  private stripAnsi(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*[mK]/g, '');
  }

  /**
   * Build error message including stderr output
   * Append content from the stderr buffer to the error message
   */
  private buildErrorMessage(baseMessage: string): string {
    if (this.stderrBuffer.length === 0) {
      return baseMessage;
    }
    
    // If baseMessage already contains Stderr output with similar content to the current buffer, don't add more
    // Simple check for existing 'Stderr output:' marker
    if (baseMessage.includes('Stderr output:')) {
      return baseMessage;
    }
    
    // Get recent stderr output (at most 10 lines to avoid overly long messages)
    const recentStderr = this.stderrBuffer.slice(-10).join('\n');
    return `${baseMessage}\n\nStderr output:\n${this.stripAnsi(recentStderr)}`;
  }
  
  /**
   * Get currently collected stderr output
   */
  public getStderrOutput(): string {
    return this.stripAnsi(this.stderrBuffer.join('\n'));
  }
  
  /**
   * Clear stderr buffer (for cleanup before retry)
   */
  public clearStderrBuffer(): void {
    this.stderrBuffer = [];
  }
}