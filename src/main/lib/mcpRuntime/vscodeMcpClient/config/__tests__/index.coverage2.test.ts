import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  isValidServerConfig: vi.fn(() => true),
}));

vi.mock('../ConfigAdapter', () => ({
  ConfigAdapter: class {},
  createConfigAdapter: vi.fn((options: any) => ({ options })),
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

import { quickConfigDetection } from '../index';
import { detectVSCodeConfigs } from '../detector';
import { parseMcpConfig } from '../parser';
import { readFileContent } from '../utils';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('config/index additional coverage', () => {
  it('falls back to the default missing-config error message', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({ success: false, configFiles: [] });

    const result = await quickConfigDetection();

    expect(result).toEqual({ success: false, errors: ['No configuration file found'] });
  });

  it('falls back to the default read error message', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: true, serverCount: 1, expandedPath: '/cfg.json' }],
    });
    (readFileContent as any).mockResolvedValue({ success: false });

    const result = await quickConfigDetection();

    expect(result).toEqual({ success: false, errors: ['Failed to read configuration file'] });
  });

  it('falls back to the default parse error message', async () => {
    (detectVSCodeConfigs as any).mockResolvedValue({
      success: true,
      configFiles: [{ exists: true, isValid: true, serverCount: 1, expandedPath: '/cfg.json' }],
    });
    (readFileContent as any).mockResolvedValue({ success: true, content: '{}' });
    (parseMcpConfig as any).mockReturnValue({ success: false });

    const result = await quickConfigDetection();

    expect(result).toEqual({ success: false, errors: ['Failed to parse configuration'] });
  });

  it('stringifies non-Error exceptions from detection', async () => {
    (detectVSCodeConfigs as any).mockRejectedValue('unexpected-string-failure');

    const result = await quickConfigDetection();

    expect(result).toEqual({
      success: false,
      errors: ['Quick detection failed: unexpected-string-failure'],
    });
  });
});
