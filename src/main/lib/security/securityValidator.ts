/**
 * Security Validator — unified entry point responsible for coordinating
 * permission validation and approval when an Agent executes a tool.
 *
 * Architecture:
 * - SecurityValidator: unified entry point; processes tool arguments and coordinates the validation flow
 * - FileSecurityValidator: low-level validation logic; handles all file-path-related security checks
 *
 * Main responsibilities:
 * 1. Provide a unified validateToolPaths entry point
 * 2. Coordinate calls to FileSecurityValidator for actual validation
 * 3. Support batch validation of multiple tool calls
 */

import { FileSecurityValidator } from './fileSecurityValidator';
import { createLogger } from '../unifiedLogger';

export interface ToolPathsValidationResult {
  approved: boolean;
  pathsOutsideWorkspace: Array<{
    path: string;
    normalizedPath?: string;
    error?: string;
  }>;
  error?: string;
}

/**
 * Validation result for a single tool call
 */
export interface ToolCallValidationResult {
  toolCallId: string;
  toolName: string;
  approved: boolean;
  pathsOutsideWorkspace: Array<{
    path: string;
    normalizedPath?: string;
    error?: string;
  }>;
}

/**
 * Batch validation result
 */
export interface BatchValidationResult {
  allApproved: boolean;
  needsApproval: boolean;
  validationResults: ToolCallValidationResult[];
}

/**
 * Approval request item — one request per tool
 */
export interface ApprovalRequestItem {
  toolCallId: string;
  toolName: string;
  paths: Array<{
    path: string;
    normalizedPath?: string;
  }>;
}

export class SecurityValidator {
  /**
   * Validate whether all paths in the tool arguments are within the workspace.
   * This is the unified security validation entry point.
   *
   * @param toolName - Tool name
   * @param toolArgs - Tool argument object
   * @param workspacePath - Workspace path
   * @returns Validation result, including whether it passed and the list of paths requiring approval
   */
  static validateToolPaths(
    toolName: string,
    toolArgs: any,
    workspacePath: string | undefined
  ): ToolPathsValidationResult {
    const logger = createLogger();

    logger.info('[SecurityValidator] 🔐 Validating tool paths', 'validateToolPaths', {
      toolName,
      workspacePath,
      toolArgsKeys: Object.keys(toolArgs || {})
    });

    // Delegate actual validation to FileSecurityValidator
    const result = FileSecurityValidator.validateToolPathsInWorkspace(toolArgs, workspacePath);

    const validationResult = {
      approved: result.allPathsValid,
      pathsOutsideWorkspace: result.pathsOutsideWorkspace
    };

    logger.info('[SecurityValidator] ✅ Tool paths validation result', 'validateToolPaths', {
      toolName,
      approved: validationResult.approved,
      pathsOutsideWorkspaceCount: validationResult.pathsOutsideWorkspace.length
    });

    // Convert return format
    return validationResult;
  }

  /**
   * Batch-validate multiple tool calls.
   * Validates all tool calls at once and returns the list of requests requiring approval.
   *
   * @param toolCalls - Array of tool calls, each containing {id, function: {name, arguments}}
   * @param workspacePath - Workspace path
   * @returns Batch validation result
   */
  static validateBatchToolCalls(
    toolCalls: Array<{id: string; function: {name: string; arguments: string}}>,
    workspacePath: string | undefined
  ): BatchValidationResult {
    const logger = createLogger();

    logger.info('[SecurityValidator] 🔐 Starting batch validation', 'validateBatchToolCalls', {
      toolCallsCount: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.function.name),
      workspacePath
    });

    const validationResults: ToolCallValidationResult[] = [];

    for (const toolCall of toolCalls) {
      logger.info('[SecurityValidator] Validating tool call', 'validateBatchToolCalls', {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name
      });

      let parsedArgs: any;
      try {
        parsedArgs = JSON.parse(toolCall.function.arguments);
      } catch (error) {
        // Parsing failed — skip validation (executeToolCall will handle it)
        validationResults.push({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          approved: true, // Parsing failure does not affect approval; let execution handle it
          pathsOutsideWorkspace: []
        });
        continue;
      }

      // Validate a single tool call
      const result = this.validateToolPaths(
        toolCall.function.name,
        parsedArgs,
        workspacePath
      );

      const validationResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        approved: result.approved,
        pathsOutsideWorkspace: result.pathsOutsideWorkspace
      };

      validationResults.push(validationResult);

      logger.info('[SecurityValidator] Tool call validation result', 'validateBatchToolCalls', {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        approved: validationResult.approved,
        pathsOutsideWorkspaceCount: validationResult.pathsOutsideWorkspace.length,
        pathsOutsideWorkspace: validationResult.pathsOutsideWorkspace
      });
    }

    // Check whether all passed
    const allApproved = validationResults.every(r => r.approved);
    const needsApproval = validationResults.some(r => !r.approved);

    const batchResult = {
      allApproved,
      needsApproval,
      validationResults
    };

    logger.info('[SecurityValidator] ✅ Batch validation completed', 'validateBatchToolCalls', {
      allApproved: batchResult.allApproved,
      needsApproval: batchResult.needsApproval,
      validationResultsCount: batchResult.validationResults.length
    });

    return batchResult;
  }

  /**
   * Extract the list of approval requests from a batch validation result.
   * 🔥 Change: one request per tool, not one request per path.
   *
   * @param batchResult - Batch validation result
   * @returns Array of approval request items (one per tool call)
   */
  static extractApprovalRequests(batchResult: BatchValidationResult): ApprovalRequestItem[] {
    const requests: ApprovalRequestItem[] = [];

    for (const validation of batchResult.validationResults) {
      if (!validation.approved && validation.pathsOutsideWorkspace.length > 0) {
        // 🔥 Path deduplication: use normalizedPath or path as the unique key
        const uniquePaths = new Map<string, { path: string; normalizedPath?: string }>();

        for (const pathInfo of validation.pathsOutsideWorkspace) {
          const key = pathInfo.normalizedPath || pathInfo.path;
          if (!uniquePaths.has(key)) {
            uniquePaths.set(key, {
              path: pathInfo.path,
              normalizedPath: pathInfo.normalizedPath
            });
          }
        }

        // 🔥 Key change: create one approval request per tool call, containing all deduplicated paths
        requests.push({
          toolCallId: validation.toolCallId,
          toolName: validation.toolName,
          paths: Array.from(uniquePaths.values())
        });
      }
    }

    return requests;
  }
}

/**
 * Exported convenience function for quick validation
 */
export function validateToolPaths(
  toolName: string,
  toolArgs: any,
  workspacePath: string | undefined
): ToolPathsValidationResult {
  return SecurityValidator.validateToolPaths(toolName, toolArgs, workspacePath);
}
