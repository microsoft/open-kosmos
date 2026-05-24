/**
 * CodingAgentTool - Foreground coding agent execution with streaming output.
 *
 * Uses child_process.spawn with piped stdout and --output-format stream-json
 * to get real-time token-by-token streaming from Claude Code CLI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';
import { BuiltinToolDefinition } from './types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';
import { CodingAgentToolArgs, CodingAgentToolResult } from '@shared/types/toolCallArgs';
import { BuiltinToolsManager } from './builtinToolsManager';
import { StreamingChunk } from '@shared/types/streamingTypes';

const MAX_OUTPUT_CHARS = 50000;
const DEFAULT_TIMEOUT_S = 300;
const MAX_TIMEOUT_S = 600;

export class CodingAgentTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  /**
   * Extract text content from a Claude Code stream-json line.
   *
   * Recognized event shapes:
   *   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
   *   {"type":"result",...,"result":"full text"}
   */
  private static extractStreamText(jsonLine: string): { text: string | null; isResult: boolean; resultText: string | null } {
    try {
      const obj = JSON.parse(jsonLine);

      // Token-level delta — the main streaming path
      if (obj?.type === 'stream_event' && obj?.event?.type === 'content_block_delta') {
        const delta = obj.event.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          return { text: delta.text, isResult: false, resultText: null };
        }
      }

      // Final result event — contains the complete output
      if (obj?.type === 'result' && typeof obj.result === 'string') {
        return { text: null, isResult: true, resultText: obj.result };
      }

      return { text: null, isResult: false, resultText: null };
    } catch {
      // Not valid JSON — ignore (could be a partial line)
      return { text: null, isResult: false, resultText: null };
    }
  }

  /**
   * Build CLI arguments for Claude Code in stream-json mode.
   * Returns the argument array (NOT a shell command string) for spawn().
   */
  private static buildClaudeArgs(task: string): string[] {
    return [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--dangerously-skip-permissions',
      task
    ];
  }

  /**
   * Check if Claude Code CLI is available and return its path
   */
  private static findCliPath(): string | null {
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';

    try {
      const result = execSync(`${whichCommand} claude`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim().split('\n')[0].trim();
    } catch {
      return null;
    }
  }

  /**
   * Emit partial result for real-time streaming to UI
   */
  private static emitPartialResult(
    executionId: string,
    args: CodingAgentToolArgs,
    output: string,
    truncated: boolean,
    startTime: number
  ): void {
    const context = BuiltinToolsManager.getExecutionContext();
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
      truncated: truncated || undefined
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
        isPartial: true
      }
    };

    context.eventSender.send('agentChat:streamingChunk', chunk);
  }

  /**
   * Execute Claude Code CLI using child_process.spawn with piped stdio.
   * This gives us clean JSON-line stdout without PTY terminal wrapping.
   */
  private static executeClaudeViaSpawn(
    cliPath: string,
    args: CodingAgentToolArgs,
    resolvedCwd: string,
    timeoutMs: number,
    executionId: string,
    startTime: number
  ): Promise<CodingAgentToolResult> {
    return new Promise((resolve) => {
      const cliArgs = this.buildClaudeArgs(args.task);

      this.logger.info(
        'Spawning Claude Code via child_process.spawn',
        'CodingAgentTool',
        { executionId, cliPath, args: cliArgs.slice(0, -1), cwd: resolvedCwd, timeoutMs }
      );

      const child: ChildProcess = spawn(cliPath, cliArgs, {
        cwd: resolvedCwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // On Windows, spawn needs shell:false (default) to avoid quoting issues
        // since we pass task as a direct argument, not a shell command
      });

      let output = '';
      let finalResultText: string | null = null;
      let truncated = false;
      let timedOut = false;
      let lineBuf = '';
      let settled = false;

      const settleResult = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);

        const durationMs = Date.now() - startTime;
        const finalOutput = finalResultText ?? output;

        this.logger.info(
          'Coding agent execution completed',
          'CodingAgentTool',
          {
            executionId,
            exitCode,
            timedOut,
            durationMs,
            outputLength: finalOutput.length,
            truncated,
            usedResultEvent: finalResultText != null
          }
        );

        resolve({
          task: args.task,
          output: finalOutput.trim(),
          exitCode,
          timedOut,
          durationMs,
          cwd: resolvedCwd,
          truncated: truncated || undefined
        });
      };

      // Timeout handler
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        this.logger.warn(
          'Coding agent execution timed out',
          'CodingAgentTool',
          { executionId, pid: child.pid, timeoutMs }
        );
        child.kill('SIGKILL');
        settleResult(null);
      }, timeoutMs);

      // Process stdout: JSON lines from stream-json format
      child.stdout?.on('data', (chunk: Buffer) => {
        const data = chunk.toString('utf-8');
        lineBuf += data;

        // Split by newlines to get complete JSON lines
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() || '';

        let newTextThisChunk = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const { text, isResult, resultText } = this.extractStreamText(trimmed);

          if (text && !truncated) {
            if (output.length + text.length > MAX_OUTPUT_CHARS) {
              const remaining = MAX_OUTPUT_CHARS - output.length;
              if (remaining > 0) {
                output += text.slice(0, remaining);
              }
              truncated = true;
            } else {
              output += text;
            }
            newTextThisChunk = true;
          }

          if (isResult && resultText) {
            finalResultText = resultText;
          }
        }

        if (newTextThisChunk) {
          this.emitPartialResult(executionId, args, output, truncated, startTime);
        }
      });

      // Capture stderr for diagnostics
      let stderrBuf = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
        // Log stderr periodically to help debug issues
        if (stderrBuf.length > 500) {
          this.logger.debug(
            'Claude Code stderr output',
            'CodingAgentTool',
            { executionId, stderr: stderrBuf.slice(0, 500) }
          );
          stderrBuf = '';
        }
      });

      // Close stdin immediately — claude -p reads task from args, not stdin
      child.stdin?.end();

      child.on('close', (code) => {
        // Process any remaining data in lineBuf
        if (lineBuf.trim()) {
          const { text, isResult, resultText } = this.extractStreamText(lineBuf.trim());
          if (text && !truncated) {
            output += text;
          }
          if (isResult && resultText) {
            finalResultText = resultText;
          }
        }
        settleResult(code);
      });

      child.on('error', (err) => {
        this.logger.error(
          'Claude Code spawn error',
          'CodingAgentTool',
          { executionId, error: err.message }
        );
        settleResult(1);
      });
    });
  }

  /**
   * Execute the coding agent tool in foreground mode with streaming output
   */
  static async execute(args: CodingAgentToolArgs, options?: { signal?: AbortSignal }): Promise<CodingAgentToolResult> {
    const executionId = `coding_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();

    this.logger.info(
      'CodingAgentTool execution started',
      'CodingAgentTool',
      { executionId, cwd: args.cwd }
    );

    try {
      // Validate arguments
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

      // Check CLI exists
      const cliPath = this.findCliPath();
      if (!cliPath) {
        throw new Error('Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code');
      }

      // Normalize timeout
      let timeoutSeconds = args.timeoutSeconds ?? DEFAULT_TIMEOUT_S;
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1) {
        timeoutSeconds = DEFAULT_TIMEOUT_S;
      }
      timeoutSeconds = Math.min(timeoutSeconds, MAX_TIMEOUT_S);
      const timeoutMs = timeoutSeconds * 1000;

      return await this.executeClaudeViaSpawn(cliPath, args, resolvedCwd, timeoutMs, executionId, startTime);

    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(
        'Coding agent execution failed',
        'CodingAgentTool',
        { executionId, error: errorMessage, durationMs }
      );

      return {
        task: args.task || '',
        output: `Error: ${errorMessage}`,
        exitCode: 1,
        timedOut: false,
        durationMs,
        cwd: args.cwd || ''
      };
    }
  }

  /**
   * Get tool definition for registration
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'coding_agent',
      description:
        'Spawn Claude Code CLI to perform SOFTWARE ENGINEERING tasks ' +
        'that require reading, writing, or modifying code in a repository or project directory.\n\n' +
        'Use this tool ONLY when the task requires an autonomous coding agent working inside a codebase — ' +
        'for example: implementing features, fixing bugs, refactoring code, writing tests, or analyzing a project\'s source code.\n\n' +
        'DO NOT use this tool when a first-class tool already exists for the action. Specifically:\n' +
        '- For web browsing or scraping → use browser/playwright tools directly\n' +
        '- For web search → use bing_web_search or other search tools\n' +
        '- For file read/write → use read_file, write_file, etc.\n' +
        '- For shell commands → use execute_command\n' +
        '- For general Q&A or analysis → answer directly without tools\n\n' +
        'The cwd parameter must point to the project/repository root directory where the coding work should happen. ' +
        'The tool streams output in real-time and returns the complete result when done. ' +
        'Chat is blocked during execution (foreground mode). ' +
        `Output is capped at ${MAX_OUTPUT_CHARS} characters. Default timeout is ${DEFAULT_TIMEOUT_S}s, max ${MAX_TIMEOUT_S}s.`,
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
          },
          timeoutSeconds: {
            type: 'number',
            description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}).`
          }
        },
        required: ['task', 'cwd']
      }
    };
  }
}
