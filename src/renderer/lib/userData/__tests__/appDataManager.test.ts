/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const getAppConfigMock = vi.fn();
const updateAppConfigMock = vi.fn();
let onConfigUpdatedCallback: ((data: { config: any; timestamp: number }) => void) | null = null;

const onConfigUpdatedMock = vi.fn((cb: any) => {
  onConfigUpdatedCallback = cb;
});

Object.defineProperty(window, 'electronAPI', {
  value: {
    appConfig: {
      getAppConfig: getAppConfigMock,
      updateAppConfig: updateAppConfigMock,
      onConfigUpdated: onConfigUpdatedMock,
    },
  },
  writable: true,
  configurable: true,
});

import { AppDataManager } from '../appDataManager';

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshInstance(): AppDataManager {
  (AppDataManager as any).instance = null;
  return AppDataManager.getInstance();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AppDataManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onConfigUpdatedCallback = null;
    (AppDataManager as any).instance = null;
  });

  afterEach(() => {
    (AppDataManager as any).instance = null;
    vi.useRealTimers();
  });

  // ── Singleton ──────────────────────────────────────────────────────────────

  describe('getInstance()', () => {
    it('returns the same instance on repeated calls', () => {
      const a = AppDataManager.getInstance();
      const b = AppDataManager.getInstance();
      expect(a).toBe(b);
    });
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('isReady() returns false before any update', () => {
      const mgr = freshInstance();
      expect(mgr.isReady()).toBe(false);
    });

    it('getConfig() returns an empty object before initialization', () => {
      const mgr = freshInstance();
      expect(mgr.getConfig()).toEqual({});
    });

    it('getRuntimeEnvironment() returns undefined before initialization', () => {
      const mgr = freshInstance();
      expect(mgr.getRuntimeEnvironment()).toBeUndefined();
    });
  });

  // ── IPC push (onConfigUpdated) ─────────────────────────────────────────────

  describe('IPC push via onConfigUpdated', () => {
    it('registers the onConfigUpdated handler on construction', () => {
      freshInstance();
      expect(onConfigUpdatedMock).toHaveBeenCalledTimes(1);
    });

    it('handles config update and marks as ready', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();

      const config = { zoomLevel: 1.5, runtimeEnvironment: { mode: 'production' } };
      onConfigUpdatedCallback!({ config, timestamp: Date.now() });

      expect(mgr.isReady()).toBe(true);
      expect(mgr.getConfig()).toMatchObject({ zoomLevel: 1.5 });

      await vi.runAllTimersAsync();
    });

    it('notifies subscribers when config is pushed', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      const listener = vi.fn();
      mgr.subscribe(listener);

      const config = { zoomLevel: 2 };
      onConfigUpdatedCallback!({ config, timestamp: Date.now() });

      // Flush debounce timer (100 ms)
      await vi.advanceTimersByTimeAsync(200);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ zoomLevel: 2 }));
    });

    it('does not notify removed subscribers', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      const listener = vi.fn();
      const unsub = mgr.subscribe(listener);
      unsub();

      onConfigUpdatedCallback!({ config: { zoomLevel: 3 }, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(200);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ── getRuntimeEnvironment ──────────────────────────────────────────────────

  describe('getRuntimeEnvironment()', () => {
    it('returns a copy of runtimeEnvironment when present', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      const re = { mode: 'development', someField: 42 };
      onConfigUpdatedCallback!({ config: { runtimeEnvironment: re }, timestamp: Date.now() });

      const result = mgr.getRuntimeEnvironment();
      expect(result).toEqual(re);
      // Ensure it is a copy, not the same reference
      expect(result).not.toBe(re);
    });

    it('returns undefined when runtimeEnvironment is absent', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      onConfigUpdatedCallback!({ config: { zoomLevel: 1 }, timestamp: Date.now() });
      expect(mgr.getRuntimeEnvironment()).toBeUndefined();
    });
  });

  // ── getConfig copy safety ──────────────────────────────────────────────────

  describe('getConfig() returns a copy', () => {
    it('mutating the returned config does not affect internal cache', () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      onConfigUpdatedCallback!({ config: { zoomLevel: 1 }, timestamp: Date.now() });

      const cfg = mgr.getConfig();
      (cfg as any).zoomLevel = 99;
      expect(mgr.getConfig().zoomLevel).toBe(1);
    });
  });

  // ── updateConfig ───────────────────────────────────────────────────────────

  describe('updateConfig()', () => {
    it('delegates to electronAPI.appConfig.updateAppConfig', async () => {
      const mgr = freshInstance();
      updateAppConfigMock.mockResolvedValue({ success: true });

      const result = await mgr.updateConfig({ zoomLevel: 2 });
      expect(updateAppConfigMock).toHaveBeenCalledWith({ zoomLevel: 2 });
      expect(result).toEqual({ success: true });
    });

    it('returns error when electronAPI.appConfig is not available', async () => {
      const mgr = freshInstance();
      const original = (window as any).electronAPI;
      (window as any).electronAPI = {};

      const result = await mgr.updateConfig({ zoomLevel: 2 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not available/i);

      (window as any).electronAPI = original;
    });

    it('catches errors thrown by updateAppConfig', async () => {
      const mgr = freshInstance();
      updateAppConfigMock.mockRejectedValue(new Error('network error'));

      const result = await mgr.updateConfig({ zoomLevel: 2 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/network error/);
    });
  });

  // ── subscribe / unsubscribe ────────────────────────────────────────────────

  describe('subscribe()', () => {
    it('can have multiple listeners', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      const l1 = vi.fn();
      const l2 = vi.fn();
      mgr.subscribe(l1);
      mgr.subscribe(l2);

      onConfigUpdatedCallback!({ config: { zoomLevel: 5 }, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(200);

      expect(l1).toHaveBeenCalled();
      expect(l2).toHaveBeenCalled();
    });

    it('only removes the specific unsubscribed listener', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      const l1 = vi.fn();
      const l2 = vi.fn();
      mgr.subscribe(l1);
      const unsub2 = mgr.subscribe(l2);
      unsub2();

      onConfigUpdatedCallback!({ config: { zoomLevel: 5 }, timestamp: Date.now() });
      await vi.advanceTimersByTimeAsync(200);

      expect(l1).toHaveBeenCalled();
      expect(l2).not.toHaveBeenCalled();
    });

    it('handles listener errors without throwing', async () => {
      vi.useFakeTimers();
      const mgr = freshInstance();
      mgr.subscribe(() => { throw new Error('listener exploded'); });

      expect(() => {
        onConfigUpdatedCallback!({ config: { zoomLevel: 5 }, timestamp: Date.now() });
      }).not.toThrow();

      await vi.runAllTimersAsync();
    });
  });

  // ── fallback fetch ─────────────────────────────────────────────────────────

  describe('fallback fetch', () => {
    it('calls getAppConfig after timeout when not initialized', async () => {
      vi.useFakeTimers();
      getAppConfigMock.mockResolvedValue({ success: true, data: { zoomLevel: 7 } });

      const mgr = freshInstance();
      expect(mgr.isReady()).toBe(false);

      await vi.advanceTimersByTimeAsync(3100);
      await vi.runAllTimersAsync();

      expect(getAppConfigMock).toHaveBeenCalled();
      expect(mgr.isReady()).toBe(true);
      expect(mgr.getConfig().zoomLevel).toBe(7);
    });

    it('does not call getAppConfig if already initialized before timeout', async () => {
      vi.useFakeTimers();
      getAppConfigMock.mockResolvedValue({ success: true, data: { zoomLevel: 7 } });

      const mgr = freshInstance();
      // Simulate IPC push before timeout
      onConfigUpdatedCallback!({ config: { zoomLevel: 1 }, timestamp: Date.now() });

      await vi.advanceTimersByTimeAsync(3100);
      await vi.runAllTimersAsync();

      expect(getAppConfigMock).not.toHaveBeenCalled();
    });

    it('handles failed fallback fetch gracefully', async () => {
      vi.useFakeTimers();
      getAppConfigMock.mockRejectedValue(new Error('IPC failure'));

      const mgr = freshInstance();
      await vi.advanceTimersByTimeAsync(3100);
      await vi.runAllTimersAsync();

      expect(mgr.isReady()).toBe(false);
    });

    it('handles fallback when getAppConfig returns success=false', async () => {
      vi.useFakeTimers();
      getAppConfigMock.mockResolvedValue({ success: false });

      const mgr = freshInstance();
      await vi.advanceTimersByTimeAsync(3100);
      await vi.runAllTimersAsync();

      expect(mgr.isReady()).toBe(false);
    });
  });

  // ── no electronAPI ─────────────────────────────────────────────────────────

  describe('no electronAPI', () => {
    it('constructs without errors when electronAPI is absent', () => {
      const original = (window as any).electronAPI;
      (window as any).electronAPI = undefined;

      expect(() => freshInstance()).not.toThrow();

      (window as any).electronAPI = original;
    });
  });
});
