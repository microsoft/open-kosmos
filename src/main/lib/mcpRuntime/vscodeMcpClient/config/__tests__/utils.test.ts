import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import {
  validateJsonFormat,
  detectConfigFormat,
  safeJsonParse,
  safeJsonStringify,
  generateCacheKey,
  isCacheExpired,
  getCurrentPlatform,
  isPlatformSupported,
  getVSCodeConfigPaths,
  getPlatformInfo,
  getPlatformDisplayName,
  normalizePath,
  isAbsolutePath,
  getRelativePath,
  delay,
  createTimeoutPromise,
  expandPath,
} from '../utils';

describe('validateJsonFormat', () => {
  it('returns valid for correct JSON', () => {
    expect(validateJsonFormat('{"key":"value"}')).toEqual({ isValid: true });
  });

  it('returns invalid for bad JSON with error message', () => {
    const result = validateJsonFormat('{bad}');
    expect(result.isValid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('accepts arrays', () => {
    expect(validateJsonFormat('[1,2,3]')).toEqual({ isValid: true });
  });
});

describe('detectConfigFormat', () => {
  it('detects settings.json from filename', () => {
    expect(detectConfigFormat('/some/path/settings.json')).toBe('settings.json');
  });

  it('detects mcp.json from filename', () => {
    expect(detectConfigFormat('/some/path/mcp.json')).toBe('mcp.json');
  });

  it('returns unknown for unrecognized filename', () => {
    expect(detectConfigFormat('/some/path/config.json')).toBe('unknown');
  });

  it('detects settings.json from content when filename is unknown', () => {
    const content = JSON.stringify({ mcp: { servers: { s: {} } } });
    expect(detectConfigFormat('/other.json', content)).toBe('settings.json');
  });

  it('detects mcp.json from content when filename is unknown', () => {
    const content = JSON.stringify({ servers: { s: {} } });
    expect(detectConfigFormat('/other.json', content)).toBe('mcp.json');
  });
});

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    const result = safeJsonParse('{"a":1}');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ a: 1 });
  });

  it('returns error for invalid JSON', () => {
    const result = safeJsonParse('{bad}');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.data).toBeUndefined();
  });
});

describe('safeJsonStringify', () => {
  it('serializes valid object', () => {
    const result = safeJsonStringify({ a: 1 });
    expect(result).toBe('{"a":1}');
  });

  it('respects indent parameter', () => {
    const result = safeJsonStringify({ a: 1 }, 2);
    expect(result).toContain('\n');
  });

  it('handles circular references gracefully', () => {
    const obj: any = {};
    obj.self = obj;
    const result = safeJsonStringify(obj);
    expect(result).toContain('JSON serialization error');
  });
});

describe('generateCacheKey', () => {
  it('joins parts with colon', () => {
    expect(generateCacheKey('a', 'b', 'c')).toBe('a:b:c');
  });

  it('works with single part', () => {
    expect(generateCacheKey('only')).toBe('only');
  });
});

describe('isCacheExpired', () => {
  it('returns true when entry is older than TTL', () => {
    const oldTimestamp = Date.now() - 10000;
    expect(isCacheExpired(oldTimestamp, 5000)).toBe(true);
  });

  it('returns false when entry is within TTL', () => {
    const recentTimestamp = Date.now() - 1000;
    expect(isCacheExpired(recentTimestamp, 5000)).toBe(false);
  });
});

describe('getCurrentPlatform', () => {
  it('returns a known platform string', () => {
    const platform = getCurrentPlatform();
    expect(['macOS', 'Windows', 'Linux']).toContain(platform);
  });
});

describe('isPlatformSupported', () => {
  it('returns true for macOS', () => {
    expect(isPlatformSupported('macOS')).toBe(true);
  });

  it('returns true for Windows', () => {
    expect(isPlatformSupported('Windows')).toBe(true);
  });

  it('returns false for Linux', () => {
    expect(isPlatformSupported('Linux')).toBe(false);
  });
});

describe('getVSCodeConfigPaths', () => {
  it('returns paths for macOS', () => {
    const paths = getVSCodeConfigPaths('macOS');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]).toContain('Library/Application Support/Code');
  });

  it('returns paths for Windows', () => {
    const paths = getVSCodeConfigPaths('Windows');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some(p => p.includes('Code'))).toBe(true);
  });

  it('returns paths for Linux', () => {
    const paths = getVSCodeConfigPaths('Linux');
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe('getPlatformInfo', () => {
  it('returns platform info with required fields', () => {
    const info = getPlatformInfo('macOS');
    expect(info.platform).toBe('macOS');
    expect(info.isSupported).toBe(true);
    expect(typeof info.vscodeConfigPath).toBe('string');
    expect(Array.isArray(info.vscodeConfigPaths)).toBe(true);
    expect(typeof info.displayName).toBe('string');
  });
});

describe('getPlatformDisplayName', () => {
  it('returns macOS for macOS', () => {
    expect(getPlatformDisplayName('macOS')).toBe('macOS');
  });

  it('returns Windows for Windows', () => {
    expect(getPlatformDisplayName('Windows')).toBe('Windows');
  });

  it('returns Linux for Linux', () => {
    expect(getPlatformDisplayName('Linux')).toBe('Linux');
  });
});

describe('normalizePath', () => {
  it('normalizes a path', () => {
    const result = normalizePath('/foo/./bar/../baz');
    expect(result).toBe(path.normalize('/foo/./bar/../baz'));
  });
});

describe('isAbsolutePath', () => {
  it('returns true for absolute paths', () => {
    expect(isAbsolutePath('/absolute/path')).toBe(true);
  });

  it('returns false for relative paths', () => {
    expect(isAbsolutePath('relative/path')).toBe(false);
  });
});

describe('getRelativePath', () => {
  it('computes relative path', () => {
    const result = getRelativePath('/foo/bar', '/foo/bar/baz/file.ts');
    expect(result).toBe(path.join('baz', 'file.ts'));
  });
});

describe('delay', () => {
  it('resolves after the specified time', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe('createTimeoutPromise', () => {
  it('resolves if promise finishes in time', async () => {
    const result = await createTimeoutPromise(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('rejects with timeout error when promise takes too long', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 5000));
    await expect(createTimeoutPromise(slow, 50)).rejects.toThrow(/timed out/i);
  });
});

describe('expandPath', () => {
  it('expands ~ to home directory', async () => {
    const result = await expandPath('~/Documents');
    expect(result).toContain(os.homedir());
    expect(result).not.toContain('~');
  });

  it('expands ${HOME} style env vars', async () => {
    process.env.TEST_EXPAND_VAR = '/test/value';
    const result = await expandPath('${TEST_EXPAND_VAR}/sub');
    expect(result).toContain('/test/value');
    delete process.env.TEST_EXPAND_VAR;
  });

  it('returns absolute path for plain absolute input', async () => {
    const result = await expandPath('/absolute/path');
    expect(path.isAbsolute(result)).toBe(true);
  });
});
