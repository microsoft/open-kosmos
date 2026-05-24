/**
 * File Security Validator — prevents path traversal attacks and dangerous file access.
 * Migrated from src/renderer/lib/utilities/fileUtils.ts to the main process.
 */

import * as path from 'path';
import { app } from 'electron';
import { CommandParser } from './commandParser';
import { createLogger } from '../unifiedLogger';

export class FileSecurityValidator {
  static validatePath(filePath: string, allowAbsolutePaths: boolean = false): { isValid: boolean; error?: string } {
    // 1. Check for path traversal attacks
    if (this.isPathTraversalAttack(filePath)) {
      return { isValid: false, error: 'potential directory traversal attack' };
    }

    // 2. Check for absolute paths (exception added for file attachment functionality)
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
      '/etc/',   // Direct access to system directories
      '~/',      // User home directory
      '$HOME',   // Environment variable
      '%USERPROFILE%' // Windows user directory variable
    ];

    // Check for relative path traversal attack patterns
    for (const pattern of patterns) {
      if (path.includes(pattern)) {
        return true;
      }
    }

    // Special check: a Windows absolute path should not contain relative path components
    if (/^[A-Za-z]:[\\\/]/.test(path)) {
      // Check for relative path traversal within a Windows absolute path
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

  /**
   * Check whether a path is within the specified workspace directory.
   * 🔥 Added: whitelist support that automatically passes specific paths (e.g., the skills directory).
   * @param filePath The file path to check
   * @param workspacePath The absolute path of the workspace directory
   * @returns { isInWorkspace: boolean; normalizedPath?: string; error?: string }
   */
  static isPathInWorkspace(filePath: string, workspacePath: string): {
    isInWorkspace: boolean;
    normalizedPath?: string;
    error?: string
  } {
    if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
      return {
        isInWorkspace: false,
        error: 'workspace path is not configured'
      };
    }

    if (!filePath || typeof filePath !== 'string' || filePath.trim().length === 0) {
      return {
        isInWorkspace: false,
        error: 'file path is empty'
      };
    }

    try {
      // 🔥 Fix: relative paths should be resolved relative to the workspace, not the current working directory
      let normalizedFilePath: string;
      if (this.isAbsolutePath(filePath)) {
        normalizedFilePath = path.resolve(filePath);
      } else {
        // Relative path: resolve relative to workspace
        normalizedFilePath = path.resolve(workspacePath, filePath);
      }
      const normalizedWorkspace = path.resolve(workspacePath);

      // 🔥 Added: check the whitelist
      if (this.isPathInWhitelist(normalizedFilePath)) {
        return {
          isInWorkspace: true,
          normalizedPath: normalizedFilePath
        };
      }

      // Check whether the file path starts with the workspace path
      const relativePath = path.relative(normalizedWorkspace, normalizedFilePath);

      // If the relative path starts with .., the file is outside the workspace
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return {
          isInWorkspace: false,
          normalizedPath: normalizedFilePath,
          error: 'path is outside workspace'
        };
      }

      return {
        isInWorkspace: true,
        normalizedPath: normalizedFilePath
      };
    } catch (error) {
      return {
        isInWorkspace: false,
        error: `path validation error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * 🔥 Added: Check whether a path is in the whitelist.
   * Whitelist includes:
   * 1. ${appPath}/profiles/${userAlias}/skills/ — Skills directory
   *
   * @param normalizedFilePath The normalized file path to check
   * @returns Whether the path is in the whitelist
   */
  private static isPathInWhitelist(normalizedFilePath: string): boolean {
    try {
      // Get the Electron app instance
      const electronApp = this.getElectronApp();
      if (!electronApp) {
        return false;
      }

      // Get the appPath (userData path)
      const appPath = electronApp.getPath('userData');

      // Build the base path for the skills directory: ${appPath}/profiles/
      const profilesBasePath = path.join(appPath, 'profiles');

      // Check whether the path is under the profiles directory
      const relativeToProfiles = path.relative(profilesBasePath, normalizedFilePath);

      // If the path is not under the profiles directory, return false
      if (relativeToProfiles.startsWith('..') || path.isAbsolute(relativeToProfiles)) {
        return false;
      }

      // Check whether the path matches the pattern: profiles/${userAlias}/skills/
      // Path format: ${userAlias}/skills/...
      const pathParts = relativeToProfiles.split(path.sep);

      // At least 3 parts required: userAlias / skills / ...
      if (pathParts.length >= 2) {
        // Check whether the second part is 'skills'
        if (pathParts[1] === 'skills') {
          return true;
        }
      }

      return false;
    } catch (error) {
      // On error, return false (not in whitelist)
      return false;
    }
  }

  /**
   * 🔥 Added: Helper method to get the Electron app instance.
   * Supports mocking in test environments.
   */
  private static getElectronApp(): any {
    try {
      // Check for a global mock in the test environment
      if ((global as any).electron?.app) {
        return (global as any).electron.app;
      }

      return app;
    } catch (error) {
      // If Electron cannot be imported (e.g., in a test environment), return null
      return null;
    }
  }

  /**
   * Extract all paths from the tool arguments.
   * Uses smart path extraction logic with different strategies for different argument types.
   *
   * @param toolArgs - Tool argument object
   * @returns Array of extracted paths (relative paths are combined with cwd to form absolute paths)
   */
  static extractPathsFromToolArgs(toolArgs: any): string[] {
    const logger = createLogger();

    logger.info('[FileSecurityValidator] 🔍 Starting path extraction from tool args', 'extractPathsFromToolArgs', {
      toolArgsKeys: Object.keys(toolArgs || {}),
      toolArgsPreview: JSON.stringify(toolArgs).substring(0, 200)
    });

    const pathsToValidate: string[] = [];
    let basePath: string | undefined;

    // Step 1: Find the base path parameter (cwd, workspaceRoot, etc.)
    const findBasePath = (obj: any, depth: number = 0): string | undefined => {
      if (depth > 10) return undefined;

      if (obj && typeof obj === 'object') {
        // Priority: workspaceRoot > cwd > workingDirectory
        if (typeof obj.workspaceRoot === 'string') return obj.workspaceRoot;
        if (typeof obj.workspace_root === 'string') return obj.workspace_root;
        if (typeof obj.cwd === 'string') return obj.cwd;
        if (typeof obj.workingDirectory === 'string') return obj.workingDirectory;
        if (typeof obj.working_directory === 'string') return obj.working_directory;

        for (const value of Object.values(obj)) {
          const found = findBasePath(value, depth + 1);
          if (found) return found;
        }
      }
      return undefined;
    };

    basePath = findBasePath(toolArgs);

    if (basePath) {
      logger.info('[FileSecurityValidator] 📂 Found base path', 'extractPathsFromToolArgs', {
        basePath
      });
    }

    // Check whether a string is a URL
    const isUrl = (str: string): boolean => {
      try {
        // Check common URL protocols
        if (/^(https?|ftp|file|ssh|git|ws|wss):\/\//i.test(str)) {
          return true;
        }
        // Check incomplete URLs (e.g., s://... — truncated protocol)
        if (/^[a-z]s?:\/\//i.test(str)) {
          return true;
        }
        // Further validate using the URL constructor
        new URL(str);
        return true;
      } catch {
        return false;
      }
    };

    // Step 2: Extract paths
    const extractPaths = (obj: any, key: string = '', depth: number = 0) => {
      if (depth > 10) return; // Prevent infinite recursion

      if (typeof obj === 'string') {
        // Skip URLs
        if (isUrl(obj)) {
          return;
        }
        // Handle base path parameters (these paths are also validated)
        if (key === 'cwd' || key === 'workingDirectory' || key === 'working_directory' ||
            key === 'workspaceRoot' || key === 'workspace_root') {
          pathsToValidate.push(obj);
          return;
        }

        // Handle command parameters — use the command parser for full parsing
        if (key === 'command' || key === 'cmd') {
          logger.info('[FileSecurityValidator] 🔍 Parsing command for paths', 'extractPathsFromToolArgs', {
            commandPreview: obj.substring(0, 100),
            commandLength: obj.length
          });

          const extractedPaths = CommandParser.extractPathsFromCommand(obj);

          logger.info('[FileSecurityValidator] 📊 Extracted paths from command', 'extractPathsFromToolArgs', {
            extractedPathsCount: extractedPaths.length,
            extractedPaths: extractedPaths,
            basePath: basePath
          });

          // Combine relative paths with the base path
          for (const extractedPath of extractedPaths) {
            if (basePath && !this.isAbsolutePath(extractedPath)) {
              // Relative path: combine with base path
              const combinedPath = path.join(basePath, extractedPath);
              pathsToValidate.push(combinedPath);
              logger.debug('[FileSecurityValidator] Combined relative path with base', 'extractPathsFromToolArgs', {
                relativePath: extractedPath,
                basePath,
                result: combinedPath
              });
            } else {
              // Absolute path: use directly
              pathsToValidate.push(extractedPath);
              logger.debug('[FileSecurityValidator] Added absolute path', 'extractPathsFromToolArgs', {
                absolutePath: extractedPath
              });
            }
          }
          return;
        }

        // Explicit path parameters
        // 🔥 Fix: exclude file type, file name, and other non-path parameters
        const isNonPathParam = key === 'fileType' || key === 'file_type' ||
                               key === 'type' || key === 'extension' || key === 'ext' ||
                               key === 'fileName' || key === 'file_name';

        // 🔥 Only process explicit path parameters using a whitelist approach rather than a blacklist
        const isPathParam = key === 'path' || key === 'filePath' || key === 'file_path' ||
                           key === 'directory' || key === 'dir' || key === 'dirPath' || key === 'dir_path' ||
                           key.endsWith('Path') || key.endsWith('_path') || key.endsWith('Directory') || key.endsWith('_directory');

        if (!isNonPathParam && isPathParam) {
          // 🔥 Fix: check whether the value looks like a file extension or a plain file name (no path separator)
          const looksLikeExtensionOrName = /^[a-z0-9_.-]+$/i.test(obj) && obj.length <= 50 && !obj.includes('/') && !obj.includes('\\');
          if (looksLikeExtensionOrName && !this.isAbsolutePath(obj)) {
            // Looks like an extension or plain file name — skip
            return;
          }

          // Combine relative paths with the base path
          if (basePath && !this.isAbsolutePath(obj)) {
            pathsToValidate.push(path.join(basePath, obj));
          } else {
            pathsToValidate.push(obj);
          }
          return;
        }

        // Other string parameters — use conservative heuristics
        // 🔥 Fix: only extract strings that look like real paths

        // Windows absolute path (excluding URLs)
        if (/^[A-Za-z]:[\\\/]/.test(obj) && !isUrl(obj)) {
          pathsToValidate.push(obj);
        }
        // Unix absolute path (must contain at least one path separator; exclude command-line switches, plain file names, and URLs)
        else if (obj.startsWith('/') && obj.includes('/') && obj.length > 2 && !isUrl(obj)) {
          // Extra check: ensure it is not a plain file name (e.g., "/filename.ext")
          // A real absolute path should have multiple path components
          const pathComponents = obj.split('/').filter(c => c.length > 0);
          if (pathComponents.length >= 2) {
            pathsToValidate.push(obj);
          }
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => extractPaths(item, `${key}[${index}]`, depth + 1));
      } else if (obj && typeof obj === 'object') {
        Object.entries(obj).forEach(([k, v]) => extractPaths(v, k, depth + 1));
      }
    };

    extractPaths(toolArgs);

    logger.info('[FileSecurityValidator] ✅ Path extraction completed', 'extractPathsFromToolArgs', {
      totalPathsFound: pathsToValidate.length,
      paths: pathsToValidate
    });

    return pathsToValidate;
  }

  /**
   * Validate whether all paths in the tool arguments are within the workspace.
   *
   * @param toolArgs - Tool argument object
   * @param workspacePath - Workspace path
   * @returns Validation result, including the list of paths outside the workspace
   */
  static validateToolPathsInWorkspace(
    toolArgs: any,
    workspacePath: string | undefined
  ): {
    allPathsValid: boolean;
    pathsOutsideWorkspace: Array<{
      path: string;
      normalizedPath?: string;
      error?: string;
    }>;
  } {
    // If no workspace is configured, allow execution (skip path validation)
    if (!workspacePath || typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
      return {
        allPathsValid: true,
        pathsOutsideWorkspace: []
      };
    }

    // Extract all paths
    const pathsToValidate = this.extractPathsFromToolArgs(toolArgs);

    if (pathsToValidate.length === 0) {
      return {
        allPathsValid: true,
        pathsOutsideWorkspace: []
      };
    }

    // Validate each path
    const pathsOutsideWorkspace: Array<{
      path: string;
      normalizedPath?: string;
      error?: string;
    }> = [];

    const logger = createLogger();

    logger.info('[FileSecurityValidator] 🔐 Starting workspace validation', 'validateToolPathsInWorkspace', {
      workspacePath,
      pathsToValidateCount: pathsToValidate.length,
      pathsToValidate
    });

    for (const filePath of pathsToValidate) {
      const validation = this.isPathInWorkspace(filePath, workspacePath);

      logger.info('[FileSecurityValidator] Validation result for path', 'validateToolPathsInWorkspace', {
        filePath,
        isInWorkspace: validation.isInWorkspace,
        normalizedPath: validation.normalizedPath,
        error: validation.error
      });

      if (!validation.isInWorkspace) {
        pathsOutsideWorkspace.push({
          path: filePath,
          normalizedPath: validation.normalizedPath,
          error: validation.error
        });
      }
    }

    const result = {
      allPathsValid: pathsOutsideWorkspace.length === 0,
      pathsOutsideWorkspace
    };

    logger.info('[FileSecurityValidator] ✅ Workspace validation completed', 'validateToolPathsInWorkspace', {
      allPathsValid: result.allPathsValid,
      pathsOutsideWorkspaceCount: result.pathsOutsideWorkspace.length,
      pathsOutsideWorkspace: result.pathsOutsideWorkspace
    });

    return result;
  }
}
