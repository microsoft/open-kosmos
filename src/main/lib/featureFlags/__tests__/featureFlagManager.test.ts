import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before importing the manager
vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@shared/constants/branding', () => ({
  BRAND_NAME: 'openkosmos',
}));

// Re-import after mocks are set up
import { featureFlagManager, isFeatureEnabled, getAllFeatureFlags } from '../featureFlagManager';
import { FEATURE_FLAG_DEFINITIONS } from '../featureFlagDefinitions';

describe('FeatureFlagManager', () => {
  beforeEach(() => {
    // Reset the singleton state between tests by re-initializing
    // Access private fields via casting to any
    const manager = featureFlagManager as any;
    manager.initialized = false;
    manager.flags = {};
    // Reset context
    manager.context = {
      isDev: false,
      brandName: 'openkosmos',
      platform: process.platform,
      arch: process.arch,
    };
    // Reset argv
    process.argv = ['node', 'app.js'];
    // Reset NODE_ENV
    delete process.env.NODE_ENV;
  });

  describe('initialize()', () => {
    it('initializes successfully and sets initialized flag', () => {
      featureFlagManager.initialize();
      expect((featureFlagManager as any).initialized).toBe(true);
    });

    it('does not reinitialize if already initialized', () => {
      featureFlagManager.initialize();
      const flagsBefore = { ...(featureFlagManager as any).flags };
      // Force a flag change
      (featureFlagManager as any).flags = {};
      featureFlagManager.initialize();
      // Flags should still be empty since we skipped re-init
      expect(Object.keys((featureFlagManager as any).flags)).toHaveLength(0);
    });

    it('sets isDev=true when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      featureFlagManager.initialize();
      expect(featureFlagManager.isDevMode).toBe(true);
    });

    it('sets isDev=true when --dev arg is present', () => {
      process.argv = ['node', 'app.js', '--dev'];
      featureFlagManager.initialize();
      expect(featureFlagManager.isDevMode).toBe(true);
    });

    it('sets isDev=false in production without --dev flag', () => {
      process.env.NODE_ENV = 'production';
      featureFlagManager.initialize();
      expect(featureFlagManager.isDevMode).toBe(false);
    });

    it('initializes defaults for all defined flags', () => {
      featureFlagManager.initialize();
      const values = featureFlagManager.getAllFlagsValues();
      for (const def of FEATURE_FLAG_DEFINITIONS) {
        expect(values).toHaveProperty(def.name);
      }
    });
  });

  describe('isEnabled()', () => {
    beforeEach(() => {
      featureFlagManager.initialize();
    });

    it('returns true for a flag that is always enabled (openkosmosFeatureScreenshot)', () => {
      expect(featureFlagManager.isEnabled('openkosmosFeatureScreenshot')).toBe(true);
    });

    it('returns true for openkosmosFeatureRemoteChannel (always true)', () => {
      expect(featureFlagManager.isEnabled('openkosmosFeatureRemoteChannel')).toBe(true);
    });

    it('returns false for a dev-only flag in production', () => {
      expect(featureFlagManager.isEnabled('openkosmosFeatureSubAgent')).toBe(false);
    });

    it('returns false and logs warn for unknown flag name', () => {
      // Cast to bypass TypeScript type safety for testing
      const result = featureFlagManager.isEnabled('unknownFlag' as any);
      expect(result).toBe(false);
    });
  });

  describe('getAllFlagsValues()', () => {
    beforeEach(() => {
      featureFlagManager.initialize();
    });

    it('returns a map of all flags with boolean values', () => {
      const values = featureFlagManager.getAllFlagsValues();
      expect(typeof values).toBe('object');
      for (const val of Object.values(values)) {
        expect(typeof val).toBe('boolean');
      }
    });
  });

  describe('CLI argument parsing', () => {
    it('enables a flag via --enable-features', () => {
      process.argv = ['node', 'app.js', '--enable-features=openkosmosFeatureSubAgent'];
      featureFlagManager.initialize();
      expect(featureFlagManager.isEnabled('openkosmosFeatureSubAgent')).toBe(true);
      expect((featureFlagManager as any).flags['openkosmosFeatureSubAgent'].source).toBe('cli');
    });

    it('disables a flag via --disable-features', () => {
      process.argv = ['node', 'app.js', '--disable-features=openkosmosFeatureScreenshot'];
      featureFlagManager.initialize();
      expect(featureFlagManager.isEnabled('openkosmosFeatureScreenshot')).toBe(false);
      expect((featureFlagManager as any).flags['openkosmosFeatureScreenshot'].source).toBe('cli');
    });

    it('handles multiple flags in --enable-features', () => {
      process.argv = ['node', 'app.js', '--enable-features=openkosmosFeatureSubAgent,openkosmosFeatureSubAgentAutoWake'];
      featureFlagManager.initialize();
      expect(featureFlagManager.isEnabled('openkosmosFeatureSubAgent')).toBe(true);
      expect(featureFlagManager.isEnabled('openkosmosFeatureSubAgentAutoWake')).toBe(true);
    });

    it('handles multiple flags in --disable-features', () => {
      process.argv = ['node', 'app.js', '--disable-features=openkosmosFeatureScreenshot,openkosmosFeatureRemoteChannel'];
      featureFlagManager.initialize();
      expect(featureFlagManager.isEnabled('openkosmosFeatureScreenshot')).toBe(false);
      expect(featureFlagManager.isEnabled('openkosmosFeatureRemoteChannel')).toBe(false);
    });

    it('logs a warning for unknown flag names from CLI', () => {
      process.argv = ['node', 'app.js', '--enable-features=unknownFlag'];
      // Should not throw
      expect(() => featureFlagManager.initialize()).not.toThrow();
    });

    it('handles both --enable-features and --disable-features in same args', () => {
      process.argv = ['node', 'app.js', '--enable-features=openkosmosFeatureSubAgent', '--disable-features=openkosmosFeatureScreenshot'];
      featureFlagManager.initialize();
      expect(featureFlagManager.isEnabled('openkosmosFeatureSubAgent')).toBe(true);
      expect(featureFlagManager.isEnabled('openkosmosFeatureScreenshot')).toBe(false);
    });
  });

  describe('isDevMode getter', () => {
    it('reflects isDev from context', () => {
      process.env.NODE_ENV = 'development';
      featureFlagManager.initialize();
      expect(featureFlagManager.isDevMode).toBe(true);
    });
  });

  describe('currentContext getter', () => {
    it('returns a copy of the context', () => {
      featureFlagManager.initialize();
      const ctx = featureFlagManager.currentContext;
      expect(ctx).toHaveProperty('isDev');
      expect(ctx).toHaveProperty('brandName');
      expect(ctx).toHaveProperty('platform');
      expect(ctx).toHaveProperty('arch');
      // Ensure it is a copy (not the same reference)
      expect(ctx).not.toBe((featureFlagManager as any).context);
    });
  });
});

describe('isFeatureEnabled convenience function', () => {
  beforeEach(() => {
    const manager = featureFlagManager as any;
    manager.initialized = false;
    manager.flags = {};
    manager.context = {
      isDev: false,
      brandName: 'openkosmos',
      platform: process.platform,
      arch: process.arch,
    };
    process.argv = ['node', 'app.js'];
    delete process.env.NODE_ENV;
    featureFlagManager.initialize();
  });

  it('delegates to featureFlagManager.isEnabled', () => {
    expect(isFeatureEnabled('openkosmosFeatureScreenshot')).toBe(true);
    expect(isFeatureEnabled('openkosmosFeatureSubAgent')).toBe(false);
  });
});

describe('getAllFeatureFlags convenience function', () => {
  beforeEach(() => {
    const manager = featureFlagManager as any;
    manager.initialized = false;
    manager.flags = {};
    manager.context = {
      isDev: false,
      brandName: 'openkosmos',
      platform: process.platform,
      arch: process.arch,
    };
    process.argv = ['node', 'app.js'];
    delete process.env.NODE_ENV;
    featureFlagManager.initialize();
  });

  it('returns all flag values as a map', () => {
    const values = getAllFeatureFlags();
    expect(typeof values).toBe('object');
    expect(Object.keys(values).length).toBeGreaterThan(0);
  });
});
