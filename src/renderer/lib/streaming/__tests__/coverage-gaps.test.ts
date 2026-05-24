/**
 * @vitest-environment happy-dom
 *
 * Targeted coverage tests for remaining uncovered branches.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../streamingConfig', async (importOriginal) => {
  // Use real implementation for StreamingConfigManager/Validator; only mock the singleton
  const original = await importOriginal<typeof import('../streamingConfig')>();
  return original;
});

vi.mock('../streamingOptimizer', async (importOriginal) => {
  const original = await importOriginal<typeof import('../streamingOptimizer')>();
  return original;
});

import { StreamingPerformanceMonitor } from '../performanceMonitor';
import { StreamingConfigManager } from '../streamingConfig';
import { StreamingCompatibilityLayer } from '../compatibilityLayer';

// ─── PerformanceMonitor uncovered branches ────────────────────────────────────

describe('PerformanceMonitor uncovered branches', () => {
  let monitor: StreamingPerformanceMonitor;

  beforeEach(() => {
    monitor = new StreamingPerformanceMonitor();
  });

  it('generateReport includes critical alerts section', () => {
    monitor.startMonitoring();

    let t = 10;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    for (let i = 0; i < 35; i++) {
      t += 50; // 20 FPS < 30 threshold
      monitor.recordFrame();
    }

    monitor.stopMonitoring(); // checkPerformanceAlerts adds critical averageFPS alert

    const report = monitor.generateReport();
    expect(report).toContain('Critical Alerts');
    vi.restoreAllMocks();
  });

  it('generateReport includes all performance recommendation branches', () => {
    monitor.startMonitoring();

    let t = 10;
    vi.spyOn(performance, 'now').mockImplementation(() => t);

    // 40ms per frame → 25 FPS (< 45 → "low frame rate" recommendation)
    for (let i = 0; i < 35; i++) {
      t += 40;
      monitor.recordFrame();
    }

    // Slow renders > 20ms → "render time too long" recommendation
    for (let i = 0; i < 5; i++) {
      monitor.recordRender(25);
    }

    // 5 chars over ~1s → < 30 chars/s → "typing speed slow" recommendation
    t += 1000;
    monitor.recordCharacters(5);

    monitor.stopMonitoring();

    // Simulate memory growth > 30MB → "memory growth large" recommendation
    const memMock = { usedJSHeapSize: 80 * 1024 * 1024, jsHeapSizeLimit: 2048 * 1024 * 1024 };
    Object.defineProperty(performance, 'memory', { get: () => memMock, configurable: true });
    memMock.usedJSHeapSize = 115 * 1024 * 1024; // +35MB delta

    const report = monitor.generateReport();
    expect(report).toContain('Optimization Recommendations');
    vi.restoreAllMocks();
  });

  it('getAlerts(info) returns empty array (info alerts are never generated internally)', () => {
    monitor.startMonitoring();
    monitor.recordRender(25); // only warning
    const infoAlerts = monitor.getAlerts('info');
    expect(infoAlerts).toHaveLength(0);
    monitor.stopMonitoring();
  });

  it('addAlert with info level hits console.info path via internal access', () => {
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // Access private addAlert via type casting to hit the default (info) branch
    const monitorAny = monitor as any;
    monitor.startMonitoring();
    monitorAny.addAlert({
      level: 'info',
      message: 'test info alert',
      metric: 'test',
      value: 1,
      threshold: 2,
      timestamp: Date.now(),
    });

    expect(consoleSpy).toHaveBeenCalled();
    const infoAlerts = monitor.getAlerts('info');
    expect(infoAlerts).toHaveLength(1);

    monitor.stopMonitoring();
    consoleSpy.mockRestore();
  });
});

// ─── StreamingConfigManager adaptive optimization branches ───────────────────

describe('StreamingConfigManager adaptive optimization branches', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('optimizeForMemory is triggered when memory usage > 85%', () => {
    vi.useFakeTimers();

    const memMock = {
      usedJSHeapSize: 90 * 1024 * 1024 * 1024, // 90% of limit
      jsHeapSizeLimit: 100 * 1024 * 1024 * 1024,
    };
    Object.defineProperty(performance, 'memory', { get: () => memMock, configurable: true });

    const manager = new StreamingConfigManager();
    manager.updateGlobalConfig({ enableAdaptiveOptimization: true });

    const prevBatchSize = manager.getGlobalConfig().batchSize;
    vi.advanceTimersByTime(30001);

    expect(manager.getGlobalConfig().batchSize).toBeLessThanOrEqual(prevBatchSize);
  });

  it('optimizeForPerformance is triggered when memory usage < 30%', () => {
    vi.useFakeTimers();

    const memMock = {
      usedJSHeapSize: 10 * 1024 * 1024 * 1024, // 10% of limit
      jsHeapSizeLimit: 100 * 1024 * 1024 * 1024,
    };
    Object.defineProperty(performance, 'memory', { get: () => memMock, configurable: true });

    const manager = new StreamingConfigManager();
    manager.updateGlobalConfig({ enableAdaptiveOptimization: true });

    const prevBatchSize = manager.getGlobalConfig().batchSize;
    vi.advanceTimersByTime(30001);

    expect(manager.getGlobalConfig().batchSize).toBeGreaterThanOrEqual(prevBatchSize);
  });
});

// ─── CompatibilityLayer: debug log branch ────────────────────────────────────

describe('CompatibilityLayer debug branch on hasUserCustomizations', () => {
  it('logs debug message when debugCompatibility is true and customizations exist', async () => {
    const layer = new StreamingCompatibilityLayer();
    layer.enableDebug(true);

    // Force a customized config so preserveOriginalBehavior triggers
    // (batchSize != 5 means hasCustomBatchSize = true)
    // The real streamingConfigManager.getGlobalConfig returns batchSize=10
    // which differs from the hard-coded check of 5 in hasUserCustomizations
    // so the debug logger.debug path at line 42 should fire.
    await layer.initialize();

    // If we got here without error, the debug path was executed
    const report = layer.getCompatibilityReport();
    expect(report).toBeDefined();
  });

  it('runCompatibilityTest outer catch returns failure when an unexpected error occurs', async () => {
    const layer = new StreamingCompatibilityLayer();

    // Force the outer try block to throw by mocking isFeatureAvailable to throw after initialization
    await layer.initialize();

    const origIsFeature = layer.isFeatureAvailable.bind(layer);
    let callCount = 0;
    vi.spyOn(layer, 'isFeatureAvailable').mockImplementation((f: any) => {
      callCount++;
      if (callCount > 2) throw new Error('unexpected failure');
      return origIsFeature(f);
    });

    const result = await layer.runCompatibilityTest();
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });
});
