// src/renderer/lib/models/ghcModels.ts
import { GhcCopilotModel } from '@shared/types/ghcChatTypes';
import { modelCacheManager } from './modelCacheManager';

/**
 * Frontend model access layer
 *
 * Architecture notes:
 * - This file no longer defines model data directly; it reads from modelCacheManager
 * - The backend (Main Process) is the single source of truth for model data
 * - The frontend caches via localStorage and auto-syncs on app startup
 * - All functions maintain backward compatibility; the public API is unchanged
 */

/**
 * Get all GitHub Copilot models
 * @deprecated Internal implementation changed to read from cache; public API unchanged
 */
export function getAllModels(): GhcCopilotModel[] {
  return modelCacheManager.getAllModels();
}

/**
 * Get the list of models used by OpenKosmos
 */
export function getAllOpenKosmosUsedModels(): GhcCopilotModel[] {
  return modelCacheManager.getAllOpenKosmosUsedModels();
}

/**
 * Get a single model by ID
 */
export function getModelById(modelId: string): GhcCopilotModel | undefined {
  return modelCacheManager.getModelById(modelId);
}

/**
 * Get model capability information
 */
export function getModelCapabilities(modelId: string) {
  return modelCacheManager.getModelCapabilities(modelId);
}

/**
 * Validate whether a model ID is valid
 */
export function validateModelId(modelId: string): boolean {
  return modelCacheManager.validateModelId(modelId);
}

/**
 * Get the default model ID
 */
export function getDefaultModel(): string {
  return modelCacheManager.getDefaultModel();
}

/**
 * Check if a model is a reasoning model
 */
export function isReasoningModel(modelId: string): boolean {
  return modelCacheManager.isReasoningModel(modelId);
}

/**
 * Model categories for UI organization
 * Note: These categories are static and do not need to be synced from the backend
 */
export const MODEL_CATEGORIES = {
  claude: ['claude-sonnet-4', 'claude-sonnet-4.5', 'claude-sonnet-4.6', 'claude-haiku-4.5', 'claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-4.6-1m', 'claude-opus-41'],
  gpt: ['gpt-4.1', 'gpt-5', 'gpt-4o', 'gpt-5.2', 'gpt-5.1-codex-max', 'gpt-5.2-codex', 'gpt-5.3-codex', 'gpt-5.1-codex-mini'],
  gemini: ['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  reasoning: ['o3-mini', 'o3', 'o4-mini']
};

/**
 * Get models by category
 */
export function getModelsByCategory(category: keyof typeof MODEL_CATEGORIES): GhcCopilotModel[] {
  const modelIds = MODEL_CATEGORIES[category];
  return modelIds.map(id => getModelById(id)).filter(Boolean) as GhcCopilotModel[];
}

// ============================================================================
// Backward compatibility - legacy GhcModel format conversion functions
// ============================================================================

/**
 * @deprecated Use the new GhcCopilotModel format
 * This function is only for backward compatibility with legacy code
 */
export function getLegacyModels(): any[] {
  return getAllOpenKosmosUsedModels().map(convertToLegacyModel);
}

/**
 * Convert GhcCopilotModel to the legacy GhcModel format
 * @deprecated Only for backward compatibility
 */
function convertToLegacyModel(copilotModel: GhcCopilotModel): any {
  return {
    id: copilotModel.id,
    name: copilotModel.name,
    attachment: copilotModel.capabilities.supports.vision || false,
    reasoning: copilotModel.capabilities.family.includes('o3') || copilotModel.capabilities.family.includes('o4'),
    temperature: !copilotModel.capabilities.family.includes('o3') && !copilotModel.capabilities.family.includes('o4'),
    tool_call: copilotModel.capabilities.supports.tool_calls || false,
    knowledge: '2024-04',
    release_date: '2025-01-01',
    last_updated: '2025-01-01',
    modalities: {
      input: copilotModel.capabilities.supports.vision ? ['text', 'image'] : ['text'],
      output: ['text']
    },
    open_weights: false,
    limit: {
      context: copilotModel.capabilities.limits?.max_context_window_tokens || 0,
      output: copilotModel.capabilities.limits?.max_output_tokens || 0
    }
  };
}

// ============================================================================
// Exported constants - for external reference
// ============================================================================

/**
 * @deprecated Import directly from backend; frontend no longer maintains a full model list
 * Use getAllModels() or getAllOpenKosmosUsedModels() instead
 */
export const GITHUB_COPILOT_MODELS: GhcCopilotModel[] = [];

// Note: GITHUB_COPILOT_MODELS is deprecated. Use getAllModels() or getAllOpenKosmosUsedModels() instead
