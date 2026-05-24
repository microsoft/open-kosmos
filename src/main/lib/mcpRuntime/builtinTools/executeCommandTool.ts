/**
 * ExecuteCommandTool built-in tool - refactored version
 * Uses unified terminal instance manager to provide LLM-invoked shell command execution
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';
import { getTerminalManager } from '../../terminalManager';
import { TerminalConfig } from '../../terminalManager/types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';
import {
  ExecuteCommandAuthInterruptionReason,
  ExecuteCommandInteractiveAuthHint,
  ExecuteCommandToolArgs,
  ExecuteCommandToolResult,
  ExecuteCommandBackgroundResult,
} from '@shared/types/toolCallArgs';
import { BuiltinToolsManager } from './builtinToolsManager';
import { CancellationError } from '../../cancellation';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { getBackgroundProcessManager } from '../../backgroundProcessManager';
import { buildCommandLine as buildCommandLineShared } from '../../backgroundProcessManager/commandLineUtils';

const MAX_OUTPUT_CHARS = 8000;          // Maximum characters allowed for stdout/stderr; truncated beyond this
const DEFAULT_TIMEOUT_MS = 60_000;      // Default command execution timeout threshold (milliseconds)
const INTERACTIVE_AUTH_TIMEOUT_MS = 900_000; // Interactive auth commands are allowed 15 minutes by default
const DANGEROUS_PATTERNS = [            // Dangerous patterns
  // Filesystem / system destruction
  /rm\s+-rf\s+\/?/i,
  /shutdown/i,
  /poweroff/i,
  /\bformat(?:\.com)?\s+[a-z]:/i,
  /mkfs/i,
  /del\s+\/?s\s+\/?q\s+[a-z]:/i,

  // Credential / auth destruction — deletes credential/token/cookie/auth cache files
  /Remove-Item.*(?:credential|token|cookie|auth.*cache)/i,
  /rm\s+.*(?:credential|token|cookie|auth.*cache)/i,
  /del\s+.*(?:credential|token|cookie|auth.*cache)/i,

  // OAuth logout/revoke/signout endpoints — accessing these URLs destroys system-level SSO login state
  /login\.microsoftonline\.com\/.*\/logout/i,
  /login\.live\.com\/.*logout/i,
  /accounts\.google\.com\/Logout/i,
  /\/oauth2?\/(?:logout|revoke|signout)/i,

  // Directly manipulates the system browser profile directory (Windows + macOS)
  /(?:Microsoft\\\\Edge|Google\\\\Chrome)\\\\User Data/i,
  /Application Support\/(?:Microsoft Edge|Google\/Chrome)/i,
];

export class ExecuteCommandTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  private static readonly INTERACTIVE_AUTH_COMMAND_PATTERNS: Array<{
    family: ExecuteCommandInteractiveAuthHint['commandFamily'];
    pattern: RegExp;
  }> = [
    { family: 'gh-auth-login', pattern: /^gh auth login(?:\s|$)/ },
    { family: 'gh-auth-refresh', pattern: /^gh auth refresh(?:\s|$)/ },
    { family: 'npm-login', pattern: /^npm login(?:\s|$)/ },
    { family: 'npm-adduser', pattern: /^npm adduser(?:\s|$)/ },
    { family: 'pnpm-login', pattern: /^pnpm login(?:\s|$)/ },
    { family: 'yarn-npm-login', pattern: /^yarn npm login(?:\s|$)/ }
  ];

  private static isInteractiveAuthCommand(command: string): boolean {
    const normalized = command.trim().replace(/\s+/g, ' ').toLowerCase();
    return this.getInteractiveAuthCommandFamily(normalized) !== null;
  }

  private static getInteractiveAuthCommandFamily(command: string): ExecuteCommandInteractiveAuthHint['commandFamily'] | null {
    const normalized = command.trim().replace(/\s+/g, ' ').toLowerCase();
    const match = this.INTERACTIVE_AUTH_COMMAND_PATTERNS.find(({ pattern }) => pattern.test(normalized));
    return match?.family ?? null;
  }

  private static extractVerificationUri(output: string): string | undefined {
    const match = output.match(/https?:\/\/[^\s)]+/i);
    return match?.[0];
  }

  private static extractDeviceCode(output: string): string | undefined {
    const labeledMatch = output.match(/(?:device code|user code|one-time code|code)\D{0,20}([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)/i);
    if (labeledMatch?.[1]) {
      return labeledMatch[1].toUpperCase();
    }

    const genericMatch = output.match(/\b([A-Z0-9]{4}(?:-[A-Z0-9]{4})+)\b/);
    return genericMatch?.[1]?.toUpperCase();
  }

  private static buildInteractiveAuthHint(
    command: string,
    stdout: string,
    stderr: string,
    timeoutMs: number,
    startedAt: number
  ): ExecuteCommandInteractiveAuthHint | undefined {
    const commandFamily = this.getInteractiveAuthCommandFamily(command);
    if (!commandFamily) {
      return undefined;
    }

    const output = `${stdout}\n${stderr}`;
    const verificationUri = this.extractVerificationUri(output);
    const deviceCode = this.extractDeviceCode(output);

    return {
      commandFamily,
      verificationUri,
      deviceCode,
      timeoutMs,
      startedAt
    };
  }

  private static getInteractiveAuthInterruptionMessage(reason: ExecuteCommandAuthInterruptionReason): string {
    if (reason === 'cancelled') {
      return 'Authentication was canceled by the user. Start the sign-in flow again to continue.';
    }

    return 'Authentication timed out before completion. Start the sign-in flow again to continue.';
  }

  private static finalizeInteractiveAuthResult(
    result: ExecuteCommandToolResult,
    reason: ExecuteCommandAuthInterruptionReason | null
  ): ExecuteCommandToolResult {
    if (!result.interactiveAuth || reason === null) {
      return result;
    }

    return {
      ...result,
      stdout: '',
      stderr: this.getInteractiveAuthInterruptionMessage(reason),
      truncated: undefined,
      interactiveAuth: undefined,
      authInterruptedReason: reason,
      success: false,
      exitCode: reason === 'cancelled' ? 130 : result.exitCode,
      timedOut: reason === 'timed_out',
    };
  }

  private static emitPartialResult(
    executionId: string,
    args: ExecuteCommandToolArgs,
    commandLine: string,
    timeoutMs: number,
    stdout: string,
    stderr: string,
    truncated: boolean,
    startTime: number
  ): void {
    const context = BuiltinToolsManager.getExecutionContext();
    if (!context?.eventSender || !context.currentToolCallId) {
      return;
    }

    const partialResult: ExecuteCommandToolResult = {
      stdout,
      stderr,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - startTime,
      cwd: args.cwd,
      shell: args.shell || 'default',
      truncated: truncated || undefined,
      interactiveAuth: this.buildInteractiveAuthHint(commandLine, stdout, stderr, timeoutMs, startTime)
    };

    const chunk: StreamingChunk = {
      chunkId: `tool_result_partial_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      messageId: context.currentToolCallId,
      chatId: context.chatId,
      chatSessionId: context.chatSessionId,
      timestamp: Date.now(),
      type: 'tool_result',
      toolResult: {
        tool_call_id: context.currentToolCallId,
        tool_name: 'execute_command',
        content: JSON.stringify(partialResult, null, 2),
        isError: false,
        isPartial: true
      }
    };

    context.eventSender.send('agentChat:streamingChunk', chunk);

    this.logger.debug(
      'Emitted partial execute_command output',
      'ExecuteCommandTool',
      {
        executionId,
        toolCallId: context.currentToolCallId,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
        truncated
      }
    );
  }

  /**
   * Execute the command run tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: ExecuteCommandToolArgs, options?: { signal?: AbortSignal }): Promise<ExecuteCommandToolResult | ExecuteCommandBackgroundResult> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();

    this.logger.info(
      `ExecuteCommandTool execution started`,
      'ExecuteCommandTool',
      { executionId, args: { command: args.command, cwd: args.cwd, shell: args.shell } }
    );

    try {
      // 1. Parameter validation
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

      // 2. Resolve parameters (command, paths, etc.)
      const normalizedCommand = args.command.trim();
      this.logger.debug(
        `Command normalized`,
        'ExecuteCommandTool',
        { executionId, originalCommand: args.command, normalizedCommand }
      );

      // Safety check — applied to the final commandLine (including args) to prevent bypassing via args
      const commandLine = this.buildCommandLine(normalizedCommand, args.args);
      const dangerousPattern = DANGEROUS_PATTERNS.find(pattern => pattern.test(commandLine));
      if (dangerousPattern) {
        const reason = this.getDangerousPatternReason(dangerousPattern);
        this.logger.warn(
          `Command blocked by safety policy`,
          'ExecuteCommandTool',
          { executionId, command: commandLine, matchedPattern: dangerousPattern.toString(), reason }
        );
        throw new Error(
          `Command blocked by safety policy: ${reason}. ` +
          `Do NOT retry this command. Choose a safer alternative that does not affect system-wide authentication state or credentials.`
        );
      }
      this.logger.debug(`Safety check passed`, 'ExecuteCommandTool', { executionId });

      const timeoutMs = this.normalizeTimeout(args.timeoutSeconds, commandLine);

      this.logger.info(
        `Preparing to execute command`,
        'ExecuteCommandTool',
        { executionId, commandLine, timeoutMs, cwd: args.cwd, shell: args.shell, background: args.background }
      );

      // 2.5. Background execution mode
      if (args.background) {
        this.logger.info(
          'Executing command in background mode',
          'ExecuteCommandTool',
          { executionId, commandLine, cwd: args.cwd }
        );

        const bgManager = getBackgroundProcessManager();
        const spawnResult = await bgManager.spawn(
          commandLine,
          {
            cwd: args.cwd,
            shell: args.shell
          }
        );

        this.logger.info(
          'Background process spawned',
          'ExecuteCommandTool',
          { executionId, sessionId: spawnResult.sessionId, pid: spawnResult.pid }
        );

        return {
          sessionId: spawnResult.sessionId,
          pid: spawnResult.pid,
          background: true
        };
      }

      // 3. Execute command using the new terminal manager
      // Environment variables are managed by TerminalInstance (decides whether to add bin directory based on runtime mode)
      const terminalManager = getTerminalManager();
      const executionContext = BuiltinToolsManager.getExecutionContext();

      const terminalConfig: TerminalConfig = {
        command: commandLine,
        args: [], // command already includes arguments
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

      const instance = await terminalManager.createInstance({
        ...terminalConfig,
        instanceId: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
      });

      let liveStdout = '';
      let liveStderr = '';
      let liveTruncated = false;
      let cancelledByUser = false;

      const maxOutputLength = terminalConfig.maxOutputLength || MAX_OUTPUT_CHARS;
      const appendOutput = (current: string, incoming: string): { next: string; truncated: boolean } => {
        if (!incoming) {
          return { next: current, truncated: false };
        }

        if (current.length + incoming.length > maxOutputLength) {
          const remaining = maxOutputLength - current.length;
          return {
            next: current + incoming.slice(0, Math.max(remaining, 0)),
            truncated: true
          };
        }

        return {
          next: current + incoming,
          truncated: false
        };
      };

      instance.on('stdout', (chunk) => {
        const update = appendOutput(liveStdout, chunk);
        liveStdout = update.next;
        liveTruncated = liveTruncated || update.truncated;
        this.emitPartialResult(executionId, args, commandLine, timeoutMs, liveStdout, liveStderr, liveTruncated, startTime);
      });

      instance.on('stderr', (chunk) => {
        const normalized = chunk.endsWith('\n') ? chunk : `${chunk}\n`;
        const update = appendOutput(liveStderr, normalized);
        liveStderr = update.next;
        liveTruncated = liveTruncated || update.truncated;
        this.emitPartialResult(executionId, args, commandLine, timeoutMs, liveStdout, liveStderr, liveTruncated, startTime);
      });

      const cancellationRegistration = executionContext?.registerCancellationHandler?.(async () => {
        cancelledByUser = true;
        await terminalManager.stopInstance(instance.id, true);
      });

      if (executionContext?.cancellationToken.isCancellationRequested) {
        cancellationRegistration?.dispose();
        await terminalManager.stopInstance(instance.id, true);
        throw new CancellationError('Command execution cancelled before completion');
      }

      let result;
      try {
        await instance.start();
        result = await instance.execute();
      } finally {
        cancellationRegistration?.dispose();
        await terminalManager.stopInstance(instance.id, true);
      }
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

      // Convert result to the original interface format
      const finalResult: ExecuteCommandToolResult = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        cwd: args.cwd, // return the requested working directory
        shell: args.shell || 'default', // return the requested shell or default
        truncated: result.truncated,
        interactiveAuth: this.buildInteractiveAuthHint(commandLine, result.stdout, result.stderr, timeoutMs, startTime)
      };

      const interruptionReason: ExecuteCommandAuthInterruptionReason | null = cancelledByUser
        ? 'cancelled'
        : finalResult.timedOut
          ? 'timed_out'
          : null;

      const normalizedFinalResult = this.finalizeInteractiveAuthResult(finalResult, interruptionReason);

      // Log warning if there is stderr output
      if (normalizedFinalResult.stderr && normalizedFinalResult.stderr.trim()) {
        this.logger.warn(
          `Command produced stderr output`,
          'ExecuteCommandTool',
          { executionId, stderr: normalizedFinalResult.stderr.substring(0, 500) }
        );
      }

      return normalizedFinalResult;

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
   * Normalize the timeout parameter and return milliseconds
   */
  private static normalizeTimeout(timeoutSeconds: number | undefined, command: string): number {
    this.logger.debug(
      `Normalizing timeout`,
      'ExecuteCommandTool',
      { inputTimeoutSeconds: timeoutSeconds, command }
    );

    const interactiveAuthCommand = this.isInteractiveAuthCommand(command);

    if (timeoutSeconds === undefined) {
      const defaultTimeoutMs = interactiveAuthCommand
        ? INTERACTIVE_AUTH_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS;

      this.logger.debug(`Using default timeout`, 'ExecuteCommandTool', {
        defaultTimeoutMs,
        interactiveAuthCommand
      });
      return defaultTimeoutMs;
    }

    if (!Number.isFinite(timeoutSeconds)) {
      this.logger.error(`Invalid timeout value`, 'ExecuteCommandTool', { timeoutSeconds });
      throw new Error('timeoutSeconds must be a finite number');
    }

    const clamped = Math.max(1, Math.min(900, Math.floor(timeoutSeconds)));
    const explicitTimeoutMs = clamped * 1000;
    const result = interactiveAuthCommand
      ? Math.max(INTERACTIVE_AUTH_TIMEOUT_MS, explicitTimeoutMs)
      : explicitTimeoutMs;

    this.logger.debug(
      `Timeout normalized`,
      'ExecuteCommandTool',
      {
        originalTimeout: timeoutSeconds,
        clampedTimeout: clamped,
        explicitTimeoutMs,
        interactiveAuthCommand,
        resultMs: result
      }
    );

    return result;
  }

  /**
   * Concatenate the command and argument strings to build the full command line
   */
  private static buildCommandLine(cmd: string, args?: string[]): string {
    this.logger.debug(
      `Building command line`,
      'ExecuteCommandTool',
      { command: cmd, argsCount: args?.length || 0 }
    );

    const commandLine = buildCommandLineShared(cmd, args);

    this.logger.debug(
      `Command line built`,
      'ExecuteCommandTool',
      { originalArgs: args, finalCommandLine: commandLine }
    );

    return commandLine;
  }

  /**
   * Get tool definition (for registration in BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'execute_command',
      description:
        'Execute a shell command in the selected workspace using the unified terminal manager. Output is truncated to 8000 characters, commands timeout after 60 seconds by default, interactive auth commands like gh auth login get a 15-minute minimum timeout, and high-risk patterns are blocked by safety checks.\n\n' +
        'Interactive auth commands such as gh auth login, gh auth refresh, npm login, npm adduser, pnpm login, and yarn npm login surface verification hints in the message timeline so users can open links, copy device codes, and see the remaining timeout without digging through raw terminal output.\n\n' +
        'Background Mode:\n' +
        '- Set background=true to run long-running commands without blocking\n' +
        '- Returns immediately with sessionId and pid\n' +
        '- Use manage_process tool to poll status, read logs, or kill the process\n\n' +
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
            description: 'Optional timeout in seconds (default 60, minimum 1, maximum 900). Ignored when background=true.'
          },
          shell: {
            type: 'string',
            enum: ['powershell', 'cmd', 'bash', 'sh', 'zsh'],
            description: 'Preferred shell profile. Defaults to powershell on Windows and zsh on macOS.'
          },
          background: {
            type: 'boolean',
            description: 'Run command in background without blocking. Returns sessionId and pid. Use manage_process to monitor.'
          }
        },
        required: ['description', 'command', 'cwd']
      }
    };
  }

  /**
   * Return a human-readable reason for why a dangerous pattern was blocked
   */
  private static getDangerousPatternReason(pattern: RegExp): string {
    const src = pattern.source;
    if (/credential|token|cookie|auth.*cache/i.test(src)) {
      return 'this command would delete credential/token/cookie files, which destroys authentication state for the user and other applications';
    }
    if (/login\.microsoftonline|login\.live|accounts\.google|oauth2?.*logout|revoke|signout/i.test(src)) {
      return 'this command accesses an OAuth logout/revoke endpoint, which would destroy system-wide SSO login state across all services';
    }
    if (/Edge|Chrome.*User Data|Application Support/i.test(src)) {
      return 'this command directly manipulates the system browser profile directory, which can corrupt or destroy browser login state';
    }
    // Fallback for original filesystem/system patterns
    return 'this command matches a destructive system operation pattern';
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
