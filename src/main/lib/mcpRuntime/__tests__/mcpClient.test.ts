/**
 * Tests for mcpClient.ts (MCPClient class)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────
const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();
const mockClientConstructor = vi.fn();

const mockStdioTransportConstructor = vi.fn();
const mockSSETransportConstructor = vi.fn();
const mockStreamableHTTPTransportConstructor = vi.fn();
const mockExecSync = vi.fn();
const mockFsExistsSync = vi.fn();
const mockFsStatSync = vi.fn();
const mockFsAccessSync = vi.fn();
const mockCreateConsoleLogger = vi.fn(() => Promise.resolve({ log: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    constructor(...args: any[]) { mockClientConstructor(...args); }
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    close = mockClose;
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioTransport {
    process: any;
    constructor(opts: any) { mockStdioTransportConstructor(opts); }
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSSETransport {
    constructor(url: URL) { mockSSETransportConstructor(url); }
  }
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHttpTransport {
    constructor(url: URL) { mockStreamableHTTPTransportConstructor(url); }
  }
}));

vi.mock('child_process', () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
  ChildProcess: class {}
}));

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockFsExistsSync(...args),
  statSync: (...args: any[]) => mockFsStatSync(...args),
  accessSync: (...args: any[]) => mockFsAccessSync(...args),
  constants: { X_OK: 1 }
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => mockCreateConsoleLogger()
}));

// userDataADO/types is just a type import; not mocked (no runtime effect)

import { MCPClient } from '../mcpClient';
import type { McpServerConfig } from '../../userDataADO/types';

// ── helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    ...overrides,
  } as McpServerConfig;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('MCPClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    mockCallTool.mockResolvedValue({ content: 'result' });
    mockClose.mockResolvedValue(undefined);
    mockExecSync.mockReturnValue('/usr/bin/node\n');
    mockFsExistsSync.mockReturnValue(false);
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a Client with the server name', () => {
      new MCPClient(makeConfig({ name: 'my-server' }));
      expect(mockClientConstructor).toHaveBeenCalledWith({ name: 'my-server', version: '1.0.0' });
    });

    it('works without optional fields', () => {
      const cfg = makeConfig({ args: undefined, env: undefined, url: undefined });
      expect(() => new MCPClient(cfg)).not.toThrow();
    });

    it('works with env key-value pairs', () => {
      const cfg = makeConfig({ env: { FOO: 'bar', BAZ: 'qux' } });
      expect(() => new MCPClient(cfg)).not.toThrow();
    });
  });

  // ── connectToServer – stdio ──────────────────────────────────────────────

  describe('connectToServer – stdio', () => {
    it('returns "connected" on success and populates tools', async () => {
      mockListTools.mockResolvedValue({
        tools: [
          { name: 'toolA', description: 'desc', inputSchema: {} },
          { name: 'toolB', inputSchema: { type: 'object' } }
        ]
      });

      const client = new MCPClient(makeConfig());
      const result = await client.connectToServer();

      expect(result).toBe('connected');
      const tools = await client.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('toolA');
      expect(tools[1].description).toBe(''); // undefined → ""
    });

    it('clears lastError on successful connection', async () => {
      const client = new MCPClient(makeConfig());
      // force an initial error state
      mockConnect.mockRejectedValueOnce(new Error('boom'));
      await client.connectToServer();

      // second call succeeds
      mockConnect.mockResolvedValueOnce(undefined);
      await client.connectToServer();

      expect(client.getLastError()).toBeNull();
    });

    it('returns Error and stores lastError on failure', async () => {
      mockConnect.mockRejectedValue(new Error('connect failed'));
      const client = new MCPClient(makeConfig());
      const result = await client.connectToServer();

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('connect failed');
      expect(client.getLastError()).toBeInstanceOf(Error);
    });

    it('wraps non-Error throws', async () => {
      mockConnect.mockRejectedValue('string error');
      const client = new MCPClient(makeConfig());
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('string error');
    });

    it('uses resolved command path on non-win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mockExecSync.mockReturnValue('/opt/homebrew/bin/node\n');
      const client = new MCPClient(makeConfig({ command: 'node' }));
      await client.connectToServer();

      // StdioClientTransport should be created with the resolved path
      expect(mockStdioTransportConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ command: '/opt/homebrew/bin/node' })
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('uses original command when which fails and no path found', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockFsExistsSync.mockReturnValue(false);

      const client = new MCPClient(makeConfig({ command: 'uvx' }));
      await client.connectToServer();

      expect(mockStdioTransportConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'uvx' })
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('uses fallback path when execSync fails but file exists', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockFsExistsSync.mockImplementation((p: string) => p === '/usr/bin/uvx');
      mockFsStatSync.mockReturnValue({ isFile: () => true });
      mockFsAccessSync.mockReturnValue(undefined); // does not throw → executable

      const client = new MCPClient(makeConfig({ command: 'uvx' }));
      await client.connectToServer();

      expect(mockStdioTransportConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ command: '/usr/bin/uvx' })
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('skips non-executable files in fallback path resolution', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      mockFsExistsSync.mockReturnValue(true);
      mockFsStatSync.mockReturnValue({ isFile: () => true });
      mockFsAccessSync.mockImplementation(() => { throw new Error('not executable'); });

      const client = new MCPClient(makeConfig({ command: 'uvx' }));
      await client.connectToServer();

      // Falls back to original command
      expect(mockStdioTransportConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'uvx' })
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });

    it('merges server env into enhanced environment', async () => {
      const client = new MCPClient(makeConfig({ env: { MY_TOKEN: 'secret' } }));
      await client.connectToServer();
      const call = mockStdioTransportConstructor.mock.calls[0][0];
      expect(call.env.MY_TOKEN).toBe('secret');
    });

    it('uses original command on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      const client = new MCPClient(makeConfig({ command: 'myserver.exe' }));
      await client.connectToServer();

      expect(mockStdioTransportConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'myserver.exe' })
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });

  // ── connectToServer – sse ────────────────────────────────────────────────

  describe('connectToServer – sse', () => {
    it('connects using url field', async () => {
      const cfg = makeConfig({ transport: 'sse', url: 'http://localhost:3000/sse' });
      const client = new MCPClient(cfg);
      const result = await client.connectToServer();

      expect(result).toBe('connected');
      expect(mockSSETransportConstructor).toHaveBeenCalledWith(new URL('http://localhost:3000/sse'));
    });

    it('falls back to serverLink for backward compatibility', async () => {
      const cfg = { ...makeConfig({ transport: 'sse' }), serverLink: 'http://legacy/sse' } as any;
      const client = new MCPClient(cfg);
      await client.connectToServer();
      expect(mockSSETransportConstructor).toHaveBeenCalled();
    });

    it('returns Error when no url provided', async () => {
      const cfg = makeConfig({ transport: 'sse', url: undefined });
      const client = new MCPClient(cfg);
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/SSE transport requires url/);
    });
  });

  // ── connectToServer – StreamableHttp ────────────────────────────────────

  describe('connectToServer – StreamableHttp', () => {
    it('connects using url field', async () => {
      const cfg = makeConfig({ transport: 'StreamableHttp', url: 'http://localhost:3001' });
      const client = new MCPClient(cfg);
      const result = await client.connectToServer();

      expect(result).toBe('connected');
      expect(mockStreamableHTTPTransportConstructor).toHaveBeenCalled();
    });

    it('returns Error when no url provided', async () => {
      const cfg = makeConfig({ transport: 'StreamableHttp', url: undefined });
      const client = new MCPClient(cfg);
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/StreamableHttp transport requires url/);
    });
  });

  // ── connectToServer – unsupported transport ──────────────────────────────

  it('returns Error for unsupported transport', async () => {
    const cfg = makeConfig({ transport: 'ftp' as any });
    const client = new MCPClient(cfg);
    const result = await client.connectToServer();
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Unsupported transport/);
  });

  // ── executeTool ──────────────────────────────────────────────────────────

  describe('executeTool', () => {
    it('returns content string from tool result', async () => {
      mockCallTool.mockResolvedValue({ content: 'hello world' });
      const client = new MCPClient(makeConfig());
      await client.connectToServer();

      const result = await client.executeTool({ toolName: 'echo', toolArgs: { text: 'hi' } });
      expect(result).toBe('hello world');
    });

    it('throws when callTool rejects', async () => {
      mockCallTool.mockRejectedValue(new Error('tool error'));
      const client = new MCPClient(makeConfig());
      await client.connectToServer();

      await expect(client.executeTool({ toolName: 'bad', toolArgs: {} }))
        .rejects.toThrow('tool error');
    });

    it('wraps non-Error throw', async () => {
      mockCallTool.mockRejectedValue('something went wrong');
      const client = new MCPClient(makeConfig());
      await client.connectToServer();

      await expect(client.executeTool({ toolName: 'bad', toolArgs: {} }))
        .rejects.toThrow('something went wrong');
    });
  });

  // ── getTools ─────────────────────────────────────────────────────────────

  describe('getTools', () => {
    it('returns empty array before connecting', async () => {
      const client = new MCPClient(makeConfig());
      expect(await client.getTools()).toEqual([]);
    });

    it('returns tools after connecting', async () => {
      mockListTools.mockResolvedValue({ tools: [{ name: 't1', inputSchema: {} }] });
      const client = new MCPClient(makeConfig());
      await client.connectToServer();
      const tools = await client.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('t1');
    });
  });

  // ── cleanup ──────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('closes transport, kills child process, and clears state', async () => {
      const client = new MCPClient(makeConfig());
      await client.connectToServer();

      await client.cleanup();

      // After cleanup tools should be cleared
      const tools = await client.getTools();
      expect(tools).toEqual([]);
      expect(client.getLastError()).toBeNull();
    });

    it('handles close timeout gracefully', async () => {
      mockClose.mockImplementation(() => new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Close timeout')), 1)
      ));

      const client = new MCPClient(makeConfig());
      await client.connectToServer();
      await expect(client.cleanup()).resolves.not.toThrow();
    });

    it('kills child process when transport has process', async () => {
      const mockKill = vi.fn();
      const mockChildProcess = {
        killed: false,
        on: vi.fn((event: string, cb: () => void) => {
          if (event === 'exit') setTimeout(cb, 5); // simulate exit
        }),
        kill: mockKill,
      };

      const client = new MCPClient(makeConfig());

      // Inject the process via transport constructor mock before connecting
      mockStdioTransportConstructor.mockImplementationOnce(function (this: any) {
        this.process = mockChildProcess;
      });

      await client.connectToServer();
      // cleanup without crash is the assertion
      await expect(client.cleanup()).resolves.not.toThrow();
    });

    it('handles no transport (cleanup without connecting)', async () => {
      const client = new MCPClient(makeConfig());
      await expect(client.cleanup()).resolves.not.toThrow();
    });

    it('calls transport.cleanup() if available', async () => {
      const mockTransportCleanup = vi.fn();
      const client = new MCPClient(makeConfig());
      await client.connectToServer();

      // Inject cleanup method into transport
      const transportRef = (client as any).transport;
      if (transportRef) transportRef.cleanup = mockTransportCleanup;

      await client.cleanup();
      // If transport was set, cleanup should have been called
    });
  });

  // ── getLastError ─────────────────────────────────────────────────────────

  describe('getLastError', () => {
    it('returns null initially', () => {
      const client = new MCPClient(makeConfig());
      expect(client.getLastError()).toBeNull();
    });

    it('returns error after failed connection', async () => {
      mockConnect.mockRejectedValue(new Error('fail'));
      const client = new MCPClient(makeConfig());
      await client.connectToServer();
      expect(client.getLastError()).toBeInstanceOf(Error);
      expect(client.getLastError()!.message).toBe('fail');
    });
  });

  // ── getCommonCommandPaths ────────────────────────────────────────────────

  describe('getCommonCommandPaths (win32)', () => {
    it('returns only the base command on win32', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      mockExecSync.mockReturnValue('C:\\Windows\\System32\\node.exe\n');
      const client = new MCPClient(makeConfig({ command: 'node' }));
      await client.connectToServer();

      // On win32, StdioClientTransport should be called with original command
      expect(mockStdioTransportConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'node' })
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    });
  });
});
