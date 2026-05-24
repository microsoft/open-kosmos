/**
 * CreateScheduleTool - Built-in tool
 * Allows the LLM to create recurring or one-time scheduled tasks.
 *
 * When triggered, automatically creates a new Chat Session under the target Agent
 * and sends the specified prompt as the first message.
 */

import { BuiltinToolDefinition } from './types';
import { CreateScheduleToolArgs, CreateScheduleToolResult } from '@shared/types/toolCallArgs';
import { generateScheduleJobId } from '../../scheduler/id';
import { schedulerManager } from "../../scheduler/SchedulerManager";
import { agentChatManager } from "../../chat/agentChatManager";

export class CreateScheduleTool {

  /**
   * Execute: create a scheduled task
   */
  static async execute(
    args: CreateScheduleToolArgs,
  ): Promise<CreateScheduleToolResult> {
    try {

      let agentId = args.agent_id;
      if (!agentId) {
        try {
          const currentInstance = agentChatManager.getCurrentInstance();
          agentId = currentInstance?.getChatId();
        } catch {
          // ignore
        }
      }

      if (!agentId) {
        return { success: false, message: 'agent_id is required. Could not determine the target agent.' };
      }

      const hasCronExpression = typeof args.cron_expression === 'string' && args.cron_expression.trim().length > 0;
      const hasRunAt = typeof args.run_at === 'string' && args.run_at.trim().length > 0;

      if (hasCronExpression === hasRunAt) {
        return {
          success: false,
          message: 'Provide exactly one of cron_expression or run_at.',
        };
      }

      const jobId = generateScheduleJobId();
      const scheduleType = hasRunAt ? 'once' : 'cron';

      const success = await schedulerManager.createJob({
        id: jobId,
        description: args.description,
        name: args.name,
        scheduleType,
        cronExpression: hasCronExpression ? args.cron_expression?.trim() : undefined,
        runAt: hasRunAt ? args.run_at?.trim() : undefined,
        enabled: true,
        agentId,
        message: args.message,
        status: 'pending',
      });

      if (success) {
        return {
          success: true,
          job_id: jobId,
          message: scheduleType === 'once'
            ? `One-time schedule "${args.name}" created successfully. Run at: ${args.run_at}`
            : `Recurring schedule "${args.name}" created successfully. Cron: ${args.cron_expression}`,
        };
      }

      return {
        success: false,
        message: scheduleType === 'once'
          ? 'Failed to create one-time schedule. Please check if run_at is a valid ISO timestamp in the future.'
          : 'Failed to create recurring schedule. Please check if the cron expression is valid.',
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'create_schedule',
      description: 'Create a scheduled task that automatically sends a message to an agent at a future time. Supports two modes: recurring cron schedules and one-time reminders. When triggered, a new chat session will be created under the target agent and the message will be sent as the first user prompt. The agent will process the message autonomously in the background. Provide exactly one of cron_expression or run_at.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A clear description of what this scheduled task does and why it is needed. e.g. "Summarize yesterday\'s emails every morning at 6 AM" or "Remind me to rest in one minute"',
          },
          name: {
            type: 'string',
            description: 'Human-readable name for this scheduled task, e.g. "Daily email summary" or "One-time rest reminder"',
          },
          cron_expression: {
            type: 'string',
            description: 'Recurring cron expression. Supports both 5-field (`minute hour day-of-month month day-of-week`) and 6-field (`second minute hour day-of-month month day-of-week`) syntax. Examples: "0 6 * * *" (daily 6AM), "0 4,8,14,18 * * *" (daily at 04:00, 08:00, 14:00, 18:00), "0 0 4,8,14,18 * * *" (same schedule in 6-field syntax), "*/30 * * * *" (every 30 min), "0 9 * * 1-5" (weekdays 9AM). Do not provide this when using run_at.',
          },
          run_at: {
            type: 'string',
            description: 'One-time execution timestamp in ISO 8601 format, e.g. "2026-03-10T00:41:00+08:00". Do not provide this when using cron_expression.',
          },
          message: {
            type: 'string',
            description: 'The prompt that the agent will receive when the schedule fires. This is the ONLY instruction the agent gets — it runs in a new, empty chat session with no prior conversation context. Write a detailed, self-contained prompt that specifies the task, expected deliverable, relevant context, and output requirements.',
          },
          agent_id: {
            type: 'string',
            description: 'The chat_id of the target agent. If not provided, defaults to the current agent.',
          },
        },
        required: ['description', 'name', 'message'],
      },
    };
  }
}
