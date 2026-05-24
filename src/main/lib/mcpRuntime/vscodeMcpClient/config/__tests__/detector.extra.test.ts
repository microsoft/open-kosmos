/**
 * Extra coverage for detector.ts — branches not covered by the base test file.
 * Covers: detectVSCodeConfigs (supported/unsupported platform, error path),
 *         detectVscodeConfigFile, detectSingleConfigFile (readable/valid/invalid branches),
 *         validateConfigContent branches, getDetectionStrategy/getSupportedFormats per platform.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VscodeConfigFile } from '../types';

// ── mock utils so we control file-system behaviour ─────────────────────────────

const {
  mockCheckFileExists,
  mockCheckFileReadable,
  mockReadFileContent,
  mockGetFileStats,
  mockExpandPath,
  mockGetPlatformInfo,
  mockGetVSCodeConfigPaths,
  mockDetectConfigFormat,
  mockValidateJsonFormat,
  mockFsReaddir,
} = vi.hoisted(() => ({
  mockCheckFileExists: vi.fn(),
  mockCheckFileReadable: vi.fn(),
  mockReadFileContent: vi.fn(),
  mockGetFileStats: vi.fn(),
  mockExpandPath: vi.fn(),
  mockGetPlatformInfo: vi.fn(),
  mockGetVSCodeConfigPaths: vi.fn(),
  mockDetectConfigFormat: vi.fn(),
  mockValidateJsonFormat: vi.fn(),
  mockFsReaddir: vi.fn(),
}));

vi.mock('../utils', () => ({
  checkFileExists: mockCheckFileExists,
  checkFileReadable: mockCheckFileReadable,
  readFileContent: mockReadFileContent,
  getFileStats: mockGetFileStats,
  expandPath: mockExpandPath,
  getPlatformInfo: mockGetPlatformInfo,
  getVSCodeConfigPaths: mockGetVSCodeConfigPaths,
  detectConfigFormat: mockDetectConfigFormat,
  validateJsonFormat: mockValidateJsonFormat,
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readdir: mockFsReaddir,
  },
}));

import {
  detectVSCodeConfigs,
  detectVscodeConfigFile,
  detectSingleConfigFile,
  detectCustomConfigFile,
  getPlatformDetectionInfo,
  isValidMcpConfig,
  getConfigQualityScore,
  getDetectionSummary,
} from '../detector';

// ── helpers ────────────────────────────────────────────────────────────────────

const VALID_MCP_JSON = JSON.stringify({
  servers: {
    'my-server': { command: 'node', args: ['index.js'] },
  },
});

const VALID_SETTINGS_JSON = JSON.stringify({
  mcp: {
    servers: {
      'settings-server': { url: 'http://localhost:3000' },
    },
  },
});

function setupSupportedPlatform(platform = 'macOS') {
  mockGetPlatformInfo.mockReturnValue({
    platform,
    isSupported: true,
    vscodeConfigPath: '/mock/path/mcp.json',
    vscodeConfigPaths: ['/mock/path/mcp.json'],
    displayName: platform,
  });
  mockGetVSCodeConfigPaths.mockReturnValue(['/mock/path/mcp.json']);
  mockExpandPath.mockImplementation(async (p: string) => p);
  mockFsReaddir.mockRejectedValue(new Error('no profiles dir'));
}

function setupFileAsValid(content = VALID_MCP_JSON) {
  mockCheckFileExists.mockResolvedValue({ exists: true });
  mockCheckFileReadable.mockResolvedValue({ readable: true });
  mockGetFileStats.mockResolvedValue({ success: true, stats: { size: content.length, lastModified: Date.now() } });
  mockReadFileContent.mockResolvedValue({ success: true, content });
  mockValidateJsonFormat.mockReturnValue({ isValid: true });
  mockDetectConfigFormat.mockReturnValue('mcp.json');
}

// ── detectVSCodeConfigs ────────────────────────────────────────────────────────

describe('detectVSCodeConfigs — unsupported platform', () => {
  it('returns isSupported=false for unsupported platform', async () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'FreeBSD',
      isSupported: false,
      vscodeConfigPath: '',
      vscodeConfigPaths: [],
      displayName: 'FreeBSD',
    });

    const result = await detectVSCodeConfigs();

    expect(result.success).toBe(false);
    expect(result.isSupported).toBe(false);
    expect(result.error).toContain('FreeBSD');
  });
});

describe('detectVSCodeConfigs — supported platform, valid config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupportedPlatform();
    setupFileAsValid(VALID_MCP_JSON);
  });

  it('returns success with found config file', async () => {
    const result = await detectVSCodeConfigs();

    expect(result.success).toBe(true);
    expect(result.isSupported).toBe(true);
    expect(result.configFiles.length).toBeGreaterThan(0);
    expect(result.totalServersFound).toBe(1);
  });

  it('stops scanning after finding valid config with servers', async () => {
    // Second path should not be checked since first is valid
    mockGetVSCodeConfigPaths.mockReturnValue(['/path/one/mcp.json', '/path/two/mcp.json']);
    mockExpandPath.mockImplementation(async (p: string) => p);

    const result = await detectVSCodeConfigs();

    // Only one configFile should be recorded since we break after finding one
    expect(result.configFiles.length).toBe(1);
  });
});

describe('detectVSCodeConfigs — config exists but is invalid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupportedPlatform();
  });

  it('continues to next path when config has no servers', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: 10, lastModified: 0 } });
    mockReadFileContent.mockResolvedValue({ success: true, content: JSON.stringify({ servers: {} }) });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('mcp.json');

    const result = await detectVSCodeConfigs();

    expect(result.success).toBe(true);
    expect(result.totalServersFound).toBe(0);
  });

  it('continues scanning when a path throws during detection', async () => {
    mockGetVSCodeConfigPaths.mockReturnValue(['/bad/path/mcp.json', '/good/path/mcp.json']);
    mockExpandPath.mockImplementation(async (p: string) => p);

    // First path throws
    mockCheckFileExists
      .mockRejectedValueOnce(new Error('access denied'))
      .mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: VALID_MCP_JSON.length, lastModified: 0 } });
    mockReadFileContent.mockResolvedValue({ success: true, content: VALID_MCP_JSON });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('mcp.json');

    const result = await detectVSCodeConfigs();

    expect(result.success).toBe(true);
  });
});

describe('detectVSCodeConfigs — top-level error', () => {
  it('returns failure when getVSCodeConfigPaths throws after platform check passes', async () => {
    // First call (platform check) succeeds, second (config paths) throws
    mockGetPlatformInfo.mockReturnValue({
      platform: 'macOS',
      isSupported: true,
      vscodeConfigPath: '/mock/path/mcp.json',
      vscodeConfigPaths: [],
      displayName: 'macOS',
    });
    mockGetVSCodeConfigPaths.mockImplementation(() => { throw new Error('config paths error'); });

    const result = await detectVSCodeConfigs();

    expect(result.success).toBe(false);
    expect(result.error).toContain('Detection failed');
  });
});

// ── detectVscodeConfigFile ─────────────────────────────────────────────────────

describe('detectVscodeConfigFile — unsupported platform', () => {
  it('returns null for unsupported platform', async () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'FreeBSD',
      isSupported: false,
      vscodeConfigPath: '',
      vscodeConfigPaths: [],
      displayName: 'FreeBSD',
    });

    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });
});

describe('detectVscodeConfigFile — supported platform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupportedPlatform();
  });

  it('returns expanded path when valid config found', async () => {
    setupFileAsValid(VALID_MCP_JSON);

    const result = await detectVscodeConfigFile();
    expect(result).toBe('/mock/path/mcp.json');
  });

  it('returns null when file does not exist', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: false });

    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });

  it('returns null when file exists but has no servers', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: 10, lastModified: 0 } });
    mockReadFileContent.mockResolvedValue({ success: true, content: JSON.stringify({ servers: {} }) });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('mcp.json');

    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });

  it('handles errors during path check and returns null', async () => {
    mockGetPlatformInfo.mockImplementation(() => { throw new Error('oops'); });

    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });
});

// ── detectSingleConfigFile — all branches ─────────────────────────────────────

describe('detectSingleConfigFile — detailed branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns not-readable config when file is not readable', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: false, error: 'Permission denied' });

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.exists).toBe(true);
    expect(result.isReadable).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('returns error when file content cannot be read', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: 10, lastModified: 0 } });
    mockReadFileContent.mockResolvedValue({ success: false, error: 'I/O error' });

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.isReadable).toBe(true);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe('I/O error');
  });

  it('returns error when JSON is invalid', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: 5, lastModified: 0 } });
    mockReadFileContent.mockResolvedValue({ success: true, content: 'not json' });
    mockValidateJsonFormat.mockReturnValue({ isValid: false, error: 'Unexpected token' });

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Invalid JSON format');
  });

  it('returns valid config with serverCount for valid mcp.json', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: true, stats: { size: VALID_MCP_JSON.length, lastModified: 123456 } });
    mockReadFileContent.mockResolvedValue({ success: true, content: VALID_MCP_JSON });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('mcp.json');

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.exists).toBe(true);
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
    expect(result.fileSize).toBe(VALID_MCP_JSON.length);
    expect(result.lastModified).toBe(123456);
  });

  it('returns valid config for settings.json format', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: false });
    mockReadFileContent.mockResolvedValue({ success: true, content: VALID_SETTINGS_JSON });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('settings.json');

    const result = await detectSingleConfigFile('/some/settings.json');

    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
    expect(result.detectedFormat).toBe('settings.json');
  });

  it('detects format from content when format is unknown', async () => {
    const unknownFormatContent = JSON.stringify({
      mcp: { servers: { 'srv1': { command: 'cmd' } } },
    });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: false });
    mockReadFileContent.mockResolvedValue({ success: true, content: unknownFormatContent });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('unknown');

    const result = await detectSingleConfigFile('/some/unknown-config.json');

    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('detects servers format from content when format is unknown', async () => {
    const content = JSON.stringify({
      servers: { 'srv1': { url: 'http://localhost:3000' } },
    });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: false });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('unknown');

    const result = await detectSingleConfigFile('/some/unknown.json');

    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('returns invalid config when server has no command/args/url', async () => {
    const content = JSON.stringify({
      servers: { 'bad-server': { env: { KEY: 'val' } } },
    });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: false });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('mcp.json');

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('missing required configuration');
  });

  it('returns invalid config when server config is null', async () => {
    const content = JSON.stringify({ servers: { 'null-server': null } });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: false });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('mcp.json');

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('invalid configuration');
  });

  it('returns invalid config when no servers found (unknown format, no mcp key)', async () => {
    const content = JSON.stringify({ other: 'stuff' });
    mockCheckFileExists.mockResolvedValue({ exists: true });
    mockCheckFileReadable.mockResolvedValue({ readable: true });
    mockGetFileStats.mockResolvedValue({ success: false });
    mockReadFileContent.mockResolvedValue({ success: true, content });
    mockValidateJsonFormat.mockReturnValue({ isValid: true });
    mockDetectConfigFormat.mockReturnValue('unknown');

    const result = await detectSingleConfigFile('/some/unknown.json');

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('No MCP server found');
  });

  it('returns error in result when unexpected exception is thrown', async () => {
    mockCheckFileExists.mockRejectedValue(new Error('unexpected error'));

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.exists).toBe(false);
    expect(result.error).toContain('Detection error');
  });

  it('uses originalPath as expandedPath when no expandedPath provided', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: false });

    const result = await detectSingleConfigFile('/only-path/mcp.json');

    expect(result.path).toBe('/only-path/mcp.json');
    expect(result.expandedPath).toBe('/only-path/mcp.json');
  });

  it('returns default error message when checkFileExists returns no error text', async () => {
    mockCheckFileExists.mockResolvedValue({ exists: false, error: undefined });

    const result = await detectSingleConfigFile('/some/mcp.json');

    expect(result.error).toBe('File does not exist');
  });
});

// ── detectCustomConfigFile ─────────────────────────────────────────────────────

describe('detectCustomConfigFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('expands the path and calls detectSingleConfigFile', async () => {
    mockExpandPath.mockResolvedValue('/expanded/mcp.json');
    mockCheckFileExists.mockResolvedValue({ exists: false });

    const result = await detectCustomConfigFile('~/mcp.json');

    expect(result.path).toBe('~/mcp.json');
    expect(result.expandedPath).toBe('/expanded/mcp.json');
  });
});

// ── getPlatformDetectionInfo — platform-specific strategies ───────────────────

describe('getPlatformDetectionInfo — platform strategies', () => {
  it('returns macOS strategy and formats', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'macOS',
      isSupported: true,
      vscodeConfigPath: '~/Library/mcp.json',
      vscodeConfigPaths: [],
      displayName: 'macOS',
    });

    const info = getPlatformDetectionInfo();

    expect(info.detectionStrategy).toContain('mcp.json');
    expect(info.supportedFormats.length).toBeGreaterThan(0);
    expect(info.supportedFormats.some((f) => f.includes('settings.json'))).toBe(true);
  });

  it('returns Windows strategy and formats', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'Windows',
      isSupported: true,
      vscodeConfigPath: '%APPDATA%\\Code\\mcp.json',
      vscodeConfigPaths: [],
      displayName: 'Windows',
    });

    const info = getPlatformDetectionInfo();

    expect(info.detectionStrategy).toContain('mcp.json');
    expect(info.supportedFormats.every((f) => f.includes('mcp.json'))).toBe(true);
  });

  it('returns Linux strategy and formats', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'Linux',
      isSupported: false,
      vscodeConfigPath: '~/.config/Code/settings.json',
      vscodeConfigPaths: [],
      displayName: 'Linux',
    });

    const info = getPlatformDetectionInfo();

    expect(info.detectionStrategy).toContain('settings.json');
    expect(info.supportedFormats.some((f) => f.includes('settings.json'))).toBe(true);
  });

  it('returns default strategy for unknown platform', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'BeOS',
      isSupported: false,
      vscodeConfigPath: '',
      vscodeConfigPaths: [],
      displayName: 'BeOS',
    });

    const info = getPlatformDetectionInfo();

    expect(info.detectionStrategy).toContain('No platform-specific strategy');
    expect(info.supportedFormats).toEqual([]);
  });
});

// ── detectVscodeConfigFile — path error fallback ───────────────────────────────

describe('detectVscodeConfigFile — per-path error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupportedPlatform();
  });

  it('skips path on error and returns null when no valid path found', async () => {
    mockCheckFileExists.mockRejectedValue(new Error('EACCES'));

    const result = await detectVscodeConfigFile();
    expect(result).toBeNull();
  });
});
