/**
 * Terminal Instance Implementation
 * Unified management of command execution and MCP transport terminal instances
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { readFile, stat } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ITerminalInstance,
  TerminalConfig,
  TerminalInstanceType,
  TerminalState,
  TerminalResult,
  TerminalInstanceInfo
} from './types';
import { PlatformConfigManager } from './PlatformConfigManager';
import { RuntimeManager } from '../runtime/RuntimeManager';

/**
 * Stream splitter for handling newline-delimited messages
 */
class StreamSplitter extends EventEmitter {
  private buffer = '';
  
  constructor(private delimiter: string) {
    super();
  }
  
  write(chunk: Buffer): void {
    this.buffer += chunk.toString();
    const parts = this.buffer.split(this.delimiter);
    this.buffer = parts.pop() || '';
    
    for (const part of parts) {
      this.emit('data', Buffer.from(part));
    }
  }
}

/**
 * Terminal state handler - responsible for graceful shutdown
 */
class TerminalStateHandler {
  private static readonly GRACE_TIME_MS = 10_000;
  
  private processState: 'running' | 'stdinEnded' | 'killedPolite' | 'killedForceful' = 'running';
  private nextTimeout?: NodeJS.Timeout;
  
  public get stopped() {
    return this.processState !== 'running';
  }
  
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly graceTimeMs: number = TerminalStateHandler.GRACE_TIME_MS
  ) {}
  
  /**
   * Start the graceful shutdown process
   */
  public stop(): void {
    if (this.processState === 'running') {
      let graceTime = this.graceTimeMs;
      try {
        this.child.stdin.end();
      } catch (error) {
        graceTime = 1;
      }
      this.processState = 'stdinEnded';
      this.nextTimeout = setTimeout(() => this.killPolite(), graceTime);
    } else {
      this.clearTimeout();
      this.killForceful();
    }
  }
  
  private async killPolite() {
    this.processState = 'killedPolite';
    this.nextTimeout = setTimeout(() => this.killForceful(), this.graceTimeMs);
    
    if (this.child.pid) {
      await this.killProcessTree(this.child.pid, false);
    } else {
      this.child.kill('SIGTERM');
    }
  }
  
  private async killForceful() {
    this.processState = 'killedForceful';
    
    if (this.child.pid) {
      try {
        await this.killProcessTree(this.child.pid, true);
      } catch {
        this.child.kill('SIGKILL');
      }
    } else {
      this.child.kill();
    }
  }
  
  private async killProcessTree(pid: number, force: boolean): Promise<void> {
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      const signal = force ? '/F' : '/T';
      try {
        await new Promise<void>((resolve, reject) => {
          exec(`taskkill ${signal} /PID ${pid}`, (error: any) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (e) {
        throw e;
      }
    } else {
      const { exec } = require('child_process');
      try {
        await new Promise<void>((resolve, reject) => {
          exec(`pkill -${force ? '9' : '15'} -P ${pid}`, (error: any) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (e) {
        throw e;
      }
    }
  }
  
  public write(message: string): void {
    if (!this.stopped) {
      this.child.stdin.write(message + '\n');
    }
  }
  
  public dispose() {
    this.clearTimeout();
  }
  
  private clearTimeout() {
    if (this.nextTimeout) {
      clearTimeout(this.nextTimeout);
      this.nextTimeout = undefined;
    }
  }
}

/**
 * Terminal instance implementation
 */
export class TerminalInstance extends EventEmitter implements ITerminalInstance {
  public readonly id: string;
  public readonly type: TerminalInstanceType;
  public readonly config: TerminalConfig;
  
  private _state: TerminalState = 'idle';
  private _process: ChildProcessWithoutNullStreams | null = null;
  private stateHandler: TerminalStateHandler | null = null;
  private platformConfig: PlatformConfigManager;
  
  private readonly startTime: number;
  private lastActivity: number;
  private error?: string;
  
  // Data collection for command execution
  private stdout = '';
  private stderr = '';
  private exitCode: number | null = null;
  private timedOut = false;
  private truncated = false;
  private commandStartTime = 0;
  
  constructor(config: TerminalConfig) {
    super();
    this.id = config.instanceId || this.generateId();
    this.type = config.type;
    this.config = config;
    this.platformConfig = PlatformConfigManager.getInstance();
    this.startTime = Date.now();
    this.lastActivity = this.startTime;
  }
  
  public get state(): TerminalState {
    return this._state;
  }
  
  public get process(): ChildProcessWithoutNullStreams | null {
    return this._process;
  }
  
  public get pid(): number | undefined {
    return this._process?.pid;
  }
  
  /**
   * Start the terminal instance
   */
  public async start(): Promise<void> {
    if (this._state === 'running') {
      return;
    }
    
    this.setState('running');
    
    try {
      // Resolve working directory
      let cwd = this.prepareCwd();
      let commandPrefix = '';

      try {
        await stat(cwd);
      } catch {
        // Directory does not exist, fall back to home directory and prepend cd command
        // This lets the shell or command itself report "No such file or directory" error
        // instead of spawn throwing ENOENT and preventing the process from starting
        
        // For better cross-platform compatibility (especially Windows mixed environments), normalize path separators to forward slashes
        // While Windows native paths use backslashes, CMD, PowerShell and Git Bash all support forward slashes
        // Forward slashes don't need escaping in strings, avoiding ambiguity of '\\' across different shells
        const normalizedCwd = cwd.replace(/\\/g, '/');
        commandPrefix = `cd "${normalizedCwd.replace(/"/g, '\\"')}" && `;
        cwd = os.homedir();
      }

      // Prepare environment variables
      const env = await this.prepareEnvironment();
      
      // Resolve command and arguments
      const { executable, args, shell } = await this.prepareCommand(commandPrefix);
      
      // Create child process
      this._process = spawn(executable, args, {
        stdio: 'pipe',
        cwd,
        env: env as unknown as NodeJS.ProcessEnv,
        shell,
      });
      
      // Create state handler
      if (this.config.persistent) {
        this.stateHandler = new TerminalStateHandler(this._process!);
      }
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Wait for process to start
      await new Promise<void>((resolve, reject) => {
        if (this._process!.killed) {
          reject(new Error('Process was killed during startup'));
          return;
        }
        
        this._process!.once('spawn', () => {
          this.lastActivity = Date.now();
          resolve();
        });
        
        this._process!.once('error', (error) => {
          reject(error);
        });
        
        // 5-second timeout
        setTimeout(() => {
          reject(new Error('Process spawn timeout'));
        }, 5000);
      });
      
    } catch (error) {
      this.setState('error');
      this.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
  
  /**
   * Execute a command (for command type)
   */
  public async execute(): Promise<TerminalResult> {
    if (this.type !== 'command') {
      throw new Error('execute() can only be called on command type instances');
    }
    
    if (this._state !== 'running') {
      throw new Error(`Terminal instance is not running (state: ${this._state})`);
    }
    
    return new Promise<TerminalResult>((resolve, reject) => {
      this.commandStartTime = Date.now();
      
      // Set up timeout
      const timeout = this.config.timeoutMs || 60000;
      const timeoutHandle = setTimeout(() => {
        this.timedOut = true;
        this._process?.kill('SIGTERM');
        setTimeout(() => this._process?.kill('SIGKILL'), 5000);
      }, timeout);
      
      // Listen for process completion
      this._process!.once('close', (code) => {
        clearTimeout(timeoutHandle);
        this.exitCode = code;
        
        resolve({
          stdout: this.stdout,
          stderr: this.stderr,
          exitCode: this.exitCode,
          timedOut: this.timedOut,
          durationMs: Date.now() - this.commandStartTime,
          truncated: this.truncated || undefined
        });
      });
      
      // Listen for errors
      this._process!.once('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }
  
  /**
   * Send a message (for mcp_transport type)
   */
  public send(message: string): void {
    if (this.type !== 'mcp_transport') {
      throw new Error('send() can only be called on mcp_transport type instances');
    }
    
    if (this._state !== 'running') {
      throw new Error(`Terminal instance is not running (state: ${this._state})`);
    }
    
    if (!this.stateHandler) {
      throw new Error('State handler not available');
    }
    
    if (this.stateHandler.stopped) {
      throw new Error('Process has been stopped');
    }
    
    this.stateHandler.write(message);
    this.lastActivity = Date.now();
  }
  
  /**
   * Stop the terminal instance
   */
  public async stop(force: boolean = false): Promise<void> {
    if (this._state === 'stopped') {
      return;
    }
    
    this.setState('stopping');
    
    if (this.stateHandler) {
      this.stateHandler.stop();
    } else if (this._process && !this._process.killed) {
      if (force) {
        this._process.kill('SIGKILL');
      } else {
        this._process.kill('SIGTERM');
        // If graceful shutdown fails, force kill after 5 seconds
        setTimeout(() => {
          if (this._process && !this._process.killed) {
            this._process.kill('SIGKILL');
          }
        }, 5000);
      }
    }
    
    // Wait for process to exit
    if (this._process && !this._process.killed) {
      await new Promise<void>((resolve) => {
        this._process!.once('exit', () => resolve());
      });
    }
    
    this.cleanup();
  }
  
  /**
   * Get instance information
   */
  public getInfo(): TerminalInstanceInfo {
    return {
      id: this.id,
      type: this.type,
      state: this._state,
      config: this.config,
      pid: this.pid,
      startTime: this.startTime,
      lastActivity: this.lastActivity,
      error: this.error
    };
  }
  
  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.stateHandler) {
      this.stateHandler.dispose();
      this.stateHandler = null;
    }
    this._process = null;
    this.removeAllListeners();
  }
  
  private generateId(): string {
    return `terminal_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
  
  private setState(newState: TerminalState): void {
    this._state = newState;
    this.emit('stateChange', newState);
  }
  
  /**
   * Check if in internal mode (whether to add bin directory to PATH)
   */
  private isInternalMode(): boolean {
    try {
      const runtimeManager = RuntimeManager.getInstance();
      const config = runtimeManager.getRunTimeConfig();
      return config.mode === 'internal';
    } catch {
      // Default to system mode when RuntimeManager is not initialized
      return false;
    }
  }

  private async prepareEnvironment(): Promise<Record<string, string>> {
    // Determine whether to include bin directory based on runtime mode
    // internal mode: prepend {user data folder}/bin to PATH
    // system mode: do not add bin directory
    const includeBinPath = this.isInternalMode();
    const env = this.platformConfig.getEnhancedEnvironment(includeBinPath);
    
    // Load environment file
    if (this.config.envFile) {
      try {
        const envContent = await readFile(this.config.envFile, 'utf-8');
        for (const [key, value] of this.platformConfig.parseEnvFile(envContent)) {
          env[key] = value;
        }
      } catch (e) {
        throw new Error(`Failed to read envFile '${this.config.envFile}': ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    
    // Apply environment variables from config
    if (this.config.env) {
      for (const [key, value] of Object.entries(this.config.env)) {
        if (value === null) {
          delete env[key];
        } else if (value !== undefined) {
          env[key] = String(value);
        }
      }
    }
    
    return env;
  }

  /**
   * Parse a command string to separate executable from inline arguments.
   * Handles quoted executables like: "C:\Program Files\app.exe" --flag
   * And simple commands like: python scripts/test.py --arg
   */
  private parseCommandString(command: string): { executable: string; inlineArgs: string } {
    const trimmed = command.trim();
    
    // Case 1: Command starts with a quote - find the matching closing quote
    if (trimmed.startsWith('"')) {
      const closingQuote = trimmed.indexOf('"', 1);
      if (closingQuote > 0) {
        const executable = trimmed.substring(1, closingQuote); // Remove quotes
        const inlineArgs = trimmed.substring(closingQuote + 1).trim();
        return { executable: `"${executable}"`, inlineArgs }; // Keep quotes for path with spaces
      }
    }
    
    if (trimmed.startsWith("'")) {
      const closingQuote = trimmed.indexOf("'", 1);
      if (closingQuote > 0) {
        const executable = trimmed.substring(1, closingQuote);
        const inlineArgs = trimmed.substring(closingQuote + 1).trim();
        return { executable: `'${executable}'`, inlineArgs };
      }
    }
    
    // Case 2: Simple command - split on first space
    const firstSpace = trimmed.indexOf(' ');
    if (firstSpace > 0) {
      return {
        executable: trimmed.substring(0, firstSpace),
        inlineArgs: trimmed.substring(firstSpace + 1).trim()
      };
    }
    
    // Case 3: No arguments
    return { executable: trimmed, inlineArgs: '' };
  }
  
  private async prepareCommand(prefix: string = ''): Promise<{ executable: string; args: string[]; shell: boolean }> {
    // To avoid command parsing errors, always execute commands through the shell
    // This lets the shell handle path resolution, argument parsing, pipes, redirections, etc.
    const shellProfile = this.platformConfig.getShellProfile(this.config.shell);
    const isPowerShell = shellProfile.command.includes('powershell') || shellProfile.command.includes('pwsh');
    
    // Build the complete command string
    // Critical Fix for Windows Paths with Spaces:
    // We need to be careful about quoting - only quote the executable path if needed,
    // NOT the entire command string including arguments.
    let commandToExecute = this.config.command;
    
    // Parse the command to separate executable from inline arguments
    // e.g., "python scripts/download.py url" -> executable: "python", inlineArgs: "scripts/download.py url"
    const { executable: cmdExecutable, inlineArgs } = this.parseCommandString(commandToExecute);
    
    // Only quote the executable path if it contains spaces and path separators
    let quotedExecutable = cmdExecutable;
    const execHasSpaces = cmdExecutable.includes(' ');
    const execHasPathSep = cmdExecutable.includes('\\') || cmdExecutable.includes('/');
    const execIsQuoted = cmdExecutable.startsWith('"') || cmdExecutable.startsWith("'");
    
    if (process.platform === 'win32' && execHasSpaces && execHasPathSep && !execIsQuoted) {
        // Only quote executable paths with spaces like "C:\Program Files\App\bin.exe"
        quotedExecutable = `"${cmdExecutable}"`;
    }
    
    // Rebuild command: quoted executable + inline args (if any)
    commandToExecute = inlineArgs ? `${quotedExecutable} ${inlineArgs}` : quotedExecutable;

    let fullCommand = prefix + commandToExecute;
    if (this.config.args && this.config.args.length > 0) {
      // If there are additional arguments, append to the command
      const quotedArgs = this.config.args.map(arg => {
        // Simple quoting for args with spaces
        if (arg.includes(' ') && !arg.startsWith('"') && !arg.startsWith("'")) {
            return `"${arg}"`;
        }
        return arg;
      });
      fullCommand += ' ' + quotedArgs.join(' ');
    }
    
    // Critical Fix for PowerShell:
    // When executing a quoted executable path (e.g. "C:\Program Files\exe" -v), 
    // PowerShell requires the call operator '&'.
    // Only add '&' if the executable itself is quoted, not if args contain quotes.
    if (process.platform === 'win32' && isPowerShell && quotedExecutable.startsWith('"')) {
        fullCommand = '& ' + fullCommand;
    }

    
    // For interactive shells, use appropriate arguments to execute the command
    // PowerShell uses -Command, other shells use -c
    const args = [...shellProfile.args];
    
    // Determine if it's PowerShell
    if (isPowerShell) {
      // PowerShell uses the -Command parameter to execute command strings
      return {
        executable: shellProfile.command,
        args: [...args, '-Command', fullCommand],
        shell: false // Already explicitly using a shell command, no additional shell wrapping needed
      };
    }
    
    // If args include -i, we need special handling
    // because -i and -c cannot be used together directly
    if (args.includes('-i')) {
      // Remove -i, but simulate interactive environment through the PS1 environment variable
      const filteredArgs = args.filter(arg => arg !== '-i');
      
      // Create a wrapper script that loads shell config first, then executes the command
      const wrapperCommand = this.createShellWrapper(fullCommand);
      
      return {
        executable: shellProfile.command,
        args: [...filteredArgs, '-c', wrapperCommand],
        shell: false // Already explicitly using a shell command, no additional shell wrapping needed
      };
    } else {
      return {
        executable: shellProfile.command,
        args: [...args, '-c', fullCommand],
        shell: false // Already explicitly using a shell command, no additional shell wrapping needed
      };
    }
  }
  
  /**
   * Create a shell wrapper script to ensure the full user environment is loaded
   */
  private createShellWrapper(command: string): string {
    const home = require('os').homedir();
    const shellType = this.config.shell || this.platformConfig.getDefaultShell();
    
    // Determine whether to add bin directory to PATH based on runtime mode
    // internal mode: prepend {user data folder}/bin to PATH
    // system mode: do not add bin directory
    const isInternal = this.isInternalMode();
    let pathOverride = '';
    
    if (isInternal) {
      const { app } = require('electron');
      try {
        const binPath = require('path').join(app.getPath('userData'), 'bin');
        // After loading shell config, re-prepend bin directory to PATH
        // This is to override PATH modifications by pyenv/nvm etc. in .zshrc/.bashrc
        pathOverride = `export PATH="${binPath}:$PATH"`;
      } catch {
        // Ignore when app is not initialized
      }
    }
    
    // Create loading script based on shell type
    if (shellType === 'zsh') {
      return `
        # Simulate interactive environment
        export PS1='$ '
        # Load zsh configuration files
        [[ -f "${home}/.zshenv" ]] && source "${home}/.zshenv"
        [[ -f "${home}/.zprofile" ]] && source "${home}/.zprofile"
        [[ -f "${home}/.zshrc" ]] && source "${home}/.zshrc"
        # Re-prepend bin directory to PATH (override pyenv/nvm modifications, internal mode only)
        ${pathOverride}
        # Execute the actual command
        ${command}
      `.replace(/^\s+/gm, '').trim();
    } else if (shellType === 'bash') {
      return `
        # Simulate interactive environment
        export PS1='$ '
        # Load bash configuration files
        [[ -f "${home}/.bash_profile" ]] && source "${home}/.bash_profile"
        [[ -f "${home}/.bashrc" ]] && source "${home}/.bashrc"
        # Re-prepend bin directory to PATH (override pyenv/nvm modifications, internal mode only)
        ${pathOverride}
        # Execute the actual command
        ${command}
      `.replace(/^\s+/gm, '').trim();
    } else {
      // For other shells, try to load common configuration files
      return `
        # Simulate interactive environment
        export PS1='$ '
        # Try to load common configuration files
        [[ -f "${home}/.profile" ]] && source "${home}/.profile"
        # Re-prepend bin directory to PATH (internal mode only)
        ${pathOverride}
        # Execute the actual command
        ${command}
      `.replace(/^\s+/gm, '').trim();
    }
  }
  
  private prepareCwd(): string {
    let cwd = this.platformConfig.untildify(this.config.cwd);
    if (!path.isAbsolute(cwd)) {
      cwd = path.resolve(cwd);
    }
    return cwd;
  }
  
  private setupEventHandlers(): void {
    if (!this._process) return;
    
    if (this.type === 'command') {
      this.setupCommandHandlers();
    } else {
      this.setupMcpTransportHandlers();
    }
    
    // Generic error handling
    this._process.on('error', (error: Error) => {
      this.setState('error');
      this.error = `Process error: ${error.message}`;
      this.emit('error', error);
    });
    
    // Process exit handling
    this._process.on('exit', (code: number | null, signal: string | null) => {
      const isExpectedExit = this.stateHandler?.stopped || this._state === 'stopping';
      
      if (isExpectedExit || code === 0) {
        this.setState('stopped');
      } else {
        this.setState('error');
        this.error = `Process exited with code ${code}, signal ${signal}`;
      }
      
      this.emit('exit', code, signal);
      this.cleanup();
    });
  }
  
  private setupCommandHandlers(): void {
    if (!this._process) return;
    
    const maxLength = this.config.maxOutputLength || 8000;
    
    const handleData = (buffer: Buffer, container: 'stdout' | 'stderr') => {
      const chunk = buffer.toString('utf8');
      const normalized = chunk.replace(/\r\n/g, '\n');
      
      if (container === 'stdout') {
        if (this.stdout.length + normalized.length > maxLength) {
          const remaining = maxLength - this.stdout.length;
          this.stdout += normalized.slice(0, Math.max(remaining, 0));
          this.truncated = true;
        } else {
          this.stdout += normalized;
        }
      } else {
        if (this.stderr.length + normalized.length > maxLength) {
          const remaining = maxLength - this.stderr.length;
          this.stderr += normalized.slice(0, Math.max(remaining, 0));
          this.truncated = true;
        } else {
          this.stderr += normalized;
        }
      }
    };
    
    this._process.stdout?.on('data', data => handleData(data as Buffer, 'stdout'));
    this._process.stderr?.on('data', data => handleData(data as Buffer, 'stderr'));
  }
  
  private setupMcpTransportHandlers(): void {
    if (!this._process) return;
    
    // Create stream splitters
    const stdoutSplitter = new StreamSplitter('\n');
    const stderrSplitter = new StreamSplitter('\n');
    
    // Handle stdout (incoming messages)
    this._process.stdout?.on('data', (chunk: Buffer) => {
      stdoutSplitter.write(chunk);
      this.lastActivity = Date.now();
    });
    
    stdoutSplitter.on('data', (line: Buffer) => {
      const message = line.toString().trim();
      if (message) {
        this.emit('message', message);
      }
    });
    
    // Handle stderr (log messages)
    this._process.stderr?.on('data', (chunk: Buffer) => {
      stderrSplitter.write(chunk);
    });
    
    stderrSplitter.on('data', (line: Buffer) => {
      const stderrMessage = line.toString().trim();
      if (stderrMessage) {
        console.warn(`[${this.id} stderr] ${stderrMessage}`);
        // Emit stderr event so external listeners can collect error information
        this.emit('stderr', stderrMessage);
      }
    });
  }
  
  private cleanup(): void {
    if (this.stateHandler) {
      this.stateHandler.dispose();
      this.stateHandler = null;
    }
    this._process = null;
  }
}