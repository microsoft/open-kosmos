/**
 * Tests for config/validator.ts
 */

import { describe, it, expect } from 'vitest';
import {
  validateMcpServerConfig,
  validateBatchImport,
  validateVSCodeConfigBeforeImport,
  getValidationSummary,
  suggestConfigFixes,
  validateVSCodeConfig,
  convertToOpenKosmosFormat,
  isValidTransportType,
  isValidServerConfig
} from '../config/validator';
import type { McpServerConfig, ConfigValidationReport } from '../config/types';

// ---------------------------------------------------------------------------
// validateMcpServerConfig
// ---------------------------------------------------------------------------

describe('validateMcpServerConfig', () => {
  it('passes for a valid stdio config', () => {
    const config: McpServerConfig = {
      name: 'my-server',
      transport: 'stdio',
      command: 'node'
    };
    const report = validateMcpServerConfig(config);
    expect(report.isValid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it('fails when server name is missing', () => {
    const config: McpServerConfig = {
      name: '',
      transport: 'stdio',
      command: 'node'
    };
    const report = validateMcpServerConfig(config);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Server name is required'))).toBe(true);
  });

  it('fails for invalid transport type', () => {
    const config = { name: 'srv', transport: 'ftp' } as any;
    const report = validateMcpServerConfig(config);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('Invalid transport type'))).toBe(true);
  });

  it('fails when stdio config is missing command', () => {
    const config: McpServerConfig = { name: 'srv', transport: 'stdio' };
    const report = validateMcpServerConfig(config);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('requires command'))).toBe(true);
  });

  it('fails when http config is missing url', () => {
    const config: McpServerConfig = { name: 'srv', transport: 'http' };
    const report = validateMcpServerConfig(config);
    expect(report.isValid).toBe(false);
    expect(report.errors.some(e => e.includes('requires URL'))).toBe(true);
  });

  it('warns on invalid URL format', () => {
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'http',
      url: 'not-a-url'
    };
    const report = validateMcpServerConfig(config);
    expect(report.warnings.some(w => w.includes('Invalid URL format'))).toBe(true);
  });

  it('warns when server name has special chars', () => {
    const config: McpServerConfig = {
      name: 'my server!',
      transport: 'stdio',
      command: 'node'
    };
    const report = validateMcpServerConfig(config);
    expect(report.warnings.some(w => w.includes('alphanumeric'))).toBe(true);
  });

  it('includes env in config without causing errors', () => {
    // The environmentVariables rule always returns passed:true, so sensitive
    // env vars do not trigger any info/warning entries via the normal path.
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'stdio',
      command: 'node',
      env: { API_KEY: 'secret123' }
    };
    const report = validateMcpServerConfig(config);
    // No errors should be added for env presence
    expect(report.errors.filter(e => e.includes('env'))).toHaveLength(0);
  });

  it('warns for SSE transport when URL does not contain "sse"', () => {
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'sse',
      url: 'http://host/mcp'
    };
    const report = validateMcpServerConfig(config);
    expect(report.warnings.some(w => w.includes('SSE') && w.includes('sse'))).toBe(true);
  });

  it('warns for path traversal in working directory', () => {
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'stdio',
      command: 'node',
      workingDirectory: '../etc/secret'
    };
    const report = validateMcpServerConfig(config);
    expect(report.warnings.some(w => w.includes('relative path'))).toBe(true);
  });

  it('calculates a positive quality score for valid config', () => {
    const config: McpServerConfig = {
      name: 'my-server',
      transport: 'stdio',
      command: 'node',
      args: ['srv.js']
    };
    const report = validateMcpServerConfig(config);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// validateBatchImport
// ---------------------------------------------------------------------------

describe('validateBatchImport', () => {
  it('passes for a list of valid configs', () => {
    const configs: McpServerConfig[] = [
      { name: 'a', transport: 'stdio', command: 'node' },
      { name: 'b', transport: 'http', url: 'http://host/mcp' }
    ];
    const result = validateBatchImport(configs);
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(2);
  });

  it('reports duplicate server names', () => {
    const configs: McpServerConfig[] = [
      { name: 'dup', transport: 'stdio', command: 'node' },
      { name: 'dup', transport: 'http', url: 'http://host/mcp' }
    ];
    const result = validateBatchImport(configs);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
  });

  it('reports URL conflicts in warnings', () => {
    const configs: McpServerConfig[] = [
      { name: 'a', transport: 'http', url: 'http://host/mcp' },
      { name: 'b', transport: 'http', url: 'http://host/mcp' }
    ];
    const result = validateBatchImport(configs);
    expect(result.warnings.some(w => w.includes('same URL'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateVSCodeConfigBeforeImport
// ---------------------------------------------------------------------------

describe('validateVSCodeConfigBeforeImport', () => {
  it('passes for valid stdio config', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {
      type: 'stdio',
      command: 'node',
      args: ['s.js']
    });
    expect(result.passed).toBe(true);
  });

  it('fails when disabled flag is set', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {
      type: 'stdio',
      command: 'node',
      disabled: true
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('disabled');
  });

  it('fails when neither command nor url is present', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {} as any);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Missing required');
  });

  it('fails for stdio type without command', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {
      type: 'stdio',
      args: ['s.js']
    } as any);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('requires command');
  });

  it('fails for invalid URL', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {
      url: 'not-a-url'
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Invalid URL');
  });

  it('passes for valid http URL', () => {
    const result = validateVSCodeConfigBeforeImport('srv', {
      url: 'http://localhost:3000'
    });
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getValidationSummary
// ---------------------------------------------------------------------------

describe('getValidationSummary', () => {
  it('returns correct aggregate statistics', () => {
    const reports: ConfigValidationReport[] = [
      { serverName: 'a', isValid: true, errors: [], warnings: ['w1'], info: [], score: 90 },
      { serverName: 'b', isValid: false, errors: ['e1', 'e2'], warnings: [], info: [], score: 50 }
    ];
    const summary = getValidationSummary(reports);
    expect(summary.totalServers).toBe(2);
    expect(summary.validServers).toBe(1);
    expect(summary.totalErrors).toBe(2);
    expect(summary.totalWarnings).toBe(1);
    expect(summary.averageScore).toBe(70);
  });

  it('returns zero averageScore for empty reports', () => {
    const summary = getValidationSummary([]);
    expect(summary.averageScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// suggestConfigFixes
// ---------------------------------------------------------------------------

describe('suggestConfigFixes', () => {
  it('suggests fix for missing command', () => {
    const report: ConfigValidationReport = {
      serverName: 'srv',
      isValid: false,
      errors: ['stdio transport requires command'],
      warnings: [],
      info: [],
      score: 0
    };
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('command'))).toBe(true);
  });

  it('suggests URL format fix', () => {
    const report: ConfigValidationReport = {
      serverName: 'srv',
      isValid: true,
      errors: [],
      warnings: ['Invalid URL format'],
      info: [],
      score: 80
    };
    const suggestions = suggestConfigFixes(report);
    expect(suggestions.some(s => s.includes('http'))).toBe(true);
  });

  it('returns empty array when no issues', () => {
    const report: ConfigValidationReport = {
      serverName: 'srv',
      isValid: true,
      errors: [],
      warnings: [],
      info: [],
      score: 100
    };
    expect(suggestConfigFixes(report)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateVSCodeConfig
// ---------------------------------------------------------------------------

describe('validateVSCodeConfig', () => {
  it('validates valid mcp.json', () => {
    const input = JSON.stringify({
      servers: {
        srv: { type: 'stdio', command: 'node' }
      }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('validates valid settings.json', () => {
    const input = JSON.stringify({
      mcp: { servers: { srv: { url: 'http://host/mcp' } } }
    });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(true);
    expect(result.serverCount).toBe(1);
  });

  it('fails when mcp.json missing servers section', () => {
    const input = JSON.stringify({ foo: 'bar' });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('"servers"'))).toBe(true);
  });

  it('fails when settings.json missing mcp section', () => {
    const input = JSON.stringify({ foo: 'bar' });
    const result = validateVSCodeConfig(input, 'settings.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('"mcp"'))).toBe(true);
  });

  it('fails for invalid JSON', () => {
    const result = validateVSCodeConfig('invalid json', 'mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid JSON'))).toBe(true);
  });

  it('ignores disabled servers in serverCount', () => {
    const input = JSON.stringify({
      servers: {
        active: { command: 'node' },
        disabled: { command: 'node', disabled: true }
      }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.serverCount).toBe(1);
  });

  it('errors on server missing required config', () => {
    const input = JSON.stringify({
      servers: { srv: { description: 'no cmd or url' } }
    });
    const result = validateVSCodeConfig(input, 'mcp.json');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('missing required'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// convertToOpenKosmosFormat
// ---------------------------------------------------------------------------

describe('convertToOpenKosmosFormat', () => {
  it('converts stdio config correctly', () => {
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'stdio',
      command: 'node',
      args: ['s.js'],
      env: { K: 'V' }
    };
    const result = convertToOpenKosmosFormat(config);
    expect(result.transport).toBe('stdio');
    expect(result.command).toBe('node');
    expect(result.args).toEqual(['s.js']);
    expect(result.env).toEqual({ K: 'V' });
    expect(result.url).toBeUndefined();
  });

  it('converts http config and maps transport to StreamableHttp', () => {
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'http',
      url: 'http://host/mcp'
    };
    const result = convertToOpenKosmosFormat(config);
    expect(result.transport).toBe('StreamableHttp');
    expect(result.url).toBe('http://host/mcp');
    expect(result.command).toBeUndefined();
  });

  it('converts sse config (transport passes through)', () => {
    const config: McpServerConfig = {
      name: 'srv',
      transport: 'sse',
      url: 'http://host/sse'
    };
    const result = convertToOpenKosmosFormat(config);
    expect(result.transport).toBe('sse');
  });
});

// ---------------------------------------------------------------------------
// isValidTransportType
// ---------------------------------------------------------------------------

describe('isValidTransportType', () => {
  it('returns true for valid types', () => {
    expect(isValidTransportType('stdio')).toBe(true);
    expect(isValidTransportType('http')).toBe(true);
    expect(isValidTransportType('sse')).toBe(true);
  });

  it('returns false for invalid types', () => {
    expect(isValidTransportType('ftp')).toBe(false);
    expect(isValidTransportType('')).toBe(false);
    expect(isValidTransportType('StreamableHttp')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidServerConfig
// ---------------------------------------------------------------------------

describe('isValidServerConfig', () => {
  it('validates a correct stdio config', () => {
    expect(isValidServerConfig({ name: 'srv', transport: 'stdio', command: 'node' })).toBeTruthy();
  });

  it('validates a correct http config', () => {
    expect(isValidServerConfig({ name: 'srv', transport: 'http', url: 'http://host' })).toBeTruthy();
  });

  it('returns falsy when missing command for stdio', () => {
    expect(isValidServerConfig({ name: 'srv', transport: 'stdio' })).toBeFalsy();
  });

  it('returns falsy when missing url for http', () => {
    expect(isValidServerConfig({ name: 'srv', transport: 'http' })).toBeFalsy();
  });

  it('returns falsy for null input', () => {
    expect(isValidServerConfig(null)).toBeFalsy();
  });

  it('returns falsy for non-string name', () => {
    expect(isValidServerConfig({ name: 123, transport: 'stdio', command: 'node' })).toBeFalsy();
  });
});
