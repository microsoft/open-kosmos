/**
 * GetCurrentDateTimeTool built-in tool
 * Provides the ability for LLM to proactively get the current date and time
 *
 * Time source: local machine system time (obtained via JavaScript's Date object)
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition } from './types';

export interface GetCurrentDateTimeToolArgs {
  // No parameters
}

export interface GetCurrentDateTimeToolResult {
  // Local date time (timezone-adjusted, without timezone offset)
  local_datetime: string;
  // Local timezone information, including timezone name and UTC offset (e.g., "Asia/Shanghai (UTC+08:00)")
  local_timezone: string;
}

export class GetCurrentDateTimeTool {
  
  /**
   * Execute the get current date time tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: GetCurrentDateTimeToolArgs = {}): Promise<GetCurrentDateTimeToolResult> {
    try {
      const now = new Date();
      
      // Get timezone name
      const timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      // Get timezone offset (in minutes)
      const timezoneOffset = now.getTimezoneOffset();
      const offsetHours = Math.floor(Math.abs(timezoneOffset) / 60);
      const offsetMinutes = Math.abs(timezoneOffset) % 60;
      const offsetSign = timezoneOffset <= 0 ? '+' : '-';
      const offsetString = `UTC${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
      
      // Format local time (without timezone offset)
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
      
      const localDateTimeString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}`;
      const timezoneString = `${timezoneName} (${offsetString})`;
      
      return {
        local_datetime: localDateTimeString,
        local_timezone: timezoneString
      };
    } catch (error) {
      throw new Error(`Failed to get current date time: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get tool definition (for registration with BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'get_current_datetime',
      description: 'Get the current date and time from the local system. Returns local_datetime (timezone-adjusted local time in ISO 8601 format, e.g., "2025-11-30T14:24:43.245") and local_timezone (current timezone with UTC offset, e.g., "Asia/Shanghai (UTC+08:00)").\n\nTime Source: Local machine system time (not from internet/NTP servers).',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    };
  }
}