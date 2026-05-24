import { describe, it, expect } from 'vitest';
import { createLogEntry, getEnvironmentBasedConfig, DEFAULT_UNIFIED_CONFIG } from '../types';

describe('types.ts', () => {
  it('createLogEntry creates valid entry', () => {
    const entry = createLogEntry('INFO', 'hello', 'src', { k: 'v' });
    expect(entry.level).toBe('INFO');
    expect(entry.message).toBe('hello');
    expect(entry.source).toBe('src');
    expect(entry.metadata).toEqual({ k: 'v' });
    expect(entry.id).toBeTruthy();
    expect(entry.timestamp).toBeInstanceOf(Date);
  });

  it('createLogEntry without source or metadata', () => {
    const entry = createLogEntry('WARN', 'warning');
    expect(entry.source).toBeUndefined();
    expect(entry.metadata).toBeUndefined();
  });

  it('getEnvironmentBasedConfig in non-production returns small cache size', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const config = getEnvironmentBasedConfig();
    expect(config.LOGGER_CACHE_MAX_SIZE).toBe(10);
    process.env.NODE_ENV = origEnv;
  });

  it('getEnvironmentBasedConfig in production returns large cache size', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const config = getEnvironmentBasedConfig();
    expect(config.LOGGER_CACHE_MAX_SIZE).toBe(2000);
    process.env.NODE_ENV = origEnv;
  });

  it('DEFAULT_UNIFIED_CONFIG has expected shape', () => {
    expect(DEFAULT_UNIFIED_CONFIG.LOGGER_LEVELS).toContain('INFO');
    expect(DEFAULT_UNIFIED_CONFIG.LOGGER_ENABLE_CONSOLE).toBe(true);
    expect(DEFAULT_UNIFIED_CONFIG.LOGGER_CACHE_MAX_SIZE).toBeGreaterThan(0);
  });
});
