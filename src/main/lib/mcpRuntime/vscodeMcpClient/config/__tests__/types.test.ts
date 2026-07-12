import { describe, it, expect } from 'vitest';
import {
  isTransportType,
  isMcpServerConfig,
  isParsedMcpConfig,
  DEFAULT_CONFIG_ADAPTER_OPTIONS,
  SUPPORTED_CONFIG_FORMATS,
  SUPPORTED_TRANSPORT_TYPES,
} from '../types';

describe('isTransportType', () => {
  it('returns true for valid transport types', () => {
    expect(isTransportType('stdio')).toBe(true);
    expect(isTransportType('http')).toBe(true);
    expect(isTransportType('sse')).toBe(true);
  });

  it('returns false for invalid transport types', () => {
    expect(isTransportType('ws')).toBe(false);
    expect(isTransportType('StreamableHttp')).toBe(false);
    expect(isTransportType('')).toBe(false);
  });
});

describe('isMcpServerConfig', () => {
  it('returns true for valid config with headers', () => {
    expect(isMcpServerConfig({
      name: 'srv',
      transport: 'http',
      url: 'http://x',
      headers: { 'x-apikey': 'val' },
    })).toBe(true);
  });

  it('returns true for valid stdio config', () => {
    expect(isMcpServerConfig({
      name: 'srv',
      transport: 'stdio',
      command: 'node',
    })).toBe(true);
  });

  it('returns false for missing name', () => {
    expect(isMcpServerConfig({ transport: 'http' })).toBe(false);
  });

  it('returns false for invalid transport', () => {
    expect(isMcpServerConfig({ name: 'srv', transport: 'ws' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isMcpServerConfig(null)).toBeFalsy();
    expect(isMcpServerConfig(undefined)).toBeFalsy();
  });
});

describe('isParsedMcpConfig', () => {
  it('returns true for valid parsed config', () => {
    expect(isParsedMcpConfig({
      transportType: 'sse',
      config: { url: 'http://x', headers: { key: 'val' } },
    })).toBe(true);
  });

  it('returns false for missing transportType', () => {
    expect(isParsedMcpConfig({ config: {} })).toBe(false);
  });

  it('returns false for missing config', () => {
    expect(isParsedMcpConfig({ transportType: 'sse' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isParsedMcpConfig(null)).toBeFalsy();
  });
});

describe('config types constants', () => {
  it('DEFAULT_CONFIG_ADAPTER_OPTIONS has expected defaults', () => {
    expect(DEFAULT_CONFIG_ADAPTER_OPTIONS.autoDetection).toBe(true);
    expect(DEFAULT_CONFIG_ADAPTER_OPTIONS.strictValidation).toBe(false);
    expect(DEFAULT_CONFIG_ADAPTER_OPTIONS.cacheTtl).toBe(5 * 60 * 1000);
  });

  it('SUPPORTED_CONFIG_FORMATS contains expected values', () => {
    expect(SUPPORTED_CONFIG_FORMATS).toContain('settings.json');
    expect(SUPPORTED_CONFIG_FORMATS).toContain('mcp.json');
  });

  it('SUPPORTED_TRANSPORT_TYPES contains expected values', () => {
    expect(SUPPORTED_TRANSPORT_TYPES).toContain('stdio');
    expect(SUPPORTED_TRANSPORT_TYPES).toContain('http');
    expect(SUPPORTED_TRANSPORT_TYPES).toContain('sse');
  });
});
