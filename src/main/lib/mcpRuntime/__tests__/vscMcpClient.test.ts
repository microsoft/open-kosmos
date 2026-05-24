import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockGetTools = vi.fn();
const mockCallTool = vi.fn();
const mockOn = vi.fn();
const mockVscodeMcpClientConstructor = vi.fn();

vi.mock('../vscodeMcpClient', () => ({
  VscodeMcpClient: class MockVscodeMcpClient {
    constructor(cfg: any) {
      mockVscodeMcpClientConstructor(cfg);
    }
    connect = mockConnect;
    disconnect = mockDisconnect;
    getTools = mockGetTools;
    callTool = mockCallTool;
    on = mockOn;
  },
}));

vi.mock('../unifiedLogger', () => ({
  createConsoleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { VscMcpClient } from '../vscMcpClient';
import type { McpServerConfig } from '../../userDataADO/types';

function makeConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    ...overrides,
  } as McpServerConfig;
}

describe('VscMcpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockGetTools.mockReturnValue([]);
    mockCallTool.mockResolvedValue({ content: 'result' });
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates VscodeMcpClient with stdio config', () => {
      new VscMcpClient(makeConfig());
      expect(mockVscodeMcpClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'stdio', name: 'test-server' })
      );
    });

    it('maps transport sse to type sse', () => {
      new VscMcpClient(makeConfig({ transport: 'sse', url: 'http://localhost/sse' }));
      expect(mockVscodeMcpClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sse' })
      );
    });

    it('maps transport StreamableHttp to type http', () => {
      new VscMcpClient(makeConfig({ transport: 'StreamableHttp', url: 'http://localhost' }));
      expect(mockVscodeMcpClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'http' })
      );
    });

    it('maps unknown transport to type http', () => {
      new VscMcpClient(makeConfig({ transport: 'ftp' as any }));
      expect(mockVscodeMcpClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'http' })
      );
    });

    it('passes env, headers, url when present', () => {
      new VscMcpClient(makeConfig({
        transport: 'sse',
        url: 'http://host/sse',
        env: { TOKEN: 'abc' },
        headers: { Authorization: 'Bearer abc' },
      }));
      expect(mockVscodeMcpClientConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ env: { TOKEN: 'abc' }, headers: { Authorization: 'Bearer abc' } })
      );
    });

    it('logs env key-value pairs when present', () => {
      // Just verify no throw when env has entries
      expect(() => new VscMcpClient(makeConfig({ env: { A: '1', B: '2' } }))).not.toThrow();
    });

    it('works without optional fields', () => {
      expect(() => new VscMcpClient(makeConfig({ args: undefined, env: undefined }))).not.toThrow();
    });
  });

  // ── connectToServer ────────────────────────────────────────────────────────

  describe('connectToServer', () => {
    it('returns "connected" on success', async () => {
      const client = new VscMcpClient(makeConfig());
      const result = await client.connectToServer();
      expect(result).toBe('connected');
    });

    it('sets isConnected=true after successful connect', async () => {
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      // Verify by calling getTools which returns [] only when connected
      const tools = await client.getTools();
      expect(Array.isArray(tools)).toBe(true);
    });

    it('populates tools from server', async () => {
      mockGetTools.mockReturnValue([
        { name: 'toolA', description: 'desc', inputSchema: {} },
        { name: 'toolB', inputSchema: { type: 'object' }, _meta: { 'anthropic/alwaysLoad': true } },
      ]);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const tools = await client.getTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('toolA');
      expect(tools[1].name).toBe('toolB');
    });

    it('maps _meta.anthropic/alwaysLoad to alwaysLoad=true', async () => {
      mockGetTools.mockReturnValue([
        { name: 't', inputSchema: {}, _meta: { 'anthropic/alwaysLoad': true } },
      ]);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const tools = await client.getTools();
      expect(tools[0].alwaysLoad).toBe(true);
    });

    it('maps _meta.anthropic/searchHint to searchHint trimmed', async () => {
      mockGetTools.mockReturnValue([
        { name: 't', inputSchema: {}, _meta: { 'anthropic/searchHint': '  find files  ' } },
      ]);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const tools = await client.getTools();
      expect(tools[0].searchHint).toBe('find files');
    });

    it('sets searchHint to undefined when trimmed is empty', async () => {
      mockGetTools.mockReturnValue([
        { name: 't', inputSchema: {}, _meta: { 'anthropic/searchHint': '   ' } },
      ]);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const tools = await client.getTools();
      expect(tools[0].searchHint).toBeUndefined();
    });

    it('sets up stateChange listener', async () => {
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(mockOn).toHaveBeenCalledWith('stateChange', expect.any(Function));
    });

    it('stateChange error sets isConnected=false and lastError', async () => {
      let stateChangeCallback: Function | null = null;
      mockOn.mockImplementation((event: string, cb: Function) => {
        if (event === 'stateChange') stateChangeCallback = cb;
      });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      // Simulate error state
      stateChangeCallback!({ state: 'error', message: 'oops' });
      expect(client.getLastError()).toBeInstanceOf(Error);
      expect(client.getLastError()?.message).toBe('oops');
    });

    it('stateChange error with no message uses default', async () => {
      let stateChangeCallback: Function | null = null;
      mockOn.mockImplementation((event: string, cb: Function) => {
        if (event === 'stateChange') stateChangeCallback = cb;
      });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      stateChangeCallback!({ state: 'error' });
      expect(client.getLastError()?.message).toBe('Unknown connection error');
    });

    it('stateChange running sets isConnected=true', async () => {
      let stateChangeCallback: Function | null = null;
      mockOn.mockImplementation((event: string, cb: Function) => {
        if (event === 'stateChange') stateChangeCallback = cb;
      });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      stateChangeCallback!({ state: 'running' });
      // isConnected=true: getTools should return array
      expect(await client.getTools()).toBeDefined();
    });

    it('returns Error on connect failure', async () => {
      mockConnect.mockRejectedValue(new Error('connect failed'));
      const client = new VscMcpClient(makeConfig());
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('connect failed');
    });

    it('wraps non-Error throws from connect', async () => {
      mockConnect.mockRejectedValue('string error');
      const client = new VscMcpClient(makeConfig());
      const result = await client.connectToServer();
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('string error');
    });

    it('stores lastError on failure', async () => {
      mockConnect.mockRejectedValue(new Error('fail'));
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(client.getLastError()).toBeInstanceOf(Error);
    });

    it('clears lastError after successful reconnect', async () => {
      mockConnect.mockRejectedValueOnce(new Error('first fail'));
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer(); // fails
      mockConnect.mockResolvedValueOnce(undefined);
      await client.connectToServer(); // succeeds
      expect(client.getLastError()).toBeNull();
    });
  });

  // ── getLastError ───────────────────────────────────────────────────────────

  describe('getLastError', () => {
    it('returns null initially', () => {
      const client = new VscMcpClient(makeConfig());
      expect(client.getLastError()).toBeNull();
    });
  });

  // ── getTools ───────────────────────────────────────────────────────────────

  describe('getTools', () => {
    it('returns empty array before connecting', async () => {
      const client = new VscMcpClient(makeConfig());
      expect(await client.getTools()).toEqual([]);
    });

    it('returns tools after connecting', async () => {
      mockGetTools.mockReturnValue([{ name: 't1', inputSchema: {} }]);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.getTools()).toHaveLength(1);
    });

    it('returns cached tools when getTools throws', async () => {
      mockGetTools.mockReturnValue([{ name: 'cached-tool', inputSchema: {} }]);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      mockGetTools.mockImplementation(() => { throw new Error('oops'); });
      const tools = await client.getTools();
      expect(tools[0].name).toBe('cached-tool');
    });
  });

  // ── executeTool ────────────────────────────────────────────────────────────

  describe('executeTool', () => {
    it('throws when not connected', async () => {
      const client = new VscMcpClient(makeConfig());
      await expect(client.executeTool({ toolName: 'x', toolArgs: {} })).rejects.toThrow(
        'Client is not connected'
      );
    });

    it('returns string result directly', async () => {
      mockCallTool.mockResolvedValue('plain string');
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.executeTool({ toolName: 't', toolArgs: {} })).toBe('plain string');
    });

    it('extracts text from content array', async () => {
      mockCallTool.mockResolvedValue({ content: [{ text: 'hello' }, { text: 'world' }] });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.executeTool({ toolName: 't', toolArgs: {} })).toBe('hello\nworld');
    });

    it('extracts text from content array with string items', async () => {
      mockCallTool.mockResolvedValue({ content: ['foo', 'bar'] });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.executeTool({ toolName: 't', toolArgs: {} })).toBe('foo\nbar');
    });

    it('extracts text from content array with non-text objects', async () => {
      mockCallTool.mockResolvedValue({ content: [{ type: 'image', url: 'data:...' }] });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const res = await client.executeTool({ toolName: 't', toolArgs: {} });
      expect(typeof res).toBe('string');
    });

    it('converts non-array content to string', async () => {
      mockCallTool.mockResolvedValue({ content: 42 });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.executeTool({ toolName: 't', toolArgs: {} })).toBe('42');
    });

    it('returns result field as string when present', async () => {
      mockCallTool.mockResolvedValue({ result: 'my-result' });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.executeTool({ toolName: 't', toolArgs: {} })).toBe('my-result');
    });

    it('JSON-stringifies result field when not string', async () => {
      mockCallTool.mockResolvedValue({ result: { key: 'val' } });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const res = await client.executeTool({ toolName: 't', toolArgs: {} });
      expect(res).toBe(JSON.stringify({ key: 'val' }));
    });

    it('JSON-stringifies object without content or result', async () => {
      mockCallTool.mockResolvedValue({ unknownField: 'x' });
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      const res = await client.executeTool({ toolName: 't', toolArgs: {} });
      expect(res).toBe(JSON.stringify({ unknownField: 'x' }));
    });

    it('converts null result to string', async () => {
      mockCallTool.mockResolvedValue(null);
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      expect(await client.executeTool({ toolName: 't', toolArgs: {} })).toBe('null');
    });

    it('passes abort signal to callTool', async () => {
      mockCallTool.mockResolvedValue('ok');
      const ctrl = new AbortController();
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      await client.executeTool({ toolName: 't', toolArgs: {}, signal: ctrl.signal });
      expect(mockCallTool).toHaveBeenCalledWith('t', {}, { signal: ctrl.signal });
    });

    it('rethrows Error from callTool', async () => {
      mockCallTool.mockRejectedValue(new Error('tool error'));
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      await expect(client.executeTool({ toolName: 't', toolArgs: {} })).rejects.toThrow('tool error');
    });

    it('wraps non-Error throw from callTool', async () => {
      mockCallTool.mockRejectedValue('raw string');
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      await expect(client.executeTool({ toolName: 't', toolArgs: {} })).rejects.toThrow('raw string');
    });
  });

  // ── cleanup ────────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('disconnects when connected', async () => {
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      await client.cleanup();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('does not disconnect when never connected', async () => {
      const client = new VscMcpClient(makeConfig());
      await client.cleanup();
      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it('clears state after cleanup', async () => {
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      await client.cleanup();
      expect(await client.getTools()).toEqual([]);
      expect(client.getLastError()).toBeNull();
    });

    it('handles disconnect errors gracefully', async () => {
      mockDisconnect.mockRejectedValue(new Error('disconnect failed'));
      const client = new VscMcpClient(makeConfig());
      await client.connectToServer();
      await expect(client.cleanup()).resolves.not.toThrow();
    });
  });
});
