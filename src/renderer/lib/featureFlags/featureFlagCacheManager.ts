/**
 * Feature Flag Cache Manager (Renderer Process)
 * 
 * Architecture:
 * - Backend (Main Process) is the single source of truth for Feature Flags
 * - Feature flags are defined by developers in the backend, or passed via command-line arguments
 * - Frontend has read-only access, synced from backend on startup
 * - localStorage cache serves as a fallback
 */

import { BRAND_NAME } from '@shared/constants/branding';

type FeatureFlagName = string;
type FeatureFlagsValues = Record<FeatureFlagName, boolean>;

const STORAGE_KEY = `${BRAND_NAME}_feature_flags_cache`;
const CACHE_VERSION_KEY = `${BRAND_NAME}_feature_flags_cache_version`;
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
   * Should be called on application startup to sync the latest flags data from the backend
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[FeatureFlagsCache] Already initialized, skipping...');
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
    console.log('[FeatureFlagsCache] Initializing feature flags cache manager...');

    try {
      // Check cache version
      const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
      const needsUpdate = cachedVersion !== CURRENT_CACHE_VERSION;

      if (needsUpdate) {
        console.log('[FeatureFlagsCache] Cache version mismatch, clearing old cache...');
        localStorage.removeItem(STORAGE_KEY);
      }

      // Fetch the latest flags data from the backend
      await this.syncFromBackend();

      // Update cache version
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);

      this.initialized = true;
      console.log('[FeatureFlagsCache] Initialization complete');
    } catch (error) {
      console.error('[FeatureFlagsCache] Initialization failed:', error);
      // If sync fails, try loading old cache from localStorage
      this.loadFromLocalStorage();
      this.initialized = true;
    }
  }

  /**
   * Sync the latest flags data from the backend
   */
  private async syncFromBackend(): Promise<void> {
    console.log('[FeatureFlagsCache] Syncing flags from backend...');

    try {
      const flagsResult = await window.electronAPI.featureFlags.getAllFlags();
      if (!flagsResult.success) {
        throw new Error(flagsResult.error || 'Failed to fetch feature flags');
      }

      this.flags = flagsResult.data || {};
      this.saveToLocalStorage();

      console.log('[FeatureFlagsCache] Successfully synced flags from backend', {
        flagCount: Object.keys(this.flags).length,
      });
    } catch (error) {
      console.error('[FeatureFlagsCache] Failed to sync from backend:', error);
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
      console.error('[FeatureFlagsCache] Failed to save to localStorage:', error);
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
        console.log('[FeatureFlagsCache] Loaded from localStorage', {
          flagCount: Object.keys(this.flags).length,
        });
      }
    } catch (error) {
      console.error('[FeatureFlagsCache] Failed to load from localStorage:', error);
    }
  }

  /**
   * Check if a feature flag is enabled (synchronous method)
   */
  public isEnabled(name: string): boolean {
    if (!this.initialized) {
      console.warn('[FeatureFlagsCache] Not initialized, returning false for', name);
      return false;
    }
    return this.flags[name] ?? false;
  }

  /**
   * Get all flags values
   */
  public getAllFlags(): FeatureFlagsValues {
    if (!this.initialized) {
      return {};
    }
    return { ...this.flags };
  }

  /**
   * Check if initialized
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
