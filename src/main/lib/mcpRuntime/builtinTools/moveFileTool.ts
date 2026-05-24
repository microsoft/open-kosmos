/**
 * MoveFileTool built-in tool
 * Move or copy a file from one location to another
 *
 * Common use cases:
 * - Move screenshots from Chrome's download directory to the workspace directory
 * - Organize temporary files produced by tools
 */

import * as fs from 'fs';
import * as path from 'path';
import { BuiltinToolDefinition } from './types';

export interface MoveFileArgs {
  /** Full path to the source file */
  sourcePath: string;
  /** Full path or directory of the destination file */
  destinationPath: string;
  /** Whether to copy instead of move (default false = move) */
  copy?: boolean;
  /** Whether to overwrite if the destination file already exists (default false) */
  overwrite?: boolean;
}

export interface MoveFileResult {
  success: boolean;
  /** Operation type */
  operation: 'move' | 'copy';
  /** Source file path */
  sourcePath: string;
  /** Final destination file path */
  destinationPath: string;
  /** File size (bytes) */
  fileSize?: number;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Validate a file path
 */
function validatePath(filePath: string, type: 'source' | 'destination'): { isValid: boolean; error?: string } {
  if (!filePath || typeof filePath !== 'string') {
    return { isValid: false, error: `${type}Path is required and must be a string` };
  }

  // Check whether the path is absolute
  if (!path.isAbsolute(filePath)) {
    return { isValid: false, error: `${type}Path must be an absolute path: ${filePath}` };
  }

  return { isValid: true };
}

/**
 * Ensure a directory exists, creating it if it does not
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export class MoveFileTool {

  /**
   * Execute the file move or copy operation
   */
  static async execute(args: MoveFileArgs, options?: { signal?: AbortSignal }): Promise<MoveFileResult> {
    const { sourcePath, destinationPath, copy = false, overwrite = false } = args;

    // 1. Validate source path
    const sourceValidation = validatePath(sourcePath, 'source');
    if (!sourceValidation.isValid) {
      throw new Error(sourceValidation.error);
    }

    // 2. Validate destination path
    const destValidation = validatePath(destinationPath, 'destination');
    if (!destValidation.isValid) {
      throw new Error(destValidation.error);
    }

    // 3. Check whether the source file exists
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    // 4. Get source file info
    const sourceStats = fs.statSync(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error(`Source path is not a file: ${sourcePath}`);
    }

    // 5. Determine the final destination path
    let finalDestPath = destinationPath;

    // If the destination is an existing directory, use the source filename inside that directory
    if (fs.existsSync(destinationPath) && fs.statSync(destinationPath).isDirectory()) {
      const sourceFileName = path.basename(sourcePath);
      finalDestPath = path.join(destinationPath, sourceFileName);
    }

    // If the destination has no extension but the source does, it may be intended as a directory
    const destExt = path.extname(finalDestPath);
    const sourceExt = path.extname(sourcePath);
    if (!destExt && sourceExt) {
      // Check if the destination looks like a directory path
      const destBasename = path.basename(finalDestPath);
      if (!destBasename.includes('.')) {
        // Destination may be a directory; ensure it exists and use the source filename
        ensureDirectoryExists(finalDestPath);
        finalDestPath = path.join(finalDestPath, path.basename(sourcePath));
      }
    }

    // 6. Check whether the destination file already exists
    if (fs.existsSync(finalDestPath) && !overwrite) {
      throw new Error(`Destination file already exists: ${finalDestPath}. Set overwrite=true to replace it.`);
    }

    // 7. Ensure the destination directory exists
    const destDir = path.dirname(finalDestPath);
    ensureDirectoryExists(destDir);

    // 8. Execute the move or copy operation
    const operation = copy ? 'copy' : 'move';

    try {
      if (copy) {
        // Copy file
        fs.copyFileSync(sourcePath, finalDestPath);
      } else {
        // Move file
        // Try rename first (faster on the same filesystem)
        try {
          fs.renameSync(sourcePath, finalDestPath);
        } catch (renameError: any) {
          // If rename fails (possibly cross-filesystem), fall back to copy + delete
          if (renameError.code === 'EXDEV') {
            fs.copyFileSync(sourcePath, finalDestPath);
            fs.unlinkSync(sourcePath);
          } else {
            throw renameError;
          }
        }
      }

      // Get destination file size
      const destStats = fs.statSync(finalDestPath);

      return {
        success: true,
        operation,
        sourcePath,
        destinationPath: finalDestPath,
        fileSize: destStats.size
      };
    } catch (error) {
      throw new Error(`Failed to ${operation} file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get tool definition
   */
  static getDefinition(): BuiltinToolDefinition {
    return {
      name: 'move_file',
      description: `Move or copy a file from one location to another.

COMMON USE CASES:
- Move screenshots from Chrome's download folder to your workspace
- Organize files generated by other tools (e.g., chrome_screenshot)
- Copy files to backup locations

IMPORTANT NOTES:
- Both sourcePath and destinationPath must be absolute paths
- If destinationPath is a directory, the file will be placed inside it with the original filename
- Set copy=true to copy instead of move (keeps the original file)
- Set overwrite=true to replace existing files at the destination

EXAMPLE WORKFLOW:
1. chrome_screenshot saves to: "C:\\Users\\xxx\\Downloads\\screenshot_2026-01-19.png"
2. Use move_file to move it to workspace:
   sourcePath: "C:\\Users\\xxx\\Downloads\\screenshot_2026-01-19.png"
   destinationPath: "C:\\workspace\\project\\images\\screenshot.png"`,
      inputSchema: {
        type: 'object',
        properties: {
          sourcePath: {
            type: 'string',
            description: 'The absolute path of the source file to move or copy. Example: "C:\\\\Users\\\\xxx\\\\Downloads\\\\screenshot.png"'
          },
          destinationPath: {
            type: 'string',
            description: 'The absolute path of the destination file or directory. If a directory, the original filename will be used. Example: "C:\\\\workspace\\\\project\\\\images\\\\screenshot.png" or "C:\\\\workspace\\\\project\\\\images\\\\"'
          },
          copy: {
            type: 'boolean',
            description: 'If true, copy the file instead of moving it (keeps the original). Default: false'
          },
          overwrite: {
            type: 'boolean',
            description: 'If true, overwrite the destination file if it already exists. Default: false'
          }
        },
        required: ['sourcePath', 'destinationPath']
      }
    };
  }
}
