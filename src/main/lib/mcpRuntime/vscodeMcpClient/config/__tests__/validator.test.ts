import { describe, it, expect } from 'vitest';
import {
  validateMcpServerConfig,
  validateBatchImport,
  validateVSCodeConfigBeforeImport,
  validateVSCodeConfig,
  getValidationSummary,
  suggestConfigFixes,
  convertToOpenKosmosFormat,
  isValidTransportType,
  isValidServerConfig,
} from '../validator';
import type { McpServerConfig } from '../types';

function makeStdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['index.js'],
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

describe('validateMcpServerConfig', () => {
  it('validates a correct stdio config', () => {
    const report = validateMcpServerConfig(makeStdioConfig());
    expect(report.isValid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.serverName).toBe('test-server');
  });

  it('validates a correct http config', () => {
    const report = validateMcpServerConfig(makeHttpConfig());
    expect(report.isValid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('reports error when server name is missing', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ name: '' }));
    expect(report.isValid).toBe(false);
    expect(report.errors).toContain('Server name is required');
  });

  it('reports error for invalid transport type', () => {
    const config = makeStdioConfig({ transport: 'websocket' as any });
    const report = validateMcpServerConfig(config);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Invalid transport type'))).toBe(true);
  });

  it('reports error for stdio missing command', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ command: '' }));
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('requires command'))).toBe(true);
  });

  it('reports error for http missing URL', () => {
    const report = validateMcpServerConfig(makeHttpConfig({ url: '' }));
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('requires URL'))).toBe(true);
  });

  it('reports warning for malformed URL', () => {
    const report = validateMcpServerConfig(makeHttpConfig({ url: 'not-a-url' }));
    expect(report.warnings.some(w => w.includes('Invalid URL format'))).toBe(true);
  });

  it('reports warning for server name with special chars', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ name: 'my server!' }));
    expect(report.warnings.some(w => w.includes('alphanumeric'))).toBe(true);
  });

  it('reports warning for unknown command executable', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ command: 'myweirdtool' }));
    expect(report.warnings.some(w => w.includes('valid executable'))).toBe(true);
  });

  it('does not warn for known executables like npx', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ command: 'npx' }));
    expect(report.warnings.filter(w => w.includes('valid executable'))).toHaveLength(0);
  });

  it('does not error for env vars with sensitive keys (info only when passed=false)', () => {
    // The environmentVariables rule always passes=true, so it only adds to info
    // when the message would otherwise surface — but since passed=true, no entry is added.
    // Validate that the config is otherwise valid.
    const report = validateMcpServerConfig(makeStdioConfig({ env: { API_KEY: 'secret' } }));
    expect(report.isValid).toBe(true);
  });

  it('warns when SSE transport URL does not contain "sse"', () => {
    const report = validateMcpServerConfig({
      name: 'sse-server',
      transport: 'sse',
      url: 'http://localhost:3000/api',
    });
    expect(report.warnings.some(w => w.includes('SSE'))).toBe(true);
  });

  it('warns on working directory with ".."', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ workingDirectory: '/foo/../bar' }));
    expect(report.warnings.some(w => w.includes('relative path'))).toBe(true);
  });

  it('calculates score > 0 for valid config', () => {
    const report = validateMcpServerConfig(makeStdioConfig());
    expect(report.score).toBeGreaterThan(0);
  });

  it('reduces score for errors', () => {
    const goodReport = validateMcpServerConfig(makeStdioConfig());
    const badReport = validateMcpServerConfig(makeStdioConfig({ name: '' }));
    expect(badReport.score).toBeLessThan(goodReport.score);
  });
});

describe('validateBatchImport', () => {
  it('returns valid for a list of valid configs', () => {
    const configs = [makeStdioConfig(), makeHttpConfig()];
    const result = validateBatchImport(configs);
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(2);
  });

  it('reports duplicate server names', () => {
    const configs = [
      makeStdioConfig({ name: 'duplicate' }),
      makeStdioConfig({ name: 'duplicate' }),
    ];
    const result = validateBatchImport(configs);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
  });

  it('reports URL conflicts', () => {
    const configs = [
      makeHttpConfig({ name: 'server1', url: 'http://localhost:3000/mcp' }),
      makeHttpConfig({ name: 'server2', url: 'http://localhost:3000/mcp' }),
    ];
    const result = validateBatchImport(configs);
    expect(result.warnings.some(w => w.includes('same URL'))).toBe(true);
  });

  it('handles empty configs array', () => {
    const result = validateBatchImport([]);
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(0);
  });
});

describe('validateVSCodeConfigBeforeImport', () => {
  it('passes for valid stdio config', () => {
    const result = validateVSCodeConfigBeforeImport('myServer', {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });
    expect(result.passed).toBe(true);
  });

  it('fails for disabled server', () => {
    const result = validateVSCodeConfigBeforeImport('myServer', {
      type: 'stdio',
      command: 'node',
      disabled: true,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('fails when both command and url are missing', () => {
    const result = validateVSCodeConfigBeforeImport('myServer', {});
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Missing required');
  });

  it('fails for stdio type with no command', () => {
    const result = validateVSCodeConfigBeforeImport('myServer', {
      type: 'stdio',
      args: ['something'],
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires command');
  });

  it('fails for invalid URL', () => {
    const result = validateVSCodeConfigBeforeImport('myServer', {
      url: 'not-a-url',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Invalid URL');
  });

  it('passes for valid HTTP config', () => {
    const result = validateVSCodeConfigBeforeImport('myServer', {
      url: 'http://localhost:3000/mcp',
    });
    expect(result.passed).toBe(true);
  });
});

describe('validateVSCodeConfig', () => {
  it('validates settings.json format', () => {
    const input = JSON.stringify({
      mcp: {
        servers: {
          server1: { command: 'node', args: ['server.js'] }
        }
      }
    });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('validates mcp.json format', () => {
    const input = JSON.stringify({
      servers: {
        server1: { url: 'http://localhost:3000' }
      }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('errors on missing mcp section in settings.json', () => {
    const result = validateVSCodeConfig(JSON.stringify({ other: {} }), 'settings.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('"mcp"'))).toBe(true);
  });

  it('errors on missing servers in mcp.json', () => {
    const result = validateVSCodeConfig(JSON.stringify({}), 'mcp.json');
    expect(result.isValid).toBe(false);
  });

  it('errors on missing command/url in server', () => {
    const input = JSON.stringify({
      servers: {
        server1: { type: 'stdio' }  // no command or url
      }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('missing required'))).toBe(true);
  });

  it('does not count disabled servers', () => {
    const input = JSON.stringify({
      servers: {
        server1: { command: 'node', disabled: true }
      }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.serverCount).toBe(0);
  });

  it('returns error for invalid JSON', () => {
    const result = validateVSCodeConfig('{bad json}', 'mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid JSON'))).toBe(true);
  });
});

describe('getValidationSummary', () => {
  it('summarizes multiple reports', () => {
    const reports = [
      { serverName: 'a', isValid: true, errors: [], warnings: ['w1'], info: [], score: 90 },
      { serverName: 'b', isValid: false, errors: ['e1', 'e2'], warnings: [], info: [], score: 60 },
    ];
    const summary = getValidationSummary(reports);
    expect(summary.totalServers).toBe(2);
    expect(summary.validServers).toBe(1);
    expect(summary.totalErrors).toBe(2);
    expect(summary.totalWarnings).toBe(1);
    expect(summary.averageScore).toBe(75);
  });

  it('handles empty reports array', () => {
    const summary = getValidationSummary([]);
    expect(summary.totalServers).toBe(0);
    expect(summary.averageScore).toBe(0);
  });
});

describe('suggestConfigFixes', () => {
  it('suggests fix for missing server name', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ name: '' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('descriptive server name'))).toBe(true);
  });

  it('suggests fix for missing command', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ command: '' }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('command'))).toBe(true);
  });

  it('suggests fix for invalid transport', () => {
    const report = validateMcpServerConfig(makeStdioConfig({ transport: 'websocket' as any }));
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('stdio, http, sse'))).toBe(true);
  });

  it('returns empty array for valid config', () => {
    const report = validateMcpServerConfig(makeStdioConfig());
    const suggestions = suggestConfigFixes(report);
    expect(suggestions).toHaveLength(0);
  });
});

describe('convertToOpenKosmosFormat', () => {
  it('converts stdio config', () => {
    const result = convertToOpenKosmosFormat(makeStdioConfig());
    expect(result.transport).toBe('stdio');
    expect(result.command).toBe('node');
    expect(result.url).toBeUndefined();
  });

  it('converts http config and maps transport to StreamableHttp', () => {
    const result = convertToOpenKosmosFormat(makeHttpConfig());
    expect(result.transport).toBe('StreamableHttp');
    expect(result.url).toBe('http://localhost:3000/mcp');
    expect(result.command).toBeUndefined();
  });

  it('converts sse config keeping transport as sse', () => {
    const config: McpServerConfig = {
      name: 'sse', transport: 'sse', url: 'http://localhost/sse'
    };
    const result = convertToOpenKosmosFormat(config);
    expect(result.transport).toBe('sse');
  });
});

describe('isValidTransportType', () => {
  it('returns true for valid types', () => {
    expect(isValidTransportType('stdio')).toBe(true);
    expect(isValidTransportType('http')).toBe(true);
    expect(isValidTransportType('sse')).toBe(true);
  });

  it('returns false for invalid types', () => {
    expect(isValidTransportType('websocket')).toBe(false);
    expect(isValidTransportType('')).toBe(false);
  });
});

describe('isValidServerConfig', () => {
  it('returns true for valid stdio config', () => {
    expect(isValidServerConfig(makeStdioConfig())).toBe(true);
  });

  it('returns truthy for valid http config', () => {
    expect(isValidServerConfig(makeHttpConfig())).toBeTruthy();
  });

  it('returns falsy when name is missing', () => {
    expect(isValidServerConfig({ transport: 'stdio', command: 'node' })).toBeFalsy();
  });

  it('returns falsy when transport is invalid', () => {
    expect(isValidServerConfig({ name: 'x', transport: 'bad', command: 'node' })).toBeFalsy();
  });

  it('returns falsy for stdio without command', () => {
    expect(isValidServerConfig({ name: 'x', transport: 'stdio' })).toBeFalsy();
  });

  it('returns falsy for http without url', () => {
    expect(isValidServerConfig({ name: 'x', transport: 'http' })).toBeFalsy();
  });

  it('returns falsy for null input', () => {
    expect(isValidServerConfig(null)).toBeFalsy();
  });
});
