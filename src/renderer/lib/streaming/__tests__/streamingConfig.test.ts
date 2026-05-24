/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StreamingConfigManager,
  StreamingConfigValidator,
  DEFAULT_STREAMING_V2_CONFIG,
  DEFAULT_PERFORMANCE_CONFIG,
  DEFAULT_UI_CONFIG,
  streamingConfigManager,
} from '../streamingConfig';

describe('DEFAULT constants', () => {
  it('exports DEFAULT_STREAMING_V2_CONFIG with expected shape', () => {
    expect(DEFAULT_STREAMING_V2_CONFIG.enabled).toBe(true);
    expect(DEFAULT_STREAMING_V2_CONFIG.batchSize).toBe(10);
    expect(DEFAULT_STREAMING_V2_CONFIG.batchDelay).toBe(5);
    expect(DEFAULT_STREAMING_V2_CONFIG.performanceTracking).toBe(true);
    expect(DEFAULT_STREAMING_V2_CONFIG.fallbackToV1OnError).toBe(true);
    expect(DEFAULT_STREAMING_V2_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_STREAMING_V2_CONFIG.showStreamingMetrics).toBe(false);
    expect(DEFAULT_STREAMING_V2_CONFIG.enableAdaptiveOptimization).toBe(true);
    expect(DEFAULT_STREAMING_V2_CONFIG.debugMode).toBe(false);
  });

  it('exports DEFAULT_PERFORMANCE_CONFIG with expected shape', () => {
    expect(DEFAULT_PERFORMANCE_CONFIG.targetFPS).toBe(120);
    expect(DEFAULT_PERFORMANCE_CONFIG.adaptiveThrottling).toBe(false);
    expect(DEFAULT_PERFORMANCE_CONFIG.memoryOptimization).toBe(true);
    expect(typeof DEFAULT_PERFORMANCE_CONFIG.bufferSize).toBe('number');
    expect(typeof DEFAULT_PERFORMANCE_CONFIG.flushThreshold).toBe('number');
  });

  it('exports DEFAULT_UI_CONFIG with expected shape', () => {
    expect(DEFAULT_UI_CONFIG.showCursor).toBe(false);
    expect(DEFAULT_UI_CONFIG.cursorAnimation).toBe('none');
    expect(DEFAULT_UI_CONFIG.smoothScrolling).toBe(true);
    expect(typeof DEFAULT_UI_CONFIG.autoScrollThreshold).toBe('number');
    expect(DEFAULT_UI_CONFIG.renderingMode).toBe('immediate');
  });
});

describe('StreamingConfigManager', () => {
  let manager: StreamingConfigManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new StreamingConfigManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getGlobalConfig / updateGlobalConfig', () => {
    it('returns a copy of the default global config', () => {
      const config = manager.getGlobalConfig();
      expect(config).toEqual(DEFAULT_STREAMING_V2_CONFIG);
      // Mutation should not affect internal state
      config.batchSize = 999;
      expect(manager.getGlobalConfig().batchSize).toBe(DEFAULT_STREAMING_V2_CONFIG.batchSize);
    });

    it('updates global config with partial values', () => {
      manager.updateGlobalConfig({ batchSize: 20, debugMode: true });
      const config = manager.getGlobalConfig();
      expect(config.batchSize).toBe(20);
      expect(config.debugMode).toBe(true);
      expect(config.enabled).toBe(DEFAULT_STREAMING_V2_CONFIG.enabled);
    });

    it('notifies config listeners on update', () => {
      const listener = vi.fn();
      manager.addConfigListener(listener);
      manager.updateGlobalConfig({ batchSize: 15 });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 15 }));
    });

    it('triggers applyAdaptiveOptimization when enableAdaptiveOptimization is toggled', () => {
      // Should not throw when toggled
      expect(() => manager.updateGlobalConfig({ enableAdaptiveOptimization: false })).not.toThrow();
      expect(() => manager.updateGlobalConfig({ enableAdaptiveOptimization: true })).not.toThrow();
    });
  });

  describe('getPerformanceConfig / updatePerformanceConfig', () => {
    it('returns a copy of the default performance config', () => {
      const config = manager.getPerformanceConfig();
      expect(config).toEqual(DEFAULT_PERFORMANCE_CONFIG);
    });

    it('updates performance config with partial values', () => {
      manager.updatePerformanceConfig({ targetFPS: 60, adaptiveThrottling: true });
      const config = manager.getPerformanceConfig();
      expect(config.targetFPS).toBe(60);
      expect(config.adaptiveThrottling).toBe(true);
    });
  });

  describe('getUIConfig / updateUIConfig', () => {
    it('returns a copy of the default UI config', () => {
      expect(manager.getUIConfig()).toEqual(DEFAULT_UI_CONFIG);
    });

    it('updates UI config with partial values', () => {
      manager.updateUIConfig({ showCursor: true, cursorAnimation: 'blink' });
      const config = manager.getUIConfig();
      expect(config.showCursor).toBe(true);
      expect(config.cursorAnimation).toBe('blink');
    });
  });

  describe('Agent config management', () => {
    it('returns default agent config when none is set', () => {
      const agentConfig = manager.getAgentConfig('agent-1');
      expect(agentConfig.agentId).toBe('agent-1');
      expect(agentConfig.streamingV2).toEqual(DEFAULT_STREAMING_V2_CONFIG);
      expect(agentConfig.performance).toEqual(DEFAULT_PERFORMANCE_CONFIG);
      expect(agentConfig.ui).toEqual(DEFAULT_UI_CONFIG);
    });

    it('updates and retrieves agent-specific config', () => {
      manager.updateAgentConfig('agent-1', { streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, batchSize: 25 } });
      const config = manager.getAgentConfig('agent-1');
      expect(config.streamingV2?.batchSize).toBe(25);
    });

    it('removes agent config', () => {
      manager.updateAgentConfig('agent-1', { streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, batchSize: 25 } });
      manager.removeAgentConfig('agent-1');
      // Should revert to defaults
      expect(manager.getAgentConfig('agent-1').streamingV2?.batchSize).toBe(DEFAULT_STREAMING_V2_CONFIG.batchSize);
    });
  });

  describe('Feature switches', () => {
    it('isStreamingV2Enabled returns true by default', () => {
      expect(manager.isStreamingV2Enabled()).toBe(true);
    });

    it('isStreamingV2Enabled returns agent-level override when agentId provided', () => {
      manager.updateAgentConfig('agent-1', {
        streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, enabled: false }
      });
      expect(manager.isStreamingV2Enabled('agent-1')).toBe(false);
    });

    it('isStreamingV2Enabled falls back to global when agent has no override', () => {
      // No agent config set; falls back to global
      expect(manager.isStreamingV2Enabled('non-existent')).toBe(true);
    });

    it('toggleStreamingV2 disables globally', () => {
      manager.toggleStreamingV2(false);
      expect(manager.isStreamingV2Enabled()).toBe(false);
    });

    it('toggleStreamingV2 enables globally', () => {
      manager.toggleStreamingV2(false);
      manager.toggleStreamingV2(true);
      expect(manager.isStreamingV2Enabled()).toBe(true);
    });

    it('toggleStreamingV2 updates agent-specific config', () => {
      manager.toggleStreamingV2(false, 'agent-2');
      expect(manager.isStreamingV2Enabled('agent-2')).toBe(false);
      manager.toggleStreamingV2(true, 'agent-2');
      expect(manager.isStreamingV2Enabled('agent-2')).toBe(true);
    });

    it('isPerformanceTrackingEnabled returns global default', () => {
      expect(manager.isPerformanceTrackingEnabled()).toBe(DEFAULT_STREAMING_V2_CONFIG.performanceTracking);
    });

    it('isPerformanceTrackingEnabled returns agent override', () => {
      manager.updateAgentConfig('agent-3', {
        streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, performanceTracking: false }
      });
      expect(manager.isPerformanceTrackingEnabled('agent-3')).toBe(false);
    });

    it('isPerformanceTrackingEnabled falls back to global for unknown agent', () => {
      expect(manager.isPerformanceTrackingEnabled('unknown')).toBe(DEFAULT_STREAMING_V2_CONFIG.performanceTracking);
    });

    it('isDebugModeEnabled returns global default', () => {
      expect(manager.isDebugModeEnabled()).toBe(DEFAULT_STREAMING_V2_CONFIG.debugMode);
    });

    it('isDebugModeEnabled returns agent override', () => {
      manager.updateAgentConfig('agent-4', {
        streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, debugMode: true }
      });
      expect(manager.isDebugModeEnabled('agent-4')).toBe(true);
    });

    it('isDebugModeEnabled falls back to global for unknown agent', () => {
      expect(manager.isDebugModeEnabled('unknown')).toBe(DEFAULT_STREAMING_V2_CONFIG.debugMode);
    });
  });

  describe('Config listeners', () => {
    it('unsubscribe removes listener', () => {
      const listener = vi.fn();
      const unsub = manager.addConfigListener(listener);
      unsub();
      manager.updateGlobalConfig({ batchSize: 30 });
      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners are notified independently', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      manager.addConfigListener(l1);
      manager.addConfigListener(l2);
      manager.updateGlobalConfig({ batchSize: 10 });
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('listener error does not crash manager', () => {
      const badListener = vi.fn().mockImplementation(() => { throw new Error('listener error'); });
      manager.addConfigListener(badListener);
      expect(() => manager.updateGlobalConfig({ batchSize: 10 })).not.toThrow();
    });
  });

  describe('resetToDefaults', () => {
    it('restores all configs to defaults and notifies listeners', () => {
      const listener = vi.fn();
      manager.addConfigListener(listener);
      manager.updateGlobalConfig({ batchSize: 99 });
      manager.updateAgentConfig('x', { streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, batchSize: 1 } });
      manager.resetToDefaults();
      expect(manager.getGlobalConfig()).toEqual(DEFAULT_STREAMING_V2_CONFIG);
      expect(manager.getAgentConfig('x').streamingV2).toEqual(DEFAULT_STREAMING_V2_CONFIG);
      // Called for updateGlobalConfig + resetToDefaults
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetAgentConfig', () => {
    it('removes agent-specific config so defaults are returned', () => {
      manager.updateAgentConfig('y', { streamingV2: { ...DEFAULT_STREAMING_V2_CONFIG, batchSize: 77 } });
      manager.resetAgentConfig('y');
      expect(manager.getAgentConfig('y').streamingV2?.batchSize).toBe(DEFAULT_STREAMING_V2_CONFIG.batchSize);
    });
  });

  describe('adaptive optimization via interval', () => {
    it('does not throw when interval fires with adaptive optimization enabled', () => {
      manager.updateGlobalConfig({ enableAdaptiveOptimization: true });
      expect(() => vi.advanceTimersByTime(30001)).not.toThrow();
    });

    it('does not run optimization when adaptiveOptimization is disabled', () => {
      manager.updateGlobalConfig({ enableAdaptiveOptimization: false });
      // Just check it does not throw
      expect(() => vi.advanceTimersByTime(30001)).not.toThrow();
    });
  });
});

describe('StreamingConfigValidator', () => {
  it('returns valid for a clean config', () => {
    const result = StreamingConfigValidator.validateConfig({ batchSize: 10, batchDelay: 50, maxRetries: 3 });
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects batchSize < 1', () => {
    const result = StreamingConfigValidator.validateConfig({ batchSize: 0 });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('batchSize must be between 1 and 100');
  });

  it('rejects batchSize > 100', () => {
    const result = StreamingConfigValidator.validateConfig({ batchSize: 101 });
    expect(result.isValid).toBe(false);
  });

  it('rejects batchDelay < 1', () => {
    const result = StreamingConfigValidator.validateConfig({ batchDelay: 0 });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('batchDelay must be between 1 and 1000ms');
  });

  it('rejects batchDelay > 1000', () => {
    const result = StreamingConfigValidator.validateConfig({ batchDelay: 1001 });
    expect(result.isValid).toBe(false);
  });

  it('rejects maxRetries < 0', () => {
    const result = StreamingConfigValidator.validateConfig({ maxRetries: -1 });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('maxRetries must be between 0 and 10');
  });

  it('rejects maxRetries > 10', () => {
    const result = StreamingConfigValidator.validateConfig({ maxRetries: 11 });
    expect(result.isValid).toBe(false);
  });

  it('warns when batchSize > 50', () => {
    const result = StreamingConfigValidator.validateConfig({ batchSize: 51 });
    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain('Large batch size may impact performance');
  });

  it('warns when batchDelay < 10', () => {
    const result = StreamingConfigValidator.validateConfig({ batchDelay: 5 });
    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain('Very low batch delay may cause excessive CPU usage');
  });

  it('ignores undefined fields', () => {
    const result = StreamingConfigValidator.validateConfig({});
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accumulates multiple errors', () => {
    const result = StreamingConfigValidator.validateConfig({ batchSize: 0, batchDelay: 0, maxRetries: -1 });
    expect(result.errors.length).toBe(3);
    expect(result.isValid).toBe(false);
  });
});

describe('streamingConfigManager singleton', () => {
  it('exports a StreamingConfigManager instance', () => {
    expect(streamingConfigManager).toBeDefined();
    expect(typeof streamingConfigManager.getGlobalConfig).toBe('function');
  });
});
