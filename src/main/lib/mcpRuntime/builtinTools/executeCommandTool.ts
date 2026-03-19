/**
 * ExecuteCommandTool built-in tool - refactored version
 * Uses unified terminal instance manager to provide LLM-initiated shell command execution capability
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';
import { getTerminalManager } from '../../terminalManager';
import { TerminalConfig } from '../../terminalManager/types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';

export interface ExecuteCommandToolArgs {
  // Required parameters
  description: string;                              // A brief one-sentence description of what this tool call does
  command: string;                                  // The command to execute
  cwd: string;                                      // Working directory, should be the current workspace root or a subdirectory

  // Optional parameters
  args?: string[];                                  // Optional argument list, automatically appended to the command
  timeoutSeconds?: number;                          // Request timeout in seconds, default 60s
  shell?: 'powershell' | 'cmd' | 'bash' | 'sh' | 'zsh';     // Specify the shell type to use
}

export interface ExecuteCommandToolResult {
  stdout: string;               // Standard output content (truncated to safe length)
  stderr: string;               // Standard error output
  exitCode: number | null;      // Process exit code, null means not obtained
  timedOut: boolean;            // Whether timeout termination occurred
  durationMs: number;           // Execution duration in milliseconds
  cwd: string;                  // Actual working directory when executing the command
  shell: string;                // The shell program used
  truncated?: boolean;          // Whether output was truncated due to length limit
}

const MAX_OUTPUT_CHARS = 8000;          // Maximum character count for stdout/stderr, truncated if exceeded
const DEFAULT_TIMEOUT_MS = 60_000;      // Default command execution timeout threshold in milliseconds
const DANGEROUS_PATTERNS = [            // Dangerous command patterns
  /rm\s+-rf\s+\/?/i,
  /shutdown/i,
  /poweroff/i,
  /format\s+/i,
  /mkfs/i,
  /del\s+\/?s\s+\/?q\s+[a-z]:/i
];

export class ExecuteCommandTool {
  private static logger: UnifiedLogger = getUnifiedLogger();
  
  /**
   * Execute the command run tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: ExecuteCommandToolArgs): Promise<ExecuteCommandToolResult> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();
    
    this.logger.info(
      `ExecuteCommandTool execution started`,
      'ExecuteCommandTool',
      { executionId, args: { command: args.command, cwd: args.cwd, shell: args.shell } }
    );

    try {
      // 1. Argument validation
      this.logger.debug(`Validating arguments`, 'ExecuteCommandTool', { executionId });
      const validation = this.validateArgs(args);
      if (!validation.isValid) {
        this.logger.error(
          `Arguments validation failed: ${validation.error}`,
          'ExecuteCommandTool',
          { executionId, validationError: validation.error, args }
        );
        throw new Error(`Invalid execute_command arguments: ${validation.error}`);
      }
      this.logger.debug(`Arguments validation passed`, 'ExecuteCommandTool', { executionId });

      // 2. Parse arguments (command, path, etc.)
      const normalizedCommand = args.command.trim();
      this.logger.debug(
        `Command normalized`,
        'ExecuteCommandTool',
        { executionId, originalCommand: args.command, normalizedCommand }
      );

      // Safety check
      const dangerousPattern = DANGEROUS_PATTERNS.find(pattern => pattern.test(normalizedCommand));
      if (dangerousPattern) {
        this.logger.warn(
          `Command blocked by safety policy`,
          'ExecuteCommandTool',
          { executionId, command: normalizedCommand, matchedPattern: dangerousPattern.toString() }
        );
        throw new Error('command blocked by safety policy');
      }
      this.logger.debug(`Safety check passed`, 'ExecuteCommandTool', { executionId });

      const commandLine = this.buildCommandLine(normalizedCommand, args.args);
      const timeoutMs = this.normalizeTimeout(args.timeoutSeconds);
      
      this.logger.info(
        `Preparing to execute command`,
        'ExecuteCommandTool',
        { executionId, commandLine, timeoutMs, cwd: args.cwd, shell: args.shell }
      );

      // 3. Execute command using the new terminal manager
      // Environment variables are managed uniformly by TerminalInstance (adds bin directory based on runtime mode)
      const terminalManager = getTerminalManager();
      
      const terminalConfig: TerminalConfig = {
        command: commandLine,
        args: [], // Command already includes arguments
        cwd: args.cwd,
        type: 'command',
        shell: args.shell,
        timeoutMs,
        maxOutputLength: MAX_OUTPUT_CHARS,
        persistent: false
      };

      this.logger.debug(
        `Executing command via terminal manager`,
        'ExecuteCommandTool',
        { executionId, terminalConfig }
      );

      const result = await terminalManager.executeCommand(terminalConfig);
      const executionTime = Date.now() - startTime;
      
      this.logger.info(
        `Command execution completed`,
        'ExecuteCommandTool',
        {
          executionId,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          executionTime,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          truncated: result.truncated
        }
      );
      
      // Convert result to original interface format
      const finalResult: ExecuteCommandToolResult = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        cwd: args.cwd, // Return the requested working directory
        shell: args.shell || 'default', // Return the requested shell or default value
        truncated: result.truncated
      };
      
      // Log a warning if there is error output
      if (result.stderr && result.stderr.trim()) {
        this.logger.warn(
          `Command produced stderr output`,
          'ExecuteCommandTool',
          { executionId, stderr: result.stderr.substring(0, 500) }
        );
      }
      
      return finalResult;
      
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error(
        `Command execution failed`,
        'ExecuteCommandTool',
        {
          executionId,
          error: errorMessage,
          executionTime,
          args: {
            command: args.command,
            cwd: args.cwd,
            shell: args.shell,
            timeoutSeconds: args.timeoutSeconds
          }
        }
      );
      
      throw new Error(`command execution failed: ${errorMessage}`);
    }
  }

  /**
   * Generate execution ID for log tracing
   */
  private static generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }

  /**
   * Normalize timeout parameter, return value in milliseconds
   */
  private static normalizeTimeout(timeoutSeconds?: number): number {
    this.logger.debug(
      `Normalizing timeout`,
      'ExecuteCommandTool',
      { inputTimeoutSeconds: timeoutSeconds }
    );
    
    if (timeoutSeconds === undefined) {
      this.logger.debug(`Using default timeout`, 'ExecuteCommandTool', { defaultTimeoutMs: DEFAULT_TIMEOUT_MS });
      return DEFAULT_TIMEOUT_MS;
    }
    
    if (!Number.isFinite(timeoutSeconds)) {
      this.logger.error(`Invalid timeout value`, 'ExecuteCommandTool', { timeoutSeconds });
      throw new Error('timeoutSeconds must be a finite number');
    }
    
    const clamped = Math.max(1, Math.min(900, Math.floor(timeoutSeconds)));
    const result = clamped * 1000;
    
    this.logger.debug(
      `Timeout normalized`,
      'ExecuteCommandTool',
      { originalTimeout: timeoutSeconds, clampedTimeout: clamped, resultMs: result }
    );
    
    return result;
  }

  /**
   * Concatenate command and argument strings to build the full command
   */
  private static buildCommandLine(cmd: string, args?: string[]): string {
    this.logger.debug(
      `Building command line`,
      'ExecuteCommandTool',
      { command: cmd, argsCount: args?.length || 0 }
    );
    
    if (!Array.isArray(args) || args.length === 0) {
      this.logger.debug(`No arguments provided, returning original command`, 'ExecuteCommandTool');
      return cmd;
    }

    const quotedArgs = args.map(entry => this.quoteArg(entry));
    const commandLine = [cmd, ...quotedArgs].join(' ');
    
    this.logger.debug(
      `Command line built`,
      'ExecuteCommandTool',
      { originalArgs: args, quotedArgs, finalCommandLine: commandLine }
    );
    
    return commandLine;
  }

  /**
   * Apply necessary escaping and quoting to arguments
   */
  private static quoteArg(value: string): string {
    if (!value) {
      this.logger.debug(`Empty argument, returning quoted empty string`, 'ExecuteCommandTool');
      return '""';
    }

    if (!/[\s"']/.test(value)) {
      this.logger.debug(`Argument doesn't need quoting`, 'ExecuteCommandTool', { value });
      return value;
    }

    const escaped = value.replace(/"/g, '\\"');
    const quoted = `"${escaped}"`;
    
    this.logger.debug(
      `Argument quoted`,
      'ExecuteCommandTool',
      { original: value, escaped, quoted }
    );
    
    return quoted;
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'execute_command',
      description:
        'Execute a shell command in the selected workspace using the unified terminal manager. Output is truncated to 8000 characters, commands timeout after 60 seconds by default, and high-risk patterns are blocked by safety checks.\n\n' +
        'Working Directory Guidelines:\n' +
        '- The cwd parameter specifies where the command runs\n' +
        '- Always use workspace-relative paths (e.g., "./src/config.json")\n' +
        '- Workspace root is the default and recommended working directory\n\n' +
        'Best Practices:\n' +
        '- Prefer relative paths over absolute paths for portability\n' +
        '- Use forward slashes (/) in paths for cross-platform compatibility\n' +
        '- Check command output (stdout/stderr) to verify execution results\n\n' +
        'System Info:\n' +
        `- Platform: ${process.platform}\n` +
        `- Default shell: ${process.platform === 'win32' ? 'powershell' : 'zsh'}\n` +
        '- Uses unified terminal instance manager for improved performance and resource management',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief one-sentence description of what this command execution does.'
          },
          command: {
            type: 'string',
            description: 'The command to run. May include arguments when args is not provided.'
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional argument list. Each entry is automatically quoted when required.'
          },
          cwd: {
            type: 'string',
            description: 'Working directory. Must be the workspace root path or a subdirectory within it.'
          },
          timeoutSeconds: {
            type: 'number',
            description: 'Optional timeout in seconds (default 60, minimum 1, maximum 900).'
          },
          shell: {
            type: 'string',
            enum: ['powershell', 'cmd', 'bash', 'sh', 'zsh'],
            description: 'Preferred shell profile. Defaults to powershell on Windows and zsh on macOS.'
          }
        },
        required: ['description', 'command', 'cwd']
      }
    };
  }
  
  /**
   * Validate arguments
   */
  private static validateArgs(args: ExecuteCommandToolArgs): { isValid: boolean; error?: string } {
    if (!args || typeof args !== 'object') {
      return { isValid: false, error: 'arguments object is required' };
    }

    if (typeof args.description !== 'string' || !args.description.trim()) {
      return { isValid: false, error: 'description must be a non-empty string' };
    }

    if (typeof args.command !== 'string' || !args.command.trim()) {
      return { isValid: false, error: 'command must be a non-empty string' };
    }

    if (typeof args.cwd !== 'string' || !args.cwd.trim()) {
      return { isValid: false, error: 'cwd must be provided and cannot be empty' };
    }

    if (args.args !== undefined) {
      if (!Array.isArray(args.args)) {
        return { isValid: false, error: 'args must be an array of strings when provided' };
      }

      for (const entry of args.args) {
        if (typeof entry !== 'string') {
          return { isValid: false, error: 'each arg entry must be a string' };
        }
      }
    }

    if (args.timeoutSeconds !== undefined) {
      if (!Number.isFinite(args.timeoutSeconds)) {
        return { isValid: false, error: 'timeoutSeconds must be a finite number' };
      }

      if (args.timeoutSeconds <= 0) {
        return { isValid: false, error: 'timeoutSeconds must be greater than zero' };
      }
    }

    if (args.shell !== undefined) {
      const allowedShells: Array<ExecuteCommandToolArgs['shell']> = ['powershell', 'cmd', 'bash', 'sh', 'zsh'];
      if (!allowedShells.includes(args.shell)) {
        return { isValid: false, error: 'shell must be one of powershell, cmd, bash, sh, zsh when provided' };
      }
    }

    return { isValid: true };
  }
}
