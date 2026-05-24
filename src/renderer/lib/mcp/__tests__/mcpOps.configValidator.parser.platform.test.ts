// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  validateMcpServerConfig,
  validateBatchImport,
  validateVSCodeConfigBeforeImport,
  getValidationSummary,
  suggestConfigFixes,
} from '../configValidator';
import {
  parseMcpConfig,
  formatToStandardJson,
  formatToMcpServersWrapper,
  isExampleConfiguration,
  formatToVSCodeSettings,
  formatToVSCodeMcpJson,
  convertOpenKosmosToVSCodeConfig,
  parseVSCodeConfigToInternal,
  validateVSCodeConfig,
} from '../mcpConfigParser';
import {
  getCurrentPlatform,
  getVSCodeConfigPath,
  getVSCodeConfigPaths,
  getExpandedVSCodeConfigPath,
  isPlatformSupported,
  getPlatformInfo,
  getAllSupportedPlatforms,
  getPlatformFilePatterns,
  PLATFORM_CONSTANTS,
} from '../platformDetector';
import type { OpenKosmosAppMCPServerConfig } from '../../types/mcpTypes';

// ===== configValidator tests =====

function stdioConfig(overrides: Partial<OpenKosmosAppMCPServerConfig> = {}): OpenKosmosAppMCPServerConfig {
  return {
    name: 'my-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: {},
    url: '',
    in_use: true,
    ...overrides,
  };
}

function sseConfig(overrides: Partial<OpenKosmosAppMCPServerConfig> = {}): OpenKosmosAppMCPServerConfig {
  return {
    name: 'my-sse',
    transport: 'sse',
    command: '',
    args: [],
    env: {},
    url: 'http://localhost:8080/sse',
    in_use: true,
    ...overrides,
  };
}

function httpConfig(overrides: Partial<OpenKosmosAppMCPServerConfig> = {}): OpenKosmosAppMCPServerConfig {
  return {
    name: 'my-http',
    transport: 'StreamableHttp',
    command: '',
    args: [],
    env: {},
    url: 'http://localhost:8080',
    in_use: true,
    ...overrides,
  };
}

describe('validateMcpServerConfig', () => {
  it('passes for a valid stdio configuration', () => {
    const report = validateMcpServerConfig(stdioConfig());
    expect(report.isValid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('passes for a valid SSE configuration', () => {
    const report = validateMcpServerConfig(sseConfig());
    expect(report.isValid).toBe(true);
  });

  it('passes for a valid StreamableHttp configuration', () => {
    const report = validateMcpServerConfig(httpConfig());
    expect(report.isValid).toBe(true);
  });

  it('fails when server name is missing', () => {
    const report = validateMcpServerConfig(stdioConfig({ name: '' }));
    expect(report.isValid).toBe(false);
    expect(report.errors).toContain('Server name is required');
  });

  it('fails for invalid transport type', () => {
    const report = validateMcpServerConfig(stdioConfig({ transport: 'invalid' as any }));
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Invalid transport type'))).toBe(true);
  });

  it('fails when stdio command is missing', () => {
    const report = validateMcpServerConfig(stdioConfig({ command: '' }));
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Command is required'))).toBe(true);
  });

  it('fails when HTTP URL is missing', () => {
    const report = validateMcpServerConfig(httpConfig({ url: '' }));
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('URL is required'))).toBe(true);
  });

  it('warns about invalid URL format for HTTP transport', () => {
    const report = validateMcpServerConfig(httpConfig({ url: 'not-a-url' }));
    expect(report.warnings.some(w => w.includes('Invalid URL format'))).toBe(true);
  });

  it('warns about SSE URL not containing "sse"', () => {
    const report = validateMcpServerConfig(sseConfig({ url: 'http://localhost:8080/api' }));
    expect(report.warnings.some(w => w.includes('does not contain'))).toBe(true);
  });

  it('warns about server name format', () => {
    const report = validateMcpServerConfig(stdioConfig({ name: 'my server!' }));
    expect(report.warnings.some(w => w.includes('alphanumeric'))).toBe(true);
  });

  it('warns about unknown command executable', () => {
    const report = validateMcpServerConfig(stdioConfig({ command: 'myapp' }));
    expect(report.warnings.some(w => w.includes('Command may not be'))).toBe(true);
  });

  it('does NOT warn when command is a common executable', () => {
    const report = validateMcpServerConfig(stdioConfig({ command: 'python' }));
    expect(report.warnings.every(w => !w.includes('Command may not be'))).toBe(true);
  });

  it('does NOT warn when command has path separator', () => {
    const report = validateMcpServerConfig(stdioConfig({ command: '/usr/bin/node' }));
    expect(report.warnings.every(w => !w.includes('Command may not be'))).toBe(true);
  });

  it('does not fail validation for sensitive env variable keys', () => {
    const report = validateMcpServerConfig(stdioConfig({ env: { API_KEY: 'secret' } }));
    // The env rule passes=true, so info entries only come from message when passed=false
    expect(report.isValid).toBe(true);
  });

  it('does not add info when env is empty', () => {
    const report = validateMcpServerConfig(stdioConfig({ env: {} }));
    expect(report.info).toHaveLength(0);
  });

  it('calculates score between 0 and 100', () => {
    const report = validateMcpServerConfig(stdioConfig());
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('returns a low score for heavily broken config', () => {
    const report = validateMcpServerConfig({ name: '', transport: 'invalid' as any, command: '', args: [], env: {}, url: '', in_use: false });
    expect(report.score).toBeLessThan(50);
  });

  it('boosts score for long name, env vars, and args', () => {
    const base = validateMcpServerConfig(stdioConfig());
    const boosted = validateMcpServerConfig(stdioConfig({
      name: 'my-long-server-name',
      args: ['server.js', '--port', '8080'],
      env: { NODE_ENV: 'production' }
    }));
    expect(boosted.score).toBeGreaterThanOrEqual(base.score);
  });
});

describe('validateBatchImport', () => {
  it('validates multiple configs and returns combined result', () => {
    const result = validateBatchImport([stdioConfig(), httpConfig()]);
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(2);
  });

  it('detects duplicate server names', () => {
    const dup1 = stdioConfig({ name: 'same-server' });
    const dup2 = stdioConfig({ name: 'same-server' });
    const result = validateBatchImport([dup1, dup2]);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate server name'))).toBe(true);
  });

  it('reports per-server errors with name prefix', () => {
    const bad = stdioConfig({ name: 'bad-srv', command: '' });
    const result = validateBatchImport([bad]);
    expect(result.errors.some(e => e.startsWith('bad-srv:'))).toBe(true);
  });

  it('returns warnings from individual configs', () => {
    const warned = httpConfig({ url: 'not-a-url' });
    const result = validateBatchImport([warned]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ===== mcpConfigParser tests =====

describe('parseMcpConfig', () => {
  it('returns error for empty input', () => {
    const result = parseMcpConfig('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('handles outer catch when input throws (line 253)', () => {
    // null.trim() throws, which is caught by the outer try/catch
    const result = parseMcpConfig(null as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Parsing error');
  });

  it('returns error for invalid JSON', () => {
    const result = parseMcpConfig('{ not json }');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });

  it('parses Format 1: basic stdio config', () => {
    const result = parseMcpConfig(JSON.stringify({ command: 'node', args: ['server.js'] }));
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('stdio');
    expect(result.data?.config.command).toBe('node');
    expect(result.data?.isAutoGenerated).toBe(true);
  });

  it('parses Format 2: basic SSE config with URL', () => {
    const result = parseMcpConfig(JSON.stringify({ url: 'http://localhost:8080' }));
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('StreamableHttp');
    expect(result.data?.config.url).toBe('http://localhost:8080');
  });

  it('parses Format 3: mcpServers wrapper with StreamableHttp type', () => {
    const input = JSON.stringify({
      mcpServers: {
        'my-server': { type: 'streamable-http', url: 'http://localhost:8080' }
      }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('StreamableHttp');
    expect(result.data?.serverName).toBe('my-server');
    expect(result.data?.isAutoGenerated).toBe(false);
  });

  it('parses Format 4: mcpServers wrapper with stdio type', () => {
    const input = JSON.stringify({
      mcpServers: {
        'my-server': { type: 'stdio', command: 'node', args: [] }
      }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('stdio');
    expect(result.data?.detectedFormat).toContain('Format 4');
  });

  it('parses Format 7: mcpServers wrapper without type (HTTP URL)', () => {
    const input = JSON.stringify({
      mcpServers: { 'srv': { url: 'http://example.com' } }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.detectedFormat).toContain('Format 7');
  });

  it('parses Format 8: mcpServers wrapper without type (stdio command)', () => {
    const input = JSON.stringify({
      mcpServers: { 'srv': { command: 'python' } }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.detectedFormat).toContain('Format 8');
  });

  it('parses Format 5: server fragment with StreamableHttp type', () => {
    const input = JSON.stringify({
      'my-srv': { type: 'http', url: 'http://localhost:8080' }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.detectedFormat).toContain('Format 5');
    expect(result.data?.serverName).toBe('my-srv');
  });

  it('parses Format 6: server fragment with stdio type', () => {
    const input = JSON.stringify({
      'my-srv': { type: 'stdio', command: 'node' }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.detectedFormat).toContain('Format 6');
  });

  it('parses Format 9: server fragment without type (HTTP URL)', () => {
    const input = JSON.stringify({
      'srv': { url: 'http://example.com' }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.detectedFormat).toContain('Format 9');
  });

  it('parses Format 10: server fragment without type (stdio command)', () => {
    const input = JSON.stringify({
      'srv': { command: 'python' }
    });
    const result = parseMcpConfig(input);
    expect(result.success).toBe(true);
    expect(result.data?.detectedFormat).toContain('Format 10');
  });

  it('includes env vars in config when present', () => {
    const result = parseMcpConfig(JSON.stringify({
      command: 'node',
      args: [],
      env: { API_KEY: 'test' }
    }));
    expect(result.success).toBe(true);
    expect(result.data?.config.env).toEqual({ API_KEY: 'test' });
  });

  it('includes env vars for HTTP config when present (line 231)', () => {
    const result = parseMcpConfig(JSON.stringify({
      url: 'http://localhost:8080',
      env: { AUTH_TOKEN: 'secret' }
    }));
    expect(result.success).toBe(true);
    expect(result.data?.config.env).toEqual({ AUTH_TOKEN: 'secret' });
  });

  it('handles currentTransportType=stdio with URL input (auto-detects StreamableHttp, line 76)', () => {
    const result = parseMcpConfig(JSON.stringify({ url: 'http://localhost:8080' }), 'stdio');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('StreamableHttp');
  });

  it('returns currentType when no command/args/url (line 84)', () => {
    const result = parseMcpConfig(JSON.stringify({ name: 'srv' }), 'StreamableHttp');
    // autoDetect returns 'StreamableHttp' from currentType
    expect(result.success).toBe(true);
  });

  it('extracts server name from single-key object fragment (lines 204-206)', () => {
    const result = parseMcpConfig(JSON.stringify({
      'my-special-server': { command: 'node', args: [] }
    }));
    expect(result.success).toBe(true);
    expect(result.data?.serverName).toBe('my-special-server');
  });

  it('getTransportTypeFromTypeField returns StreamableHttp for unknown type (line 63)', () => {
    // Use mcpServers wrapper with an unknown type field
    const result = parseMcpConfig(JSON.stringify({
      mcpServers: { 'srv': { type: 'websocket', url: 'http://localhost' } }
    }));
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('StreamableHttp');
  });

  it('omits env vars when empty', () => {
    const result = parseMcpConfig(JSON.stringify({ command: 'node', env: {} }));
    expect(result.success).toBe(true);
    expect(result.data?.config.env).toBeUndefined();
  });

  it('respects currentTransportType=sse when URL is present', () => {
    const result = parseMcpConfig(JSON.stringify({ url: 'http://localhost:8080' }), 'sse');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('sse');
  });

  it('cleans invisible characters before parsing', () => {
    // BOM + valid JSON
    const result = parseMcpConfig('﻿{"command":"node","args":[]}');
    expect(result.success).toBe(true);
  });

  it('generates a server name when not provided', () => {
    const result = parseMcpConfig(JSON.stringify({ command: 'node' }));
    expect(result.success).toBe(true);
    expect(result.data?.serverName).toMatch(/^mcp-server-\d+$/);
  });
});

describe('formatToStandardJson', () => {
  it('formats stdio config', () => {
    const parsed = parseMcpConfig(JSON.stringify({ command: 'node', args: ['s.js'] }));
    const json = formatToStandardJson(parsed.data!);
    const obj = JSON.parse(json);
    expect(obj.command).toBe('node');
    expect(obj.args).toEqual(['s.js']);
  });

  it('formats HTTP config', () => {
    const parsed = parseMcpConfig(JSON.stringify({ url: 'http://localhost:8080' }));
    const json = formatToStandardJson(parsed.data!);
    const obj = JSON.parse(json);
    expect(obj.url).toBe('http://localhost:8080');
  });

  it('includes env vars when present', () => {
    const parsed = parseMcpConfig(JSON.stringify({ command: 'node', env: { X: 'y' } }));
    const json = formatToStandardJson(parsed.data!);
    const obj = JSON.parse(json);
    expect(obj.env).toEqual({ X: 'y' });
  });

  it('includes env vars for HTTP config (line 283)', () => {
    const parsed = parseMcpConfig(JSON.stringify({ url: 'http://localhost:8080', env: { MY_TOKEN: 'abc' } }));
    const json = formatToStandardJson(parsed.data!);
    const obj = JSON.parse(json);
    expect(obj.env).toEqual({ MY_TOKEN: 'abc' });
  });
});

describe('formatToMcpServersWrapper', () => {
  it('wraps stdio config in mcpServers object', () => {
    const parsed = parseMcpConfig(JSON.stringify({
      mcpServers: { 'my-server': { command: 'node', args: [] } }
    }));
    const json = formatToMcpServersWrapper(parsed.data!);
    const obj = JSON.parse(json);
    expect(obj.mcpServers).toBeDefined();
    expect(obj.mcpServers['my-server']).toBeDefined();
  });

  it('wraps HTTP config in mcpServers object', () => {
    const parsed = parseMcpConfig(JSON.stringify({
      mcpServers: { 'my-http': { url: 'http://localhost:8080' } }
    }));
    const json = formatToMcpServersWrapper(parsed.data!);
    const obj = JSON.parse(json);
    expect(obj.mcpServers['my-http'].url).toBe('http://localhost:8080');
  });

  it('includes env vars in mcpServers wrapper (line 308)', () => {
    const parsed = parseMcpConfig(JSON.stringify({ command: 'node', env: { API_KEY: 'secret' } }));
    const json = formatToMcpServersWrapper(parsed.data!);
    const obj = JSON.parse(json);
    const serverName = Object.keys(obj.mcpServers)[0];
    expect(obj.mcpServers[serverName].env).toEqual({ API_KEY: 'secret' });
  });
});

// ===== platformDetector tests =====

describe('platformDetector', () => {
  it('getCurrentPlatform() returns macOS on Mac user agent', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    expect(getCurrentPlatform()).toBe('macOS');
  });

  it('getCurrentPlatform() returns Windows on Win user agent', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
    expect(getCurrentPlatform()).toBe('Windows');
  });

  it('getCurrentPlatform() returns Linux on Linux user agent', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (X11; Linux x86_64)' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' });
    expect(getCurrentPlatform()).toBe('Linux');
  });

  it('getVSCodeConfigPath() returns a string for macOS', () => {
    expect(typeof getVSCodeConfigPath('macOS')).toBe('string');
    expect(getVSCodeConfigPath('macOS')).toContain('mcp.json');
  });

  it('getVSCodeConfigPath() returns a string for Windows', () => {
    expect(getVSCodeConfigPath('Windows')).toContain('mcp.json');
  });

  it('getVSCodeConfigPaths() returns multiple paths for macOS', () => {
    const paths = getVSCodeConfigPaths('macOS');
    expect(paths.length).toBeGreaterThan(1);
  });

  it('getVSCodeConfigPaths() returns multiple paths for Windows', () => {
    const paths = getVSCodeConfigPaths('Windows');
    expect(paths.length).toBeGreaterThan(1);
  });

  it('getVSCodeConfigPaths() returns paths for Linux', () => {
    const paths = getVSCodeConfigPaths('Linux');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('getExpandedVSCodeConfigPath() returns template path', () => {
    const path = getExpandedVSCodeConfigPath('Windows');
    expect(path).toContain('%APPDATA%');
  });

  it('isPlatformSupported() returns true for macOS and Windows', () => {
    expect(isPlatformSupported('macOS')).toBe(true);
    expect(isPlatformSupported('Windows')).toBe(true);
  });

  it('isPlatformSupported() returns false for Linux', () => {
    expect(isPlatformSupported('Linux')).toBe(false);
  });

  it('getPlatformInfo() returns comprehensive info for macOS', () => {
    const info = getPlatformInfo('macOS');
    expect(info.platform).toBe('macOS');
    expect(info.isSupported).toBe(true);
    expect(info.vscodeConfigPath).toBeDefined();
    expect(info.vscodeConfigPaths.length).toBeGreaterThan(0);
    expect(info.displayName).toBe('macOS');
  });

  it('getPlatformInfo() works for Windows', () => {
    const info = getPlatformInfo('Windows');
    expect(info.platform).toBe('Windows');
    expect(info.isSupported).toBe(true);
  });

  it('getPlatformInfo() works for Linux', () => {
    const info = getPlatformInfo('Linux');
    expect(info.platform).toBe('Linux');
    expect(info.isSupported).toBe(false);
  });

  it('getAllSupportedPlatforms() returns macOS and Windows', () => {
    const platforms = getAllSupportedPlatforms();
    expect(platforms).toHaveLength(2);
    expect(platforms.map(p => p.platform)).toContain('macOS');
    expect(platforms.map(p => p.platform)).toContain('Windows');
  });

  it('getPlatformFilePatterns() returns JSON patterns for macOS', () => {
    const patterns = getPlatformFilePatterns('macOS');
    expect(patterns.some(p => p.extensions.includes('json'))).toBe(true);
  });

  it('getPlatformFilePatterns() returns JSON patterns for Windows', () => {
    const patterns = getPlatformFilePatterns('Windows');
    expect(patterns.some(p => p.extensions.includes('json'))).toBe(true);
  });

  it('getPlatformFilePatterns() returns JSON patterns for Linux', () => {
    const patterns = getPlatformFilePatterns('Linux');
    expect(patterns.some(p => p.extensions.includes('json'))).toBe(true);
  });

  it('PLATFORM_CONSTANTS contains all three platforms', () => {
    expect(PLATFORM_CONSTANTS.macOS).toBeDefined();
    expect(PLATFORM_CONSTANTS.Windows).toBeDefined();
    expect(PLATFORM_CONSTANTS.Linux).toBeDefined();
  });

  it('getVSCodeConfigPaths() returns empty array for unknown platform', () => {
    // Access the default branch
    const paths = getVSCodeConfigPaths('Unknown' as any);
    expect(paths).toEqual([]);
  });

  it('getCurrentPlatform() defaults to macOS for unrecognized platform', () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'SomeOtherBrowser/1.0' });
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'UnknownOS' });
    expect(getCurrentPlatform()).toBe('macOS');
  });

  it('getPlatformFilePatterns() returns JSON patterns for unknown platform', () => {
    const patterns = getPlatformFilePatterns('Unknown' as any);
    expect(patterns.some(p => p.extensions.includes('json'))).toBe(true);
  });
});

// ===== Additional configValidator exports =====

describe('validateVSCodeConfigBeforeImport', () => {
  it('returns invalid for disabled server', () => {
    const result = validateVSCodeConfigBeforeImport('srv', { disabled: true, command: 'node' });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('returns invalid when no command/url present', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {});
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Missing required');
  });

  it('returns invalid for stdio without command', () => {
    const result = validateVSCodeConfigBeforeImport('srv', { type: 'stdio', args: ['s.js'] });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Command is required');
  });

  it('returns invalid for bad URL', () => {
    const result = validateVSCodeConfigBeforeImport('srv', { url: 'not-a-url' });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Invalid URL');
  });

  it('returns valid for a good stdio config', () => {
    const result = validateVSCodeConfigBeforeImport('srv', { type: 'stdio', command: 'node', args: [] });
    expect(result.passed).toBe(true);
  });

  it('returns valid for a good http config with valid URL', () => {
    const result = validateVSCodeConfigBeforeImport('srv', { url: 'http://localhost:8080' });
    expect(result.passed).toBe(true);
  });
});

describe('getValidationSummary', () => {
  it('returns zeros for empty reports', () => {
    const summary = getValidationSummary([]);
    expect(summary.totalServers).toBe(0);
    expect(summary.averageScore).toBe(0);
  });

  it('calculates averageScore correctly', () => {
    const r1 = validateMcpServerConfig(stdioConfig());
    const r2 = validateMcpServerConfig(httpConfig());
    const summary = getValidationSummary([r1, r2]);
    expect(summary.totalServers).toBe(2);
    expect(summary.validServers).toBe(2);
    expect(summary.averageScore).toBeGreaterThan(0);
  });

  it('counts errors and warnings', () => {
    const bad = validateMcpServerConfig(stdioConfig({ name: '', command: '' }));
    const summary = getValidationSummary([bad]);
    expect(summary.totalErrors).toBeGreaterThan(0);
  });
});

describe('suggestConfigFixes', () => {
  it('suggests fix for missing server name', () => {
    const report = validateMcpServerConfig(stdioConfig({ name: '' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('server name'))).toBe(true);
  });

  it('suggests fix for missing command', () => {
    const report = validateMcpServerConfig(stdioConfig({ command: '' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('command'))).toBe(true);
  });

  it('suggests fix for missing URL', () => {
    const report = validateMcpServerConfig(httpConfig({ url: '' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('URL'))).toBe(true);
  });

  it('suggests fix for invalid transport type', () => {
    const report = validateMcpServerConfig(stdioConfig({ transport: 'invalid' as any }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('stdio'))).toBe(true);
  });

  it('suggests fix for invalid URL format warning', () => {
    const report = validateMcpServerConfig(httpConfig({ url: 'bad-url' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('http'))).toBe(true);
  });

  it('suggests fix for invalid server name format warning', () => {
    const report = validateMcpServerConfig(stdioConfig({ name: 'my server!' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('alphanumeric'))).toBe(true);
  });

  it('suggests fix for unknown command warning', () => {
    const report = validateMcpServerConfig(stdioConfig({ command: 'myapp' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('command is installed'))).toBe(true);
  });
});

describe('validateBatchImport (conflicts)', () => {
  it('warns about duplicate URLs across servers', () => {
    const srv1 = httpConfig({ name: 'srv1', url: 'http://localhost:8080' });
    const srv2 = httpConfig({ name: 'srv2', url: 'http://localhost:8080' });
    const result = validateBatchImport([srv1, srv2]);
    expect(result.warnings.some(w => w.includes('same URL'))).toBe(true);
  });
});

// ===== Additional mcpConfigParser exports =====

describe('isExampleConfiguration', () => {
  it('detects the stdio example template', () => {
    const example = `{
  "command": "npx|uvx|python|...",
  "args": [
    "xxx",
    "yyy"
  ],
  "env": {
    "ENV_VAR1": "value1",
    "ENV_VAR2": "value2"
  }
}`;
    expect(isExampleConfiguration(example)).toBe(true);
  });

  it('detects the SSE example template', () => {
    const example = `{
  "url": "http://0.0.0.0:8000/sse"
}`;
    expect(isExampleConfiguration(example)).toBe(true);
  });

  it('returns false for valid custom config', () => {
    expect(isExampleConfiguration(JSON.stringify({ command: 'node', args: ['server.js'] }))).toBe(false);
  });
});

describe('formatToVSCodeSettings', () => {
  it('formats stdio server to settings.json format', () => {
    const result = formatToVSCodeSettings([{
      name: 'srv', transport: 'stdio', command: 'node', args: ['s.js'], env: {}, url: '', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.mcp.servers.srv.type).toBe('stdio');
    expect(obj.mcp.servers.srv.command).toBe('node');
    expect(obj.mcp.servers.srv.args).toEqual(['s.js']);
  });

  it('formats SSE server', () => {
    const result = formatToVSCodeSettings([{
      name: 'srv', transport: 'sse', command: '', args: [], env: {}, url: 'http://localhost/sse', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.mcp.servers.srv.type).toBe('sse');
    expect(obj.mcp.servers.srv.url).toBe('http://localhost/sse');
  });

  it('formats StreamableHttp server', () => {
    const result = formatToVSCodeSettings([{
      name: 'srv', transport: 'StreamableHttp', command: '', args: [], env: {}, url: 'http://localhost:8080', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.mcp.servers.srv.type).toBe('http');
  });

  it('includes env vars', () => {
    const result = formatToVSCodeSettings([{
      name: 'srv', transport: 'stdio', command: 'node', args: [], env: { X: 'y' }, url: '', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.mcp.servers.srv.env).toEqual({ X: 'y' });
  });

  it('skips args when empty', () => {
    const result = formatToVSCodeSettings([{
      name: 'srv', transport: 'stdio', command: 'node', args: [], env: {}, url: '', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.mcp.servers.srv.args).toBeUndefined();
  });
});

describe('formatToVSCodeMcpJson', () => {
  it('formats server to mcp.json format', () => {
    const result = formatToVSCodeMcpJson([{
      name: 'srv', transport: 'stdio', command: 'python', args: ['-m', 'server'], env: {}, url: '', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.servers.srv.command).toBe('python');
    expect(obj.inputs).toEqual([]);
  });

  it('formats StreamableHttp server', () => {
    const result = formatToVSCodeMcpJson([{
      name: 'srv', transport: 'StreamableHttp', command: '', args: [], env: {}, url: 'http://localhost:8080', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.servers.srv.type).toBe('http');
    expect(obj.servers.srv.url).toBe('http://localhost:8080');
  });
});

describe('convertOpenKosmosToVSCodeConfig', () => {
  it('converts stdio config', () => {
    const vsc = convertOpenKosmosToVSCodeConfig({
      name: 'srv', transport: 'stdio', command: 'node', args: ['s.js'], env: {}, url: '', in_use: true
    });
    expect(vsc.type).toBe('stdio');
    expect(vsc.command).toBe('node');
  });

  it('converts sse config', () => {
    const vsc = convertOpenKosmosToVSCodeConfig({
      name: 'srv', transport: 'sse', command: '', args: [], env: {}, url: 'http://localhost/sse', in_use: true
    });
    expect(vsc.type).toBe('sse');
    expect(vsc.url).toBe('http://localhost/sse');
  });

  it('converts StreamableHttp config', () => {
    const vsc = convertOpenKosmosToVSCodeConfig({
      name: 'srv', transport: 'StreamableHttp', command: '', args: [], env: {}, url: 'http://localhost:8080', in_use: true
    });
    expect(vsc.type).toBe('http');
  });

  it('includes env vars', () => {
    const vsc = convertOpenKosmosToVSCodeConfig({
      name: 'srv', transport: 'stdio', command: 'node', args: [], env: { X: 'y' }, url: '', in_use: true
    });
    expect(vsc.env).toEqual({ X: 'y' });
  });
});

describe('parseVSCodeConfigToInternal', () => {
  it('parses settings.json format', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'my-server': { type: 'stdio', command: 'node', args: ['s.js'] } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.serverName).toBe('my-server');
    expect(result.data?.transportType).toBe('stdio');
  });

  it('parses mcp.json format', () => {
    const input = JSON.stringify({
      servers: { 'my-server': { url: 'http://localhost:8080' } },
      inputs: []
    });
    const result = parseVSCodeConfigToInternal(input, 'mcp.json');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('StreamableHttp');
  });

  it('returns error for empty input', () => {
    const result = parseVSCodeConfigToInternal('', 'settings.json');
    expect(result.success).toBe(false);
  });

  it('returns error for invalid JSON', () => {
    const result = parseVSCodeConfigToInternal('{ bad }', 'settings.json');
    expect(result.success).toBe(false);
  });

  it('returns error when no mcp.servers section', () => {
    const result = parseVSCodeConfigToInternal(JSON.stringify({ other: {} }), 'settings.json');
    expect(result.success).toBe(false);
  });

  it('returns error for empty servers object', () => {
    const result = parseVSCodeConfigToInternal(JSON.stringify({ mcp: { servers: {} } }), 'settings.json');
    expect(result.success).toBe(false);
  });

  it('handles SSE URL type', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'sse', url: 'http://localhost/sse' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('sse');
  });

  it('handles http type with /sse URL -> sse transport', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'http', url: 'http://localhost/sse' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.data?.transportType).toBe('sse');
  });

  it('auto-detects stdio from command field', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { command: 'python' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.data?.transportType).toBe('stdio');
  });

  it('auto-detects StreamableHttp from url field without /sse', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { url: 'http://localhost:8080/api' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.data?.transportType).toBe('StreamableHttp');
  });

  it('defaults to stdio when no type/command/url fields', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': {} } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.data?.transportType).toBe('stdio');
  });
});

describe('validateVSCodeConfig', () => {
  it('validates a valid settings.json', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { command: 'node', args: [] } } }
    });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('validates a valid mcp.json', () => {
    const input = JSON.stringify({
      servers: { 'srv': { url: 'http://localhost:8080' } }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('returns invalid for missing mcp section', () => {
    const result = validateVSCodeConfig(JSON.stringify({ other: {} }), 'settings.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('mcp'))).toBe(true);
  });

  it('returns invalid for missing servers section in mcp.json', () => {
    const result = validateVSCodeConfig(JSON.stringify({ other: {} }), 'mcp.json');
    expect(result.isValid).toBe(false);
  });

  it('returns invalid for invalid JSON', () => {
    const result = validateVSCodeConfig('{ bad }', 'settings.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid JSON'))).toBe(true);
  });

  it('returns error for server missing command/url', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'stdio' } } }
    });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('missing required'))).toBe(true);
  });

  it('returns invalid for server with null config', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': null } }
    });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(false);
  });

  it('does not count disabled servers', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { command: 'node', disabled: true } } }
    });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.serverCount).toBe(0);
  });

  it('returns invalid for missing mcp.servers section', () => {
    const input = JSON.stringify({ mcp: {} });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('mcp.servers'))).toBe(true);
  });
});

describe('parseVSCodeConfigToInternal additional branches', () => {
  it('handles http type with /sse URL -> returns sse transport', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'http', url: 'http://localhost:8080/sse' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('sse');
  });

  it('handles streamablehttp type with /sse URL -> returns sse transport', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'streamablehttp', url: 'http://localhost:8080/sse' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('sse');
  });

  it('handles outer parse error gracefully', () => {
    // Pass an object that throws when accessed (forces outer catch)
    const badInput = null as any;
    const result = parseVSCodeConfigToInternal(badInput, 'settings.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Parsing error');
  });

  it('handles http type without /sse URL -> returns StreamableHttp transport', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'http', url: 'http://localhost:8080/api' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('StreamableHttp');
  });

  it('handles unknown vscode type -> falls through to auto-detection', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'websocket', command: 'node' } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    // auto-detect falls back to stdio since command is present
    expect(result.data?.transportType).toBe('stdio');
  });

  it('parseVSCodeConfigToInternal with SSE url without env field on HTTP server (env branch)', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'sse', url: 'http://localhost:8080', env: { MY_KEY: 'val' } } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
  });

  it('parseVSCodeConfigToInternal with stdio server with env vars (line 534 branch)', () => {
    const input = JSON.stringify({
      mcp: { servers: { 'srv': { type: 'stdio', command: 'node', args: ['s.js'], env: { MY_VAR: 'value' } } } }
    });
    const result = parseVSCodeConfigToInternal(input, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.config.env).toEqual({ MY_VAR: 'value' });
  });
});

describe('formatToVSCodeMcpJson additional branches', () => {
  it('includes args when non-empty (line 408)', () => {
    const result = formatToVSCodeMcpJson([{
      name: 'srv', transport: 'stdio', command: 'python', args: ['-m', 'myserver'], env: {}, url: '', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.servers.srv.args).toEqual(['-m', 'myserver']);
  });

  it('sets type to sse for SSE transport (line 416)', () => {
    const result = formatToVSCodeMcpJson([{
      name: 'srv', transport: 'sse', command: '', args: [], env: {}, url: 'http://localhost:8080/sse', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.servers.srv.type).toBe('sse');
  });

  it('includes env when non-empty (line 424)', () => {
    const result = formatToVSCodeMcpJson([{
      name: 'srv', transport: 'stdio', command: 'node', args: [], env: { MY_KEY: 'value' }, url: '', in_use: true
    }]);
    const obj = JSON.parse(result);
    expect(obj.servers.srv.env).toEqual({ MY_KEY: 'value' });
  });
});
