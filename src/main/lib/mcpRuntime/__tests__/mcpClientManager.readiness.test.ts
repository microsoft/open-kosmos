// @ts-nocheck
/**
 * Tests for the MCP readiness gate primitives added to MCPClientManager:
 * getInUseServerNames(), waitForServersSettled(), and the internal
 * _isServerSettled() / _notifySettleWaiters() helpers that back them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockGetAllMcpServerInfo } = vi.hoisted(() => ({
  mockGetAllMcpServerInfo: vi.fn(() => [] as any[]),
}));

vi.mock('electron', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    app: { getPath: vi.fn(() => '/tmp/test-userData'), isReady: vi.fn(() => true) },
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, execSync: vi.fn() };
});

vi.mock('../../unifiedLogger', () => ({
  createConsoleLogger: () =>
    Promise.resolve({ log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    getAllMcpServerInfo: (...a: any[]) => mockGetAllMcpServerInfo(...a),
  },
}));

vi.mock('../auth/McpAuthService', () => ({
  McpAuthService: { onInteraction: vi.fn(() => vi.fn()), getInstance: () => ({}) },
}));

vi.mock('../../userDataADO/openkosmosPlaceholders', () => ({
  containsOpenKosmosPlaceholder: vi.fn(() => false),
  openkosmosPlaceholderManager: {
    replacePlaceholders: vi.fn((s: string) => s),
    replacePlaceholdersInObject: vi.fn((o: any) => o),
  },
}));

vi.mock('../vscMcpClient', () => ({
  VscMcpClient: class MockVscMcpClient {
    connectToServer = vi.fn(() => Promise.resolve('connected'));
    getTools = vi.fn(() => Promise.resolve([]));
    executeTool = vi.fn(() => Promise.resolve('result'));
    cleanup = vi.fn(() => Promise.resolve());
  },
}));

vi.mock('../builtinMcpClient', () => ({
  BUILTIN_SERVER_NAME: 'builtin-tools',
  BuiltinMcpClient: class MockBuiltinMcpClient {
    connectToServer = vi.fn(() => Promise.resolve('connected'));
    getTools = vi.fn(() => Promise.resolve([]));
    executeTool = vi.fn(() => Promise.resolve('builtin_result'));
    cleanup = vi.fn(() => Promise.resolve());
  },
}));

import { MCPClientManager } from '../mcpClientManager';

function getManager(): MCPClientManager {
  (MCPClientManager as any).instance = null;
  return MCPClientManager.getInstance();
}

function setStatus(mgr: MCPClientManager, name: string, status: string): void {
  (mgr as any)._updateServerStatus(name, status);
}

describe('MCPClientManager readiness gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllMcpServerInfo.mockReturnValue([]);
  });

  afterEach(() => {
    (MCPClientManager as any).instance = null;
    vi.useRealTimers();
  });

  describe('getInUseServerNames', () => {
    it('returns [] when no alias is bound', () => {
      const mgr = getManager();
      (mgr as any).currentUserAlias = null;
      expect(mgr.getInUseServerNames()).toEqual([]);
    });

    it('returns in-use external servers, excluding disabled and builtin', () => {
      const mgr = getManager();
      (mgr as any).currentUserAlias = 'alice';
      mockGetAllMcpServerInfo.mockReturnValue([
        { config: { name: 'github', in_use: true } },
        { config: { name: 'disabled-srv', in_use: false } },
        { config: { name: 'builtin-tools', in_use: true } },
        { config: { name: 'fs', in_use: true } },
      ]);
      expect(mgr.getInUseServerNames()).toEqual(['github', 'fs']);
      expect(mockGetAllMcpServerInfo).toHaveBeenCalledWith('alice');
    });
  });

  describe('waitForServersSettled', () => {
    it('resolves immediately when the target list is empty', async () => {
      const mgr = getManager();
      await expect(mgr.waitForServersSettled([], 1_000)).resolves.toBeUndefined();
    });

    it('resolves immediately when only builtin/empty names are given', async () => {
      const mgr = getManager();
      await expect(
        mgr.waitForServersSettled(['builtin-tools', ''], 1_000),
      ).resolves.toBeUndefined();
    });

    it('resolves immediately when all targets are already settled', async () => {
      const mgr = getManager();
      setStatus(mgr, 'a', 'connected');
      setStatus(mgr, 'b', 'error');
      await expect(mgr.waitForServersSettled(['a', 'b'], 1_000)).resolves.toBeUndefined();
    });

    it('resolves once a connecting server transitions to connected', async () => {
      const mgr = getManager();
      setStatus(mgr, 'srv', 'connecting');
      let resolved = false;
      const p = mgr.waitForServersSettled(['srv'], 10_000).then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);
      setStatus(mgr, 'srv', 'connected');
      await p;
      expect(resolved).toBe(true);
    });

    it('treats a disconnecting server as not settled until it reaches a terminal state', async () => {
      const mgr = getManager();
      setStatus(mgr, 'srv', 'disconnecting');
      let resolved = false;
      const p = mgr.waitForServersSettled(['srv'], 10_000).then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);
      setStatus(mgr, 'srv', 'connected');
      await p;
      expect(resolved).toBe(true);
    });

    it('settles a server that had no prior runtime state once it connects', async () => {
      const mgr = getManager();
      let resolved = false;
      const p = mgr.waitForServersSettled(['fresh'], 10_000).then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);
      setStatus(mgr, 'fresh', 'connected');
      await p;
      expect(resolved).toBe(true);
    });

    it('waits for every target before resolving', async () => {
      const mgr = getManager();
      setStatus(mgr, 'a', 'connecting');
      setStatus(mgr, 'b', 'connecting');
      let resolved = false;
      const p = mgr.waitForServersSettled(['a', 'b'], 10_000).then(() => {
        resolved = true;
      });
      await Promise.resolve();

      setStatus(mgr, 'a', 'connected');
      await Promise.resolve();
      expect(resolved).toBe(false);

      setStatus(mgr, 'b', 'connected');
      await p;
      expect(resolved).toBe(true);
    });

    it('resolves on timeout when a target never settles', async () => {
      const mgr = getManager();
      setStatus(mgr, 'stuck', 'connecting');
      await expect(mgr.waitForServersSettled(['stuck'], 20)).resolves.toBeUndefined();
    });
  });
});
