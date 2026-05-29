/**
 * Tests for CreateMcpServerFromConfigTool
 */

const mockMcpClientManagerAdd = vi.fn();

vi.mock('../../mcpClientManager', () => ({
  mcpClientManager: {
    add: (...args: unknown[]) => mockMcpClientManagerAdd(...args),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateMcpServerFromConfigTool } from '../createMcpServerFromConfigTool';

describe('CreateMcpServerFromConfigTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpClientManagerAdd.mockResolvedValue(undefined);
  });

  // ── getDefinition ──────────────────────────────────────────

  describe('getDefinition', () => {
    it('returns correct tool name', () => {
      const def = CreateMcpServerFromConfigTool.getDefinition();
      expect(def.name).toBe('create_mcp_server_from_config');
    });

    it('requires mcp_config in inputSchema', () => {
      const def = CreateMcpServerFromConfigTool.getDefinition();
      expect(def.inputSchema.required).toContain('mcp_config');
    });
  });

  // ── Input validation ───────────────────────────────────────

  describe('execute – input validation', () => {
    it('rejects missing mcp_config', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('rejects empty server name', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: { name: '  ', transport: 'stdio', command: 'node' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('rejects invalid transport', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: { name: 'my-server', transport: 'invalid' as any },
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('rejects stdio without command', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: { name: 'my-server', transport: 'stdio' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('rejects sse without url', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: { name: 'my-server', transport: 'sse' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('rejects StreamableHttp without url', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: { name: 'my-server', transport: 'StreamableHttp' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });
  });

  // ── Successful creation ────────────────────────────────────

  describe('execute – successful creation', () => {
    it('adds stdio server and returns success', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: {
          name: 'my-stdio-server',
          transport: 'stdio',
          command: 'node',
          args: ['index.js'],
          env: { TOKEN: 'abc' },
        },
      });

      expect(result.success).toBe(true);
      expect(result.server_name).toBe('my-stdio-server');
      expect(mockMcpClientManagerAdd).toHaveBeenCalledWith(
        'my-stdio-server',
        expect.objectContaining({
          name: 'my-stdio-server',
          transport: 'stdio',
          command: 'node',
          in_use: true,
          version: '1.0.0',
          source: 'ON-DEVICE',
          remoteVersion: '',
        }),
      );
    });

    it('adds sse server and returns success', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: {
          name: 'my-sse-server',
          transport: 'sse',
          url: 'http://localhost:3000/sse',
        },
      });

      expect(result.success).toBe(true);
      expect(result.server_name).toBe('my-sse-server');
    });

    it('sets remoteVersion to version for IN-LIBRARY source', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: {
          name: 'lib-server',
          transport: 'stdio',
          command: 'npx',
          source: 'IN-LIBRARY',
          version: '2.0.0',
        },
      });

      expect(result.success).toBe(true);
      expect(mockMcpClientManagerAdd).toHaveBeenCalledWith(
        'lib-server',
        expect.objectContaining({
          source: 'IN-LIBRARY',
          version: '2.0.0',
          remoteVersion: '2.0.0',
        }),
      );
    });

    it('defaults version to 1.0.0 when not provided', async () => {
      await CreateMcpServerFromConfigTool.execute({
        mcp_config: {
          name: 'no-version-server',
          transport: 'stdio',
          command: 'node',
        },
      });

      expect(mockMcpClientManagerAdd).toHaveBeenCalledWith(
        'no-version-server',
        expect.objectContaining({ version: '1.0.0' }),
      );
    });

    it('trims whitespace from server name', async () => {
      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: {
          name: '  trimmed-server  ',
          transport: 'stdio',
          command: 'node',
        },
      });

      expect(result.success).toBe(true);
      expect(result.server_name).toBe('trimmed-server');
    });
  });

  // ── Error handling ─────────────────────────────────────────

  describe('execute – error handling', () => {
    it('returns EXECUTION_ERROR when mcpClientManager.add throws', async () => {
      mockMcpClientManagerAdd.mockRejectedValue(new Error('Connection failed'));

      const result = await CreateMcpServerFromConfigTool.execute({
        mcp_config: { name: 'fail-server', transport: 'stdio', command: 'node' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
      expect(result.message).toContain('Connection failed');
    });
  });

  // ── validateConfig ─────────────────────────────────────────

  describe('validateConfig', () => {
    it('returns invalid for non-object config', () => {
      expect(CreateMcpServerFromConfigTool.validateConfig(null)).toMatchObject({ valid: false });
      expect(CreateMcpServerFromConfigTool.validateConfig('str')).toMatchObject({ valid: false });
    });

    it('returns invalid when name is missing', () => {
      expect(
        CreateMcpServerFromConfigTool.validateConfig({ transport: 'stdio', command: 'node' }),
      ).toMatchObject({ valid: false });
    });

    it('returns invalid for unsupported transport', () => {
      expect(
        CreateMcpServerFromConfigTool.validateConfig({ name: 'x', transport: 'ws' }),
      ).toMatchObject({ valid: false });
    });

    it('returns invalid for stdio without command', () => {
      expect(
        CreateMcpServerFromConfigTool.validateConfig({ name: 'x', transport: 'stdio' }),
      ).toMatchObject({ valid: false });
    });

    it('returns invalid for sse without url', () => {
      expect(
        CreateMcpServerFromConfigTool.validateConfig({ name: 'x', transport: 'sse' }),
      ).toMatchObject({ valid: false });
    });

    it('returns valid for correct stdio config', () => {
      expect(
        CreateMcpServerFromConfigTool.validateConfig({ name: 'x', transport: 'stdio', command: 'node' }),
      ).toMatchObject({ valid: true });
    });

    it('returns valid for correct sse config', () => {
      expect(
        CreateMcpServerFromConfigTool.validateConfig({ name: 'x', transport: 'sse', url: 'http://host' }),
      ).toMatchObject({ valid: true });
    });
  });
});
