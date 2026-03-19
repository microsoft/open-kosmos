/**
 * ReadFileTool built-in tool - V2 optimized version
 * Uses streaming read + triple safety limits to prevent memory overflow
 * 
 * Core improvements:
 * 1. Uses createReadStream + readline instead of fs.readFile
 * 2. Triple hard limits: MAX_BYTES + MAX_LINES + MAX_LINE_LENGTH
 * 3. Two-phase model: Probe → Targeted Scan
 * 4. Agent-friendly return values: truncationReason + fileTypeHint
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as readline from 'readline';
import { BuiltinToolDefinition, ToolExecutionResult } from './types';

// Re-export types for backward compatibility

// ============ Safety limit constants ============
const READ_FILE_LIMITS = {
  MAX_BYTES_PER_CALL: 128 * 1024,    // 128KB - Maximum bytes per read call
  MAX_LINES_PER_CALL: 500,            // Maximum lines returned per call
  MAX_LINE_LENGTH: 8 * 1024,          // 8KB - Maximum single line length
  PROBE_SIZE: 8 * 1024,               // 8KB - Probe phase read size
  HIGH_WATER_MARK: 64 * 1024,         // 64KB - Stream buffer
} as const;

// ============ Type definitions ============
export type TruncationReason = 
  | 'max_lines' 
  | 'max_bytes' 
  | 'max_line_length' 
  | 'file_end'
  | 'none';

export type FileTypeHint = 
  | 'text' 
  | 'html' 
  | 'json' 
  | 'minified' 
  | 'binary' 
  | 'unknown';

export interface ReadFileToolArgs {
  filePath: string;
  startLine?: number;
  endLine?: number;
  lineCount?: number;
  description?: string;  // Operation description for UI display
}

export interface ReadFileToolResult {
  content: string;
  fileName: string;
  startLine: number;
  endLine: number;
  totalLines?: number;            // best-effort, may not be precise
  totalLinesEstimated?: boolean;  // Whether it is an estimated value
  size: number;
  truncated: boolean;
  truncationReason?: TruncationReason;
  fileTypeHint: FileTypeHint;
  fileSizeBytes: number;
  bytesRead: number;
}

export class ReadFileTool {
  
  /**
   * Execute the file read tool
   * Static method, supports direct invocation by LLM
   */
  static async execute(args: ReadFileToolArgs): Promise<ReadFileToolResult> {
    
    // 1. Resolve file path (supports multiple formats)
    const actualPath = this.resolveFilePath(args);
    
    // 2. Argument validation
    const validation = this.validateArgs({ ...args, path: actualPath });
    if (!validation.isValid) {
      throw new Error(`Invalid arguments: ${validation.error}`);
    }

    // 3. File reading and processing (V2 optimized version)
    try {
      const result = await this.readFileWithStreamPagination({ ...args, path: actualPath });
      return result;
    } catch (error) {
      throw new Error(`File read failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 🔄 Resolve file path, supports multiple input formats
   */
  private static resolveFilePath(args: ReadFileToolArgs): string {
    const path = args.filePath;
    
    if (!path) {
      throw new Error('No file path provided. filePath is required');
    }
    
    return path;
  }

  /**
   * Get tool definition (V2 optimized - Agent-friendly description)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'read_file',
      description: `Read file content with streaming pagination.
IMPORTANT CONSTRAINTS:
- Max ${READ_FILE_LIMITS.MAX_BYTES_PER_CALL / 1024}KB per call
- Max ${READ_FILE_LIMITS.MAX_LINES_PER_CALL} lines per call
- Lines exceeding ${READ_FILE_LIMITS.MAX_LINE_LENGTH / 1024}KB are truncated
- Returns fileTypeHint: 'minified' for machine-generated files - consider using grep/selector tools instead
- Returns fileTypeHint: 'binary' - DO NOT attempt to read binary files
- Returns fileTypeHint: 'html' - Consider using read_html tool for better HTML handling`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'A brief description of what is being read (for UI display). E.g., "Reading config file", "Checking package.json"'
          },
          filePath: {
            type: 'string',
            description: 'Path to the file to read (relative or absolute)'
          },
          startLine: {
            type: 'number',
            description: 'Starting line number (1-based, default: 1)',
            minimum: 1
          },
          endLine: {
            type: 'number',
            description: 'Ending line number (1-based, optional)',
            minimum: 1
          },
          lineCount: {
            type: 'number',
            description: `Number of lines to read from startLine (max: ${READ_FILE_LIMITS.MAX_LINES_PER_CALL})`,
            minimum: 1
          }
        },
        required: ['description', 'filePath']
      }
    };
  }

  /**
   * Validate arguments
   */
  private static validateArgs(args: ReadFileToolArgs & { path: string }): { isValid: boolean; error?: string } {
    // Validate path
    if (!args.path || typeof args.path !== 'string') {
      return { isValid: false, error: 'filePath is required and must be a string' };
    }

    // Validate startLine
    const startLine = args.startLine;
    if (startLine !== undefined) {
      if (!Number.isInteger(startLine) || startLine < 1) {
        return { isValid: false, error: 'startLine must be a positive integer' };
      }
    }

    // Validate endLine
    if (args.endLine !== undefined) {
      if (!Number.isInteger(args.endLine) || args.endLine < 1) {
        return { isValid: false, error: 'endLine must be a positive integer' };
      }
    }

    // Validate lineCount
    if (args.lineCount !== undefined) {
      if (!Number.isInteger(args.lineCount) || args.lineCount < 1) {
        return { isValid: false, error: 'lineCount must be a positive integer' };
      }
    }

    // Validate range logic
    const actualStartLine = startLine || 1;
    if (args.endLine !== undefined && actualStartLine > args.endLine) {
      return { isValid: false, error: 'startLine cannot be greater than endLine' };
    }

    return { isValid: true };
  }

  // ============ Phase 1: Probe (lightweight detection) ============
  
  /**
   * Probe file type and characteristics, reads only the first 8KB
   */
  private static async probeFile(path: string): Promise<{
    fileSize: number;
    fileTypeHint: FileTypeHint;
    isMinified: boolean;
  }> {
    const stat = await fsPromises.stat(path);
    const fileSize = stat.size;
    
    // Read the first PROBE_SIZE bytes for probing
    const probeBuffer = Buffer.alloc(READ_FILE_LIMITS.PROBE_SIZE);
    const fd = await fsPromises.open(path, 'r');
    try {
      const { bytesRead } = await fd.read(probeBuffer, 0, READ_FILE_LIMITS.PROBE_SIZE, 0);
      const probeContent = probeBuffer.subarray(0, bytesRead).toString('utf8');
      
      const fileTypeHint = this.detectFileType(probeContent);
      const isMinified = this.detectMinified(probeContent);
      
      return { fileSize, fileTypeHint, isMinified };
    } finally {
      await fd.close();
    }
  }

  /**
   * Detect file type
   */
  private static detectFileType(content: string): FileTypeHint {
    // Binary detection: contains null characters
    if (content.includes('\0')) return 'binary';
    
    // HTML detection
    if (/<(!DOCTYPE|html|head|body|div|span)/i.test(content)) return 'html';
    
    // JSON detection
    if (/^\s*[\[{]/.test(content)) return 'json';
    
    return 'text';
  }

  /**
   * Detect whether the file is minified
   */
  private static detectMinified(content: string): boolean {
    const lines = content.split('\n');
    const avgLineLength = content.length / Math.max(lines.length, 1);
    
    // Average line length > 500 or very few newlines → likely minified
    return avgLineLength > 500 || (content.length > 1000 && lines.length < 5);
  }

  // ============ Phase 2: Targeted Scan (controlled scanning) ============

  /**
   * V2 optimized: streaming read + triple safety limits
   * Never reads the entire file into memory
   */
  private static async readFileWithStreamPagination(
    args: ReadFileToolArgs & { path: string }
  ): Promise<ReadFileToolResult> {
    const { path, startLine = 1 } = args;
    
    // Phase 1: Probe - lightweight detection
    const { fileSize, fileTypeHint, isMinified } = await this.probeFile(path);
    
    // Extract file name from path
    const fileName = path.split('/').pop() || path.split('\\').pop() || path;
    
    // Reject binary files directly
    if (fileTypeHint === 'binary') {
      return {
        content: '[Binary file detected - use appropriate tool for binary files]',
        fileName,
        startLine,
        endLine: startLine,
        truncated: true,
        truncationReason: 'max_bytes',
        fileTypeHint,
        fileSizeBytes: fileSize,
        bytesRead: 0,
        size: 0,
      };
    }
    
    // Phase 2: Stream read - using readline module
    const stream = fs.createReadStream(path, {
      encoding: 'utf8',
      highWaterMark: READ_FILE_LIMITS.HIGH_WATER_MARK,
    });
    
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
    
    const resultLines: string[] = [];
    let currentLine = 0;
    let totalBytes = 0;
    let truncated = false;
    let truncationReason: TruncationReason = 'none';
    let hasLongLines = false;
    
    // Calculate effective maximum line count
    const requestedLines = args.lineCount || 
      (args.endLine ? args.endLine - startLine + 1 : READ_FILE_LIMITS.MAX_LINES_PER_CALL);
    const effectiveMaxLines = Math.min(requestedLines, READ_FILE_LIMITS.MAX_LINES_PER_CALL);
    
    try {
      for await (const line of rl) {
        currentLine++;
        
        // Skip lines before startLine
        if (currentLine < startLine) continue;
        
        // Check endLine limit
        if (args.endLine && currentLine > args.endLine) {
          truncationReason = 'file_end';
          break;
        }
        
        // Check line count limit
        if (resultLines.length >= effectiveMaxLines) {
          truncated = true;
          truncationReason = 'max_lines';
          break;
        }
        
        // Handle overly long lines - truncate and mark
        let processedLine = line;
        if (line.length > READ_FILE_LIMITS.MAX_LINE_LENGTH) {
          hasLongLines = true;
          processedLine = line.slice(0, READ_FILE_LIMITS.MAX_LINE_LENGTH) +
            `\n[... ${line.length - READ_FILE_LIMITS.MAX_LINE_LENGTH} chars truncated ...]`;
        }
        
        // Check byte limit
        if (totalBytes + processedLine.length > READ_FILE_LIMITS.MAX_BYTES_PER_CALL) {
          truncated = true;
          truncationReason = 'max_bytes';
          break;
        }
        
        totalBytes += processedLine.length + 1; // +1 for newline
        resultLines.push(processedLine);
      }
    } finally {
      rl.close();
      stream.destroy();
    }
    
    // If not truncated due to limits, check if end of file was reached
    if (!truncated && truncationReason === 'none') {
      truncationReason = 'file_end';
    }
    
    // Adjust fileTypeHint - overly long lines are also marked as minified
    const finalFileTypeHint: FileTypeHint = 
      isMinified ? 'minified' : 
      hasLongLines ? 'minified' : 
      fileTypeHint;
    
    const resultContent = resultLines.join('\n');
    const actualEndLine = startLine + resultLines.length - 1;
    
    return {
      content: resultContent,
      fileName,
      startLine,
      endLine: Math.max(actualEndLine, startLine),
      // totalLines only provides exact value when fully read
      totalLines: !truncated && startLine === 1 ? currentLine : undefined,
      totalLinesEstimated: truncated || startLine > 1,
      size: resultContent.length,
      truncated,
      truncationReason: truncated ? truncationReason : undefined,
      fileTypeHint: finalFileTypeHint,
      fileSizeBytes: fileSize,
      bytesRead: totalBytes,
    };
  }
}