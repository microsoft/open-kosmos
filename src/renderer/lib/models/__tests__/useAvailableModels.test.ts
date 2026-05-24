/** @vitest-environment happy-dom */

/**
 * useAvailableModels hook unit tests
 */

import { renderHook, act } from '@testing-library/react';
import { useAvailableModels } from '../useAvailableModels';
import * as ghcModels from '../ghcModels';
import type { GhcCopilotModel } from '@shared/types/ghcChatTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModel(id: string): GhcCopilotModel {
  return {
    id,
    name: id,
    vendor: 'test',
    version: '1.0',
    object: 'model',
    preview: false,
    is_chat_default: false,
    is_chat_fallback: false,
    model_picker_enabled: true,
    billing: { is_premium: false, multiplier: 1 },
    capabilities: {
      family: 'test',
      object: 'model_capabilities',
      tokenizer: 'cl100k_base',
      type: 'chat',
      supports: { streaming: true, tool_calls: false, vision: false },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAvailableModels', () => {
  let getAllOpenKosmosUsedModelsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getAllOpenKosmosUsedModelsSpy = vi.spyOn(ghcModels, 'getAllOpenKosmosUsedModels').mockReturnValue([]);

    (window as any).electronAPI = {
      models: {
        getAllOpenKosmosUsedModels: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).electronAPI;
  });

  it('initializes with models from cache', () => {
    const models = [makeModel('a'), makeModel('b')];
    getAllOpenKosmosUsedModelsSpy.mockReturnValue(models);

    const { result } = renderHook(() => useAvailableModels());
    expect(result.current.models).toEqual(models);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when getAllOpenKosmosUsedModels throws during initialization', () => {
    getAllOpenKosmosUsedModelsSpy.mockImplementation(() => { throw new Error('cache error'); });

    const { result } = renderHook(() => useAvailableModels());
    expect(result.current.models).toEqual([]);
  });

  it('re-reads cache when modelCacheUpdated event fires', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    const { result } = renderHook(() => useAvailableModels());

    const newModels = [makeModel('new-model')];
    getAllOpenKosmosUsedModelsSpy.mockReturnValue(newModels);

    await act(async () => {
      window.dispatchEvent(new CustomEvent('modelCacheUpdated'));
    });

    expect(result.current.models).toEqual(newModels);
  });

  it('does NOT fetch from backend when cache is non-empty even with fetchOnEmpty: true', async () => {
    const models = [makeModel('existing')];
    getAllOpenKosmosUsedModelsSpy.mockReturnValue(models);

    renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => { await Promise.resolve(); });

    expect((window as any).electronAPI.models.getAllOpenKosmosUsedModels).not.toHaveBeenCalled();
  });

  it('fetches from backend when cache is empty and fetchOnEmpty: true', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    const backendModels = [makeModel('from-backend')];
    (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({
      success: true,
      data: backendModels,
    });

    const { result } = renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.models).toEqual(backendModels);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error when backend call fails', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({
      success: false,
      error: 'Backend unavailable',
    });

    const { result } = renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Backend unavailable');
    expect(result.current.models).toEqual([]);
  });

  it('sets generic error when backend call fails without error message', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({ success: false });

    const { result } = renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Failed to load models');
  });

  it('sets error when electronAPI.models is not available', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    delete (window as any).electronAPI.models;

    const { result } = renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Model list is not available yet');
  });

  it('does NOT fetch from backend when allowBackendFetch is false on manual refresh', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);

    const { result } = renderHook(() => useAvailableModels());

    await act(async () => {
      await result.current.refresh(false);
    });

    expect((window as any).electronAPI.models.getAllOpenKosmosUsedModels).not.toHaveBeenCalled();
  });

  it('fetches from backend on manual refresh with allowBackendFetch: true', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    const backendModels = [makeModel('manual-fetch')];
    (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockResolvedValue({
      success: true,
      data: backendModels,
    });

    const { result } = renderHook(() => useAvailableModels());

    await act(async () => {
      await result.current.refresh(true);
    });

    expect(result.current.models).toEqual(backendModels);
    expect(result.current.isLoading).toBe(false);
  });

  it('handles exception thrown during refresh', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.models).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('handles non-Error exception during refresh', async () => {
    getAllOpenKosmosUsedModelsSpy.mockReturnValue([]);
    (window as any).electronAPI.models.getAllOpenKosmosUsedModels.mockRejectedValue('string error');

    const { result } = renderHook(() => useAvailableModels({ fetchOnEmpty: true }));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.error).toBe('Failed to load models');
  });

  it('unregisters modelCacheUpdated listener on unmount', async () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useAvailableModels());

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('modelCacheUpdated', expect.any(Function));
  });
});
