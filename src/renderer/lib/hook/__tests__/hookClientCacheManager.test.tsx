/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the concrete hookClientCacheManager singleton and useHooks
 * hook (sidecar renderer-normalization Phase 2b). Drives the closures (pull /
 * subscribeRaw / extractItems) via a window.electronAPI stub, covering both the
 * API-present and API-absent (optional-chain) arms.
 */

import { vi, describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

let capturedHandler: ((payload: any) => void) | null;

function setupAPI(present: boolean, pullResult?: any) {
  capturedHandler = null;
  const profile: any = {};
  if (present) {
    profile.getHooksForAlias = vi.fn(async () => pullResult ?? { success: true, data: [] });
    profile.onHooksChanged = vi.fn((cb: any) => {
      capturedHandler = cb;
      return vi.fn();
    });
  }
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { profile },
  });
}

const hookX = { id: 'h1', name: 'X', version: '1', source: 'ON-DEVICE', enabled: true } as any;
const hookY = { id: 'h2', name: 'Y', version: '1', source: 'IN-LIBRARY', enabled: false } as any;

async function freshManager() {
  vi.resetModules();
  return import('../hookClientCacheManager');
}

describe('hookClientCacheManager', () => {
  it('pulls and hydrates on initialize (extractItems via result.data)', async () => {
    setupAPI(true, { success: true, data: [hookX, hookY] });
    const { hookClientCacheManager } = await freshManager();
    await hookClientCacheManager.initialize('alice');
    expect(hookClientCacheManager.getItems()).toEqual([hookX, hookY]);
    expect(window.electronAPI.profile.getHooksForAlias).toHaveBeenCalledWith('alice');
  });

  it('replaces on a hooks:changed push (extractItems via payload.hooks)', async () => {
    setupAPI(true);
    const { hookClientCacheManager } = await freshManager();
    await hookClientCacheManager.initialize('alice');
    capturedHandler!({ alias: 'alice', hooks: [hookX], timestamp: 1 });
    expect(hookClientCacheManager.getItems()).toEqual([hookX]);
  });

  it('tolerates a missing electronAPI (optional-chain false arms)', async () => {
    setupAPI(false);
    const { hookClientCacheManager } = await freshManager();
    await hookClientCacheManager.initialize('alice');
    expect(hookClientCacheManager.getCache().isInitialized).toBe(true);
    expect(hookClientCacheManager.getItems()).toEqual([]);
  });

  it('useHooks() returns cached hooks, else the fallback', async () => {
    setupAPI(true);
    const { hookClientCacheManager } = await freshManager();
    const { useHooks } = await import('../useHooks');

    const cold = renderHook(() => useHooks([hookY]));
    expect(cold.result.current).toEqual([hookY]);

    await hookClientCacheManager.initialize('alice');
    capturedHandler!({ alias: 'alice', hooks: [hookX] });
    const warm = renderHook(() => useHooks([hookY]));
    expect(warm.result.current).toEqual([hookX]);
    expect(hookClientCacheManager.getItems()).toEqual([hookX]);
  });
});
