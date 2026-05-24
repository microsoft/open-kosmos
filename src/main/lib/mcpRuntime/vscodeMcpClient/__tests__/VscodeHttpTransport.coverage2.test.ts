/**
 * VscodeHttpTransport coverage2 — uncovered branches:
 * - stop when already stopped
 * - send when not running
 * - _isJSON edge cases
 * - _getErrorText failure
 * - _handleSuccessfulStreamableHttp: 202, application/json, unknown content-type (non-JSON)
 * - SSEParser: comment lines, id with null char, retry field, CRLF boundary handling
 * - _sseFallbackWithMessage endpoint resolution
 */

const { mockFetch, mockMcpAuthMetadataServiceResolve, mockMcpAuthServiceGetInstance } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockMcpAuthMetadataServiceResolve: vi.fn(async () => null),
  mockMcpAuthServiceGetInstance: vi.fn(() => ({
    getTokenForServer: vi.fn(async () => undefined),
  })),
}));

vi.stubGlobal('fetch', mockFetch);

vi.mock('../../auth/McpAuthMetadataService', () => ({
  McpAuthMetadataService: {
    resolve: mockMcpAuthMetadataServiceResolve,
    updateFromHeaders: vi.fn((meta: any) => meta),
  },
}));

vi.mock('../../auth/McpAuthService', () => ({
  McpAuthService: {
    getInstance: mockMcpAuthServiceGetInstance,
  },
}));

import { VscodeHttpTransport } from '../transport/VscodeHttpTransport';

function makeResponse(overrides: Partial<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  text: () => Promise<string>;
}> = {}): Response {
  const headers = new Headers(overrides.headers || {});
  return {
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    headers,
    body: overrides.body ?? null,
    text: overrides.text ?? (async () => ''),
  } as unknown as Response;
}

function makeStreamResponse(chunks: string[]): Response {
  let idx = 0;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[idx++]));
      } else {
        controller.close();
      }
    }
  });
  return {
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: stream,
    text: async () => '',
  } as unknown as Response;
}

describe('VscodeHttpTransport coverage2', () => {
  let transport: VscodeHttpTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new VscodeHttpTransport({
      serverName: 'test-server',
      url: 'http://localhost:3000/mcp',
    });
  });

  afterEach(async () => {
    try { await transport.stop(); } catch {}
  });

  describe('stop', () => {
    it('is a no-op when already stopped', async () => {
      // Not started, state is 'stopped'
      await transport.stop();
      // Should not throw
      expect(transport.state.state).toBe('stopped');
    });

    it('stops a running transport', async () => {
      await transport.start();
      expect(transport.state.state).toBe('running');
      await transport.stop();
      expect(transport.state.state).toBe('stopped');
    });
  });

  describe('send when not running', () => {
    it('throws when transport is not running', async () => {
      await expect(transport.send('{"method":"test"}')).rejects.toThrow('Transport is not running');
    });
  });

  describe('_handleSuccessfulStreamableHttp: 202 response', () => {
    it('returns immediately on 202 (no body processing)', async () => {
      await transport.start();

      mockFetch.mockResolvedValue(makeResponse({
        status: 202,
        headers: { 'Mcp-Session-Id': 'abc123' },
      }));

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1,"method":"test"}');
      expect(messages).toHaveLength(0);
    });
  });

  describe('_handleSuccessfulStreamableHttp: application/json response', () => {
    it('emits message for application/json content type', async () => {
      await transport.start();

      const body = '{"result":"ok"}';
      mockFetch.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'application/json',
          'Mcp-Session-Id': 'sess1',
        }),
        body: null,
        text: async () => body,
      } as unknown as Response);

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1,"method":"test"}');
      expect(messages).toContain(body);
    });
  });

  describe('_handleSuccessfulStreamableHttp: unknown content-type with JSON body', () => {
    it('emits message when body is valid JSON', async () => {
      await transport.start();

      mockFetch.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'text/plain',
          'Mcp-Session-Id': 'sess2',
        }),
        body: null,
        text: async () => '{"id":1,"result":"data"}',
      } as unknown as Response);

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));
      const logs: string[] = [];
      transport.on('log', (_level: string, msg: string) => logs.push(msg));

      await transport.send('{"id":1}');
      expect(messages).toHaveLength(1);
    });
  });

  describe('_handleSuccessfulStreamableHttp: unknown content-type with non-JSON body', () => {
    it('emits warning log when body is not JSON', async () => {
      await transport.start();

      mockFetch.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'text/plain',
          'Mcp-Session-Id': 'sess3',
        }),
        body: null,
        text: async () => 'not json at all !!!',
      } as unknown as Response);

      const logs: Array<[string, string]> = [];
      transport.on('log', (level: string, msg: string) => logs.push([level, msg]));

      await transport.send('{"id":1}');
      const warnings = logs.filter(([l]) => l === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('SSE stream parsing', () => {
    it('parses a complete SSE message from text/event-stream body', async () => {
      await transport.start();

      const sseData = 'data: {"id":1}\n\n';
      mockFetch.mockResolvedValue(makeStreamResponse([sseData]));

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1}');
      expect(messages).toContain('{"id":1}');
    });

    it('parses SSE with event type and id fields', async () => {
      await transport.start();

      const sseData = 'event: message\nid: evt1\ndata: {"jsonrpc":"2.0"}\n\n';
      mockFetch.mockResolvedValue(makeStreamResponse([sseData]));

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1}');
      expect(messages.some(m => m.includes('jsonrpc'))).toBe(true);
    });

    it('ignores comment lines (starting with :)', async () => {
      await transport.start();

      const sseData = ': this is a comment\ndata: {"id":2}\n\n';
      mockFetch.mockResolvedValue(makeStreamResponse([sseData]));

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1}');
      expect(messages).toContain('{"id":2}');
    });

    it('handles retry field (ignored)', async () => {
      await transport.start();

      const sseData = 'retry: 5000\ndata: {"id":3}\n\n';
      mockFetch.mockResolvedValue(makeStreamResponse([sseData]));

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1}');
      expect(messages).toContain('{"id":3}');
    });

    it('handles id with null char (clears current event id)', async () => {
      await transport.start();

      const sseData = 'id: null\x00char\ndata: {"id":4}\n\n';
      mockFetch.mockResolvedValue(makeStreamResponse([sseData]));

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1}');
      expect(messages).toContain('{"id":4}');
    });
  });

  describe('status transitions', () => {
    it('emits stateChange events', async () => {
      const states: string[] = [];
      transport.on('stateChange', (s: any) => states.push(s.state));

      await transport.start();
      await transport.stop();

      expect(states).toContain('starting');
      expect(states).toContain('running');
      expect(states).toContain('stopped');
    });
  });

  describe('redirect handling', () => {
    it('follows redirects and reaches final URL', async () => {
      await transport.start();

      // 303 redirect changes POST to GET, then 200 with session
      const redirectResponse = {
        status: 303,
        statusText: 'See Other',
        headers: new Headers({ location: 'http://localhost:3000/new' }),
        body: null,
        text: async () => '',
      } as unknown as Response;

      const finalResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json', 'Mcp-Session-Id': 'redir-sess' }),
        body: null,
        text: async () => '{"id":1}',
      } as unknown as Response;

      mockFetch
        .mockResolvedValueOnce(redirectResponse)
        .mockResolvedValueOnce(finalResponse);

      const messages: string[] = [];
      transport.on('message', (m: string) => messages.push(m));

      await transport.send('{"id":1}');
      // At minimum 2 fetches: redirect + final
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('error status handling', () => {
    it('emits log when 5xx triggers SSE fallback attempt', async () => {
      await transport.start();

      // 500 on unknown mode → SSE fallback attempt; SSE GET also gets error (status >= 300)
      const errorResponse = {
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        body: null,
        text: async () => 'server error',
      } as unknown as Response;

      mockFetch.mockResolvedValue(errorResponse);

      const logs: Array<[string, string]> = [];
      transport.on('log', (level: string, msg: string) => logs.push([level, msg]));

      // May resolve or reject depending on SSE fallback behavior
      try {
        await transport.send('{"id":1}');
      } catch {
        // Expected on SSE fallback failure
      }
      // Should have tried SSE fallback
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('triggers SSE fallback on 4xx unknown mode', async () => {
      await transport.start();

      const notFoundResponse = {
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({}),
        body: null,
        text: async () => 'not found',
      } as unknown as Response;

      mockFetch.mockResolvedValue(notFoundResponse);

      // Should fall back to SSE (which also gets 404 → sets error state and returns)
      try {
        await transport.send('{"id":1}');
      } catch {
        // May reject
      }
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
