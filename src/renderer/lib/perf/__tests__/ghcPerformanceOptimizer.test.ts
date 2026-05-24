import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  performanceCache,
  debouncer,
  requestQueue,
  performanceMonitor,
  GhcPerformanceOptimizer,
  useGhcPerformance
} from '../ghcPerformanceOptimizer';

vi.mock('../../../types/ghcAuthTypes', () => ({}));
vi.mock('@shared/types/ghcChatTypes', () => ({}));

describe('performanceCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    performanceCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves a value within TTL', () => {
    performanceCache.set('k', 'value', 10000);
    expect(performanceCache.get('k')).toBe('value');
  });

  it('returns null for missing key', () => {
    expect(performanceCache.get('missing')).toBeNull();
  });

  it('returns null when entry is expired', () => {
    performanceCache.set('k', 'value', 1000);
    vi.advanceTimersByTime(2000);
    expect(performanceCache.get<string>('k')).toBeNull();
  });

  it('delete removes a key', () => {
    performanceCache.set('k', 'value', 10000);
    performanceCache.delete('k');
    expect(performanceCache.get('k')).toBeNull();
  });

  it('clear removes all entries', () => {
    performanceCache.set('a', 1, 10000);
    performanceCache.set('b', 2, 10000);
    performanceCache.clear();
    expect(performanceCache.getStats().size).toBe(0);
  });

  it('cleans up expired entries on set', () => {
    performanceCache.set('old', 'value', 100);
    vi.advanceTimersByTime(500);
    performanceCache.set('new', 'value2', 10000);
    // 'old' should be cleaned up
    expect(performanceCache.getStats().entries).not.toContain('old');
  });

  it('getStats returns size and entries', () => {
    performanceCache.set('x', 1, 10000);
    performanceCache.set('y', 2, 10000);
    const stats = performanceCache.getStats();
    expect(stats.size).toBe(2);
    expect(stats.entries).toContain('x');
    expect(stats.entries).toContain('y');
  });
});

describe('debouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    debouncer.cancelAll();
  });

  afterEach(() => {
    debouncer.cancelAll();
    vi.useRealTimers();
  });

  it('debounces repeated calls', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const debounced = debouncer.debounce('test', fn, 100);

    debounced();
    debounced();
    debounced();

    vi.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the resolved value', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const debounced = debouncer.debounce('k', fn, 10);

    const promise = debounced();
    vi.advanceTimersByTime(50);
    const result = await promise;
    expect(result).toBe(42);
  });

  it('rejects if underlying function throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const debounced = debouncer.debounce('err', fn, 10);

    const promise = debounced();
    vi.advanceTimersByTime(50);
    await expect(promise).rejects.toThrow('fail');
  });

  it('cancel stops a pending debounce', () => {
    const fn = vi.fn().mockResolvedValue('x');
    const debounced = debouncer.debounce('c', fn, 200);
    debounced();
    debouncer.cancel('c');
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancelAll clears all pending timers', () => {
    const fn = vi.fn().mockResolvedValue('x');
    debouncer.debounce('a', fn, 500)();
    debouncer.debounce('b', fn, 500)();
    debouncer.cancelAll();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('requestQueue', () => {
  it('executes requests and returns results', async () => {
    const result = await requestQueue.enqueue(() => Promise.resolve(99));
    expect(result).toBe(99);
  });

  it('propagates errors', async () => {
    await expect(
      requestQueue.enqueue(() => Promise.reject(new Error('oops')))
    ).rejects.toThrow('oops');
  });

  it('setMaxConcurrent updates concurrency limit', () => {
    requestQueue.setMaxConcurrent(5);
    expect(requestQueue.getQueueLength()).toBe(0);
  });

  it('getRunningCount returns 0 when idle', async () => {
    // Drain any previous runs
    await new Promise(r => setTimeout(r, 0));
    expect(requestQueue.getRunningCount()).toBe(0);
  });
});

describe('performanceMonitor', () => {
  beforeEach(() => {
    performanceMonitor.clearMetrics();
  });

  it('returns null for unknown operation', () => {
    expect(performanceMonitor.getMetrics('no-op')).toBeNull();
  });

  it('records and retrieves metrics', () => {
    performanceMonitor.recordMetric('op', 10);
    performanceMonitor.recordMetric('op', 20);
    performanceMonitor.recordMetric('op', 30);
    const m = performanceMonitor.getMetrics('op')!;
    expect(m.count).toBe(3);
    expect(m.average).toBe(20);
    expect(m.min).toBe(10);
    expect(m.max).toBe(30);
  });

  it('startTimer returns a callable that records duration', async () => {
    const end = performanceMonitor.startTimer('timed');
    // Simulate a small delay
    await new Promise(r => setTimeout(r, 5));
    const duration = end();
    expect(duration).toBeGreaterThan(0);
    const m = performanceMonitor.getMetrics('timed')!;
    expect(m.count).toBe(1);
  });

  it('keeps only the last 100 measurements', () => {
    for (let i = 0; i < 110; i++) {
      performanceMonitor.recordMetric('many', i);
    }
    const m = performanceMonitor.getMetrics('many')!;
    expect(m.count).toBe(100);
  });

  it('getAllMetrics returns all recorded operations', () => {
    performanceMonitor.recordMetric('x', 5);
    performanceMonitor.recordMetric('y', 10);
    const all = performanceMonitor.getAllMetrics();
    expect(all).toHaveProperty('x');
    expect(all).toHaveProperty('y');
  });

  it('clearMetrics removes all data', () => {
    performanceMonitor.recordMetric('op', 5);
    performanceMonitor.clearMetrics();
    expect(performanceMonitor.getMetrics('op')).toBeNull();
  });
});

describe('GhcPerformanceOptimizer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    GhcPerformanceOptimizer.cleanup();
  });

  afterEach(() => {
    GhcPerformanceOptimizer.cleanup();
    vi.useRealTimers();
  });

  describe('validateTokenCached', () => {
    it('returns true for non-empty token', async () => {
      const result = await GhcPerformanceOptimizer.validateTokenCached('abc123');
      expect(result).toBe(true);
    });

    it('returns cached result on second call', async () => {
      const spy = vi.spyOn(GhcPerformanceOptimizer as any, 'performTokenValidation');
      await GhcPerformanceOptimizer.validateTokenCached('xyz789');
      await GhcPerformanceOptimizer.validateTokenCached('xyz789');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getModelsCached', () => {
    it('returns an array of models (empty placeholder)', async () => {
      const models = await GhcPerformanceOptimizer.getModelsCached();
      expect(Array.isArray(models)).toBe(true);
    });

    it('returns cached result on second call', async () => {
      const spy = vi.spyOn(GhcPerformanceOptimizer as any, 'fetchModelsFromAPI');
      await GhcPerformanceOptimizer.getModelsCached();
      await GhcPerformanceOptimizer.getModelsCached();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('optimizeStreamingResponse', () => {
    it('returns single chunk directly', () => {
      expect(GhcPerformanceOptimizer.optimizeStreamingResponse(['hello'])).toBe('hello');
    });

    it('joins multiple chunks', () => {
      expect(GhcPerformanceOptimizer.optimizeStreamingResponse(['a', 'b', 'c'])).toBe('abc');
    });
  });

  describe('cacheSession / getSessionCached / clearSessionCache', () => {
    it('returns null when no session cached', async () => {
      const result = await GhcPerformanceOptimizer.getSessionCached();
      expect(result).toBeNull();
    });

    it('returns session when cached and token is valid', async () => {
      const session = { accessToken: 'valid-token', expiresAt: Date.now() + 60000 } as any;
      GhcPerformanceOptimizer.cacheSession(session);
      const result = await GhcPerformanceOptimizer.getSessionCached();
      expect(result).toEqual(session);
    });

    it('clearSessionCache removes session', async () => {
      const session = { accessToken: 'valid-token' } as any;
      GhcPerformanceOptimizer.cacheSession(session);
      GhcPerformanceOptimizer.clearSessionCache();
      const result = await GhcPerformanceOptimizer.getSessionCached();
      expect(result).toBeNull();
    });
  });

  describe('getDiagnostics', () => {
    it('returns diagnostics object with expected shape', () => {
      const diag = GhcPerformanceOptimizer.getDiagnostics();
      expect(diag).toHaveProperty('cache');
      expect(diag).toHaveProperty('requestQueue');
      expect(diag).toHaveProperty('metrics');
      expect(diag).toHaveProperty('memory');
      expect(diag.requestQueue).toHaveProperty('pending');
      expect(diag.requestQueue).toHaveProperty('running');
    });
  });

  describe('configure', () => {
    it('accepts maxConcurrentRequests without throwing', () => {
      expect(() => GhcPerformanceOptimizer.configure({ maxConcurrentRequests: 5 })).not.toThrow();
    });
  });

  describe('preloadCriticalResources', () => {
    it('resolves without error', async () => {
      await expect(GhcPerformanceOptimizer.preloadCriticalResources()).resolves.not.toThrow();
    });
  });
});

describe('useGhcPerformance', () => {
  it('returns expected hook object', () => {
    const hook = useGhcPerformance();
    expect(hook).toHaveProperty('getDiagnostics');
    expect(hook).toHaveProperty('preloadResources');
    expect(hook).toHaveProperty('cleanup');
  });
});
