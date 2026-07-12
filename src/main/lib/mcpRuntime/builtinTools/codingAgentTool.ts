/**
 * CodingAgentTool - Foreground coding agent execution.
 *
 * Drives a user-selected external coding CLI (Claude Code, Codex, Gemini, or GitHub Copilot) to
 * perform a single software-engineering task in a target repository. The CLI is chosen via a
 * profile-level setting (Settings -> Coding CLI); OpenKosmos only detects availability and invokes the
 * CLI - it never installs or updates it.
 *
 * Execution is final-only: OpenKosmos waits for the CLI's final response and never captures
 * intermediate tool calls/results. A lightweight elapsed-time heartbeat keeps the UI alive while
 * the CLI runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { BuiltinToolDefinition } from './types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';
import { CodingAgentToolArgs, CodingAgentToolResult } from '@shared/types/toolCallArgs';
import { StreamingChunk } from '@shared/types/streamingTypes';
import { CODING_CLI_IDS } from '@shared/types/codingCli';
import { profileCacheManager } from '../../userDataADO';
import { getAdapter, detectCliPath, DEFAULT_CODING_CLI_ID } from './codingCli/registry';
import type { CodingCliId, CodingCliAdapter } from './codingCli/types';
import type { ToolExecutionContext } from '../../subAgent/types';
import { InactivityTimer, TOOL_IDLE_TIMEOUT_MS } from '../toolTimeoutPolicy';

const MAX_OUTPUT_CHARS = 50000;
const MAX_STDOUT_CAPTURE = 2_000_000;
const MAX_STDERR_CAPTURE = 20_000;
const HEARTBEAT_INTERVAL_MS = 5000;

type CodingAgentToolExecuteOptions = {
  signal?: AbortSignal;
  executionContext?: ToolExecutionContext | null;
};

export class CodingAgentTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  /**
   * Resolve which coding CLI to drive.
   * Priority: captured profile setting -> active profile setting -> default.
   */
  private static resolveCliId(executionContext?: ToolExecutionContext | null): CodingCliId {
    try {
      const alias = executionContext?.userAlias ?? profileCacheManager.getCurrentUserAlias();
      if (alias) {
        const settings = profileCacheManager.getCodingAgentSettings(alias);
        if (settings?.cli && CODING_CLI_IDS.includes(settings.cli)) {
          return settings.cli;
        }
      }
    } catch (error) {
      this.logger.warn(
        'Failed to resolve coding CLI from profile; falling back to default',
        'CodingAgentTool',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
    return DEFAULT_CODING_CLI_ID;
  }

  /**
   * Emit a partial tool_result to keep the UI stream alive during execution.
   * Used for the initial frame (empty output, just to surface the resolved CLI) and for
   * subsequent elapsed-time heartbeats; the final result replaces this content.
   */
  private static emitPartial(
    args: CodingAgentToolArgs,
    cli: CodingCliId,
    output: string,
    startTime: number,
    executionContext?: ToolExecutionContext | null
  ): void {
    const context = executionContext;
    if (!context?.eventSender || !context.currentToolCallId) {
      return;
    }

    const partialResult: CodingAgentToolResult = {
      task: args.task,
      output,
      exitCode: null,
      timedOut: false,
      durationMs: Date.now() - startTime,
      cwd: args.cwd,
      cli,
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
        tool_name: 'coding_agent',
        content: JSON.stringify(partialResult, null, 2),
        isError: false,
        isPartial: true,
      },
    };

    context.eventSender.send('agentChat:streamingChunk', chunk);
  }

  private static isWindowsCommandShim(cliPath: string): boolean {
    return process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath);
  }

  private static resolveWindowsNpmShim(cliPath: string): { command: string; argsPrefix: string[] } | null {
    if (!this.isWindowsCommandShim(cliPath)) {
      return null;
    }

    let contents: string;
    try {
      contents = fs.readFileSync(cliPath, 'utf-8');
    } catch {
      return null;
    }
    const match = contents.match(/"(?<rawTarget>%(?:dp0%|~dp0)[^"]+?\.(?<extension>js|mjs|cjs|exe))"\s+%\*/i);
    if (!match?.groups?.rawTarget || !match.groups.extension) {
      return null;
    }

    const winPath = path.win32;
    const shimDir = winPath.dirname(cliPath);
    const relativeTarget = match.groups.rawTarget
      .replace(/^%dp0%[\\/]+/i, '')
      .replace(/^%~dp0[\\/]*/i, '');
    const targetPath = winPath.resolve(shimDir, relativeTarget.replace(/[\\/]+/g, winPath.sep));
    if (match.groups.extension.toLowerCase() === 'exe') {
      return { command: targetPath, argsPrefix: [] };
    }

    const localNodePath = winPath.join(shimDir, 'node.exe');
    const command = fs.existsSync(localNodePath) ? localNodePath : 'node';
    return { command, argsPrefix: [targetPath] };
  }

  private static resolveSpawnTarget(cliPath: string, cliArgs: string[]): { command: string; args: string[]; shell: boolean } {
    if (!this.isWindowsCommandShim(cliPath)) {
      return { command: cliPath, args: cliArgs, shell: false };
    }

    const shim = this.resolveWindowsNpmShim(cliPath);
    if (!shim) {
      throw new Error(`Unsupported Windows CLI shim: ${cliPath}. Install the supported npm CLI package so OpenKosmos can invoke it without cmd.exe.`);
    }

    return { command: shim.command, args: [...shim.argsPrefix, ...cliArgs], shell: false };
  }

  /**
   * Spawn the resolved CLI with piped stdio, wait for its final response, and resolve a result.
   * Final-only: intermediate tool calls/results are never captured.
   */
  private static executeViaSpawn(
    adapter: CodingCliAdapter,
    cliPath: string,
    args: CodingAgentToolArgs,
    resolvedCwd: string,
    timeoutMs: number,
    executionId: string,
    startTime: number,
    executionContext?: ToolExecutionContext | null,
    signal?: AbortSignal
  ): Promise<CodingAgentToolResult> {
    return new Promise((resolve) => {
      const cliArgs = adapter.buildArgs(args.task);
      const spawnTarget = this.resolveSpawnTarget(cliPath, cliArgs);

      this.logger.info(
        'Spawning coding CLI',
        'CodingAgentTool',
        { executionId, cli: adapter.id, cliPath, spawnCommand: spawnTarget.command, args: spawnTarget.args.slice(0, -1), cwd: resolvedCwd, timeoutMs }
      );

      const child: ChildProcess = spawn(spawnTarget.command, spawnTarget.args, {
        cwd: resolvedCwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: spawnTarget.shell,
      });

      // Surface the resolved CLI to the UI immediately (empty output, so the view renders no output
      // block) so the tool-call view shows "Coding Agent (<cli>)" / "Running <cli>..." from the
      // first frame instead of the default name. The CLI is settings-driven and absent from the
      // tool args, so this streamed result is the view's only source of truth for which CLI is
      // running before the first heartbeat fires ~5s later.
      this.emitPartial(args, adapter.id, '', startTime, executionContext);

      let stdoutBuf = '';
      let stderrBuf = '';
      let stdoutTruncated = false;
      let timedOut = false;
      let aborted = false;
      let settled = false;

      let idleTimer!: InactivityTimer;
      let heartbeatHandle: NodeJS.Timeout;

      const cleanup = () => {
        idleTimer.dispose();
        clearInterval(heartbeatHandle);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const settle = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        cleanup();

        const durationMs = Date.now() - startTime;
        let finalOutput = aborted
          ? 'Coding agent execution was cancelled.'
          : adapter.extractFinal(stdoutBuf, stderrBuf).trim();
        let truncated = stdoutTruncated;
        if (finalOutput.length > MAX_OUTPUT_CHARS) {
          finalOutput = finalOutput.slice(0, MAX_OUTPUT_CHARS);
          truncated = true;
        }

        this.logger.info(
          'Coding agent execution completed',
          'CodingAgentTool',
          { executionId, cli: adapter.id, exitCode, timedOut, aborted, durationMs, outputLength: finalOutput.length, truncated }
        );

        resolve({
          task: args.task,
          output: finalOutput,
          exitCode,
          timedOut,
          durationMs,
          cwd: resolvedCwd,
          truncated: truncated || undefined,
          cli: adapter.id,
        });
      };

      const onAbort = () => {
        aborted = true;
        this.logger.info(
          'Coding agent execution aborted by signal',
          'CodingAgentTool',
          { executionId, cli: adapter.id, pid: child.pid }
        );
        try {
          child.kill('SIGKILL');
        } catch {
          // process may have already exited
        }
        settle(null);
      };

      // No total-runtime cap: the agent is terminated only after `timeoutMs` elapse with no
      // output on stdout/stderr (the no-response budget). Every chunk re-arms the watchdog via
      // touch(), so a continuously-streaming CLI can run indefinitely.
      idleTimer = new InactivityTimer(timeoutMs, () => {
        timedOut = true;
        this.logger.warn(
          'Coding agent produced no output within the no-response budget; terminating',
          'CodingAgentTool',
          { executionId, cli: adapter.id, pid: child.pid, idleMs: timeoutMs }
        );
        try {
          child.kill('SIGKILL');
        } catch {
          // process may have already exited
        }
        settle(null);
      });

      heartbeatHandle = setInterval(() => {
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        this.emitPartial(args, adapter.id, `${adapter.displayName} is working... ${elapsedSec}s elapsed`, startTime, executionContext);
      }, HEARTBEAT_INTERVAL_MS);

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        idleTimer.touch();
        if (stdoutTruncated) return;
        stdoutBuf += chunk.toString('utf-8');
        if (stdoutBuf.length > MAX_STDOUT_CAPTURE) {
          stdoutBuf = stdoutBuf.slice(0, MAX_STDOUT_CAPTURE);
          stdoutTruncated = true;
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        idleTimer.touch();
        stderrBuf += chunk.toString('utf-8');
        if (stderrBuf.length > MAX_STDERR_CAPTURE) {
          stderrBuf = stderrBuf.slice(-MAX_STDERR_CAPTURE);
        }
      });

      // CLIs read the task from argv, not stdin.
      child.stdin?.end();

      child.on('close', (code) => {
        settle(code);
      });

      child.on('error', (err) => {
        this.logger.error(
          'Coding CLI spawn error',
          'CodingAgentTool',
          { executionId, cli: adapter.id, error: err.message }
        );
        if (!stderrBuf) {
          stderrBuf = err.message;
        }
        settle(1);
      });
    });
  }

  /**
   * Execute the coding agent tool in foreground mode.
   */
  static async execute(args: CodingAgentToolArgs, options?: CodingAgentToolExecuteOptions): Promise<CodingAgentToolResult> {
    const executionId = `coding_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();
    const cli = this.resolveCliId(options?.executionContext);
    const adapter = getAdapter(cli);

    this.logger.info(
      'CodingAgentTool execution started',
      'CodingAgentTool',
      { executionId, cli, cwd: args.cwd }
    );

    try {
      if (!args.task || typeof args.task !== 'string' || !args.task.trim()) {
        throw new Error('task must be a non-empty string');
      }
      if (!args.cwd || typeof args.cwd !== 'string' || !args.cwd.trim()) {
        throw new Error('cwd must be provided and cannot be empty');
      }

      const resolvedCwd = path.resolve(args.cwd);
      if (!fs.existsSync(resolvedCwd)) {
        throw new Error(`cwd directory does not exist: ${resolvedCwd}`);
      }

      const cliPath = await detectCliPath(adapter.binaryName);
      if (!cliPath) {
        throw new Error(`${adapter.displayName} not found. Install with: ${adapter.installHint}`);
      }

      // All builtin tools share one unified no-response budget; coding_agent no longer exposes a
      // tunable timeout. The agent is terminated only after TOOL_IDLE_TIMEOUT_MS elapse with no CLI
      // output (the idle timer below is re-armed on every chunk), so an actively-streaming agent can
      // run indefinitely. The intrinsic timer also protects the sub-agent execution path, which has
      // no central watchdog.
      return await this.executeViaSpawn(adapter, cliPath, args, resolvedCwd, TOOL_IDLE_TIMEOUT_MS, executionId, startTime, options?.executionContext, options?.signal);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        'Coding agent execution failed',
        'CodingAgentTool',
        { executionId, cli, error: errorMessage, durationMs }
      );

      return {
        task: args.task || '',
        output: `Error: ${errorMessage}`,
        exitCode: 1,
        timedOut: false,
        durationMs,
        cwd: args.cwd || '',
        cli,
      };
    }
  }

  /**
   * Get tool definition for registration.
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'coding_agent',
      description:
        'Spawn the configured coding CLI (Claude Code, Codex, Gemini, or GitHub Copilot) to perform ' +
        'SOFTWARE ENGINEERING tasks that require reading, writing, or modifying code in a repository ' +
        'or project directory.\n\n' +
        'Use this tool ONLY when the task requires an autonomous coding agent working inside a codebase - ' +
        'for example: implementing features, fixing bugs, refactoring code, writing tests, or analyzing a project\'s source code.\n\n' +
        'DO NOT use this tool when a first-class tool already exists for the action. Specifically:\n' +
        '- For web browsing or scraping -> use browser/playwright tools directly\n' +
        '- For web search -> use bing_web_search or other search tools\n' +
        '- For file read/write -> use read_file, write_file, etc.\n' +
        '- For shell commands -> use execute_command\n' +
        '- For general Q&A or analysis -> answer directly without tools\n\n' +
        'The cwd parameter must point to the project/repository root directory where the coding work should happen. ' +
        'The tool waits for the CLI\'s final response and returns the complete result when done. ' +
        'Chat is blocked during execution (foreground mode). ' +
        `Output is capped at ${MAX_OUTPUT_CHARS} characters. There is no total-runtime limit; the agent is terminated only after ${TOOL_IDLE_TIMEOUT_MS / 60000} minutes with no output (the unified no-response budget shared by all builtin tools).`,
      inputSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'The software engineering task to perform. Be specific and detailed about what code changes are needed.'
          },
          cwd: {
            type: 'string',
            description: 'The project or repository root directory where the coding agent should work. Must be an actual codebase path (e.g., D:\\\\repo\\\\MyProject), NOT a chat session or temp directory.'
          }
        },
        required: ['task', 'cwd'],
        additionalProperties: false
      }
    };
  }
}
