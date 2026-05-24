/** @vitest-environment happy-dom */

/**
 * ghcModels unit tests
 *
 * ghcModels.ts is a thin delegation layer over modelCacheManager.
 * We control the cache by calling modelCacheManager methods directly.
 */

import {
  getAllModels,
  getAllOpenKosmosUsedModels,
  getModelById,
  getModelCapabilities,
  validateModelId,
  getDefaultModel,
  isReasoningModel,
  getLegacyModels,
  getModelsByCategory,
  MODEL_CATEGORIES,
  GITHUB_COPILOT_MODELS,
} from '../ghcModels';
import { modelCacheManager } from '../modelCacheManager';
import type { GhcCopilotModel } from '@shared/types/ghcChatTypes';

// ---------------------------------------------------------------------------
// Shared helper
// ---------------------------------------------------------------------------

function makeModel(overrides: Partial<GhcCopilotModel> = {}): GhcCopilotModel {
  return {
    id: 'test-model',
    name: 'Test Model',
    vendor: 'test',
    version: '1.0',
    object: 'model',
    preview: false,
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: true,
    billing: { is_premium: false, multiplier: 1 },
    capabilities: {
      family: 'gpt-4',
      object: 'model_capabilities',
      tokenizer: 'cl100k_base',
      type: 'chat',
      supports: {
        streaming: true,
        tool_calls: true,
        vision: true,
      },
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
      },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  (window as any).electronAPI = {
    models: {
      onModelsUpdated: vi.fn(() => () => {}),
      getAllModels: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getAllOpenKosmosUsedModels: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getDefaultModel: vi.fn().mockResolvedValue({ success: true, data: 'claude-opus-4.6' }),
    },
  };

  // Reset cache state without replacing the singleton (ghcModels.ts holds a reference to the exported singleton)
  modelCacheManager.clearCache();
});

afterEach(() => {
  delete (window as any).electronAPI;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ghcModels', () => {
  describe('getAllModels', () => {
    it('returns empty array when cache is empty', () => {
      expect(getAllModels()).toEqual([]);
    });

    it('returns models after cache is populated', async () => {
      const models = [makeModel({ id: 'a' }), makeModel({ id: 'b' })];
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: models });
      await modelCacheManager.syncFromBackend();
      expect(getAllModels()).toHaveLength(2);
    });
  });

  describe('getAllOpenKosmosUsedModels', () => {
    it('returns empty array initially', () => {
      expect(getAllOpenKosmosUsedModels()).toEqual([]);
    });

    it('returns openkosmos models after sync', async () => {
      const models = [makeModel({ id: 'openkosmos-1' })];
      (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: true, data: models });
      await modelCacheManager.syncFromBackend();
      expect(getAllOpenKosmosUsedModels()).toEqual(models);
    });
  });

  describe('getModelById', () => {
    it('returns undefined for unknown model', () => {
      expect(getModelById('unknown')).toBeUndefined();
    });

    it('finds model by id', async () => {
      const m = makeModel({ id: 'my-model' });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await modelCacheManager.syncFromBackend();
      expect(getModelById('my-model')).toEqual(m);
    });
  });

  describe('getModelCapabilities', () => {
    it('returns null for unknown model', () => {
      expect(getModelCapabilities('ghost')).toBeNull();
    });

    it('returns capabilities for known model', async () => {
      const m = makeModel({ id: 'cap-model' });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await modelCacheManager.syncFromBackend();
      const caps = getModelCapabilities('cap-model');
      expect(caps).not.toBeNull();
      expect(caps?.supportsImages).toBe(true);
    });
  });

  describe('validateModelId', () => {
    it('returns false for empty cache', () => {
      expect(validateModelId('anything')).toBe(false);
    });

    it('returns true for a model in the cache', async () => {
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [makeModel({ id: 'valid' })] });
      await modelCacheManager.syncFromBackend();
      expect(validateModelId('valid')).toBe(true);
    });
  });

  describe('getDefaultModel', () => {
    it('returns default fallback before sync', () => {
      expect(getDefaultModel()).toBe('claude-opus-4.6');
    });

    it('returns backend-provided default after sync', async () => {
      (window as any).electronAPI.models.getDefaultModel.mockResolvedValue({ success: true, data: 'gpt-4.1' });
      await modelCacheManager.syncFromBackend();
      expect(getDefaultModel()).toBe('gpt-4.1');
    });
  });

  describe('isReasoningModel', () => {
    it('returns false for unknown model', () => {
      expect(isReasoningModel('unknown')).toBe(false);
    });

    it('returns true for o3-family model', async () => {
      const m = makeModel({ id: 'o3', capabilities: { ...makeModel().capabilities, family: 'o3' } });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await modelCacheManager.syncFromBackend();
      expect(isReasoningModel('o3')).toBe(true);
    });
  });

  describe('getLegacyModels', () => {
    it('returns empty array when no openkosmos models', () => {
      expect(getLegacyModels()).toEqual([]);
    });

    it('converts GhcCopilotModel to legacy format', async () => {
      const m = makeModel({ id: 'legacy-test', name: 'Legacy' });
      (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: true, data: [m] });
      await modelCacheManager.syncFromBackend();

      const legacy = getLegacyModels();
      expect(legacy).toHaveLength(1);
      expect(legacy[0].id).toBe('legacy-test');
      expect(legacy[0].name).toBe('Legacy');
      expect(legacy[0].attachment).toBe(true); // vision: true
      expect(legacy[0].reasoning).toBe(false);
      expect(legacy[0].tool_call).toBe(true);
      expect(legacy[0].modalities.input).toContain('image');
    });

    it('marks o3-family model as reasoning in legacy format', async () => {
      const m = makeModel({
        id: 'o3-legacy',
        capabilities: { ...makeModel().capabilities, family: 'o3', supports: { tool_calls: false, vision: false } },
      });
      (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: true, data: [m] });
      await modelCacheManager.syncFromBackend();

      const legacy = getLegacyModels();
      expect(legacy[0].reasoning).toBe(true);
      expect(legacy[0].temperature).toBe(false);
    });
  });

  describe('getModelsByCategory', () => {
    it('returns empty array when cache is empty', () => {
      expect(getModelsByCategory('claude')).toEqual([]);
    });

    it('returns models matching the category', async () => {
      const claudeModel = makeModel({ id: 'claude-sonnet-4', name: 'Claude Sonnet 4' });
      const gptModel = makeModel({ id: 'gpt-4.1', name: 'GPT-4.1' });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({
        success: true,
        data: [claudeModel, gptModel],
      });
      await modelCacheManager.syncFromBackend();

      const claudeModels = getModelsByCategory('claude');
      expect(claudeModels.some(m => m.id === 'claude-sonnet-4')).toBe(true);
      expect(claudeModels.some(m => m.id === 'gpt-4.1')).toBe(false);
    });

    it('returns models for all categories', async () => {
      const categories = Object.keys(MODEL_CATEGORIES) as Array<keyof typeof MODEL_CATEGORIES>;
      for (const cat of categories) {
        expect(() => getModelsByCategory(cat)).not.toThrow();
      }
    });
  });

  describe('GITHUB_COPILOT_MODELS', () => {
    it('is an empty array (deprecated constant)', () => {
      expect(GITHUB_COPILOT_MODELS).toEqual([]);
    });
  });
});
