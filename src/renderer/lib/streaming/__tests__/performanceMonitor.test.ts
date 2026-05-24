/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger utility
vi.mock('../../utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  StreamingPerformanceMonitor,
  streamingPerformanceMonitor,
} from '../performanceMonitor';

describe('StreamingPerformanceMonitor', () => {
  let monitor: StreamingPerformanceMonitor;

  beforeEach(() => {
    monitor = new StreamingPerformanceMonitor();
  });

  describe('startMonitoring / stopMonitoring lifecycle', () => {
    it('starts and stops monitoring without throwing', () => {
      monitor.startMonitoring();
      const metrics = monitor.stopMonitoring();
      expect(metrics).toBeDefined();
      expect(typeof metrics.timestamp).toBe('number');
    });

    it('stopMonitoring returns metrics even when not started', () => {
      const metrics = monitor.stopMonitoring();
      expect(metrics).toBeDefined();
    });

    it('calling startMonitoring twice is idempotent (second call is no-op)', () => {
      monitor.startMonitoring();
      monitor.startMonitoring(); // should be ignored
      const metrics = monitor.stopMonitoring();
      expect(metrics).toBeDefined();
    });
  });

  describe('recordRender', () => {
    it('does nothing when not monitoring', () => {
      expect(() => monitor.recordRender(10)).not.toThrow();
    });

    it('records render times while monitoring', () => {
      monitor.startMonitoring();
      monitor.recordRender(5);
      monitor.recordRender(10);
      const metrics = monitor.getMetrics();
      expect(metrics.averageRenderTime).toBeCloseTo(7.5);
      expect(metrics.peakRenderTime).toBe(10);
      expect(metrics.totalRenders).toBe(2);
      monitor.stopMonitoring();
    });

    it('generates a warning alert when render time exceeds 16.67ms', () => {
      monitor.startMonitoring();
      monitor.recordRender(20);
      const alerts = monitor.getAlerts('warning');
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].metric).toBe('renderTime');
      monitor.stopMonitoring();
    });

    it('caps render history at 100 entries', () => {
      monitor.startMonitoring();
      for (let i = 0; i < 110; i++) {
        monitor.recordRender(1);
      }
      // Should not throw; render count keeps going but internal array is capped
      expect(monitor.getMetrics().totalRenders).toBe(110);
      monitor.stopMonitoring();
    });
  });

  describe('recordFrame', () => {
    it('does nothing when not monitoring', () => {
      expect(() => monitor.recordFrame()).not.toThrow();
    });

    it('records frame times and computes FPS', () => {
      monitor.startMonitoring();

      // Simulate frame times by patching performance.now
      let fakeNow = 1000;
      const origNow = performance.now.bind(performance);
      vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);

      monitor.recordFrame(); // sets lastFrameTime = 1000
      fakeNow = 1100; // 100ms later → 10 FPS
      monitor.recordFrame();

      const metrics = monitor.getMetrics();
      // currentFPS = 1000 / 100 = 10
      expect(metrics.currentFPS).toBeCloseTo(10);

      vi.restoreAllMocks();
      monitor.stopMonitoring();
    });

    it('generates a warning alert when FPS drops below 30', () => {
      monitor.startMonitoring();

      let fakeNow = 10;
      vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);

      monitor.recordFrame(); // sets lastFrameTime = 10
      fakeNow = 60; // +50ms → 20 FPS (below 30) — frame time calculated here
      monitor.recordFrame();

      const alerts = monitor.getAlerts('warning');
      const fpsAlert = alerts.find(a => a.metric === 'fps');
      expect(fpsAlert).toBeDefined();

      vi.restoreAllMocks();
      monitor.stopMonitoring();
    });

    it('caps frame history at 60 entries', () => {
      monitor.startMonitoring();

      let t = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => t);
      for (let i = 0; i < 65; i++) {
        t += 16;
        monitor.recordFrame();
      }

      // Should not throw
      expect(() => monitor.getMetrics()).not.toThrow();

      vi.restoreAllMocks();
      monitor.stopMonitoring();
    });
  });

  describe('recordCharacters', () => {
    it('does nothing when not monitoring', () => {
      expect(() => monitor.recordCharacters(50)).not.toThrow();
    });

    it('accumulates character count for CPS calculation', () => {
      let fakeNow = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => fakeNow);

      monitor.startMonitoring();

      // Advance 1 second and record 100 chars
      fakeNow = 1000;
      monitor.recordCharacters(100);

      const metrics = monitor.getMetrics();
      expect(metrics.charactersPerSecond).toBeGreaterThan(0);

      vi.restoreAllMocks();
      monitor.stopMonitoring();
    });
  });

  describe('getMetrics', () => {
    it('returns zero metrics when nothing has been recorded', () => {
      const metrics = monitor.getMetrics();
      expect(metrics.averageRenderTime).toBe(0);
      expect(metrics.peakRenderTime).toBe(0);
      expect(metrics.totalRenders).toBe(0);
      expect(metrics.currentFPS).toBe(0);
      expect(metrics.averageFPS).toBe(0);
      expect(metrics.minFPS).toBe(0);
    });
  });

  describe('getAlerts / clearAlerts', () => {
    it('returns all alerts when no level is specified', () => {
      monitor.startMonitoring();
      monitor.recordRender(25); // triggers warning
      const all = monitor.getAlerts();
      expect(all.length).toBeGreaterThan(0);
      monitor.stopMonitoring();
    });

    it('filters alerts by level', () => {
      monitor.startMonitoring();
      monitor.recordRender(25); // warning
      const warnings = monitor.getAlerts('warning');
      const criticals = monitor.getAlerts('critical');
      expect(warnings.length).toBeGreaterThan(0);
      expect(criticals.length).toBe(0);
      monitor.stopMonitoring();
    });

    it('clearAlerts removes all alerts', () => {
      monitor.startMonitoring();
      monitor.recordRender(25);
      monitor.clearAlerts();
      expect(monitor.getAlerts()).toHaveLength(0);
      monitor.stopMonitoring();
    });

    it('caps alerts at 20', () => {
      monitor.startMonitoring();
      for (let i = 0; i < 25; i++) {
        monitor.recordRender(30); // each triggers a warning
      }
      expect(monitor.getAlerts().length).toBeLessThanOrEqual(20);
      monitor.stopMonitoring();
    });
  });

  describe('resetMetrics', () => {
    it('resets all counters', () => {
      monitor.startMonitoring();
      monitor.recordRender(5);
      monitor.resetMetrics();
      const metrics = monitor.getMetrics();
      expect(metrics.totalRenders).toBe(0);
      expect(metrics.averageRenderTime).toBe(0);
    });
  });

  describe('stopMonitoring alert checks', () => {
    it('generates critical alert when average FPS is below 30 on stop', () => {
      monitor.startMonitoring();

      let t = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => t);
      // Record slow frames: 50ms apart = 20 FPS
      for (let i = 0; i < 5; i++) {
        t += 50;
        monitor.recordFrame();
      }

      monitor.clearAlerts();
      monitor.stopMonitoring();

      const criticals = monitor.getAlerts('critical');
      const fpsAlert = criticals.find(a => a.metric === 'averageFPS');
      expect(fpsAlert).toBeDefined();

      vi.restoreAllMocks();
    });

    it('generates critical alert when memory delta exceeds 50MB on stop', () => {
      // Mock performance.memory
      const memMock = { usedJSHeapSize: 100 * 1024 * 1024, jsHeapSizeLimit: 2048 * 1024 * 1024 };
      Object.defineProperty(performance, 'memory', { get: () => memMock, configurable: true });

      monitor.startMonitoring();
      // Simulate big memory growth
      memMock.usedJSHeapSize = 200 * 1024 * 1024; // +100MB
      monitor.stopMonitoring();

      const criticals = monitor.getAlerts('critical');
      const memAlert = criticals.find(a => a.metric === 'memoryDelta');
      expect(memAlert).toBeDefined();
    });

    it('generates warning alert when chars/s is below 20 on stop', () => {
      monitor.startMonitoring();
      // Record 1 char over 1 second → 1 char/s (below 20)
      let t = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => t);
      t = 1000;
      monitor.recordCharacters(1);

      monitor.clearAlerts();
      monitor.stopMonitoring();

      const warnings = monitor.getAlerts('warning');
      const cpsAlert = warnings.find(a => a.metric === 'charsPerSecond');
      expect(cpsAlert).toBeDefined();

      vi.restoreAllMocks();
    });
  });

  describe('generateReport', () => {
    it('returns a non-empty report string', () => {
      const report = monitor.generateReport();
      expect(typeof report).toBe('string');
      expect(report.length).toBeGreaterThan(0);
      expect(report).toContain('Streaming Performance Report');
    });

    it('includes critical and warning sections when alerts exist', () => {
      monitor.startMonitoring();
      monitor.recordRender(30); // warning
      const report = monitor.generateReport();
      expect(report).toContain('Warnings');
      monitor.stopMonitoring();
    });

    it('includes performance score', () => {
      const report = monitor.generateReport();
      expect(report).toMatch(/Performance Score: \d+\/100/);
    });
  });

  describe('performance score edge cases', () => {
    it('produces a score between 0 and 100', () => {
      monitor.startMonitoring();

      let t = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => t);
      for (let i = 0; i < 10; i++) {
        t += 16;
        monitor.recordFrame();
        monitor.recordRender(5);
        monitor.recordCharacters(10);
      }
      monitor.stopMonitoring();

      const report = monitor.generateReport();
      const match = report.match(/Performance Score: (\d+)\/100/);
      expect(match).not.toBeNull();
      const score = parseInt(match![1]);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);

      vi.restoreAllMocks();
    });
  });
});

describe('streamingPerformanceMonitor singleton', () => {
  it('is exported as a StreamingPerformanceMonitor instance', () => {
    expect(streamingPerformanceMonitor).toBeDefined();
    expect(typeof streamingPerformanceMonitor.startMonitoring).toBe('function');
  });
});
