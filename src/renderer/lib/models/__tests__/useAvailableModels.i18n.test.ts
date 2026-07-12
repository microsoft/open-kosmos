/** @vitest-environment happy-dom */

import { act, renderHook } from '@testing-library/react';
import { useAvailableModels } from '../useAvailableModels';
import * as ghcModels from '../ghcModels';

const i18nState = vi.hoisted(() => ({
  t: ((key: string) => key) as (key: string, params?: Record<string, unknown>) => string,
}));

vi.mock('../../i18n/useI18n', () => ({
  useI18n: () => ({ language: 'en', setLanguage: vi.fn(), t: i18nState.t }),
}));

describe('useAvailableModels i18n stability', () => {
  let getAllOpenKosmosUsedModelsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.t = (key: string) => key;
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

  it('does not re-read the model cache when only the active language changes', async () => {
    const { rerender } = renderHook(() => useAvailableModels());

    await act(async () => {
      await Promise.resolve();
    });
    const callsAfterMount = getAllOpenKosmosUsedModelsSpy.mock.calls.length;

    i18nState.t = (key: string) => `zh:${key}`;
    rerender();

    await act(async () => {
      await Promise.resolve();
    });
    expect(getAllOpenKosmosUsedModelsSpy).toHaveBeenCalledTimes(callsAfterMount);
  });
});
