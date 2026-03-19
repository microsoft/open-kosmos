/**
 * @deprecated This tool is DEPRECATED. Use `write_file` instead.
 * 
 * CreateFileTool built-in tool (deprecated)
 * 
 * ⚠️ DEPRECATION NOTICE:
 * This tool has been superseded by `write_file` which provides all the same
 * functionality plus additional features (append, prepend, insert modes).
 * 
 * Migration: Use `write_file` with mode='overwrite' (default) for identical behavior.
 * 
 * Original functionality:
 * - Provides file creation capability for LLM to invoke proactively
 * - Resolves issues with execute_command when handling special characters
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import { getUnifiedLogger, UnifiedLogger } from '../../unifiedLogger';

export interface CreateFileToolArgs {
  // Required parameters
  filePath: string;           // Full path of the file
  content: string;            // File content (raw string, no escaping needed)
  
  // Optional parameters
  encoding?: BufferEncoding;  // File encoding, default 'utf-8'
  overwrite?: boolean;        // Whether to overwrite existing files, default true
  createDirectories?: boolean; // Whether to auto-create parent directories, default true
  validateJson?: boolean;     // For JSON files, whether to validate JSON format
}

export interface CreateFileToolResult {
  success: boolean;
  filePath: string;           // Path of the created file
  size: number;               // File size (bytes)
  created: boolean;           // Whether newly created (false means an existing file was overwritten)
  encoding: string;           // Encoding used
  contentValid?: boolean;     // JSON validation result (only when validateJson=true)
  error?: string;             // Error message (if any)
}

// File size limit: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file extensions for creation (security whitelist)
const ALLOWED_EXTENSIONS = [
  '.json', '.md', '.txt', '.csv', '.xml', '.yaml', '.yml',
  '.html', '.css', '.js', '.ts', '.jsx', '.tsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.sh', '.bat', '.ps1', '.cmd',
  '.log', '.ini', '.conf', '.config', '.env',
  '.gitignore', '.dockerignore', '.editorconfig',
  '' // Allow files without extensions
];

export class CreateFileTool {
  private static logger: UnifiedLogger = getUnifiedLogger();

  /**
   * Execute file creation
   */
  static async execute(args: CreateFileToolArgs): Promise<CreateFileToolResult> {
    const startTime = Date.now();
    const executionId = `create_file_${startTime}`;
    
    this.logger.info(
      `CreateFileTool execution started`,
      'CreateFileTool',
      { executionId, filePath: args.filePath, contentLength: args.content?.length }
    );

    try {
      // 1. Argument validation
      const validation = this.validateArgs(args);
      if (!validation.isValid) {
        this.logger.error(
          `Arguments validation failed: ${validation.error}`,
          'CreateFileTool',
          { executionId, error: validation.error }
        );
        return {
          success: false,
          filePath: args.filePath,
          size: 0,
          created: false,
          encoding: args.encoding || 'utf-8',
          error: validation.error
        };
      }

      // 2. Normalize path
      const normalizedPath = path.normalize(args.filePath);
      const encoding = args.encoding || 'utf-8';
      const overwrite = args.overwrite !== false; // default true
      const createDirectories = args.createDirectories !== false; // default true

      // 3. Check if file already exists
      let fileExists = false;
      try {
        await fs.access(normalizedPath);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      // 4. If file exists and overwrite is not allowed, return error
      if (fileExists && !overwrite) {
        this.logger.warn(
          `File already exists and overwrite is disabled`,
          'CreateFileTool',
          { executionId, filePath: normalizedPath }
        );
        return {
          success: false,
          filePath: normalizedPath,
          size: 0,
          created: false,
          encoding,
          error: `File already exists: ${normalizedPath}. Set overwrite=true to replace it.`
        };
      }

      // 5. Create parent directories (if needed)
      if (createDirectories) {
        const dirPath = path.dirname(normalizedPath);
        await fs.mkdir(dirPath, { recursive: true });
        this.logger.debug(
          `Parent directories ensured`,
          'CreateFileTool',
          { executionId, dirPath }
        );
      }

      // 6. JSON validation (if needed)
      let contentValid: boolean | undefined;
      if (args.validateJson && normalizedPath.endsWith('.json')) {
        try {
          const parsed = JSON.parse(args.content);
          contentValid = parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed));
          if (!contentValid) {
            this.logger.warn(
              `JSON content is valid but empty or primitive`,
              'CreateFileTool',
              { executionId }
            );
          }
        } catch (jsonError) {
          this.logger.error(
            `JSON validation failed`,
            'CreateFileTool',
            { executionId, error: jsonError instanceof Error ? jsonError.message : 'Invalid JSON' }
          );
          return {
            success: false,
            filePath: normalizedPath,
            size: 0,
            created: false,
            encoding,
            contentValid: false,
            error: `Invalid JSON content: ${jsonError instanceof Error ? jsonError.message : 'Parse error'}`
          };
        }
      }

      // 7. Write file
      await fs.writeFile(normalizedPath, args.content, { encoding });

      // 8. Verify write result
      const stats = await fs.stat(normalizedPath);
      const writtenContent = await fs.readFile(normalizedPath, { encoding });
      
      if (writtenContent !== args.content) {
        this.logger.error(
          `Content verification failed - written content does not match`,
          'CreateFileTool',
          { executionId, expectedLength: args.content.length, actualLength: writtenContent.length }
        );
        return {
          success: false,
          filePath: normalizedPath,
          size: stats.size,
          created: !fileExists,
          encoding,
          error: 'Content verification failed: written content does not match original'
        };
      }

      const result: CreateFileToolResult = {
        success: true,
        filePath: normalizedPath,
        size: stats.size,
        created: !fileExists,
        encoding,
        contentValid
      };

      this.logger.info(
        `CreateFileTool execution completed successfully`,
        'CreateFileTool',
        { 
          executionId, 
          filePath: normalizedPath, 
          size: stats.size, 
          created: !fileExists,
          durationMs: Date.now() - startTime 
        }
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `CreateFileTool execution failed`,
        'CreateFileTool',
        { executionId, error: errorMessage, stack: error instanceof Error ? error.stack : undefined }
      );

      return {
        success: false,
        filePath: args.filePath,
        size: 0,
        created: false,
        encoding: args.encoding || 'utf-8',
        error: errorMessage
      };
    }
  }

  /**
   * Argument validation
   */
  private static validateArgs(args: CreateFileToolArgs): { isValid: boolean; error?: string } {
    // Check required parameters
    if (!args.filePath|| typeof args.filePath !== 'string') {
      return { isValid: false, error: 'filePath is required and must be a string' };
    }

    if (args.content === undefined || args.content === null) {
      return { isValid: false, error: 'content is required' };
    }

    if (typeof args.content !== 'string') {
      return { isValid: false, error: 'content must be a string' };
    }

    // Check file size
    const contentSize = Buffer.byteLength(args.content, args.encoding || 'utf-8');
    if (contentSize > MAX_FILE_SIZE) {
      return { 
        isValid: false, 
        error: `Content size (${contentSize} bytes) exceeds maximum allowed (${MAX_FILE_SIZE} bytes)` 
      };
    }

    // Check file extension
    const ext = path.extname(args.filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { 
        isValid: false, 
        error: `File extension "${ext}" is not allowed. Allowed extensions: ${ALLOWED_EXTENSIONS.filter(e => e).join(', ')}` 
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
      name: 'create_file',
      description: `⚠️ DEPRECATED - DO NOT USE THIS TOOL. Use \`write_file\` instead.

This tool is deprecated and will be removed in a future version. All its functionality has been merged into \`write_file\`.

**Migration:** Replace \`create_file(filePath, content)\` with \`write_file(filePath, content, mode='overwrite')\`

For JSON validation, use: \`write_file(filePath, content, validateJson=true)\``,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'The full path where the file should be created'
          },
          content: {
            type: 'string',
            description: 'The content to write to the file (no escaping needed)'
          },
          encoding: {
            type: 'string',
            enum: ['utf-8', 'utf8', 'ascii', 'utf16le', 'ucs2', 'base64', 'latin1', 'binary', 'hex'],
            description: 'File encoding (default: utf-8)'
          },
          overwrite: {
            type: 'boolean',
            description: 'Whether to overwrite if file exists (default: true)'
          },
          createDirectories: {
            type: 'boolean',
            description: 'Whether to create parent directories if they do not exist (default: true)'
          },
          validateJson: {
            type: 'boolean',
            description: 'For .json files, validate that content is valid JSON before writing (default: false)'
          }
        },
        required: ['filePath', 'content']
      }
    };
  }
}
