import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigAdapter, createConfigAdapter } from '../ConfigAdapter';
import type { McpServerConfig } from '../types';
import { detectVSCodeConfigs, detectCustomConfigFile, detectVscodeConfigFile } from '../detector';

const mockValidateMcpServerConfig = vi.hoisted(() => vi.fn());
const mockValidateBatchImport = vi.hoisted(() => vi.fn());

vi.mock('../validator', async () => {
  const actual = await vi.importActual<typeof import('../validator')>('../validator');
  return {
    ...actual,
    validateMcpServerConfig: mockValidateMcpServerConfig.mockImplementation(actual.validateMcpServerConfig),
    validateBatchImport: mockValidateBatchImport.mockImplementation(actual.validateBatchImport),
    validateVSCodeConfigBeforeImport: actual.validateVSCodeConfigBeforeImport,
  };
});

const mockGetPlatformInfo = vi.hoisted(() => vi.fn().mockReturnValue({
  platform: 'macOS',
  isSupported: true,
  vscodeConfigPath: '/Users/test/.vscode',
  vscodeConfigPaths: ['/Users/test/.vscode'],
  displayName: 'macOS',
}));

// Mock the heavy async modules so tests don't hit the filesystem
vi.mock('../utils', async () => {
  const actual = await vi.importActual('../utils');
  return {
    ...actual,
    getPlatformInfo: mockGetPlatformInfo,
  };
});

vi.mock('../detector', () => ({
  detectVSCodeConfigs: vi.fn().mockResolvedValue({
    success: true,
    platform: 'macOS',
    isSupported: true,
    configFiles: [],
    totalServersFound: 0,
  }),
  detectVscodeConfigFile: vi.fn().mockResolvedValue(null),
  detectSingleConfigFile: vi.fn().mockResolvedValue({
    path: '/x',
    expandedPath: '/x',
    exists: false,
    isValid: false,
    isReadable: false,
    serverCount: 0,
    detectedFormat: 'unknown',
  }),
  detectCustomConfigFile: vi.fn().mockResolvedValue({
    path: '/x',
    expandedPath: '/x',
    exists: false,
    isValid: false,
    isReadable: false,
    serverCount: 0,
    detectedFormat: 'unknown',
  }),
}));

function makeStdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    ...overrides,
  };
}

function makeHttpConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'http-server',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    ...overrides,
  };
}

describe('ConfigAdapter constructor', () => {
  it('instantiates without errors', () => {
    const adapter = new ConfigAdapter({ autoDetection: false });
    expect(adapter).toBeTruthy();
  });

  it('starts auto-detection by default', async () => {
    const { detectVSCodeConfigs } = await import('../detector');
    const mock = vi.mocked(detectVSCodeConfigs);
    mock.mockClear();
    const adapter = new ConfigAdapter({ autoDetection: true });
    // give the async fire-and-forget a tick
    await new Promise(r => setTimeout(r, 10));
    expect(mock).toHaveBeenCalled();
  });

  it('skips auto-detection when disabled', async () => {
    const { detectVSCodeConfigs } = await import('../detector');
    const mock = vi.mocked(detectVSCodeConfigs);
    mock.mockClear();
    new ConfigAdapter({ autoDetection: false });
    await new Promise(r => setTimeout(r, 10));
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('ConfigAdapter.parseConfig', () => {
  let adapter: ConfigAdapter;

  beforeEach(() => {
    adapter = new ConfigAdapter({ autoDetection: false });
  });

  it('parses a generic stdio config', () => {
    const result = adapter.parseConfig(JSON.stringify({ command: 'node', args: ['s.js'] }));
    expect(result.success).toBe(true);
    expect(result.data?.transportType).toBe('stdio');
  });

  it('parses settings.json format when format is specified', () => {
    const content = JSON.stringify({
      mcp: { servers: { myServer: { type: 'stdio', command: 'node', args: [] } } }
    });
    const result = adapter.parseConfig(content, 'settings.json');
    expect(result.success).toBe(true);
    expect(result.data?.serverName).toBe('myServer');
  });

  it('parses mcp.json format', () => {
    const content = JSON.stringify({
      servers: { myServer: { type: 'stdio', command: 'python', args: ['app.py'] } }
    });
    const result = adapter.parseConfig(content, 'mcp.json');
    expect(result.success).toBe(true);
    expect(result.data?.serverName).toBe('myServer');
  });

  it('returns error for invalid JSON', () => {
    const result = adapter.parseConfig('{bad json}');
    expect(result.success).toBe(false);
  });

  it('uses cache on second call with same content', () => {
    const content = JSON.stringify({ command: 'node', args: [] });
    const first = adapter.parseConfig(content);
    const second = adapter.parseConfig(content);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    // Both calls return same data (from cache)
    expect(second.data?.config.command).toBe(first.data?.config.command);
  });

  it('clearCache removes cached entries', () => {
    const content = JSON.stringify({ command: 'node', args: [] });
    adapter.parseConfig(content);
    adapter.clearCache();
    // After clear, parsing still works (no error)
    const result = adapter.parseConfig(content);
    expect(result.success).toBe(true);
  });
});

describe('ConfigAdapter.validateConfig', () => {
  let adapter: ConfigAdapter;

  beforeEach(() => {
    adapter = new ConfigAdapter({ autoDetection: false });
  });

  it('validates a valid stdio config', () => {
    const report = adapter.validateConfig(makeStdioConfig());
    expect(report.isValid).toBe(true);
  });

  it('returns invalid for config missing command', () => {
    const report = adapter.validateConfig(makeStdioConfig({ command: '' }));
    expect(report.isValid).toBe(false);
  });

  it('emits config-validated event', () => {
    const handler = vi.fn();
    adapter.on('config-validated', handler);
    adapter.validateConfig(makeStdioConfig());
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('ConfigAdapter.validateBatchConfigs', () => {
  let adapter: ConfigAdapter;

  beforeEach(() => {
    adapter = new ConfigAdapter({ autoDetection: false });
  });

  it('returns valid for good configs', () => {
    const result = adapter.validateBatchConfigs([makeStdioConfig(), makeHttpConfig()]);
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(2);
  });

  it('returns invalid for duplicate names', () => {
    const configs = [makeStdioConfig({ name: 'dup' }), makeStdioConfig({ name: 'dup' })];
    const result = adapter.validateBatchConfigs(configs);
    expect(result.isValid).toBe(false);
  });
});

describe('ConfigAdapter.exportToVSCodeFormat', () => {
  let adapter: ConfigAdapter;

  beforeEach(() => {
    adapter = new ConfigAdapter({ autoDetection: false });
  });

  it('exports to settings.json format', () => {
    const output = adapter.exportToVSCodeFormat([makeStdioConfig()], 'settings.json');
    const parsed = JSON.parse(output);
    expect(parsed.mcp.servers).toBeDefined();
    expect(parsed.mcp.servers['test-server']).toBeDefined();
  });

  it('exports to mcp.json format', () => {
    const output = adapter.exportToVSCodeFormat([makeStdioConfig()], 'mcp.json');
    const parsed = JSON.parse(output);
    expect(parsed.servers['test-server']).toBeDefined();
    expect(parsed.inputs).toEqual([]);
  });
});

describe('ConfigAdapter.migrateConfigs', () => {
  let adapter: ConfigAdapter;

  beforeEach(() => {
    adapter = new ConfigAdapter({ autoDetection: false });
  });

  it('migrates valid configs successfully', async () => {
    const result = await adapter.migrateConfigs([makeStdioConfig()], 'vscode-settings');
    expect(result.success).toBe(true);
    expect(result.migratedConfigs).toHaveLength(1);
    expect(result.skippedConfigs).toBe(0);
  });

  it('skips invalid configs in strict mode', async () => {
    adapter.updateOptions({ strictValidation: true });
    const invalid = makeStdioConfig({ command: '' }); // missing command → invalid
    const result = await adapter.migrateConfigs([invalid], 'vscode-settings');
    expect(result.skippedConfigs).toBe(1);
    expect(result.migratedConfigs).toHaveLength(0);
  });

  it('emits config-migrated event', async () => {
    const handler = vi.fn();
    adapter.on('config-migrated', handler);
    await adapter.migrateConfigs([makeStdioConfig()], 'openkosmos');
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('ConfigAdapter.getPlatformInfo', () => {
  it('returns platform info', () => {
    const adapter = new ConfigAdapter({ autoDetection: false });
    const info = adapter.getPlatformInfo();
    expect(typeof info.platform).toBe('string');
    expect(typeof info.isSupported).toBe('boolean');
  });
});

describe('ConfigAdapter.getDetectionState', () => {
  it('returns the current detection state', () => {
    const adapter = new ConfigAdapter({ autoDetection: false });
    const state = adapter.getDetectionState();
    expect(state.isDetecting).toBe(false);
    expect(Array.isArray(state.detectedConfigs)).toBe(true);
  });
});

describe('ConfigAdapter.updateOptions', () => {
  it('updates cacheTtl option', () => {
    const adapter = new ConfigAdapter({ autoDetection: false });
    adapter.updateOptions({ cacheTtl: 999 });
    // Verify by re-parsing — no direct way to read cacheTtl, but no error expected
    const result = adapter.parseConfig(JSON.stringify({ command: 'node', args: [] }));
    expect(result.success).toBe(true);
  });
});

describe('createConfigAdapter', () => {
  it('creates an instance of ConfigAdapter', () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    expect(adapter).toBeInstanceOf(ConfigAdapter);
  });
});

describe('ConfigAdapter.validateConfig — headers propagation', () => {
  let adapter: ConfigAdapter;
  beforeEach(() => {
    adapter = createConfigAdapter({ autoDetection: false });
  });

  it('validates HTTP config with headers without error', () => {
    const config: McpServerConfig = {
      name: 'http-srv',
      transport: 'http',
      url: 'http://localhost:8080/mcp',
      headers: { 'x-apikey': 'secret' },
    };
    const report = adapter.validateConfig(config);
    expect(report.serverName).toBe('http-srv');
  });

  it('validates stdio config without headers', () => {
    const config: McpServerConfig = {
      name: 'stdio-srv',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    };
    const report = adapter.validateConfig(config);
    expect(report.serverName).toBe('stdio-srv');
  });
});

describe('ConfigAdapter — exportToVSCodeFormat', () => {
  let adapter: ConfigAdapter;
  beforeEach(() => { adapter = createConfigAdapter({ autoDetection: false }); });

  it('exports to settings.json format', () => {
    const configs: McpServerConfig[] = [{
      name: 'srv', transport: 'http', url: 'http://x', headers: { key: 'val' },
    }];
    const output = adapter.exportToVSCodeFormat(configs, 'settings.json');
    const parsed = JSON.parse(output);
    expect(parsed.mcp.servers.srv).toBeDefined();
  });

  it('exports to mcp.json format', () => {
    const configs: McpServerConfig[] = [{
      name: 'srv', transport: 'sse', url: 'http://x/sse',
    }];
    const output = adapter.exportToVSCodeFormat(configs, 'mcp.json');
    const parsed = JSON.parse(output);
    expect(parsed.servers.srv).toBeDefined();
  });
});

describe('ConfigAdapter — migrateConfigs', () => {
  let adapter: ConfigAdapter;
  beforeEach(() => { adapter = createConfigAdapter({ autoDetection: false }); });

  it('migrates valid configs', async () => {
    const configs: McpServerConfig[] = [{
      name: 'srv', transport: 'http', url: 'http://x', headers: { key: 'val' },
    }];
    const result = await adapter.migrateConfigs(configs, 'openkosmos');
    expect(result.success).toBe(true);
    expect(result.migratedConfigs).toHaveLength(1);
  });

  it('skips invalid configs in strict mode', async () => {
    adapter.updateOptions({ strictValidation: true });
    const configs: McpServerConfig[] = [{
      name: '', transport: 'http', url: 'http://x',
    }];
    const result = await adapter.migrateConfigs(configs, 'openkosmos');
    expect(result.skippedConfigs).toBe(1);
  });
});

describe('ConfigAdapter — utility methods', () => {
  let adapter: ConfigAdapter;
  beforeEach(() => { adapter = createConfigAdapter({ autoDetection: false }); });

  it('getDetectionState returns state copy', () => {
    const state = adapter.getDetectionState();
    expect(state).toBeDefined();
    expect(state.platformInfo).toBeDefined();
  });

  it('getPlatformInfo returns platform info', () => {
    const info = adapter.getPlatformInfo();
    expect(info).toBeDefined();
  });

  it('clearCache does not throw', () => {
    expect(() => adapter.clearCache()).not.toThrow();
  });

  it('updateOptions merges new options', () => {
    adapter.updateOptions({ strictValidation: true });
    const result = adapter.validateBatchConfigs([{
      name: '', transport: 'http', url: 'http://x',
    }]);
    expect(result).toBeDefined();
  });

  it('updateOptions with supportedPlatforms updates detection state formats', () => {
    adapter.updateOptions({ supportedPlatforms: ['macOS', 'Linux'] });
    const state = adapter.getDetectionState();
    expect(state.supportedFormats).toBeDefined();
  });

  it('validateBatchConfigs validates multiple configs', () => {
    const result = adapter.validateBatchConfigs([
      { name: 'a', transport: 'http', url: 'http://a' },
      { name: 'b', transport: 'stdio', command: 'node', args: ['s.js'] },
    ]);
    expect(result).toBeDefined();
    expect(result.serverCount).toBe(2);
  });
});

describe('ConfigAdapter — getSupportedFormats via platform mock', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns macOS formats', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'macOS', isSupported: true,
      vscodeConfigPath: '/x', vscodeConfigPaths: ['/x'], displayName: 'macOS',
    });
    const adapter = new ConfigAdapter({ autoDetection: false });
    const state = adapter.getDetectionState();
    expect(state.supportedFormats).toEqual(['mcp.json', 'settings.json']);
  });

  it('returns Windows formats', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'Windows', isSupported: true,
      vscodeConfigPath: 'C:\\x', vscodeConfigPaths: ['C:\\x'], displayName: 'Windows',
    });
    const adapter = new ConfigAdapter({ autoDetection: false });
    const state = adapter.getDetectionState();
    expect(state.supportedFormats).toEqual(['mcp.json']);
  });

  it('returns Linux formats', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'Linux', isSupported: true,
      vscodeConfigPath: '/x', vscodeConfigPaths: ['/x'], displayName: 'Linux',
    });
    const adapter = new ConfigAdapter({ autoDetection: false });
    const state = adapter.getDetectionState();
    expect(state.supportedFormats).toEqual(['settings.json']);
  });

  it('returns default formats for unknown platform', () => {
    mockGetPlatformInfo.mockReturnValue({
      platform: 'FreeBSD', isSupported: false,
      vscodeConfigPath: '/x', vscodeConfigPaths: ['/x'], displayName: 'FreeBSD',
    });
    const adapter = new ConfigAdapter({ autoDetection: false });
    const state = adapter.getDetectionState();
    expect(state.supportedFormats).toEqual(['mcp.json', 'settings.json']);
  });
});

describe('ConfigAdapter — parseConfig caching and format paths', () => {
  let adapter: ConfigAdapter;
  beforeEach(() => { adapter = createConfigAdapter({ autoDetection: false }); });

  it('parses settings.json format via parseConfig', () => {
    const input = JSON.stringify({
      mcp: { servers: { srv: { type: 'http', url: 'http://x' } } }
    });
    const result = adapter.parseConfig(input, 'settings.json');
    expect(result.success).toBe(true);
  });

  it('parses mcp.json format via parseConfig', () => {
    const input = JSON.stringify({
      servers: { srv: { type: 'stdio', command: 'node', args: ['s.js'] } }
    });
    const result = adapter.parseConfig(input, 'mcp.json');
    expect(result.success).toBe(true);
  });

  it('parses generic format via parseConfig', () => {
    const input = JSON.stringify({ command: 'node', args: ['s.js'] });
    const result = adapter.parseConfig(input);
    expect(result.success).toBe(true);
  });

  it('returns cached result on second call', () => {
    const input = JSON.stringify({ command: 'node', args: ['s.js'] });
    const r1 = adapter.parseConfig(input);
    const r2 = adapter.parseConfig(input);
    expect(r1).toEqual(r2);
  });

  it('parseConfig returns error for invalid content', () => {
    const result = adapter.parseConfig('not json at all');
    expect(result.success).toBe(false);
  });
});

describe('ConfigAdapter — migrateConfigs error paths', () => {
  it('returns error result when migration throws', async () => {
    const adapter = createConfigAdapter({ autoDetection: false, strictValidation: true });
    // Force an error by passing a config that will fail validation in strict mode
    const configs: McpServerConfig[] = [{
      name: '', transport: 'http', url: '',
    }];
    const result = await adapter.migrateConfigs(configs, 'vscode-settings');
    expect(result.skippedConfigs).toBeGreaterThan(0);
  });

  it('migrates to vscode-settings format', async () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    const configs: McpServerConfig[] = [{
      name: 'srv', transport: 'http', url: 'http://x',
    }];
    const result = await adapter.migrateConfigs(configs, 'vscode-settings');
    expect(result.success).toBe(true);
  });

  it('migrates to vscode-mcp format', async () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    const configs: McpServerConfig[] = [{
      name: 'srv', transport: 'sse', url: 'http://x/sse',
    }];
    const result = await adapter.migrateConfigs(configs, 'vscode-mcp');
    expect(result.success).toBe(true);
  });
});

describe('ConfigAdapter — exportToVSCodeFormat error path', () => {
  it('throws on invalid config that breaks formatting', () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    // Force error by passing null-ish configs
    expect(() => adapter.exportToVSCodeFormat(null as any, 'settings.json')).toThrow();
  });
});

describe('ConfigAdapter — error paths for coverage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('startAutoDetection throws when already detecting', async () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    (adapter as any).detectionState.isDetecting = true;
    await expect(adapter.startAutoDetection()).rejects.toThrow('already in progress');
  });

  it('startAutoDetection handles detection error', async () => {
    vi.mocked(detectVSCodeConfigs).mockRejectedValueOnce(new Error('detect fail'));
    const adapter = createConfigAdapter({ autoDetection: false });
    await expect(adapter.startAutoDetection()).rejects.toThrow('detect fail');
  });

  it('startAutoDetection handles non-Error throw', async () => {
    vi.mocked(detectVSCodeConfigs).mockRejectedValueOnce('string error');
    const adapter = createConfigAdapter({ autoDetection: false });
    await expect(adapter.startAutoDetection()).rejects.toThrow('Detection failed');
  });

  it('detectConfigFile handles error', async () => {
    vi.mocked(detectCustomConfigFile).mockRejectedValueOnce(new Error('file error'));
    const adapter = createConfigAdapter({ autoDetection: false });
    await expect(adapter.detectConfigFile('/bad/path')).rejects.toThrow('file error');
  });

  it('getFirstValidConfigPath returns null on error', async () => {
    vi.mocked(detectVscodeConfigFile).mockRejectedValueOnce(new Error('fail'));
    const adapter = createConfigAdapter({ autoDetection: false });
    const result = await adapter.getFirstValidConfigPath();
    expect(result).toBeNull();
  });

  it('migrateConfigs inner catch: per-config error is recorded', async () => {
    const adapter = createConfigAdapter({ autoDetection: false, strictValidation: false });
    // Spy on private convertConfigFormat to throw for one config
    vi.spyOn(adapter as any, 'convertConfigFormat').mockRejectedValueOnce(new Error('convert fail'));
    const configs: McpServerConfig[] = [{ name: 'bad', transport: 'http', url: 'http://x' }];
    const result = await adapter.migrateConfigs(configs, 'openkosmos');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.skippedConfigs).toBe(1);
  });

  it('migrateConfigs outer catch: total failure is recorded', async () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    let callCount = 0;
    adapter.on('config-migrated', () => {
      callCount++;
      if (callCount === 1) throw new Error('emit boom');
    });
    const configs: McpServerConfig[] = [{ name: 'x', transport: 'http', url: 'http://x' }];
    // The outer catch re-emits, which triggers the listener again — but second call doesn't throw
    const result = await adapter.migrateConfigs(configs, 'openkosmos');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Migration process failed');
  });

  it('validateConfig catch returns error report when validator throws', () => {
    mockValidateMcpServerConfig.mockImplementationOnce(() => { throw new Error('validate boom'); });
    const adapter = createConfigAdapter({ autoDetection: false });
    const report = adapter.validateConfig({ name: 'x', transport: 'http', url: 'http://x' });
    expect(report.isValid).toBe(false);
    expect(report.errors[0]).toContain('validate boom');
  });

  it('validateBatchConfigs catch returns error when validator throws', () => {
    mockValidateBatchImport.mockImplementationOnce(() => { throw new Error('batch boom'); });
    const adapter = createConfigAdapter({ autoDetection: false });
    const result = adapter.validateBatchConfigs([{ name: 'x', transport: 'http', url: 'http://x' }]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('batch boom');
  });

  it('parseConfig catch returns error on internal exception', () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    // Pass a format that routes to parseVSCodeConfigToInternal, but with content
    // that will make the cache set fail by corrupting the configCache
    Object.defineProperty(adapter, 'configCache', {
      value: { get: () => undefined, set: () => { throw new Error('cache set boom'); } },
    });
    const result = adapter.parseConfig(JSON.stringify({ servers: { s: { type: 'http', url: 'http://x' } } }), 'mcp.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('cache set boom');
  });

  it('parseConfig catch handles non-Error thrown value', () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    Object.defineProperty(adapter, 'configCache', {
      value: { get: () => undefined, set: () => { throw 'string error'; } },
    });
    const result = adapter.parseConfig(JSON.stringify({ servers: { s: { type: 'http', url: 'http://x' } } }), 'mcp.json');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Configuration parse failed');
  });

  it('validateBatchConfigs catch handles non-Error thrown value', () => {
    mockValidateBatchImport.mockImplementationOnce(() => { throw 'string thrown'; });
    const adapter = createConfigAdapter({ autoDetection: false });
    const result = adapter.validateBatchConfigs([{ name: 'x', transport: 'http', url: 'http://x' }]);
    expect(result.isValid).toBe(false);
  });

  it('detectConfigFile catch handles non-Error thrown value', async () => {
    vi.mocked(detectCustomConfigFile).mockRejectedValueOnce('string error');
    const adapter = createConfigAdapter({ autoDetection: false });
    await expect(adapter.detectConfigFile('/bad')).rejects.toThrow('Configuration file detection failed');
  });

  it('exportToVSCodeFormat catch handles non-Error thrown value', () => {
    const adapter = createConfigAdapter({ autoDetection: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(adapter as any, 'convertToOpenKosmosFormat').mockImplementation(() => { throw 'string error'; });
    expect(() => adapter.exportToVSCodeFormat([{ name: 'x', transport: 'http', url: 'http://x' }], 'settings.json')).toThrow('Failed to export');
  });
});
