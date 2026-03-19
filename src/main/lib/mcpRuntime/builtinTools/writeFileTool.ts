/**
 * WriteFileTool built-in tool
 * Unified file writing tool that consolidates all functionality from the original create_file and append_to_file
 * 
 * Core features:
 * 1. Multiple write modes (overwrite, append, prepend, insert)
 * 2. JSON validation (for .json files)
 * 3. Large file chunked write tracking (session tracking)
 * 4. Newline control (append mode)
 * 5. Content validation and backup recovery
 * 6. Base64 encoding support
 * 7. Cross-platform consistency
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';

export type WriteMode = 'overwrite' | 'append' | 'prepend' | 'insert';

export interface WriteFileToolArgs {
  // Required parameters
  filePath: string;           // Full path to the file
  content: string;            // Content to write

  // Mode control
  mode?: WriteMode;           // Write mode, default 'overwrite'

  // General options
  description?: string;       // Operation description for UI display
  encoding?: BufferEncoding;  // File encoding, default 'utf-8'
  createIfNotExists?: boolean; // Whether to create the file if it does not exist, default true
  createDirectories?: boolean; // Whether to automatically create parent directories, default true
  isBase64?: boolean;         // Whether content is Base64 encoded
  backupBeforeWrite?: boolean; // Whether to back up the original file before writing
  
  // JSON validation (from create_file)
  validateJson?: boolean;     // Validate format for .json files
  
  // Insert mode options
  insertPosition?: number;    // Insertion position in insert mode (character index)
  insertLine?: number;        // Insertion line number in insert mode (1-based)
  
  // Append mode options (from append_to_file)
  addNewlineBefore?: boolean; // Append mode: add newline before content
  addNewlineAfter?: boolean;  // Append mode: add newline after content (default true)
  sectionId?: string;         // Chunk identifier for debugging and tracking
  isLastChunk?: boolean;      // Whether this is the last chunk
}

export interface WriteFileToolResult {
  success: boolean;
  filePath: string;           // Path of the written file
  bytesWritten: number;       // Number of bytes written
  totalSize: number;          // Total file size after writing
  mode: WriteMode;            // Write mode used
  backupPath?: string;        // Backup file path (if any)
  
  // JSON validation result
  jsonValid?: boolean;        // JSON validation result
  
  // Chunk tracking (append mode)
  chunkNumber?: number;       // Current chunk number
  sectionId?: string;         // Chunk identifier
  isComplete?: boolean;       // Whether all chunks are complete
  
  error?: string;             // Error message
}

// Maximum content size per write: 10MB
const MAX_CONTENT_SIZE = 10 * 1024 * 1024;

// Maximum file size limit: 100MB (increased to support large file chunked writing)
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Session tracker: records write count for each file (for large file chunking in append mode)
const writeSessionTracker = new Map<string, { chunkCount: number; lastWriteTime: number }>();

// Session timeout: reset count after 5 minutes of no writes
const SESSION_TIMEOUT = 5 * 60 * 1000;

export class WriteFileTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  /**
   * Execute file write
   */
  static async execute(args: WriteFileToolArgs): Promise<WriteFileToolResult> {
    const startTime = Date.now();
    const executionId = `write_file_${startTime}`;
    const mode = args.mode || 'overwrite';
    
    this.logger.info(
      `WriteFileTool execution started`,
      'WriteFileTool',
      { executionId, filePath: args.filePath, mode, contentLength: args.content?.length, sectionId: args.sectionId }
    );

    try {
      // 1. Argument validation
      const validation = this.validateArgs(args);
      if (!validation.isValid) {
        this.logger.error(
          `Arguments validation failed: ${validation.error}`,
          'WriteFileTool',
          { executionId, error: validation.error }
        );
        return {
          success: false,
          filePath: args.filePath,
          bytesWritten: 0,
          totalSize: 0,
          mode,
          error: validation.error
        };
      }

      // 2. Normalize parameters
      const normalizedPath = path.normalize(args.filePath);
      const encoding = args.encoding || 'utf-8';
      const createIfNotExists = args.createIfNotExists !== false;
      const createDirectories = args.createDirectories !== false;

      // 3. Decode content (if Base64)
      let content = args.content;
      if (args.isBase64) {
        try {
          content = Buffer.from(args.content, 'base64').toString(encoding);
        } catch (e) {
          return {
            success: false,
            filePath: normalizedPath,
            bytesWritten: 0,
            totalSize: 0,
            mode,
            error: 'Failed to decode Base64 content'
          };
        }
      }

      // 4. JSON validation (if needed)
      let jsonValid: boolean | undefined;
      if (args.validateJson && normalizedPath.toLowerCase().endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          jsonValid = parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed));
          if (!jsonValid) {
            this.logger.warn(
              `JSON content is valid but empty or primitive`,
              'WriteFileTool',
              { executionId }
            );
          }
        } catch (jsonError) {
          this.logger.error(
            `JSON validation failed`,
            'WriteFileTool',
            { executionId, error: jsonError instanceof Error ? jsonError.message : 'Invalid JSON' }
          );
          return {
            success: false,
            filePath: normalizedPath,
            bytesWritten: 0,
            totalSize: 0,
            mode,
            jsonValid: false,
            error: `Invalid JSON content: ${jsonError instanceof Error ? jsonError.message : 'Parse error'}`
          };
        }
      }

      // 5. Update session tracking (for chunked writing in append mode)
      const sessionKey = normalizedPath.toLowerCase();
      let session = writeSessionTracker.get(sessionKey);
      
      if (mode === 'append') {
        if (!session || (Date.now() - session.lastWriteTime > SESSION_TIMEOUT)) {
          session = { chunkCount: 0, lastWriteTime: Date.now() };
        }
        session.chunkCount++;
        session.lastWriteTime = Date.now();
        writeSessionTracker.set(sessionKey, session);
      }

      // 6. Check if file exists
      let fileExists = false;
      let originalContent = '';
      let currentSize = 0;
      try {
        originalContent = await fs.readFile(normalizedPath, { encoding });
        fileExists = true;
        currentSize = Buffer.byteLength(originalContent, encoding);
      } catch {
        fileExists = false;
      }

      // 7. If file does not exist and creation is not allowed, return error
      if (!fileExists && !createIfNotExists) {
        return {
          success: false,
          filePath: normalizedPath,
          bytesWritten: 0,
          totalSize: 0,
          mode,
          error: `File does not exist: ${normalizedPath}. Set createIfNotExists=true to create it.`
        };
      }

      // 8. Create parent directories (if needed)
      if (createDirectories) {
        const dirPath = path.dirname(normalizedPath);
        await fs.mkdir(dirPath, { recursive: true });
      }

      // 9. Back up original file (if needed)
      let backupPath: string | undefined;
      if (fileExists && args.backupBeforeWrite) {
        backupPath = `${normalizedPath}.backup.${Date.now()}`;
        await fs.copyFile(normalizedPath, backupPath);
        this.logger.debug(
          `File backed up`,
          'WriteFileTool',
          { executionId, backupPath }
        );
      }

      // 10. Calculate final content
      let finalContent: string;
      let contentToWrite = content;
      
      // Newline control for append mode
      if (mode === 'append') {
        const addNewlineBefore = args.addNewlineBefore === true;
        const addNewlineAfter = args.addNewlineAfter !== false; // Default true
        
        if (addNewlineBefore && fileExists && originalContent.length > 0) {
          contentToWrite = '\n' + contentToWrite;
        }
        if (addNewlineAfter) {
          contentToWrite = contentToWrite + '\n';
        }
      }
      
      switch (mode) {
        case 'overwrite':
          finalContent = contentToWrite;
          break;
        
        case 'append':
          finalContent = originalContent + contentToWrite;
          break;
        
        case 'prepend':
          finalContent = contentToWrite + originalContent;
          break;
        
        case 'insert':
          if (args.insertLine !== undefined) {
            // Insert by line
            const lines = originalContent.split('\n');
            const lineIndex = Math.max(0, Math.min(args.insertLine - 1, lines.length));
            lines.splice(lineIndex, 0, contentToWrite);
            finalContent = lines.join('\n');
          } else if (args.insertPosition !== undefined) {
            // Insert by character position
            const pos = Math.max(0, Math.min(args.insertPosition, originalContent.length));
            finalContent = originalContent.slice(0, pos) + contentToWrite + originalContent.slice(pos);
          } else {
            // Default to append
            finalContent = originalContent + contentToWrite;
          }
          break;
        
        default:
          finalContent = contentToWrite;
      }

      // 11. Check final file size
      const finalSize = Buffer.byteLength(finalContent, encoding);
      if (finalSize > MAX_FILE_SIZE) {
        return {
          success: false,
          filePath: normalizedPath,
          bytesWritten: 0,
          totalSize: currentSize,
          mode,
          chunkNumber: session?.chunkCount,
          sectionId: args.sectionId,
          error: `Resulting file size (${finalSize} bytes) would exceed maximum allowed (${MAX_FILE_SIZE} bytes)`
        };
      }

      // 12. Write to file
      await fs.writeFile(normalizedPath, finalContent, { encoding });

      // 13. If this is the last chunk, clean up session
      if (mode === 'append' && args.isLastChunk && session) {
        writeSessionTracker.delete(sessionKey);
        this.logger.info(
          `File write session completed`,
          'WriteFileTool',
          { executionId, filePath: normalizedPath, totalChunks: session.chunkCount, totalSize: finalSize }
        );
      }

      const stats = await fs.stat(normalizedPath);
      const bytesWritten = Buffer.byteLength(contentToWrite, encoding);

      const result: WriteFileToolResult = {
        success: true,
        filePath: normalizedPath,
        bytesWritten,
        totalSize: stats.size,
        mode,
        backupPath,
        jsonValid,
        chunkNumber: session?.chunkCount,
        sectionId: args.sectionId,
        isComplete: args.isLastChunk === true
      };

      this.logger.info(
        `WriteFileTool execution completed successfully`,
        'WriteFileTool',
        { 
          executionId, 
          filePath: normalizedPath, 
          bytesWritten,
          totalSize: stats.size,
          mode,
          chunkNumber: session?.chunkCount,
          sectionId: args.sectionId,
          durationMs: Date.now() - startTime 
        }
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `WriteFileTool execution failed`,
        'WriteFileTool',
        { executionId, error: errorMessage, stack: error instanceof Error ? error.stack : undefined }
      );

      return {
        success: false,
        filePath: args.filePath,
        bytesWritten: 0,
        totalSize: 0,
        mode,
        error: errorMessage
      };
    }
  }

  /**
   * Get write session information (for debugging)
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
   * Validate arguments
   */
  private static validateArgs(args: WriteFileToolArgs): { isValid: boolean; error?: string } {
    // Check required parameters
    if (!args.filePath || typeof args.filePath !== 'string') {
      return { isValid: false, error: 'filePath is required and must be a string' };
    }

    if (args.content === undefined || args.content === null) {
      return { isValid: false, error: 'content is required' };
    }

    if (typeof args.content !== 'string') {
      return { isValid: false, error: 'content must be a string' };
    }

    // Check content size
    const contentSize = Buffer.byteLength(args.content, args.encoding || 'utf-8');
    if (contentSize > MAX_CONTENT_SIZE) {
      return { 
        isValid: false, 
        error: `Content size (${contentSize} bytes) exceeds maximum allowed (${MAX_CONTENT_SIZE} bytes). Consider splitting into smaller chunks using append mode.` 
      };
    }

    // Check write mode
    const validModes: WriteMode[] = ['overwrite', 'append', 'prepend', 'insert'];
    if (args.mode && !validModes.includes(args.mode)) {
      return { 
        isValid: false, 
        error: `Invalid mode: ${args.mode}. Valid modes: ${validModes.join(', ')}` 
      };
    }

    // In insert mode, insertPosition and insertLine cannot be specified at the same time
    if (args.mode === 'insert' && args.insertPosition !== undefined && args.insertLine !== undefined) {
      return { 
        isValid: false, 
        error: 'Cannot specify both insertPosition and insertLine for insert mode' 
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
   * Get tool definition
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'write_file',
      description: `The unified tool for all file writing operations. Creates new files, overwrites existing files, or appends content.

**Modes:**
- \`overwrite\` (default): Create new file or replace entire content
- \`append\`: Add content to the end of file (with optional newline control)
- \`prepend\`: Add content to the beginning of file
- \`insert\`: Insert content at specific position or line number

**When to use each mode:**
| Scenario | Mode | Key Options |
|----------|------|-------------|
| Create a new file | overwrite | validateJson (for .json files) |
| Replace file content | overwrite | backupBeforeWrite |
| Add to end of file | append | addNewlineAfter, sectionId |
| Build large files in chunks | append | sectionId, isLastChunk |
| Add header to file | prepend | - |
| Insert at specific line | insert | insertLine |

**For large files (>5KB):** Use multiple \`append\` calls with \`sectionId\` to track progress and \`isLastChunk: true\` on the final call.`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what is being written (for UI display). E.g., "Creating React component", "Updating config file"'
          },
          filePath: {
            type: 'string',
            description: 'The full path to the file'
          },
          content: {
            type: 'string',
            description: 'The content to write (no escaping needed)'
          },
          mode: {
            type: 'string',
            enum: ['overwrite', 'append', 'prepend', 'insert'],
            description: 'Write mode. Default: overwrite'
          },
          encoding: {
            type: 'string',
            enum: ['utf-8', 'utf8', 'ascii', 'utf16le', 'ucs2', 'base64', 'latin1', 'binary', 'hex'],
            description: 'File encoding (default: utf-8)'
          },
          createIfNotExists: {
            type: 'boolean',
            description: 'Create file if it does not exist (default: true)'
          },
          createDirectories: {
            type: 'boolean',
            description: 'Create parent directories if they do not exist (default: true)'
          },
          validateJson: {
            type: 'boolean',
            description: 'For .json files: validate JSON format before writing (default: false)'
          },
          insertPosition: {
            type: 'number',
            description: 'For insert mode: character position to insert at (0-based)'
          },
          insertLine: {
            type: 'number',
            description: 'For insert mode: line number to insert at (1-based)'
          },
          addNewlineBefore: {
            type: 'boolean',
            description: 'For append mode: add newline before content if file exists (default: false)'
          },
          addNewlineAfter: {
            type: 'boolean',
            description: 'For append mode: add newline after content (default: true)'
          },
          sectionId: {
            type: 'string',
            description: 'For append mode: identifier for the chunk (e.g., "header", "section1", "footer") - useful for debugging large file builds'
          },
          isLastChunk: {
            type: 'boolean',
            description: 'For append mode: set to true when appending the final chunk - helps with cleanup and completion tracking'
          },
          isBase64: {
            type: 'boolean',
            description: 'Whether content is Base64 encoded (default: false)'
          },
          backupBeforeWrite: {
            type: 'boolean',
            description: 'Create a backup of original file before writing (default: false)'
          }
        },
        required: ['description', 'filePath', 'content']
      }
    };
  }
}
