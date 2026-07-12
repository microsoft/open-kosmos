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
import type { ToolExecutionContext } from '../../subAgent/types';
import { CancellationError } from '../../cancellation';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { getBackgroundProcessManager } from '../../backgroundProcessManager';
import { buildCommandLine as buildCommandLineShared } from '../../backgroundProcessManager/commandLineUtils';
import { RuntimeManager } from '../../runtime/RuntimeManager';

const MAX_OUTPUT_CHARS = 8000;          // Maximum characters allowed for stdout/stderr; truncated beyond this
const DEFAULT_TIMEOUT_MS = 60_000;      // Default command execution timeout threshold (milliseconds)
const INTERACTIVE_AUTH_TIMEOUT_MS = 900_000; // Interactive auth commands are allowed 15 minutes by default
// Non-auth commands no longer carry a fixed execution-duration cap: they are governed solely by the
// central no-response watchdog (see toolTimeoutPolicy.TOOL_IDLE_TIMEOUT_MS), which resets on every
// real output chunk via reportActivity. This far backstop only guards a runaway terminal if the tool
// is ever invoked without the central watchdog; it is NOT a practical execution-time limit.
const NO_RESPONSE_BACKSTOP_MS = 24 * 60 * 60 * 1000; // 24h safety backstop
// Cadence at which an interactive-auth command pins the central no-response watchdog while it waits
// (often silently) for the user to finish signing in. Must stay well below TOOL_IDLE_TIMEOUT_MS.
const INTERACTIVE_AUTH_KEEPALIVE_MS = 60_000;
const PYTHON_MISSING_PIP_PATTERN = /No module named ['"]?pip['"]?/i;
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
  /https?:\/\/[^\s"'<>]+\/(?:[^/\s"'<>]+\/)*(?:logout|revoke|signout)\b/i,

  // Directly manipulates a system browser profile directory (Windows + macOS)
  /(?:\\|\/)User Data(?:\\|\/)/i,
  /\/Application Support\/(?:[^/\s"']+\/){1,2}(?:Default|Profile(?: \d+)?)(?:\/|["']?\s*$)/i,
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

  private static normalizeCommandToken(token: string): string {
    const trimmed = token.trim().replace(/^['"]|['"]$/g, '');
    const basename = trimmed.split(/[\\/]/).pop() || trimmed;
    return basename.toLowerCase().replace(/\.(cmd|exe|bat)$/i, '');
  }

  private static isPythonOrPipCommand(commandLine: string): boolean {
    const tokens = commandLine.trim().split(/\s+/).filter(Boolean);
    const first = this.normalizeCommandToken(tokens[0] || '');
    const second = this.normalizeCommandToken(tokens[1] || '');

    return first === 'python'
      || first === 'python3'
      || first === 'pip'
      || first === 'pip3'
      || (first === 'uv' && second === 'pip');
  }

  private static isInternalRuntimeMode(): boolean {
    try {
      return RuntimeManager.getInstance().getRunTimeConfig().mode === 'internal';
    } catch {
      return false;
    }
  }

  private static async waitForPythonRuntimeIfNeeded(commandLine: string): Promise<void> {
    if (!this.isPythonOrPipCommand(commandLine) || !this.isInternalRuntimeMode()) {
      return;
    }

    await RuntimeManager.getInstance().waitForShimsReady();
  }

  private static isMissingPipResult(result: { exitCode: number | null; stdout: string; stderr: string }): boolean {
    if (result.exitCode === 0) {
      return false;
    }
    return PYTHON_MISSING_PIP_PATTERN.test(`${result.stdout}\n${result.stderr}`);
  }

  private static async repairMissingPipForCommand(commandLine: string): Promise<boolean> {
    if (!this.isPythonOrPipCommand(commandLine) || !this.isInternalRuntimeMode()) {
      return false;
    }

    try {
      return await RuntimeManager.getInstance().ensurePythonPipAvailable();
    } catch (error) {
      this.logger.warn(
        'Failed to repair app-managed Python pip after command reported missing pip',
        'ExecuteCommandTool',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
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
  static async execute(
    args: ExecuteCommandToolArgs,
    options?: { signal?: AbortSignal; executionContext?: ToolExecutionContext | null },
  ): Promise<ExecuteCommandToolResult | ExecuteCommandBackgroundResult> {
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

      const interactiveAuthCommand = this.isInteractiveAuthCommand(commandLine);
      // execute_command no longer exposes a timeout parameter. Interactive-auth commands keep a fixed
      // bounded window (for the verification hint + keepalive); every other command is governed solely
      // by the central no-response watchdog (TOOL_IDLE_TIMEOUT_MS). DEFAULT_TIMEOUT_MS here is only an
      // informational value handed to the auth-hint builder, which ignores it for non-auth commands.
      const timeoutMs = interactiveAuthCommand ? INTERACTIVE_AUTH_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
      // Interactive-auth commands keep their bounded window (silent browser waits are expected and the
      // keepalive below pins the central watchdog for its duration). Every other command drops the
      // fixed execution-duration cap and is governed solely by the central no-response watchdog, which
      // terminates it only after TOOL_IDLE_TIMEOUT_MS elapse with no real output.
      const terminalTimeoutMs = interactiveAuthCommand ? timeoutMs : NO_RESPONSE_BACKSTOP_MS;

      this.logger.info(
        `Preparing to execute command`,
        'ExecuteCommandTool',
        { executionId, commandLine, timeoutMs, terminalTimeoutMs, interactiveAuthCommand, cwd: args.cwd, shell: args.shell, background: args.background }
      );

      // 2.5. Background execution mode
      if (args.background) {
        await this.waitForPythonRuntimeIfNeeded(commandLine);
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
      const executionContext = options?.executionContext === undefined
        ? BuiltinToolsManager.getExecutionContext()
        : options.executionContext;

      const terminalConfig: TerminalConfig = {
        command: commandLine,
        args: [], // command already includes arguments
        cwd: args.cwd,
        type: 'command',
        shell: args.shell,
        timeoutMs: terminalTimeoutMs,
        maxOutputLength: MAX_OUTPUT_CHARS,
        persistent: false
      };

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

      await this.waitForPythonRuntimeIfNeeded(commandLine);

      const runTerminalOnce = async () => {
        let runCancelledByUser = false;
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

        instance.on('stdout', (chunk) => {
          executionContext?.reportActivity?.();
          const update = appendOutput(liveStdout, chunk);
          liveStdout = update.next;
          liveTruncated = liveTruncated || update.truncated;
          this.emitPartialResult(executionId, args, commandLine, timeoutMs, liveStdout, liveStderr, liveTruncated, startTime);
        });

        instance.on('stderr', (chunk) => {
          executionContext?.reportActivity?.();
          const normalized = chunk.endsWith('\n') ? chunk : `${chunk}\n`;
          const update = appendOutput(liveStderr, normalized);
          liveStderr = update.next;
          liveTruncated = liveTruncated || update.truncated;
          this.emitPartialResult(executionId, args, commandLine, timeoutMs, liveStdout, liveStderr, liveTruncated, startTime);
        });

        const cancellationRegistration = executionContext?.registerCancellationHandler?.(async () => {
          runCancelledByUser = true;
          await terminalManager.stopInstance(instance.id, true);
        });

        // Honor the AbortSignal so the central no-response watchdog (and user cancellation, which also
        // aborts the signal) can tear down the terminal. execute_command otherwise ignores the signal
        // and relies only on the cancellation handler above, which the idle watchdog never invokes.
        const signal = options?.signal;
        const onSignalAbort = () => {
          runCancelledByUser = true;
          void terminalManager.stopInstance(instance.id, true);
        };
        if (signal) {
          if (signal.aborted) {
            onSignalAbort();
          } else {
            signal.addEventListener('abort', onSignalAbort, { once: true });
          }
        }

        // Interactive-auth commands often wait silently for the user to complete sign-in. Pin the
        // central watchdog at a steady cadence so the wait is not mistaken for "no response"; the
        // bounded terminal timeout above still caps the overall auth window.
        const reportActivity = executionContext?.reportActivity;
        let authKeepaliveHandle: NodeJS.Timeout | undefined;
        if (interactiveAuthCommand && reportActivity) {
          authKeepaliveHandle = setInterval(() => reportActivity(), INTERACTIVE_AUTH_KEEPALIVE_MS);
        }

        if (executionContext?.cancellationToken.isCancellationRequested) {
          if (authKeepaliveHandle) clearInterval(authKeepaliveHandle);
          if (signal) signal.removeEventListener('abort', onSignalAbort);
          cancellationRegistration?.dispose();
          await terminalManager.stopInstance(instance.id, true);
          throw new CancellationError('Command execution cancelled before completion');
        }

        try {
          await instance.start();
          return {
            result: await instance.execute(),
            cancelledByUser: runCancelledByUser,
          };
        } finally {
          if (authKeepaliveHandle) clearInterval(authKeepaliveHandle);
          if (signal) signal.removeEventListener('abort', onSignalAbort);
          cancellationRegistration?.dispose();
          await terminalManager.stopInstance(instance.id, true);
        }
      };

      let terminalRun = await runTerminalOnce();
      let { result } = terminalRun;
      let finalCancelledByUser = terminalRun.cancelledByUser;
      if (
        !finalCancelledByUser
        && this.isMissingPipResult(result)
        && this.isPythonOrPipCommand(commandLine)
        && this.isInternalRuntimeMode()
      ) {
        this.logger.info(
          'Command reported missing pip in app-managed Python; attempting one repair before retry',
          'ExecuteCommandTool',
          { executionId, commandLine },
        );
        const repaired = await this.repairMissingPipForCommand(commandLine);
        if (repaired) {
          terminalRun = await runTerminalOnce();
          result = terminalRun.result;
          finalCancelledByUser = terminalRun.cancelledByUser;
        }
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

      const interruptionReason: ExecuteCommandAuthInterruptionReason | null = finalCancelledByUser
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
            shell: args.shell
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
        'Execute a shell command in the selected workspace using the unified terminal manager. Output is truncated to 8000 characters, commands have no fixed execution-time limit and are governed by a unified 10-minute no-response budget (terminated only after 10 minutes elapse with no new output), interactive auth commands like gh auth login keep a 15-minute window for sign-in, and high-risk patterns are blocked by safety checks.\n\n' +
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
        'Python package guidance in app-managed runtime:\n' +
        '- Prefer `pip install <packages>` or `uv pip install <packages>` for Python libraries; app-managed `pip` is a shim to uv and targets the app venv.\n' +
        '- Do not use `python -m pip` or `python3 -m ensurepip` as the first install attempt; if legacy commands report missing pip, the tool repairs the app venv once and retries.\n\n' +
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
    if (/logout|revoke|signout/i.test(src)) {
      return 'this command accesses an OAuth logout/revoke endpoint, which could destroy shared browser SSO state for unrelated applications';
    }
    if (/User Data|Application Support/i.test(src)) {
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

    if (args.shell !== undefined) {
      const allowedShells: Array<ExecuteCommandToolArgs['shell']> = ['powershell', 'cmd', 'bash', 'sh', 'zsh'];
      if (!allowedShells.includes(args.shell)) {
        return { isValid: false, error: 'shell must be one of powershell, cmd, bash, sh, zsh when provided' };
      }
    }

    return { isValid: true };
  }
}
