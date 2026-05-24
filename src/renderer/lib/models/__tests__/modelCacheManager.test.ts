/** @vitest-environment happy-dom */

/**
 * ModelCacheManager unit tests
 *
 * The singleton is reset between tests by calling clearCache() and patching
 * window.electronAPI to control IPC responses.
 */

import { ModelCacheManager } from '../modelCacheManager';
import type { GhcCopilotModel } from '@shared/types/ghcChatTypes';

// ---------------------------------------------------------------------------
// Helpers
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
      family: 'test-family',
      object: 'model_capabilities',
      tokenizer: 'cl100k_base',
      type: 'chat',
      supports: {
        streaming: true,
        tool_calls: true,
        vision: false,
      },
      limits: {
        max_context_window_tokens: 128000,
        max_output_tokens: 4096,
      },
    },
    ...overrides,
  };
}

function makeReasoningModel(id: string, family: string): GhcCopilotModel {
  return makeModel({
    id,
    name: id,
    capabilities: {
      family,
      object: 'model_capabilities',
      tokenizer: 'cl100k_base',
      type: 'chat',
      supports: {
        streaming: true,
        tool_calls: false,
        vision: false,
        reasoning_effort: ['low', 'medium', 'high'],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ModelCacheManager', () => {
  let manager: ModelCacheManager;
  let onModelsUpdatedCallback: ((data: any) => void) | null = null;

  beforeEach(() => {
    onModelsUpdatedCallback = null;

    (window as any).electronAPI = {
      models: {
        onModelsUpdated: vi.fn((cb: (data: any) => void) => {
          onModelsUpdatedCallback = cb;
          return () => { onModelsUpdatedCallback = null; };
        }),
        getAllModels: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getAllOpenKosmosUsedModels: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getDefaultModel: vi.fn().mockResolvedValue({ success: true, data: 'claude-opus-4.6' }),
      },
    };

    // Reset singleton so each test starts fresh
    (ModelCacheManager as any).instance = null;
    manager = ModelCacheManager.getInstance();
  });

  afterEach(() => {
    manager.dispose();
    delete (window as any).electronAPI;
  });

  // ── Singleton ──────────────────────────────────────────────────────────────
  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = ModelCacheManager.getInstance();
      const b = ModelCacheManager.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── initialize ─────────────────────────────────────────────────────────────
  describe('initialize', () => {
    it('sets initialized flag', () => {
      manager.initialize();
      expect(manager.getCacheInfo().initialized).toBe(true);
    });

    it('is idempotent — calling twice does not throw', () => {
      manager.initialize();
      expect(() => manager.initialize()).not.toThrow();
    });
  });

  // ── syncFromBackend ────────────────────────────────────────────────────────
  describe('syncFromBackend', () => {
    it('populates allModels and openkosmosModels from backend', async () => {
      const models = [makeModel({ id: 'model-a' }), makeModel({ id: 'model-b' })];
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: models });
      (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: true, data: [models[0]] });

      await manager.syncFromBackend();

      expect(manager.getAllModels()).toHaveLength(2);
      expect(manager.getAllOpenKosmosUsedModels()).toHaveLength(1);
    });

    it('updates defaultModel when backend returns one', async () => {
      (window as any).electronAPI.models.getDefaultModel.mockResolvedValue({ success: true, data: 'gpt-4.1' });
      await manager.syncFromBackend();
      expect(manager.getDefaultModel()).toBe('gpt-4.1');
    });

    it('keeps existing defaultModel when backend getDefaultModel fails', async () => {
      (window as any).electronAPI.models.getDefaultModel.mockResolvedValue({ success: false });
      await manager.syncFromBackend();
      expect(manager.getDefaultModel()).toBe('claude-opus-4.6');
    });

    it('dispatches modelCacheUpdated window event after sync', async () => {
      const handler = vi.fn();
      window.addEventListener('modelCacheUpdated', handler);
      await manager.syncFromBackend();
      window.removeEventListener('modelCacheUpdated', handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws when getAllModels returns success: false', async () => {
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: false, error: 'IPC error' });
      await expect(manager.syncFromBackend()).rejects.toThrow('IPC error');
    });

    it('throws when getAllOpenKosmosUsedModels returns success: false', async () => {
      (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: false, error: 'OpenKosmosError' });
      await expect(manager.syncFromBackend()).rejects.toThrow('OpenKosmosError');
    });
  });

  // ── registerBackendListener ────────────────────────────────────────────────
  describe('backend listener', () => {
    it('calls syncFromBackend when models:updated event fires', async () => {
      const syncSpy = vi.spyOn(manager, 'syncFromBackend').mockResolvedValue();
      onModelsUpdatedCallback?.({ reason: 'test' });
      // Allow microtask queue to flush
      await Promise.resolve();
      expect(syncSpy).toHaveBeenCalledTimes(1);
    });

    it('does not throw when registration fails (no electronAPI)', () => {
      delete (window as any).electronAPI;
      (ModelCacheManager as any).instance = null;
      expect(() => ModelCacheManager.getInstance()).not.toThrow();
    });

    it('logs error without throwing when syncFromBackend rejects inside the event callback', async () => {
      vi.spyOn(manager, 'syncFromBackend').mockRejectedValue(new Error('sync failed'));
      // Fire the event — the catch in registerBackendListener should swallow the error
      onModelsUpdatedCallback?.({});
      await new Promise(resolve => setTimeout(resolve, 0));
      // No unhandled rejection thrown — test passes if we reach here
    });
  });

  // ── getModelById ───────────────────────────────────────────────────────────
  describe('getModelById', () => {
    it('returns the correct model', async () => {
      const m = makeModel({ id: 'find-me' });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();
      expect(manager.getModelById('find-me')).toEqual(m);
    });

    it('returns undefined for unknown id', () => {
      expect(manager.getModelById('does-not-exist')).toBeUndefined();
    });
  });

  // ── validateModelId ────────────────────────────────────────────────────────
  describe('validateModelId', () => {
    it('returns true for a known model', async () => {
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [makeModel({ id: 'valid-id' })] });
      await manager.syncFromBackend();
      expect(manager.validateModelId('valid-id')).toBe(true);
    });

    it('returns false for an unknown model', () => {
      expect(manager.validateModelId('unknown')).toBe(false);
    });
  });

  // ── getModelCapabilities ───────────────────────────────────────────────────
  describe('getModelCapabilities', () => {
    it('returns null for unknown model', () => {
      expect(manager.getModelCapabilities('ghost')).toBeNull();
    });

    it('returns correct capabilities for a normal chat model', async () => {
      const m = makeModel({ id: 'chat-model' });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();

      const caps = manager.getModelCapabilities('chat-model');
      expect(caps).not.toBeNull();
      expect(caps?.supportsStreaming).toBe(true);
      expect(caps?.supportsTools).toBe(true);
      expect(caps?.supportsImages).toBe(false);
      expect(caps?.supportsReasoning).toBe(false);
      expect(caps?.supportsTemperature).toBe(true);
      expect(caps?.maxContextLength).toBe(128000);
      expect(caps?.maxOutputLength).toBe(4096);
    });

    it('detects reasoning via family name (o3)', async () => {
      const m = makeModel({ id: 'o3', capabilities: { ...makeModel().capabilities, family: 'o3' } });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();

      const caps = manager.getModelCapabilities('o3');
      expect(caps?.supportsReasoning).toBe(true);
      expect(caps?.supportsTemperature).toBe(false);
    });

    it('detects reasoning via family name (o4)', async () => {
      const m = makeModel({ id: 'o4-mini', capabilities: { ...makeModel().capabilities, family: 'o4' } });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();

      const caps = manager.getModelCapabilities('o4-mini');
      expect(caps?.supportsReasoning).toBe(true);
    });

    it('detects reasoning via reasoning_effort array', async () => {
      const m = makeReasoningModel('gpt-5', 'gpt-5');
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();

      const caps = manager.getModelCapabilities('gpt-5');
      expect(caps?.supportsReasoning).toBe(true);
      expect(caps?.reasoningEfforts).toEqual(['low', 'medium', 'high']);
    });

    it('deduplicates reasoning_effort values', async () => {
      const m = makeModel({
        id: 'dup-effort',
        capabilities: {
          ...makeModel().capabilities,
          supports: { reasoning_effort: ['high', 'HIGH', 'High'] },
        },
      });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();

      const caps = manager.getModelCapabilities('dup-effort');
      expect(caps?.reasoningEfforts).toEqual(['high']);
    });

    it('handles missing limits gracefully', async () => {
      const m = makeModel({ id: 'no-limits' });
      delete (m.capabilities as any).limits;
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();

      const caps = manager.getModelCapabilities('no-limits');
      expect(caps?.maxContextLength).toBe(0);
      expect(caps?.maxOutputLength).toBe(0);
    });
  });

  // ── isReasoningModel ───────────────────────────────────────────────────────
  describe('isReasoningModel', () => {
    it('returns false for unknown model', () => {
      expect(manager.isReasoningModel('unknown')).toBe(false);
    });

    it('returns true for o3-family model', async () => {
      const m = makeModel({ id: 'o3', capabilities: { ...makeModel().capabilities, family: 'o3' } });
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [m] });
      await manager.syncFromBackend();
      expect(manager.isReasoningModel('o3')).toBe(true);
    });
  });

  // ── clearCache ─────────────────────────────────────────────────────────────
  describe('clearCache', () => {
    it('resets all cache fields', async () => {
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: [makeModel()] });
      await manager.syncFromBackend();
      manager.initialize();

      manager.clearCache();
      const info = manager.getCacheInfo();
      expect(info.initialized).toBe(false);
      expect(info.allModelsCount).toBe(0);
      expect(info.openkosmosModelsCount).toBe(0);
      expect(info.defaultModel).toBe('claude-opus-4.6');
    });
  });

  // ── dispose ────────────────────────────────────────────────────────────────
  describe('dispose', () => {
    it('calls unsubscribe and nullifies it', () => {
      const unsubSpy = vi.fn();
      (window as any).electronAPI.models.onModelsUpdated.mockReturnValue(unsubSpy);
      (ModelCacheManager as any).instance = null;
      const fresh = ModelCacheManager.getInstance();

      fresh.dispose();
      expect(unsubSpy).toHaveBeenCalledTimes(1);

      // Calling dispose again is safe (no-op)
      expect(() => fresh.dispose()).not.toThrow();
    });
  });

  // ── getCacheInfo ───────────────────────────────────────────────────────────
  describe('getCacheInfo', () => {
    it('returns correct metadata', async () => {
      const models = [makeModel({ id: 'a' }), makeModel({ id: 'b' })];
      (window as any).electronAPI.models.getAllModels.mockResolvedValue({ success: true, data: models });
      (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: true, data: [models[0]] });
      manager.initialize();
      await manager.syncFromBackend();

      const info = manager.getCacheInfo();
      expect(info.initialized).toBe(true);
      expect(info.allModelsCount).toBe(2);
      expect(info.openkosmosModelsCount).toBe(1);
    });
  });
});
