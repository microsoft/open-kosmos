import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryOptimizer, AdaptiveStreamingController } from '../memoryOptimizer';

// Provide a minimal window stub for tests that run in node environment
if (typeof window === 'undefined') {
  (globalThis as any).window = {};
}

describe('MemoryOptimizer', () => {
  let optimizer: MemoryOptimizer;

  beforeEach(() => {
    vi.useFakeTimers();
    // Disable auto GC by default to avoid setInterval in tests
    optimizer = new MemoryOptimizer({ enableAutoGC: false });
  });

  afterEach(() => {
    optimizer.destroy();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('uses default config when none provided', () => {
      const stats = optimizer.getCacheStats();
      expect(stats.totalItems).toBe(0);
    });

    it('starts memory monitoring when enableAutoGC is true', () => {
      const spy = vi.spyOn(global, 'setInterval');
      const opt = new MemoryOptimizer({ enableAutoGC: true });
      expect(spy).toHaveBeenCalled();
      opt.destroy();
    });
  });

  describe('getMemoryMetrics', () => {
    it('returns null when performance.memory is unavailable', () => {
      // In node environment, performance.memory is absent
      const result = optimizer.getMemoryMetrics();
      expect(result).toBeNull();
    });

    it('returns metrics when performance.memory is available', () => {
      (performance as any).memory = {
        usedJSHeapSize: 50,
        totalJSHeapSize: 100,
        jsHeapSizeLimit: 200
      };
      const result = optimizer.getMemoryMetrics();
      expect(result).not.toBeNull();
      expect(result!.utilizationPercent).toBeCloseTo(25);
      expect(result!.isMemoryPressure).toBe(false);
      delete (performance as any).memory;
    });

    it('isMemoryPressure is true when above gcThreshold', () => {
      (performance as any).memory = {
        usedJSHeapSize: 90,
        totalJSHeapSize: 100,
        jsHeapSizeLimit: 100
      };
      const result = optimizer.getMemoryMetrics();
      expect(result!.isMemoryPressure).toBe(true);
      delete (performance as any).memory;
    });
  });

  describe('cacheContent / getCachedContent', () => {
    it('stores and retrieves content', () => {
      optimizer.cacheContent('a', 'hello');
      expect(optimizer.getCachedContent('a')).toBe('hello');
    });

    it('returns null for missing key', () => {
      expect(optimizer.getCachedContent('missing')).toBeNull();
    });

    it('updates existing cache entry', () => {
      optimizer.cacheContent('a', 'first');
      optimizer.cacheContent('a', 'second');
      expect(optimizer.getCachedContent('a')).toBe('second');
    });

    it('does not cache content exceeding maxContentLength', () => {
      const large = 'x'.repeat(100001);
      optimizer.cacheContent('big', large);
      expect(optimizer.getCachedContent('big')).toBeNull();
    });

    it('evicts oldest content when content is too large', () => {
      // First add something to the cache
      optimizer.cacheContent('old', 'first item');
      // Advance time so 'old' has a clearly older timestamp
      vi.advanceTimersByTime(100);
      // Then try to add something too large (triggers evictOldestContent)
      const large = 'x'.repeat(100001);
      optimizer.cacheContent('big', large);
      // The oldest item should have been evicted
      expect(optimizer.getCachedContent('old')).toBeNull();
    });

    it('increments access count on get', () => {
      optimizer.cacheContent('a', 'value');
      optimizer.getCachedContent('a');
      optimizer.getCachedContent('a');
      const stats = optimizer.getCacheStats();
      expect(stats.mostAccessed).toBeGreaterThanOrEqual(3); // 1 on cache + 2 on get
    });
  });

  describe('evictContent', () => {
    it('removes a cached item and returns true', () => {
      optimizer.cacheContent('a', 'hello');
      expect(optimizer.evictContent('a')).toBe(true);
      expect(optimizer.getCachedContent('a')).toBeNull();
    });

    it('returns false for non-existent key', () => {
      expect(optimizer.evictContent('gone')).toBe(false);
    });
  });

  describe('cleanupExpiredContent', () => {
    it('removes items older than chunkRetentionTime via forceCleanup', () => {
      const opt = new MemoryOptimizer({ enableAutoGC: false, chunkRetentionTime: 1000 });
      opt.cacheContent('old', 'value');
      // Advance time past retention window
      vi.advanceTimersByTime(2000);
      opt.forceCleanup();
      expect(opt.getCachedContent('old')).toBeNull();
      opt.destroy();
    });

    it('keeps fresh items after cleanup when no low-priority eviction occurs', () => {
      // With 0 items, evictLowPriorityContent removes nothing
      const opt = new MemoryOptimizer({ enableAutoGC: false, chunkRetentionTime: 10000 });
      opt.cacheContent('a', 'value1');
      opt.cacheContent('b', 'value2');
      opt.cacheContent('c', 'value3');
      opt.cacheContent('d', 'value4');
      // Access all items multiple times so none are "low priority"
      for (let i = 0; i < 5; i++) {
        opt.getCachedContent('a');
        opt.getCachedContent('b');
        opt.getCachedContent('c');
        opt.getCachedContent('d');
      }
      vi.advanceTimersByTime(5000); // less than 10s retention
      opt.forceCleanup();
      // cleanupExpiredContent leaves them (not expired)
      // evictLowPriorityContent removes 1 of 4 (25%)
      expect(opt.getCacheStats().totalItems).toBe(3);
      opt.destroy();
    });
  });

  describe('forceCleanup', () => {
    it('calls window.gc if available', () => {
      const gcMock = vi.fn();
      (globalThis as any).window.gc = gcMock;
      optimizer.forceCleanup();
      expect(gcMock).toHaveBeenCalled();
      delete (globalThis as any).window.gc;
    });

    it('evicts low priority content (bottom 25%)', () => {
      // Add 4 items — forceCleanup will evict 1
      for (let i = 0; i < 4; i++) {
        optimizer.cacheContent(`item${i}`, 'value');
      }
      optimizer.forceCleanup();
      const stats = optimizer.getCacheStats();
      expect(stats.totalItems).toBeLessThanOrEqual(3);
    });
  });

  describe('onMemoryPressure', () => {
    it('invokes callback when memory pressure is detected', () => {
      const callback = vi.fn();
      optimizer.onMemoryPressure(callback);

      // Simulate memory pressure by providing high utilization
      (performance as any).memory = {
        usedJSHeapSize: 90,
        totalJSHeapSize: 100,
        jsHeapSizeLimit: 100
      };

      // Manually trigger checkMemoryUsage via private method access
      (optimizer as any).checkMemoryUsage();

      expect(callback).toHaveBeenCalled();
      delete (performance as any).memory;
    });
  });

  describe('updateConfig', () => {
    it('updates the config', () => {
      optimizer.updateConfig({ maxContentLength: 500 });
      // Verify indirectly: content of length 501 should not be cached
      const content = 'x'.repeat(501);
      optimizer.cacheContent('a', content);
      expect(optimizer.getCachedContent('a')).toBeNull();
    });

    it('starts monitoring when enableAutoGC transitions to true', () => {
      const spy = vi.spyOn(global, 'setInterval');
      optimizer.updateConfig({ enableAutoGC: true });
      expect(spy).toHaveBeenCalled();
    });

    it('stops monitoring when enableAutoGC transitions to false', () => {
      const spy = vi.spyOn(global, 'clearInterval');
      const opt = new MemoryOptimizer({ enableAutoGC: true });
      opt.updateConfig({ enableAutoGC: false });
      expect(spy).toHaveBeenCalled();
      opt.destroy();
    });
  });

  describe('getCacheStats', () => {
    it('returns zeros for empty cache', () => {
      const stats = optimizer.getCacheStats();
      expect(stats.totalItems).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(stats.averageSize).toBe(0);
      expect(stats.oldestItem).toBe(0);
      expect(stats.mostAccessed).toBe(0);
    });

    it('correctly calculates stats for populated cache', () => {
      optimizer.cacheContent('a', 'ab'); // 4 bytes
      optimizer.cacheContent('b', 'abcd'); // 8 bytes
      const stats = optimizer.getCacheStats();
      expect(stats.totalItems).toBe(2);
      expect(stats.totalSize).toBe(12);
      expect(stats.averageSize).toBe(6);
      expect(stats.oldestItem).toBeGreaterThan(0);
      expect(stats.mostAccessed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('destroy', () => {
    it('clears the cache', () => {
      optimizer.cacheContent('a', 'hello');
      optimizer.destroy();
      expect(optimizer.getCacheStats().totalItems).toBe(0);
    });
  });
});

describe('AdaptiveStreamingController', () => {
  let mockOptimizer: MemoryOptimizer;
  let controller: AdaptiveStreamingController;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOptimizer = new MemoryOptimizer({ enableAutoGC: false });
    controller = new AdaptiveStreamingController(mockOptimizer);
  });

  afterEach(() => {
    mockOptimizer.destroy();
    vi.useRealTimers();
  });

  describe('getAdaptiveDelay', () => {
    it('returns baseDelay when no memory metrics', () => {
      // No performance.memory — getMemoryMetrics returns null
      const delay = controller.getAdaptiveDelay();
      expect(delay).toBe(16); // baseDelay
    });

    it('increases delay under memory pressure', () => {
      (performance as any).memory = {
        usedJSHeapSize: 90,
        totalJSHeapSize: 100,
        jsHeapSizeLimit: 100
      };
      const delay = controller.getAdaptiveDelay();
      // utilizationPercent = 90%, memoryFactor = max(1, 90/50) = 1.8
      expect(delay).toBeGreaterThan(16);
      delete (performance as any).memory;
    });

    it('caps delay at 100ms', () => {
      (performance as any).memory = {
        usedJSHeapSize: 99,
        totalJSHeapSize: 100,
        jsHeapSizeLimit: 100
      };
      // Force high adaptation factor
      (controller as any).adaptationFactor = 3;
      const delay = controller.getAdaptiveDelay();
      expect(delay).toBeLessThanOrEqual(100);
      delete (performance as any).memory;
    });
  });

  describe('updateConfig', () => {
    it('updates the base delay', () => {
      controller.updateConfig(32);
      expect((controller as any).baseDelay).toBe(32);
    });
  });

  describe('getMetrics', () => {
    it('returns current state', () => {
      const metrics = controller.getMetrics();
      expect(metrics.baseDelay).toBe(16);
      expect(metrics.currentDelay).toBe(16);
      expect(metrics.adaptationFactor).toBe(1.0);
    });
  });

  describe('handleMemoryPressure', () => {
    it('increases adaptation factor on memory pressure', () => {
      (mockOptimizer as any).onMemoryPressureCallback?.();
      // Should be called via the callback registered in constructor
      // Trigger manually since we are testing the private path
      (controller as any).handleMemoryPressure();
      expect((controller as any).adaptationFactor).toBeGreaterThan(1.0);
    });

    it('caps adaptation factor at 3.0', () => {
      for (let i = 0; i < 10; i++) {
        (controller as any).handleMemoryPressure();
      }
      expect((controller as any).adaptationFactor).toBeLessThanOrEqual(3.0);
    });
  });

  describe('resetAdaptation', () => {
    it('does nothing within 5s cooldown', () => {
      (controller as any).handleMemoryPressure(); // factor > 1
      const factorBefore = (controller as any).adaptationFactor;
      controller.resetAdaptation(); // Should not reset yet
      expect((controller as any).adaptationFactor).toBe(factorBefore);
    });

    it('reduces adaptation factor after 5s cooldown', () => {
      (controller as any).handleMemoryPressure(); // factor = 1.5
      vi.advanceTimersByTime(6000);
      controller.resetAdaptation();
      expect((controller as any).adaptationFactor).toBeLessThan(1.5);
    });
  });
});
