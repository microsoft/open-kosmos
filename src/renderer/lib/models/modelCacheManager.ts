/**
 * Model Cache Manager
 *
 * Architecture notes:
 * - The backend (Main Process) is the single source of truth for model data
 * - Uses passive sync mode: after backend initialization, it notifies the frontend via models:updated event
 * - Upon receiving the notification, the frontend fetches the latest model data and caches in-memory
 * - No localStorage is used — data is always freshly synced from the backend on each app launch
 */

import { GhcCopilotModel } from '@shared/types/ghcChatTypes';
import { createLogger } from '../utilities/logger';
const logger = createLogger('[ModelCacheManager]');

export class ModelCacheManager {
  private static instance: ModelCacheManager;
  private allModels: GhcCopilotModel[] = [];
  private openkosmosUsedModels: GhcCopilotModel[] = [];
  private defaultModel: string = 'claude-opus-4.6'; // Fallback default value
  private initialized: boolean = false;
  private unsubscribe: (() => void) | null = null;

  private constructor() {
    // Set up IPC listeners immediately so we never miss a backend push
    this.registerBackendListener();
  }

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
   * Initialize cache manager (passive sync mode)
   *
   * Registers backend listener and waits for models:updated push from backend.
   * No localStorage — data lives only in memory and is always fresh.
   */
  public initialize(): void {
    if (this.initialized) {
      logger.debug('[ModelCache] Already initialized, skipping...');
      return;
    }

    logger.debug('[ModelCache] Initializing model cache manager (in-memory only, passive sync mode)...');

    this.initialized = true;
    logger.debug('[ModelCache] Initialization complete (waiting for backend notification)');
  }

  /**
   * Register backend models:updated event listener
   * Backend pushes this event when model data is ready; frontend auto-syncs upon receiving it
   */
  private registerBackendListener(): void {
    /* c8 ignore next 3 -- unsubscribe guard is defensive; registerBackendListener is only called once from constructor */
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    try {
      this.unsubscribe = window.electronAPI.models.onModelsUpdated((data) => {
        logger.debug('[ModelCache] Received models:updated notification from backend', data);
        // Received backend notification, async fetch latest data
        this.syncFromBackend().catch((error) => {
          logger.error('[ModelCache] Failed to sync after backend notification:', error);
        });
      });
      logger.debug('[ModelCache] Registered models:updated listener');
    } catch (error) {
      logger.error('[ModelCache] Failed to register backend listener:', error);
    }
  }

  /**
   * Sync latest model data from backend
   */
  public async syncFromBackend(): Promise<void> {
    logger.debug('[ModelCache] Syncing models from backend...');

    try {
      // Fetch all models
      const allModelsResult = await window.electronAPI.models.getAllModels();
      if (!allModelsResult.success) {
        throw new Error(allModelsResult.error || 'Failed to fetch all models');
      }

      // Fetch OpenKosmos-used models
      const openkosmosModelsResult = await window.electronAPI.models.getAllOpenKosmosUsedModels();
      if (!openkosmosModelsResult.success) {
        throw new Error(openkosmosModelsResult.error || 'Failed to fetch OpenKosmos models');
      }

      // Fetch default model
      const defaultModelResult = await window.electronAPI.models.getDefaultModel();
      if (defaultModelResult.success && defaultModelResult.data) {
        this.defaultModel = defaultModelResult.data;
      }

      // Update in-memory cache
      this.allModels = allModelsResult.data || [];
      this.openkosmosUsedModels = openkosmosModelsResult.data || [];

      logger.debug('[ModelCache] Successfully synced models from backend', {
        allModels: this.allModels.length,
        openkosmosModels: this.openkosmosUsedModels.length
      });

      // Dispatch custom event to notify UI components that model data has been updated
      window.dispatchEvent(new CustomEvent('modelCacheUpdated', {
        detail: {
          allModelsCount: this.allModels.length,
          openkosmosModelsCount: this.openkosmosUsedModels.length,
          timestamp: Date.now()
        }
      }));
    } catch (error) {
      logger.error('[ModelCache] Failed to sync from backend:', error);
      throw error;
    }
  }

  /**
   * Get all GitHub Copilot models
   */
  public getAllModels(): GhcCopilotModel[] {
    return this.allModels;
  }

  /**
   * Get the list of models used by OpenKosmos
   */
  public getAllOpenKosmosUsedModels(): GhcCopilotModel[] {
    return this.openkosmosUsedModels;
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

    const rawEfforts = model.capabilities.supports.reasoning_effort;
    const reasoningEfforts: string[] = Array.isArray(rawEfforts)
      ? Array.from(new Set(
          rawEfforts
            .filter((e): e is string => typeof e === 'string' && e.length > 0)
            .map(e => e.toLowerCase())
        ))
      : [];
    const supportsReasoning = reasoningEfforts.length > 0
      || model.capabilities.family.includes('o3')
      || model.capabilities.family.includes('o4');

    return {
      supportsStreaming: model.capabilities.supports.streaming || false,
      supportsTools: model.capabilities.supports.tool_calls || false,
      supportsImages: model.capabilities.supports.vision || false,
      supportsAudio: false,
      supportsVideo: false,
      supportsReasoning,
      reasoningEfforts: reasoningEfforts.length > 0 ? reasoningEfforts : undefined,
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
   * Check if a model is a reasoning model.
   * Stays consistent with getModelCapabilities().supportsReasoning, which also
   * accounts for models exposing `reasoning_effort` (GPT-5, Claude, Gemini, ...).
   */
  public isReasoningModel(modelId: string): boolean {
    return this.getModelCapabilities(modelId)?.supportsReasoning ?? false;
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
    this.allModels = [];
    this.openkosmosUsedModels = [];
    this.defaultModel = 'claude-opus-4.6';
    this.initialized = false;
    logger.debug('[ModelCache] Cache cleared');
  }

  /**
   * Dispose: unregister event listeners
   */
  public dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      logger.debug('[ModelCache] Disposed backend listener');
    }
  }

  /**
   * Get cache status information
   */
  public getCacheInfo() {
    return {
      initialized: this.initialized,
      allModelsCount: this.allModels.length,
      openkosmosModelsCount: this.openkosmosUsedModels.length,
      defaultModel: this.defaultModel
    };
  }
}

// Export singleton instance
export const modelCacheManager = ModelCacheManager.getInstance();
