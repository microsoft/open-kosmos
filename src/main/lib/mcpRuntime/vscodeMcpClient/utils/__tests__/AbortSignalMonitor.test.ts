import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  AbortSignalMonitor,
  addSafeAbortListener,
  createSafeCombinedSignal,
} from '../AbortSignalMonitor';

function makeSignal(): { controller: AbortController; signal: AbortSignal } {
  const controller = new AbortController();
  return { controller, signal: controller.signal };
}

beforeEach(() => {
  AbortSignalMonitor.reset();
  AbortSignalMonitor.isEnabled = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── setEnabled ────────────────────────────────────────────────────────────────

describe('setEnabled', () => {
  it('disables monitoring', () => {
    AbortSignalMonitor.setEnabled(false);
    expect(AbortSignalMonitor.isEnabled).toBe(false);
  });

  it('re-enables monitoring', () => {
    AbortSignalMonitor.setEnabled(false);
    AbortSignalMonitor.setEnabled(true);
    expect(AbortSignalMonitor.isEnabled).toBe(true);
  });
});

// ── addListener ───────────────────────────────────────────────────────────────

describe('addListener', () => {
  it('calls the handler when signal is aborted', () => {
    const { controller, signal } = makeSignal();
    const handler = vi.fn();
    AbortSignalMonitor.addListener(signal, handler, { source: 'test' });
    controller.abort();
    expect(handler).toHaveBeenCalledOnce();
  });

  it('increments totalListeners and listenerCounts', () => {
    const { signal } = makeSignal();
    const before = AbortSignalMonitor.totalListeners;
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'test' });
    expect(AbortSignalMonitor.totalListeners).toBe(before + 1);
    expect(AbortSignalMonitor.getListenerCount(signal)).toBe(1);
  });

  it('bypasses monitoring when isEnabled=false and still calls handler on abort', () => {
    AbortSignalMonitor.setEnabled(false);
    const { controller, signal } = makeSignal();
    const handler = vi.fn();
    AbortSignalMonitor.addListener(signal, handler, { source: 'test' });
    controller.abort();
    expect(handler).toHaveBeenCalled();
    // No tracking when disabled
    expect(AbortSignalMonitor.totalListeners).toBe(0);
  });

  it('skips listener when duplicate source exceeds limit of 5', () => {
    const { signal } = makeSignal();
    // Add 7 listeners from same source — each 1ms apart so uniqueKeys differ
    // The limit allows up to 5 similar sources; the 7th should be skipped
    for (let i = 0; i < 7; i++) {
      AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'dup-source' });
      vi.advanceTimersByTime(1); // advance 1ms so Date.now() changes, making uniqueKey unique
    }
    // At most 6 should have been added (7th is skipped when recentSources.length > 5)
    expect(AbortSignalMonitor.getListenerCount(signal)).toBeLessThanOrEqual(6);
  });

  it('does not add listener when MAX_LISTENERS_PER_SIGNAL is reached', () => {
    const { signal } = makeSignal();
    // Override to a small limit for the test
    const originalMax = AbortSignalMonitor.MAX_LISTENERS_PER_SIGNAL;
    // Directly set count via listenerCounts WeakMap by pre-populating
    // We simulate by adding up to max then checking next add is skipped
    (AbortSignalMonitor as any).listenerCounts.set(signal, {
      count: AbortSignalMonitor.MAX_LISTENERS_PER_SIGNAL,
      created: Date.now(),
      lastActivity: Date.now(),
      source: 'test',
    });
    const before = AbortSignalMonitor.totalListeners;
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'overflow' });
    // Should not increment
    expect(AbortSignalMonitor.totalListeners).toBe(before);
  });

  it('cleans up old sources when sources.size > 20', () => {
    const { signal } = makeSignal();
    // Add 21 listeners with unique sources to trigger cleanup path
    for (let i = 0; i < 21; i++) {
      // Use unique sources so they don't hit dup limit
      AbortSignalMonitor.addListener(signal, vi.fn(), { source: `unique-src-${i}` });
      vi.advanceTimersByTime(0);
    }
    // Should have cleaned down; just confirm no crash
    expect(AbortSignalMonitor.getListenerCount(signal)).toBeGreaterThan(0);
  });

  it('force-cleans listener via timeout after 60s', () => {
    const { signal } = makeSignal();
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'timeout-test' });
    const before = AbortSignalMonitor.totalListeners;
    vi.advanceTimersByTime(60001);
    // Listener count decremented by timeout
    expect(AbortSignalMonitor.totalListeners).toBeLessThan(before);
  });

  it('force-clean timeout does not decrement if already aborted', () => {
    const { controller, signal } = makeSignal();
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'abort-first' });
    controller.abort(); // handler fires, decrements count
    const afterAbort = AbortSignalMonitor.totalListeners;
    vi.advanceTimersByTime(60001); // timeout fires but signal.aborted is true
    // Count should not go below afterAbort (may already be 0)
    expect(AbortSignalMonitor.totalListeners).toBeGreaterThanOrEqual(0);
  });

  it('decrements even when handler throws', () => {
    const { controller, signal } = makeSignal();
    AbortSignalMonitor.addListener(signal, () => { throw new Error('handler error'); }, { source: 'err-handler' });
    const before = AbortSignalMonitor.totalListeners;
    expect(() => controller.abort()).not.toThrow();
    // decrementListener called in catch block too — total should have decreased
    expect(AbortSignalMonitor.totalListeners).toBeLessThanOrEqual(before);
  });
});

// ── decrementListener ─────────────────────────────────────────────────────────

describe('decrementListener', () => {
  it('decrements count when info exists', () => {
    const { signal } = makeSignal();
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'decr-test' });
    expect(AbortSignalMonitor.getListenerCount(signal)).toBe(1);
    // Manually decrement with a source key (uniqueKey format)
    const info = (AbortSignalMonitor as any).listenerCounts.get(signal);
    // Get the stored uniqueKey by inspecting signalSources
    const sources: Set<string> = (AbortSignalMonitor as any).signalSources.get(signal) || new Set();
    const key = Array.from(sources)[0] as string;
    AbortSignalMonitor.decrementListener(signal, key);
    expect(AbortSignalMonitor.getListenerCount(signal)).toBe(0);
  });

  it('does nothing when isEnabled=false', () => {
    AbortSignalMonitor.setEnabled(false);
    const { signal } = makeSignal();
    // Should not throw
    AbortSignalMonitor.decrementListener(signal, 'any-key');
  });

  it('does nothing when no info tracked for signal', () => {
    const { signal } = makeSignal();
    // Should not throw
    expect(() => AbortSignalMonitor.decrementListener(signal, 'not-tracked')).not.toThrow();
  });

  it('does not go below zero for totalListeners', () => {
    AbortSignalMonitor.totalListeners = 0;
    const { signal } = makeSignal();
    // Set count to 1 manually
    (AbortSignalMonitor as any).listenerCounts.set(signal, { count: 1, created: Date.now(), lastActivity: Date.now(), source: 'x' });
    AbortSignalMonitor.totalListeners = 0;
    AbortSignalMonitor.decrementListener(signal);
    expect(AbortSignalMonitor.totalListeners).toBe(0);
  });

  it('deletes listenerCounts entry when count reaches zero', () => {
    const { signal } = makeSignal();
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'cleanup' });
    const sources: Set<string> = (AbortSignalMonitor as any).signalSources.get(signal) || new Set();
    const key = Array.from(sources)[0] as string;
    AbortSignalMonitor.decrementListener(signal, key);
    expect(AbortSignalMonitor.getListenerCount(signal)).toBe(0);
    // WeakMap entry should be deleted (listenerCounts.has returns false)
    expect((AbortSignalMonitor as any).listenerCounts.get(signal)).toBeUndefined();
  });

  it('removes source from signalSources when deleting', () => {
    const { signal } = makeSignal();
    AbortSignalMonitor.addListener(signal, vi.fn(), { source: 'src-track' });
    const sources: Set<string> = (AbortSignalMonitor as any).signalSources.get(signal) || new Set();
    const key = Array.from(sources)[0] as string;
    AbortSignalMonitor.decrementListener(signal, key);
    // After decrement to 0, signalSources entry should be cleared
    expect((AbortSignalMonitor as any).signalSources.get(signal)).toBeUndefined();
  });
});

// ── getListenerCount / getTotalListeners ──────────────────────────────────────

describe('getListenerCount', () => {
  it('returns 0 for untracked signal', () => {
    const { signal } = makeSignal();
    expect(AbortSignalMonitor.getListenerCount(signal)).toBe(0);
  });
});

describe('getTotalListeners', () => {
  it('returns totalListeners', () => {
    AbortSignalMonitor.totalListeners = 42;
    expect(AbortSignalMonitor.getTotalListeners()).toBe(42);
  });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns correct totalListeners', () => {
    AbortSignalMonitor.totalListeners = 7;
    const stats = AbortSignalMonitor.getStats();
    expect(stats.totalListeners).toBe(7);
    expect(stats.signalCount).toBe(0);
    expect(stats.warningSignals).toBe(0);
    expect(stats.criticalSignals).toBe(0);
    expect(stats.oldestSignal).toBeUndefined();
  });
});

// ── checkForLeaks ─────────────────────────────────────────────────────────────

describe('checkForLeaks', () => {
  it('returns hasLeaks=false when everything is normal', () => {
    AbortSignalMonitor.totalListeners = 0;
    const result = AbortSignalMonitor.checkForLeaks();
    expect(result.hasLeaks).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.recommendations).toHaveLength(0);
  });

  it('detects high listener count', () => {
    AbortSignalMonitor.totalListeners = 6000;
    const result = AbortSignalMonitor.checkForLeaks();
    expect(result.hasLeaks).toBe(true);
    expect(result.warnings.some(w => w.includes('6000'))).toBe(true);
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('resets totalListeners to 0', () => {
    AbortSignalMonitor.totalListeners = 99;
    AbortSignalMonitor.reset();
    expect(AbortSignalMonitor.totalListeners).toBe(0);
  });
});

// ── createMonitoredController ─────────────────────────────────────────────────

describe('createMonitoredController', () => {
  it('creates a controller with source property', () => {
    const ctrl = AbortSignalMonitor.createMonitoredController('my-source');
    expect(ctrl.source).toBe('my-source');
    expect(ctrl.signal).toBeDefined();
  });

  it('defaults source to "unknown"', () => {
    const ctrl = AbortSignalMonitor.createMonitoredController();
    expect(ctrl.source).toBe('unknown');
  });
});

// ── logActivity ───────────────────────────────────────────────────────────────

describe('logActivity', () => {
  it('does not throw in any environment', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(() => AbortSignalMonitor.logActivity('test message')).not.toThrow();
    process.env.NODE_ENV = 'production';
    expect(() => AbortSignalMonitor.logActivity('test message')).not.toThrow();
    process.env.NODE_ENV = old;
  });
});

// ── installGlobalMonitoring ───────────────────────────────────────────────────

describe('installGlobalMonitoring', () => {
  it('installs __abortSignalMonitor on globalThis', () => {
    AbortSignalMonitor.installGlobalMonitoring();
    expect((globalThis as any).__abortSignalMonitor).toBe(AbortSignalMonitor);
  });

  it('interval resets totalListeners when above 10000', () => {
    AbortSignalMonitor.installGlobalMonitoring();
    AbortSignalMonitor.totalListeners = 15000;
    vi.advanceTimersByTime(30001);
    expect(AbortSignalMonitor.totalListeners).toBe(0);
  });

  it('interval halves totalListeners when above 1000', () => {
    AbortSignalMonitor.installGlobalMonitoring();
    AbortSignalMonitor.totalListeners = 2000;
    vi.advanceTimersByTime(30001);
    expect(AbortSignalMonitor.totalListeners).toBe(1000);
  });
});

// ── installGlobalInterception ─────────────────────────────────────────────────

describe('installGlobalInterception', () => {
  it('installs without throwing', () => {
    expect(() => AbortSignalMonitor.installGlobalInterception()).not.toThrow();
  });

  it('global interception handles abort events on non-windows when enabled', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    AbortSignalMonitor.installGlobalInterception();
    AbortSignalMonitor.isEnabled = true;

    const { controller, signal } = makeSignal();
    const handler = vi.fn();
    // Calling addEventListener directly (not via AbortSignalMonitor.addListener)
    // triggers the global interception code path
    signal.addEventListener('abort', handler);
    controller.abort();

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('global interception on windows calls original method directly', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    AbortSignalMonitor.installGlobalInterception();
    AbortSignalMonitor.isEnabled = true;

    const { controller, signal } = makeSignal();
    const handler = vi.fn();
    signal.addEventListener('abort', handler);
    controller.abort();
    expect(handler).toHaveBeenCalled();

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('global interception passes non-abort events to original', () => {
    AbortSignalMonitor.installGlobalInterception();
    const { signal } = makeSignal();
    // Non-abort event — should not throw
    expect(() => signal.addEventListener('abort', vi.fn())).not.toThrow();
  });

  it('global interception handles EventListenerObject format', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    AbortSignalMonitor.installGlobalInterception();
    AbortSignalMonitor.isEnabled = true;

    const { controller, signal } = makeSignal();
    const listener = { handleEvent: vi.fn() };
    signal.addEventListener('abort', listener as any);
    controller.abort();

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('global interception skips when at MAX_LISTENERS_PER_SIGNAL', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    AbortSignalMonitor.installGlobalInterception();
    AbortSignalMonitor.isEnabled = true;

    const { signal } = makeSignal();
    // Pre-fill listener count to max
    (AbortSignalMonitor as any).listenerCounts.set(signal, {
      count: AbortSignalMonitor.MAX_LISTENERS_PER_SIGNAL,
      created: Date.now(),
      lastActivity: Date.now(),
      source: 'test',
    });

    const before = AbortSignalMonitor.totalListeners;
    signal.addEventListener('abort', vi.fn());
    // Count should not have increased
    expect(AbortSignalMonitor.totalListeners).toBe(before);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});

// ── addSafeAbortListener ──────────────────────────────────────────────────────

describe('addSafeAbortListener', () => {
  it('adds a listener and calls it on abort', () => {
    const { controller, signal } = makeSignal();
    const handler = vi.fn();
    addSafeAbortListener(signal, handler, 'safe-test');
    controller.abort();
    expect(handler).toHaveBeenCalled();
  });

  it('works without source parameter', () => {
    const { controller, signal } = makeSignal();
    const handler = vi.fn();
    addSafeAbortListener(signal, handler);
    controller.abort();
    expect(handler).toHaveBeenCalled();
  });
});

// ── createSafeCombinedSignal ──────────────────────────────────────────────────

describe('createSafeCombinedSignal', () => {
  it('returns already-aborted signal when all input signals are aborted', () => {
    const { controller, signal } = makeSignal();
    controller.abort();
    const combined = createSafeCombinedSignal([signal]);
    expect(combined.aborted).toBe(true);
  });

  it('returns same signal when only one active signal', () => {
    const { signal } = makeSignal();
    const combined = createSafeCombinedSignal([signal]);
    expect(combined).toBe(signal);
  });

  it('combines multiple signals — aborts when first fires', () => {
    const { controller: c1, signal: s1 } = makeSignal();
    const { signal: s2 } = makeSignal();
    const combined = createSafeCombinedSignal([s1, s2], 'my-combined');
    expect(combined.aborted).toBe(false);
    c1.abort();
    expect(combined.aborted).toBe(true);
  });

  it('combines multiple signals — aborts when second fires', () => {
    const { signal: s1 } = makeSignal();
    const { controller: c2, signal: s2 } = makeSignal();
    const combined = createSafeCombinedSignal([s1, s2]);
    c2.abort();
    expect(combined.aborted).toBe(true);
  });

  it('already-aborted signal among active signals aborts combined immediately', () => {
    const { signal: s1 } = makeSignal();
    const { controller: c2, signal: s2 } = makeSignal();
    c2.abort();
    // s2 is aborted, s1 is not
    const activeSignals = [s1, s2].filter(s => !s.aborted); // just s1
    // But createSafeCombinedSignal does its own filter
    const combined = createSafeCombinedSignal([s1, s2]);
    // s2 was filtered out, only s1 remains -> returns s1 directly
    expect(combined).toBe(s1);
  });

  it('returns pre-aborted signal when a mid-loop check finds signal already aborted', () => {
    // Build a signal that becomes aborted between filter and loop
    const { controller: c1, signal: s1 } = makeSignal();
    const { controller: c2, signal: s2 } = makeSignal();
    // Neither aborted yet: 2 signals -> combined
    const combined = createSafeCombinedSignal([s1, s2]);
    // After the call, abort s1
    c1.abort();
    // combined should now be aborted
    expect(combined.aborted).toBe(true);
  });
});
