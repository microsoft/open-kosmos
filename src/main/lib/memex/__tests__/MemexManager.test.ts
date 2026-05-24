// @ts-nocheck
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock child_process with callback-based exec so that real promisify works
vi.mock('child_process', () => {
  return { exec: vi.fn() };
});

vi.mock('../../utilities/safeConsole', async () => ({
  safeConsole: {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { safeConsole } from '../../utilities/safeConsole';

// Import exec mock AFTER vi.mock declarations
import { exec } from 'child_process';
const mockedExec = vi.mocked(exec as any);

/** Configure exec to succeed with given stdout */
function execOk(stdout = '') {
  mockedExec.mockImplementationOnce((_cmd: string, cb: Function) => {
    cb(null, stdout, '');
    return {} as any;
  });
}

/** Configure exec to fail with an error */
function execFail(msg = 'command not found') {
  mockedExec.mockImplementationOnce((_cmd: string, cb: Function) => {
    cb(new Error(msg), '', '');
    return {} as any;
  });
}

import { MemexManager } from '../MemexManager';

function makeDeps(overrides: Partial<Record<string, any>> = {}) {
  const pcManager = {
    addMcpServerConfig: vi.fn().mockResolvedValue(true),
    deleteMcpServerConfig: vi.fn().mockResolvedValue(true),
    getAllMcpServerInfo: vi.fn().mockReturnValue([]),
    getAllChatConfigs: vi.fn().mockReturnValue([]),
    updateChatAgent: vi.fn().mockResolvedValue(true),
  };
  const mcpManager = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const mainWindow = {
    webContents: { send: vi.fn() },
  };

  const deps = {
    getAlias: vi.fn().mockReturnValue('alice'),
    getProfileCacheManager: vi.fn().mockResolvedValue(pcManager),
    getMcpClientManager: vi.fn().mockResolvedValue(mcpManager),
    getUserDataDir: vi.fn().mockReturnValue('/data'),
    getMainWindow: vi.fn().mockReturnValue(mainWindow),
    ...overrides,
  };

  return { deps, pcManager, mcpManager, mainWindow };
}

describe('MemexManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── ensureMemexInstalled (exercised via enable) ──────────────────────────

  describe('ensureMemexInstalled (via enable)', () => {
    it('proceeds without installing when memex is already on PATH', async () => {
      execOk('0.1.27'); // memex --version succeeds
      const { deps, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([]);
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(true);
      expect(mockedExec).toHaveBeenCalledTimes(1);
    });

    it('installs the CLI when it is missing and verifies afterwards', async () => {
      execFail('not found');  // memex --version → fail
      execOk('');             // npm install → ok
      execOk('0.1.27');       // post-install memex --version → ok
      const { deps, mainWindow, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([]);
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(true);
      expect(mockedExec).toHaveBeenCalledTimes(3);
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('memex:phaseChange', 'installing');
    });

    it('returns error when npm install fails', async () => {
      execFail('not found');  // memex --version → fail
      execFail('EACCES');     // npm install → fail
      const { deps } = makeDeps();
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to install memex CLI/);
      expect(result.error).toMatch(/EACCES/);
    });

    it('returns error when npm install succeeds but binary still not found', async () => {
      execFail('not found');  // memex --version → fail
      execOk('');             // npm install → ok
      execFail('not found');  // post-install memex --version → fail
      const { deps } = makeDeps();
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cannot be found on PATH/);
    });

    it('wraps non-Error install failure in message (else branch of instanceof Error)', async () => {
      // execFail uses Error objects; we need a non-Error rejection — override manually
      mockedExec.mockImplementationOnce((_cmd: string, cb: Function) => {
        cb(new Error('not found'), '', ''); // version check fails
        return {} as any;
      });
      mockedExec.mockImplementationOnce((_cmd: string, cb: Function) => {
        // npm install fails with a non-Error (primitive)
        cb('string-failure', '', '');
        return {} as any;
      });
      const { deps } = makeDeps();
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(false);
      // The catch wraps with installErr.message (undefined for non-Error) or installErr itself
      expect(result.error).toMatch(/Failed to install memex CLI/);
    });
  });

  // ─── enable ────────────────────────────────────────────────────────────────

  describe('enable', () => {
    beforeEach(() => {
      execOk('0.1.27'); // default: memex already installed
    });

    it('returns error when alias is empty', async () => {
      const { deps } = makeDeps({ getAlias: vi.fn().mockReturnValue('') });
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result).toEqual({ success: false, error: 'No current user alias' });
    });

    it('skips non-agent chats', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([{ chat_id: 'c1' }]);
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(true);
      expect(pcManager.addMcpServerConfig).not.toHaveBeenCalled();
    });

    it('skips chats that already have a memex server registered', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [] } },
      ]);
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-c1' } }]);
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(true);
      expect(pcManager.addMcpServerConfig).not.toHaveBeenCalled();
    });

    it('registers memex server and binds to agent when not yet present', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [] } },
      ]);
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(true);
      expect(pcManager.addMcpServerConfig).toHaveBeenCalledWith(
        'alice',
        expect.objectContaining({ name: 'memex-c1', command: 'memex' })
      );
      expect(pcManager.updateChatAgent).toHaveBeenCalledWith(
        'alice', 'c1',
        expect.objectContaining({
          mcp_servers: expect.arrayContaining([expect.objectContaining({ name: 'memex-c1' })]),
        })
      );
      await Promise.resolve();
      expect(mcpManager.connect).toHaveBeenCalledWith('memex-c1');
    });

    it('does not update agent mcp_servers when server already bound', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [{ name: 'memex-c1', tools: [] }] } },
      ]);
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      const manager = new MemexManager(deps);
      await manager.enable();
      expect(pcManager.updateChatAgent).not.toHaveBeenCalled();
    });

    it('logs a warning via safeConsole when connect rejects (fire-and-forget catch)', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [] } },
      ]);
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      mcpManager.connect.mockRejectedValue(new Error('conn failed'));
      const manager = new MemexManager(deps);
      await manager.enable();
      // Flush microtask queue so the .catch handler runs
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(safeConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect memex-c1'),
        expect.any(Error)
      );
    });

    it('sends configuring phase when alias is valid', async () => {
      const { deps, mainWindow, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([]);
      const manager = new MemexManager(deps);
      await manager.enable();
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('memex:phaseChange', 'configuring');
    });

    it('tolerates null mainWindow (no crash)', async () => {
      const { deps, pcManager } = makeDeps({ getMainWindow: vi.fn().mockReturnValue(null) });
      pcManager.getAllChatConfigs.mockReturnValue([]);
      const manager = new MemexManager(deps);
      await expect(manager.enable()).resolves.toEqual({ success: true });
    });

    it('returns error on unexpected exception', async () => {
      const { deps } = makeDeps({
        getProfileCacheManager: vi.fn().mockRejectedValue(new Error('db crash')),
      });
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result).toEqual({ success: false, error: 'db crash' });
    });

    it('handles null mcp_servers on agent (uses empty array fallback)', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: null } },
      ]);
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result.success).toBe(true);
      expect(pcManager.updateChatAgent).toHaveBeenCalledWith(
        'alice', 'c1',
        expect.objectContaining({
          mcp_servers: expect.arrayContaining([expect.objectContaining({ name: 'memex-c1' })]),
        })
      );
    });

    it('returns error on non-Error exception', async () => {
      const { deps } = makeDeps({
        // eslint-disable-next-line prefer-promise-reject-errors
        getProfileCacheManager: vi.fn().mockRejectedValue('raw string'),
      });
      const manager = new MemexManager(deps);
      const result = await manager.enable();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ─── disable ───────────────────────────────────────────────────────────────

  describe('disable', () => {
    it('returns error when alias is empty', async () => {
      const { deps } = makeDeps({ getAlias: vi.fn().mockReturnValue('') });
      const manager = new MemexManager(deps);
      const result = await manager.disable();
      expect(result).toEqual({ success: false, error: 'No current user alias' });
    });

    it('removes memex servers and unbinds them from agents', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([
        { config: { name: 'memex-c1' } },
        { config: { name: 'other-server' } },
      ]);
      pcManager.getAllChatConfigs.mockReturnValue([
        {
          chat_id: 'c1',
          agent: {
            name: 'bot',
            mcp_servers: [
              { name: 'memex-c1', tools: [] },
              { name: 'other-server', tools: [] },
            ],
          },
        },
      ]);
      const manager = new MemexManager(deps);
      const result = await manager.disable();
      expect(result.success).toBe(true);
      expect(pcManager.updateChatAgent).toHaveBeenCalledWith('alice', 'c1', {
        mcp_servers: [{ name: 'other-server', tools: [] }],
      });
      expect(mcpManager.disconnect).toHaveBeenCalledWith('memex-c1');
      expect(mcpManager.delete).toHaveBeenCalledWith('memex-c1');
      expect(mcpManager.disconnect).not.toHaveBeenCalledWith('other-server');
    });

    it('skips non-memex servers', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'my-custom-server' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([]);
      const manager = new MemexManager(deps);
      await manager.disable();
      expect(mcpManager.disconnect).not.toHaveBeenCalled();
      expect(mcpManager.delete).not.toHaveBeenCalled();
    });

    it('does not update agent when mcp_servers unchanged after filter', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [{ name: 'other', tools: [] }] } },
      ]);
      const manager = new MemexManager(deps);
      await manager.disable();
      expect(pcManager.updateChatAgent).not.toHaveBeenCalled();
    });

    it('skips chats without agent', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      pcManager.getAllChatConfigs.mockReturnValue([{ chat_id: 'c1' }]);
      const manager = new MemexManager(deps);
      const result = await manager.disable();
      expect(result.success).toBe(true);
    });

    it('continues delete even if disconnect throws', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-c1' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([]);
      mcpManager.disconnect.mockRejectedValue(new Error('already gone'));
      const manager = new MemexManager(deps);
      const result = await manager.disable();
      expect(result.success).toBe(true);
      expect(mcpManager.delete).toHaveBeenCalledWith('memex-c1');
    });

    it('returns error on unexpected exception', async () => {
      const { deps } = makeDeps({
        getProfileCacheManager: vi.fn().mockRejectedValue(new Error('crash')),
      });
      const manager = new MemexManager(deps);
      const result = await manager.disable();
      expect(result).toEqual({ success: false, error: 'crash' });
    });

    it('returns error on non-Error exception', async () => {
      const { deps } = makeDeps({
        // eslint-disable-next-line prefer-promise-reject-errors
        getProfileCacheManager: vi.fn().mockRejectedValue(42),
      });
      const manager = new MemexManager(deps);
      const result = await manager.disable();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ─── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns enabled:false when alias is empty', async () => {
      const { deps } = makeDeps({ getAlias: vi.fn().mockReturnValue('') });
      const manager = new MemexManager(deps);
      const result = await manager.getStatus();
      expect(result).toEqual({ success: true, data: { enabled: false } });
    });

    it('returns enabled:true when a memex server exists', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-c1' } }]);
      const manager = new MemexManager(deps);
      const result = await manager.getStatus();
      expect(result).toEqual({ success: true, data: { enabled: true } });
    });

    it('returns enabled:false when no memex server exists', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'regular-server' } }]);
      const manager = new MemexManager(deps);
      const result = await manager.getStatus();
      expect(result).toEqual({ success: true, data: { enabled: false } });
    });

    it('returns error on unexpected exception', async () => {
      const { deps } = makeDeps({
        getProfileCacheManager: vi.fn().mockRejectedValue(new Error('fail')),
      });
      const manager = new MemexManager(deps);
      const result = await manager.getStatus();
      expect(result).toEqual({ success: false, error: 'fail' });
    });

    it('returns Unknown error on non-Error exception', async () => {
      const { deps } = makeDeps({
        // eslint-disable-next-line prefer-promise-reject-errors
        getProfileCacheManager: vi.fn().mockRejectedValue(99),
      });
      const manager = new MemexManager(deps);
      const result = await manager.getStatus();
      expect(result).toEqual({ success: false, error: 'Unknown error' });
    });
  });

  // ─── onAgentCreated ────────────────────────────────────────────────────────

  describe('onAgentCreated', () => {
    it('does nothing when alias is empty', async () => {
      const { deps, pcManager } = makeDeps({ getAlias: vi.fn().mockReturnValue('') });
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      expect(pcManager.addMcpServerConfig).not.toHaveBeenCalled();
    });

    it('does nothing when memex is not enabled', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([]);
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      expect(pcManager.addMcpServerConfig).not.toHaveBeenCalled();
    });

    it('registers memex for new agent when memex is enabled', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-existing' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'newbot', mcp_servers: [] } },
      ]);
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      expect(pcManager.addMcpServerConfig).toHaveBeenCalledWith(
        'alice',
        expect.objectContaining({ name: 'memex-c1' })
      );
      expect(pcManager.updateChatAgent).toHaveBeenCalledWith(
        'alice', 'c1',
        expect.objectContaining({
          mcp_servers: expect.arrayContaining([expect.objectContaining({ name: 'memex-c1' })]),
        })
      );
      await Promise.resolve();
      expect(mcpManager.connect).toHaveBeenCalledWith('memex-c1');
    });

    it('skips updateChatAgent when server already bound to agent', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-existing' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [{ name: 'memex-c1', tools: [] }] } },
      ]);
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      expect(pcManager.updateChatAgent).not.toHaveBeenCalled();
    });

    it('skips agent binding when chat has no agent', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-existing' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([{ chat_id: 'c1' }]);
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      expect(pcManager.addMcpServerConfig).toHaveBeenCalled();
      expect(pcManager.updateChatAgent).not.toHaveBeenCalled();
    });

    it('handles null mcp_servers on agent in onAgentCreated (uses empty array fallback)', async () => {
      const { deps, pcManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-existing' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: null } },
      ]);
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      expect(pcManager.updateChatAgent).toHaveBeenCalledWith(
        'alice', 'c1',
        expect.objectContaining({
          mcp_servers: expect.arrayContaining([expect.objectContaining({ name: 'memex-c1' })]),
        })
      );
    });

    it('logs a warning when connect rejects in onAgentCreated (fire-and-forget catch)', async () => {
      const { deps, pcManager, mcpManager } = makeDeps();
      pcManager.getAllMcpServerInfo.mockReturnValue([{ config: { name: 'memex-existing' } }]);
      pcManager.getAllChatConfigs.mockReturnValue([
        { chat_id: 'c1', agent: { name: 'bot', mcp_servers: [] } },
      ]);
      mcpManager.connect.mockRejectedValue(new Error('connect error'));
      const manager = new MemexManager(deps);
      await manager.onAgentCreated('c1');
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(safeConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to connect memex-c1'),
        expect.any(Error)
      );
    });
  });

  // ─── onAgentDeleted ────────────────────────────────────────────────────────

  describe('onAgentDeleted', () => {
    it('does nothing when alias is empty', async () => {
      const { deps, mcpManager } = makeDeps({ getAlias: vi.fn().mockReturnValue('') });
      const manager = new MemexManager(deps);
      await manager.onAgentDeleted('c1');
      expect(mcpManager.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects and deletes the server for the agent', async () => {
      const { deps, mcpManager } = makeDeps();
      const manager = new MemexManager(deps);
      await manager.onAgentDeleted('c1');
      expect(mcpManager.disconnect).toHaveBeenCalledWith('memex-c1');
      expect(mcpManager.delete).toHaveBeenCalledWith('memex-c1');
    });

    it('tolerates disconnect throwing (server may not exist)', async () => {
      const { deps, mcpManager } = makeDeps();
      mcpManager.disconnect.mockRejectedValue(new Error('not found'));
      const manager = new MemexManager(deps);
      await expect(manager.onAgentDeleted('c1')).resolves.toBeUndefined();
      expect(mcpManager.delete).toHaveBeenCalledWith('memex-c1');
    });

    it('tolerates delete throwing (server may not exist)', async () => {
      const { deps, mcpManager } = makeDeps();
      mcpManager.delete.mockRejectedValue(new Error('not found'));
      const manager = new MemexManager(deps);
      await expect(manager.onAgentDeleted('c1')).resolves.toBeUndefined();
    });
  });
});
