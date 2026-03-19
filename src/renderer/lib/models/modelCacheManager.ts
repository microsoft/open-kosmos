/**
 * Model cache manager
 * 
 * Architecture notes:
 * - The backend (Main Process) is the single source of truth for model data
 * - The frontend caches model data via localStorage to reduce IPC calls
 * - On each app startup, the latest model data is automatically synced from the backend
 * - Provides a type-safe API to access cached model data
 */

import { GhcCopilotModel } from '../../../main/lib/types/ghcChatTypes';
import { BRAND_NAME } from '@shared/constants/branding';

const STORAGE_KEY = `${BRAND_NAME}_ghc_models_cache`;
const CACHE_VERSION_KEY = `${BRAND_NAME}_ghc_models_cache_version`;
const CURRENT_CACHE_VERSION = '1.0';

export class ModelCacheManager {
  private static instance: ModelCacheManager;
  private allModels: GhcCopilotModel[] = [];
  private kosmosUsedModels: GhcCopilotModel[] = [];
  private defaultModel: string = 'claude-opus-4.6'; // fallback default value
  private initialized: boolean = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): ModelCacheManager {
    if (!ModelCacheManager.instance) {
      ModelCacheManager.instance = new ModelCacheManager();
    }
    return ModelCacheManager.instance;
  }

  /**
   * Initialize the cache manager
   * Should be called at app startup to sync the latest model data from the backend
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[ModelCache] Already initialized, skipping...');
      return;
    }

    console.log('[ModelCache] Initializing model cache manager...');

    try {
      // Check cache version
      const cachedVersion = localStorage.getItem(CACHE_VERSION_KEY);
      const needsUpdate = cachedVersion !== CURRENT_CACHE_VERSION;

      if (needsUpdate) {
        console.log('[ModelCache] Cache version mismatch, clearing old cache...');
        localStorage.removeItem(STORAGE_KEY);
      }

      // Fetch the latest model data from the backend
      await this.syncFromBackend();

      // Update cache version
      localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);

      this.initialized = true;
      console.log('[ModelCache] Initialization complete');
    } catch (error) {
      console.error('[ModelCache] Initialization failed:', error);
      // If sync fails, try loading old cache from localStorage
      this.loadFromLocalStorage();
      this.initialized = true; // Mark as initialized even if using old cache
    }
  }

  /**
   * Sync the latest model data from the backend
   */
  public async syncFromBackend(): Promise<void> {
    console.log('[ModelCache] Syncing models from backend...');

    try {
      // Get all models
      const allModelsResult = await window.electronAPI.models.getAllModels();
      if (!allModelsResult.success) {
        throw new Error(allModelsResult.error || 'Failed to fetch all models');
      }

      // Get Kosmos-used models
      const kosmosModelsResult = await window.electronAPI.models.getAllKosmosUsedModels();
      if (!kosmosModelsResult.success) {
        throw new Error(kosmosModelsResult.error || 'Failed to fetch Kosmos models');
      }

      // Get default model
      const defaultModelResult = await window.electronAPI.models.getDefaultModel();
      if (defaultModelResult.success && defaultModelResult.data) {
        this.defaultModel = defaultModelResult.data;
      }

      // Update in-memory cache
      this.allModels = allModelsResult.data || [];
      this.kosmosUsedModels = kosmosModelsResult.data || [];

      // Save to localStorage
      this.saveToLocalStorage();

      console.log('[ModelCache] Successfully synced models from backend', {
        allModels: this.allModels.length,
        kosmosModels: this.kosmosUsedModels.length
      });
    } catch (error) {
      console.error('[ModelCache] Failed to sync from backend:', error);
      throw error;
    }
  }

  /**
   * Save model data to localStorage
   */
  private saveToLocalStorage(): void {
    try {
      const cacheData = {
        allModels: this.allModels,
        kosmosUsedModels: this.kosmosUsedModels,
        defaultModel: this.defaultModel,
        timestamp: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheData));
      console.log('[ModelCache] Saved to localStorage');
    } catch (error) {
      console.error('[ModelCache] Failed to save to localStorage:', error);
    }
  }

  /**
   * Load model data from localStorage
   */
  private loadFromLocalStorage(): void {
    try {
      const cachedData = localStorage.getItem(STORAGE_KEY);
      if (cachedData) {
        const parsedData = JSON.parse(cachedData);
        this.allModels = parsedData.allModels || [];
        this.kosmosUsedModels = parsedData.kosmosUsedModels || [];
        this.defaultModel = parsedData.defaultModel || 'claude-opus-4.6';
        console.log('[ModelCache] Loaded from localStorage', {
          allModels: this.allModels.length,
          kosmosModels: this.kosmosUsedModels.length,
          defaultModel: this.defaultModel,
          timestamp: parsedData.timestamp
        });
      } else {
        console.warn('[ModelCache] No cached data found in localStorage');
      }
    } catch (error) {
      console.error('[ModelCache] Failed to load from localStorage:', error);
    }
  }

  /**
   * Get all GitHub Copilot models
   */
  public getAllModels(): GhcCopilotModel[] {
    if (!this.initialized) {
      console.warn('[ModelCache] Not initialized, returning empty array');
      return [];
    }
    return this.allModels;
  }

  /**
   * Get the list of models used by Kosmos
   */
  public getAllKosmosUsedModels(): GhcCopilotModel[] {
    if (!this.initialized) {
      console.warn('[ModelCache] Not initialized, returning empty array');
      return [];
    }
    return this.kosmosUsedModels;
  }

  /**
   * Get a single model by ID
   */
  public getModelById(modelId: string): GhcCopilotModel | undefined {
    return this.allModels.find(model => model.id === modelId);
  }

  /**
   * Get model capability information
   */
  public getModelCapabilities(modelId: string) {
    const model = this.getModelById(modelId);
    if (!model) return null;

    return {
      supportsStreaming: model.capabilities.supports.streaming || false,
      supportsTools: model.capabilities.supports.tool_calls || false,
      supportsImages: model.capabilities.supports.vision || false,
      supportsAudio: false,
      supportsVideo: false,
      supportsReasoning: model.capabilities.family.includes('o3') || model.capabilities.family.includes('o4'),
      maxContextLength: model.capabilities.limits?.max_context_window_tokens || 0,
      maxOutputLength: model.capabilities.limits?.max_output_tokens || 0,
      supportsTemperature: !model.capabilities.family.includes('o3') && !model.capabilities.family.includes('o4'),
      supportsAttachments: model.capabilities.supports.vision || false
    };
  }

  /**
   * Validate whether a model ID is valid
   */
  public validateModelId(modelId: string): boolean {
    return this.allModels.some(model => model.id === modelId);
  }

  /**
   * Determine if a model is a reasoning model
   */
  public isReasoningModel(modelId: string): boolean {
    const model = this.getModelById(modelId);
    return model ? (model.capabilities.family.includes('o3') || model.capabilities.family.includes('o4')) : false;
  }

  /**
   * Get the default model ID (synced from backend ghcModels)
   */
  public getDefaultModel(): string {
    return this.defaultModel;
  }

  /**
   * Clear cache (for debugging or reset)
   */
  public clearCache(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CACHE_VERSION_KEY);
    this.allModels = [];
    this.kosmosUsedModels = [];
    this.defaultModel = 'claude-opus-4.6';
    this.initialized = false;
    console.log('[ModelCache] Cache cleared');
  }

  /**
   * Get cache status information
   */
  public getCacheInfo() {
    const cachedData = localStorage.getItem(STORAGE_KEY);
    const cacheVersion = localStorage.getItem(CACHE_VERSION_KEY);
    
    return {
      initialized: this.initialized,
      cacheVersion,
      currentVersion: CURRENT_CACHE_VERSION,
      allModelsCount: this.allModels.length,
      kosmosModelsCount: this.kosmosUsedModels.length,
      defaultModel: this.defaultModel,
      hasCachedData: !!cachedData,
      timestamp: cachedData ? JSON.parse(cachedData).timestamp : null
    };
  }
}

// Export singleton instance
export const modelCacheManager = ModelCacheManager.getInstance();