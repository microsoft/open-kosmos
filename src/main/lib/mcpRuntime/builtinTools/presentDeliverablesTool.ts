/**
 * PresentTool - Present final deliverables to the user
 *
 * Used at the end of a workflow to formally present generated files to the user,
 * distinguishing final outputs from intermediate files for a clear delivery experience.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BuiltinToolDefinition } from './types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';

export interface PresentToolArgs {
  description: string;
  filePaths: string[];
}

export class PresentTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  /**
   * Execute file presentation
   * Validates file existence and returns empty object to save context tokens
   */
  static async execute(args: PresentToolArgs): Promise<Record<string, never>> {
    const startTime = Date.now();

    this.logger.info(
      `PresentTool execution`,
      'PresentTool',
      {
        filePaths: args.filePaths,
        description: args.description
      }
    );

    // Validate file existence (log warning only, don't block execution)
    for (const filePath of args.filePaths) {
      try {
        const normalizedPath = path.normalize(filePath);
        await fs.access(normalizedPath);
      } catch {
        this.logger.warn(
          `File not found: ${filePath}`,
          'PresentTool'
        );
      }
    }

    this.logger.info(
      `PresentTool completed`,
      'PresentTool',
      { durationMs: Date.now() - startTime }
    );

    // Return empty object to save context tokens
    return {};
  }

  /**
   * Get tool definition
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'present_deliverables',
      description: `Present final deliverables to the user.

WHEN TO USE:
- After completing a task that produces files (reports, code, data, images)
- To highlight the final output and distinguish it from intermediate files
- At the END of a workflow, not during intermediate steps

WHEN NOT TO USE:
- For temporary or intermediate files (helper scripts, logs, drafts)
- When just reading or analyzing existing files
- When the task doesn't produce new files

IMPORTANT: Always call this tool as the LAST step after creating the final deliverable files.`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Brief description of what you are presenting to the user'
          },
          filePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'File paths of the final deliverables to present'
          }
        },
        required: ['description', 'filePaths']
      }
    };
  }
}
