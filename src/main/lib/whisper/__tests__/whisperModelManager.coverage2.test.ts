// @ts-nocheck
/**
 * whisperModelManager.coverage2.test.ts
 * Targets download/progress/cancel paths not covered by coverage.test.ts
 */

import { EventEmitter } from 'events';

// ── hoisted mock vars ─────────────────────────────────────────────────────────
const mockGetPath = vi.hoisted(() => vi.fn(() => '/mock/userData'));
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());
const mockRenameSync = vi.hoisted(() => vi.fn());
const mockCreateWriteStream = vi.hoisted(() => vi.fn());
const mockHttpGet = vi.hoisted(() => vi.fn());

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  app: { getPath: (...args: any[]) => mockGetPath(...args) },
  BrowserWindow: {},
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: any[]) => mockExistsSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
    unlinkSync: (...args: any[]) => mockUnlinkSync(...args),
    renameSync: (...args: any[]) => mockRenameSync(...args),
    createWriteStream: (...args: any[]) => mockCreateWriteStream(...args),
    statSync: () => ({ size: 0 }),
  };
});

vi.mock('https', () => ({ get: (...args: any[]) => mockHttpGet(...args) }));
vi.mock('http', () => ({ get: (...args: any[]) => mockHttpGet(...args) }));

vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────
let manager: typeof import('../whisperModelManager').default;

// Create a shared write stream emitter per test
let writeStreamEmitter: EventEmitter;

beforeEach(async () => {
  vi.resetModules();
  mockExistsSync.mockReturnValue(true);
  mockMkdirSync.mockReturnValue(undefined);
  mockUnlinkSync.mockReturnValue(undefined);
  mockRenameSync.mockReturnValue(undefined);

  writeStreamEmitter = new EventEmitter();
  (writeStreamEmitter as any).close = vi.fn((cb?: () => void) => { cb?.(); });
  mockCreateWriteStream.mockReturnValue(writeStreamEmitter);

  const mod = await import('../whisperModelManager');
  manager = mod.default;
});

// Helper: set up a successful http download
function setupSuccessDownload(chunkSize = 500, total = 1000) {
  const req = new EventEmitter() as any;
  req.destroy = vi.fn();
  const res = new EventEmitter() as any;
  res.statusCode = 200;
  res.statusMessage = 'OK';
  res.headers = { 'content-length': String(total) };
  res.pipe = () => {};

  mockHttpGet.mockImplementationOnce((_url: string, cb: (res: any) => void) => {
    setImmediate(() => {
      cb(res);
      setImmediate(() => {
        res.emit('data', Buffer.alloc(chunkSize));
        setImmediate(() => {
          res.emit('data', Buffer.alloc(chunkSize));
          setImmediate(() => {
            writeStreamEmitter.emit('finish');
          });
        });
      });
    });
    return req;
  });

  return { req, res };
}

describe('WhisperModelManager – downloadModel success', () => {
  it('calls rename and invokes onProgress', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('.bin')) return false;
      return true;
    });

    const progressCalls: any[] = [];
    setupSuccessDownload(400, 800);

    await manager.downloadModel('tiny', (p) => progressCalls.push(p));

    expect(mockRenameSync).toHaveBeenCalled();
    expect(progressCalls.length).toBeGreaterThan(0);
    expect(progressCalls[0].model).toBe('tiny');
    expect(progressCalls[0].percent).toBeGreaterThanOrEqual(0);
  });

  it('notifies window on completion when window provided', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin'));
    setupSuccessDownload();

    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    } as any;

    await manager.downloadModel('base', undefined, fakeWindow);
    expect(fakeWindow.webContents.send).toHaveBeenCalledWith('whisper:downloadComplete', expect.objectContaining({ model: 'base' }));
  });

  it('does NOT notify destroyed window', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin'));
    setupSuccessDownload();

    const fakeWindow = {
      isDestroyed: () => true,
      webContents: { send: vi.fn() },
    } as any;

    await manager.downloadModel('small', undefined, fakeWindow);
    expect(fakeWindow.webContents.send).not.toHaveBeenCalled();
  });
});

describe('WhisperModelManager – downloadModel error path', () => {
  it('throws on network error and cleans up temp file', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('.tmp')) return true;
      if (p.endsWith('.bin')) return false;
      return true;
    });

    const req = new EventEmitter() as any;
    req.destroy = vi.fn();
    mockHttpGet.mockImplementationOnce((_url: string, _cb: any) => {
      setImmediate(() => req.emit('error', new Error('network failure')));
      return req;
    });

    await expect(manager.downloadModel('tiny')).rejects.toThrow('network failure');
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('does not rethrow on AbortError', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin') && !p.endsWith('.tmp'));

    const req = new EventEmitter() as any;
    req.destroy = vi.fn();
    mockHttpGet.mockImplementation((_url: string, _cb: any) => req);

    const downloadPromise = manager.downloadModel('medium');
    await new Promise(r => setImmediate(r));
    manager.cancelDownload('medium');

    const abortErr = new Error('Download aborted');
    abortErr.name = 'AbortError';
    req.emit('error', abortErr);

    await expect(downloadPromise).resolves.toBeUndefined();
  });
});

describe('WhisperModelManager – downloadModel already downloading', () => {
  it('throws when same model is already being downloaded', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin'));

    const req = new EventEmitter() as any;
    req.destroy = vi.fn();
    mockHttpGet.mockImplementation((_url: string, _cb: any) => req);

    const p1 = manager.downloadModel('turbo');
    await new Promise(r => setImmediate(r));

    await expect(manager.downloadModel('turbo')).rejects.toThrow('already being downloaded');

    manager.cancelDownload('turbo');
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    req.emit('error', abortErr);
    await p1.catch(() => {});
  });
});

describe('WhisperModelManager – http redirect', () => {
  it('follows a redirect to final URL', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin'));

    const req1 = new EventEmitter() as any; req1.destroy = vi.fn();
    const req2 = new EventEmitter() as any; req2.destroy = vi.fn();
    const res1 = new EventEmitter() as any;
    res1.statusCode = 301;
    res1.headers = { location: 'https://cdn.example.com/model.bin' };
    res1.pipe = () => {};

    const res2 = new EventEmitter() as any;
    res2.statusCode = 200;
    res2.headers = { 'content-length': '100' };
    res2.pipe = () => {};

    let callCount = 0;
    mockHttpGet.mockImplementation((_url: string, cb: (res: any) => void) => {
      callCount++;
      if (callCount === 1) {
        setImmediate(() => cb(res1));
        return req1;
      } else {
        setImmediate(() => {
          cb(res2);
          setImmediate(() => writeStreamEmitter.emit('finish'));
        });
        return req2;
      }
    });

    await manager.downloadModel('tiny');
    expect(callCount).toBe(2);
    expect(mockRenameSync).toHaveBeenCalled();
  });
});

describe('WhisperModelManager – non-200 status', () => {
  it('rejects with HTTP error message for non-200 response', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin'));

    const req = new EventEmitter() as any; req.destroy = vi.fn();
    const res = new EventEmitter() as any;
    res.statusCode = 404;
    res.statusMessage = 'Not Found';
    res.headers = {};
    res.pipe = () => {};

    mockHttpGet.mockImplementationOnce((_url: string, cb: (res: any) => void) => {
      setImmediate(() => cb(res));
      return req;
    });

    await expect(manager.downloadModel('tiny')).rejects.toThrow('HTTP 404');
  });
});

describe('WhisperModelManager – isDownloading / getActiveDownloads', () => {
  it('reports active downloads while download is in progress', async () => {
    mockExistsSync.mockImplementation((p: string) => !p.endsWith('.bin'));

    const req = new EventEmitter() as any; req.destroy = vi.fn();
    mockHttpGet.mockImplementation((_url: string, _cb: any) => req);

    const p = manager.downloadModel('small');
    await new Promise(r => setImmediate(r));

    expect(manager.isDownloading()).toBe(true);
    expect(manager.getActiveDownloads()).toContain('small');

    manager.cancelDownload('small');
    const err = new Error('aborted'); err.name = 'AbortError';
    req.emit('error', err);
    await p.catch(() => {});

    expect(manager.isDownloading()).toBe(false);
    expect(manager.getActiveDownloads()).toEqual([]);
  });
});
