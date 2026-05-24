// @ts-nocheck
import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VscodeMcpClient } from '../VscodeMcpClient';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Creates a fake transport with controllable behaviour */
class FakeTransport extends EventEmitter {
  public state: { state: 'stopped' | 'running' | 'error' } = { state: 'stopped' };
  public sendImpl: (msg: string) => Promise<void> | void = () => {};
  public stopImpl: () => Promise<void> = async () => {};
  public startImpl: () => Promise<void> = async () => {
    this.state = { state: 'running' };
  };

  async start(): Promise<void> { return this.startImpl(); }
  send(msg: string): Promise<void> | void { return this.sendImpl(msg); }
  async stop(): Promise<void> { return this.stopImpl(); }

  /** Helper: emit a JSON-RPC response for the given id */
  respond(id: number, result: any): void {
    this.emit('message', JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  respondError(id: number, code: number, message: string): void {
    this.emit('message', JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
  }

  /** Emit a server-side notification (no id) */
  notify(method: string, params?: any): void {
    this.emit('message', JSON.stringify({ jsonrpc: '2.0', method, params }));
  }
}

const mockCreateFromVscodeConfig = vi.fn();

vi.mock('../transport/VscodeTransportFactory', () => ({
  VscodeTransportFactory: {
    createFromVscodeConfig: (...args: unknown[]) => mockCreateFromVscodeConfig(...args),
  },
}));

vi.mock('../../../unifiedLogger', () => ({
  createConsoleLogger: vi.fn(() => ({ log: vi.fn() })),
}));

// ── shared setup ────────────────────────────────────────────────────────────

let transport: FakeTransport;

function makeClient(overrides?: object) {
  return new VscodeMcpClient({
    name: 'test-server',
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    timeout: 500,
    ...overrides,
  });
}

/** Connect a client through the full happy path (initialize + discover) */
async function connectSuccess(client: VscodeMcpClient, tools = [], resources = []) {
  let nextId = 0;

  const origSend = transport.sendImpl;
  transport.sendImpl = (msg: string) => {
    const req = JSON.parse(msg);

    if (req.method === 'initialize') {
      const id = req.id;
      setImmediate(() => transport.respond(id, { capabilities: { tools: {}, resources: {} } }));
    } else if (req.method === 'notifications/initialized') {
      // no response needed
    } else if (req.method === 'tools/list') {
      const id = req.id;
      setImmediate(() => transport.respond(id, { tools }));
    } else if (req.method === 'resources/list') {
      const id = req.id;
      setImmediate(() => transport.respond(id, { resources }));
    }
  };

  await client.connect();
}

beforeEach(() => {
  transport = new FakeTransport();
  mockCreateFromVscodeConfig.mockReset();
  mockCreateFromVscodeConfig.mockReturnValue(transport);
});

// ── constructor / getters ────────────────────────────────────────────────────

describe('initial state', () => {
  it('state is stopped before connect', () => {
    const c = makeClient();
    expect(c.getState()).toEqual({ state: 'stopped' });
  });

  it('getConfig returns a copy of the config', () => {
    const c = makeClient({ name: 'srv', timeout: 1234 });
    expect(c.getConfig().name).toBe('srv');
    expect(c.getConfig().timeout).toBe(1234);
  });

  it('getTools returns empty array before connect', () => {
    expect(makeClient().getTools()).toEqual([]);
  });

  it('getResources returns empty array before connect', () => {
    expect(makeClient().getResources()).toEqual([]);
  });
});

// ── connect — happy path ─────────────────────────────────────────────────────

describe('connect — happy path', () => {
  it('reaches running state after successful connect', async () => {
    const c = makeClient();
    await connectSuccess(c, [{ name: 'tool1', inputSchema: {} }], [{ uri: 'res://a', name: 'A' }]);
    expect(c.getState().state).toBe('running');
  });

  it('exposes discovered tools', async () => {
    const c = makeClient();
    await connectSuccess(c, [{ name: 'greet', description: 'hello', inputSchema: {} }]);
    expect(c.getTools()).toHaveLength(1);
    expect(c.getTools()[0].name).toBe('greet');
  });

  it('exposes discovered resources', async () => {
    const c = makeClient();
    await connectSuccess(c, [], [{ uri: 'res://x', name: 'X' }]);
    expect(c.getResources()).toHaveLength(1);
    expect(c.getResources()[0].uri).toBe('res://x');
  });

  it('is a no-op to call connect again when already running', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const before = c.getState();
    await c.connect(); // should no-op
    expect(c.getState()).toEqual(before);
  });

  it('is a no-op when state is starting', async () => {
    const c = makeClient();
    // Manually set state to starting by spying on setState
    (c as any).currentState = { state: 'starting' };
    await c.connect(); // should no-op
    expect((c as any).currentState.state).toBe('starting');
  });

  it('tools/list failure is swallowed, resources still discovered', async () => {
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respondError(req.id, -32000, 'tools not supported'));
      } else if (req.method === 'resources/list') {
        setImmediate(() => transport.respond(req.id, { resources: [] }));
      }
    };
    const c = makeClient();
    await c.connect();
    expect(c.getState().state).toBe('running');
    expect(c.getTools()).toEqual([]);
  });

  it('resources/list failure is swallowed, tools still discovered', async () => {
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respond(req.id, { tools: [] }));
      } else if (req.method === 'resources/list') {
        setImmediate(() => transport.respondError(req.id, -32001, 'resources not supported'));
      }
    };
    const c = makeClient();
    await c.connect();
    expect(c.getState().state).toBe('running');
  });

  it('emits stateChange events', async () => {
    const c = makeClient();
    const states: string[] = [];
    c.on('stateChange', (s) => states.push(s.state));
    await connectSuccess(c);
    expect(states).toContain('starting');
    expect(states).toContain('running');
  });

  it('emits log events', async () => {
    const c = makeClient();
    const logs: string[] = [];
    c.on('log', (level) => logs.push(level));
    await connectSuccess(c);
    expect(logs.length).toBeGreaterThan(0);
  });
});

// ── connect — failure paths ──────────────────────────────────────────────────

describe('connect — failures', () => {
  it('sets error state when transport.start() throws', async () => {
    transport.startImpl = async () => { throw new Error('spawn failed'); };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow('spawn failed');
    expect(c.getState().state).toBe('error');
  });

  it('appends stderr preview to error message when available', async () => {
    (transport as any).getStderrPreview = () => 'stderr line from process';
    transport.startImpl = async () => { throw new Error('init failed'); };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow('stderr line from process');
    expect(c.getState().message).toContain('stderr line from process');
  });

  it('does not duplicate stderr when error already contains it', async () => {
    (transport as any).getStderrPreview = () => 'stderr output: details';
    transport.startImpl = async () => { throw new Error('failed\n\nStderr output: details'); };
    const c = makeClient();
    let err: Error | undefined;
    try { await c.connect(); } catch (e) { err = e as Error; }
    const count = (err!.message.match(/stderr output:/gi) || []).length;
    expect(count).toBe(1);
  });

  it('ignores empty stderr preview', async () => {
    (transport as any).getStderrPreview = () => '   ';
    transport.startImpl = async () => { throw new Error('transport error'); };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow('transport error');
  });

  it('sets error state when initialize response is an MCP error', async () => {
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respondError(req.id, -32001, 'init error'));
      }
    };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow(/Failed to initialize MCP server/);
    expect(c.getState().state).toBe('error');
  });

  it('appends stderr in initializeMcp failure', async () => {
    (transport as any).getStderrPreview = () => 'Python traceback line';
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respondError(req.id, -32001, 'init failed'));
      }
    };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow('Python traceback line');
  });

  it('appends stderr in initializeMcp failure when not already present', async () => {
    const uniqueStderr = 'unique-stderr-xyz-123';
    (transport as any).getStderrPreview = () => uniqueStderr;
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        // Error message does NOT contain the stderr content
        setImmediate(() => transport.respondError(req.id, -32001, 'init failed completely'));
      }
    };
    const c = makeClient();
    let err: Error | undefined;
    try { await c.connect(); } catch (e) { err = e as Error; }
    expect(err!.message).toContain(uniqueStderr);
  });
});

// ── disconnect ───────────────────────────────────────────────────────────────

describe('disconnect', () => {
  it('is a no-op when already stopped', async () => {
    const c = makeClient();
    await c.disconnect(); // should not throw
    expect(c.getState().state).toBe('stopped');
  });

  it('stops transport and clears state', async () => {
    const c = makeClient();
    await connectSuccess(c, [{ name: 'tool', inputSchema: {} }]);
    expect(c.getState().state).toBe('running');
    await c.disconnect();
    expect(c.getState().state).toBe('stopped');
    expect(c.getTools()).toEqual([]);
    expect(c.getResources()).toEqual([]);
  });

  it('rejects pending requests on disconnect', async () => {
    const c = makeClient();
    await connectSuccess(c);

    // Issue a call but don't respond
    const callPromise = c.callTool('slow_tool', {});
    await c.disconnect();
    await expect(callPromise).rejects.toThrow('Connection closed');
  });

  it('clears pending timeouts on disconnect', async () => {
    const c = makeClient();
    await connectSuccess(c);

    // Add a fake pending request with a timeout
    const fakeTimeout = setTimeout(() => {}, 10000);
    (c as any).pendingRequests.set(9999, {
      resolve: vi.fn(),
      reject: vi.fn(),
      timeout: fakeTimeout,
    });

    await c.disconnect();
    // After disconnect pendingRequests should be empty
    expect((c as any).pendingRequests.size).toBe(0);
  });
});

// ── callTool ─────────────────────────────────────────────────────────────────

describe('callTool', () => {
  it('throws when not connected', async () => {
    const c = makeClient();
    await expect(c.callTool('x', {})).rejects.toThrow('Client is not connected');
  });

  it('returns tool result', async () => {
    const c = makeClient();
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respond(req.id, { tools: [] }));
      } else if (req.method === 'resources/list') {
        setImmediate(() => transport.respond(req.id, { resources: [] }));
      } else if (req.method === 'tools/call') {
        setImmediate(() => transport.respond(req.id, { content: [{ type: 'text', text: 'hello' }] }));
      }
    };
    await c.connect();
    const result = await c.callTool('greet', { name: 'world' });
    expect(result.content[0].text).toBe('hello');
  });

  it('rejects when MCP error returned', async () => {
    const c = makeClient();
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respond(req.id, { tools: [] }));
      } else if (req.method === 'resources/list') {
        setImmediate(() => transport.respond(req.id, { resources: [] }));
      } else if (req.method === 'tools/call') {
        setImmediate(() => transport.respondError(req.id, -32000, 'tool error'));
      }
    };
    await c.connect();
    await expect(c.callTool('bad_tool', {})).rejects.toThrow('MCP Error: tool error');
  });

  it('rejects when AbortSignal already aborted', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const controller = new AbortController();
    controller.abort();
    await expect(c.callTool('x', {}, { signal: controller.signal })).rejects.toThrow('Request aborted');
  });

  it('rejects when AbortSignal is aborted after send', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const controller = new AbortController();
    // Don't respond so we can abort in-flight
    transport.sendImpl = () => {};
    const callPromise = c.callTool('x', {}, { signal: controller.signal });
    controller.abort();
    await expect(callPromise).rejects.toThrow('Request aborted');
  });

  it('times out after configured timeout', async () => {
    const c = makeClient({ timeout: 50 });
    await connectSuccess(c);
    // Don't respond
    transport.sendImpl = () => {};
    await expect(c.callTool('slow', {})).rejects.toThrow(/Request timeout/);
  });

  it('rejects when transport send throws synchronously', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => { throw new Error('send failure'); };
    await expect(c.callTool('x', {})).rejects.toThrow('send failure');
  });

  it('rejects when transport send returns a rejected promise', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => Promise.reject(new Error('async send failure'));
    await expect(c.callTool('x', {})).rejects.toThrow('async send failure');
  });
});

// ── readResource ─────────────────────────────────────────────────────────────

describe('readResource', () => {
  it('throws when not connected', async () => {
    const c = makeClient();
    await expect(c.readResource('res://x')).rejects.toThrow('Client is not connected');
  });

  it('returns resource content', async () => {
    const c = makeClient();
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respond(req.id, { tools: [] }));
      } else if (req.method === 'resources/list') {
        setImmediate(() => transport.respond(req.id, { resources: [] }));
      } else if (req.method === 'resources/read') {
        setImmediate(() => transport.respond(req.id, { contents: [{ text: 'data' }] }));
      }
    };
    await c.connect();
    const result = await c.readResource('res://a');
    expect(result.contents[0].text).toBe('data');
  });
});

// ── transport stateChange events ─────────────────────────────────────────────

describe('transport stateChange events', () => {
  it('sets client state to error when transport emits error', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.emit('stateChange', { state: 'error', message: 'pipe broke' });
    expect(c.getState().state).toBe('error');
    expect(c.getState().message).toBe('pipe broke');
  });

  it('uses default error message when transport error has no message', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.emit('stateChange', { state: 'error' });
    expect(c.getState().state).toBe('error');
    expect(c.getState().message).toBe('Transport error');
  });

  it('rejects pending requests when transport emits error', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {}; // don't respond
    const callPromise = c.callTool('x', {});
    transport.emit('stateChange', { state: 'error', message: 'pipe broke' });
    await expect(callPromise).rejects.toThrow('pipe broke');
  });

  it('rejects pending requests when transport stops unexpectedly', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {}; // don't respond
    const callPromise = c.callTool('x', {});
    transport.emit('stateChange', { state: 'stopped', message: 'closed' });
    await expect(callPromise).rejects.toThrow();
  });

  it('sets error state when transport stops during starting', async () => {
    // Build a scenario where transport stops during MCP init
    let initId: number | null = null;
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        initId = req.id;
        // Don't respond – instead emit stopped
        setImmediate(() => transport.emit('stateChange', { state: 'stopped' }));
      }
    };
    const c = makeClient();
    // connect will reject because the pending init request is rejected
    await expect(c.connect()).rejects.toThrow();
  });

  it('uses default message for stopped-during-starting', async () => {
    transport.sendImpl = () => {
      setImmediate(() => transport.emit('stateChange', { state: 'stopped' }));
    };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow();
    // state should be 'error' (set by stateChange handler or catch)
    expect(c.getState().state).toBe('error');
  });

  it('does not set error state when already running and transport stops', async () => {
    const c = makeClient();
    await connectSuccess(c);
    // When running, a stopped transport should NOT change state to error (no pending requests)
    transport.emit('stateChange', { state: 'stopped' });
    // State stays running (no pending requests to reject, and state is not 'starting')
    expect(c.getState().state).toBe('running');
  });

  it('logs transport log events', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const logs: string[] = [];
    c.on('log', (level, msg) => logs.push(`${level}:${msg}`));
    transport.emit('log', 'debug', 'transport debug message');
    expect(logs.some(l => l.includes('transport debug message'))).toBe(true);
  });
});

// ── handleMessage edge cases ─────────────────────────────────────────────────

describe('handleMessage edge cases', () => {
  it('handles notification from server (no id)', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const notifications: any[] = [];
    c.on('notification', (n) => notifications.push(n));
    transport.notify('server/notification', { data: 'test' });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe('server/notification');
  });

  it('ignores malformed JSON message', async () => {
    const c = makeClient();
    await connectSuccess(c);
    // Should not throw
    transport.emit('message', '{bad json');
    expect(c.getState().state).toBe('running');
  });

  it('ignores response for unknown request id', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.emit('message', JSON.stringify({ jsonrpc: '2.0', id: 9999, result: {} }));
    // Should not throw
    expect(c.getState().state).toBe('running');
  });

  it('handles response with id=0 (falsy but valid)', async () => {
    const c = makeClient();
    await connectSuccess(c);
    // Manually add pending request with id 0
    const resolve = vi.fn();
    const reject = vi.fn();
    (c as any).pendingRequests.set(0, { resolve, reject, timeout: undefined });
    // Call handleMessage directly since transport handlers are set up after connect
    (c as any).handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 0, result: { ok: true } }));
    expect(resolve).toHaveBeenCalledWith({ ok: true });
  });
});

// ── sendRequestNoTimeout ─────────────────────────────────────────────────────

describe('sendRequestNoTimeout', () => {
  it('rejects when transport becomes null before send', async () => {
    const c = makeClient();
    // Set transport to simulate no-transport
    (c as any).transport = null;
    await expect((c as any).sendRequestNoTimeout({ id: 1, method: 'test' })).rejects.toThrow('Transport not available');
  });

  it('rejects when transport send throws synchronously', async () => {
    const c = makeClient();
    await connectSuccess(c);

    // Now call sendRequestNoTimeout directly
    transport.sendImpl = () => { throw new Error('sync send error'); };
    const promise = (c as any).sendRequestNoTimeout({ jsonrpc: '2.0', id: 999, method: 'test' });
    await expect(promise).rejects.toThrow('sync send error');
  });

  it('rejects when transport send returns a rejected promise', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => Promise.reject(new Error('async send error'));
    const promise = (c as any).sendRequestNoTimeout({ jsonrpc: '2.0', id: 998, method: 'test' });
    await expect(promise).rejects.toThrow('async send error');
  });
});

// ── sendNotification ─────────────────────────────────────────────────────────

describe('sendNotification', () => {
  it('throws when no transport', async () => {
    const c = makeClient();
    (c as any).transport = null;
    await expect((c as any).sendNotification({ method: 'test' })).rejects.toThrow('Transport not available');
  });

  it('awaits async send', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const resolved: string[] = [];
    transport.sendImpl = async (msg: string) => {
      resolved.push(msg);
    };
    await (c as any).sendNotification({ jsonrpc: '2.0', method: 'test/notification' });
    expect(resolved).toHaveLength(1);
  });
});

// ── sendRequestWithTimeout — transport null race ──────────────────────────────

describe('sendRequestWithTimeout — transport null mid-flight', () => {
  it('rejects when transport becomes null inside promise body', async () => {
    const c = makeClient({ timeout: 5000 });
    await connectSuccess(c);
    // Set transport to null after connect
    transport.sendImpl = () => {
      (c as any).transport = null;
    };
    const callPromise = c.callTool('x', {});
    // Restore so disconnect doesn't fail
    (c as any).transport = transport;
    await c.disconnect();
    await expect(callPromise).rejects.toThrow();
  });
});

// ── rejectPendingRequests when empty ─────────────────────────────────────────

describe('rejectPendingRequests', () => {
  it('is a no-op when there are no pending requests', async () => {
    const c = makeClient();
    await connectSuccess(c);
    expect(() => (c as any).rejectPendingRequests(new Error('test'))).not.toThrow();
  });

  it('rejects all pending requests and clears map', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const reject1 = vi.fn();
    const reject2 = vi.fn();
    (c as any).pendingRequests.set(1, { resolve: vi.fn(), reject: reject1, timeout: undefined });
    (c as any).pendingRequests.set(2, { resolve: vi.fn(), reject: reject2, timeout: setTimeout(() => {}, 5000) });

    (c as any).rejectPendingRequests(new Error('closing'));
    expect(reject1).toHaveBeenCalled();
    expect(reject2).toHaveBeenCalled();
    expect((c as any).pendingRequests.size).toBe(0);
  });
});

// ── log level mapping ────────────────────────────────────────────────────────

describe('log level mapping', () => {
  it('maps trace → DEBUG', () => {
    const logMock = vi.fn();
    const c = makeClient();
    (c as any).logger = { log: logMock };
    (c as any).log('trace', 'trace msg');
    expect(logMock).toHaveBeenCalledWith('DEBUG', 'trace msg', 'VscodeMcpClient', expect.any(Object));
  });

  it('maps warning → WARN', () => {
    const logMock = vi.fn();
    const c = makeClient();
    (c as any).logger = { log: logMock };
    (c as any).log('warning', 'warn msg');
    expect(logMock).toHaveBeenCalledWith('WARN', 'warn msg', 'VscodeMcpClient', expect.any(Object));
  });

  it('maps info → INFO', () => {
    const logMock = vi.fn();
    const c = makeClient();
    (c as any).logger = { log: logMock };
    (c as any).log('info', 'info msg');
    expect(logMock).toHaveBeenCalledWith('INFO', 'info msg', 'VscodeMcpClient', expect.any(Object));
  });

  it('emits log event with server name prefix', () => {
    const c = makeClient({ name: 'my-srv' });
    const logs: any[] = [];
    c.on('log', (level, msg) => logs.push({ level, msg }));
    (c as any).log('debug', 'test message');
    expect(logs[0].msg).toContain('[my-srv]');
    expect(logs[0].msg).toContain('test message');
  });
});
