/**
 * sub_agent — Unified sub-agent tool
 *
 * Replaces the 4 legacy tools (spawn_subagent, spawn_subagents, spawn_adhoc_subagent,
 * spawn_adhoc_subagents) with a single tool aligned with Claude Code's Agent tool pattern.
 *
 * - When `subagent_type` is provided → spawns a pre-configured named agent
 * - When omitted → spawns an ad-hoc inline agent
 * - `run_in_background` → async fire-and-forget, results delivered at next turn
 *
 * File location: src/main/lib/mcpRuntime/builtinTools/subAgentTool.ts
 */

import type { ToolExecutionResult } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';
import { createConsoleLogger } from '../../unifiedLogger';

// Lazy-init logger
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

export interface SubAgentToolArgs {
  description?: string;
  prompt: string;
  subagent_type?: string;
  system_prompt?: string;
  tools?: string[];
  model?: string;
  run_in_background?: boolean;
  no_auto_promote?: boolean;
}

export class SubAgentTool {
  static getDefinition() {
    return {
      name: 'sub_agent',
      description:
        'Launch a sub-agent to handle a task. ' +
        'Use `subagent_type` to spawn a pre-configured agent, or omit it to create an ad-hoc agent with custom system_prompt and tools. ' +
        'Add `run_in_background: true` to run without blocking — results will be delivered as a <task-notification> at your next turn.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A short (3-5 word) description of the task',
          },
          prompt: {
            type: 'string',
            description: 'The task for the sub-agent to perform',
          },
          subagent_type: {
            type: 'string',
            description: 'Name of a pre-configured sub-agent. Omit to create an ad-hoc agent.',
          },
          system_prompt: {
            type: 'string',
            description: 'Custom system prompt (ad-hoc mode only; ignored when subagent_type is set)',
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tool subset from parent\'s tool set (ad-hoc only; empty = inherit all)',
          },
          model: {
            type: 'string',
            description: 'Model override (default: inherit from parent)',
          },
          run_in_background: {
            type: 'boolean',
            description: 'Run without blocking. Results delivered as <task-notification> at your next turn.',
            default: false,
          },
          no_auto_promote: {
            type: 'boolean',
            description: 'Disable auto-promotion to background after 120s (default: false)',
            default: false,
          },
        },
        required: ['prompt'],
      },
    };
  }

  static async execute(args: SubAgentToolArgs, options?: { signal?: AbortSignal }): Promise<ToolExecutionResult> {
    try {
      // ── Get execution context ──
      const context = BuiltinToolsManager.getExecutionContext();
      if (!context) {
        return {
          success: false,
          error: 'No execution context available — sub_agent can only be called during an active chat session',
        };
      }

      // ── Recursion guard ──
      if (context.isSubAgent) {
        return {
          success: false,
          error: 'Sub-agents cannot spawn other sub-agents (recursion not allowed)',
        };
      }

      const { SubAgentManager } = await import('../../subAgent/subAgentManager');
      const manager = SubAgentManager.getInstance();

      // ── Route: named agent vs ad-hoc ──
      if (args.subagent_type) {
        return await SubAgentTool.executeNamed(args, context, manager);
      } else {
        return await SubAgentTool.executeAdhoc(args, context, manager);
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to spawn sub-agent: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ─────────────────────────────────────────────────────────
  // Named agent path (equivalent to old spawn_subagent)
  // ─────────────────────────────────────────────────────────
  private static async executeNamed(
    args: SubAgentToolArgs,
    context: any,
    manager: any,
  ): Promise<ToolExecutionResult> {
    const subAgentName = args.subagent_type!;

    // Validate sub-agent existence
    const subAgentConfig = context.getSubAgentConfig(subAgentName);
    if (!subAgentConfig) {
      return {
        success: false,
        error: `Sub-agent "${subAgentName}" not found or not enabled for this agent`,
      };
    }

    // Background path
    if (args.run_in_background) {
      const asyncResult = await manager.spawnSubAgentAsync({
        parentSessionId: context.chatSessionId,
        parentChatId: context.chatId,
        userAlias: context.userAlias,
        subAgentName,
        task: args.prompt,
        eventSender: context.eventSender,
        correlationId: context.currentToolCallId,
      });
      if (asyncResult.status === 'error') {
        return {
          success: false,
          error: asyncResult.error || `Failed to launch background sub-agent "${subAgentName}"`,
        };
      }
      return {
        success: true,
        data: `Sub-agent "${subAgentName}" launched in background (taskId: ${asyncResult.taskId}). Results will be delivered at your next turn. Use get_subagent_status to check progress.`,
      };
    }

    // Sync path
    getLogger().info?.('[SubAgentTool] Spawning named sub-agent', 'executeNamed', {
      subAgentName,
    });

    const result = await manager.spawnSubAgent({
      parentSessionId: context.chatSessionId,
      parentChatId: context.chatId,
      userAlias: context.userAlias,
      subAgentName,
      task: args.prompt,
      cancellationToken: context.cancellationToken,
      eventSender: context.eventSender,
      correlationId: context.currentToolCallId,
      noAutoPromote: args.no_auto_promote,
    });

    return SubAgentTool.formatResult(result, subAgentName);
  }

  // ─────────────────────────────────────────────────────────
  // Ad-hoc agent path (equivalent to old spawn_adhoc_subagent)
  // ─────────────────────────────────────────────────────────
  private static async executeAdhoc(
    args: SubAgentToolArgs,
    context: any,
    manager: any,
  ): Promise<ToolExecutionResult> {
    // Background path
    if (args.run_in_background) {
      const asyncResult = await manager.spawnSubAgentAsync({
        parentSessionId: context.chatSessionId,
        parentChatId: context.chatId,
        userAlias: context.userAlias,
        subAgentName: `adhoc-${Date.now()}`,
        task: args.prompt,
        systemPrompt: args.system_prompt,
        tools: args.tools,
        model: args.model,
        eventSender: context.eventSender,
        correlationId: context.currentToolCallId,
        adhoc: true,
      });
      if (asyncResult.status === 'error') {
        return {
          success: false,
          error: asyncResult.error || 'Failed to launch background ad-hoc sub-agent',
        };
      }
      return {
        success: true,
        data: `Ad-hoc sub-agent launched in background (taskId: ${asyncResult.taskId}). Results will be delivered at your next turn. Use get_subagent_status to check progress.`,
      };
    }

    // Sync path
    getLogger().info?.('[SubAgentTool] Spawning ad-hoc sub-agent', 'executeAdhoc', {
      hasCustomPrompt: !!args.system_prompt,
      toolCount: args.tools?.length ?? 'all',
    });

    const result = await manager.spawnAdhocSubAgent({
      parentSessionId: context.chatSessionId,
      parentChatId: context.chatId,
      userAlias: context.userAlias,
      task: args.prompt,
      systemPrompt: args.system_prompt,
      tools: args.tools,
      model: args.model,
      cancellationToken: context.cancellationToken,
      eventSender: context.eventSender,
      correlationId: context.currentToolCallId,
      noAutoPromote: args.no_auto_promote,
    });

    return SubAgentTool.formatResult(result, result.subAgentName || 'ad-hoc agent');
  }

  // ─────────────────────────────────────────────────────────
  // Shared result formatter
  // ─────────────────────────────────────────────────────────
  private static formatResult(result: any, agentLabel: string): ToolExecutionResult {
    if (result.autoPromoted) {
      return {
        success: true,
        data: result.result,
      };
    }

    if (result.success) {
      let resultData = `Sub-agent "${agentLabel}" completed task (${result.turnCount} turns, ${(result.durationMs / 1000).toFixed(1)}s):\n\n${result.result}`;
      if (result.availabilityWarnings?.length) {
        const warningBlock = `⚠️ Sub-agent "${agentLabel}" operated with reduced capabilities:\n`
          + result.availabilityWarnings.map((w: string) => `- ${w}`).join('\n') + '\n\n';
        resultData = warningBlock + resultData;
      }
      return { success: true, data: resultData };
    } else {
      if (result.partialResult) {
        return {
          success: true,
          data: `⚠️ Sub-agent "${agentLabel}" failed after ${result.turnCount} turns (${(result.durationMs / 1000).toFixed(1)}s), but produced partial results:\n\n${result.partialResult}`,
        };
      }
      return {
        success: false,
        error: `Sub-agent "${agentLabel}" failed: ${result.error}`,
      };
    }
  }
}
