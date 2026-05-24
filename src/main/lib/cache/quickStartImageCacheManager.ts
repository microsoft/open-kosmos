/**
 * QuickStartImageCacheManager
 * Manages local caching of Quick Start card images
 *
 * Features:
 * - Cache remote images to local storage
 * - Clear stale cache when an agent is updated
 * - Provide cached path lookups
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import { createConsoleLogger } from '../unifiedLogger';

const logger = createConsoleLogger();

class QuickStartImageCacheManager {
  private static instance: QuickStartImageCacheManager;
  private cacheDir: string;

  private constructor() {
    this.cacheDir = path.join(app.getPath('userData'), 'cache', 'quick_start_images');
    this.ensureCacheDir();
  }

  static getInstance(): QuickStartImageCacheManager {
    if (!QuickStartImageCacheManager.instance) {
      QuickStartImageCacheManager.instance = new QuickStartImageCacheManager();
    }
    return QuickStartImageCacheManager.instance;
  }

  /**
   * Ensure the cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      logger.info(`[QuickStartImageCache] Created cache directory: ${this.cacheDir}`);
    }
  }

  /**
   * Get the MD5 hash of a URL
   */
  private getUrlHash(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  /**
   * Get the file extension from a URL
   */
  private getExtFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname;
      const ext = path.extname(pathname);
      return ext || '.png';
    } catch {
      return '.png';
    }
  }

  /**
   * Sanitize the agent name by replacing illegal filename characters
   */
  private sanitizeAgentName(agentName: string): string {
    return agentName.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * Get the cache file path
   */
  private getCacheFilePath(agentName: string, imageUrl: string): string {
    const hash = this.getUrlHash(imageUrl);
    const ext = this.getExtFromUrl(imageUrl);
    const safeAgentName = this.sanitizeAgentName(agentName);
    return path.join(this.cacheDir, safeAgentName, `${hash}${ext}`);
  }

  /**
   * Check whether an image is already cached
   */
  isCached(agentName: string, imageUrl: string): boolean {
    const cachePath = this.getCacheFilePath(agentName, imageUrl);
    return fs.existsSync(cachePath);
  }

  /**
   * Get the cached image path (if it exists)
   */
  getCachedPath(agentName: string, imageUrl: string): string | null {
    const cachePath = this.getCacheFilePath(agentName, imageUrl);
    return fs.existsSync(cachePath) ? cachePath : null;
  }

  /**
   * Add a timestamp query parameter to a URL to bypass CDN cache and ensure the latest image is fetched
   */
  private addTimestampToUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      urlObj.searchParams.set('timestamp', Date.now().toString());
      return urlObj.toString();
    } catch {
      // If URL parsing fails, fall back to simple string concatenation
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}timestamp=${Date.now()}`;
    }
  }

  /**
   * Cache a remote image
   * @returns The local file path after caching, or null on failure
   */
  async cacheImage(agentName: string, imageUrl: string): Promise<string | null> {
    try {
      // Use the original URL (without timestamp) to generate the cache path, ensuring cache hits
      const cachePath = this.getCacheFilePath(agentName, imageUrl);

      // Already cached — return immediately
      if (fs.existsSync(cachePath)) {
        return cachePath;
      }

      // Ensure the agent cache directory exists
      const agentCacheDir = path.dirname(cachePath);
      if (!fs.existsSync(agentCacheDir)) {
        fs.mkdirSync(agentCacheDir, { recursive: true });
      }

      // Add a timestamp parameter when downloading to bypass CDN cache and fetch the latest image
      const fetchUrl = this.addTimestampToUrl(imageUrl);
      const response = await fetch(fetchUrl);
      if (!response.ok) {
        logger.error(`[QuickStartImageCache] Failed to fetch: ${fetchUrl}, status: ${response.status}`);
        return null;
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(cachePath, Buffer.from(buffer));
      logger.info(`[QuickStartImageCache] Cached: ${imageUrl} -> ${cachePath}`);

      return cachePath;
    } catch (error) {
      logger.error(`[QuickStartImageCache] Error caching image: ${imageUrl}`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Get the MIME type for a file extension
   */
  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.bmp': 'image/bmp',
      '.ico': 'image/x-icon',
    };
    return mimeTypes[ext.toLowerCase()] || 'image/png';
  }

  /**
   * Get or cache an image.
   * Returns the image as a base64 data URL if cached; otherwise downloads, caches, and returns it.
   * @returns Image as a base64 data URL, or null on failure
   */
  async getOrCacheImage(agentName: string, imageUrl: string): Promise<string | null> {
    try {
      // Check cache first
      let cachedPath = this.getCachedPath(agentName, imageUrl);

      // If not cached, attempt to download and cache
      if (!cachedPath) {
        cachedPath = await this.cacheImage(agentName, imageUrl);
      }

      // If caching succeeded, read the file and convert to a base64 data URL
      if (cachedPath && fs.existsSync(cachedPath)) {
        const fileBuffer = fs.readFileSync(cachedPath);
        const base64 = fileBuffer.toString('base64');
        const ext = path.extname(cachedPath);
        const mimeType = this.getMimeType(ext);
        return `data:${mimeType};base64,${base64}`;
      }

      return null;
    } catch (error) {
      logger.error(`[QuickStartImageCache] Error getting/caching image: ${imageUrl}`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Clear all cached images for a specific agent.
   * Called when an agent is updated (version or zero_states changed).
   */
  clearAgentCache(agentName: string): void {
    const safeAgentName = this.sanitizeAgentName(agentName);
    const agentCacheDir = path.join(this.cacheDir, safeAgentName);

    if (fs.existsSync(agentCacheDir)) {
      try {
        fs.rmSync(agentCacheDir, { recursive: true, force: true });
        logger.info(`[QuickStartImageCache] Cleared cache for agent: ${agentName}`);
      } catch (error) {
        logger.error(`[QuickStartImageCache] Failed to clear cache for agent: ${agentName}`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Clear all cached images
   */
  clearAllCache(): void {
    if (fs.existsSync(this.cacheDir)) {
      try {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
        this.ensureCacheDir();
        logger.info('[QuickStartImageCache] Cleared all cache');
      } catch (error) {
        logger.error(`[QuickStartImageCache] Failed to clear all cache: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Get the cache directory path
   */
  getCacheDirectory(): string {
    return this.cacheDir;
  }
}

export const quickStartImageCacheManager = QuickStartImageCacheManager.getInstance();
