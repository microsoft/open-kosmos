/**
 * Unit tests for McpRequestHandler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { McpRequestHandler } from '../connection/McpRequestHandler';

function makeConnection(connected = true) {
  const emitter = new EventEmitter();
  const conn: any = {
    isConnected: connected,
    request: vi.fn(),
    notify: vi.fn(),
    on: (evt: string, fn: any) => { emitter.on(evt, fn); return conn; },
    emit: (evt: string, ...args: any[]) => emitter.emit(evt, ...args),
  };
  return conn;
}

describe('McpRequestHandler', () => {
  let conn: ReturnType<typeof makeConnection>;
  let handler: McpRequestHandler;

  beforeEach(() => {
    conn = makeConnection();
    handler = new McpRequestHandler(conn);
  });

  // ── listTools ─────────────────────────────────────────────────────────────

  describe('listTools', () => {
    it('returns tools from the server', async () => {
      conn.request.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
      const tools = await handler.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
    });

    it('returns cached result on second call', async () => {
      conn.request.mockResolvedValue({ tools: [{ name: 'search', inputSchema: {} }] });
      await handler.listTools();
      await handler.listTools();
      expect(conn.request).toHaveBeenCalledOnce();
    });

    it('bypasses cache when useCache=false', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      await handler.listTools({ useCache: false });
      await handler.listTools({ useCache: false });
      expect(conn.request).toHaveBeenCalledTimes(2);
    });

    it('increments cache stats on hit', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      await handler.listTools();
      await handler.listTools(); // cache hit
      const stats = handler.getCacheStats();
      expect(stats.hits).toBeGreaterThanOrEqual(1);
    });

    it('throws when not connected', async () => {
      conn.isConnected = false;
      await expect(handler.listTools()).rejects.toThrow(/Connection not established/);
    });
  });

  // ── callTool ──────────────────────────────────────────────────────────────

  describe('callTool', () => {
    it('returns content on success', async () => {
      conn.request.mockResolvedValue({ isError: false, content: 'result data' });
      const result = await handler.callTool('search', { q: 'hello' });
      expect(result).toBe('result data');
    });

    it('throws when tool execution returns isError=true', async () => {
      conn.request.mockResolvedValue({ isError: true, content: [{ text: 'fail' }] });
      await expect(handler.callTool('bad-tool', {})).rejects.toThrow(/Tool execution failed/);
    });

    it('passes timeout and signal to the request', async () => {
      conn.request.mockResolvedValue({ isError: false, content: null });
      const signal = new AbortController().signal;
      await handler.callTool('t', {}, { timeout: 5000, signal });
      const callArgs = conn.request.mock.calls[0];
      expect(callArgs[2]).toMatchObject({ timeout: 5000, signal });
    });
  });

  // ── listResources ─────────────────────────────────────────────────────────

  describe('listResources', () => {
    it('returns resources from the server', async () => {
      conn.request.mockResolvedValue({ resources: [{ uri: 'file://readme', name: 'Readme' }] });
      const resources = await handler.listResources();
      expect(resources).toHaveLength(1);
      expect(resources[0].uri).toBe('file://readme');
    });

    it('caches results', async () => {
      conn.request.mockResolvedValue({ resources: [] });
      await handler.listResources();
      await handler.listResources();
      expect(conn.request).toHaveBeenCalledOnce();
    });
  });

  // ── readResource ──────────────────────────────────────────────────────────

  describe('readResource', () => {
    it('returns resource contents', async () => {
      conn.request.mockResolvedValue({ contents: 'file content' });
      const result = await handler.readResource('file://readme');
      expect(result).toBe('file content');
    });

    it('caches by URI', async () => {
      conn.request.mockResolvedValue({ contents: 'data' });
      await handler.readResource('file://a');
      await handler.readResource('file://a');
      expect(conn.request).toHaveBeenCalledOnce();
    });

    it('does not share cache across different URIs', async () => {
      conn.request.mockResolvedValue({ contents: 'data' });
      await handler.readResource('file://a');
      await handler.readResource('file://b');
      expect(conn.request).toHaveBeenCalledTimes(2);
    });
  });

  // ── listPrompts ───────────────────────────────────────────────────────────

  describe('listPrompts', () => {
    it('returns prompts from the server', async () => {
      conn.request.mockResolvedValue({ prompts: [{ name: 'greet', arguments: [] }] });
      const prompts = await handler.listPrompts();
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('greet');
    });

    it('caches results', async () => {
      conn.request.mockResolvedValue({ prompts: [] });
      await handler.listPrompts();
      await handler.listPrompts();
      expect(conn.request).toHaveBeenCalledOnce();
    });
  });

  // ── getPrompt ─────────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('returns prompt result', async () => {
      const expected = { messages: [] };
      conn.request.mockResolvedValue(expected);
      const result = await handler.getPrompt('greet', { name: 'Alice' });
      expect(result).toBe(expected);
    });
  });

  // ── ping ──────────────────────────────────────────────────────────────────

  describe('ping', () => {
    it('sends a ping and returns the response', async () => {
      conn.request.mockResolvedValue({ pong: true });
      const result = await handler.ping();
      expect(result).toMatchObject({ pong: true });
    });
  });

  // ── clearCache ────────────────────────────────────────────────────────────

  describe('clearCache', () => {
    it('clears all cache entries', async () => {
      conn.request.mockResolvedValue({ tools: [{ name: 'x', inputSchema: {} }] });
      await handler.listTools();
      handler.clearCache();
      conn.request.mockResolvedValue({ tools: [] });
      const tools = await handler.listTools();
      expect(tools).toHaveLength(0);
      expect(conn.request).toHaveBeenCalledTimes(2);
    });

    it('clears cache entries matching pattern', async () => {
      conn.request
        .mockResolvedValueOnce({ tools: [{ name: 'x', inputSchema: {} }] })
        .mockResolvedValue({ resources: [] });
      await handler.listTools();
      await handler.listResources();
      handler.clearCache('tools_list');
      // Resources cache should still be valid
      await handler.listResources();
      expect(conn.request).toHaveBeenCalledTimes(2); // no extra call for resources
    });
  });

  // ── cache invalidation from notifications ─────────────────────────────────

  describe('cache invalidation via notifications', () => {
    it('clears tools cache on tools_list_changed notification', async () => {
      conn.request.mockResolvedValue({ tools: [{ name: 'x', inputSchema: {} }] });
      await handler.listTools();
      // Simulate notification
      conn.emit('notification', { method: 'notifications/tools/list_changed' });
      conn.request.mockResolvedValue({ tools: [] });
      const tools = await handler.listTools();
      expect(tools).toHaveLength(0);
    });
  });

  // ── connection state change clears cache ──────────────────────────────────

  describe('connection state change', () => {
    it('clears cache when connection leaves running state', async () => {
      conn.request.mockResolvedValue({ tools: [{ name: 'x', inputSchema: {} }] });
      await handler.listTools();
      conn.emit('stateChanged', 'running', 'error');
      conn.request.mockResolvedValue({ tools: [] });
      const tools = await handler.listTools();
      expect(tools).toHaveLength(0);
    });

    it('does not clear cache when connection remains running', async () => {
      conn.request.mockResolvedValue({ tools: [{ name: 'x', inputSchema: {} }] });
      await handler.listTools();
      conn.emit('stateChanged', 'starting', 'running');
      // Cache still valid
      await handler.listTools();
      expect(conn.request).toHaveBeenCalledOnce();
    });
  });

  // ── events ────────────────────────────────────────────────────────────────

  describe('events', () => {
    it('emits requestStarted and requestCompleted on success', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      const started = vi.fn();
      const completed = vi.fn();
      handler.on(McpRequestHandler.EVENTS.REQUEST_STARTED, started);
      handler.on(McpRequestHandler.EVENTS.REQUEST_COMPLETED, completed);
      await handler.listTools({ useCache: false });
      expect(started).toHaveBeenCalledOnce();
      expect(completed).toHaveBeenCalledOnce();
    });

    it('emits requestFailed on error', async () => {
      conn.request.mockRejectedValue(new Error('server down'));
      const failed = vi.fn();
      handler.on(McpRequestHandler.EVENTS.REQUEST_FAILED, failed);
      await expect(handler.listTools({ useCache: false })).rejects.toThrow();
      expect(failed).toHaveBeenCalledOnce();
    });

    it('emits cacheHit event on cache hit', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      const hitListener = vi.fn();
      handler.on(McpRequestHandler.EVENTS.CACHE_HIT, hitListener);
      await handler.listTools();
      await handler.listTools();
      expect(hitListener).toHaveBeenCalledOnce();
    });

    it('emits cacheMiss event on cache miss', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      const missListener = vi.fn();
      handler.on(McpRequestHandler.EVENTS.CACHE_MISS, missListener);
      await handler.listTools();
      expect(missListener).toHaveBeenCalledOnce();
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('tracks total requests and errors', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      await handler.listTools({ useCache: false });
      await handler.listTools({ useCache: false });
      conn.request.mockRejectedValue(new Error('fail'));
      await handler.listTools({ useCache: false }).catch(() => {});
      const stats = handler.getStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.errors).toBe(1);
    });

    it('hitRate is correct', async () => {
      conn.request.mockResolvedValue({ tools: [] });
      await handler.listTools(); // miss
      await handler.listTools(); // hit
      const { cacheStats } = handler.getStats();
      expect(cacheStats.hitRate).toBeCloseTo(0.5, 1);
    });
  });
});
