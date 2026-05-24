/**
 * ManageProcessTool - Built-in tool for managing background processes
 * Supports list, poll, log, and kill actions for background sessions
 */

import { BuiltinToolDefinition } from './types';
import { getBackgroundProcessManager, BackgroundSessionStatus } from '../../backgroundProcessManager';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';

export interface ManageProcessToolArgs {
  action: 'list' | 'poll' | 'log' | 'kill';
  sessionId?: string;
  offset?: number;
  limit?: number;
}

export interface ManageProcessListResult {
  action: 'list';
  sessions: Array<{
    sessionId: string;
    command: string;
    status: BackgroundSessionStatus;
    pid?: number;
    startTime: number;
    durationMs: number;
    exitCode?: number | null;
  }>;
}

export interface ManageProcessPollResult {
  action: 'poll';
  sessionId: string;
  status: 'running' | 'exited' | 'error';
  exitCode?: number | null;
  pid?: number;
  durationMs: number;
}

export interface ManageProcessLogResult {
  action: 'log';
  sessionId: string;
  lines: string[];
  nextOffset: number;
  totalLines: number;
  droppedCount: number;
  done: boolean;
}

export interface ManageProcessKillResult {
  action: 'kill';
  sessionId: string;
  success: boolean;
  message: string;
}

export type ManageProcessToolResult =
  | ManageProcessListResult
  | ManageProcessPollResult
  | ManageProcessLogResult
  | ManageProcessKillResult;

export class ManageProcessTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  static async execute(args: ManageProcessToolArgs, options?: { signal?: AbortSignal }): Promise<ManageProcessToolResult> {
    const executionId = `mgproc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    this.logger.info(
      'ManageProcessTool execution started',
      'ManageProcessTool',
      { executionId, action: args.action, sessionId: args.sessionId }
    );

    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      throw new Error(`Invalid manage_process arguments: ${validation.error}`);
    }

    const bgManager = getBackgroundProcessManager();

    switch (args.action) {
      case 'list': {
        const sessions = bgManager.list();
        this.logger.info(
          'Listed background sessions',
          'ManageProcessTool',
          { executionId, count: sessions.length }
        );
        return {
          action: 'list',
          sessions
        };
      }

      case 'poll': {
        const pollResult = bgManager.poll(args.sessionId!);
        this.logger.info(
          'Polled background session',
          'ManageProcessTool',
          { executionId, sessionId: args.sessionId, status: pollResult.status }
        );
        return {
          action: 'poll',
          sessionId: args.sessionId!,
          ...pollResult
        };
      }

      case 'log': {
        const logResult = bgManager.log(args.sessionId!, {
          offset: args.offset,
          limit: args.limit
        });
        this.logger.info(
          'Read background session logs',
          'ManageProcessTool',
          {
            executionId,
            sessionId: args.sessionId,
            linesReturned: logResult.lines.length,
            totalLines: logResult.totalLines
          }
        );
        return {
          action: 'log',
          sessionId: args.sessionId!,
          ...logResult
        };
      }

      case 'kill': {
        const killResult = await bgManager.kill(args.sessionId!);
        this.logger.info(
          'Kill background session result',
          'ManageProcessTool',
          { executionId, sessionId: args.sessionId, success: killResult.success }
        );
        return {
          action: 'kill',
          sessionId: args.sessionId!,
          ...killResult
        };
      }

      default:
        throw new Error(`Unknown action: ${args.action}`);
    }
  }

  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'manage_process',
      description:
        'Manage background processes spawned via execute_command with background=true.\n\n' +
        'Actions:\n' +
        '- list: List all active and recently-exited background sessions\n' +
        '- poll: Check the status of a specific session (running/exited/error)\n' +
        '- log: Read output lines from a session\'s ring buffer (supports pagination)\n' +
        '- kill: Terminate a running background process\n\n' +
        'Session data is retained for 5 minutes after process exit for log retrieval.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'poll', 'log', 'kill'],
            description: 'Action to perform on background processes'
          },
          sessionId: {
            type: 'string',
            description: 'Session ID returned by execute_command with background=true. Required for poll/log/kill.'
          },
          offset: {
            type: 'number',
            description: 'For log action: line offset to start reading from (0-based, default 0)'
          },
          limit: {
            type: 'number',
            description: 'For log action: maximum number of lines to return (default 50)'
          }
        },
        required: ['action']
      }
    };
  }

  private static validateArgs(args: ManageProcessToolArgs): { isValid: boolean; error?: string } {
    if (!args || typeof args !== 'object') {
      return { isValid: false, error: 'arguments object is required' };
    }

    const validActions = ['list', 'poll', 'log', 'kill'];
    if (!validActions.includes(args.action)) {
      return { isValid: false, error: `action must be one of: ${validActions.join(', ')}` };
    }

    if (args.action !== 'list' && (!args.sessionId || typeof args.sessionId !== 'string')) {
      return { isValid: false, error: 'sessionId is required for poll/log/kill actions' };
    }

    if (args.offset !== undefined && (!Number.isFinite(args.offset) || args.offset < 0)) {
      return { isValid: false, error: 'offset must be a non-negative number' };
    }

    if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit <= 0)) {
      return { isValid: false, error: 'limit must be a positive number' };
    }

    return { isValid: true };
  }
}
