/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utilities/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { StreamingOptimizer, streamingOptimizer } from '../streamingOptimizer';

describe('StreamingOptimizer', () => {
  let optimizer: StreamingOptimizer;

  beforeEach(() => {
    optimizer = new StreamingOptimizer();
  });

  describe('constructor default config', () => {
    it('starts with fast performance mode and ultra-fast defaults', () => {
      const config = optimizer.getCurrentConfig();
      expect(config.performanceMode).toBe('fast');
      expect(config.enableBatching).toBe(true);
      expect(config.enableSmartPausing).toBe(false);
      expect(config.adaptiveSpeed).toBe(false);
    });
  });

  describe('initialize', () => {
    it('detects device capabilities and sets optimal config', async () => {
      await optimizer.initialize();
      const config = optimizer.getCurrentConfig();
      expect(config).toBeDefined();
      expect(config.performanceMode).toBe('fast');
    });

    it('sets low-end device config when memory is below 2048MB', async () => {
      const memMock = {
        usedJSHeapSize: 100 * 1024 * 1024,
        jsHeapSizeLimit: 1024 * 1024 * 1024, // 1024MB < 2048MB
      };
      Object.defineProperty(performance, 'memory', { get: () => memMock, configurable: true });

      await optimizer.initialize();
      const config = optimizer.getCurrentConfig();
      expect(config.performanceMode).toBe('fast');
    });

    it('sets high-end device config when cpu score > 80', async () => {
      // Spy on performance.now so CPU benchmark finishes in < 1ms → high score
      let callCount = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => {
        callCount++;
        return callCount <= 1 ? 0 : 0.1; // very fast, score ~100
      });

      await optimizer.initialize();
      const config = optimizer.getCurrentConfig();
      expect(config.performanceMode).toBe('fast');

      vi.restoreAllMocks();
    });

    it('does not throw with slow UA user agent (old Android)', async () => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'mozilla android 4.4 mobile',
        configurable: true,
      });
      await expect(optimizer.initialize()).resolves.not.toThrow();
    });
  });

  describe('getCurrentConfig', () => {
    it('returns a copy not referencing internal state', async () => {
      const config = optimizer.getCurrentConfig();
      config.baseDelay = 9999;
      expect(optimizer.getCurrentConfig().baseDelay).not.toBe(9999);
    });
  });

  describe('setPerformanceMode', () => {
    it('smooth mode sets correct config', () => {
      optimizer.setPerformanceMode('smooth');
      const config = optimizer.getCurrentConfig();
      expect(config.performanceMode).toBe('smooth');
      expect(config.maxBatchSize).toBe(5);
      expect(config.enableSmartPausing).toBe(false);
    });

    it('balanced mode sets correct config', () => {
      optimizer.setPerformanceMode('balanced');
      const config = optimizer.getCurrentConfig();
      expect(config.performanceMode).toBe('balanced');
      expect(config.maxBatchSize).toBe(8);
    });

    it('fast mode sets correct config', () => {
      optimizer.setPerformanceMode('fast');
      const config = optimizer.getCurrentConfig();
      expect(config.performanceMode).toBe('fast');
      expect(config.maxBatchSize).toBe(10);
      expect(config.baseDelay).toBe(1);
    });
  });

  describe('getConfigForText', () => {
    it('returns config based on current mode', () => {
      const config = optimizer.getConfigForText('Hello');
      expect(config).toBeDefined();
      expect(typeof config.baseDelay).toBe('number');
    });

    it('increases batch size for long text (>500 chars)', () => {
      const baseCfg = optimizer.getCurrentConfig();
      const longText = 'a'.repeat(600);
      const config = optimizer.getConfigForText(longText);
      expect(config.maxBatchSize).toBeGreaterThanOrEqual(baseCfg.maxBatchSize);
    });

    it('adjusts config for code text', () => {
      const codeText = 'function hello() { const x = 1; return x; }';
      const config = optimizer.getConfigForText(codeText);
      expect(config.enableSmartPausing).toBe(false);
    });

    it('adjusts config for multi-language text', () => {
      const multiLang = 'Hello world 你好世界';
      const config = optimizer.getConfigForText(multiLang);
      expect(config.maxBatchSize).toBeGreaterThanOrEqual(6);
    });

    it('handles text with various code indicators', () => {
      const codeIndicators = [
        'import React from "react"',
        'export default function',
        'const x = 1;',
        'let y = 2;',
        'var z = 3;',
        'class MyClass {}',
        '// comment',
        '/* block */',
        '*/end',
        '=== strict',
        '!== not',
        'x => x',
        '{ key: value }',
      ];

      for (const snippet of codeIndicators) {
        expect(() => optimizer.getConfigForText(snippet)).not.toThrow();
      }
    });

    it('handles Japanese and Korean text', () => {
      const japanese = 'Hello こんにちは';
      const korean = 'Hello 안녕하세요';
      expect(() => optimizer.getConfigForText(japanese)).not.toThrow();
      expect(() => optimizer.getConfigForText(korean)).not.toThrow();
    });

    it('respects max bounds on batch size for long + code text', () => {
      const text = 'a'.repeat(600) + ' function const let { } ; // => === !==';
      const config = optimizer.getConfigForText(text);
      expect(config.maxBatchSize).toBeLessThanOrEqual(15);
    });
  });

  describe('getDeviceReport', () => {
    it('returns "not yet detected" before initialize', () => {
      const report = optimizer.getDeviceReport();
      expect(report).toBe('Device capabilities not yet detected');
    });

    it('returns full report after initialize', async () => {
      await optimizer.initialize();
      const report = optimizer.getDeviceReport();
      expect(report).toContain('Device Performance Report');
      expect(report).toContain('CPU Score');
      expect(report).toContain('Memory');
      expect(report).toContain('Performance Mode');
    });
  });
});

describe('streamingOptimizer singleton', () => {
  it('is exported and has correct interface', () => {
    expect(streamingOptimizer).toBeDefined();
    expect(typeof streamingOptimizer.initialize).toBe('function');
    expect(typeof streamingOptimizer.getCurrentConfig).toBe('function');
  });
});
