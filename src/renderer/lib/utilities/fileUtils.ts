/**
 * File attachment processor - strictly follows VSCode approach
 * Handles file validation, preprocessing and text file truncation control
 */

import { ChatReferenceFileData, FileReference, SUPPORTED_TEXT_TYPES, FILE_ATTACHMENT_LIMITS, SUPPORTED_IMAGE_TYPES } from '../../types/chatTypes';

export class FileAttachmentProcessor {
  
  /**
   * Validate if a file can be used as an attachment
   */
  static validateFileForAttachment(file: File): {
    valid: boolean;
    reason?: string;
    isText: boolean;
  } {
    // Check file size
    if (file.size > FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES) {
      return {
        valid: false,
        reason: `File too large, maximum supported size is ${FILE_ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`,
        isText: false
      };
    }
    
    // Check file type
    const isImage = SUPPORTED_IMAGE_TYPES.includes(file.type as any);
    const isText = SUPPORTED_TEXT_TYPES.includes(file.type as any) || 
                   this.isTextFileByExtension(file.name);
    
    if (!isImage && !isText) {
      return {
        valid: false,
        reason: 'Unsupported file format. Please select an image or text file',
        isText: false
      };
    }
    
    return { valid: true, isText };
  }
  
  /**
   * Determine if a file is a text file based on its extension
   */
  static isTextFileByExtension(fileName: string): boolean {
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    return FILE_ATTACHMENT_LIMITS.SUPPORTED_TEXT_EXTENSIONS.includes(extension as any);
  }
  
  /**
   * 🔥 Refactored: Create file metadata following document design (no full content storage)
   * Smart metadata replacement strategy: only store metadata, content replacement done on-demand in AgentChat
   */
  static async processTextFile(file: File, filePath?: string): Promise<ChatReferenceFileData> {
    const text = await file.text();
    const lines = text.split('\n');
    
    // 🔥 Core fix: Following document design, only create metadata without storing full content
    const actualFilePath = filePath || file.name;
    const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
    
    const fileReference: FileReference = {
      filePath: actualFilePath,
      fileName: file.name,
      fileSize: file.size,
      fileType: fileExtension,
      mimeType: file.type || 'text/plain',
      lineCount: lines.length,
      lastModified: file.lastModified,
      isTextFile: true
    };
    
    // 🔥 Key: Following document design, do not store text content here
    // Content will be dynamically loaded when needed via smart metadata replacement strategy
    return {
      mimeType: file.type || 'text/plain',
      data: async () => new TextEncoder().encode(''), // Metadata mode: no actual content stored
      reference: actualFilePath,
      size: file.size, // Use original file size
      isText: true,
      fileName: file.name,
      // text: undefined, // 🔥 Key fix: Do not store text content, following document design
      fileReference: fileReference // Core: only store metadata
    };
  }

  /**
   * 🔄 Added: Create file attachment from full file path obtained via file selector
   * Supports full file path and metadata in Electron environment
   */
  static async processFileFromPath(filePath: string): Promise<ChatReferenceFileData> {
    // Check if in Electron environment
    if (typeof window !== 'undefined' && (window as any).electronAPI?.fs) {
      try {
        // Use Electron API to get full file metadata
        const result = await (window as any).electronAPI.fs.getFileMetadata(filePath);
        
        if (result.success && result.metadata) {
          const metadata = result.metadata;
          
          const fileReference: FileReference = {
            filePath: metadata.fullPath,
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            fileType: metadata.fileType,
            mimeType: metadata.mimeType,
            lineCount: metadata.lineCount,
            lastModified: metadata.lastModified,
            isTextFile: metadata.isTextFile
          };
          
          return {
            mimeType: metadata.mimeType,
            data: async () => new TextEncoder().encode(''), // Metadata mode
            reference: metadata.fullPath,
            size: metadata.fileSize,
            isText: metadata.isTextFile,
            fileName: metadata.fileName,
            fileReference: fileReference
          };
        } else {
          throw new Error(result.error || 'Failed to get file metadata');
        }
      } catch (error) {
        // Fall back to basic processing
        return this.createFileReference(filePath, filePath.split('/').pop() || 'unknown', 0);
      }
    } else {
      // Browser environment fallback processing
      return this.createFileReference(filePath, filePath.split('/').pop() || 'unknown', 0);
    }
  }
  
  /**
   * 🔄 Added: Full content processing for backward compatibility (only used when needed)
   * This method is only used in special cases; normally metadata mode should be used
   */
  static async processTextFileWithContent(file: File, filePath?: string): Promise<ChatReferenceFileData> {
    const text = await file.text();
    const lines = text.split('\n');
    
    // Apply VSCode truncation rules
    let processedText = text;
    let truncated = false;
    
    if (lines.length > FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES) {
      processedText = lines.slice(0, FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES).join('\n');
      processedText += `\n\n[File content truncated, showing first ${FILE_ATTACHMENT_LIMITS.MAX_TEXT_LINES} lines of ${lines.length} total]`;
      truncated = true;
    }
    
    const estimatedTokens = this.estimateTokenCount(processedText);
    if (estimatedTokens > FILE_ATTACHMENT_LIMITS.MAX_TOKEN_BUDGET) {
      const maxChars = FILE_ATTACHMENT_LIMITS.MAX_TOKEN_BUDGET * 4;
      if (processedText.length > maxChars) {
        processedText = processedText.slice(0, maxChars);
        processedText += `\n\n[File content truncated due to token budget]`;
        truncated = true;
      }
    }
    
    const actualFilePath = filePath || file.name;
    const fileReference: FileReference = {
      filePath: actualFilePath,
      fileName: file.name,
      fileSize: file.size,
      lineCount: lines.length,
      lastModified: file.lastModified,
      isTextFile: true
    };
    
    return {
      mimeType: file.type || 'text/plain',
      data: async () => new TextEncoder().encode(processedText),
      reference: actualFilePath,
      size: processedText.length,
      isText: true,
      fileName: file.name,
      text: processedText, // This method includes full content
      fileReference: fileReference
    };
  }
  
  /**
   * Create file reference (for smart metadata replacement strategy)
   */
  static createFileReference(
    filePath: string,
    fileName: string,
    fileSize: number,
    offsetLine?: number,
    lineCount?: number,
    fileType?: string,
    mimeType?: string,
    lastModified?: number
  ): ChatReferenceFileData {
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || '';
    const detectedMimeType = mimeType || this.getMimeTypeFromExtension(fileExtension);
    
    const fileReference: FileReference = {
      filePath,
      fileName,
      fileSize,
      fileType: fileType || fileExtension,
      mimeType: detectedMimeType,
      startLine: offsetLine,
      lineCount,
      lastModified: lastModified || Date.now(),
      isTextFile: this.isTextFileByExtension(fileName)
    };
    
    return {
      mimeType: detectedMimeType,
      data: async () => new TextEncoder().encode(''), // No actual content stored in metadata mode
      reference: filePath,
      size: fileSize,
      isText: fileReference.isTextFile,
      fileName: fileName,
      fileReference: fileReference // Core: only store metadata
    };
  }

  /**
   * 🔄 Added: Get MIME type based on file extension
   */
  private static getMimeTypeFromExtension(extension: string): string {
    const mimeTypeMap: { [key: string]: string } = {
      'txt': 'text/plain',
      'md': 'text/markdown',
      'js': 'text/javascript',
      'ts': 'text/typescript',
      'jsx': 'text/javascript',
      'tsx': 'text/typescript',
      'css': 'text/css',
      'html': 'text/html',
      'htm': 'text/html',
      'json': 'application/json',
      'xml': 'application/xml',
      'yaml': 'text/yaml',
      'yml': 'text/yaml',
      'py': 'text/x-python',
      'java': 'text/x-java',
      'c': 'text/x-c',
      'cpp': 'text/x-cpp',
      'h': 'text/x-c',
      'hpp': 'text/x-cpp',
      'cs': 'text/x-csharp',
      'go': 'text/x-go',
      'rs': 'text/x-rust',
      'php': 'text/x-php',
      'rb': 'text/x-ruby',
      'sh': 'text/x-shellscript',
      'bat': 'text/x-batch',
      'sql': 'text/x-sql'
    };
    
    return mimeTypeMap[extension.toLowerCase()] || 'text/plain';
  }
  
  /**
   * Estimate token count for text
   * Uses the same estimation formula as VSCode: length * 3 / 4
   */
  private static estimateTokenCount(text: string): number {
    return Math.ceil(text.length * 3 / 4);
  }
}

/**
 * File security validator - prevents path traversal attacks and dangerous file access
 */
export class FileSecurityValidator {
  static validatePath(filePath: string, allowAbsolutePaths: boolean = false): { isValid: boolean; error?: string } {
    // 1. Check for path traversal attack
    if (this.isPathTraversalAttack(filePath)) {
      return { isValid: false, error: 'potential directory traversal attack' };
    }
    
    // 2. Check absolute paths (with exception for file attachment feature)
    if (!allowAbsolutePaths && this.isAbsolutePath(filePath)) {
      return { isValid: false, error: 'absolute paths not allowed' };
    }
    
    // 3. Check for dangerous path patterns
    const dangerousPatterns = [
      /etc\/passwd/i,
      /windows\/system32/i,
      /\.ssh\/id_rsa/i,
      /\.aws\/credentials/i
    ];
    
    const isDangerous = dangerousPatterns.some(pattern => pattern.test(filePath));
    if (isDangerous) {
      return { isValid: false, error: 'access to sensitive system files denied' };
    }
    
    return { isValid: true };
  }
  
  static isPathTraversalAttack(path: string): boolean {
    const patterns = [
      '../',     // Unix-style upward traversal
      '..\\',    // Windows-style upward traversal
      '/etc/',   // Direct access to system directory
      '~/',      // User directory
      '$HOME',   // Environment variable
      '%USERPROFILE%' // Windows user directory variable
    ];
    
    // Check for relative path traversal attack patterns
    for (const pattern of patterns) {
      if (path.includes(pattern)) {
        return true;
      }
    }
    
    // Special check: Windows absolute paths should not contain relative path components
    if (/^[A-Za-z]:[\\\/]/.test(path)) {
      // Check for relative path traversal in Windows absolute paths
      const normalizedPath = path.replace(/\\/g, '/');
      if (normalizedPath.includes('/../') || normalizedPath.includes('/./')) {
        return true;
      }
    }
    
    return false;
  }
  
  static isAbsolutePath(path: string): boolean {
    // Unix absolute path: starts with /
    if (path.startsWith('/')) {
      return true;
    }
    
    // Windows absolute path: C:\ or \\server\share
    if (/^[A-Za-z]:[\\\/]/.test(path) || path.startsWith('\\\\')) {
      return true;
    }
    
    return false;
  }
}

/**
 * File reader - supports pagination and token control
 */
export class FileReader {
  static async readFileWithPagination(args: {
    path: string;
    startLine?: number;
    endLine?: number;
  }): Promise<{
    content: string;
    fileName: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    size: number;
    truncated: boolean;
  }> {
    // This should call Electron's file system API
    // Currently returns mock data, actual implementation requires IPC call to main process
    throw new Error('FileReader.readFileWithPagination needs implementation with Electron IPC');
  }
}