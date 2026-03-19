/**
 * AppendToFileTool built-in tool
 * Append tool designed specifically for chunked writing of large files
 * 
 * Core features:
 * 1. Optimized for large file chunked writing scenarios
 * 2. Supports session tracking to monitor multiple writes to the same file
 * 3. Automatically handles newlines and delimiters
 * 4. Provides write progress feedback
 * 5. Lightweight API to reduce token consumption
 * 
 * Use cases:
 * - Generating large HTML/Markdown files in sections
 * - Writing long code files in chunks
 * - Appending to logs
 * - Generating reports in sections
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';

export interface AppendToFileToolArgs {
  // Required parameters
  filePath: string;           // Full path of the file
  content: string;            // Content to append
  
  // Optional parameters
  encoding?: BufferEncoding;  // File encoding, default 'utf-8'
  createIfNotExists?: boolean; // Whether to create file if it does not exist, default true
  addNewlineBefore?: boolean; // Add a newline before content, default false
  addNewlineAfter?: boolean;  // Add a newline after content, default true
  sectionId?: string;         // Optional section identifier for tracking and debugging
  isLastChunk?: boolean;      // Whether this is the last chunk, for completion notification
}

export interface AppendToFileToolResult {
  success: boolean;
  filePath: string;           // Path of the written file
  bytesAppended: number;      // Bytes appended in this operation
  totalFileSize: number;      // Total file size after appending
  chunkNumber: number;        // Current chunk number (based on session tracking)
  sectionId?: string;         // Section identifier
  isComplete?: boolean;       // Whether complete (when isLastChunk=true)
  error?: string;             // Error message
}

// Content size limit: 5MB (single append, more lenient than create_file but still protected)
const MAX_APPEND_SIZE = 5 * 1024 * 1024;

// File size limit: 100MB (total size after appending)
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

// Session tracker: records write count per file
const writeSessionTracker = new Map<string, { chunkCount: number; lastWriteTime: number }>();

// Session timeout: reset count after 5 minutes of no writes
const SESSION_TIMEOUT = 5 * 60 * 1000;

export class AppendToFileTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  /**
   * Execute file append
   */
  static async execute(args: AppendToFileToolArgs): Promise<AppendToFileToolResult> {
    const startTime = Date.now();
    const executionId = `append_file_${startTime}`;
    
    this.logger.info(
      `AppendToFileTool execution started`,
      'AppendToFileTool',
      { executionId, filePath: args.filePath, contentLength: args.content?.length, sectionId: args.sectionId }
    );

    try {
      // 1. Argument validation
      const validation = this.validateArgs(args);
      if (!validation.isValid) {
        this.logger.error(
          `Arguments validation failed: ${validation.error}`,
          'AppendToFileTool',
          { executionId, error: validation.error }
        );
        return {
          success: false,
          filePath: args.filePath,
          bytesAppended: 0,
          totalFileSize: 0,
          chunkNumber: 0,
          sectionId: args.sectionId,
          error: validation.error
        };
      }

      // 2. Normalize path and parameters
      const normalizedPath = path.normalize(args.filePath);
      const encoding = args.encoding || 'utf-8';
      const createIfNotExists = args.createIfNotExists !== false;
      const addNewlineBefore = args.addNewlineBefore === true;
      const addNewlineAfter = args.addNewlineAfter !== false; // default true

      // 3. Update session tracking
      const sessionKey = normalizedPath.toLowerCase();
      let session = writeSessionTracker.get(sessionKey);
      
      if (!session || (Date.now() - session.lastWriteTime > SESSION_TIMEOUT)) {
        // New session or timeout reset
        session = { chunkCount: 0, lastWriteTime: Date.now() };
      }
      
      session.chunkCount++;
      session.lastWriteTime = Date.now();
      writeSessionTracker.set(sessionKey, session);

      // 4. Check if file exists
      let fileExists = false;
      let currentSize = 0;
      try {
        const stats = await fs.stat(normalizedPath);
        fileExists = true;
        currentSize = stats.size;
      } catch {
        fileExists = false;
      }

      // 5. If file does not exist and creation is not allowed, return error
      if (!fileExists && !createIfNotExists) {
        return {
          success: false,
          filePath: normalizedPath,
          bytesAppended: 0,
          totalFileSize: 0,
          chunkNumber: session.chunkCount,
          sectionId: args.sectionId,
          error: `File does not exist: ${normalizedPath}. Set createIfNotExists=true to create it.`
        };
      }

      // 6. Create parent directories (if needed)
      if (!fileExists) {
        const dirPath = path.dirname(normalizedPath);
        await fs.mkdir(dirPath, { recursive: true });
      }

      // 7. Build content to append
      let contentToAppend = args.content;
      if (addNewlineBefore && fileExists) {
        contentToAppend = '\n' + contentToAppend;
      }
      if (addNewlineAfter) {
        contentToAppend = contentToAppend + '\n';
      }

      // 8. Check file size after appending
      const appendSize = Buffer.byteLength(contentToAppend, encoding);
      const newTotalSize = currentSize + appendSize;
      
      if (newTotalSize > MAX_TOTAL_SIZE) {
        return {
          success: false,
          filePath: normalizedPath,
          bytesAppended: 0,
          totalFileSize: currentSize,
          chunkNumber: session.chunkCount,
          sectionId: args.sectionId,
          error: `Resulting file size (${newTotalSize} bytes) would exceed maximum allowed (${MAX_TOTAL_SIZE} bytes)`
        };
      }

      // 9. Execute append
      await fs.appendFile(normalizedPath, contentToAppend, { encoding });

      // 10. Verify write
      const finalStats = await fs.stat(normalizedPath);
      const actualTotalSize = finalStats.size;

      // 11. If this is the last chunk, clean up session
      if (args.isLastChunk) {
        writeSessionTracker.delete(sessionKey);
        this.logger.info(
          `File write session completed`,
          'AppendToFileTool',
          { executionId, filePath: normalizedPath, totalChunks: session.chunkCount, totalSize: actualTotalSize }
        );
      }

      const duration = Date.now() - startTime;
      this.logger.info(
        `AppendToFileTool execution completed`,
        'AppendToFileTool',
        { 
          executionId, 
          filePath: normalizedPath, 
          bytesAppended: appendSize,
          totalSize: actualTotalSize,
          chunkNumber: session.chunkCount,
          duration,
          isLastChunk: args.isLastChunk
        }
      );

      return {
        success: true,
        filePath: normalizedPath,
        bytesAppended: appendSize,
        totalFileSize: actualTotalSize,
        chunkNumber: session.chunkCount,
        sectionId: args.sectionId,
        isComplete: args.isLastChunk === true
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `AppendToFileTool execution failed: ${errorMessage}`,
        'AppendToFileTool',
        { executionId, error: errorMessage }
      );
      
      return {
        success: false,
        filePath: args.filePath,
        bytesAppended: 0,
        totalFileSize: 0,
        chunkNumber: 0,
        sectionId: args.sectionId,
        error: errorMessage
      };
    }
  }

  /**
   * Argument validation
   */
  private static validateArgs(args: AppendToFileToolArgs): { isValid: boolean; error?: string } {
    // Check required parameters
    if (!args.filePath || typeof args.filePath !== 'string') {
      return { isValid: false, error: 'filePath is required and must be a string' };
    }

    if (args.content === undefined || args.content === null) {
      return { isValid: false, error: 'content is required' };
    }

    // Check content size
    const contentSize = Buffer.byteLength(args.content, args.encoding || 'utf-8');
    if (contentSize > MAX_APPEND_SIZE) {
      return { 
        isValid: false, 
        error: `Content size (${contentSize} bytes) exceeds maximum allowed for single append (${MAX_APPEND_SIZE} bytes). Consider splitting into smaller chunks.` 
      };
    }

    // Check if path contains dangerous patterns
    const dangerousPatterns = [
      /\.\.\//,           // Directory traversal
      /^\/etc\//i,        // Linux system directories
      /^\/usr\//i,
      /^\/bin\//i,
      /^\/sbin\//i,
      /^C:\\Windows/i,    // Windows system directories
      /^C:\\Program Files/i
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(args.filePath)) {
        return { isValid: false, error: 'File path contains restricted system directory' };
      }
    }

    return { isValid: true };
  }

  /**
   * Get write session info (for debugging)
   */
  static getSessionInfo(filePath: string): { chunkCount: number; lastWriteTime: number } | null {
    const sessionKey = path.normalize(filePath).toLowerCase();
    return writeSessionTracker.get(sessionKey) || null;
  }

  /**
   * Clear all sessions (for testing)
   */
  static clearAllSessions(): void {
    writeSessionTracker.clear();
  }

  /**
   * Get tool definition
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'append_to_file',
      description: `Append content to an existing file or create a new one. Optimized for building large files in chunks to avoid output truncation.

**When to use this tool:**
- Creating large files (>5KB) that might exceed token limits
- Building HTML, Markdown, or code files section by section
- Any scenario where content is generated incrementally

**Chunked Writing Strategy:**
1. First call: Create file with header/initial content (sectionId: "header")
2. Middle calls: Append body sections one at a time (sectionId: "section1", "section2", etc.)
3. Last call: Append footer/closing content (sectionId: "footer", isLastChunk: true)

**Example workflow for large HTML:**
\`\`\`
Call 1: { filePath: "report.html", content: "<!DOCTYPE html>...<body>", sectionId: "header" }
Call 2: { filePath: "report.html", content: "<section>...</section>", sectionId: "main-content" }
Call 3: { filePath: "report.html", content: "</body></html>", sectionId: "footer", isLastChunk: true }
\`\`\`

This approach prevents token limit truncation that can occur when generating large content in a single tool call.`,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The full path to the file to append to'
          },
          content: {
            type: 'string',
            description: 'The content to append (no escaping needed)'
          },
          encoding: {
            type: 'string',
            enum: ['utf-8', 'utf8', 'ascii', 'utf16le', 'latin1'],
            description: 'File encoding (default: utf-8)'
          },
          createIfNotExists: {
            type: 'boolean',
            description: 'Create file if it does not exist (default: true)'
          },
          addNewlineBefore: {
            type: 'boolean',
            description: 'Add a newline before the content (default: false)'
          },
          addNewlineAfter: {
            type: 'boolean',
            description: 'Add a newline after the content (default: true)'
          },
          sectionId: {
            type: 'string',
            description: 'Optional identifier for the chunk (e.g., "header", "section1", "footer") - useful for debugging and progress tracking'
          },
          isLastChunk: {
            type: 'boolean',
            description: 'Set to true when appending the final chunk - helps with cleanup and completion notification'
          }
        },
        required: ['filePath', 'content']
      }
    };
  }
}
