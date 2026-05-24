import { BuiltinToolDefinition } from './types';
import { RunScheduleToolArgs, RunScheduleToolResult } from '@shared/types/toolCallArgs';
import { schedulerManager } from "../../scheduler/SchedulerManager";

export class RunScheduleTool {
  static async execute(
    args: RunScheduleToolArgs,
  ): Promise<RunScheduleToolResult> {
    try {

      const result = await schedulerManager.runJobNow(args.job_id);

      if (!result.success) {
        return {
          success: false,
          message: result.error || `Failed to run schedule "${args.job_id}".`,
        };
      }

      return {
        success: true,
        message: `Schedule "${args.job_id}" started successfully.`,
        chat_session_id: result.chatSessionId,
        messages_count: result.messagesCount,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'run_schedule',
      description: 'Trigger an existing schedule immediately. This runs the same execution flow as the scheduler itself. Use get_schedule first to find the job_id you want to run. For one-time schedules, running now consumes the scheduled run and marks it completed or failed just like a normal scheduled execution.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief one-sentence description of why this schedule is being run now. E.g., "Run the daily digest immediately for an ad-hoc check"',
          },
          job_id: {
            type: 'string',
            description: 'The ID of the schedule to run immediately. Use get_schedule to find the job ID.',
          },
        },
        required: ['description', 'job_id'],
      },
    };
  }
}
