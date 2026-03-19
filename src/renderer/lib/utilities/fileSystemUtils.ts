/**
 * File System Utilities for VSCode MCP Configuration Import
 * Provides cross-platform file system operations through Electron's IPC
 */

export interface FileExistsResult {
  exists: boolean
  error?: string
}

export interface FileReadResult {
  success: boolean
  content?: string
  error?: string
  size?: number
  lastModified?: number
}

export interface FileAccessResult {
  readable: boolean
  writable: boolean
  error?: string
}

export interface FileStats {
  size: number
  isFile: boolean
  isDirectory: boolean
  lastModified: number
  lastAccessed: number
  created: number
}

export interface FileStatsResult {
  success: boolean
  stats?: FileStats
  error?: string
}

/**
 * Check if a file exists
 * Uses Electron's IPC to safely access file system from renderer process
 */
export async function checkFileExists(filePath: string): Promise<FileExistsResult> {
  try {
    // Use Electron's IPC to check file existence
    if (window.electronAPI?.fs?.exists) {
      const exists = await window.electronAPI.fs.exists(filePath)
      return { exists }
    }
    
    // Fallback: if no IPC available, assume file doesn't exist
    return { exists: false, error: 'File system access not available' }
  } catch (error) {
    return {
      exists: false,
      error: `Error checking file existence: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Check if a file is readable
 */
export async function checkFileReadable(filePath: string): Promise<FileAccessResult> {
  try {
    // First check if file exists
    const existsResult = await checkFileExists(filePath)
    if (!existsResult.exists) {
      return {
        readable: false,
        writable: false,
        error: existsResult.error || 'File does not exist'
      }
    }

    // Use Electron's IPC to check file permissions
    if (window.electronAPI?.fs?.access) {
      const accessResult = await window.electronAPI.fs.access(filePath)
      return {
        readable: accessResult.readable,
        writable: accessResult.writable
      }
    }

    // Fallback: assume readable if exists
    return {
      readable: true,
      writable: false,
      error: 'Permission check not available, assuming readable'
    }
  } catch (error) {
    return {
      readable: false,
      writable: false,
      error: `Error checking file access: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Read file content
 * Handles text files only, with encoding support
 */
export async function readFileContent(
  filePath: string,
  encoding: BufferEncoding = 'utf8'
): Promise<FileReadResult> {
  try {
    // First check if file is readable
    const accessResult = await checkFileReadable(filePath)
    if (!accessResult.readable) {
      return {
        success: false,
        error: accessResult.error || 'File is not readable'
      }
    }

    // Use Electron's IPC to read file content
    if (window.electronAPI?.fs?.readFile) {
      const result = await window.electronAPI.fs.readFile(filePath, encoding)
      
      if (result.success) {
        return {
          success: true,
          content: result.content,
          size: result.size,
          lastModified: result.lastModified
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to read file'
        }
      }
    }

    return {
      success: false,
      error: 'File system API not available'
    }
  } catch (error) {
    return {
      success: false,
      error: `Error reading file: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Get file statistics
 */
export async function getFileStats(filePath: string): Promise<FileStatsResult> {
  try {
    // Use Electron's IPC to get file stats
    if (window.electronAPI?.fs?.stat) {
      const result = await window.electronAPI.fs.stat(filePath)
      
      if (result.success && result.stats) {
        return {
          success: true,
          stats: {
            size: result.stats.size,
            isFile: result.stats.isFile,
            isDirectory: result.stats.isDirectory,
            lastModified: result.stats.mtime,
            lastAccessed: result.stats.atime,
            created: result.stats.birthtime
          }
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to get file stats'
        }
      }
    }

    return {
      success: false,
      error: 'File system API not available'
    }
  } catch (error) {
    return {
      success: false,
      error: `Error getting file stats: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Expand environment variables in file paths
 * Uses Electron's IPC to safely expand paths in main process
 */
export async function expandPath(path: string): Promise<string> {
  try {
    if (window.electronAPI?.fs?.expandPath) {
      return await window.electronAPI.fs.expandPath(path)
    }
    
    // Fallback: return original path
    return path
  } catch (error) {
    return path
  }
}

/**
 * Validate file path format
 */
export function isValidFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false
  }

  // Basic path validation
  const trimmedPath = filePath.trim()
  if (trimmedPath.length === 0) {
    return false
  }

  // Check for invalid characters (basic check)
  const invalidChars = /[<>:"|?*\x00-\x1f]/
  if (invalidChars.test(trimmedPath)) {
    return false
  }

  return true
}

/**
 * Normalize file path for the current platform
 */
export function normalizePath(filePath: string): string {
  if (!filePath) return ''
  
  // Replace backslashes with forward slashes for consistency
  let normalized = filePath.replace(/\\/g, '/')
  
  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, '/')
  
  // Trim leading/trailing whitespace
  normalized = normalized.trim()
  
  return normalized
}

/**
 * Extract file extension from path
 */
export function getFileExtension(filePath: string): string {
  if (!filePath) return ''
  
  const normalized = normalizePath(filePath)
  const lastDot = normalized.lastIndexOf('.')
  const lastSlash = normalized.lastIndexOf('/')
  
  // If dot is before the last slash, or there's no dot, return empty string
  if (lastDot === -1 || lastDot < lastSlash) {
    return ''
  }
  
  return normalized.substring(lastDot + 1).toLowerCase()
}

/**
 * Check if file has a specific extension
 */
export function hasFileExtension(filePath: string, extensions: string[]): boolean {
  const fileExt = getFileExtension(filePath)
  return extensions.some(ext => ext.toLowerCase() === fileExt)
}

/**
 * Get filename from path
 */
export function getFileName(filePath: string): string {
  if (!filePath) return ''
  
  const normalized = normalizePath(filePath)
  const lastSlash = normalized.lastIndexOf('/')
  
  if (lastSlash === -1) {
    return normalized
  }
  
  return normalized.substring(lastSlash + 1)
}

/**
 * Get directory from path
 */
export function getDirectory(filePath: string): string {
  if (!filePath) return ''
  
  const normalized = normalizePath(filePath)
  const lastSlash = normalized.lastIndexOf('/')
  
  if (lastSlash === -1) {
    return ''
  }
  
  return normalized.substring(0, lastSlash)
}

/**
 * Format file size in human readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = bytes / Math.pow(1024, unitIndex)
  
  return `${size.toFixed(1)} ${units[unitIndex]}`
}

/**
 * Format timestamp to human readable string
 */
export function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString()
  } catch (error) {
    return 'Invalid date'
  }
}

/**
 * Batch file operations for multiple files
 */
export interface BatchFileCheckResult {
  filePath: string
  exists: boolean
  readable: boolean
  size?: number
  error?: string
}

/**
 * Check multiple files in batch
 */
export async function batchCheckFiles(filePaths: string[]): Promise<BatchFileCheckResult[]> {
  const results: BatchFileCheckResult[] = []
  
  for (const filePath of filePaths) {
    try {
      const existsResult = await checkFileExists(filePath)
      const accessResult = await checkFileReadable(filePath)
      
      let size: number | undefined
      if (existsResult.exists && accessResult.readable) {
        const statsResult = await getFileStats(filePath)
        if (statsResult.success) {
          size = statsResult.stats?.size
        }
      }
      
      results.push({
        filePath,
        exists: existsResult.exists,
        readable: accessResult.readable,
        size,
        error: existsResult.error || accessResult.error
      })
    } catch (error) {
      results.push({
        filePath,
        exists: false,
        readable: false,
        error: `Batch check error: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  
  return results
}

/**
 * Common file validation patterns for VSCode configs
 */
export const FILE_VALIDATION = {
  VSCODE_SETTINGS: {
    extensions: ['json'],
    maxSize: 10 * 1024 * 1024, // 10MB
    requiredContent: ['settings', 'mcp']
  },
  MCP_JSON: {
    extensions: ['json'],
    maxSize: 5 * 1024 * 1024, // 5MB
    requiredContent: ['servers']
  }
} as const