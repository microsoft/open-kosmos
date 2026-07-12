/**
 * Configuration detector
 * VSCode MCP Client configuration file detection and validation
 */

import fs from 'node:fs/promises';
import {
  VscodeConfigFile,
  VscodeConfigDetectionResult
} from './types';
import {
  checkFileExists,
  checkFileReadable,
  readFileContent,
  getFileStats,
  expandPath,
  getPlatformInfo,
  getVSCodeConfigPaths,
  detectConfigFormat,
  validateJsonFormat
} from './utils';

interface ConfigCandidatePath {
  originalPath: string;
  expandedPath: string;
}

// ==================== Main configuration detection functions ====================

/**
 * Detect VSCode configuration files (current platform)
 */
export async function detectVSCodeConfigs(): Promise<VscodeConfigDetectionResult> {
  try {
    const platformInfo = getPlatformInfo();

    if (!platformInfo.isSupported) {
      return {
        success: false,
        platform: platformInfo.platform,
        isSupported: false,
        configFiles: [],
        totalServersFound: 0,
        error: `Platform ${platformInfo.platform} does not currently support VSCode import`
      };
    }

    // Get all VSCode configuration paths (sorted by priority)
    const configPaths = await getConfigCandidatePaths();
    const configFiles: VscodeConfigFile[] = [];
    let totalServersFound = 0;

    // Scan paths in priority order until a valid configuration is found
    for (const configPath of configPaths) {
      try {
        const configFile = await detectSingleConfigFile(configPath.originalPath, configPath.expandedPath);

        configFiles.push(configFile);

        // Stop scanning if a valid configuration with servers is found
        if (configFile.exists && configFile.isValid && configFile.serverCount > 0) {
          totalServersFound += configFile.serverCount;
          break;
        }
      } catch (error) {
        // Continue checking the next path
        continue;
      }
    }

    return {
      success: true,
      platform: platformInfo.platform,
      isSupported: true,
      configFiles,
      totalServersFound,
    };
  } catch (error) {
    const platformInfo = getPlatformInfo();
    return {
      success: false,
      platform: platformInfo.platform,
      isSupported: false,
      configFiles: [],
      totalServersFound: 0,
      error: `Detection failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Scan in priority order to find the first valid MCP configuration file
 */
export async function detectVscodeConfigFile(): Promise<string | null> {
  try {
    const platformInfo = getPlatformInfo();

    if (!platformInfo.isSupported) {
      return null;
    }

    const configPaths = await getConfigCandidatePaths();

    for (const configPath of configPaths) {
      try {
        const fileExists = await checkFileExists(configPath.expandedPath);

        if (fileExists.exists) {
          // Verify that the file contains MCP configuration
          const configFile = await detectSingleConfigFile(configPath.originalPath, configPath.expandedPath);
          if (configFile.isValid && configFile.serverCount > 0) {
            return configPath.expandedPath;
          }
        }
      } catch (error) {
        // Continue checking the next path
        continue;
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

async function getConfigCandidatePaths(): Promise<ConfigCandidatePath[]> {
  const configPaths = getVSCodeConfigPaths();
  const candidates: ConfigCandidatePath[] = [];
  const seenPaths = new Set<string>();

  for (const configPath of configPaths) {
    const expandedPath = await expandPath(configPath);
    pushCandidatePath(candidates, seenPaths, configPath, expandedPath);

    const profileCandidates = await getProfileConfigCandidatePaths(configPath, expandedPath);
    for (const candidate of profileCandidates) {
      pushCandidatePath(candidates, seenPaths, candidate.originalPath, candidate.expandedPath);
    }
  }

  return candidates;
}

async function getProfileConfigCandidatePaths(
  originalPath: string,
  expandedPath: string
): Promise<ConfigCandidatePath[]> {
  const fileName = getPathFileName(expandedPath);
  if (fileName !== 'mcp.json' && fileName !== 'settings.json') {
    return [];
  }

  const originalDir = getParentPath(originalPath);
  const expandedDir = getParentPath(expandedPath);
  if (!originalDir || !expandedDir) {
    return [];
  }

  const originalProfilesDir = joinPathSegment(originalDir, 'profiles');
  const expandedProfilesDir = joinPathSegment(expandedDir, 'profiles');

  try {
    const entries = await fs.readdir(expandedProfilesDir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        originalPath: joinPathSegment(originalProfilesDir, entry.name, fileName),
        expandedPath: joinPathSegment(expandedProfilesDir, entry.name, fileName),
      }));
  } catch {
    return [];
  }
}

function pushCandidatePath(
  candidates: ConfigCandidatePath[],
  seenPaths: Set<string>,
  originalPath: string,
  expandedPath: string
): void {
  const normalizedKey = expandedPath.toLowerCase();
  if (seenPaths.has(normalizedKey)) {
    return;
  }

  seenPaths.add(normalizedKey);
  candidates.push({ originalPath, expandedPath });
}

function getParentPath(filePath: string): string {
  const normalizedPath = filePath.replace(/[\\/]+$/, '');
  const lastSeparatorIndex = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'));
  return lastSeparatorIndex >= 0 ? normalizedPath.slice(0, lastSeparatorIndex) : '';
}

function getPathFileName(filePath: string): string {
  const normalizedPath = filePath.replace(/[\\/]+$/, '');
  const lastSeparatorIndex = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'));
  return (lastSeparatorIndex >= 0 ? normalizedPath.slice(lastSeparatorIndex + 1) : normalizedPath).toLowerCase();
}

function joinPathSegment(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes('\\') ? '\\' : '/';
  const trimmedBase = basePath.replace(/[\\/]+$/, '');
  const normalizedSegments = segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ''));
  return [trimmedBase, ...normalizedSegments].join(separator);
}

/**
 * Detect and validate a single configuration file
 */
export async function detectSingleConfigFile(
  originalPath: string,
  expandedPath?: string
): Promise<VscodeConfigFile> {
  const actualPath = expandedPath || originalPath;

  // Initialize the configuration file object
  const configFile: VscodeConfigFile = {
    path: originalPath,
    expandedPath: actualPath,
    exists: false,
    isValid: false,
    isReadable: false,
    serverCount: 0,
    detectedFormat: 'unknown'
  };

  try {
    // Check whether the file exists
    const existsResult = await checkFileExists(actualPath);
    configFile.exists = existsResult.exists;

    if (!configFile.exists) {
      configFile.error = existsResult.error || 'File does not exist';
      return configFile;
    }

    // Check whether the file is readable
    const accessResult = await checkFileReadable(actualPath);
    configFile.isReadable = accessResult.readable;

    if (!configFile.isReadable) {
      configFile.error = accessResult.error || 'File is not readable';
      return configFile;
    }

    // Get file statistics
    const statsResult = await getFileStats(actualPath);
    if (statsResult.success && statsResult.stats) {
      configFile.fileSize = statsResult.stats.size;
      configFile.lastModified = statsResult.stats.lastModified;
    }

    // Read and validate file content
    const readResult = await readFileContent(actualPath);
    if (!readResult.success || !readResult.content) {
      configFile.error = readResult.error || 'Failed to read file content';
      return configFile;
    }

    // Determine file format and validate content
    const validationResult = await validateConfigContent(readResult.content, actualPath);
    configFile.isValid = validationResult.isValid;
    configFile.serverCount = validationResult.serverCount;
    configFile.detectedFormat = validationResult.format;

    if (!configFile.isValid) {
      configFile.error = validationResult.error;
    }

    return configFile;
  } catch (error) {
    configFile.error = `Detection error: ${error instanceof Error ? error.message : String(error)}`;
    return configFile;
  }
}

/**
 * Detect a custom configuration file
 */
export async function detectCustomConfigFile(filePath: string): Promise<VscodeConfigFile> {
  const expandedPath = await expandPath(filePath);
  return await detectSingleConfigFile(filePath, expandedPath);
}

// ==================== Configuration content validation ====================

/**
 * Validate configuration file content and count servers
 */
async function validateConfigContent(content: string, filePath: string): Promise<{
  isValid: boolean;
  serverCount: number;
  format: 'settings.json' | 'mcp.json' | 'unknown';
  error?: string;
}> {
  try {
    // Validate JSON format
    const jsonValidation = validateJsonFormat(content);
    if (!jsonValidation.isValid) {
      return {
        isValid: false,
        serverCount: 0,
        format: 'unknown',
        error: `Invalid JSON format: ${jsonValidation.error}`
      };
    }

    // Parse JSON content
    let parsedContent: any;
    try {
      parsedContent = JSON.parse(content);
    } catch (parseError) {
      return {
        isValid: false,
        serverCount: 0,
        format: 'unknown',
        error: `JSON parse error: ${parseError instanceof Error ? parseError.message : 'Parse error'}`
      };
    }

    // Determine format and find MCP servers
    const format = detectConfigFormat(filePath, content);
    let mcpServers: any = null;

    if (format === 'settings.json') {
      // Find mcp.servers in settings.json
      mcpServers = parsedContent.mcp?.servers;
    } else if (format === 'mcp.json') {
      // Find servers in mcp.json
      mcpServers = parsedContent.servers;
    } else {
      // Try to detect format from content structure
      if (parsedContent.mcp?.servers) {
        mcpServers = parsedContent.mcp.servers;
      } else if (parsedContent.servers) {
        mcpServers = parsedContent.servers;
      }
    }

    // Count servers
    let serverCount = 0;
    if (mcpServers && typeof mcpServers === 'object') {
      serverCount = Object.keys(mcpServers).length;
    }

    // Verify that MCP servers were found
    if (serverCount === 0) {
      return {
        isValid: false,
        serverCount: 0,
        format,
        error: 'No MCP server found in configuration file'
      };
    }

    // Basic validation of server configurations
    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      if (!serverConfig || typeof serverConfig !== 'object') {
        return {
          isValid: false,
          serverCount: 0,
          format,
          error: `Server "${serverName}" has invalid configuration`
        };
      }

      const config = serverConfig as any;
      // Check whether command/args (stdio) or url (http/sse) configuration is present
      const hasStdioConfig = config.command || config.args;
      const hasHttpConfig = config.url;

      if (!hasStdioConfig && !hasHttpConfig) {
        return {
          isValid: false,
          serverCount: 0,
          format,
          error: `Server "${serverName}" is missing required configuration (command/args or url)`
        };
      }
    }

    return {
      isValid: true,
      serverCount,
      format
    };
  } catch (error) {
    return {
      isValid: false,
      serverCount: 0,
      format: 'unknown',
      error: `Validation error: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// ==================== Platform detection information ====================

/**
 * Get detailed platform-specific detection information
 */
export function getPlatformDetectionInfo() {
  const platformInfo = getPlatformInfo();

  return {
    platform: platformInfo.platform,
    isSupported: platformInfo.isSupported,
    standardConfigPath: platformInfo.vscodeConfigPath,
    detectionStrategy: getDetectionStrategy(platformInfo.platform),
    supportedFormats: getSupportedFormats(platformInfo.platform)
  };
}

/**
 * Get the detection strategy for the platform
 */
function getDetectionStrategy(platform: string): string {
  switch (platform) {
    case 'macOS':
      return 'Scan mcp.json and settings.json files across multiple VSCode installation paths (Standard, Insiders, OSS, Homebrew)';
    case 'Windows':
      return 'Scan mcp.json files across multiple VSCode installation paths (Standard, Insiders, OSS, Portable, System-wide)';
    case 'Linux':
      return 'Scan settings.json files across multiple VSCode installation paths (future support)';
    default:
      return 'No platform-specific strategy defined';
  }
}

/**
 * Get the file formats supported by the platform
 */
function getSupportedFormats(platform: string): string[] {
  switch (platform) {
    case 'macOS':
      return [
        'mcp.json with a servers section',
        'settings.json with a mcp.servers section'
      ];
    case 'Windows':
      return [
        'mcp.json with a servers section'
      ];
    case 'Linux':
      return [
        'settings.json with a mcp.servers section'
      ];
    default:
      return [];
  }
}

// ==================== Configuration validation utilities ====================

/**
 * Validate whether a configuration file is a valid MCP configuration
 */
export function isValidMcpConfig(configFile: VscodeConfigFile): boolean {
  return configFile.exists &&
         configFile.isValid &&
         configFile.isReadable &&
         configFile.serverCount > 0;
}

/**
 * Get the quality score for a configuration file
 */
export function getConfigQualityScore(configFile: VscodeConfigFile): number {
  let score = 0;

  if (configFile.exists) score += 20;
  if (configFile.isReadable) score += 20;
  if (configFile.isValid) score += 30;
  if (configFile.serverCount > 0) score += 20;
  if (configFile.detectedFormat !== 'unknown') score += 10;

  return score;
}

/**
 * Get configuration detection summary
 */
export function getDetectionSummary(result: VscodeConfigDetectionResult): {
  totalFiles: number;
  validFiles: number;
  totalServers: number;
  bestConfig?: VscodeConfigFile;
} {
  const totalFiles = result.configFiles.length;
  const validFiles = result.configFiles.filter(f => isValidMcpConfig(f)).length;
  const totalServers = result.totalServersFound;

  // Find the best configuration (priority: valid > server count > quality score)
  let bestConfig: VscodeConfigFile | undefined;
  let bestScore = -1;

  for (const configFile of result.configFiles) {
    if (isValidMcpConfig(configFile)) {
      const score = getConfigQualityScore(configFile) + (configFile.serverCount * 5);
      if (score > bestScore) {
        bestScore = score;
        bestConfig = configFile;
      }
    }
  }

  return {
    totalFiles,
    validFiles,
    totalServers,
    bestConfig
  };
}