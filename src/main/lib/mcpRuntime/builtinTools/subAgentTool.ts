/**
 * sub_agent — Ad-hoc sub-agent tool
 *
 * Single tool aligned with Claude Code's Agent tool pattern.
 *
 * - Spawns an ad-hoc inline agent with a custom system_prompt and optional tool subset.
 * - `run_in_background` → async fire-and-forget, results delivered at next turn.
 *
 * File location: src/main/lib/mcpRuntime/builtinTools/subAgentTool.ts
 */

import type { ToolExecutionResult } from './types';
import { BuiltinToolsManager } from './builtinToolsManager';
import { createConsoleLogger } from '../../unifiedLogger';
import { CancellationToken, CancellationTokenSource } from '../../cancellation';
import type { ToolExecutionContext } from '../../subAgent/types';

// Lazy-init logger
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

function createLinkedCancellationToken(
  parentToken: CancellationToken,
  signal?: AbortSignal,
): { token: CancellationToken; dispose(): void } {
  if (!signal) {
    return { token: parentToken, dispose: () => {} };
  }

  const source = new CancellationTokenSource();
  const parentRegistration = parentToken.onCancellationRequested(() => source.cancel());
  const abort = () => source.cancel();

  if (parentToken.isCancellationRequested || signal.aborted) {
    source.cancel();
  } else {
    signal.addEventListener('abort', abort, { once: true });
  }

  return {
    token: source.token,
    dispose: () => {
      signal.removeEventListener('abort', abort);
      parentRegistration.dispose();
      source.dispose();
    },
  };
}

function createActivityEventSender(context: any) {
  const sender = context.eventSender;
  if (!sender) {
    return undefined;
  }

  return new Proxy(sender, {
    get(target, prop) {
      if (prop === 'send') {
        const send = Reflect.get(target, prop, target);
        return (...args: unknown[]) => {
          context.reportActivity?.();
          return send.apply(target, args);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export interface SubAgentToolArgs {
  description?: string;
  prompt: string;
  system_prompt?: string;
  tools?: string[];
  model?: string;
  run_in_background?: boolean;
  no_auto_promote?: boolean;
}

export class SubAgentTool {
  static getDefinition() {
    const description =
      'Launch a sub-agent to handle a task. ' +
      'Provide a custom system_prompt and tools to create an ad-hoc agent. ' +
      'Add `run_in_background: true` to run without blocking — results will be delivered as a <task-notification> at your next turn.';

    const properties: Record<string, unknown> = {
      description: {
        type: 'string',
        description: 'A short (3-5 word) description of the task',
      },
      prompt: {
        type: 'string',
        description: 'The task for the sub-agent to perform',
      },
      system_prompt: {
        type: 'string',
        description: 'Custom system prompt for the ad-hoc agent',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional tool subset from the parent agent\'s tool set. Omit or pass [] to inherit the parent MCP tools by default.',
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
    };

    return {
      name: 'sub_agent',
      description,
      inputSchema: {
        type: 'object',
        properties,
        required: ['prompt'],
      },
    };
  }

  static async execute(args: SubAgentToolArgs, options?: { signal?: AbortSignal; executionContext?: ToolExecutionContext | null }): Promise<ToolExecutionResult> {
    try {
      // ── Get execution context ──
      const context = options?.executionContext === undefined
        ? BuiltinToolsManager.getExecutionContext()
        : options.executionContext;
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

      return await SubAgentTool.executeAdhoc(args, context, manager, options?.signal);
    } catch (error) {
      return {
        success: false,
        error: `Failed to spawn sub-agent: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // ─────────────────────────────────────────────────────────
  // Ad-hoc agent path.
  // ─────────────────────────────────────────────────────────
  private static async executeAdhoc(
    args: SubAgentToolArgs,
    context: any,
    manager: any,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    // Background path
    if (args.run_in_background) {
      const asyncResult = await manager.spawnSubAgentAsync({
        parentSessionId: context.chatSessionId,
        parentChatId: context.chatId,
        userAlias: context.userAlias,
        task: args.prompt,
        systemPrompt: args.system_prompt,
        tools: args.tools,
        model: args.model,
        eventSender: context.eventSender,
        correlationId: context.currentToolCallId,
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
      toolCount: args.tools && args.tools.length > 0 ? args.tools.length : 'inherit-parent',
    });

    const linkedCancellation = createLinkedCancellationToken(context.cancellationToken, signal);
    try {
      const result = await manager.spawnAdhocSubAgent({
        parentSessionId: context.chatSessionId,
        parentChatId: context.chatId,
        userAlias: context.userAlias,
        task: args.prompt,
        systemPrompt: args.system_prompt,
        tools: args.tools,
        model: args.model,
        cancellationToken: linkedCancellation.token,
        eventSender: createActivityEventSender(context),
        correlationId: context.currentToolCallId,
        noAutoPromote: args.no_auto_promote,
        onProgress: () => context.reportActivity?.(),
      });

      return SubAgentTool.formatResult(result, result.subAgentName || 'ad-hoc agent');
    } finally {
      linkedCancellation.dispose();
    }
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
