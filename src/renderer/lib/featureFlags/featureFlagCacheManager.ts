/**
 * Feature Flag cache manager (Renderer Process)
 *
 * Architecture notes:
 * - Backend (Main Process) is the single source of truth for feature flags
 * - Feature flags are defined by developers in the backend, or passed via CLI arguments
 * - Frontend is read-only; flags are synced from the backend at startup
 * - localStorage cache is used as a fallback
 */

import { createLogger } from '../utilities/logger';
const logger = createLogger('[FeatureFlagCacheManager]');

type FeatureFlagName = string;
type FeatureFlagsValues = Record<FeatureFlagName, boolean>;

const STORAGE_KEY = 'openkosmos_feature_flags_cache';
const CACHE_VERSION_KEY = 'openkosmos_feature_flags_cache_version';
const CURRENT_CACHE_VERSION = '1.0';

class FeatureFlagCacheManager {
  private static instance: FeatureFlagCacheManager;
  private flags: FeatureFlagsValues = {};
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  public static getInstance(): FeatureFlagCacheManager {
    if (!FeatureFlagCacheManager.instance) {
      FeatureFlagCacheManager.instance = new FeatureFlagCacheManager();
    }
    return FeatureFlagCacheManager.instance;
  }

  /**
   * Initialize the cache manager
   * Should be called at app startup to sync the latest flags from the backend
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.debug('[FeatureFlagsCache] Already initialized, skipping...');
      return;
    }

    // Prevent duplicate initialization
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    logger.debug('[FeatureFlagsCache] Initializing feature flags cache manager...');

    try {
      // Check cache version
      const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
      const needsUpdate = cachedVersion !== CURRENT_CACHE_VERSION;

      if (needsUpdate) {
        logger.debug('[FeatureFlagsCache] Cache version mismatch, clearing old cache...');
        localStorage.removeItem(STORAGE_KEY);
      }

      // Fetch latest flags from the backend
      await this.syncFromBackend();

      // Update cache version
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);

      this.initialized = true;
      logger.debug('[FeatureFlagsCache] Initialization complete');
    } catch (error) {
      logger.error('[FeatureFlagsCache] Initialization failed:', error);
      // If sync fails, attempt to load old cache from localStorage
      this.loadFromLocalStorage();
      this.initialized = true;
    }
  }

  /**
   * Sync the latest flags from the backend
   */
  private async syncFromBackend(): Promise<void> {
    logger.debug('[FeatureFlagsCache] Syncing flags from backend...');

    try {
      const flagsResult = await window.electronAPI.featureFlags.getAllFlags();
      if (!flagsResult.success) {
        throw new Error(flagsResult.error || 'Failed to fetch feature flags');
      }

      this.flags = flagsResult.data || {};
      this.saveToLocalStorage();

      logger.debug('[FeatureFlagsCache] Successfully synced flags from backend', {
        flagCount: Object.keys(this.flags).length,
      });
    } catch (error) {
      logger.error('[FeatureFlagsCache] Failed to sync from backend:', error);
      throw error;
    }
  }

  /**
   * Save flags data to localStorage
   */
  private saveToLocalStorage(): void {
    try {
      const cacheData = {
        flags: this.flags,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheData));
    } catch (error) {
      logger.error('[FeatureFlagsCache] Failed to save to localStorage:', error);
    }
  }

  /**
   * Load flags data from localStorage
   */
  private loadFromLocalStorage(): void {
    try {
      const cachedData = localStorage.getItem(STORAGE_KEY);
      if (cachedData) {
        const parsedData = JSON.parse(cachedData);
        this.flags = parsedData.flags || {};
        logger.debug('[FeatureFlagsCache] Loaded from localStorage', {
          flagCount: Object.keys(this.flags).length,
        });
      }
    } catch (error) {
      logger.error('[FeatureFlagsCache] Failed to load from localStorage:', error);
    }
  }

  /**
   * Check whether a feature flag is enabled (synchronous)
   */
  public isEnabled(name: string): boolean {
    if (!this.initialized) {
      logger.warn('[FeatureFlagsCache] Not initialized, returning false for', name);
      return false;
    }
    return this.flags[name] ?? false;
  }

  /**
   * Get all flag values
   */
  public getAllFlags(): FeatureFlagsValues {
    if (!this.initialized) {
      return {};
    }
    return { ...this.flags };
  }

  /**
   * Check whether the manager has been initialized
   */
  public get isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const featureFlagCacheManager = FeatureFlagCacheManager.getInstance();

// Export convenience functions
export function isFeatureEnabled(name: string): boolean {
  return featureFlagCacheManager.isEnabled(name);
}

export function getAllFeatureFlags(): Record<string, boolean> {
  return featureFlagCacheManager.getAllFlags();
}
