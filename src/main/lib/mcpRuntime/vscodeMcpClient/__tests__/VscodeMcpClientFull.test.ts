// @ts-nocheck
import { EventEmitter } from 'events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VscodeMcpClient } from '../VscodeMcpClient';
import { TOOL_IDLE_TIMEOUT_MS, MCP_CONNECT_TIMEOUT_MS, MCP_CONTROL_REQUEST_TIMEOUT_MS, IDLE_TIMEOUT_ESCALATION_THRESHOLD } from '../../toolTimeoutPolicy';

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
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  transport = new FakeTransport();
  mockCreateFromVscodeConfig.mockReset();
  mockCreateFromVscodeConfig.mockReturnValue(transport);
});

afterEach(async () => {
  // Flush any fire-and-forget background responses (e.g. the non-awaited
  // discoverResources reply) so a deferred setImmediate cannot fire on the NEXT
  // test's freshly-assigned shared transport and pollute it.
  if (!vi.isFakeTimers()) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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

describe('internal guards', () => {
  it('setupTransportHandlers is a no-op when transport is null', () => {
    const c = makeClient();
    // No transport has been created yet; the guard must return without throwing.
    expect(() => (c as any).setupTransportHandlers()).not.toThrow();
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

  it('fails the connection when required tools/list returns an error', async () => {
    let stopped = false;
    transport.stopImpl = async () => {
      stopped = true;
      transport.state = { state: 'stopped' };
    };
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respondError(req.id, -32000, 'tools not supported'));
      }
    };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow('tools not supported');
    expect(c.getState().state).toBe('error');
    expect(c.getTools()).toEqual([]);
    expect(stopped).toBe(true);
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

  it('does not include resources/list in the connect budget', async () => {
    let resourcesListId: number | undefined;
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respond(req.id, { tools: [] }));
      } else if (req.method === 'resources/list') {
        resourcesListId = req.id;
      }
    };

    const c = makeClient({ timeout: 5000 });
    const connectPromise = c.connect();
    const result = await Promise.race([
      connectPromise.then(() => 'connected'),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ]);

    try {
      expect(result).toBe('connected');
      expect(c.getState().state).toBe('running');
      expect(resourcesListId).toBeDefined();
    } finally {
      if (resourcesListId !== undefined) {
        transport.respond(resourcesListId, { resources: [] });
      }
      await connectPromise;
    }
  });

  it('falls back to empty arrays and default timeout when fields are absent', async () => {
    // timeout:undefined exercises the `|| 30000` default; missing tools/resources
    // fields exercise the `|| []` fallbacks in discovery.
    const c = makeClient({ timeout: undefined });
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      } else if (req.method === 'tools/list') {
        setImmediate(() => transport.respond(req.id, {}));
      } else if (req.method === 'resources/list') {
        setImmediate(() => transport.respond(req.id, {}));
      }
    };
    await c.connect();
    await new Promise((resolve) => setImmediate(resolve));
    expect(c.getState().state).toBe('running');
    expect(c.getTools()).toEqual([]);
    expect(c.getResources()).toEqual([]);
  });

  it('emits stateChange events', async () => {
    const c = makeClient();
    const states: string[] = [];
    c.on('stateChange', (s) => states.push(s.state));
    await connectSuccess(c);
    expect(states).toContain('starting');
    expect(states).toContain('running');
  });

  it('keeps a slow tools/list inside the 2-minute connect budget instead of the control timeout', async () => {
    const c = makeClient({ timeout: 50 });
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        setImmediate(() => transport.respond(req.id, { capabilities: {} }));
      }
      // tools/list intentionally left unanswered
    };
    vi.useFakeTimers();
    try {
      const connectPromise = c.connect();
      const assertion = expect(connectPromise).rejects.toThrow(/MCP connection timed out/);

      await vi.advanceTimersByTimeAsync(50 + 10);
      expect(c.getState().state).toBe('starting');

      await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS - 50);
      await assertion;
      expect(c.getState().state).toBe('error');
    } finally {
      vi.useRealTimers();
    }
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

  it('stringifies a non-Error thrown during connect', async () => {
    // Exercises the `String(error)` arm of the connect catch block.
    transport.startImpl = async () => { throw 'plain string failure'; };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow('plain string failure');
    expect(c.getState().state).toBe('error');
  });

  it('wraps a non-Error initialize rejection', async () => {
    // Exercises the `new Error(String(error))` arm of initializeMcp's catch.
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'initialize') {
        return Promise.reject('non-error-initialize');
      }
    };
    const c = makeClient();
    await expect(c.connect()).rejects.toThrow(/Failed to initialize MCP server/);
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

  it('fails the connection with a timeout when a step never completes', async () => {
    // transport starts, but initialize never gets a response: the connect budget
    // is the only thing that can settle connect().
    transport.sendImpl = () => {};
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; transport.state = { state: 'stopped' }; };
    const c = makeClient();
    vi.useFakeTimers();
    try {
      const connectPromise = c.connect();
      const assertion = expect(connectPromise).rejects.toThrow(/connection timed out/i);
      await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS + 10);
      await assertion;
      expect(c.getState().state).toBe('error');
      expect(c.getState().message).toMatch(/connection timed out/i);
      // Teardown must stop the child process so it does not linger.
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still reports a timeout error when teardown stop() throws', async () => {
    transport.sendImpl = () => {};
    transport.stopImpl = async () => { throw new Error('stop failed'); };
    const c = makeClient();
    vi.useFakeTimers();
    try {
      const connectPromise = c.connect();
      const assertion = expect(connectPromise).rejects.toThrow(/connection timed out/i);
      await vi.advanceTimersByTimeAsync(MCP_CONNECT_TIMEOUT_MS + 10);
      await assertion;
      expect(c.getState().state).toBe('error');
    } finally {
      vi.useRealTimers();
    }
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

  it('fails only the request and keeps the connection on a single idle timeout', async () => {
    const c = makeClient();
    await connectSuccess(c);
    // Never respond, so only the idle watchdog can settle the call.
    const sent: any[] = [];
    transport.sendImpl = (msg: string) => { sent.push(JSON.parse(msg)); };
    let stopped = false;
    transport.stopImpl = async () => {
      stopped = true;
      transport.state = { state: 'stopped' };
    };
    vi.useFakeTimers();
    try {
      const callPromise = c.callTool('slow', {});
      const assertion = expect(callPromise).rejects.toThrow(/produced no response/);
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 10);
      await assertion;
      // A single hung tool must NOT tear down the connection.
      expect(stopped).toBe(false);
      expect(c.getState()).toMatchObject({ state: 'running' });
      // Best-effort cancellation is sent for the timed-out request.
      expect(sent.some((m) => m.method === 'notifications/cancelled')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates to a connection reset after repeated consecutive idle timeouts', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {};
    let stopCount = 0;
    transport.stopImpl = async () => {
      stopCount++;
      transport.state = { state: 'stopped' };
    };
    vi.useFakeTimers();
    try {
      for (let i = 0; i < IDLE_TIMEOUT_ESCALATION_THRESHOLD; i++) {
        const callPromise = c.callTool(`slow${i}`, {});
        const assertion = expect(callPromise).rejects.toThrow(/produced no response/);
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 10);
        await assertion;
      }
      // Only the Nth consecutive timeout resets the connection.
      expect(stopCount).toBe(1);
      expect(c.getState()).toMatchObject({
        state: 'error',
        message: expect.stringMatching(/produced no response/)
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the idle error and error state when escalation stop() throws', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {};
    transport.stopImpl = async () => { throw new Error('stop failed'); };
    vi.useFakeTimers();
    try {
      for (let i = 0; i < IDLE_TIMEOUT_ESCALATION_THRESHOLD; i++) {
        const callPromise = c.callTool(`slow${i}`, {});
        const assertion = expect(callPromise).rejects.toThrow(/produced no response/);
        await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS + 10);
        await assertion;
      }
      expect(c.getState()).toMatchObject({
        state: 'error',
        message: expect.stringMatching(/produced no response/)
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the idle countdown when the server sends activity', async () => {
    const c = makeClient();
    await connectSuccess(c);
    let callId: number | undefined;
    let progressToken: string | number | undefined;
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'tools/call') {
        callId = req.id;
        progressToken = req.params?._meta?.progressToken;
      }
    };
    vi.useFakeTimers();
    try {
      const callPromise = c.callTool('streamy', {});
      // Advance to just before the idle limit, then deliver server activity.
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
      transport.notify('notifications/progress', { progressToken, progress: 1 });
      // Without the reset this next advance would trip the watchdog; it must not.
      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
      transport.respond(callId!, { ok: true });
      await expect(callPromise).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reset one tool idle countdown from another concurrent tool response', async () => {
    const c = makeClient();
    await connectSuccess(c);
    const calls = new Map<string, { id: number; progressToken: string | number }>();
    transport.sendImpl = (msg: string) => {
      const req = JSON.parse(msg);
      if (req.method === 'tools/call') {
        calls.set(req.params.name, {
          id: req.id,
          progressToken: req.params._meta.progressToken,
        });
      }
    };

    vi.useFakeTimers();
    try {
      const silentPromise = c.callTool('silent', {});
      silentPromise.catch(() => {});
      const activePromise = c.callTool('active', {});

      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
      const active = calls.get('active')!;
      transport.notify('notifications/progress', { progressToken: active.progressToken, progress: 1 });
      transport.respond(active.id, { ok: true });
      await expect(activePromise).resolves.toEqual({ ok: true });

      await vi.advanceTimersByTimeAsync(1000);
      await expect(silentPromise).rejects.toThrow(/produced no response/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reset the idle countdown from a progress notification without a matching token', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {};

    vi.useFakeTimers();
    try {
      const callPromise = c.callTool('silent', {});
      callPromise.catch(() => {});

      await vi.advanceTimersByTimeAsync(TOOL_IDLE_TIMEOUT_MS - 1000);
      transport.notify('notifications/progress', { progress: 1 });
      await vi.advanceTimersByTimeAsync(1000);

      await expect(callPromise).rejects.toThrow(/produced no response/);
    } finally {
      vi.useRealTimers();
    }
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

// ── unmatched JSON-RPC error responses ───────────────────────────────────────

describe('unmatched JSON-RPC error responses', () => {
  it('fails the connection fast on a lost-session error with an empty id', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {}; // never reply through the normal path
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; transport.state = { state: 'stopped' }; };

    const callPromise = c.callTool('teams_send', {});
    const assertion = expect(callPromise).rejects.toThrow(/Session not found/);
    // Upstream proxy answer: error, empty id → previously dropped as a notification.
    transport.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: '',
      error: { code: -32001, message: 'Session not found' },
    }));
    await assertion;
    await Promise.resolve();
    expect(stopped).toBe(true);
    expect(c.getState()).toMatchObject({ state: 'error' });
  });

  it('fails only the single in-flight request for an ambiguous unmatched error', async () => {
    const c = makeClient();
    await connectSuccess(c);
    transport.sendImpl = () => {};
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; };

    const callPromise = c.callTool('lonely', {});
    // Error object with neither message nor code → exercises the description fallbacks.
    const assertion = expect(callPromise).rejects.toThrow(/unknown error \(n\/a\)/);
    transport.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: '',
      error: {},
    }));
    await assertion;
    // The connection is kept; only the request failed.
    expect(stopped).toBe(false);
    expect(c.getState()).toMatchObject({ state: 'running' });
  });

  it('ignores an ambiguous unmatched error when no request is in flight', async () => {
    const c = makeClient();
    await connectSuccess(c);
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; };

    transport.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: '',
      error: { code: -32000, message: 'orphan error' },
    }));
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(c.getState()).toMatchObject({ state: 'running' });
  });

  it('does not reject an unrelated request for a stale error carrying a concrete id', async () => {
    const c = makeClient();
    await connectSuccess(c);
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; };

    // One unrelated request is in flight; capture its real id so we can settle it later.
    let survivorId: number | undefined;
    transport.sendImpl = (msg: string) => { survivorId = JSON.parse(msg).id; };
    const callPromise = c.callTool('survivor', {});
    let settled = false;
    callPromise.then(() => { settled = true; }, () => { settled = true; });

    // A late error for a DIFFERENT, already-removed request id arrives (not connection-lost).
    transport.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: 999,
      error: { code: -32000, message: 'late reply for a dead request' },
    }));
    await Promise.resolve();

    // The unrelated request is untouched and the connection stays up.
    expect(settled).toBe(false);
    expect(stopped).toBe(false);
    expect(c.getState()).toMatchObject({ state: 'running' });

    // Settle the survivor so the test leaves no dangling request.
    transport.respond(survivorId as number, { ok: true });
    await expect(callPromise).resolves.toMatchObject({ ok: true });
  });
});

// ── matched JSON-RPC error responses ─────────────────────────────────────────

describe('matched JSON-RPC error responses', () => {
  it('fails the whole connection on a matched lost-session error (not just the one request)', async () => {
    const c = makeClient();
    await connectSuccess(c);
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; transport.state = { state: 'stopped' }; };

    // Capture the real id the client assigned to this request so the proxy can echo it.
    let reqId: number | undefined;
    transport.sendImpl = (msg: string) => { reqId = JSON.parse(msg).id; };

    const callPromise = c.callTool('teams_send', {});
    const assertion = expect(callPromise).rejects.toThrow(/Session not found/);

    // The proxy answers THIS request's id with a fatal session error.
    transport.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: reqId,
      error: { code: -32001, message: 'Session not found' },
    }));

    await assertion;
    await Promise.resolve();
    // The connection is failed and torn down so the manager can auto-reconnect.
    expect(stopped).toBe(true);
    expect(c.getState()).toMatchObject({ state: 'error' });
  });

  it('rejects only the request for a matched non-connection-lost business error', async () => {
    const c = makeClient();
    await connectSuccess(c);
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; };

    let reqId: number | undefined;
    transport.sendImpl = (msg: string) => { reqId = JSON.parse(msg).id; };

    const callPromise = c.callTool('do_thing', {});
    const assertion = expect(callPromise).rejects.toThrow(/MCP Error: boom \(-32000\)/);

    transport.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: reqId,
      error: { code: -32000, message: 'boom' },
    }));

    await assertion;
    // The connection stays up; only the request failed (unchanged behavior).
    expect(stopped).toBe(false);
    expect(c.getState()).toMatchObject({ state: 'running' });
  });
});

// ── connection-failure / cancellation internals (defensive branches) ─────────

describe('failConnection and cancellation internals', () => {
  it('sendCancellationNotification is a no-op when the transport is already gone', async () => {
    const c = makeClient();
    await connectSuccess(c);
    (c as any).transport = null;
    // Must not throw even though there is no transport to send through.
    expect(() => (c as any).sendCancellationNotification(1, 'reason')).not.toThrow();
  });

  it('swallows a rejected cancellation notification (Error and non-Error)', async () => {
    const c = makeClient();
    await connectSuccess(c);

    transport.sendImpl = () => Promise.reject(new Error('send blew up'));
    (c as any).sendCancellationNotification(1, 'err-reason');
    await Promise.resolve();
    await Promise.resolve();

    transport.sendImpl = () => Promise.reject('string failure');
    (c as any).sendCancellationNotification(2, 'str-reason');
    await Promise.resolve();
    await Promise.resolve();

    // Connection stays healthy: a best-effort cancel failure is non-fatal.
    expect(c.getState()).toMatchObject({ state: 'running' });
  });

  it('failConnection returns after rejecting pending requests when the transport is null', async () => {
    const c = makeClient();
    await connectSuccess(c);
    (c as any).transport = null;
    (c as any).failConnection(new Error('already torn down'));
    expect(c.getState()).toMatchObject({ state: 'error', message: 'already torn down' });
  });

  it('logs and recovers when transport.stop rejects with a non-Error during failConnection', async () => {
    const c = makeClient();
    await connectSuccess(c);
    let stopped = false;
    transport.stopImpl = async () => { stopped = true; throw 'stop string failure'; };

    (c as any).failConnection(new Error('fatal'));
    await Promise.resolve();
    await Promise.resolve();

    expect(stopped).toBe(true);
    expect(c.getState()).toMatchObject({ state: 'error', message: 'fatal' });
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

  it('uses the fixed short timeout for control requests regardless of legacy config', async () => {
    const c = makeClient({ timeout: 1 });
    await connectSuccess(c);
    transport.sendImpl = () => {};

    vi.useFakeTimers();
    try {
      let settled = false;
      const readPromise = c.readResource('res://silent').finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);

      const assertion = expect(readPromise).rejects.toThrow(`Request timeout: resources/read (${MCP_CONTROL_REQUEST_TIMEOUT_MS}ms)`);
      await vi.advanceTimersByTimeAsync(MCP_CONTROL_REQUEST_TIMEOUT_MS + 10);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
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
