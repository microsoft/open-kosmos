/**
 * QuickStartImageCacheManager
 * Manages local caching of Quick Start card images
 * 
 * Features:
 * - Cache remote images locally
 * - Clean up old cache when Agent updates
 * - Provide cache path queries
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
   * Ensure cache directory exists
   */
  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      logger.info('[QuickStartImageCache] Created cache directory:', this.cacheDir);
    }
  }

  /**
   * Get MD5 hash of URL
   */
  private getUrlHash(url: string): string {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  /**
   * Get file extension from URL
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
   * Sanitize invalid filename characters from agent name
   */
  private sanitizeAgentName(agentName: string): string {
    return agentName.replace(/[<>:"/\\|?*]/g, '_');
  }

  /**
   * Get cache file path
   */
  private getCacheFilePath(agentName: string, imageUrl: string): string {
    const hash = this.getUrlHash(imageUrl);
    const ext = this.getExtFromUrl(imageUrl);
    const safeAgentName = this.sanitizeAgentName(agentName);
    return path.join(this.cacheDir, safeAgentName, `${hash}${ext}`);
  }

  /**
   * Check if image is already cached
   */
  isCached(agentName: string, imageUrl: string): boolean {
    const cachePath = this.getCacheFilePath(agentName, imageUrl);
    return fs.existsSync(cachePath);
  }

  /**
   * Get cached image path (if exists)
   */
  getCachedPath(agentName: string, imageUrl: string): string | null {
    const cachePath = this.getCacheFilePath(agentName, imageUrl);
    return fs.existsSync(cachePath) ? cachePath : null;
  }

  /**
   * Add timestamp parameter to URL to bypass CDN cache and ensure latest image
   */
  private addTimestampToUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      urlObj.searchParams.set('timestamp', Date.now().toString());
      return urlObj.toString();
    } catch {
      // If URL parsing fails, use simple string concatenation
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}timestamp=${Date.now()}`;
    }
  }

  /**
   * Cache remote image
   * @returns Local file path of cached image, or null on failure
   */
  async cacheImage(agentName: string, imageUrl: string): Promise<string | null> {
    try {
      // Use original URL for cache path (without timestamp) to ensure cache hits
      const cachePath = this.getCacheFilePath(agentName, imageUrl);
      
      // Already cached, return directly
      if (fs.existsSync(cachePath)) {
        return cachePath;
      }

      // Ensure agent directory exists
      const agentCacheDir = path.dirname(cachePath);
      if (!fs.existsSync(agentCacheDir)) {
        fs.mkdirSync(agentCacheDir, { recursive: true });
      }

      // Add timestamp parameter when downloading to bypass CDN cache for latest image
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
   * Get MIME type for an image
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
   * Get or cache image
   * Returns base64 data URL if cached, otherwise downloads and caches then returns
   * @returns Image in base64 data URL format, or null on failure
   */
  async getOrCacheImage(agentName: string, imageUrl: string): Promise<string | null> {
    try {
      // Check cache first
      let cachedPath = this.getCachedPath(agentName, imageUrl);
      
      // If not cached, try downloading and caching
      if (!cachedPath) {
        cachedPath = await this.cacheImage(agentName, imageUrl);
      }
      
      // If cached successfully, read file and convert to base64 data URL
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
   * Clear all image cache for a specific Agent
   * Called when Agent updates (version or zero_states change)
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
   * Clear all image cache
   */
  clearAllCache(): void {
    if (fs.existsSync(this.cacheDir)) {
      try {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
        this.ensureCacheDir();
        logger.info('[QuickStartImageCache] Cleared all cache');
      } catch (error) {
        logger.error('[QuickStartImageCache] Failed to clear all cache', error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Get cache directory path
   */
  getCacheDirectory(): string {
    return this.cacheDir;
  }
}

export const quickStartImageCacheManager = QuickStartImageCacheManager.getInstance();
