/**
 * DownloadFileTool built-in tool - modeled after bingWebSearchTool
 * Provides file download and local save capability for LLM-initiated calls,
 * supporting images, documents, installers, and many other formats
 * Note: This is a built-in tool, not an MCP protocol tool
 */

import { BuiltinToolDefinition, ToolExecutionResult } from './types';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getUnifiedLogger } from '../../unifiedLogger';

const logger = getUnifiedLogger();

export interface DownloadAndSaveAsArgs {
  url: string; // Download URL, HTTP/HTTPS only
  filename: string; // Filename to save as, including extension
  saveDirectory?: string; // Save directory, defaults to user Downloads folder
  maxSizeBytes?: number; // Maximum file size, default 100MB
  timeout?: number; // Request timeout in ms, default 30 seconds
  overwrite?: boolean; // Whether to overwrite existing files, default false
  createDirectory?: boolean; // Whether to auto-create directory, default true
}

export interface DownloadAndSaveAsResult {
  success: boolean;
  filePath: string; // Full path where the file was actually saved
  fileSize: number; // File size in bytes
  mimeType?: string; // File MIME type
  downloadTime: number; // Download duration in milliseconds
  error?: string; // Error message
  timestamp: string; // Operation timestamp
}

/**
 * Validate whether a URL is a valid HTTP/HTTPS link
 */
function validateUrl(url: string): { isValid: boolean; error?: string } {
  try {
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return { isValid: false, error: 'Only HTTP and HTTPS protocols are supported' };
    }
    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validate that a filename is safe (prevents path traversal attacks)
 */
function validateFilename(filename: string): { isValid: boolean; error?: string } {
  // Check whether the filename contains path separators
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { isValid: false, error: 'Filename cannot contain path separators or relative paths' };
  }

  // Check whether the filename is empty or contains only whitespace
  if (!filename.trim()) {
    return { isValid: false, error: 'Filename cannot be empty' };
  }

  // Check for characters not allowed on Windows/Linux
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(filename)) {
    return { isValid: false, error: 'Filename contains invalid characters' };
  }

  // Check length limit
  if (filename.length > 255) {
    return { isValid: false, error: 'Filename too long (max 255 characters)' };
  }

  return { isValid: true };
}

/**
 * Validate and normalize the save directory path
 */
function validateAndNormalizePath(saveDirectory: string, createDirectory: boolean): { isValid: boolean; normalizedPath?: string; error?: string } {
  try {
    // Resolve to an absolute path
    const normalizedPath = path.resolve(saveDirectory);

    // Security check: restrict access to user directory; system-sensitive directories are not allowed
    const userHome = os.homedir();
    const isInUserDir = normalizedPath.startsWith(userHome);

    if (!isInUserDir) {
      return { isValid: false, error: 'Save directory must be within user home directory for security reasons' };
    }

    // Check whether the directory exists
    if (fs.existsSync(normalizedPath)) {
      const stats = fs.statSync(normalizedPath);
      if (!stats.isDirectory()) {
        return { isValid: false, error: 'Save path exists but is not a directory' };
      }
    } else if (createDirectory) {
      // Try to create the directory
      try {
        fs.mkdirSync(normalizedPath, { recursive: true });
      } catch (error) {
        return { isValid: false, error: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}` };
      }
    } else {
      return { isValid: false, error: 'Save directory does not exist and createDirectory is false' };
    }

    return { isValid: true, normalizedPath };
  } catch (error) {
    return { isValid: false, error: `Invalid save directory: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

/**
 * Get common file extension for a given MIME type
 */
function getMimeTypeExtension(mimeType: string): string {
  const mimeToExt: { [key: string]: string } = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'text/plain': '.txt',
    'application/json': '.json',
    'application/xml': '.xml',
    'text/xml': '.xml',
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3'
  };

  return mimeToExt[mimeType.toLowerCase()] || '';
}

export class DownloadFileTool {

  /**
   * Execute the file download and save tool
   * Static method, supports direct LLM invocation
   */
  static async execute(args: DownloadAndSaveAsArgs, options?: { signal?: AbortSignal }): Promise<DownloadAndSaveAsResult> {

    const startTime = Date.now();

    // 1. Validate arguments
    const validation = this.validateArgs(args);
    if (!validation.isValid) {
      throw new Error(`Invalid arguments: ${validation.error}`);
    }

    const {
      url,
      filename,
      saveDirectory = path.join(os.homedir(), 'Downloads'),
      maxSizeBytes = 100 * 1024 * 1024, // 100MB
      timeout = 30000, // 30 seconds
      overwrite = false,
      createDirectory = true
    } = args;

    try {
      // 2. Validate save directory
      const pathValidation = validateAndNormalizePath(saveDirectory, createDirectory);
      if (!pathValidation.isValid) {
        throw new Error(pathValidation.error);
      }

      const normalizedSaveDir = pathValidation.normalizedPath!;
      const fullFilePath = path.join(normalizedSaveDir, filename);

      // 3. Check whether the file already exists
      if (fs.existsSync(fullFilePath) && !overwrite) {
        throw new Error(`File already exists: ${fullFilePath}. Set overwrite=true to replace it.`);
      }


      // 4. Initiate the download request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const externalSignal = options?.signal;
      const fetchSignal = externalSignal
        ? AbortSignal.any([externalSignal, controller.signal])
        : controller.signal;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        signal: fetchSignal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // 5. Check file size
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > maxSizeBytes) {
        throw new Error(`File too large: ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`);
      }

      // 6. Get MIME type
      const mimeType = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';

      // 7. Validate that file extension matches MIME type (warn but don't block)
      const expectedExt = getMimeTypeExtension(mimeType);
      const actualExt = path.extname(filename).toLowerCase();
      if (expectedExt && actualExt !== expectedExt) {
      }

      // 8. Download file content
      if (!response.body) {
        throw new Error('Response body is empty');
      }

      const fileStream = fs.createWriteStream(fullFilePath);
      let downloadedBytes = 0;

      // Monitor download progress and enforce size limit
      for await (const chunk of response.body) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxSizeBytes) {
          fileStream.close();
          fs.unlinkSync(fullFilePath); // Delete partially downloaded file
          throw new Error(`File too large: Downloaded ${downloadedBytes} bytes exceeds limit of ${maxSizeBytes} bytes`);
        }
        fileStream.write(chunk);
      }

      fileStream.end();

      // 9. Wait for file write to complete
      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', () => resolve());
        fileStream.on('error', reject);
      });

      const downloadTime = Date.now() - startTime;


      return {
        success: true,
        filePath: fullFilePath,
        fileSize: downloadedBytes,
        mimeType,
        downloadTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const downloadTime = Date.now() - startTime;

      let errorMsg: string;
      if (error instanceof Error && error.name === 'AbortError') {
        errorMsg = options?.signal?.aborted ? 'Download cancelled by user' : 'Download timed out';
      } else {
        errorMsg = error instanceof Error ? error.message : String(error);
      }

      return {
        success: false,
        filePath: '',
        fileSize: 0,
        downloadTime,
        error: errorMsg,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get tool definition (for registration in BuiltinToolsManager)
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'download_file',
      description: 'Download any file from HTTP/HTTPS URLs and save to local filesystem. No restrictions on file types, extensions, or content formats - supports ALL file types.\n\nSecurity features:\n- Path traversal protection\n- File size limits (default 100MB, max 1GB)\n- Safe filename validation\n- Directory sandboxing to user home directory only\n- MIME type validation (warnings only, never blocks downloads)\n\nExamples of what you can download:\n- Images, documents, archives, media files\n- Executables, installers, source code\n- Configuration files, data files, backups\n- Any file accessible via HTTP/HTTPS\n\nIMPORTANT: Files are saved within user home directory only for security. When specifying saveDirectory, use absolute paths like:\n- C:\\Users\\username\\Desktop (for Desktop)\n- C:\\Users\\username\\Documents (for Documents)\n- C:\\Users\\username\\Downloads (for Downloads)\nDo not use relative names like "desktop folder" or "documents folder".',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'HTTP/HTTPS URL of the file to download',
            pattern: '^https?://.+'
          },
          filename: {
            type: 'string',
            description: 'Name to save the file as (including extension)',
            minLength: 1,
            maxLength: 255
          },
          saveDirectory: {
            type: 'string',
            description: 'Directory to save the file in (default: user Downloads folder). Must be within user home directory. Use absolute paths like C:\\Users\\username\\Desktop or C:\\Users\\username\\Documents. Do not use relative names like "desktop folder".',
            default: 'Downloads folder'
          },
          maxSizeBytes: {
            type: 'number',
            description: 'Maximum file size in bytes (default: 104857600 = 100MB)',
            minimum: 1,
            maximum: 1073741824, // 1GB
            default: 104857600
          },
          timeout: {
            type: 'number',
            description: 'Download timeout in milliseconds (default: 30000 = 30 seconds)',
            minimum: 1000,
            maximum: 300000, // 5 minutes
            default: 30000
          },
          overwrite: {
            type: 'boolean',
            description: 'Whether to overwrite existing files (default: false)',
            default: false
          },
          createDirectory: {
            type: 'boolean',
            description: 'Whether to create the save directory if it doesn\'t exist (default: true)',
            default: true
          }
        },
        required: ['url', 'filename']
      }
    };
  }

  /**
   * Validate arguments
   */
  private static validateArgs(args: DownloadAndSaveAsArgs): { isValid: boolean; error?: string } {
    // Validate URL
    if (!args.url || typeof args.url !== 'string') {
      return { isValid: false, error: 'url is required and must be a string' };
    }

    const urlValidation = validateUrl(args.url);
    if (!urlValidation.isValid) {
      return { isValid: false, error: `Invalid URL: ${urlValidation.error}` };
    }

    // Validate filename
    if (!args.filename || typeof args.filename !== 'string') {
      return { isValid: false, error: 'filename is required and must be a string' };
    }

    const filenameValidation = validateFilename(args.filename);
    if (!filenameValidation.isValid) {
      return { isValid: false, error: `Invalid filename: ${filenameValidation.error}` };
    }

    // Validate maxSizeBytes
    if (args.maxSizeBytes !== undefined) {
      if (!Number.isInteger(args.maxSizeBytes) || args.maxSizeBytes < 1 || args.maxSizeBytes > 1073741824) {
        return { isValid: false, error: 'maxSizeBytes must be an integer between 1 and 1073741824 (1GB)' };
      }
    }

    // Validate timeout
    if (args.timeout !== undefined) {
      if (!Number.isInteger(args.timeout) || args.timeout < 1000 || args.timeout > 300000) {
        return { isValid: false, error: 'timeout must be an integer between 1000 and 300000 milliseconds' };
      }
    }

    // Validate saveDirectory
    if (args.saveDirectory !== undefined) {
      if (typeof args.saveDirectory !== 'string' || !args.saveDirectory.trim()) {
        return { isValid: false, error: 'saveDirectory must be a non-empty string' };
      }
    }

    return { isValid: true };
  }
}