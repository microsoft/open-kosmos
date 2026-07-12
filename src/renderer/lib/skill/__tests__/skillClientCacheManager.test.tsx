/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the concrete skillClientCacheManager singleton and useSkills
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
    profile.getSkillsForAlias = vi.fn(async () => pullResult ?? { success: true, data: [] });
    profile.onSkillsChanged = vi.fn((cb: any) => {
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

const skillX = { name: 'X', description: '', version: '1', source: 'ON-DEVICE' } as any;
const skillY = { name: 'Y', description: '', version: '1', source: 'IN-LIBRARY' } as any;

async function freshManager() {
  vi.resetModules();
  return import('../skillClientCacheManager');
}

describe('skillClientCacheManager', () => {
  it('pulls and hydrates on initialize (extractItems via result.data)', async () => {
    setupAPI(true, { success: true, data: [skillX, skillY] });
    const { skillClientCacheManager } = await freshManager();
    await skillClientCacheManager.initialize('alice');
    expect(skillClientCacheManager.getItems()).toEqual([skillX, skillY]);
    expect(window.electronAPI.profile.getSkillsForAlias).toHaveBeenCalledWith('alice');
  });

  it('replaces on a skills:changed push (extractItems via payload.skills)', async () => {
    setupAPI(true);
    const { skillClientCacheManager } = await freshManager();
    await skillClientCacheManager.initialize('alice');
    capturedHandler!({ alias: 'alice', skills: [skillX], timestamp: 1 });
    expect(skillClientCacheManager.getItems()).toEqual([skillX]);
  });

  it('tolerates a missing electronAPI (optional-chain false arms)', async () => {
    setupAPI(false);
    const { skillClientCacheManager } = await freshManager();
    await skillClientCacheManager.initialize('alice');
    expect(skillClientCacheManager.getCache().isInitialized).toBe(true);
    expect(skillClientCacheManager.getItems()).toEqual([]);
  });

  it('useSkills() returns cached skills, else the fallback', async () => {
    setupAPI(true);
    const { skillClientCacheManager } = await freshManager();
    const { useSkills } = await import('../useSkills');

    // Cold cache -> fallback.
    const cold = renderHook(() => useSkills([skillY]));
    expect(cold.result.current).toEqual([skillY]);

    // Warm cache -> cached items win.
    await skillClientCacheManager.initialize('alice');
    capturedHandler!({ alias: 'alice', skills: [skillX] });
    const warm = renderHook(() => useSkills([skillY]));
    expect(warm.result.current).toEqual([skillX]);
    expect(skillClientCacheManager.getItems()).toEqual([skillX]);
  });
});
