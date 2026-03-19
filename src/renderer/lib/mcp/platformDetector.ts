/**
 * Platform Detection Tool for VSCode MCP Configuration Import
 * Detects current platform and provides platform-specific VSCode config paths
 */

export type SupportedPlatform = 'macOS' | 'Windows' | 'Linux'

export interface PlatformInfo {
  platform: SupportedPlatform
  isSupported: boolean
  vscodeConfigPath: string // Legacy single path for backward compatibility
  vscodeConfigPaths: string[] // New multi-path support
  displayName: string
}

/**
 * VSCode configuration file paths for different platforms (prioritized order)
 */
const WINDOWS_VSCODE_PATHS = [
  // 1. Standard version (highest priority)
  '%APPDATA%\\Code\\User\\mcp.json',
  
  // 2. Insiders version
  '%APPDATA%\\Code - Insiders\\User\\mcp.json',
  
  // 3. OSS open source version
  '%APPDATA%\\Code - OSS\\User\\mcp.json',
  
  // 4. Portable version (relative to VS Code installation directory)
  '.\\data\\user-data\\User\\mcp.json',
  
  // 5. Custom data directory
  '%VSCODE_APPDATA%\\User\\mcp.json',
  
  // 6. System-level installation
  '%PROGRAMDATA%\\Code\\User\\mcp.json'
]

const MACOS_VSCODE_PATHS = [
  // 1. Standard installation - mcp.json priority
  '~/Library/Application Support/Code/User/mcp.json',
  '~/Library/Application Support/Code/User/settings.json',
  
  // 2. Insiders version
  '~/Library/Application Support/Code - Insiders/User/mcp.json',
  '~/Library/Application Support/Code - Insiders/User/settings.json',
  
  // 3. OSS version
  '~/Library/Application Support/Code - OSS/User/mcp.json',
  '~/Library/Application Support/Code - OSS/User/settings.json',
  
  // 4. Homebrew installation path
  '/usr/local/var/vscode/User/mcp.json',
  '/usr/local/var/vscode/User/settings.json'
]

const LINUX_VSCODE_PATHS = [
  '~/.config/Code/User/settings.json',
  '~/.config/Code - Insiders/User/settings.json',
  '~/.config/Code - OSS/User/settings.json'
]

/**
 * VSCode configuration file paths for different platforms (legacy compatibility)
 */
const VSCODE_CONFIG_PATHS = {
  macOS: MACOS_VSCODE_PATHS[0], // First path for backward compatibility
  Windows: WINDOWS_VSCODE_PATHS[0], // First path for backward compatibility
  Linux: LINUX_VSCODE_PATHS[0]
}

/**
 * Platform display names
 */
const PLATFORM_DISPLAY_NAMES = {
  macOS: 'macOS',
  Windows: 'Windows',
  Linux: 'Linux'
}

/**
 * Detect the current platform based on user agent and navigator properties
 */
export function getCurrentPlatform(): SupportedPlatform {
  const userAgent = navigator.userAgent.toLowerCase()
  const platform = navigator.platform.toLowerCase()
  
  // Check for macOS
  if (platform.includes('mac') || userAgent.includes('mac os')) {
    return 'macOS'
  }
  
  // Check for Windows
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'Windows'
  }
  
  // Check for Linux
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'Linux'
  }
  
  // Default to macOS if unable to detect (since we're primarily targeting macOS/Windows)
  return 'macOS'
}

/**
 * Get all VSCode configuration file paths for the current platform (prioritized)
 */
export function getVSCodeConfigPaths(platform?: SupportedPlatform): string[] {
  const currentPlatform = platform || getCurrentPlatform()
  
  switch (currentPlatform) {
    case 'Windows':
      return WINDOWS_VSCODE_PATHS
    case 'macOS':
      return MACOS_VSCODE_PATHS
    case 'Linux':
      return LINUX_VSCODE_PATHS
    default:
      return []
  }
}

/**
 * Get VSCode configuration file path for the current platform (legacy compatibility)
 */
export function getVSCodeConfigPath(platform?: SupportedPlatform): string {
  const currentPlatform = platform || getCurrentPlatform()
  return VSCODE_CONFIG_PATHS[currentPlatform]
}

/**
 * Get expanded VSCode configuration file path (resolve environment variables)
 */
export function getExpandedVSCodeConfigPath(platform?: SupportedPlatform): string {
  const currentPlatform = platform || getCurrentPlatform()
  const configPath = VSCODE_CONFIG_PATHS[currentPlatform]
  
  // For renderer process, we can't directly access environment variables
  // The actual path expansion will be handled by the main process
  // Here we return the template path for display purposes
  return configPath
}

/**
 * Check if the current platform is supported for VSCode import
 */
export function isPlatformSupported(platform?: SupportedPlatform): boolean {
  const currentPlatform = platform || getCurrentPlatform()
  // Currently supporting macOS and Windows, Linux is reserved for future
  return currentPlatform === 'macOS' || currentPlatform === 'Windows'
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(platform?: SupportedPlatform): PlatformInfo {
  const currentPlatform = platform || getCurrentPlatform()
  
  return {
    platform: currentPlatform,
    isSupported: isPlatformSupported(currentPlatform),
    vscodeConfigPath: getVSCodeConfigPath(currentPlatform),
    vscodeConfigPaths: getVSCodeConfigPaths(currentPlatform),
    displayName: PLATFORM_DISPLAY_NAMES[currentPlatform]
  }
}

/**
 * Get all supported platforms information
 */
export function getAllSupportedPlatforms(): PlatformInfo[] {
  return (['macOS', 'Windows'] as SupportedPlatform[]).map(platform => getPlatformInfo(platform))
}

/**
 * Get platform-specific file patterns for file dialogs
 */
export function getPlatformFilePatterns(platform?: SupportedPlatform): { name: string; extensions: string[] }[] {
  const currentPlatform = platform || getCurrentPlatform()
  
  switch (currentPlatform) {
    case 'macOS':
      return [
        { name: 'VSCode Settings', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    case 'Windows':
      return [
        { name: 'MCP Configuration', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    case 'Linux':
      return [
        { name: 'VSCode Settings', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    default:
      return [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
  }
}

/**
 * Platform-specific constants for different operating systems
 */
export const PLATFORM_CONSTANTS = {
  macOS: {
    configPath: VSCODE_CONFIG_PATHS.macOS,
    configType: 'settings.json with mcp section',
    homePrefix: '~/',
    pathSeparator: '/',
    supportedMcpFormats: ['settings.json with mcp.servers section']
  },
  Windows: {
    configPath: VSCODE_CONFIG_PATHS.Windows,
    configType: 'standalone mcp.json file',
    homePrefix: '%APPDATA%/',
    pathSeparator: '\\',
    supportedMcpFormats: ['standalone mcp.json with servers section']
  },
  Linux: {
    configPath: VSCODE_CONFIG_PATHS.Linux,
    configType: 'settings.json with mcp section',
    homePrefix: '~/',
    pathSeparator: '/',
    supportedMcpFormats: ['settings.json with mcp.servers section']
  }
} as const