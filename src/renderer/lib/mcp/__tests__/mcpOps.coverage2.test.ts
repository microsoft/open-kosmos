// @ts-nocheck
/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenKosmosAppMCPServerConfig } from '../../types/mcpTypes';

const validateMcpServerConfigMock = vi.fn();

vi.mock('../configValidator', () => ({
  validateMcpServerConfig: (...args: any[]) => validateMcpServerConfigMock(...args),
}));

import { McpOps } from '../mcpOps';

const validConfig: OpenKosmosAppMCPServerConfig = {
  name: 'coverage-server',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: {},
  url: '',
  in_use: true,
};

function setupWindow(overrides: Record<string, any> = {}) {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      profile: {
        connectMcpServer: vi.fn(async () => ({ success: true })),
        disconnectMcpServer: vi.fn(async () => ({ success: true })),
        reconnectMcpServer: vi.fn(async () => ({ success: true })),
        addMcpServer: vi.fn(async () => ({ success: true })),
        updateMcpServer: vi.fn(async () => ({ success: true })),
        deleteMcpServer: vi.fn(async () => ({ success: true })),
        ...overrides.profile,
      },
      mcp: {
        getServerStatus: vi.fn(async () => ({ success: true, data: [] })),
        getAllTools: vi.fn(async () => ({ success: true, data: [] })),
        executeTool: vi.fn(async () => ({ success: true, data: {} })),
        ...overrides.mcp,
      },
    },
  });
}

beforeEach(() => {
  validateMcpServerConfigMock.mockReset();
  validateMcpServerConfigMock.mockReturnValue({ errors: [], warnings: [], score: 100 });
  setupWindow();
});

describe('mcpOps additional coverage', () => {
  it.each([
    ['connect', () => McpOps.connect('server'), { profile: { connectMcpServer: vi.fn(async () => { throw 'boom'; }) } }],
    ['disconnect', () => McpOps.disconnect('server'), { profile: { disconnectMcpServer: vi.fn(async () => { throw 'boom'; }) } }],
    ['reconnect', () => McpOps.reconnect('server'), { profile: { reconnectMcpServer: vi.fn(async () => { throw 'boom'; }) } }],
    ['add', () => McpOps.add(validConfig), { profile: { addMcpServer: vi.fn(async () => { throw 'boom'; }) } }],
    ['update', () => McpOps.update('server', validConfig), { profile: { updateMcpServer: vi.fn(async () => { throw 'boom'; }) } }],
    ['delete', () => McpOps.delete('server'), { profile: { deleteMcpServer: vi.fn(async () => { throw 'boom'; }) } }],
    ['getServerStatus', () => McpOps.getServerStatus(), { mcp: { getServerStatus: vi.fn(async () => { throw 'boom'; }) } }],
    ['getAllTools', () => McpOps.getAllTools(), { mcp: { getAllTools: vi.fn(async () => { throw 'boom'; }) } }],
    ['executeTool', () => McpOps.executeTool('tool', {}), { mcp: { executeTool: vi.fn(async () => { throw 'boom'; }) } }],
  ])('returns a generic unknown error for non-Error throws in %s', async (_name, invoke, overrides) => {
    setupWindow(overrides as any);

    const result = await invoke();

    expect(result).toEqual({ success: false, error: 'Unknown error occurred' });
  });

  it('uses the non-Error validation fallback message when validation throws a string', () => {
    validateMcpServerConfigMock.mockImplementationOnce(() => {
      throw 'raw-validation-failure';
    });

    const result = McpOps.validate('server', validConfig);

    expect(result).toEqual({
      isValid: false,
      errors: ['Validation error occurred'],
      warnings: [],
      suggestions: ['Please check configuration format and try again'],
      score: 0,
    });
  });

  it('surfaces the legacy zero-length branch in validateServerName', () => {
    const weirdName = {
      length: 0,
      trim: () => 'server-name',
      toString: () => 'server-name',
    } as any;

    expect(McpOps.validateServerName(weirdName)).toEqual({
      isValid: false,
      error: 'Server name cannot be empty',
    });
  });

  it('generates command and URL suggestions from validator errors', () => {
    validateMcpServerConfigMock.mockReturnValueOnce({
      errors: ['stdio transport requires command', 'HTTP/SSE transport requires URL'],
      warnings: [],
      score: 12,
    });

    const result = McpOps.validate('server', validConfig);

    expect(result.suggestions).toContain('Specify the command to execute (e.g., "python", "node", "uvx")');
    expect(result.suggestions).toContain('Provide a valid HTTP/SSE endpoint URL (e.g., "http://localhost:8000")');
  });
});
