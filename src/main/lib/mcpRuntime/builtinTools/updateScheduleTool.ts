/**
 * UpdateScheduleTool - Built-in tool
 * Allows the LLM to edit an existing scheduled task's properties.
 *
 * Supports updating: name, description, schedule type, cron/runAt, message, and enabled status.
 */

import { BuiltinToolDefinition } from './types';
import { UpdateScheduleToolArgs, UpdateScheduleToolResult } from '@shared/types/toolCallArgs';
import { SchedulerJob } from '../../scheduler/types';
import { schedulerManager } from "../../scheduler/SchedulerManager";

export class UpdateScheduleTool {

  /**
   * Execute: edit a scheduled task
   */
  static async execute(
    args: UpdateScheduleToolArgs,
  ): Promise<UpdateScheduleToolResult> {
    try {

      const updates: Partial<Pick<SchedulerJob, 'name' | 'description' | 'scheduleType' | 'cronExpression' | 'runAt' | 'message' | 'enabled' | 'status' | 'executedAt' | 'lastRunAt'>> = {};
      if (args.name !== undefined) updates.name = args.name;
      if (args.description !== undefined) updates.description = args.description;
      if (args.schedule_type !== undefined) updates.scheduleType = args.schedule_type;
      if (args.cron_expression !== undefined) updates.cronExpression = args.cron_expression;
      if (args.run_at !== undefined) updates.runAt = args.run_at;
      if (args.message !== undefined) updates.message = args.message;
      if (args.enabled !== undefined) updates.enabled = args.enabled;

      const hasEditableUpdates = Object.keys(updates).length > 0;
      if (!hasEditableUpdates) {
        return {
          success: false,
          message: 'No fields to update. Provide at least one of: name, description, schedule_type, cron_expression, run_at, message, enabled.',
        };
      }

      if (args.schedule_type === 'cron' && args.cron_expression === undefined) {
        updates.runAt = undefined;
      }
      if (args.schedule_type === 'once' && args.run_at === undefined) {
        updates.cronExpression = undefined;
      }
      if (args.cron_expression !== undefined) {
        updates.scheduleType = 'cron';
        updates.runAt = undefined;
        updates.status = 'pending';
        updates.executedAt = undefined;
        updates.lastRunAt = undefined;
      }
      if (args.run_at !== undefined) {
        updates.scheduleType = 'once';
        updates.cronExpression = undefined;
        updates.status = 'pending';
        updates.executedAt = undefined;
        updates.lastRunAt = undefined;
      }

      const success = await schedulerManager.updateJob(args.job_id, updates);

      if (success) {
        const jobs = await schedulerManager.listJobs();
        const updatedJob = jobs.find(j => j.id === args.job_id);

        return {
          success: true,
          message: 'Schedule updated successfully.',
          job: updatedJob ? {
            job_id: updatedJob.id,
            name: updatedJob.name,
            description: updatedJob.description,
            schedule_type: updatedJob.scheduleType,
            cron_expression: updatedJob.cronExpression,
            run_at: updatedJob.runAt,
            message: updatedJob.message,
            agent_id: updatedJob.agentId,
            enabled: updatedJob.enabled,
            status: updatedJob.status,
            last_run_at: updatedJob.lastRunAt,
            executed_at: updatedJob.executedAt,
          } : undefined,
        };
      }

      return {
        success: false,
        message: `Failed to update schedule "${args.job_id}". The job may not exist, or the schedule configuration may be invalid.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'update_schedule',
      description: 'Edit an existing scheduled task. You can update its name, description, schedule type, cron expression, one-time run_at timestamp, message, and/or enabled status. Use the get_schedule tool first to find the job_id of the schedule you want to edit.',
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief one-sentence description of what this edit is for (for UI display). E.g., "Updating the reminder to run once tomorrow morning"',
          },
          job_id: {
            type: 'string',
            description: 'The ID of the scheduled task to edit (e.g. "sched_20260330150405_device-01_abc123xyz"). Use get_schedule to find the job ID.',
          },
          name: {
            type: 'string',
            description: 'New human-readable name for this scheduled task.',
          },
          schedule_type: {
            type: 'string',
            enum: ['cron', 'once'],
            description: 'New schedule type. Use "cron" for recurring schedules or "once" for a one-time reminder.',
          },
          cron_expression: {
            type: 'string',
            description: 'New cron expression defining a recurring schedule. Supports both 5-field (`minute hour day-of-month month day-of-week`) and 6-field (`second minute hour day-of-month month day-of-week`) syntax. Examples: "0 6 * * *" (daily 6AM), "0 4,8,14,18 * * *" (daily at 04:00, 08:00, 14:00, 18:00), "0 0 4,8,14,18 * * *" (same schedule in 6-field syntax).',
          },
          run_at: {
            type: 'string',
            description: 'New ISO timestamp for a one-time schedule, e.g. "2026-03-10T00:41:00+08:00".',
          },
          message: {
            type: 'string',
            description: 'New prompt message to send to the agent when the schedule triggers.',
          },
          enabled: {
            type: 'boolean',
            description: 'Whether the scheduled task is enabled. Set to false to disable future runs, or true to re-enable it.',
          },
        },
        required: ['description', 'job_id'],
      },
    };
  }
}
