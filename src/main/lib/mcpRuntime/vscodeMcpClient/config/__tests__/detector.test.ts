import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VscodeConfigFile, VscodeConfigDetectionResult } from '../types';
import {
  isValidMcpConfig,
  getConfigQualityScore,
  getDetectionSummary,
  getPlatformDetectionInfo,
  detectSingleConfigFile,
  detectCustomConfigFile,
} from '../detector';

// ==================== Pure utility function tests ====================

function makeConfigFile(overrides: Partial<VscodeConfigFile> = {}): VscodeConfigFile {
  return {
    path: '/some/path/mcp.json',
    expandedPath: '/some/path/mcp.json',
    exists: true,
    isValid: true,
    isReadable: true,
    serverCount: 2,
    detectedFormat: 'mcp.json',
    ...overrides,
  };
}

describe('isValidMcpConfig', () => {
  it('returns true for a fully valid config file', () => {
    expect(isValidMcpConfig(makeConfigFile())).toBe(true);
  });

  it('returns false when file does not exist', () => {
    expect(isValidMcpConfig(makeConfigFile({ exists: false }))).toBe(false);
  });

  it('returns false when file is not readable', () => {
    expect(isValidMcpConfig(makeConfigFile({ isReadable: false }))).toBe(false);
  });

  it('returns false when config is invalid', () => {
    expect(isValidMcpConfig(makeConfigFile({ isValid: false }))).toBe(false);
  });

  it('returns false when server count is 0', () => {
    expect(isValidMcpConfig(makeConfigFile({ serverCount: 0 }))).toBe(false);
  });
});

describe('getConfigQualityScore', () => {
  it('returns 100 for a fully valid config', () => {
    expect(getConfigQualityScore(makeConfigFile())).toBe(100);
  });

  it('returns 0 for a completely empty config', () => {
    const empty: VscodeConfigFile = {
      path: '/x',
      expandedPath: '/x',
      exists: false,
      isValid: false,
      isReadable: false,
      serverCount: 0,
      detectedFormat: 'unknown',
    };
    expect(getConfigQualityScore(empty)).toBe(0);
  });

  it('returns 70 for exists+readable+valid but no servers and unknown format', () => {
    const file = makeConfigFile({ serverCount: 0, detectedFormat: 'unknown' });
    expect(getConfigQualityScore(file)).toBe(70);
  });

  it('adds 10 for non-unknown format', () => {
    const withFormat = makeConfigFile({ serverCount: 0, detectedFormat: 'mcp.json' });
    const withoutFormat = makeConfigFile({ serverCount: 0, detectedFormat: 'unknown' });
    expect(getConfigQualityScore(withFormat)).toBe(getConfigQualityScore(withoutFormat) + 10);
  });
});

describe('getDetectionSummary', () => {
  it('counts files and valid files', () => {
    const result: VscodeConfigDetectionResult = {
      success: true,
      platform: 'macOS',
      isSupported: true,
      totalServersFound: 3,
      configFiles: [
        makeConfigFile({ serverCount: 3 }),
        makeConfigFile({ exists: false, isValid: false, isReadable: false, serverCount: 0 }),
      ],
    };
    const summary = getDetectionSummary(result);
    expect(summary.totalFiles).toBe(2);
    expect(summary.validFiles).toBe(1);
    expect(summary.totalServers).toBe(3);
  });

  it('identifies the best config file', () => {
    const good = makeConfigFile({ serverCount: 5 });
    const bad = makeConfigFile({ serverCount: 0, isValid: false });
    const result: VscodeConfigDetectionResult = {
      success: true,
      platform: 'macOS',
      isSupported: true,
      totalServersFound: 5,
      configFiles: [bad, good],
    };
    const summary = getDetectionSummary(result);
    expect(summary.bestConfig).toBe(good);
  });

  it('returns undefined bestConfig when no valid file exists', () => {
    const result: VscodeConfigDetectionResult = {
      success: true,
      platform: 'macOS',
      isSupported: true,
      totalServersFound: 0,
      configFiles: [makeConfigFile({ exists: false, isValid: false, isReadable: false, serverCount: 0 })],
    };
    const summary = getDetectionSummary(result);
    expect(summary.bestConfig).toBeUndefined();
  });

  it('handles empty config files array', () => {
    const result: VscodeConfigDetectionResult = {
      success: false,
      platform: 'macOS',
      isSupported: false,
      totalServersFound: 0,
      configFiles: [],
    };
    const summary = getDetectionSummary(result);
    expect(summary.totalFiles).toBe(0);
    expect(summary.bestConfig).toBeUndefined();
  });
});

describe('getPlatformDetectionInfo', () => {
  it('returns detection info with expected fields', () => {
    const info = getPlatformDetectionInfo();
    expect(typeof info.platform).toBe('string');
    expect(typeof info.isSupported).toBe('boolean');
    expect(typeof info.detectionStrategy).toBe('string');
    expect(Array.isArray(info.supportedFormats)).toBe(true);
  });
});

// ==================== detectSingleConfigFile tests ====================

describe('detectSingleConfigFile', () => {
  it('returns non-existent config for a path that does not exist', async () => {
    const result = await detectSingleConfigFile('/non/existent/path/mcp.json');
    expect(result.exists).toBe(false);
    expect(result.isValid).toBe(false);
    expect(result.serverCount).toBe(0);
    expect(result.path).toBe('/non/existent/path/mcp.json');
  });

  it('uses expandedPath when provided', async () => {
    const result = await detectSingleConfigFile('/original', '/non/existent/expanded');
    expect(result.expandedPath).toBe('/non/existent/expanded');
  });
});

describe('detectCustomConfigFile', () => {
  it('returns non-existent config for a non-existent path', async () => {
    const result = await detectCustomConfigFile('/no/such/file.json');
    expect(result.exists).toBe(false);
  });
});
