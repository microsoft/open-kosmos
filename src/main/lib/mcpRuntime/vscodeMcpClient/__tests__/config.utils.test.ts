/**
 * Tests for config/utils.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
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
  expandPath
} from '../config/utils';

// ---------------------------------------------------------------------------
// validateJsonFormat
// ---------------------------------------------------------------------------

describe('validateJsonFormat', () => {
  it('returns isValid=true for valid JSON', () => {
    expect(validateJsonFormat('{"a":1}')).toEqual({ isValid: true });
  });

  it('returns isValid=false with error for invalid JSON', () => {
    const result = validateJsonFormat('{ bad }');
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('accepts JSON arrays', () => {
    expect(validateJsonFormat('[1,2,3]').isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectConfigFormat
// ---------------------------------------------------------------------------

describe('detectConfigFormat', () => {
  it('returns settings.json for paths containing settings.json', () => {
    expect(detectConfigFormat('/home/user/.vscode/settings.json')).toBe('settings.json');
  });

  it('returns mcp.json for paths containing mcp.json', () => {
    expect(detectConfigFormat('/home/user/.vscode/mcp.json')).toBe('mcp.json');
  });

  it('falls back to content when filename is ambiguous', () => {
    const content = JSON.stringify({ mcp: { servers: {} } });
    expect(detectConfigFormat('/path/to/config.json', content)).toBe('settings.json');
  });

  it('falls back to mcp.json format from content servers field', () => {
    const content = JSON.stringify({ servers: {} });
    expect(detectConfigFormat('/path/to/config.json', content)).toBe('mcp.json');
  });

  it('returns unknown for unknown file and no useful content', () => {
    expect(detectConfigFormat('/path/to/other.json')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------

describe('safeJsonParse', () => {
  it('parses valid JSON and returns success', () => {
    const result = safeJsonParse<{ x: number }>('{"x":42}');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ x: 42 });
  });

  it('returns success=false for invalid JSON', () => {
    const result = safeJsonParse('nope');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// safeJsonStringify
// ---------------------------------------------------------------------------

describe('safeJsonStringify', () => {
  it('stringifies a plain object', () => {
    const result = safeJsonStringify({ a: 1 });
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('handles circular references gracefully', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = safeJsonStringify(obj);
    expect(result).toContain('serialization error');
  });
});

// ---------------------------------------------------------------------------
// generateCacheKey
// ---------------------------------------------------------------------------

describe('generateCacheKey', () => {
  it('joins parts with colon', () => {
    expect(generateCacheKey('tools', 'server1', 'list')).toBe('tools:server1:list');
  });

  it('works with a single part', () => {
    expect(generateCacheKey('hello')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// isCacheExpired
// ---------------------------------------------------------------------------

describe('isCacheExpired', () => {
  it('returns false when entry is fresh', () => {
    const ts = Date.now() - 100;
    expect(isCacheExpired(ts, 5000)).toBe(false);
  });

  it('returns true when TTL has passed', () => {
    const ts = Date.now() - 10000;
    expect(isCacheExpired(ts, 5000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getCurrentPlatform
// ---------------------------------------------------------------------------

describe('getCurrentPlatform', () => {
  it('returns a known platform string', () => {
    const platform = getCurrentPlatform();
    expect(['macOS', 'Windows', 'Linux']).toContain(platform);
  });
});

// ---------------------------------------------------------------------------
// isPlatformSupported
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getVSCodeConfigPaths
// ---------------------------------------------------------------------------

describe('getVSCodeConfigPaths', () => {
  it('returns non-empty array for macOS', () => {
    const paths = getVSCodeConfigPaths('macOS');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some(p => p.includes('mcp.json') || p.includes('settings.json'))).toBe(true);
  });

  it('returns non-empty array for Windows', () => {
    const paths = getVSCodeConfigPaths('Windows');
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some(p => p.includes('mcp.json'))).toBe(true);
  });

  it('returns non-empty array for Linux', () => {
    const paths = getVSCodeConfigPaths('Linux');
    expect(paths.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getPlatformInfo
// ---------------------------------------------------------------------------

describe('getPlatformInfo', () => {
  it('returns platform info object for macOS', () => {
    const info = getPlatformInfo('macOS');
    expect(info.platform).toBe('macOS');
    expect(info.isSupported).toBe(true);
    expect(info.vscodeConfigPaths.length).toBeGreaterThan(0);
    expect(info.displayName).toBe('macOS');
  });

  it('returns platform info object for Windows', () => {
    const info = getPlatformInfo('Windows');
    expect(info.platform).toBe('Windows');
    expect(info.isSupported).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPlatformDisplayName
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// normalizePath / isAbsolutePath / getRelativePath
// ---------------------------------------------------------------------------

describe('normalizePath', () => {
  it('normalizes slashes', () => {
    const result = normalizePath('a/b/../c');
    expect(result).toBe(path.normalize('a/b/../c'));
  });
});

describe('isAbsolutePath', () => {
  it('returns true for absolute paths', () => {
    const absPath = process.platform === 'win32' ? 'C:\\Users\\user' : '/home/user';
    expect(isAbsolutePath(absPath)).toBe(true);
  });

  it('returns false for relative paths', () => {
    expect(isAbsolutePath('relative/path')).toBe(false);
  });
});

describe('getRelativePath', () => {
  it('returns relative path between two directories', () => {
    const from = '/home/user';
    const to = '/home/user/projects/app';
    const result = getRelativePath(from, to);
    expect(result).toBe(path.relative(from, to));
  });
});

// ---------------------------------------------------------------------------
// delay
// ---------------------------------------------------------------------------

describe('delay', () => {
  it('resolves after specified milliseconds', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// createTimeoutPromise
// ---------------------------------------------------------------------------

describe('createTimeoutPromise', () => {
  it('resolves with the promise value when done in time', async () => {
    const result = await createTimeoutPromise(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('rejects with timeout error when promise is too slow', async () => {
    const slow = new Promise<never>((_resolve, _reject) => { /* never resolves */ });
    await expect(createTimeoutPromise(slow, 50)).rejects.toThrow('timed out');
  });
});

// ---------------------------------------------------------------------------
// expandPath
// ---------------------------------------------------------------------------

describe('expandPath', () => {
  it('expands ~ to home directory', async () => {
    const result = await expandPath('~/projects');
    expect(result).toBe(path.resolve(os.homedir(), 'projects'));
  });

  it('returns resolved absolute path unchanged', async () => {
    const absPath = process.platform === 'win32' ? 'C:\\Users\\user\\file' : '/home/user/file';
    const result = await expandPath(absPath);
    expect(result).toBe(path.resolve(absPath));
  });

  it('expands ${HOME} env var syntax', async () => {
    process.env.TEST_EXPAND_VAR = '/expanded';
    const result = await expandPath('${TEST_EXPAND_VAR}/sub');
    expect(result).toContain('expanded');
    delete process.env.TEST_EXPAND_VAR;
  });
});
