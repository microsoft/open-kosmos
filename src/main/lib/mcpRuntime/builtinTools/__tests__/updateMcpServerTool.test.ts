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

vi.mock('../../../startupUpdate/startupUpdateService', () => ({
  mergeEnv: (local: Record<string, string>, remote: Record<string, string>) => ({
    ...remote,
    ...local,
  }),
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

    it('upgrades ON-DEVICE to IN-LIBRARY when new version is greater', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'IN-LIBRARY', version: '2.0.0' },
      });

      expect(result.success).toBe(true);
      expect(result.new_source).toBe('IN-LIBRARY');
      expect(result.new_version).toBe('2.0.0');
    });

    it('rejects ON-DEVICE->IN-LIBRARY without version', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'IN-LIBRARY' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('VERSION_REQUIRED');
    });

    it('rejects ON-DEVICE->IN-LIBRARY when new version is not greater', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'IN-LIBRARY', version: '1.0.0' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('VERSION_NOT_GREATER');
    });
  });

  // ── IN-LIBRARY source rules ────────────────────────────────

  describe('execute – IN-LIBRARY source rules', () => {
    beforeEach(() => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({ source: 'IN-LIBRARY', version: '2.0.0' }),
      });
    });

    it('cannot downgrade IN-LIBRARY to ON-DEVICE', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'ON-DEVICE' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('SOURCE_OVERRIDE_NOT_ALLOWED');
    });

    it('updates IN-LIBRARY to higher version', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'IN-LIBRARY', version: '3.0.0' },
      });

      expect(result.success).toBe(true);
      expect(result.new_version).toBe('3.0.0');
    });

    it('rejects IN-LIBRARY update without version', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server', source: 'IN-LIBRARY' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('VERSION_REQUIRED');
    });

    it('rejects IN-LIBRARY update when no source specified at all', async () => {
      const result = await UpdateMcpServerTool.execute({
        mcp_config: { name: 'my-server' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('SOURCE_AND_VERSION_REQUIRED');
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
    it('merges ENV for IN-LIBRARY updates (local values take precedence)', async () => {
      mockGetMcpServerInfo.mockReturnValue({
        config: existingConfig({
          source: 'IN-LIBRARY',
          version: '2.0.0',
          env: { LOCAL_KEY: 'local-val', SHARED: 'local-shared' },
        }),
      });

      await UpdateMcpServerTool.execute({
        mcp_config: {
          name: 'my-server',
          source: 'IN-LIBRARY',
          version: '3.0.0',
          env: { NEW_KEY: 'new-val', SHARED: 'remote-shared' },
        },
      });

      expect(mockMcpClientManagerUpdate).toHaveBeenCalledWith(
        'my-server',
        expect.objectContaining({
          env: expect.objectContaining({
            LOCAL_KEY: 'local-val',
            SHARED: 'local-shared', // local wins
            NEW_KEY: 'new-val',
          }),
        }),
      );
    });

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
});
