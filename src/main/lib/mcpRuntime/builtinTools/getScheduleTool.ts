/**
 * GetScheduleTool - Built-in tool
 * Allows the LLM to list/query existing scheduled tasks.
 *
 * Supports listing all schedules or filtering by a specific agent.
 */

import { BuiltinToolDefinition } from './types';
import { GetScheduleToolArgs, GetScheduleToolResult } from '@shared/types/toolCallArgs';
import { schedulerManager } from "../../scheduler/SchedulerManager";

export class GetScheduleTool {

  /**
   * Execute: list scheduled tasks
   */
  static async execute(
    args: GetScheduleToolArgs,
  ): Promise<GetScheduleToolResult> {
    try {

      const jobs = await schedulerManager.listJobs(args.agent_id);

      const schedules = jobs.map(job => ({
        job_id: job.id,
        name: job.name,
        description: job.description,
        schedule_type: job.scheduleType,
        cron_expression: job.cronExpression,
        run_at: job.runAt,
        message: job.message,
        agent_id: job.agentId,
        enabled: job.enabled,
        status: job.status,
        last_run_at: job.lastRunAt,
        executed_at: job.executedAt,
      }));

      return {
        success: true,
        schedules,
        message: schedules.length > 0
          ? `Found ${schedules.length} scheduled task(s).`
          : 'No scheduled tasks found.',
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to get schedules: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'get_schedule',
      description: 'List existing scheduled tasks. Returns all schedules or those belonging to a specific agent. Each schedule includes its ID, name, description, schedule type, cron expression or one-time run_at timestamp, message, agent ID, enabled status, and execution status.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief one-sentence description of what this query is for (for UI display). E.g., "Listing all scheduled tasks"',
          },
          agent_id: {
            type: 'string',
            description: 'Optional agent chat_id to filter schedules. If not provided, returns all schedules.',
          },
        },
        required: ['description'],
      },
    };
  }
}
