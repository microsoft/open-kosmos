import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigAdapter, createConfigAdapter } from '../ConfigAdapter';
import type { McpServerConfig } from '../types';

// Mock the heavy async modules so tests don't hit the filesystem
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
