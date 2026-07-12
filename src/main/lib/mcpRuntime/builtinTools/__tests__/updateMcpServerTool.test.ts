/**
 * Tests for UpdateMcpServerTool
 */

const mockMcpClientManagerUpdate = vi.fn();
const mockGetMcpServerInfo = vi.fn();

vi.mock('../../mcpClientManager', () => ({
  mcpClientManager: {
    update: (...args: unknown[]) => mockMcpClientManagerUpdate(...args),
  },
}));

vi.mock('../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    get currentUserAlias() {
      return 'tester';
    },
    getMcpServerInfo: (...args: unknown[]) => mockGetMcpServerInfo(...args),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateMcpServerTool } from '../updateMcpServerTool';

/** Helper: build a minimal existing MCP config */
function existingConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'my-server',
    transport: 'stdio' as const,
    command: 'node',
    args: [],
    env: {},
    url: '',
    version: '1.0.0',
    source: 'ON-DEVICE' as const,
    remoteVersion: '',
    in_use: true,
    ...overrides,
  };
}

describe('UpdateMcpServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpClientManagerUpdate.mockResolvedValue(undefined);
    mockGetMcpServerInfo.mockReturnValue({ config: existingConfig() });
  });

  // ── getDefinition ──────────────────────────────────────────

  describe('getDefinition', () => {
    it('returns correct tool name', () => {
      expect(UpdateMcpServerTool.getDefinition().name).toBe('update_mcp_server');
    });

    it('requires mcp_config', () => {
      expect(UpdateMcpServerTool.getDefinition().inputSchema.required).toContain('mcp_config');
    });
  });

  // ── Input validation ───────────────────────────────────────

  describe('execute – input validation', () => {
    it('rejects missing mcp_config', async () => {
      const result = await UpdateMcpServerTool.execute({} as any);
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });

    it('rejects empty server name', async () => {
      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: '  ' } });
      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_INPUT');
    });
  });

  // ── NOT_INSTALLED ──────────────────────────────────────────

  describe('execute – not installed', () => {
    it('returns NOT_INSTALLED when server does not exist', async () => {
      mockGetMcpServerInfo.mockReturnValue({ config: null });

      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: 'unknown' } });
      expect(result.success).toBe(false);
      expect(result.error).toBe('NOT_INSTALLED');
    });
  });

  // ── ON-DEVICE source rules ─────────────────────────────────

  describe('execute – ON-DEVICE source rules', () => {
    it('auto-increments patch version when source stays ON-DEVICE (explicit)', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'ON-DEVICE' },
      });

      expect(result.success).toBe(true);
      expect(result.old_version).toBe('1.0.0');
      expect(result.new_version).toBe('1.0.1');
      expect(result.new_source).toBe('ON-DEVICE');
    });

    it('auto-increments patch version when no source is specified', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server' },
      });

      expect(result.success).toBe(true);
      expect(result.new_version).toBe('1.0.1');
    });

  });

  // ── Transport validation ───────────────────────────────────

  describe('execute – transport validation', () => {
    it('rejects stdio update without command when result has no command', async () => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({ command: '' }),
      });

      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', transport: 'stdio', source: 'ON-DEVICE' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CONFIG');
    });

    it('rejects sse update without url when result has no url', async () => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({ transport: 'sse', command: '', url: '' }),
      });

      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'ON-DEVICE' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CONFIG');
    });
  });

  // ── ENV merge strategies ───────────────────────────────────

  describe('execute – ENV merge strategies', () => {
    it('replaces ENV entirely for ON-DEVICE updates', async () => {
      await UpdateMcpServerTool.execute({
        mcp_config: {
          name: 'my-server',
          env: { ONLY_KEY: 'val' },
        },
      });

      expect(mockMcpClientManagerUpdate).toHaveBeenCalledWith(
        'my-server',
        expect.objectContaining({ env: { ONLY_KEY: 'val' } }),
      );
    });
  });

  // ── Successful update ──────────────────────────────────────

  describe('execute – successful update', () => {
    it('passes server_name, old/new version and source to result', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server' },
      });

      expect(result.success).toBe(true);
      expect(result.server_name).toBe('my-server');
      expect(result.old_version).toBe('1.0.0');
      expect(result.new_version).toBe('1.0.1');
      expect(result.old_source).toBe('ON-DEVICE');
      expect(result.new_source).toBe('ON-DEVICE');
    });

    it('calls mcpClientManager.update with the updated config', async () => {
      await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', command: 'python' },
      });

      expect(mockMcpClientManagerUpdate).toHaveBeenCalledWith(
        'my-server',
        expect.objectContaining({ command: 'python' }),
      );
    });
  });

  // ── Error handling ─────────────────────────────────────────

  describe('execute – error handling', () => {
    it('returns EXECUTION_ERROR when mcpClientManager.update throws', async () => {
      mockMcpClientManagerUpdate.mockRejectedValue(new Error('network error'));

      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
      expect(result.message).toContain('network error');
    });
  });

  // ── validateConfigForUpdate ────────────────────────────────

  describe('validateConfigForUpdate', () => {
    const base = existingConfig();

    it('returns invalid for null config', () => {
      expect(UpdateMcpServerTool.validateConfigForUpdate(null, base)).toMatchObject({ valid: false });
    });

    it('returns invalid when name is missing', () => {
      expect(
        UpdateMcpServerTool.validateConfigForUpdate({ transport: 'stdio' }, base),
      ).toMatchObject({ valid: false });
    });

    it('returns invalid when name does not match existing', () => {
      expect(
        UpdateMcpServerTool.validateConfigForUpdate({ name: 'other-server' }, base),
      ).toMatchObject({ valid: false });
    });

    it('returns invalid for unsupported transport', () => {
      expect(
        UpdateMcpServerTool.validateConfigForUpdate({ name: 'my-server', transport: 'ws' }, base),
      ).toMatchObject({ valid: false });
    });

    it('returns valid for correct config', () => {
      expect(
        UpdateMcpServerTool.validateConfigForUpdate({ name: 'my-server', transport: 'stdio' }, base),
      ).toMatchObject({ valid: true });
    });

    it('returns valid when transport is omitted', () => {
      expect(
        UpdateMcpServerTool.validateConfigForUpdate({ name: 'my-server' }, base),
      ).toMatchObject({ valid: true });
    });
  });

  // ── version helpers + env/branch coverage ──────────────────
  describe('execute – version and branch coverage', () => {
    it('increments a malformed (non 3-part) ON-DEVICE version', async () => {
      mockGetMcpServerInfo.mockReturnValue({ config: existingConfig({ version: '1.0' }) });

      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: 'my-server' } });

      expect(result.success).toBe(true);
      expect(result.new_version).toBe('1.0.1');
    });

    it('treats non-numeric version segments as zero when incrementing', async () => {
      mockGetMcpServerInfo.mockReturnValue({ config: existingConfig({ version: 'x.y.z' }) });

      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: 'my-server' } });

      expect(result.success).toBe(true);
      expect(result.new_version).toBe('0.0.1');
    });

    it('falls back to ON-DEVICE source and 1.0.0 version when both are missing', async () => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({ source: undefined, version: undefined }),
      });

      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: 'my-server' } });

      expect(result.success).toBe(true);
      expect(result.old_source).toBeUndefined();
      expect(result.new_version).toBe('1.0.1');
    });

    it('merges ENV against an empty base when the existing config has no env', async () => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({ source: 'IN-LIBRARY', version: '1.0.0', env: undefined }),
      });

      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'IN-LIBRARY', version: '2.0.0', env: { NEW_KEY: 'v' } },
      });

      expect(result.success).toBe(true);
      expect(mockMcpClientManagerUpdate).toHaveBeenCalledWith(
        'my-server',
        expect.objectContaining({ env: { NEW_KEY: 'v' } }),
      );
    });

    it('requires a url for sse transport', async () => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({ transport: 'sse', url: '', command: '' }),
      });

      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: 'my-server' } });

      expect(result.success).toBe(false);
      expect(result.error).toBe('INVALID_CONFIG');
    });

    it('keeps explicitly provided args array', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', args: ['--flag'] },
      });

      expect(result.success).toBe(true);
      expect(mockMcpClientManagerUpdate).toHaveBeenCalledWith(
        'my-server',
        expect.objectContaining({ args: ['--flag'] }),
      );
    });

    it('stringifies a non-Error thrown during update', async () => {
      mockMcpClientManagerUpdate.mockRejectedValue('raw string failure');

      const result = await UpdateMcpServerTool.execute({ mcp_config: { name: 'my-server' } });

      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
      expect(result.message).toContain('raw string failure');
    });
  });
});
