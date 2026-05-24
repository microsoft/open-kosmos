/**
 * SubAgentToolExecutor — Tool execution logic extracted from SubAgentChat
 *
 * Handles executing tool calls via BuiltinToolsManager / mcpClientManager,
 * tracking file deliverables, and formatting deliverables sections.
 */

import type { Message } from '@shared/types/chatTypes';
import { MessageHelper } from '@shared/types/chatTypes';
import type { SubAgentChatOptions } from './types';
import { createConsoleLogger } from '../unifiedLogger';
import { BuiltinToolsManager } from '../mcpRuntime/builtinTools/builtinToolsManager';
import { mcpClientManager } from '../mcpRuntime/mcpClientManager';

// Lazy-init logger
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/** Set of tool names that produce file output (used for automatic deliverables tracking) */
export const FILE_OUTPUT_TOOLS = new Set([
  'write_file', 'create_file', 'append_to_file', 'download_file',
]);

/**
 * Generate a short human-readable summary of tool call arguments.
 *
 * Uses generic matching based on argument semantics, no hard-coded tool names needed.
 * Prioritizes common parameter names (query/url/path/command etc.), falls back to the first string parameter.
 *
 * @returns Short description (<=200 characters), e.g., "bing_web_search: GitHub Copilot CLI"
 */
export function summarizeToolArgs(toolName: string, toolArgs: Record<string, unknown>): string {
  const MAX_LEN = 200;
  const PRIORITY_KEYS = ['query', 'url', 'path', 'file_path', 'filePath', 'command', 'content'];
  try {
    const key = PRIORITY_KEYS.find(k => typeof toolArgs[k] === 'string');
    if (key) {
      const value = String(toolArgs[key]);
      const summary = `${toolName}: ${value}`;
      return summary.length > MAX_LEN ? summary.substring(0, MAX_LEN - 3) + '...' : summary;
    }
    // Fallback: take the first string-type value
    for (const [, v] of Object.entries(toolArgs)) {
      if (typeof v === 'string' && v.length > 0) {
        const summary = `${toolName}: ${v}`;
        return summary.length > MAX_LEN ? summary.substring(0, MAX_LEN - 3) + '...' : summary;
      }
    }
    return toolName;
  } catch {
    return toolName;
  }
}

export class SubAgentToolExecutor {
  private readonly options: SubAgentChatOptions;
  private readonly deliverables: string[];
  private readonly compressToolResult: (content: string, toolName: string, originalLength: number) => Promise<string>;
  /** Summarize threshold — tool results above this length are compressed */
  private static readonly SUMMARIZE_THRESHOLD = 15000;

  constructor(
    options: SubAgentChatOptions,
    deliverables: string[],
    compressToolResult: (content: string, toolName: string, originalLength: number) => Promise<string>,
  ) {
    this.options = options;
    this.deliverables = deliverables;
    this.compressToolResult = compressToolResult;
  }

  /**
   * Execute tool calls — reuses MCPClientManager.
   *
   * Design reference: AgentChat.executeToolCall()
   * - Each tool call has independent try/catch (non-fatal strategy)
   * - Dispatched uniformly via mcpClientManager.executeTool()
   * - Sets ToolExecutionContext (isSubAgent = true -> blocks recursive spawn_subagent)
   */
  async executeToolCalls(toolCalls: any[], turnCount: number): Promise<Message[]> {
    const results: Message[] = [];

    // Set sub-agent execution context (isSubAgent = true -> blocks recursive spawn_subagent calls)
    BuiltinToolsManager.setExecutionContext({
      chatSessionId: this.options.subAgent.parentSessionId,
      chatId: this.options.subAgent.parentChatId,
      userAlias: this.options.subAgent.userAlias,
      cancellationToken: this.options.cancellationToken,
      isSubAgent: true, // Recursive spawn prevention flag
      getSubAgentConfig: () => undefined, // Sub-agents cannot query other sub-agents
      getParentContextSummary: async () => '', // Sub-agents cannot access parent context
      registerCancellationHandler: () => ({ dispose: () => {} }),
    });

    try {
      for (const toolCall of toolCalls) {
        // Check cancellation
        if (this.options.cancellationToken.isCancellationRequested) {
          results.push(MessageHelper.createToolMessage(
            'Tool execution cancelled',
            toolCall.id,
            toolCall.function.name,
          ));
          continue;
        }

        getLogger().info?.(
          `[SubAgentChat] Executing tool '${toolCall.function.name}' (id=${toolCall.id})`,
          'executeToolCalls'
        );

        // Parse tool arguments (pre-parse for onStepUpdate summary)
        let toolArgs: Record<string, unknown> = {};
        const rawArgs = toolCall.function.arguments || '{}';
        try {
          toolArgs = JSON.parse(rawArgs);
        } catch (parseErr) {
          // Parsing still failed even after normalization — log detailed info
          getLogger().warn?.(
            `[SubAgentChat] Failed to parse tool arguments for '${toolCall.function.name}' ` +
            `(id=${toolCall.id}). Using empty args. ` +
            `Raw: "${String(rawArgs).substring(0, 300)}". ` +
            `Error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
            'executeToolCalls'
          );
          toolArgs = {};
        }

        // Step update: tool execution started
        const toolStartTime = Date.now();
        this.options.onStepUpdate?.({
          type: 'tool_start',
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          toolArgsSummary: summarizeToolArgs(toolCall.function.name, toolArgs),
          turn: turnCount + 1,
        });

        try {
          // Dispatch uniformly via MCPClientManager
          // Pass sub-agent's resolved MCP server names for per-agent tool routing
          const subAgent = this.options.subAgent;
          const agentMcpServerNames = (subAgent.resolvedMcpServers.length > 0
            ? subAgent.resolvedMcpServers
            : subAgent.config.mcp_servers || []
          ).map((s: any) => s.name);
          const toolResult = await mcpClientManager.executeTool({
            toolName: toolCall.function.name,
            toolArgs,
            agentMcpServerNames,
          });

          // Build standard tool result message
          let resultContent = typeof toolResult === 'string'
            ? toolResult
            : JSON.stringify(toolResult);

          // Smart compression for oversized tool results
          const originalLength = resultContent.length;
          if (originalLength > SubAgentToolExecutor.SUMMARIZE_THRESHOLD) {
            resultContent = await this.compressToolResult(
              resultContent,
              toolCall.function.name,
              originalLength
            );
          }

          getLogger().info?.(
            `[SubAgentChat] Tool '${toolCall.function.name}' executed successfully ` +
            `(resultLength=${originalLength}${originalLength !== resultContent.length ? `, compressedTo=${resultContent.length}` : ''})`,
            'executeToolCalls'
          );

          // Step update: tool execution completed
          this.options.onStepUpdate?.({
            type: 'tool_done',
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            turn: turnCount + 1,
            durationMs: Date.now() - toolStartTime,
            toolResultLength: originalLength,
          });

          // Track file outputs (deliverables)
          this.trackDeliverables(toolCall.function.name, toolArgs);

          results.push(MessageHelper.createToolMessage(
            resultContent,
            toolCall.id,
            toolCall.function.name,
          ));

        } catch (error) {
          // Non-fatal strategy: tool failure converted to error message
          getLogger().error?.(
            `[SubAgentChat] Tool '${toolCall.function.name}' execution failed: ` +
            `${error instanceof Error ? error.message : String(error)}`,
            'executeToolCalls'
          );

          // Step update: tool execution failed
          this.options.onStepUpdate?.({
            type: 'tool_error',
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            turn: turnCount + 1,
            durationMs: Date.now() - toolStartTime,
          });

          results.push(MessageHelper.createToolMessage(
            `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
            toolCall.id,
            toolCall.function.name,
          ));
        }
      }
    } finally {
      // Ensure execution context is cleaned up
      BuiltinToolsManager.clearExecutionContext();
    }

    return results;
  }

  /**
   * Track file outputs during sub-agent execution.
   *
   * Called after successful tool execution, extracts file paths from tool arguments and records them.
   * Supports: write_file, create_file, append_to_file, download_file, present_deliverables
   */
  trackDeliverables(toolName: string, toolArgs: Record<string, unknown>): void {
    try {
      if (FILE_OUTPUT_TOOLS.has(toolName)) {
        // write_file, create_file, append_to_file use filePath parameter
        const filePath = toolArgs.filePath || toolArgs.file_path;
        if (typeof filePath === 'string' && filePath && !this.deliverables.includes(filePath)) {
          this.deliverables.push(filePath);
        }
        // download_file uses saveDirectory + filename
        if (toolName === 'download_file') {
          const dir = toolArgs.saveDirectory || toolArgs.save_directory;
          const filename = toolArgs.filename;
          if (typeof dir === 'string' && typeof filename === 'string') {
            const sep = dir.includes('\\') ? '\\' : '/';
            const fullPath = `${dir}${sep}${filename}`;
            if (!this.deliverables.includes(fullPath)) {
              this.deliverables.push(fullPath);
            }
          }
        }
      } else if (toolName === 'present_deliverables') {
        // present_deliverables uses filePaths array
        const filePaths = toolArgs.filePaths;
        if (Array.isArray(filePaths)) {
          for (const fp of filePaths) {
            if (typeof fp === 'string' && fp && !this.deliverables.includes(fp)) {
              this.deliverables.push(fp);
            }
          }
        }
      }
    } catch {
      // Non-fatal — tracking failure doesn't affect main flow
    }
  }

  /**
   * Format deliverables info section.
   *
   * When the sub-agent has created files, appended to the result end to ensure parent Agent awareness.
   */
  formatDeliverablesSection(): string {
    if (this.deliverables.length === 0) return '';
    const fileList = this.deliverables.map(fp => `- ${fp}`).join('\n');
    return `\n\n---\n**Deliverables** (${this.deliverables.length} file(s) created/modified):\n${fileList}`;
  }
}
