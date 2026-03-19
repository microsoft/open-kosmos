/**
 * VSCode Configuration File Detector
 * Detects and validates VSCode MCP configuration files across platforms
 */

import { getPlatformInfo, getCurrentPlatform, getVSCodeConfigPaths } from './platformDetector'
import { checkFileExists, checkFileReadable, readFileContent, getFileStats, expandPath } from '../utilities/fileSystemUtils'

export interface VscodeConfigFile {
  path: string
  expandedPath: string
  exists: boolean
  isValid: boolean
  isReadable: boolean
  serverCount: number
  fileSize?: number
  lastModified?: number
  error?: string
  detectedFormat: 'settings.json' | 'mcp.json' | 'unknown'
}

export interface VscodeConfigDetectionResult {
  success: boolean
  platform: string
  isSupported: boolean
  configFiles: VscodeConfigFile[]
  totalServersFound: number
  error?: string
}

/**
 * Detect VSCode configuration files for the current platform
 */
export async function detectVSCodeConfigs(): Promise<VscodeConfigDetectionResult> {
  try {
    const platformInfo = getPlatformInfo()
    
    if (!platformInfo.isSupported) {
      return {
        success: false,
        platform: platformInfo.platform,
        isSupported: false,
        configFiles: [],
        totalServersFound: 0,
        error: `Platform ${platformInfo.platform} is not currently supported for VSCode import`
      }
    }

    // Get all VSCode config paths for current platform (prioritized order)
    const configPaths = getVSCodeConfigPaths()
    const configFiles: VscodeConfigFile[] = []
    let totalServersFound = 0
    
    // Scan paths in priority order until we find a valid configuration
    for (const configPath of configPaths) {
      try {
        const expandedConfigPath = await expandPath(configPath)
        const configFile = await detectSingleConfigFile(configPath, expandedConfigPath)
        
        configFiles.push(configFile)
        
        // If we found a valid config with servers, we can stop scanning
        if (configFile.exists && configFile.isValid && configFile.serverCount > 0) {
          totalServersFound += configFile.serverCount
          break
        }
      } catch (error) {
        // Continue to next path if this one fails
        continue
      }
    }
    
    return {
      success: true,
      platform: platformInfo.platform,
      isSupported: true,
      configFiles,
      totalServersFound,
    }
  } catch (error) {
    return {
      success: false,
      platform: getCurrentPlatform(),
      isSupported: false,
      configFiles: [],
      totalServersFound: 0,
      error: `Detection failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Scan paths in priority order until finding the first valid MCP configuration file
 */
export async function detectVscodeConfigFile(): Promise<string | null> {
  try {
    const platformInfo = getPlatformInfo()
    
    if (!platformInfo.isSupported) {
      return null
    }
    
    const configPaths = getVSCodeConfigPaths()
    
    for (const configPath of configPaths) {
      try {
        const expandedPath = await expandPath(configPath)
        const fileExists = await checkFileExists(expandedPath)
        
        if (fileExists.exists) {
          // Verify if file contains MCP configuration
          const configFile = await detectSingleConfigFile(configPath, expandedPath)
          if (configFile.isValid && configFile.serverCount > 0) {
            return expandedPath
          }
        }
      } catch (error) {
        // Continue to check next path
        continue
      }
    }
    
    return null
  } catch (error) {
    return null
  }
}

/**
 * Detect and validate a single configuration file
 */
export async function detectSingleConfigFile(
  originalPath: string, 
  expandedPath?: string
): Promise<VscodeConfigFile> {
  const actualPath = expandedPath || originalPath
  
  // Initialize the config file object
  const configFile: VscodeConfigFile = {
    path: originalPath,
    expandedPath: actualPath,
    exists: false,
    isValid: false,
    isReadable: false,
    serverCount: 0,
    detectedFormat: 'unknown'
  }

  try {
    // Check if file exists
    const existsResult = await checkFileExists(actualPath)
    configFile.exists = existsResult.exists
    
    if (!configFile.exists) {
      configFile.error = existsResult.error || 'File does not exist'
      return configFile
    }

    // Check if file is readable
    const accessResult = await checkFileReadable(actualPath)
    configFile.isReadable = accessResult.readable
    
    if (!configFile.isReadable) {
      configFile.error = accessResult.error || 'File is not readable'
      return configFile
    }

    // Get file stats
    const statsResult = await getFileStats(actualPath)
    if (statsResult.success && statsResult.stats) {
      configFile.fileSize = statsResult.stats.size
      configFile.lastModified = statsResult.stats.lastModified
    }

    // Read and validate file content
    const readResult = await readFileContent(actualPath)
    if (!readResult.success || !readResult.content) {
      configFile.error = readResult.error || 'Failed to read file content'
      return configFile
    }

    // Determine file format and validate content
    const validationResult = await validateConfigContent(readResult.content, actualPath)
    configFile.isValid = validationResult.isValid
    configFile.serverCount = validationResult.serverCount
    configFile.detectedFormat = validationResult.format
    
    if (!configFile.isValid) {
      configFile.error = validationResult.error
    }

    return configFile
  } catch (error) {
    configFile.error = `Detection error: ${error instanceof Error ? error.message : String(error)}`
    return configFile
  }
}

/**
 * Validate configuration file content and count servers
 */
async function validateConfigContent(content: string, filePath: string): Promise<{
  isValid: boolean
  serverCount: number
  format: 'settings.json' | 'mcp.json' | 'unknown'
  error?: string
}> {
  try {
    // Try to parse as JSON
    let parsedContent: any
    try {
      parsedContent = JSON.parse(content)
    } catch (parseError) {
      return {
        isValid: false,
        serverCount: 0,
        format: 'unknown',
        error: `Invalid JSON format: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
      }
    }

    // Determine format based on file path and content structure
    const fileName = filePath.toLowerCase()
    let format: 'settings.json' | 'mcp.json' | 'unknown' = 'unknown'
    let mcpServers: any = null

    if (fileName.includes('settings.json')) {
      format = 'settings.json'
      // Look for mcp.servers in settings.json
      mcpServers = parsedContent.mcp?.servers
    } else if (fileName.includes('mcp.json')) {
      format = 'mcp.json'
      // Look for servers in mcp.json
      mcpServers = parsedContent.servers
    } else {
      // Try to detect format from content structure
      if (parsedContent.mcp?.servers) {
        format = 'settings.json'
        mcpServers = parsedContent.mcp.servers
      } else if (parsedContent.servers) {
        format = 'mcp.json'
        mcpServers = parsedContent.servers
      }
    }

    // Count servers
    let serverCount = 0
    if (mcpServers && typeof mcpServers === 'object') {
      serverCount = Object.keys(mcpServers).length
    }

    // Validate that we found MCP servers
    if (serverCount === 0) {
      return {
        isValid: false,
        serverCount: 0,
        format,
        error: 'No MCP servers found in configuration file'
      }
    }

    // Basic validation of server configurations
    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        return {
          isValid: false,
          serverCount: 0,
          format,
          error: `Invalid server configuration for "${serverName}"`
        }
      }

      const config = serverConfig as any
      // Check if it has either command/args (stdio) or url (http/sse)
      const hasStdioConfig = config.command || config.args
      const hasHttpConfig = config.url
      
      if (!hasStdioConfig && !hasHttpConfig) {
        return {
          isValid: false,
          serverCount: 0,
          format,
          error: `Server "${serverName}" missing required configuration (command/args or url)`
        }
      }
    }

    return {
      isValid: true,
      serverCount,
      format
    }
  } catch (error) {
    return {
      isValid: false,
      serverCount: 0,
      format: 'unknown',
      error: `Validation error: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/**
 * Detect VSCode config files from custom paths
 */
export async function detectCustomConfigFile(filePath: string): Promise<VscodeConfigFile> {
  const expandedPath = await expandPath(filePath)
  return await detectSingleConfigFile(filePath, expandedPath)
}

/**
 * Get detailed platform-specific detection information
 */
export function getPlatformDetectionInfo() {
  const platformInfo = getPlatformInfo()
  
  return {
    platform: platformInfo.platform,
    isSupported: platformInfo.isSupported,
    standardConfigPath: platformInfo.vscodeConfigPath,
    detectionStrategy: getDetectionStrategy(platformInfo.platform),
    supportedFormats: getSupportedFormats(platformInfo.platform)
  }
}

/**
 * Get detection strategy for platform
 */
function getDetectionStrategy(platform: string): string {
  switch (platform) {
    case 'macOS':
      return 'Scan multiple VSCode installation paths (standard, Insiders, OSS, Homebrew) for mcp.json and settings.json files'
    case 'Windows':
      return 'Scan multiple VSCode installation paths (standard, Insiders, OSS, portable, system-level) for mcp.json files'
    case 'Linux':
      return 'Scan multiple VSCode installation paths for settings.json files (future support)'
    default:
      return 'Platform-specific strategy not defined'
  }
}

/**
 * Get supported file formats for platform
 */
function getSupportedFormats(platform: string): string[] {
  switch (platform) {
    case 'macOS':
      return [
        'mcp.json with servers section',
        'settings.json with mcp.servers section'
      ]
    case 'Windows':
      return [
        'mcp.json with servers section'
      ]
    case 'Linux':
      return [
        'settings.json with mcp.servers section'
      ]
    default:
      return []
  }
}
