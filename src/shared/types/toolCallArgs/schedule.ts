export interface CreateScheduleToolArgs {
  description: string;
  name: string;
  /**
   * Recurring cron expression.
   * Supports both 5-field syntax (`minute hour day-of-month month day-of-week`)
   * and 6-field syntax (`second minute hour day-of-month month day-of-week`).
   * Examples:
   * - `0 6 * * *` => daily at 06:00
   * - `0 4,8,14,18 * * *` => daily at 04:00, 08:00, 14:00, 18:00
   * - `0 0 4,8,14,18 * * *` => same schedule in 6-field syntax
   */
  cron_expression?: string;
  run_at?: string;
  message: string;
  agent_id?: string;
}

export interface CreateScheduleToolResult {
  success: boolean;
  job_id?: string;
  message: string;
}

export interface GetScheduleToolArgs {
  description: string;
  agent_id?: string;
}

export interface GetScheduleToolResult {
  success: boolean;
  schedules?: Array<{
    job_id: string;
    name: string;
    description: string;
    schedule_type: 'cron' | 'once';
    /** Raw cron expression as stored in scheduler settings. */
    cron_expression?: string;
    run_at?: string;
    message: string;
    agent_id: string;
    enabled: boolean;
    status: 'pending' | 'completed' | 'expired' | 'failed';
    last_run_at?: string;
    executed_at?: string;
  }>;
  message: string;
}

export interface UpdateScheduleToolArgs {
  description: string;
  job_id: string;
  name?: string;
  schedule_type?: 'cron' | 'once';
  /** Same cron syntax support as CreateScheduleToolArgs.cron_expression. */
  cron_expression?: string;
  run_at?: string;
  message?: string;
  enabled?: boolean;
}

export interface UpdateScheduleToolResult {
  success: boolean;
  message: string;
  job?: {
    job_id: string;
    name: string;
    description: string;
    schedule_type: 'cron' | 'once';
    /** Raw cron expression as stored in scheduler settings. */
    cron_expression?: string;
    run_at?: string;
    message: string;
    agent_id: string;
    enabled: boolean;
    status: 'pending' | 'completed' | 'expired' | 'failed';
    last_run_at?: string;
    executed_at?: string;
  };
}

export interface RunScheduleToolArgs {
  description: string;
  job_id: string;
}

export interface RunScheduleToolResult {
  success: boolean;
  message: string;
  chat_session_id?: string;
  messages_count?: number;
}
