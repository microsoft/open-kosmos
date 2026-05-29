/**
 * MCP Library Fetcher
 * Fetches MCP server library data from remote server and caches it locally
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createLogger } from '../unifiedLogger';
import { getCdnBaseUrl, isCdnConfigured } from '@shared/utils/cdn';
import https from 'https';
import http from 'http';
// Inlined from urlUtils to avoid circular chunk dependency at bundle time
function appendCacheBustingTimestamp(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}timestamp=${Date.now()}`;
}

const logger = createLogger();

interface McpServerLibraryItem {
  name: string;
  description: string;
  version?: string;
  source?: 'IN-LIBRARY' | 'ON-DEVICE';
  tags?: string[];
  contact?: string;
  transport: 'stdio' | 'sse' | 'StreamableHttp';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  requirements?: Record<string, string>;
  prompts?: {
    setup_mcp?: string;
    update_mcp?: string;
    setup_requirements?: string;
  };
}

interface McpLibraryData {
  mcp_servers: McpServerLibraryItem[];
}

export class McpLibraryFetcher {
  private static instance: McpLibraryFetcher;
  private readonly libraryUrl: string;
  private readonly assetsDir: string;
  private readonly mcpDir: string;
  private readonly libraryFilePath: string;

  private constructor() {
    // Resolve the optional CDN base URL. When unset, the MCP Library feature
    // simply has no remote source and relies on the bundled/local cache only.
    const baseCdnUrl = getCdnBaseUrl();

    // Set MCP library URL based on environment (empty when CDN not configured)
    this.libraryUrl = baseCdnUrl ? `${baseCdnUrl}/mcp/mcp_lib.json` : '';

    logger.info(`[McpLibraryFetcher] Initialized with baseCdnUrl: ${baseCdnUrl || '(none — optional feature disabled)'}, libraryUrl: ${this.libraryUrl || '(none)'}`, 'McpLibraryFetcher');

    // Get user data directory (writable location)
    const userDataPath = app.getPath('userData');

    // Create assets/mcp directory path in user data
    this.assetsDir = path.join(userDataPath, 'assets');
    this.mcpDir = path.join(this.assetsDir, 'mcp');
    this.libraryFilePath = path.join(this.mcpDir, 'mcp_lib.json');

    // Ensure directories exist
    this.ensureDirectories();
  }

  public static getInstance(): McpLibraryFetcher {
    if (!McpLibraryFetcher.instance) {
      McpLibraryFetcher.instance = new McpLibraryFetcher();
    }
    return McpLibraryFetcher.instance;
  }

  /**
   * Ensure required directories exist
   */
  private ensureDirectories(): void {
    try {
      if (!fs.existsSync(this.assetsDir)) {
        fs.mkdirSync(this.assetsDir, { recursive: true });
        logger.info(`[McpLibraryFetcher] Created assets directory: ${this.assetsDir}`);
      }

      if (!fs.existsSync(this.mcpDir)) {
        fs.mkdirSync(this.mcpDir, { recursive: true });
        logger.info(`[McpLibraryFetcher] Created mcp directory: ${this.mcpDir}`);
      }
    } catch (error) {
      logger.error(`[McpLibraryFetcher] Failed to create directories: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Fetch library data from remote server using http/https modules
   */
  private async fetchFromRemote(): Promise<McpLibraryData> {
    return new Promise((resolve, reject) => {
      // CDN is optional; without a configured base URL there is no remote source.
      if (!isCdnConfigured() || !this.libraryUrl) {
        reject(new Error('CDN not configured; skipping remote MCP Library fetch'));
        return;
      }

      // Add timestamp to bypass CDN cache
      const urlWithTimestamp = appendCacheBustingTimestamp(this.libraryUrl);
      const urlObj = new URL(urlWithTimestamp);
      const protocol = urlObj.protocol === 'https:' ? https : http;

      logger.info(`[McpLibraryFetcher] Fetching from remote: ${urlWithTimestamp}`);

      const request = protocol.get(urlWithTimestamp, (response) => {
        // Use Buffer array to properly handle multi-byte UTF-8 characters (e.g., emoji)
        const chunks: Buffer[] = [];

        // Check response status
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // Collect data chunks as Buffer to avoid UTF-8 boundary issues
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        // Parse complete response
        response.on('end', () => {
          try {
            // Concatenate all chunks and decode as UTF-8 to preserve multi-byte characters
            const data = Buffer.concat(chunks).toString('utf-8');
            logger.info(`[McpLibraryFetcher] Response received, length: ${data.length}`);
            const jsonData: McpLibraryData = JSON.parse(data);

            // Validate data structure
            if (!jsonData.mcp_servers || !Array.isArray(jsonData.mcp_servers)) {
              reject(new Error('Invalid data format: mcp_servers array not found'));
              return;
            }

            logger.info(`[McpLibraryFetcher] Successfully fetched ${jsonData.mcp_servers.length} servers`);
            resolve(jsonData);
          } catch (error) {
            reject(new Error(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`));
          }
        });
      });

      // Handle request errors
      request.on('error', (error) => {
        logger.error(`[McpLibraryFetcher] Request error: ${error.message}`);
        reject(new Error(`Network error: ${error.message}`));
      });

      // Set timeout
      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('Request timeout (10s)'));
      });
    });
  }

  /**
   * Save library data to local file
   */
  private async saveToLocal(data: McpLibraryData): Promise<void> {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.libraryFilePath, jsonString, 'utf-8');
      logger.info(`[McpLibraryFetcher] Saved library data to: ${this.libraryFilePath}`);
    } catch (error) {
      logger.error(`[McpLibraryFetcher] Failed to save library data: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Load library data from local file
   */
  private async loadFromLocal(): Promise<McpLibraryData | null> {
    try {
      if (!fs.existsSync(this.libraryFilePath)) {
        logger.info('[McpLibraryFetcher] Local library file not found');
        return null;
      }

      const content = fs.readFileSync(this.libraryFilePath, 'utf-8');
      const data: McpLibraryData = JSON.parse(content);

      // Validate data structure
      if (!data.mcp_servers || !Array.isArray(data.mcp_servers)) {
        logger.warn('[McpLibraryFetcher] Invalid local data format, will re-fetch');
        return null;
      }

      logger.info(`[McpLibraryFetcher] Loaded ${data.mcp_servers.length} servers from local cache`);
      return data;
    } catch (error) {
      logger.error(`[McpLibraryFetcher] Failed to load local library data: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Fetch and update library data
   * Returns updated data and notifies renderer process
   */
  public async fetchAndUpdate(): Promise<{ success: boolean; data?: McpLibraryData; error?: string }> {
    try {
      logger.info('[McpLibraryFetcher] Starting fetch and update...');

      // Fetch from remote
      const data = await this.fetchFromRemote();

      // Save to local
      await this.saveToLocal(data);

      return {
        success: true,
        data
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[McpLibraryFetcher] Fetch and update failed: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get library data (prioritize remote, fallback to local cache)
   */
  public async getLibraryData(): Promise<{ success: boolean; data?: McpLibraryData; error?: string }> {
    try {
      // First, try to fetch from remote
      logger.info('[McpLibraryFetcher] Attempting to fetch from remote...');
      const fetchResult = await this.fetchAndUpdate();

      if (fetchResult.success) {
        // Successfully fetched from remote
        return fetchResult;
      }

      // Remote fetch failed, try to use local cache as fallback
      logger.warn('[McpLibraryFetcher] Remote fetch failed, trying local cache as fallback...');
      const localData = await this.loadFromLocal();

      if (localData) {
        logger.info('[McpLibraryFetcher] Using local cache as fallback');
        return {
          success: true,
          data: localData
        };
      }

      // Both remote and local failed
      return {
        success: false,
        error: `Remote fetch failed: ${fetchResult.error}. No local cache available.`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[McpLibraryFetcher] Failed to get library data: ${errorMessage}`);

      // Try local cache as final fallback
      try {
        const localData = await this.loadFromLocal();
        if (localData) {
          logger.info('[McpLibraryFetcher] Using local cache after exception');
          return {
            success: true,
            data: localData
          };
        }
      } catch (localError) {
        logger.error(`[McpLibraryFetcher] Local fallback also failed: ${localError instanceof Error ? localError.message : String(localError)}`);
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get local library file path
   */
  public getLibraryFilePath(): string {
    return this.libraryFilePath;
  }

  /**
   * Check if local cache exists
   */
  public hasLocalCache(): boolean {
    return fs.existsSync(this.libraryFilePath);
  }
}