// @ts-nocheck
/**
 * Unit tests for BrowserControlHttpServer
 *
 * All external dependencies (electron, fs, http, profileCacheManager,
 * checkBrowserControlStatus, mcpClientManager) are mocked.
 * We spin up and tear down actual http.Server instances using Node's http
 * module — mocked via vi.mock so no real network is used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as EventEmitter from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// Hoisted mock refs
// ─────────────────────────────────────────────────────────────────────────────

const { mockFsExistsSync, mockFsReadFileSync, mockFsMkdirSync } = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn(() => false),
  mockFsReadFileSync: vi.fn(() => Buffer.from('xml-content')),
  mockFsMkdirSync: vi.fn(),
}));

const {
  mockCheckBrowserControlStatus,
  mockGetBrowserControlSettings,
  mockMcpGetRuntimeState,
  mockMcpConnect,
  mockMcpDisconnect,
  mockServerListen,
  mockServerClose,
  mockServerOn,
  capturedRequestHandler,
} = vi.hoisted(() => {
  let capturedRequestHandler: ((req: any, res: any) => void) | null = null;

  const serverInstance = {
    on: vi.fn(),
    listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
    close: vi.fn((cb: () => void) => cb()),
  };

  // Capture the request handler when createServer is called
  const mockHttpCreateServer = vi.fn((handler: (req: any, res: any) => void) => {
    capturedRequestHandler = handler;
    return serverInstance;
  });

  return {
    mockCheckBrowserControlStatus: vi.fn(() => Promise.resolve(true)),
    mockGetBrowserControlSettings: vi.fn(() => ({ browser: 'edge' })),
    mockMcpGetRuntimeState: vi.fn(() => null),
    mockMcpConnect: vi.fn(() => Promise.resolve()),
    mockMcpDisconnect: vi.fn(() => Promise.resolve()),
    mockServerListen: serverInstance.listen,
    mockServerClose: serverInstance.close,
    mockServerOn: serverInstance.on,
    capturedRequestHandler: () => capturedRequestHandler,
    __serverInstance: serverInstance,
    __mockHttpCreateServer: mockHttpCreateServer,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => '/fake/app') },
}));

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  mkdirSync: mockFsMkdirSync,
}));

const { __mockHttpCreateServer } = vi.hoisted(() => {
  let capturedRequestHandler: ((req: any, res: any) => void) | null = null;
  const serverInstance = {
    on: vi.fn(),
    listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
    close: vi.fn((cb: () => void) => cb()),
  };
  const mockCreate = vi.fn((handler: (req: any, res: any) => void) => {
    capturedRequestHandler = handler;
    return serverInstance;
  });
  (mockCreate as any).__getHandler = () => capturedRequestHandler;
  (mockCreate as any).__serverInstance = serverInstance;
  return { __mockHttpCreateServer: mockCreate };
});

vi.mock('http', () => ({
  createServer: __mockHttpCreateServer,
}));

vi.mock('../browserControlStatus', () => ({
  checkBrowserControlStatus: mockCheckBrowserControlStatus,
}));

vi.mock('../../userDataADO', () => ({
  profileCacheManager: {
    getBrowserControlSettings: mockGetBrowserControlSettings,
  },
}));

vi.mock('../../mcpRuntime/mcpClientManager', () => ({
  mcpClientManager: {
    getMcpServerRuntimeState: mockMcpGetRuntimeState,
    connect: mockMcpConnect,
    disconnect: mockMcpDisconnect,
  },
}));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeReqRes(
  method: string,
  url: string,
  body = '',
  headers: Record<string, string> = {}
) {
  const req = Object.assign(new EventEmitter.EventEmitter(), {
    method,
    url,
    headers: { host: '127.0.0.1', ...headers },
    destroy: vi.fn(),
  });

  const res = {
    writeHead: vi.fn(),
    end: vi.fn(),
  };

  // Emit body data after a microtask tick
  if (body) {
    Promise.resolve().then(() => {
      req.emit('data', Buffer.from(body));
      req.emit('end');
    });
  } else {
    Promise.resolve().then(() => {
      req.emit('end');
    });
  }

  return { req, res };
}

// ─────────────────────────────────────────────────────────────────────────────
// Import the module under test AFTER all mocks are set up
// ─────────────────────────────────────────────────────────────────────────────

describe('BrowserControlHttpServer', () => {
  let server: any;
  let httpCreateServer: any;

  beforeEach(async () => {
    vi.resetModules();
    mockCheckBrowserControlStatus.mockResolvedValue(true);
    mockGetBrowserControlSettings.mockReturnValue({ browser: 'edge' });
    mockMcpGetRuntimeState.mockReturnValue(null);
    mockMcpConnect.mockResolvedValue(undefined);
    mockMcpDisconnect.mockResolvedValue(undefined);
    mockFsExistsSync.mockReturnValue(false);

    // Re-import fresh instance each test
    const mod = await import('../browserControlHttpServer');
    server = mod.browserControlHttpServer;
    httpCreateServer = (await import('http')).createServer as any;
  });

  afterEach(async () => {
    // Ensure server is stopped between tests
    try {
      await server.stop();
    } catch {
      // ignore
    }
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────
  // start() / stop() lifecycle
  // ────────────────────────────────────────────────────────

  it('start() returns true when browser control is enabled', async () => {
    const result = await server.start('alice');
    expect(result).toBe(true);
  });

  it('start() returns false when browser control is disabled', async () => {
    mockCheckBrowserControlStatus.mockResolvedValue(false);
    const result = await server.start('alice');
    expect(result).toBe(false);
  });

  it('getIsRunning() returns true after start', async () => {
    await server.start('alice');
    expect(server.getIsRunning()).toBe(true);
  });

  it('getIsRunning() returns false before start', () => {
    expect(server.getIsRunning()).toBe(false);
  });

  it('start() is idempotent — second call returns true without re-creating server', async () => {
    await server.start('alice');
    const callCount = httpCreateServer.mock.calls.length;
    await server.start('alice'); // second call
    expect(httpCreateServer.mock.calls.length).toBe(callCount); // no new server
  });

  it('stop() sets isRunning to false', async () => {
    await server.start('alice');
    expect(server.getIsRunning()).toBe(true);
    await server.stop();
    expect(server.getIsRunning()).toBe(false);
  });

  it('stop() when not running resolves without error', async () => {
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('ensureStarted() starts server even when no user alias set', async () => {
    const result = await server.ensureStarted();
    expect(result).toBe(true);
    expect(server.getIsRunning()).toBe(true);
  });

  it('start() returns false when checkEnabled() throws', async () => {
    mockGetBrowserControlSettings.mockImplementation(() => {
      throw new Error('settings error');
    });
    const result = await server.start('alice');
    expect(result).toBe(false);
  });

  // ────────────────────────────────────────────────────────
  // HTTP request handling — uses real in-process http server
  // ────────────────────────────────────────────────────────

  describe('request handler', () => {
    let httpMod: any;
    let handler: (req: any, res: any) => void;

    beforeEach(async () => {
      await server.start('alice');
      httpMod = await import('http');
      handler = (httpMod.createServer as any).__getHandler?.();
    });

    it('serves update.xml with 200 when file exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('<xml/>'));
      const { req, res } = makeReqRes('GET', '/update.xml');
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/xml' }));
    });

    it('returns 404 when update.xml does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const { req, res } = makeReqRes('GET', '/update.xml');
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.writeHead).toHaveBeenCalledWith(404);
    });

    it('serves .crx file with 200 when file exists', async () => {
      mockFsExistsSync.mockReturnValue(true);
      mockFsReadFileSync.mockReturnValue(Buffer.from('crxdata'));
      const { req, res } = makeReqRes('GET', '/extension.crx');
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'application/x-chrome-extension' })
      );
    });

    it('returns 404 when .crx file does not exist', async () => {
      mockFsExistsSync.mockReturnValue(false);
      const { req, res } = makeReqRes('GET', '/missing.crx');
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.writeHead).toHaveBeenCalledWith(404);
    });

    it('POST /api/server-up returns 200 and triggers MCP connect', async () => {
      mockMcpGetRuntimeState.mockReturnValue(null); // not connected
      const { req, res } = makeReqRes('POST', '/api/server-up', JSON.stringify({ pid: 1234 }));
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 50));
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json' }));
      expect(mockMcpConnect).toHaveBeenCalledWith('openkosmos-chrome-extension');
    });

    it('POST /api/server-up does NOT reconnect if already connected', async () => {
      mockMcpGetRuntimeState.mockReturnValue({ status: 'connected' });
      const { req, res } = makeReqRes('POST', '/api/server-up', JSON.stringify({}));
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockMcpConnect).not.toHaveBeenCalled();
    });

    it('POST /api/server-down returns 200 and triggers MCP disconnect', async () => {
      mockMcpGetRuntimeState.mockReturnValue({ status: 'connected' });
      const { req, res } = makeReqRes('POST', '/api/server-down', JSON.stringify({ reason: 'shutdown' }));
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 50));
      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json' }));
      expect(mockMcpDisconnect).toHaveBeenCalledWith('openkosmos-chrome-extension');
    });

    it('POST /api/server-down does not disconnect when not connected', async () => {
      mockMcpGetRuntimeState.mockReturnValue({ status: 'disconnected' });
      const { req, res } = makeReqRes('POST', '/api/server-down', JSON.stringify({}));
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockMcpDisconnect).not.toHaveBeenCalled();
    });

    it('returns 400 for POST /api/server-up with invalid JSON', async () => {
      const { req, res } = makeReqRes('POST', '/api/server-up', 'NOT_JSON');
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.writeHead).toHaveBeenCalledWith(400);
    });

    it('returns 404 for unknown routes', async () => {
      const { req, res } = makeReqRes('GET', '/unknown/path');
      if (handler) handler(req, res);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.writeHead).toHaveBeenCalledWith(404);
    });
  });
});
