/**
 * Configuration Utility Functions
 * VSCode MCP Client configuration adapter utility functions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  FileExistsResult, 
  FileReadableResult, 
  FileStatsResult, 
  FileContentResult,
  PlatformInfo,
  SupportedPlatform 
} from './types';

// ==================== File System Utility Functions ====================

/**
 * Check if a file exists
 */
export async function checkFileExists(filePath: string): Promise<FileExistsResult> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return { exists: true };
  } catch (error) {
    return { 
      exists: false, 
      error: error instanceof Error ? error.message : 'File does not exist' 
    };
  }
}

/**
 * Check if a file is readable
 */
export async function checkFileReadable(filePath: string): Promise<FileReadableResult> {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return { readable: true };
  } catch (error) {
    return { 
      readable: false, 
      error: error instanceof Error ? error.message : 'File is not readable'
    };
  }
}

/**
 * Get file statistics
 */
export async function getFileStats(filePath: string): Promise<FileStatsResult> {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      success: true,
      stats: {
        size: stats.size,
        lastModified: stats.mtime.getTime()
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get file statistics'
    };
  }
}

/**
 * Read file content
 */
export async function readFileContent(filePath: string): Promise<FileContentResult> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return {
      success: true,
      content
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read file content'
    };
  }
}

/**
 * Expand environment variables and user directory in paths
 */
export async function expandPath(inputPath: string): Promise<string> {
  let expandedPath = inputPath;

  // Handle ~ user directory
  if (expandedPath.startsWith('~/')) {
    expandedPath = path.join(os.homedir(), expandedPath.slice(2));
  }

  // Handle Windows environment variables
  if (process.platform === 'win32') {
    // Replace %APPDATA%
    if (expandedPath.includes('%APPDATA%')) {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      expandedPath = expandedPath.replace(/%APPDATA%/g, appData);
    }

    // Replace %PROGRAMDATA%
    if (expandedPath.includes('%PROGRAMDATA%')) {
      const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
      expandedPath = expandedPath.replace(/%PROGRAMDATA%/g, programData);
    }

    // Replace %VSCODE_APPDATA%
    if (expandedPath.includes('%VSCODE_APPDATA%')) {
      const vscodeAppData = process.env.VSCODE_APPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      expandedPath = expandedPath.replace(/%VSCODE_APPDATA%/g, vscodeAppData);
    }
  }

  // Handle other environment variables
  expandedPath = expandedPath.replace(/\$\{([^}]+)\}/g, (match, envVar) => {
    return process.env[envVar] || match;
  });

  // Handle POSIX-style environment variables
  expandedPath = expandedPath.replace(/\$([A-Z_][A-Z0-9_]*)/g, (match, envVar) => {
    return process.env[envVar] || match;
  });

  return path.resolve(expandedPath);
}

// ==================== Platform Detection Functions ====================

/**
 * Get the current platform
 */
export function getCurrentPlatform(): SupportedPlatform {
  switch (process.platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return 'Linux'; // Default to Linux
  }
}

/**
 * Check if a platform is supported
 */
export function isPlatformSupported(platform?: SupportedPlatform): boolean {
  const currentPlatform = platform || getCurrentPlatform();
  // Currently supports macOS and Windows, Linux reserved for future
  return currentPlatform === 'macOS' || currentPlatform === 'Windows';
}

/**
 * Get VSCode configuration paths
 */
export function getVSCodeConfigPaths(platform?: SupportedPlatform): string[] {
  const currentPlatform = platform || getCurrentPlatform();
  
  switch (currentPlatform) {
    case 'Windows':
      return [
        '%APPDATA%\\Code\\User\\mcp.json',
        '%APPDATA%\\Code - Insiders\\User\\mcp.json',
        '%APPDATA%\\Code - OSS\\User\\mcp.json',
        '.\\data\\user-data\\User\\mcp.json',
        '%VSCODE_APPDATA%\\User\\mcp.json',
        '%PROGRAMDATA%\\Code\\User\\mcp.json'
      ];
    case 'macOS':
      return [
        '~/Library/Application Support/Code/User/mcp.json',
        '~/Library/Application Support/Code/User/settings.json',
        '~/Library/Application Support/Code - Insiders/User/mcp.json',
        '~/Library/Application Support/Code - Insiders/User/settings.json',
        '~/Library/Application Support/Code - OSS/User/mcp.json',
        '~/Library/Application Support/Code - OSS/User/settings.json',
        '/usr/local/var/vscode/User/mcp.json',
        '/usr/local/var/vscode/User/settings.json'
      ];
    case 'Linux':
      return [
        '~/.config/Code/User/settings.json',
        '~/.config/Code - Insiders/User/settings.json',
        '~/.config/Code - OSS/User/settings.json'
      ];
    default:
      return [];
  }
}

/**
 * Get platform information
 */
export function getPlatformInfo(platform?: SupportedPlatform): PlatformInfo {
  const currentPlatform = platform || getCurrentPlatform();
  const configPaths = getVSCodeConfigPaths(currentPlatform);
  
  return {
    platform: currentPlatform,
    isSupported: isPlatformSupported(currentPlatform),
    vscodeConfigPath: configPaths[0] || '',
    vscodeConfigPaths: configPaths,
    displayName: getPlatformDisplayName(currentPlatform)
  };
}

/**
 * Get platform display name
 */
export function getPlatformDisplayName(platform: SupportedPlatform): string {
  switch (platform) {
    case 'macOS':
      return 'macOS';
    case 'Windows':
      return 'Windows';
    case 'Linux':
      return 'Linux';
    default:
      return platform;
  }
}

// ==================== Configuration Format Detection ====================

/**
 * Detect configuration file format
 */
export function detectConfigFormat(filePath: string, content?: string): 'settings.json' | 'mcp.json' | 'unknown' {
  const fileName = path.basename(filePath).toLowerCase();
  
  if (fileName.includes('settings.json')) {
    return 'settings.json';
  }
  
  if (fileName.includes('mcp.json')) {
    return 'mcp.json';
  }
  
  // If content is available, try to infer from content structure
  if (content) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.mcp?.servers) {
        return 'settings.json';
      }
      if (parsed.servers) {
        return 'mcp.json';
      }
    } catch {
      // Ignore JSON parsing errors
    }
  }
  
  return 'unknown';
}

/**
 * Validate JSON format
 */
export function validateJsonFormat(content: string): { isValid: boolean; error?: string } {
  try {
    JSON.parse(content);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'JSON format error'
    };
  }
}

// ==================== Path Utility Functions ====================

/**
 * Normalize path
 */
export function normalizePath(inputPath: string): string {
  return path.normalize(inputPath);
}

/**
 * Check if a path is absolute
 */
export function isAbsolutePath(inputPath: string): boolean {
  return path.isAbsolute(inputPath);
}

/**
 * Get relative path
 */
export function getRelativePath(from: string, to: string): string {
  return path.relative(from, to);
}

/**
 * Ensure directory exists
 */
export async function ensureDirectoryExists(dirPath: string): Promise<boolean> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true });
    return true;
  } catch (error) {
    return false;
  }
}

// ==================== Cache Utility Functions ====================

/**
 * Generate cache key
 */
export function generateCacheKey(...parts: string[]): string {
  return parts.join(':');
}

/**
 * Check if cache has expired
 */
export function isCacheExpired(timestamp: number, ttl: number): boolean {
  return Date.now() - timestamp > ttl;
}

// ==================== Debug Utility Functions ====================

/**
 * Safe JSON stringify
 */
export function safeJsonStringify(obj: any, indent?: number): string {
  try {
    return JSON.stringify(obj, null, indent);
  } catch (error) {
    return `[JSON serialization error: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T = any>(str: string): { success: boolean; data?: T; error?: string } {
  try {
    const data = JSON.parse(str);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'JSON parse error'
    };
  }
}

/**
 * Delayed execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create timeout Promise
 */
export function createTimeoutPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out: ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}