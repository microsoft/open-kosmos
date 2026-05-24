/**
 * @vitest-environment happy-dom
 *
 * Tests for TokenMonitorProxy — renderer-side IPC proxy for token monitoring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset singleton between tests
import { TokenMonitorProxy } from '../tokenMonitorProxy';

describe('TokenMonitorProxy', () => {
  beforeEach(() => {
    TokenMonitorProxy.resetInstance();
    (window as any).electronAPI = undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Singleton ────────────────────────────────────────────────────────────

  it('getInstance returns the same instance each call', () => {
    const a = TokenMonitorProxy.getInstance();
    const b = TokenMonitorProxy.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance creates a fresh instance', () => {
    const a = TokenMonitorProxy.getInstance();
    TokenMonitorProxy.resetInstance();
    const b = TokenMonitorProxy.getInstance();
    expect(a).not.toBe(b);
  });

  // ── stopMonitoring ───────────────────────────────────────────────────────

  it('stopMonitoring does nothing when electronAPI is unavailable', async () => {
    const proxy = new TokenMonitorProxy();
    await expect(proxy.stopMonitoring()).resolves.toBeUndefined();
  });

  it('stopMonitoring calls electronAPI.auth.stopTokenMonitoring on success', async () => {
    const stopTokenMonitoring = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { auth: { stopTokenMonitoring } };
    const proxy = new TokenMonitorProxy();
    await proxy.stopMonitoring();
    expect(stopTokenMonitoring).toHaveBeenCalled();
  });

  it('stopMonitoring handles failure result silently', async () => {
    const stopTokenMonitoring = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI = { auth: { stopTokenMonitoring } };
    const proxy = new TokenMonitorProxy();
    await expect(proxy.stopMonitoring()).resolves.toBeUndefined();
  });

  it('stopMonitoring swallows thrown errors', async () => {
    const stopTokenMonitoring = vi.fn().mockRejectedValue(new Error('network'));
    (window as any).electronAPI = { auth: { stopTokenMonitoring } };
    const proxy = new TokenMonitorProxy();
    await expect(proxy.stopMonitoring()).resolves.toBeUndefined();
  });

  // ── manualCheck ──────────────────────────────────────────────────────────

  it('manualCheck does nothing when electronAPI is unavailable', async () => {
    const proxy = new TokenMonitorProxy();
    await expect(proxy.manualCheck()).resolves.toBeUndefined();
  });

  it('manualCheck calls electronAPI.auth.manualTokenCheck on success', async () => {
    const manualTokenCheck = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { auth: { manualTokenCheck } };
    const proxy = new TokenMonitorProxy();
    await proxy.manualCheck();
    expect(manualTokenCheck).toHaveBeenCalled();
  });

  it('manualCheck handles failure result silently', async () => {
    const manualTokenCheck = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI = { auth: { manualTokenCheck } };
    const proxy = new TokenMonitorProxy();
    await expect(proxy.manualCheck()).resolves.toBeUndefined();
  });

  it('manualCheck swallows thrown errors', async () => {
    const manualTokenCheck = vi.fn().mockRejectedValue(new Error('oops'));
    (window as any).electronAPI = { auth: { manualTokenCheck } };
    const proxy = new TokenMonitorProxy();
    await expect(proxy.manualCheck()).resolves.toBeUndefined();
  });

  // ── triggerImmediateCheck ─────────────────────────────────────────────────

  it('triggerImmediateCheck schedules a manualCheck via setTimeout', async () => {
    const manualTokenCheck = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { auth: { manualTokenCheck } };
    const proxy = new TokenMonitorProxy();
    proxy.triggerImmediateCheck();
    expect(manualTokenCheck).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(manualTokenCheck).toHaveBeenCalled();
  });

  // ── getMonitoringStatus ──────────────────────────────────────────────────

  it('returns defaults when electronAPI is unavailable', async () => {
    const proxy = new TokenMonitorProxy();
    const status = await proxy.getMonitoringStatus();
    expect(status).toEqual({ isRunning: false, checkInterval: 60000, refreshThreshold: 300000 });
  });

  it('returns data from API on success', async () => {
    const data = { isRunning: true, checkInterval: 30000, refreshThreshold: 120000 };
    const getMonitoringStatus = vi.fn().mockResolvedValue({ success: true, data });
    (window as any).electronAPI = { auth: { getMonitoringStatus } };
    const proxy = new TokenMonitorProxy();
    const result = await proxy.getMonitoringStatus();
    expect(result).toEqual(data);
  });

  it('returns defaults when API returns failure result', async () => {
    const getMonitoringStatus = vi.fn().mockResolvedValue({ success: false });
    (window as any).electronAPI = { auth: { getMonitoringStatus } };
    const proxy = new TokenMonitorProxy();
    const result = await proxy.getMonitoringStatus();
    expect(result).toEqual({ isRunning: false, checkInterval: 60000, refreshThreshold: 300000 });
  });

  it('returns defaults when API throws', async () => {
    const getMonitoringStatus = vi.fn().mockRejectedValue(new Error('err'));
    (window as any).electronAPI = { auth: { getMonitoringStatus } };
    const proxy = new TokenMonitorProxy();
    const result = await proxy.getMonitoringStatus();
    expect(result).toEqual({ isRunning: false, checkInterval: 60000, refreshThreshold: 300000 });
  });

  // ── isRunning ────────────────────────────────────────────────────────────

  it('isRunning returns false when not running', async () => {
    const proxy = new TokenMonitorProxy();
    expect(await proxy.isRunning()).toBe(false);
  });

  it('isRunning returns true when API reports running', async () => {
    const data = { isRunning: true, checkInterval: 60000, refreshThreshold: 300000 };
    (window as any).electronAPI = {
      auth: { getMonitoringStatus: vi.fn().mockResolvedValue({ success: true, data }) },
    };
    const proxy = new TokenMonitorProxy();
    expect(await proxy.isRunning()).toBe(true);
  });

  // ── event listeners (setupEventListeners / cleanupEventListeners) ─────────

  it('stopMonitoring cleans up event listeners', async () => {
    const cleanup = vi.fn();
    const onTokenMonitor = vi.fn(() => cleanup);
    const stopTokenMonitoring = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = { auth: { onTokenMonitor, stopTokenMonitoring } };

    const proxy = new TokenMonitorProxy();
    // Invoke private setupEventListeners via the "public" path (stopMonitoring calls cleanup)
    // We need to trigger setup — it's called nowhere publicly, so call it via any method that does setup
    // Actually looking at source: setupEventListeners is never called externally, only cleanupEventListeners.
    // Push a cleanup fn manually to test cleanupEventListeners path.
    (proxy as any).eventListeners.push(cleanup);
    await proxy.stopMonitoring();
    expect(cleanup).toHaveBeenCalled();
  });

  it('setupEventListeners does nothing when onTokenMonitor is unavailable', () => {
    (window as any).electronAPI = { auth: {} };
    const proxy = new TokenMonitorProxy();
    // Call private method directly
    expect(() => (proxy as any).setupEventListeners()).not.toThrow();
  });

  it('setupEventListeners registers cleanup from onTokenMonitor', () => {
    const cleanup = vi.fn();
    const onTokenMonitor = vi.fn(() => cleanup);
    (window as any).electronAPI = { auth: { onTokenMonitor } };
    const proxy = new TokenMonitorProxy();
    (proxy as any).setupEventListeners();
    expect((proxy as any).eventListeners).toHaveLength(1);
  });

  // ── handleTokenMonitorEvent / emitAuthEvent ───────────────────────────────

  const eventTypes = [
    'monitor_started',
    'monitor_stopped',
    'refresh_success',
    'refresh_failed',
    'require_reauth',
    'monitor_error',
  ] as const;

  for (const eventType of eventTypes) {
    it(`handleTokenMonitorEvent dispatches tokenMonitor:${eventType} event`, () => {
      const proxy = new TokenMonitorProxy();
      const received: any[] = [];
      window.addEventListener(`tokenMonitor:${eventType}`, (e) => received.push(e));

      (proxy as any).handleTokenMonitorEvent({ event: eventType, data: { reason: 'test' } });

      expect(received).toHaveLength(1);
      expect((received[0] as CustomEvent).detail).toMatchObject({ reason: 'test' });
    });
  }

  it('handleTokenMonitorEvent ignores unknown event types without throwing', () => {
    const proxy = new TokenMonitorProxy();
    expect(() =>
      (proxy as any).handleTokenMonitorEvent({ event: 'unknown_event', data: {} }),
    ).not.toThrow();
  });

  it('onTokenMonitor callback routes events to handleTokenMonitorEvent', () => {
    let capturedCallback: ((data: any) => void) | null = null;
    const onTokenMonitor = vi.fn((cb: (data: any) => void) => {
      capturedCallback = cb;
      return vi.fn(); // cleanup
    });
    (window as any).electronAPI = { auth: { onTokenMonitor } };
    const proxy = new TokenMonitorProxy();
    (proxy as any).setupEventListeners();

    const received: any[] = [];
    window.addEventListener('tokenMonitor:monitor_started', (e) => received.push(e));
    capturedCallback!({ event: 'monitor_started', data: {} });
    expect(received).toHaveLength(1);
  });

  it('emitAuthEvent includes timestamp in detail', () => {
    const proxy = new TokenMonitorProxy();
    const received: CustomEvent[] = [];
    window.addEventListener('tokenMonitor:refresh_success', (e) =>
      received.push(e as CustomEvent),
    );
    (proxy as any).emitAuthEvent('refresh_success', { error: 'none' });
    expect(received[0].detail.timestamp).toBeTypeOf('number');
    expect(received[0].detail.error).toBe('none');
  });
});
