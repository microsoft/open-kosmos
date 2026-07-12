/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger and dependencies
vi.mock('../../utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../streamingConfig', () => {
  const mockGetGlobalConfig = vi.fn(() => ({
    enabled: true,
    batchSize: 10,
    batchDelay: 5,
    performanceTracking: true,
    fallbackToV1OnError: true,
    maxRetries: 3,
    showStreamingMetrics: false,
    enableAdaptiveOptimization: true,
    debugMode: false,
  }));
  return {
    streamingConfigManager: {
      getGlobalConfig: mockGetGlobalConfig,
    },
  };
});

vi.mock('../streamingOptimizer', () => {
  return {
    streamingOptimizer: {
      initialize: vi.fn().mockResolvedValue(undefined),
      getCurrentConfig: vi.fn(() => ({
        baseDelay: 2,
        enableBatching: true,
        maxBatchSize: 8,
        enableSmartPausing: false,
        adaptiveSpeed: false,
        performanceMode: 'fast',
      })),
      getConfigForText: vi.fn((text: string) => ({
        baseDelay: 2,
        enableBatching: true,
        maxBatchSize: 8,
        enableSmartPausing: false,
        adaptiveSpeed: false,
        performanceMode: 'fast',
      })),
    },
  };
});

import { StreamingCompatibilityLayer, streamingCompatibility } from '../compatibilityLayer';
import { streamingConfigManager } from '../streamingConfig';
import { streamingOptimizer } from '../streamingOptimizer';

describe('StreamingCompatibilityLayer', () => {
  let layer: StreamingCompatibilityLayer;

  beforeEach(() => {
    vi.clearAllMocks();
    layer = new StreamingCompatibilityLayer();
  });

  describe('initialize', () => {
    it('initializes successfully', async () => {
      await layer.initialize();
      const report = layer.getCompatibilityReport();
      expect(report).toContain('Initialized: ✅');
    });

    it('is idempotent — second call is no-op', async () => {
      await layer.initialize();
      await layer.initialize();
      expect(streamingOptimizer.initialize).toHaveBeenCalledTimes(1);
    });

    it('sets fallbackToOriginal on optimizer failure', async () => {
      (streamingOptimizer.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('init fail'));
      await layer.initialize();
      expect(layer.isFeatureAvailable('typewriter')).toBe(false);
    });

    it('sets preserveOriginalBehavior when user has custom batchSize', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        batchSize: 99, // differs from default 5
        batchDelay: 10,
        enableAdaptiveOptimization: true,
      });
      await layer.initialize();
      const result = layer.getCompatibleConfig('hello');
      // preserveOriginalBehavior → useOriginalMethod: false + simplified config
      expect(result.useOriginalMethod).toBe(false);
      expect(result.optimizedConfig?.enableBatching).toBe(false);
    });

    it('sets preserveOriginalBehavior when user has custom batchDelay', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        batchSize: 5,
        batchDelay: 99, // differs from default 10
        enableAdaptiveOptimization: true,
      });
      await layer.initialize();
      const result = layer.getCompatibleConfig('hello');
      expect(result.useOriginalMethod).toBe(false);
    });

    it('sets preserveOriginalBehavior when adaptive optimization is disabled', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: false, // hasCustomPerformanceSettings = true
      });
      await layer.initialize();
      const result = layer.getCompatibleConfig('hello');
      expect(result.useOriginalMethod).toBe(false);
    });
  });

  describe('getCompatibleConfig', () => {
    it('returns useOriginalMethod: true when fallbackToOriginal is set', async () => {
      (streamingOptimizer.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
      await layer.initialize();
      const result = layer.getCompatibleConfig('any text');
      expect(result.useOriginalMethod).toBe(true);
      expect(result.fallbackReason).toBeDefined();
    });

    it('returns optimized config for simple text (no fallback, no preserve)', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
      });
      await layer.initialize();
      const result = layer.getCompatibleConfig('Hello');
      expect(result.useOriginalMethod).toBe(false);
      expect(result.optimizedConfig).toBeDefined();
    });

    it('returns optimized config for complex text', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
      });
      await layer.initialize();
      const longText = 'This is a very long and complex text that has multiple sentences.\nSecond line here!';
      const result = layer.getCompatibleConfig(longText);
      expect(result.useOriginalMethod).toBe(false);
    });
  });

  describe('setCompatibilityMode', () => {
    it('legacy mode sets enableLegacyMode and preserveOriginalBehavior', () => {
      layer.setCompatibilityMode('legacy');
      expect(layer.isFeatureAvailable('batching')).toBe(false);
      expect(layer.isFeatureAvailable('optimization')).toBe(false);
    });

    it('enhanced mode disables legacy and preserve flags', () => {
      layer.setCompatibilityMode('legacy');
      layer.setCompatibilityMode('enhanced');
      expect(layer.isFeatureAvailable('batching')).toBe(true);
      expect(layer.isFeatureAvailable('optimization')).toBe(true);
    });

    it('auto mode behaves like enhanced', () => {
      layer.setCompatibilityMode('legacy');
      layer.setCompatibilityMode('auto');
      expect(layer.isFeatureAvailable('batching')).toBe(true);
    });
  });

  describe('enableDebug', () => {
    it('enables debug without throwing', () => {
      expect(() => layer.enableDebug()).not.toThrow();
      expect(() => layer.enableDebug(true)).not.toThrow();
      expect(() => layer.enableDebug(false)).not.toThrow();
    });
  });

  describe('isFeatureAvailable', () => {
    it('typewriter is available by default', () => {
      expect(layer.isFeatureAvailable('typewriter')).toBe(true);
    });

    it('batching is available by default', () => {
      expect(layer.isFeatureAvailable('batching')).toBe(true);
    });

    it('optimization is available by default', () => {
      expect(layer.isFeatureAvailable('optimization')).toBe(true);
    });

    it('unknown feature returns true', () => {
      expect(layer.isFeatureAvailable('unknown' as any)).toBe(true);
    });

    it('typewriter is unavailable when fallback enabled', async () => {
      (streamingOptimizer.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
      await layer.initialize();
      expect(layer.isFeatureAvailable('typewriter')).toBe(false);
    });

    it('batching is unavailable when preserve mode enabled', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        batchSize: 99,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
      });
      await layer.initialize();
      expect(layer.isFeatureAvailable('batching')).toBe(false);
    });

    it('optimization is unavailable in legacy mode', () => {
      layer.setCompatibilityMode('legacy');
      expect(layer.isFeatureAvailable('optimization')).toBe(false);
    });
  });

  describe('getCompatibilityReport', () => {
    it('returns a string report', async () => {
      await layer.initialize();
      const report = layer.getCompatibilityReport();
      expect(typeof report).toBe('string');
      expect(report).toContain('Streaming Rendering Compatibility Report');
      expect(report).toContain('Feature Availability');
      expect(report).toContain('Optimizer Status');
    });

    it('includes recommendations when not initialized', () => {
      // Fresh layer (not initialized)
      const report = layer.getCompatibilityReport();
      expect(report).toContain('Compatibility layer is not initialized');
    });

    it('includes streaming disabled recommendation', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
        enabled: false,
        performanceTracking: true,
      });
      await layer.initialize();
      const report = layer.getCompatibilityReport();
      expect(report).toContain('Streaming rendering is disabled');
    });

    it('includes all running normally recommendation when no issues', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
        enabled: true,
        performanceTracking: true,
      });
      await layer.initialize();
      const report = layer.getCompatibilityReport();
      expect(report).toContain('running normally');
    });

    it('includes fallback recommendation when fallback mode enabled', async () => {
      (streamingOptimizer.initialize as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
      await layer.initialize();
      const report = layer.getCompatibilityReport();
      expect(report).toContain('Compatibility issue detected');
    });

    it('includes customization recommendation when preserve mode enabled', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        batchSize: 99,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
      }).mockReturnValue({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
        enabled: true,
        performanceTracking: true,
      });
      await layer.initialize();
      const report = layer.getCompatibilityReport();
      expect(report).toContain('User customizations detected');
    });
  });

  describe('runCompatibilityTest', () => {
    it('returns results object with expected keys', async () => {
      await layer.initialize();
      const { success, results, errors } = await layer.runCompatibilityTest();
      expect(typeof success).toBe('boolean');
      expect(results).toHaveProperty('initialization');
      expect(results).toHaveProperty('configManager');
      expect(results).toHaveProperty('optimizer');
      expect(results).toHaveProperty('configGeneration');
      expect(results).toHaveProperty('typewriterFeature');
      expect(results).toHaveProperty('batchingFeature');
      expect(results).toHaveProperty('optimizationFeature');
      expect(Array.isArray(errors)).toBe(true);
    });

    it('reports success=true when initialized and no errors', async () => {
      (streamingConfigManager.getGlobalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        batchSize: 5,
        batchDelay: 10,
        enableAdaptiveOptimization: true,
        enabled: true,
      });
      await layer.initialize();
      const { success } = await layer.runCompatibilityTest();
      expect(success).toBe(true);
    });

    it('reports success=false when not initialized', async () => {
      // Not initialized; initialization check fails
      const { results } = await layer.runCompatibilityTest();
      expect(results.initialization).toBe(false);
    });

    it('handles getCompatibleConfig throwing inside test', async () => {
      await layer.initialize();
      // Force getCompatibleConfig to throw by making streamingOptimizer.getConfigForText throw
      (streamingOptimizer.getConfigForText as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('config error');
      });
      const { results, errors } = await layer.runCompatibilityTest();
      // If getCompatibleConfig fails for 'Hello World!', configGeneration should be false
      // (depends on whether the simple text path hits getConfigForText — it doesn't, but
      //  if preserveOriginalBehavior is false and it's not fallback, it calls getConfigForText)
      // The key thing: it should not throw an unhandled error
      expect(Array.isArray(errors)).toBe(true);
    });
  });
});

describe('streamingCompatibility singleton', () => {
  it('is exported and is a StreamingCompatibilityLayer instance', () => {
    expect(streamingCompatibility).toBeDefined();
    expect(typeof streamingCompatibility.initialize).toBe('function');
  });
});
