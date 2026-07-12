/**
 * Unit tests for ManageMcpFacade
 */
// @ts-nocheck

vi.mock('../../createMcpServerFromConfigTool', () => ({
  CreateMcpServerFromConfigTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Created', server_name: 'test' }),
  },
}));

vi.mock('../../updateMcpServerTool', () => ({
  UpdateMcpServerTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Updated' }),
  },
}));

vi.mock('../../getMcpStatusTool', () => ({
  GetMcpStatusTool: {
    execute: vi.fn().mockResolvedValue({ success: true, status: 'Connected' }),
  },
}));

vi.mock('../../setMcpConnectionStateTool', () => ({
  SetMcpConnectionStateTool: {
    execute: vi.fn().mockResolvedValue({ success: true, message: 'Reconnected' }),
  },
}));

vi.mock('../../../mcpClientManager', () => ({
  mcpClientManager: {
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../../userDataADO/profileCacheManager', () => ({
  profileCacheManager: {
    currentUserAlias: 'test-user',
    getMcpServerInfo: vi.fn().mockReturnValue({
      config: { name: 'test', source: 'ON-DEVICE', version: '1.0.0', transport: 'stdio' },
    }),
  },
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManageMcpFacade } from '../manageMcpFacade';
import { CreateMcpServerFromConfigTool } from '../../createMcpServerFromConfigTool';
import { UpdateMcpServerTool } from '../../updateMcpServerTool';
import { GetMcpStatusTool } from '../../getMcpStatusTool';
import { mcpClientManager } from '../../../mcpClientManager';

describe('ManageMcpFacade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefinition()', () => {
    it('returns correct tool name and schema', () => {
      const def = ManageMcpFacade.getDefinition();
      expect(def.name).toBe('manage_mcp');
      expect(def.inputSchema.required).toEqual(['action', 'name']);
    });
  });

  describe('validation', () => {
    it('rejects missing action', async () => {
      const result = await ManageMcpFacade.execute({ name: 'x' } as any);
      expect(result.success).toBe(false);
    });

    it('rejects missing name', async () => {
      const result = await ManageMcpFacade.execute({ action: 'add' } as any);
      expect(result.success).toBe(false);
      expect(result.message).toContain('name');
    });

    it('rejects invalid action', async () => {
      const result = await ManageMcpFacade.execute({ action: 'fly', name: 'x' } as any);
      expect(result.success).toBe(false);
    });

    it('rejects add without transport', async () => {
      const result = await ManageMcpFacade.execute({ action: 'add', name: 'x' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('transport');
    });

    it('rejects stdio without command', async () => {
      const result = await ManageMcpFacade.execute({ action: 'add', name: 'x', transport: 'stdio' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('command');
    });

    it('rejects sse without url', async () => {
      const result = await ManageMcpFacade.execute({ action: 'add', name: 'x', transport: 'sse' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('url');
    });

    it('rejects StreamableHttp without url', async () => {
      const result = await ManageMcpFacade.execute({ action: 'add', name: 'x', transport: 'StreamableHttp' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('url');
    });
  });

  describe('action=add, direct', () => {
    it('creates a local stdio server', async () => {
      await ManageMcpFacade.execute({
        action: 'add',
        name: 'local',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(CreateMcpServerFromConfigTool.execute).toHaveBeenCalledWith({
        mcp_config: expect.objectContaining({
          name: 'local',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          version: '1.0.0',
        }),
      });
    });

    it('creates sse server', async () => {
      await ManageMcpFacade.execute({
        action: 'add',
        name: 'remote',
        transport: 'sse',
        url: 'http://localhost:3000/sse',
      });

      expect(CreateMcpServerFromConfigTool.execute).toHaveBeenCalledWith({
        mcp_config: expect.objectContaining({
          transport: 'sse',
          url: 'http://localhost:3000/sse',
        }),
      });
    });
  });

  describe('action=update (more cases)', () => {
    it('returns error when currentUserAlias is null', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      const original = (profileCacheManager as any).currentUserAlias;
      (profileCacheManager as any).currentUserAlias = null;
      const result = await ManageMcpFacade.execute({ action: 'update', name: 'test' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('No current user session');
      (profileCacheManager as any).currentUserAlias = original;
    });

    it('treats legacy library metadata as inert', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getMcpServerInfo).mockReturnValueOnce({
        config: { name: 'test', source: 'IN-LIBRARY', version: '2.3.4', transport: 'stdio' },
      } as any);
      await ManageMcpFacade.execute({ action: 'update', name: 'test', env: { KEY: 'val' } });
      expect(UpdateMcpServerTool.execute).toHaveBeenCalledWith({
        mcp_config: { name: 'test', env: { KEY: 'val' } },
      });
    });
  });

  describe('action=remove (error case)', () => {
    it('returns error when delete throws', async () => {
      vi.mocked(mcpClientManager.delete).mockRejectedValueOnce(new Error('delete fail'));
      const result = await ManageMcpFacade.execute({ action: 'remove', name: 'bad-server' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('delete fail');
    });
  });

  describe('getCurrentUserAlias catch', () => {
    it('returns null when currentUserAlias access throws', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      const descriptor = Object.getOwnPropertyDescriptor(profileCacheManager, 'currentUserAlias');
      Object.defineProperty(profileCacheManager, 'currentUserAlias', { get() { throw new Error('cache error'); } });
      const result = await ManageMcpFacade.execute({ action: 'update', name: 'test' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('No current user session');
      // Restore
      if (descriptor) Object.defineProperty(profileCacheManager, 'currentUserAlias', descriptor);
      else (profileCacheManager as any).currentUserAlias = 'test-user';
    });
  });

  describe('action=update', () => {
    it('updates local configuration without synthesizing provenance fields', async () => {
      await ManageMcpFacade.execute({ action: 'update', name: 'test', env: { NEW: 'val' } });

      expect(UpdateMcpServerTool.execute).toHaveBeenCalledWith({
        mcp_config: expect.objectContaining({
          name: 'test',
          env: { NEW: 'val' },
        }),
      });
    });

    it('forwards all provided update fields', async () => {
      await ManageMcpFacade.execute({
        action: 'update',
        name: 'test',
        transport: 'sse',
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
        url: 'http://localhost:3000/sse',
      });

      expect(UpdateMcpServerTool.execute).toHaveBeenCalledWith({
        mcp_config: {
          name: 'test',
          transport: 'sse',
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'secret' },
          url: 'http://localhost:3000/sse',
        },
      });
    });

    it('returns error when server not found', async () => {
      const { profileCacheManager } = await import('../../../../userDataADO/profileCacheManager');
      vi.mocked(profileCacheManager.getMcpServerInfo).mockReturnValueOnce({ config: null } as any);

      const result = await ManageMcpFacade.execute({ action: 'update', name: 'ghost' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('action=remove', () => {
    it('calls mcpClientManager.delete', async () => {
      const result = await ManageMcpFacade.execute({ action: 'remove', name: 'old-server' });
      expect(result.success).toBe(true);
      expect(mcpClientManager.delete).toHaveBeenCalledWith('old-server');
    });

    it('stringifies non-Error delete failures', async () => {
      vi.mocked(mcpClientManager.delete).mockRejectedValueOnce('delete fail');
      const result = await ManageMcpFacade.execute({ action: 'remove', name: 'old-server' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('delete fail');
    });
  });

  describe('action=connect/disconnect/reconnect', () => {
    it('maps to setMcpConnectionState', async () => {
      await ManageMcpFacade.execute({ action: 'reconnect', name: 'github' });
      const { SetMcpConnectionStateTool } = await import('../../setMcpConnectionStateTool');
      expect(SetMcpConnectionStateTool.execute).toHaveBeenCalledWith({ name: 'github', action: 'reconnect' });
    });

    it('maps connect and disconnect actions', async () => {
      const { SetMcpConnectionStateTool } = await import('../../setMcpConnectionStateTool');

      await ManageMcpFacade.execute({ action: 'connect', name: 'github' });
      await ManageMcpFacade.execute({ action: 'disconnect', name: 'github' });

      expect(SetMcpConnectionStateTool.execute).toHaveBeenNthCalledWith(1, { name: 'github', action: 'connect' });
      expect(SetMcpConnectionStateTool.execute).toHaveBeenNthCalledWith(2, { name: 'github', action: 'disconnect' });
    });
  });

  describe('action=status', () => {
    it('maps name to mcp_name', async () => {
      await ManageMcpFacade.execute({ action: 'status', name: 'github' });
      expect(GetMcpStatusTool.execute).toHaveBeenCalledWith({ mcp_name: 'github' });
    });
  });
});
