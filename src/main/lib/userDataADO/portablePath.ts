/**
 * Portable Path Utilities
 * 
 * Converts paths from other operating systems to the local OS format.
 * This enables profile.json to be synced across machines with different OSes.
 * 
 * Detection patterns:
 * - Windows: C:\Users\...\AppData\Roaming\openkosmos-app\profiles\{alias}\...
 * - macOS:   /Users/.../Library/Application Support/openkosmos-app/profiles/{alias}/...
 * - Linux:   /home/.../.config/openkosmos-app/profiles/{alias}/...
 * 
 * The key insight: we extract the profile-relative path and reconstruct it
 * using the local profile directory.
 */

import * as path from 'path';
import { getProfileDirectoryPath } from './pathUtils';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

/**
 * Check if a path appears to be from a different OS than the current one.
 * Returns the detected OS or null if it matches current OS or is unrecognized.
 */
function detectForeignOS(pathStr: string): 'windows' | 'unix' | null {
  if (!pathStr || typeof pathStr !== 'string') {
    return null;
  }

  const currentOS = process.platform;
  
  // Check for Windows path (has drive letter like C:\)
  const isWindowsPath = /^[A-Za-z]:[\\\/]/.test(pathStr);
  
  // Check for Unix path (starts with /)
  const isUnixPath = pathStr.startsWith('/');
  
  if (isWindowsPath && currentOS !== 'win32') {
    return 'windows';
  }
  
  if (isUnixPath && currentOS === 'win32') {
    return 'unix';
  }
  
  logger.info(`[PortablePath] Path "${pathStr}" does not appear to be from a foreign OS.`);
  return null;
}

/**
 * Extract the profile-relative path from an absolute path.
 * Returns the relative path after profiles/{alias}/ or null if not a profile path.
 */
function extractProfileRelativePath(pathStr: string): { alias: string; relativePath: string } | null {
  if (!pathStr || typeof pathStr !== 'string') {
    return null;
  }

  // Normalize slashes for matching
  const normalizedPath = pathStr.replace(/\\/g, '/');
  
  // Match pattern: .../profiles/{alias}/{relativePath}
  const match = normalizedPath.match(/\/profiles\/([^\/]+)\/(.+)$/);
  if (match) {
    return {
      alias: match[1],
      relativePath: match[2],
    };
  }
  
  logger.warn(`[PortablePath] Path "${pathStr}" does not match expected profile path pattern.`);
  return null;
}

/**
 * Convert a path from another OS to the local OS format.
 * If the path is from the current OS or not a profile path, returns it unchanged.
 * 
 * @param pathStr - The path to convert
 * @param expectedAlias - The expected profile alias (for validation)
 * @returns The converted path for the local OS
 */
export function convertToLocalPath(pathStr: string, expectedAlias: string): string {
  if (!pathStr || typeof pathStr !== 'string') {
    return pathStr;
  }

  // Check if this is a foreign OS path
  const foreignOS = detectForeignOS(pathStr);
  if (!foreignOS) {
    // Path is from current OS, return as-is
    return pathStr;
  }

  // Extract the profile-relative portion
  const extracted = extractProfileRelativePath(pathStr);
  if (!extracted) {
    // Not a profile path, return as-is
    logger.warn(`[PortablePath] Path "${pathStr}" is from a foreign OS (${foreignOS}) but does not match profile path pattern. Returning unchanged.`);
    return pathStr;
  }

  // Validate alias if expectedAlias is provided
  if (expectedAlias && extracted.alias !== expectedAlias) {
    // Alias mismatch, return as-is to avoid incorrect conversion
    logger.warn(`[PortablePath] Path "${pathStr}" is from a foreign OS (${foreignOS}) but alias "${extracted.alias}" does not match expected alias "${expectedAlias}". Returning unchanged.`);
    return pathStr;
  }

  // Use expected alias for reconstruction
  const alias = expectedAlias;
  
  // Reconstruct with local profile directory
  const localProfileDir = getProfileDirectoryPath(alias);
  
  // Convert forward slashes to local path separators
  const localRelativePath = extracted.relativePath.split('/').join(path.sep);
  
  return path.join(localProfileDir, localRelativePath);
}

/**
 * Check if a path needs conversion (is from a foreign OS and is a profile path)
 */
export function needsPathConversion(pathStr: string): boolean {
  if (!pathStr || typeof pathStr !== 'string') {
    return false;
  }
  
  const foreignOS = detectForeignOS(pathStr);
  if (!foreignOS) {
    return false;
  }
  
  const extracted = extractProfileRelativePath(pathStr);
  return extracted !== null;
}
