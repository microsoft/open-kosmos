/**
 * vscodeMcpClient/config/index — coverage tests
 * Covers: checkConfigCompatibility, createDefaultConfigAdapter,
 * CONFIG_MODULE_INFO, quickConfigDetection branches.
 */

vi.mock('../detector', () => ({
  detectVSCodeConfigs: vi.fn(),
  detectVscodeConfigFile: vi.fn(),
  detectSingleConfigFile: vi.fn(),
  detectCustomConfigFile: vi.fn(),
  getPlatformDetectionInfo: vi.fn(),
  isValidMcpConfig: vi.fn(),
  getConfigQualityScore: vi.fn(),
  getDetectionSummary: vi.fn(),
}));

vi.mock('../parser', () => ({
  parseMcpConfig: vi.fn(),
  parseVSCodeConfigToInternal: vi.fn(),
  formatToStandardJson: vi.fn(),
  formatToMcpServersWrapper: vi.fn(),
  formatToVSCodeSettings: vi.fn(),
  formatToVSCodeMcpJson: vi.fn(),
  isExampleConfiguration: vi.fn(),
}));

vi.mock('../validator', () => ({
  validateMcpServerConfig: vi.fn(),
  validateBatchImport: vi.fn(),
  validateVSCodeConfigBeforeImport: vi.fn(),
  validateVSCodeConfig: vi.fn(),
  getValidationSummary: vi.fn(),
  suggestConfigFixes: vi.fn(),
  convertToOpenKosmosFormat: vi.fn(),
  isValidTransportType: vi.fn(),
  isValidServerConfig: vi.fn((c: any) => typeof c === 'object' && c !== null && c.name && c.transport),
}));

vi.mock('../ConfigAdapter', () => ({
  ConfigAdapter: class {},
  createConfigAdapter: vi.fn((opts: any) => ({ opts })),
  defaultConfigAdapter: {},
}));

vi.mock('../utils', () => ({
  checkFileExists: vi.fn(),
  checkFileReadable: vi.fn(),
  readFileContent: vi.fn(),
  getFileStats: vi.fn(),
  expandPath: vi.fn(),
  getCurrentPlatform: vi.fn(),
  isPlatformSupported: vi.fn(),
  getVSCodeConfigPaths: vi.fn(),
  getPlatformInfo: vi.fn(),
  detectConfigFormat: vi.fn(),
  validateJsonFormat: vi.fn(),
  safeJsonStringify: vi.fn(),
  safeJsonParse: vi.fn(),
  generateCacheKey: vi.fn(),
  isCacheExpired: vi.fn(),
}));

import {
  checkConfigCompatibility,
  createDefaultConfigAdapter,
  CONFIG_MODULE_INFO,
  quickConfigDetection,
} from '../index';
import { detectVSCodeConfigs } from '../detector';
import { parseMcpConfig } from '../parser';
import { readFileContent } from '../utils';

describe('checkConfigCompatibility', () => {
  it('returns incompatible when isValidServerConfig returns false', () => {
    const result = checkConfigCompatibility({});
    expect(result.isCompatible).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('returns issues for stdio without command', () => {
    const result = checkConfigCompatibility({ name: 'srv', transport: 'stdio' });
    expect(result.issues).toContain('stdio transport is missing the command field');
  });

  it('returns issues for non-stdio without url', () => {
    const result = checkConfigCompatibility({ name: 'srv', transport: 'http' });
    expect(result.issues).toContain('HTTP/SSE transport is missing the URL');
  });

  it('returns compatible for valid config', () => {
    const result = checkConfigCompatibility({ name: 'srv', transport: 'stdio', command: 'node' });
    expect(result.isCompatible).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

describe('createDefaultConfigAdapter', () => {
  it('returns an adapter instance', () => {
    const adapter = createDefaultConfigAdapter();
    expect(adapter).toBeTruthy();
  });
});

describe('CONFIG_MODULE_INFO', () => {
  it('has the expected name', () => {
    expect(CONFIG_MODULE_INFO.name).toBe('VSCode MCP Client Configuration Module');
  });

  it('lists expected platforms', () => {
    expect(CONFIG_MODULE_INFO.supportedPlatforms).toContain('macOS');
    expect(CONFIG_MODULE_INFO.supportedPlatforms).toContain('Windows');
  });
});

describe('quickConfigDetection', () => {
  it('returns failure when detectVSCodeConfigs fails', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({ success: false, error: 'none found', configFiles: [] });
    const result = await quickConfigDetection();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('none found');
  });

  it('returns failure when no valid config file found', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({
      success: true,
      configFiles: [{ exists: false, isValid: false, serverCount: 0 }],
    });
    const result = await quickConfigDetection();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('No valid configuration file found');
  });

  it('returns failure when file read fails', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: true, serverCount: 2, expandedPath: '/path/to/mcp.json' }],
    });
    (readFileContent as any).mockResolvedValue({ success: false, error: 'Permission denied' });
    const result = await quickConfigDetection();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Permission denied');
  });

  it('returns failure when parsing fails', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: true, serverCount: 1, expandedPath: '/cfg.json' }],
    });
    (readFileContent as any).mockResolvedValue({ success: true, content: '{}' });
    (parseMcpConfig as any).mockReturnValue({ success: false, error: 'bad format' });
    const result = await quickConfigDetection();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('bad format');
  });

  it('returns success with parsed config', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: true, serverCount: 3, expandedPath: '/cfg.json' }],
    });
    (readFileContent as any).mockResolvedValue({ success: true, content: '{"servers":{}}' });
    (parseMcpConfig as any).mockReturnValue({ success: true, data: { servers: {} } });
    const result = await quickConfigDetection();
    expect(result.success).toBe(true);
    expect(result.bestConfigPath).toBe('/cfg.json');
    expect(result.parsedConfig).toEqual({ servers: {} });
  });

  it('returns failure when detectVSCodeConfigs throws', async () => {
    (detectVSCodeConfigs as any).mockRejectedValue(new Error('unexpected'));
    const result = await quickConfigDetection();
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('unexpected');
  });
});
