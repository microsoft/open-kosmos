// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utilities/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos'
}));

// Provide a simple in-memory localStorage stub so the module can use it
const makeLocalStorageStub = () => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
    _store: store
  };
};

let lsStub: ReturnType<typeof makeLocalStorageStub>;

// The module uses a singleton; import once so we can introspect state
import { featureFlagCacheManager, isFeatureEnabled, getAllFeatureFlags } from '../featureFlagCacheManager';

// Manually reset the singleton state between tests via private field manipulation
function resetSingleton() {
  // @ts-expect-error accessing private fields for test reset
  const inst = featureFlagCacheManager as any;
  inst.flags = {};
  inst.initialized = false;
  inst.initPromise = null;
}

describe('FeatureFlagCacheManager', () => {
  beforeEach(() => {
    lsStub = makeLocalStorageStub();
    vi.stubGlobal('localStorage', lsStub);
    resetSingleton();
    (window as any).electronAPI = undefined;
  });

  describe('before initialization', () => {
    it('isEnabled returns false for any flag', () => {
      expect(featureFlagCacheManager.isEnabled('someFlag')).toBe(false);
    });

    it('getAllFlags returns empty object', () => {
      expect(featureFlagCacheManager.getAllFlags()).toEqual({});
    });

    it('isInitialized is false', () => {
      expect(featureFlagCacheManager.isInitialized).toBe(false);
    });
  });

  describe('initialize', () => {
    it('syncs flags from backend and marks initialized', async () => {
      const mockFlags = { featureA: true, featureB: false };
      (window as any).electronAPI = {
        featureFlags: {
          getAllFlags: vi.fn().mockResolvedValue({ success: true, data: mockFlags })
        }
      };

      await featureFlagCacheManager.initialize();

      expect(featureFlagCacheManager.isInitialized).toBe(true);
      expect(featureFlagCacheManager.isEnabled('featureA')).toBe(true);
      expect(featureFlagCacheManager.isEnabled('featureB')).toBe(false);
      expect(featureFlagCacheManager.isEnabled('unknown')).toBe(false);
    });

    it('second call to initialize is a no-op', async () => {
      const getAllFlagsMock = vi.fn().mockResolvedValue({ success: true, data: { x: true } });
      (window as any).electronAPI = { featureFlags: { getAllFlags: getAllFlagsMock } };

      await featureFlagCacheManager.initialize();
      await featureFlagCacheManager.initialize();

      expect(getAllFlagsMock).toHaveBeenCalledTimes(1);
    });

    it('concurrent initialize calls deduplicate', async () => {
      const getAllFlagsMock = vi.fn().mockResolvedValue({ success: true, data: { x: true } });
      (window as any).electronAPI = { featureFlags: { getAllFlags: getAllFlagsMock } };

      await Promise.all([
        featureFlagCacheManager.initialize(),
        featureFlagCacheManager.initialize(),
        featureFlagCacheManager.initialize()
      ]);

      expect(getAllFlagsMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to localStorage on backend failure', async () => {
      // Pre-populate localStorage with cached flags
      lsStub.setItem(
        'openkosmos_feature_flags_cache',
        JSON.stringify({ flags: { cachedFlag: true }, timestamp: Date.now() })
      );
      lsStub.setItem('openkosmos_feature_flags_cache_version', '1.0');

      (window as any).electronAPI = {
        featureFlags: {
          getAllFlags: vi.fn().mockRejectedValue(new Error('network error'))
        }
      };

      await featureFlagCacheManager.initialize();

      expect(featureFlagCacheManager.isInitialized).toBe(true);
      expect(featureFlagCacheManager.isEnabled('cachedFlag')).toBe(true);
    });

    it('clears old localStorage cache when version mismatches', async () => {
      lsStub.setItem('openkosmos_feature_flags_cache', JSON.stringify({ flags: { old: true } }));
      lsStub.setItem('openkosmos_feature_flags_cache_version', '0.0'); // old version

      (window as any).electronAPI = {
        featureFlags: {
          getAllFlags: vi.fn().mockResolvedValue({ success: true, data: { newFlag: true } })
        }
      };

      await featureFlagCacheManager.initialize();

      expect(featureFlagCacheManager.isEnabled('newFlag')).toBe(true);
    });

    it('handles backend returning success=false by falling back to localStorage', async () => {
      (window as any).electronAPI = {
        featureFlags: {
          getAllFlags: vi.fn().mockResolvedValue({ success: false, error: 'not allowed' })
        }
      };

      await featureFlagCacheManager.initialize();
      expect(featureFlagCacheManager.isInitialized).toBe(true);
    });

    it('saves flags to localStorage after successful sync', async () => {
      (window as any).electronAPI = {
        featureFlags: {
          getAllFlags: vi.fn().mockResolvedValue({ success: true, data: { saved: true } })
        }
      };

      await featureFlagCacheManager.initialize();

      const stored = lsStub.getItem('openkosmos_feature_flags_cache');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.flags).toEqual({ saved: true });
    });
  });

  describe('getAllFlags', () => {
    it('returns a copy of flags after initialization', async () => {
      (window as any).electronAPI = {
        featureFlags: { getAllFlags: vi.fn().mockResolvedValue({ success: true, data: { f: true } }) }
      };
      await featureFlagCacheManager.initialize();

      const flags = featureFlagCacheManager.getAllFlags();
      expect(flags).toEqual({ f: true });
      // Mutating the copy should not affect internal state
      flags['f'] = false;
      expect(featureFlagCacheManager.isEnabled('f')).toBe(true);
    });
  });

  describe('convenience functions', () => {
    it('isFeatureEnabled delegates to the singleton', async () => {
      (window as any).electronAPI = {
        featureFlags: { getAllFlags: vi.fn().mockResolvedValue({ success: true, data: { myFlag: true } }) }
      };
      await featureFlagCacheManager.initialize();

      expect(isFeatureEnabled('myFlag')).toBe(true);
      expect(isFeatureEnabled('missing')).toBe(false);
    });

    it('getAllFeatureFlags returns all flags', async () => {
      (window as any).electronAPI = {
        featureFlags: { getAllFlags: vi.fn().mockResolvedValue({ success: true, data: { a: true, b: false } }) }
      };
      await featureFlagCacheManager.initialize();

      expect(getAllFeatureFlags()).toEqual({ a: true, b: false });
    });
  });
});
